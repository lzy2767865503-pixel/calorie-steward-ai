const MAX_SOURCE_DIMENSION = 16_384;
const MAX_SOURCE_PIXELS = 40_000_000;
const MAX_OUTPUT_DIMENSION = 1_600;
const MAX_OUTPUT_PIXELS = 2_560_000;

function validDimension(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

/**
 * Validates decoded input dimensions and returns a bounded JPEG canvas size.
 * The division form of the pixel checks avoids multiplying hostile dimensions.
 */
export function calculateSanitizedJpegDimensions(
  sourceWidth: number,
  sourceHeight: number,
): { width: number; height: number } {
  if (!validDimension(sourceWidth) || !validDimension(sourceHeight)) {
    throw new Error("The selected image dimensions are invalid.");
  }
  if (
    sourceWidth > MAX_SOURCE_DIMENSION ||
    sourceHeight > MAX_SOURCE_DIMENSION ||
    sourceWidth > MAX_SOURCE_PIXELS / sourceHeight
  ) {
    throw new Error("The selected image dimensions are too large.");
  }

  const sourcePixels = sourceWidth * sourceHeight;
  const scale = Math.min(
    1,
    MAX_OUTPUT_DIMENSION / sourceWidth,
    MAX_OUTPUT_DIMENSION / sourceHeight,
    Math.sqrt(MAX_OUTPUT_PIXELS / sourcePixels),
  );
  const width = Math.max(1, Math.floor(sourceWidth * scale));
  const height = Math.max(1, Math.floor(sourceHeight * scale));

  if (
    width > MAX_OUTPUT_DIMENSION ||
    height > MAX_OUTPUT_DIMENSION ||
    width > MAX_OUTPUT_PIXELS / height
  ) {
    throw new Error("The selected image could not be safely resized.");
  }
  return { width, height };
}
