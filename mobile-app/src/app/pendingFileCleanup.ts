export const PENDING_PRIVATE_FILE_CLEANUP_SETTING_KEY =
  "privacy.pending-file-cleanup.v1";

type StoredSetting<T> = { value: T } | null;

export type PendingFileCleanupResult = {
  attempted: number;
  remaining: number;
};

export type PendingFileCleanupManager = {
  enqueue: (uri: string) => Promise<void>;
  /**
   * Registers a transient camera/manipulator image and keeps it leased by the
   * current JS runtime. A launch-time retry has no leases, so a process kill
   * turns every journaled capture into an immediately retryable orphan.
   */
  registerActiveCapture: (uri: string) => Promise<void>;
  /**
   * Journal-first deletion for both capture images and retained-photo
   * rollbacks. The queue entry is removed only after deletion is confirmed by
   * the injected file operation.
   */
  deleteRegistered: (uri: string) => Promise<void>;
  registerAndUse: (
    uri: string,
    operation: (uri: string) => Promise<void>,
  ) => Promise<void>;
  retryAll: () => Promise<PendingFileCleanupResult>;
};

type PendingFileCleanupDependencies = {
  roots: () => {
    documentDirectory: string | null;
    cacheDirectory: string | null;
  };
  read: () => Promise<StoredSetting<unknown>>;
  write: (uris: readonly string[]) => Promise<void>;
  remove: () => Promise<void>;
  deleteFile: (uri: string) => Promise<void>;
};

function normalizedDirectoryRoot(value: string | null, label: string): string {
  if (!value || !value.startsWith("file://") || !value.endsWith("/")) {
    throw new Error(`${label} 不可用，无法安全清理私密文件。`);
  }
  return value;
}

function assertOwnedPrivateFileUri(
  uri: string,
  roots: ReturnType<PendingFileCleanupDependencies["roots"]>,
): void {
  if (
    !uri.startsWith("file://") ||
    uri.includes("\0") ||
    uri.includes("?") ||
    uri.includes("#") ||
    uri.includes("\\")
  ) {
    throw new Error("待清理路径不是安全的 App 私有文件地址。");
  }
  const documentDirectory = normalizedDirectoryRoot(
    roots.documentDirectory,
    "App 文档目录",
  );
  const cacheDirectory = normalizedDirectoryRoot(roots.cacheDirectory, "App 缓存目录");
  const mealPhotoRoot = `${documentDirectory}meal-photos/`;
  const mealFileName = uri.startsWith(mealPhotoRoot)
    ? uri.slice(mealPhotoRoot.length)
    : "";
  const exportFileName = uri.startsWith(cacheDirectory)
    ? uri.slice(cacheDirectory.length)
    : "";
  const cameraFileName = uri.startsWith(`${cacheDirectory}Camera/`)
    ? uri.slice(`${cacheDirectory}Camera/`.length)
    : "";
  const manipulatedFileName = uri.startsWith(`${cacheDirectory}ImageManipulator/`)
    ? uri.slice(`${cacheDirectory}ImageManipulator/`.length)
    : "";
  const isMealPhoto = /^[A-Za-z0-9._-]+\.jpg$/.test(mealFileName);
  // Keep accepting the legacy filename so cleanup journals created before the
  // v1.2.1 rebrand can still remove plaintext exports after an overlay upgrade.
  const isExport = /^(?:calorie|diet)-steward-export-[A-Za-z0-9._-]+\.json$/.test(
    exportFileName,
  );
  const generatedJpegName =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpe?g$/i;
  const isCameraCapture = generatedJpegName.test(cameraFileName);
  const isManipulatedCapture = generatedJpegName.test(manipulatedFileName);
  if (!isMealPhoto && !isExport && !isCameraCapture && !isManipulatedCapture) {
    throw new Error("只能排队清理 App 生成的餐食照片、拍摄缓存或导出文件。");
  }
}

