import assert from "node:assert/strict";
import test from "node:test";

import {
  createExportFileUri,
  deleteLocalPhoto,
  readDesktopExportContents,
  retainMealPhoto,
  writeExportFile,
} from "./photoFiles.web";

test("Windows export contents exist only in an opaque in-memory buffer", async () => {
  const uri = createExportFileUri("portable-record-123");
  const contents = '{"schema":"diet-steward-portable-export.v1"}';
  await writeExportFile(uri, contents);
  assert.equal(readDesktopExportContents(uri), contents);
  await deleteLocalPhoto(uri);
  assert.equal(readDesktopExportContents(uri), null);
});

test("Windows export and photo-retention boundaries fail closed", async () => {
  assert.throws(() => createExportFileUri("../outside"), /ID is invalid/);
  await assert.rejects(writeExportFile("file:///tmp/export.json", "{}"), /URI is invalid/);
  await assert.rejects(retainMealPhoto(), /unavailable in the Windows release/);
});
