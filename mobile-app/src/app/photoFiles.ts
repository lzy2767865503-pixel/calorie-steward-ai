import { CryptoDigestAlgorithm, digest } from "expo-crypto";
import { File } from "expo-file-system";
import * as FileSystem from "expo-file-system/legacy";

export type RetainedMealPhoto = {
  uri: string;
  sha256: string;
};

export function privateFileCleanupRoots(): {
  documentDirectory: string | null;
  cacheDirectory: string | null;
} {
  return {
    documentDirectory: FileSystem.documentDirectory,
    cacheDirectory: FileSystem.cacheDirectory,
  };
}

export async function listRetainedMealPhotoUris(): Promise<readonly string[]> {
  if (!FileSystem.documentDirectory) return [];
  const directory = `${FileSystem.documentDirectory}meal-photos/`;
  const info = await FileSystem.getInfoAsync(directory);
  if (!info.exists) return [];
  if (!info.isDirectory) {
    throw new Error("餐食照片目录结构异常。");
  }
  const names = await FileSystem.readDirectoryAsync(directory);
  return names
    .filter((name) => /^[A-Za-z0-9._-]+\.jpg$/.test(name))
    .map((name) => `${directory}${name}`);
}

const GENERATED_CAPTURE_JPEG =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpe?g$/i;

/**
 * Finds only the UUID-named JPEG families created by expo-camera and
 * expo-image-manipulator. Other cache content (including Camera videos) is
 * deliberately ignored so startup reconciliation cannot become broad cache
 * deletion.
 */
export async function listTransientCapturePhotoUris(): Promise<readonly string[]> {
  if (!FileSystem.cacheDirectory) return [];
  const uris: string[] = [];
  for (const family of ["Camera", "ImageManipulator"] as const) {
    const directory = `${FileSystem.cacheDirectory}${family}/`;
    const info = await FileSystem.getInfoAsync(directory);
    if (!info.exists) continue;
    if (!info.isDirectory) {
      throw new Error("拍摄缓存目录结构异常，已停止自动清理。");
    }
    const names = await FileSystem.readDirectoryAsync(directory);
    for (const name of names) {
      if (GENERATED_CAPTURE_JPEG.test(name)) {
        uris.push(`${directory}${name}`);
      }
    }
  }
  return uris;
}

function digestHex(value: ArrayBuffer): string {
  return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function retainMealPhoto(
  sourceUri: string,
  mealId: string,
  queuePrivateFileCleanup?: (uri: string) => Promise<void>,
): Promise<RetainedMealPhoto> {
  if (!FileSystem.documentDirectory) {
    throw new Error("该设备没有可用的 App 文档目录。");
  }
  const directory = `${FileSystem.documentDirectory}meal-photos/`;
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  const destination = `${directory}${mealId}.jpg`;
  try {
    await FileSystem.copyAsync({ from: sourceUri, to: destination });
    const retainedBytes = await new File(destination).bytes();
    const sha256 = digestHex(
      await digest(CryptoDigestAlgorithm.SHA256, retainedBytes),
    );
    if (!/^[a-f0-9]{64}$/.test(sha256)) {
      throw new Error("保留照片的 SHA-256 摘要无效。");
    }
    return { uri: destination, sha256 };
  } catch (error) {
    try {
      await deleteLocalPhoto(destination);
    } catch (cleanupError) {
      if (!queuePrivateFileCleanup) {
        throw cleanupError;
      }
      await queuePrivateFileCleanup(destination);
    }
    throw error;
  }
}

export async function deleteLocalPhoto(uri: string | null | undefined): Promise<void> {
  if (!uri || !uri.startsWith("file:")) return;
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
    const afterDelete = await FileSystem.getInfoAsync(uri);
    if (afterDelete.exists) {
      throw new Error("delete verification failed");
    }
  } catch {
    // Native file errors may contain a full sandbox path. Do not propagate it
    // to UI, logs, exports, or crash metadata.
    throw new Error("本机私密照片尚未确认删除；已保留启动重试记录。");
  }
}

export function createExportFileUri(exportId: string): string {
  if (!FileSystem.cacheDirectory) throw new Error("该设备没有可用的导出目录。");
  if (!/^[A-Za-z0-9._-]{1,96}$/.test(exportId)) {
    throw new Error("导出文件 ID 无效。");
  }
  return `${FileSystem.cacheDirectory}diet-steward-export-${exportId}.json`;
}

export async function writeExportFile(uri: string, contents: string): Promise<void> {
  if (!FileSystem.cacheDirectory) throw new Error("该设备没有可用的导出目录。");
  const fileName = uri.startsWith(FileSystem.cacheDirectory)
    ? uri.slice(FileSystem.cacheDirectory.length)
    : "";
  if (!/^diet-steward-export-[A-Za-z0-9._-]+\.json$/.test(fileName)) {
    throw new Error("导出文件必须位于 App 私有缓存目录。");
  }
  await FileSystem.writeAsStringAsync(uri, contents, {
    encoding: FileSystem.EncodingType.UTF8,
  });
}
