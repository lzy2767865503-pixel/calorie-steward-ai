export const PENDING_PRIVATE_FILE_CLEANUP_SETTING_KEY =
  "privacy.pending-file-cleanup.v1";

export type PendingFileCleanupResult = {
  attempted: number;
  remaining: number;
};

export type PendingFileCleanupManager = {
  enqueue: (uri: string) => Promise<void>;
  registerActiveCapture: (uri: string) => Promise<void>;
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
  read: () => Promise<{ value: unknown } | null>;
  write: (uris: readonly string[]) => Promise<void>;
  remove: () => Promise<void>;
  deleteFile: (uri: string) => Promise<void>;
};

function assertMemoryUri(uri: string): void {
  const allowed =
    /^desktop-(?:memory-photo|export):\/\/[A-Za-z0-9._-]{1,96}$/.test(uri) ||
    /^blob:https?:\/\//.test(uri);
  if (!allowed || uri.includes("\0")) {
    throw new Error("The Windows private-memory URI is invalid.");
  }
}

/**
 * The Windows renderer never journals photo bytes or export contents to
 * SQLite. A crash releases all renderer memory, which is the cleanup event.
 * Opaque URI markers remain serialized inside this manager only while the
 * process is alive.
 */
export function createPendingFileCleanupManager(
  dependencies: PendingFileCleanupDependencies,
): PendingFileCleanupManager {
  let lock: Promise<void> = Promise.resolve();
  const pending = new Set<string>();
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
        assertMemoryUri(uri);
        pending.add(uri);
      }),

    registerActiveCapture: (uri) =>
      serialized(async () => {
        assertMemoryUri(uri);
        pending.add(uri);
        activeCaptureLeases.add(uri);
      }),

    deleteRegistered: (uri) =>
      serialized(async () => {
        assertMemoryUri(uri);
        pending.add(uri);
        activeCaptureLeases.delete(uri);
        await dependencies.deleteFile(uri);
        pending.delete(uri);
      }),

    registerAndUse: (uri, operation) =>
      serialized(async () => {
        assertMemoryUri(uri);
        pending.add(uri);
        await operation(uri);
      }),

    retryAll: () =>
      serialized(async () => {
        let attempted = 0;
        let remaining = 0;
        for (const uri of [...pending]) {
          if (activeCaptureLeases.has(uri)) continue;
          attempted += 1;
          try {
            await dependencies.deleteFile(uri);
            pending.delete(uri);
          } catch {
            remaining += 1;
          }
        }
        return { attempted, remaining };
      }),
  };
}
