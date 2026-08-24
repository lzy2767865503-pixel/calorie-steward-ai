export type PreparedCapturePhoto = {
  uri: string;
  base64: string;
  mimeType: "image/jpeg";
  width: number;
  height: number;
  capturedAt: string;
};

export type RawCapture = {
  uri: string;
  width: number;
  height: number;
};

export type SanitizedCapture = {
  uri: string;
  base64?: string | null;
  width: number;
  height: number;
};

export type CaptureCleanup = {
  registerActiveCapture: (uri: string) => Promise<void>;
  deleteRegistered: (uri: string) => Promise<void>;
};

export type StartupCaptureCleanup = {
  enqueue: (uri: string) => Promise<void>;
  retryAll: () => Promise<{ attempted: number; remaining: number }>;
};

export class CaptureCancelledError extends Error {
  constructor() {
    super("Capture cancelled.");
    this.name = "CaptureCancelledError";
  }
}

export class CaptureCleanupError extends Error {
  readonly operationError: unknown;
  readonly cleanupErrors: readonly unknown[];

  constructor(operationError: unknown, cleanupErrors: readonly unknown[]) {
    super("本机临时照片未能确认删除；App 会在下次启动扫描严格限定的拍摄缓存并重试。");
    this.name = "CaptureCleanupError";
    this.operationError = operationError;
    this.cleanupErrors = cleanupErrors;
  }
}

function isCancelled(check: (() => boolean) | undefined): boolean {
  return check?.() === true;
}

/**
 * Closes native kill windows that exist before JavaScript receives a new URI.
 * Every strictly-scanned orphan is journaled before any deletion attempt.
 */
export async function reconcileTransientCaptureFiles(args: {
  list: () => Promise<readonly string[]>;
  cleanup: StartupCaptureCleanup;
}): Promise<{ discovered: number; attempted: number; remaining: number }> {
  const uris = await args.list();
  for (const uri of uris) {
    await args.cleanup.enqueue(uri);
  }
  const result = await args.cleanup.retryAll();
  return { discovered: uris.length, ...result };
}

/**
 * Produces the only photo shape accepted by the AI flow. The native camera
 * output is registered first, then a separately re-encoded JPEG is registered
 * before the raw file is deleted. Only the re-encoded result is returned.
 */
export async function prepareCapturePhoto(args: {
  capture: () => Promise<RawCapture>;
  sanitize: (raw: RawCapture) => Promise<SanitizedCapture>;
  cleanup: CaptureCleanup;
  isCancelled?: () => boolean;
  now?: () => string;
}): Promise<PreparedCapturePhoto> {
  let rawUri: string | null = null;
  let sanitizedUri: string | null = null;
  try {
    const raw = await args.capture();
    rawUri = raw.uri;
    await args.cleanup.registerActiveCapture(raw.uri);
    if (isCancelled(args.isCancelled)) throw new CaptureCancelledError();

    const sanitized = await args.sanitize(raw);
    sanitizedUri = sanitized.uri;
    await args.cleanup.registerActiveCapture(sanitized.uri);

    // A distinct output file proves that the camera file itself can never be
    // mistaken for the upload candidate, even if a native dependency changes.
    if (sanitized.uri === raw.uri) {
      throw new Error("照片重编码未产生独立文件。");
    }
    if (isCancelled(args.isCancelled)) throw new CaptureCancelledError();
    if (!sanitized.base64) {
      throw new Error("照片处理失败，未生成可上传数据。");
    }

    await args.cleanup.deleteRegistered(raw.uri);
    rawUri = null;
    if (isCancelled(args.isCancelled)) throw new CaptureCancelledError();

    return {
      uri: sanitized.uri,
      base64: sanitized.base64,
      mimeType: "image/jpeg",
      width: sanitized.width,
      height: sanitized.height,
      capturedAt: (args.now ?? (() => new Date().toISOString()))(),
    };
  } catch (error) {
    const cleanupErrors: unknown[] = [];
    // Sanitized first avoids retaining the upload-ready bytes after a failure.
    if (sanitizedUri !== null) {
      try {
        await args.cleanup.deleteRegistered(sanitizedUri);
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    if (rawUri !== null && rawUri !== sanitizedUri) {
      try {
        await args.cleanup.deleteRegistered(rawUri);
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    if (cleanupErrors.length > 0) {
      throw new CaptureCleanupError(error, cleanupErrors);
    }
    throw error;
  }
}
