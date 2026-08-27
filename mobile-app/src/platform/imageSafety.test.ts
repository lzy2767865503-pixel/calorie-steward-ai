import assert from "node:assert/strict";
import test from "node:test";

import { calculateSanitizedJpegDimensions } from "./imageSafety";

test("sanitized JPEG dimensions reject hostile inputs and bound every output axis", () => {
  assert.deepEqual(calculateSanitizedJpegDimensions(800, 600), {
    width: 800,
    height: 600,
  });
  assert.deepEqual(calculateSanitizedJpegDimensions(32, 16_000), {
    width: 3,
    height: 1_600,
  });
  assert.deepEqual(calculateSanitizedJpegDimensions(8_000, 4_000), {
    width: 1_600,
    height: 800,
  });
  assert.throws(
    () => calculateSanitizedJpegDimensions(1, 100_000),
    /dimensions are too large/,
  );
  assert.throws(
    () => calculateSanitizedJpegDimensions(10_000, 10_000),
    /dimensions are too large/,
  );
});