function readQueue(
  setting: StoredSetting<unknown>,
  roots: ReturnType<PendingFileCleanupDependencies["roots"]>,
): string[] {
  if (!setting) return [];
  if (!Array.isArray(setting.value)) {
    throw new Error("私密文件清理队列已损坏。");
  }
  const unique = new Set<string>();
  for (const value of setting.value) {
    if (typeof value !== "string") {
      throw new Error("私密文件清理队列包含无效项。");
    }
    assertOwnedPrivateFileUri(value, roots);
    unique.add(value);
  }
  return [...unique];
}

/**
 * Serializes queue mutations so an export cleanup and a meal rollback cannot
 * overwrite each other's pending file entry in the single JS runtime.
 */
export function createPendingFileCleanupManager(
  dependencies: PendingFileCleanupDependencies,
): PendingFileCleanupManager {
  let lock: Promise<void> = Promise.resolve();
  const activeCaptureLeases = new Set<string>();

  const serialized = async <T>(operation: () => Promise<T>): Promise<T> => {
    const previous = lock;
    let release: () => void = () => undefined;
    lock = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  };

  return {
    enqueue: (uri) =>
      serialized(async () => {
        const roots = dependencies.roots();
        assertOwnedPrivateFileUri(uri, roots);
        const queued = readQueue(await dependencies.read(), roots);
        if (queued.includes(uri)) return;
        await dependencies.write([...queued, uri]);
      }),

    registerActiveCapture: (uri) =>
      serialized(async () => {
        const roots = dependencies.roots();
        assertOwnedPrivateFileUri(uri, roots);
        const queued = readQueue(await dependencies.read(), roots);
        if (!queued.includes(uri)) {
          // The durable pointer is committed before this runtime starts using
          // the file. If the process dies immediately afterwards, the next
          // manager instance has no lease and deletes it during startup.
          await dependencies.write([...queued, uri]);
        }
        activeCaptureLeases.add(uri);
      }),

    deleteRegistered: (uri) =>
      serialized(async () => {
        const roots = dependencies.roots();
        assertOwnedPrivateFileUri(uri, roots);
        const queued = readQueue(await dependencies.read(), roots);
        if (!queued.includes(uri)) {
          await dependencies.write([...queued, uri]);
        }
        activeCaptureLeases.delete(uri);

        // deleteFile must confirm absence. If it rejects, the durable entry is
        // intentionally left untouched for the next retry or launch.
        await dependencies.deleteFile(uri);

        const afterDelete = readQueue(await dependencies.read(), roots).filter(
          (queuedUri) => queuedUri !== uri,
        );
        if (afterDelete.length > 0) {
          await dependencies.write(afterDelete);
        } else {
          await dependencies.remove();
        }
      }),

    registerAndUse: (uri, operation) =>
      serialized(async () => {
        const roots = dependencies.roots();
        assertOwnedPrivateFileUri(uri, roots);
        const queued = readQueue(await dependencies.read(), roots);
        if (!queued.includes(uri)) {
          await dependencies.write([...queued, uri]);
        }
        // Keep the same manager lock while the file is written and handed to
        // the platform share sheet. A concurrent retry can therefore neither
        // erase the pointer before creation nor delete a file still in use.
        await operation(uri);
      }),

    retryAll: () =>
      serialized(async () => {
        const roots = dependencies.roots();
        const queued = readQueue(await dependencies.read(), roots);
        if (queued.length === 0) {
          await dependencies.remove();
          return { attempted: 0, remaining: 0 };
        }

        const remaining: string[] = [];
        let failed = 0;
        let attempted = 0;
        for (const uri of queued) {
          if (activeCaptureLeases.has(uri)) {
            remaining.push(uri);
            continue;
          }
          attempted += 1;
          try {
            await dependencies.deleteFile(uri);
          } catch {
            failed += 1;
            remaining.push(uri);
          }
        }

        if (remaining.length > 0) {
          // Persisting the reduced queue is also a verification step. If this
          // write fails, the original queue is still present and remains safe
          // to retry because file deletion is idempotent.
          await dependencies.write(remaining);
        } else {
          await dependencies.remove();
        }
        // Active capture leases are kept in the durable journal but are not a
        // cleanup failure. They remain usable until cancel/save hands them to
        // deleteRegistered; after a process restart there are no leases.
        return { attempted, remaining: failed };
      }),
  };
}
