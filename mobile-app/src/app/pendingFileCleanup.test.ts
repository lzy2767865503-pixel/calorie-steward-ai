import assert from "node:assert/strict";
import test from "node:test";

import { createPendingFileCleanupManager } from "./pendingFileCleanup";

const EXPORT_A = "file:///app/cache/diet-steward-export-a.json";
const EXPORT_B = "file:///app/cache/diet-steward-export-b.json";
const MEAL_PHOTO = "file:///app/documents/meal-photos/meal-1.jpg";
const RAW_CAPTURE =
  "file:///app/cache/Camera/11111111-1111-4111-8111-111111111111.jpg";
const SANITIZED_CAPTURE =
  "file:///app/cache/ImageManipulator/22222222-2222-4222-8222-222222222222.jpg";

function memoryManager(initial: unknown = null, deleteFailure: string | null = null) {
  let stored: unknown = initial;
  const deleted: string[] = [];
  const manager = createPendingFileCleanupManager({
    roots: () => ({
      documentDirectory: "file:///app/documents/",
      cacheDirectory: "file:///app/cache/",
    }),
    read: async () => (stored === null ? null : { value: stored }),
    write: async (uris) => {
      stored = [...uris];
    },
    remove: async () => {
      stored = null;
    },
    deleteFile: async (uri) => {
      deleted.push(uri);
      if (uri === deleteFailure) throw new Error("locked");
    },
  });
  return { manager, deleted, stored: () => stored };
}

test("pending cleanup queue deduplicates and serializes concurrent additions", async () => {
  const fixture = memoryManager();
  await Promise.all([
    fixture.manager.enqueue(EXPORT_A),
    fixture.manager.enqueue(EXPORT_B),
    fixture.manager.enqueue(EXPORT_A),
  ]);
  assert.deepEqual(fixture.stored(), [EXPORT_A, EXPORT_B]);
});

test("retry deletes successful files and keeps failures for the next launch", async () => {
  const fixture = memoryManager([EXPORT_A, MEAL_PHOTO], MEAL_PHOTO);
  const result = await fixture.manager.retryAll();
  assert.deepEqual(result, { attempted: 2, remaining: 1 });
  assert.deepEqual(fixture.deleted, [EXPORT_A, MEAL_PHOTO]);
  assert.deepEqual(fixture.stored(), [MEAL_PHOTO]);
});

test("retry removes the queue only after every private file is confirmed deleted", async () => {
  const fixture = memoryManager([EXPORT_A, MEAL_PHOTO]);
  const result = await fixture.manager.retryAll();
  assert.deepEqual(result, { attempted: 2, remaining: 0 });
  assert.equal(fixture.stored(), null);
});

test("queue rejects paths outside the app-generated private file families", async () => {
  const fixture = memoryManager();
  await assert.rejects(
    fixture.manager.enqueue("file:///app/documents/SQLite/diet-steward.db"),
    /App 生成的餐食照片.*导出文件/,
  );
  await assert.rejects(
    fixture.manager.enqueue("file:///app/cache/../SQLite/diet-steward.db"),
    /App 生成的餐食照片.*导出文件/,
  );
  await assert.rejects(
    fixture.manager.enqueue("file:///etc/meal-photos/credential.jpg"),
    /App 生成的餐食照片.*导出文件/,
  );
  await assert.rejects(
    fixture.manager.enqueue(
      "file:///private/var/app-secrets/diet-steward-export-secret.json",
    ),
    /App 生成的餐食照片.*导出文件/,
  );
  await assert.rejects(
    fixture.manager.enqueue(
      "file:///app/documents/unrelated/meal-photos/data.jpg",
    ),
    /App 生成的餐食照片.*导出文件/,
  );
  await assert.rejects(
    fixture.manager.enqueue(
      "file:///app/cache/Camera/../SQLite/diet-steward.db.jpg",
    ),
    /App 生成的餐食照片.*导出文件/,
  );
  await assert.rejects(
    fixture.manager.enqueue(
      "file:///app/cache/ImageManipulator/%2e%2e%2fsecret.jpg",
    ),
    /App 生成的餐食照片.*导出文件/,
  );
  assert.equal(fixture.stored(), null);
});

test("raw and sanitized captures are accepted only in exact generated cache families", async () => {
  const fixture = memoryManager();
  await fixture.manager.enqueue(RAW_CAPTURE);
  await fixture.manager.enqueue(SANITIZED_CAPTURE);
  assert.deepEqual(fixture.stored(), [RAW_CAPTURE, SANITIZED_CAPTURE]);
});

test("raw delete failure remains durable and succeeds after manager restart", async () => {
  const first = memoryManager(null, RAW_CAPTURE);
  await first.manager.registerActiveCapture(RAW_CAPTURE);
  await assert.rejects(first.manager.deleteRegistered(RAW_CAPTURE), /locked/);
  assert.deepEqual(first.stored(), [RAW_CAPTURE]);

  const restarted = memoryManager(first.stored());
  assert.deepEqual(await restarted.manager.retryAll(), {
    attempted: 1,
    remaining: 0,
  });
  assert.deepEqual(restarted.deleted, [RAW_CAPTURE]);
  assert.equal(restarted.stored(), null);
});

