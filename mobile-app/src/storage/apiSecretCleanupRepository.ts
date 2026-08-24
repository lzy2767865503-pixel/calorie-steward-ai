import type { SQLiteDatabase } from "expo-sqlite";

import { getDatabase } from "./database";
import { deleteApiSecret } from "./apiSecretStore";
import {
  drainPendingApiSecretCleanup,
  type ApiSecretCleanupResult,
} from "./apiSecretCleanupPolicy";
import { assertProviderId, assertNonSecretSettingKey } from "./secretPolicy";
import { assertNoSensitivePayload } from "./validation";

function serializeNonSecretSetting(key: string, value: unknown): string {
  assertNonSecretSettingKey(key);
  if (value === undefined) throw new Error("SQLite settings cannot store undefined.");
  assertNoSensitivePayload(value, `settings.${key}`);
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("Setting value is not JSON serializable.");
  return serialized;
}

async function enqueueWith(
  database: Pick<SQLiteDatabase, "runAsync">,
  providerId: string,
  queuedAtUtc: string,
): Promise<void> {
  assertProviderId(providerId);
  await database.runAsync(
    `INSERT INTO pending_api_secret_cleanup(provider_id, queued_at_utc)
     VALUES (?, ?)
     ON CONFLICT(provider_id) DO NOTHING`,
    providerId,
    queuedAtUtc,
  );
}

/**
 * Registers a fresh credential id before its SecureStore value is staged.
 * A crash before configuration commit therefore leaves a retryable tombstone.
 */
export async function stageApiSecretCleanup(providerId: string): Promise<void> {
  assertProviderId(providerId);
  await enqueueWith(await getDatabase(), providerId, new Date().toISOString());
}

/**
 * Persists a non-secret transition journal and protects the staged target id
 * in one transaction. Used before irreversible enterprise photo cleanup.
 */
export async function beginApiConfigurationTransition(
  journalKey: string,
  journal: unknown,
  targetProviderId: string,
): Promise<void> {
  const valueJson = serializeNonSecretSetting(journalKey, journal);
  assertProviderId(targetProviderId);
  const database = await getDatabase();
  const now = new Date().toISOString();
  await database.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.runAsync(
      `INSERT INTO settings(key, value_json, updated_at_utc)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value_json = excluded.value_json,
         updated_at_utc = excluded.updated_at_utc`,
      journalKey,
      valueJson,
      now,
    );
    await transaction.runAsync(
      "DELETE FROM pending_api_secret_cleanup WHERE provider_id = ?",
      targetProviderId,
    );
  });
}

/**
 * Commits the public provider configuration and its credential-id lifecycle
 * atomically. The optional journal is cleared in the same commit.
 */
export async function commitApiConfigurationTransition(
  settingKey: string,
  value: unknown,
  targetProviderId: string,
  previousProviderId: string | null,
  journalKeyToClear: string | null = null,
): Promise<void> {
  const valueJson = serializeNonSecretSetting(settingKey, value);
  assertProviderId(targetProviderId);
  if (previousProviderId !== null) assertProviderId(previousProviderId);
  if (journalKeyToClear !== null) assertNonSecretSettingKey(journalKeyToClear);
  const database = await getDatabase();
  const now = new Date().toISOString();
  await database.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.runAsync(
      `INSERT INTO settings(key, value_json, updated_at_utc)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value_json = excluded.value_json,
         updated_at_utc = excluded.updated_at_utc`,
      settingKey,
      valueJson,
      now,
    );
    await transaction.runAsync(
      "DELETE FROM pending_api_secret_cleanup WHERE provider_id = ?",
      targetProviderId,
    );
    if (previousProviderId && previousProviderId !== targetProviderId) {
      await enqueueWith(transaction, previousProviderId, now);
    }
    if (journalKeyToClear !== null) {
      await transaction.runAsync("DELETE FROM settings WHERE key = ?", journalKeyToClear);
    }
  });
}

/** Removes a provider config while retaining a durable cleanup id on failure. */
export async function retireApiConfiguration(
  settingKey: string,
  providerId: string,
): Promise<void> {
  assertNonSecretSettingKey(settingKey);
  assertProviderId(providerId);
  const database = await getDatabase();
  const now = new Date().toISOString();
  await database.withExclusiveTransactionAsync(async (transaction) => {
    await enqueueWith(transaction, providerId, now);
    await transaction.runAsync("DELETE FROM settings WHERE key = ?", settingKey);
  });
}

export async function retryPendingApiSecretCleanups(
  protectedProviderIds: readonly string[] = [],
): Promise<ApiSecretCleanupResult> {
  protectedProviderIds.forEach(assertProviderId);
  const database = await getDatabase();
  const entries = await database.getAllAsync<{ provider_id: string }>(
    "SELECT provider_id FROM pending_api_secret_cleanup ORDER BY queued_at_utc, provider_id",
  );
  return drainPendingApiSecretCleanup(
    entries.map((entry) => ({ providerId: entry.provider_id })),
    new Set(protectedProviderIds),
    {
      deleteSecret: deleteApiSecret,
      removeTombstone: async (providerId) => {
        await database.runAsync(
          "DELETE FROM pending_api_secret_cleanup WHERE provider_id = ?",
          providerId,
        );
      },
    },
  );
}
