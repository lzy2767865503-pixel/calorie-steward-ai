import assert from "node:assert/strict";
import test from "node:test";

import { photoPreviewUri } from "./photoPreview";

const photo = {
  uri: "desktop-memory-photo://capture-123",
  mimeType: "image/jpeg" as const,
  base64: "aGVsbG8=",
};

test("Windows renders in-memory JPEG bytes without registering a custom protocol", () => {
  assert.equal(
    photoPreviewUri(photo, true),
    "data:image/jpeg;base64,aGVsbG8=",
  );
});

test("native platforms keep their re-encoded file URI", () => {
  assert.equal(photoPreviewUri({ ...photo, uri: "file:///safe.jpg" }, false), "file:///safe.jpg");
});

test("Windows rejects malformed markers and image bytes", () => {
  assert.throws(
    () => photoPreviewUri({ ...photo, uri: "file:///safe.jpg" }, true),
    /preview is invalid/,
  );
  assert.throws(
    () => photoPreviewUri({ ...photo, base64: "not base64" }, true),
    /preview is invalid/,
  );
});