test("sanitized delete failure remains durable and succeeds after manager restart", async () => {
  const first = memoryManager(null, SANITIZED_CAPTURE);
  await first.manager.registerActiveCapture(SANITIZED_CAPTURE);
  await assert.rejects(
    first.manager.deleteRegistered(SANITIZED_CAPTURE),
    /locked/,
  );
  assert.deepEqual(first.stored(), [SANITIZED_CAPTURE]);

  const restarted = memoryManager(first.stored());
  assert.deepEqual(await restarted.manager.retryAll(), {
    attempted: 1,
    remaining: 0,
  });
  assert.equal(restarted.stored(), null);
});

test("active capture survives same-runtime retry but becomes orphaned after kill/restart", async () => {
  const active = memoryManager();
  await active.manager.registerActiveCapture(SANITIZED_CAPTURE);
  assert.deepEqual(await active.manager.retryAll(), {
    attempted: 0,
    remaining: 0,
  });
  assert.deepEqual(active.deleted, []);
  assert.deepEqual(active.stored(), [SANITIZED_CAPTURE]);

  const restarted = memoryManager(active.stored());
  assert.deepEqual(await restarted.manager.retryAll(), {
    attempted: 1,
    remaining: 0,
  });
  assert.deepEqual(restarted.deleted, [SANITIZED_CAPTURE]);
  assert.equal(restarted.stored(), null);
});

test("concurrent active registration, deletion, and retry cannot lose the journal entry", async () => {
  const fixture = memoryManager();
  await fixture.manager.registerActiveCapture(SANITIZED_CAPTURE);
  await Promise.all([
    fixture.manager.retryAll(),
    fixture.manager.deleteRegistered(SANITIZED_CAPTURE),
  ]);
  assert.deepEqual(fixture.deleted, [SANITIZED_CAPTURE]);
  assert.equal(fixture.stored(), null);
});

test("private export path is registered before plaintext writing begins", async () => {
  const calls: string[] = [];
  let stored: readonly string[] | null = null;
  const manager = createPendingFileCleanupManager({
    roots: () => ({
      documentDirectory: "file:///app/documents/",
      cacheDirectory: "file:///app/cache/",
    }),
    read: async () => (stored === null ? null : { value: stored }),
    write: async (uris) => {
      calls.push(`enqueue:${uris.at(-1)}`);
      stored = [...uris];
    },
    remove: async () => {
      stored = null;
    },
    deleteFile: async () => undefined,
  });
  await manager.registerAndUse(EXPORT_A, async (uri) => {
    calls.push(`write:${uri}`);
  });
  assert.deepEqual(stored, [EXPORT_A]);
  assert.deepEqual(calls, [`enqueue:${EXPORT_A}`, `write:${EXPORT_A}`]);
});

test("registration, plaintext write, and retry share one serialized boundary", async () => {
  let stored: readonly string[] | null = null;
  const events: string[] = [];
  let releaseWrite: () => void = () => undefined;
  const writeGate = new Promise<void>((resolve) => {
    releaseWrite = resolve;
  });
  let announceWriteStarted: () => void = () => undefined;
  const writeStarted = new Promise<void>((resolve) => {
    announceWriteStarted = resolve;
  });
  const manager = createPendingFileCleanupManager({
    roots: () => ({
      documentDirectory: "file:///app/documents/",
      cacheDirectory: "file:///app/cache/",
    }),
    read: async () => (stored === null ? null : { value: stored }),
    write: async (uris) => {
      stored = [...uris];
    },
    remove: async () => {
      stored = null;
    },
    deleteFile: async (uri) => {
      events.push(`delete:${uri}`);
    },
  });

  const writing = manager.registerAndUse(EXPORT_A, async () => {
    events.push("write:start");
    announceWriteStarted();
    await writeGate;
    events.push("write:end");
  });
  await writeStarted;
  const retrying = manager.retryAll();
  await Promise.resolve();
  assert.deepEqual(events, ["write:start"]);
  assert.deepEqual(stored, [EXPORT_A]);

  releaseWrite();
  await Promise.all([writing, retrying]);
  assert.deepEqual(events, [
    "write:start",
    "write:end",
    `delete:${EXPORT_A}`,
  ]);
  assert.equal(stored, null);
});

test("plaintext export is never written when durable registration fails", async () => {
  let wrote = false;
  const manager = createPendingFileCleanupManager({
    roots: () => ({
      documentDirectory: "file:///app/documents/",
      cacheDirectory: "file:///app/cache/",
    }),
    read: async () => null,
    write: async () => {
      throw new Error("queue unavailable");
    },
    remove: async () => undefined,
    deleteFile: async () => undefined,
  });
  await assert.rejects(
    manager.registerAndUse(EXPORT_A, async () => {
      wrote = true;
    }),
    /queue unavailable/,
  );
  assert.equal(wrote, false);
});
