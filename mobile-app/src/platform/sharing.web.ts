import { readDesktopExportContents } from "../app/photoFiles.web";
import { desktopBridge } from "./desktopRuntime";

export async function isAvailableAsync(): Promise<boolean> {
  return desktopBridge() !== null;
}

export async function shareAsync(
  uri: string,
  options: { dialogTitle?: string; mimeType?: string } = {},
): Promise<void> {
  const bridge = desktopBridge();
  if (!bridge) {
    throw new Error("The Windows desktop save dialog is unavailable.");
  }
  const contents = readDesktopExportContents(uri);
  if (contents === null) {
    throw new Error("The private export buffer is unavailable.");
  }
  const title = options.dialogTitle?.trim() || "Calorie Steward export";
  const safeTitle = title
    .replace(/[^A-Za-z0-9\u3400-\u9fff._ -]+/gu, "-")
    .replace(/\s+/g, "-")
    .slice(0, 64);
  await bridge.saveTextFile({
    contents,
    defaultFileName: `${safeTitle || "calorie-steward-export"}.json`,
  });
}
