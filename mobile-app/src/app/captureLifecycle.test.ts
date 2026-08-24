import assert from "node:assert/strict";
import test from "node:test";

import {
  CaptureCancelledError,
  CaptureCleanupError,
  prepareCapturePhoto,
  reconcileTransientCaptureFiles,
  type CaptureCleanup,
} from "./captureLifecycle";
import { createPendingFileCleanupManager } from "./pendingFileCleanup";

const RAW =
  "file:///app/cache/Camera/11111111-1111-4111-8111-111111111111.jpg";
const SANITIZED =
  "file:///app/cache/ImageManipulator/22222222-2222-4222-8222-222222222222.jpg";

function journal(deleteFailures: ReadonlySet<string> = new Set()) {
  let stored: readonly string[] | null = null;
  const events: string[] = [];
  const manager = createPendingFileCleanupManager({
    roots: () => ({
      documentDirectory: "file:///app/documents/",
      cacheDirectory: "file:///app/cache/",
    }),
    read: async () => (stored === null ? null : { value: stored }),
    write: async (uris) => {
      stored = [...uris];
      events.push(`journal:${uris.join(",")}`);
    },
    remove: async () => {
      stored = null;
      events.push("journal:empty");
    },
    deleteFile: async (uri) => {
      events.push(`delete:${uri}`);
      if (deleteFailures.has(uri)) throw new Error("delete failed");
    },
  });
  return { manager, events, stored: () => stored };
}

function successfulArgs(cleanup: CaptureCleanup) {
  return {
    capture: async () => ({ uri: RAW, width: 2400, height: 1800 }),
    sanitize: async () => ({
      uri: SANITIZED,
      base64: "c2FuaXRpemVkLWpwZWc=",
      width: 1600,
      height: 1200,
    }),
    cleanup,
    now: () => "2026-08-24T08:00:00.000Z",
  };
}

test("success journals raw and sanitized, deletes raw, and returns only re-encoded bytes", async () => {
  const fixture = journal();
  const photo = await prepareCapturePhoto(successfulArgs(fixture.manager));

  assert.equal(photo.uri, SANITIZED);
  assert.equal(photo.base64, "c2FuaXRpemVkLWpwZWc=");
  assert.notEqual(photo.uri, RAW);
  assert.deepEqual(fixture.stored(), [SANITIZED]);
  assert.ok(
    fixture.events.indexOf(`journal:${RAW}`) <
      fixture.events.indexOf(`delete:${RAW}`),
  );
  assert.ok(
    fixture.events.some((event) =>
      event.startsWith(`journal:${RAW},${SANITIZED}`),
    ),
  );

  await fixture.manager.deleteRegistered(photo.uri);
  assert.equal(fixture.stored(), null);
});

test("cancel after native capture cleans raw without creating an upload candidate", async () => {
  const fixture = journal();
  let sanitized = false;
  await assert.rejects(
    prepareCapturePhoto({
      ...successfulArgs(fixture.manager),
      sanitize: async () => {
        sanitized = true;
        throw new Error("must not run");
      },
      isCancelled: () => true,
    }),
    CaptureCancelledError,
  );
  assert.equal(sanitized, false);
  assert.deepEqual(fixture.events.filter((event) => event.startsWith("delete:")), [
    `delete:${RAW}`,
  ]);
  assert.equal(fixture.stored(), null);
});

test("cancel after re-encoding cleans sanitized and raw through the same journal API", async () => {
  const fixture = journal();
  let checks = 0;
  await assert.rejects(
    prepareCapturePhoto({
      ...successfulArgs(fixture.manager),
      isCancelled: () => ++checks >= 2,
    }),
    CaptureCancelledError,
  );
  assert.deepEqual(fixture.events.filter((event) => event.startsWith("delete:")), [
    `delete:${SANITIZED}`,
    `delete:${RAW}`,
  ]);
  assert.equal(fixture.stored(), null);
});

test("raw deletion failure blocks upload and leaves raw durably retryable", async () => {
  const fixture = journal(new Set([RAW]));
  await assert.rejects(
    prepareCapturePhoto(successfulArgs(fixture.manager)),
    CaptureCleanupError,
  );
  assert.deepEqual(fixture.stored(), [RAW]);
  assert.ok(fixture.events.includes(`delete:${SANITIZED}`));
});

test("sanitized deletion failure during cancel stays journaled for restart", async () => {
  const fixture = journal(new Set([SANITIZED]));
  let checks = 0;
  await assert.rejects(
    prepareCapturePhoto({
      ...successfulArgs(fixture.manager),
      isCancelled: () => ++checks >= 2,
    }),
    CaptureCleanupError,
  );
  assert.deepEqual(fixture.stored(), [SANITIZED]);
  assert.ok(fixture.events.includes(`delete:${RAW}`));
});

test("a native dependency cannot pass the raw file through as sanitized output", async () => {
  const fixture = journal();
  await assert.rejects(
    prepareCapturePhoto({
      ...successfulArgs(fixture.manager),
      sanitize: async () => ({
        uri: RAW,
        base64: "cmF3",
        width: 1600,
        height: 1200,
      }),
    }),
    /独立文件/,
  );
  assert.deepEqual(fixture.events.filter((event) => event.startsWith("delete:")), [
    `delete:${RAW}`,
  ]);
  assert.equal(fixture.stored(), null);
});

test("startup orphan scan journals every discovered capture before deleting it", async () => {
  const fixture = journal();
  const result = await reconcileTransientCaptureFiles({
    list: async () => [RAW, SANITIZED],
    cleanup: fixture.manager,
  });
  assert.deepEqual(result, { discovered: 2, attempted: 2, remaining: 0 });
  const firstDelete = fixture.events.findIndex((event) =>
    event.startsWith("delete:"),
  );
  assert.ok(firstDelete > 0);
  assert.ok(
    fixture.events
      .slice(0, firstDelete)
      .some((event) => event.includes(RAW) && event.includes(SANITIZED)),
  );
  assert.equal(fixture.stored(), null);
});
