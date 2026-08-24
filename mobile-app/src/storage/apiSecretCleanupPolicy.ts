export type PendingApiSecretCleanup = Readonly<{ providerId: string }>;

export type ApiSecretCleanupResult = Readonly<{
  attempted: number;
  cleaned: number;
  remaining: number;
}>;

/**
 * Drains persisted provider-id tombstones. Only opaque ids cross this boundary;
 * secret values are neither accepted nor returned.
 */
export async function drainPendingApiSecretCleanup(
  entries: readonly PendingApiSecretCleanup[],
  protectedProviderIds: ReadonlySet<string>,
  operations: {
    deleteSecret: (providerId: string) => Promise<void>;
    removeTombstone: (providerId: string) => Promise<void>;
  },
): Promise<ApiSecretCleanupResult> {
  let attempted = 0;
  let cleaned = 0;
  let remaining = 0;

  for (const entry of entries) {
    if (protectedProviderIds.has(entry.providerId)) {
      remaining += 1;
      continue;
    }
    attempted += 1;
    try {
      await operations.deleteSecret(entry.providerId);
      await operations.removeTombstone(entry.providerId);
      cleaned += 1;
    } catch {
      // The durable tombstone remains. A later startup can retry safely.
      remaining += 1;
    }
  }

  return { attempted, cleaned, remaining };
}
