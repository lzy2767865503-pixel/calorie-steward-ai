export type PreviewablePhoto = {
  uri: string;
  mimeType: "image/jpeg";
  base64: string;
};

const WINDOWS_MEMORY_PHOTO =
  /^desktop-memory-photo:\/\/[A-Za-z0-9._-]{1,96}$/;
const BASE64_JPEG = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Windows keeps sanitized JPEG bytes in React state only. The opaque cleanup
 * marker must never be sent to an Image element because it has no protocol
 * handler; a data URL is created only for the current renderer preview.
 */
export function photoPreviewUri(
  photo: PreviewablePhoto,
  windowsDesktop: boolean,
): string {
  if (!windowsDesktop) return photo.uri;
  if (
    !WINDOWS_MEMORY_PHOTO.test(photo.uri) ||
    photo.base64.length === 0 ||
    photo.base64.length % 4 !== 0 ||
    !BASE64_JPEG.test(photo.base64)
  ) {
    throw new Error("The Windows in-memory photo preview is invalid.");
  }
  return `data:${photo.mimeType};base64,${photo.base64}`;
}
