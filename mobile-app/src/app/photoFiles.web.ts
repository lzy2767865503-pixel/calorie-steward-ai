export type RetainedMealPhoto = {
  uri: string;
  sha256: string;
};

const exportBuffers = new Map<string, string>();
const EXPORT_URI = /^desktop-export:\/\/[A-Za-z0-9._-]{1,96}$/;
const MEMORY_PHOTO_URI = /^desktop-memory-photo:\/\/[A-Za-z0-9._-]{1,96}$/;

export function privateFileCleanupRoots(): {
  documentDirectory: string | null;
  cacheDirectory: string | null;
} {
  // Windows photo bytes and temporary exports live only in renderer memory.
  return { documentDirectory: null, cacheDirectory: null };
}

export async function listRetainedMealPhotoUris(): Promise<readonly string[]> {
  return [];
}

export async function listTransientCapturePhotoUris(): Promise<readonly string[]> {
  return [];
}

export async function retainMealPhoto(): Promise<RetainedMealPhoto> {
  throw new Error(
    "Photo retention is unavailable in the Windows release. Only structured records are stored.",
  );
}

export async function deleteLocalPhoto(uri: string | null | undefined): Promise<void> {
  if (!uri) return;
  if (EXPORT_URI.test(uri)) {
    exportBuffers.delete(uri);
    return;
  }
  if (MEMORY_PHOTO_URI.test(uri)) return;
  if (uri.startsWith("blob:")) {
    URL.revokeObjectURL(uri);
    return;
  }
  throw new Error("The Windows private-memory URI is invalid.");
}

export function createExportFileUri(exportId: string): string {
  if (!/^[A-Za-z0-9._-]{1,96}$/.test(exportId)) {
    throw new Error("Export file ID is invalid.");
  }
  return `desktop-export://${exportId}`;
}

export async function writeExportFile(uri: string, contents: string): Promise<void> {
  if (!EXPORT_URI.test(uri)) {
    throw new Error("The Windows export buffer URI is invalid.");
  }
  exportBuffers.set(uri, contents);
}

export function readDesktopExportContents(uri: string): string | null {
  if (!EXPORT_URI.test(uri)) return null;
  return exportBuffers.get(uri) ?? null;
}
