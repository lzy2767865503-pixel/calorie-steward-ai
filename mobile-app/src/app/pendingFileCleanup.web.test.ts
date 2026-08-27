import assert from "node:assert/strict";
import test from "node:test";

import { createPendingFileCleanupManager } from "./pendingFileCleanup.web";

function managerWith(deleted: string[]) {
  return createPendingFileCleanupManager({
    roots: () => ({ documentDirectory: null, cacheDirectory: null }),
    read: async () => {
      throw new Error("Windows private-memory cleanup must not read SQLite.");
    },
    write: async () => {
      throw new Error("Windows private-memory cleanup must not write SQLite.");
    },
    remove: async () => {
      throw new Error("Windows private-memory cleanup must not mutate SQLite.");
    },
    deleteFile: async (uri) => {
      deleted.push(uri);
    },
  });
}

test("Windows photo cleanup keeps opaque leases in memory only", async () => {
  const deleted: string[] = [];
  const manager = managerWith(deleted);
  const uri = "desktop-memory-photo://capture-123";
  await manager.registerActiveCapture(uri);
  assert.deepEqual(await manager.retryAll(), { attempted: 0, remaining: 0 });
  assert.deepEqual(deleted, []);
  await manager.deleteRegistered(uri);
  assert.deepEqual(deleted, [uri]);
  assert.deepEqual(await manager.retryAll(), { attempted: 0, remaining: 0 });
});

test("Windows cleanup refuses data URLs so photo bytes cannot enter a journal", async () => {
  const manager = managerWith([]);
  await assert.rejects(
    manager.registerActiveCapture("data:image/jpeg;base64,c2Vuc2l0aXZl"),
    /private-memory URI is invalid/,
  );
});

test("Windows export markers are erased after the save operation", async () => {
  const deleted: string[] = [];
  const manager = managerWith(deleted);
  const uri = "desktop-export://export-123";
  let used = false;
  await manager.registerAndUse(uri, async (registeredUri) => {
    used = registeredUri === uri;
  });
  assert.equal(used, true);
  assert.deepEqual(await manager.retryAll(), { attempted: 1, remaining: 0 });
  assert.deepEqual(deleted, [uri]);
});
