import assert from "node:assert/strict";
import test from "node:test";

import { drainPendingApiSecretCleanup } from "./apiSecretCleanupPolicy";

test("failed SecureStore deletion leaves the provider id retryable across restart", async () => {
  const persistedTombstones = new Set(["provider-old-scope"]);
  const firstBoot = await drainPendingApiSecretCleanup(
    [...persistedTombstones].map((providerId) => ({ providerId })),
    new Set(),
    {
      deleteSecret: async () => { throw new Error("injected SecureStore failure"); },
      removeTombstone: async (providerId) => { persistedTombstones.delete(providerId); },
    },
  );
  assert.deepEqual(firstBoot, { attempted: 1, cleaned: 0, remaining: 1 });
  assert.deepEqual([...persistedTombstones], ["provider-old-scope"]);

  const deletedIds: string[] = [];
  const secondBoot = await drainPendingApiSecretCleanup(
    [...persistedTombstones].map((providerId) => ({ providerId })),
    new Set(),
    {
      deleteSecret: async (providerId) => { deletedIds.push(providerId); },
      removeTombstone: async (providerId) => { persistedTombstones.delete(providerId); },
    },
  );
  assert.deepEqual(secondBoot, { attempted: 1, cleaned: 1, remaining: 0 });
  assert.deepEqual(deletedIds, ["provider-old-scope"]);
  assert.equal(persistedTombstones.size, 0);
});

test("active and journal-protected credential ids are never deleted", async () => {
  const tombstones = [{ providerId: "provider-active" }, { providerId: "provider-transition-target" }];
  const deleted: string[] = [];
  const result = await drainPendingApiSecretCleanup(
    tombstones,
    new Set(tombstones.map(({ providerId }) => providerId)),
    {
      deleteSecret: async (providerId) => { deleted.push(providerId); },
      removeTombstone: async () => undefined,
    },
  );
  assert.deepEqual(result, { attempted: 0, cleaned: 0, remaining: 2 });
  assert.deepEqual(deleted, []);
});

test("a tombstone survives failure after idempotent SecureStore deletion", async () => {
  const result = await drainPendingApiSecretCleanup(
    [{ providerId: "provider-delete-then-db-fails" }],
    new Set(),
    {
      deleteSecret: async () => undefined,
      removeTombstone: async () => { throw new Error("injected SQLite failure"); },
    },
  );
  assert.deepEqual(result, { attempted: 1, cleaned: 0, remaining: 1 });
});
