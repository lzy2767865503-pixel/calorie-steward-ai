import type { SavedAiConfiguration } from "./providerConfig";

export const API_PROVIDER_TRANSITION_SETTING_KEY = "ai.provider.transition.v1";

export type PendingEnterpriseTransition = Readonly<{
  version: 1;
  kind: "personal_to_enterprise";
  targetConfiguration: SavedAiConfiguration;
  previousProviderId: string | null;
  startedAtUtc: string;
}>;

export class EnterpriseTransitionPendingError extends Error {
  readonly causeValue: unknown;

  constructor(causeValue: unknown) {
    super(
      "Enterprise transition is pending. Historical-photo cleanup may be partially complete and will resume safely.",
    );
    this.name = "EnterpriseTransitionPendingError";
    this.causeValue = causeValue;
  }
}

export function createPendingEnterpriseTransition(input: {
  targetConfiguration: SavedAiConfiguration;
  previousProviderId: string | null;
  startedAtUtc?: string;
}): PendingEnterpriseTransition {
  if (input.targetConfiguration.setupProviderKind !== "enterprise") {
    throw new Error("Enterprise transition target must use enterprise mode.");
  }
  return {
    version: 1,
    kind: "personal_to_enterprise",
    targetConfiguration: input.targetConfiguration,
    previousProviderId: input.previousProviderId,
    startedAtUtc: input.startedAtUtc ?? new Date().toISOString(),
  };
}

export function isPendingEnterpriseTransition(
  value: unknown,
): value is PendingEnterpriseTransition {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Partial<PendingEnterpriseTransition>;
  const safeProviderId = (id: unknown): id is string =>
    typeof id === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(id);
  return (
    candidate.version === 1 &&
    candidate.kind === "personal_to_enterprise" &&
    typeof candidate.startedAtUtc === "string" &&
    !Number.isNaN(Date.parse(candidate.startedAtUtc)) &&
    (candidate.previousProviderId === null || safeProviderId(candidate.previousProviderId)) &&
    typeof candidate.targetConfiguration === "object" &&
    candidate.targetConfiguration !== null &&
    candidate.targetConfiguration.setupProviderKind === "enterprise" &&
    safeProviderId(candidate.targetConfiguration.config?.id)
  );
}

/** Recovers only an opaque id from a malformed journal so it is never orphaned. */
export function recoverTransitionTargetProviderId(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const target = (value as { targetConfiguration?: unknown }).targetConfiguration;
  if (typeof target !== "object" || target === null || Array.isArray(target)) return null;
  const config = (target as { config?: unknown }).config;
  if (typeof config !== "object" || config === null || Array.isArray(config)) return null;
  const id = (config as { id?: unknown }).id;
  return typeof id === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(id) ? id : null;
}

/**
 * Journal-first enterprise transition. A cleanup or final settings failure
 * deliberately leaves the journal in place for a restart-safe retry.
 */
export async function executeEnterpriseTransition(operations: {
  persistJournal: () => Promise<void>;
  purgeAndVerifyHistoricalPhotos: () => Promise<void>;
  commitConfigurationAndClearJournal: () => Promise<void>;
}): Promise<void> {
  await operations.persistJournal();
  try {
    await operations.purgeAndVerifyHistoricalPhotos();
    await operations.commitConfigurationAndClearJournal();
  } catch (error) {
    throw new EnterpriseTransitionPendingError(error);
  }
}

/** Resumes a journal that was already persisted before process interruption. */
export async function resumeEnterpriseTransition(operations: {
  purgeAndVerifyHistoricalPhotos: () => Promise<void>;
  commitConfigurationAndClearJournal: () => Promise<void>;
}): Promise<void> {
  try {
    await operations.purgeAndVerifyHistoricalPhotos();
    await operations.commitConfigurationAndClearJournal();
  } catch (error) {
    throw new EnterpriseTransitionPendingError(error);
  }
}
