import type { ProviderConfig } from "../ai";
import type { ApiSetupDraft, SetupProviderKind } from "../screens/ApiSetupScreen";
import {
  DATA_TRANSFER_CONSENT_VERSION,
  enterpriseWorkspaceFromInput,
  enterpriseWorkspaceScope,
  type DataTransferConsentReceipt,
  type EnterpriseWorkspace,
} from "../enterprise/deployment";

export const AI_CONFIG_SETTING_KEY = "ai.provider.config.v1";
export const AI_VERIFICATION_SETTING_KEY = "ai.provider.verification.v1";
export const RETAIN_PHOTOS_SETTING_KEY = "privacy.retain.photos";

export type SavedAiConfiguration = {
  config: ProviderConfig;
  setupProviderKind: SetupProviderKind;
  verifiedAt: string | null;
  /** Non-secret managed deployment identity. Older v1.0.x records omit it. */
  enterpriseWorkspace?: EnterpriseWorkspace | null;
  /** Versioned device-local evidence of the disclosure the user accepted. */
  consentReceipt?: DataTransferConsentReceipt;
};

type ProviderIdentity = Pick<
  ProviderConfig,
  "kind" | "authType" | "customAuthHeader"
>;

const CREDENTIAL_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const LEGACY_UNSCOPED_CREDENTIAL_ID = "primary-ai-provider";
const UTC_CONSENT_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function hasValidConsentTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !UTC_CONSENT_TIMESTAMP_PATTERN.test(value)) {
    return false;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

export function hasScopedCredentialId(
  saved: SavedAiConfiguration | null,
): saved is SavedAiConfiguration {
  return (
    saved !== null &&
    saved.config.id !== LEGACY_UNSCOPED_CREDENTIAL_ID
  );
}

export function hasCurrentDataTransferConsent(
  saved: SavedAiConfiguration | null,
): saved is SavedAiConfiguration & { consentReceipt: DataTransferConsentReceipt } {
  if (!saved) return false;
  const rawReceipt = saved?.consentReceipt as unknown;
  if (typeof rawReceipt !== "object" || rawReceipt === null || Array.isArray(rawReceipt)) {
    return false;
  }
  const receipt = rawReceipt as Record<string, unknown>;
  const categories = receipt.dataCategories;
  if (
    receipt.version !== DATA_TRANSFER_CONSENT_VERSION ||
    typeof receipt.scope !== "string" ||
    !hasValidConsentTimestamp(receipt.acceptedAtUtc) ||
    !Array.isArray(categories) ||
    categories.length !== 2 ||
    categories[0] !== "meal_photo" ||
    categories[1] !== "aggregated_diet_report"
  ) {
    return false;
  }
  try {
    return receipt.scope === credentialScopeForSaved(saved);
  } catch {
    return false;
  }
}

function providerIdentityFromDraft(draft: ApiSetupDraft): ProviderIdentity {
  const kind: ProviderConfig["kind"] =
    draft.providerKind === "gemini"
      ? "gemini_interactions"
      : draft.providerKind === "anthropic"
        ? "anthropic_messages"
        : draft.providerKind === "custom" || draft.providerKind === "enterprise"
          ? "custom_contract"
          : draft.protocol === "chat_completions"
            ? "openai_chat_compatible"
            : "openai_responses";

  const authType: ProviderConfig["authType"] =
    kind === "gemini_interactions"
      ? "x-goog-api-key"
      : kind === "anthropic_messages"
        ? "x-api-key"
        : "bearer";

  return { kind, authType, customAuthHeader: null };
}

function credentialScope(
  identity: ProviderIdentity,
  baseUrl: string,
): string {
  const parsed = new URL(baseUrl.trim());
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("Provider base URL must not include credentials, query or fragment.");
  }
  const normalizedEndpoint = `${parsed.origin}${parsed.pathname.replace(/\/+$/, "") || "/"}`;
  const customHeader =
    identity.authType === "custom-header"
      ? identity.customAuthHeader?.trim().toLowerCase() ?? ""
      : "";
  return [identity.kind, normalizedEndpoint, identity.authType, customHeader].join("|");
}

/**
 * Credential reuse is allowed only inside the exact provider/protocol,
 * complete normalized endpoint path and authentication scope that originally
 * received consent.
 */
export function credentialScopeForConfig(config: ProviderConfig): string {
  return credentialScope(config, config.baseUrl);
}

export function credentialScopeForSaved(
  saved: SavedAiConfiguration,
): string {
  const base = credentialScopeForConfig(saved.config);
  if (saved.setupProviderKind !== "enterprise") return base;
  if (!saved.enterpriseWorkspace) {
    throw new Error("Enterprise configuration is missing its workspace identity.");
  }
  return `${base}|managed|${enterpriseWorkspaceScope(saved.enterpriseWorkspace)}`;
}

export function credentialScopeForDraft(draft: ApiSetupDraft): string | null {
  try {
    const base = credentialScope(providerIdentityFromDraft(draft), draft.baseUrl);
    if (draft.providerKind !== "enterprise") return base;
    const workspace = enterpriseWorkspaceFromInput({
      organizationName: draft.organizationName,
      workspaceId: draft.workspaceId,
      environment: draft.environment,
      dataRegion: draft.dataRegion,
    });
    return `${base}|managed|${enterpriseWorkspaceScope(workspace)}`;
  } catch {
    return null;
  }
}

export function canReuseSavedCredential(
  saved: SavedAiConfiguration | null,
  draft: ApiSetupDraft,
): boolean {
  const draftScope = credentialScopeForDraft(draft);
  if (!hasScopedCredentialId(saved) || draftScope === null) return false;
  try {
    return credentialScopeForSaved(saved) === draftScope;
  } catch {
    return false;
  }
}

export function draftConsentCoversCredentialScope(
  draft: ApiSetupDraft,
): boolean {
  const scope = credentialScopeForDraft(draft);
  return (
    scope !== null &&
    draft.consentAccepted &&
    draft.consentScope === scope
  );
}

/**
 * Clears typed or saved-credential authorization whenever an edit changes the
 * credential scope. Model-only edits inside the same scope remain reusable.
 */
export function resetDraftAuthorizationIfScopeChanges(
  current: ApiSetupDraft,
  next: ApiSetupDraft,
): ApiSetupDraft {
  const currentScope = credentialScopeForDraft(current);
  const nextScope = credentialScopeForDraft(next);
  const sameValidScope =
    currentScope !== null && nextScope !== null && currentScope === nextScope;
  const securityFieldsUnchanged =
    current.providerKind === next.providerKind &&
    current.protocol === next.protocol &&
    current.baseUrl === next.baseUrl &&
    current.organizationName === next.organizationName &&
    current.workspaceId === next.workspaceId &&
    current.environment === next.environment &&
    current.dataRegion === next.dataRegion;

  if (sameValidScope || securityFieldsUnchanged) return next;
  return {
    ...next,
    apiKey: "",
    consentAccepted: false,
    consentScope: null,
  };
}

export function providerConfigFromDraft(
  draft: ApiSetupDraft,
  options: {
    previous: SavedAiConfiguration | null;
    newCredentialId: string;
  },
): SavedAiConfiguration {
  if (draft.providerKind === "enterprise" && !draft.historicalPhotoPurgeAccepted) {
    throw new Error("Enterprise mode requires explicit consent to remove retained local photos.");
  }
  const { kind, authType, customAuthHeader } = providerIdentityFromDraft(draft);
  const displayName = providerDisplayName(draft.providerKind);
  const baseUrl = draft.baseUrl.trim().replace(/\/+$/, "");
  const parsed = new URL(baseUrl);
  const allowInsecureLocalhost =
    typeof __DEV__ !== "undefined" &&
    __DEV__ &&
    parsed.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(parsed.hostname);

  const candidate: ProviderConfig = {
    id: options.newCredentialId,
    displayName,
    kind,
    baseUrl,
    visionModel: draft.visionModel.trim(),
    reportModel: draft.reportModel.trim() || draft.visionModel.trim(),
    apiVersion: kind === "anthropic_messages" ? "2023-06-01" : "",
    authType,
    customAuthHeader,
    timeoutMs: 60_000,
    allowInsecureLocalhost,
  };
  if (
    !CREDENTIAL_ID_PATTERN.test(options.newCredentialId) ||
    options.newCredentialId === LEGACY_UNSCOPED_CREDENTIAL_ID
  ) {
    throw new Error("newCredentialId is not safe for Keychain/Keystore.");
  }
  const enterpriseWorkspace =
    draft.providerKind === "enterprise"
      ? enterpriseWorkspaceFromInput({
          organizationName: draft.organizationName,
          workspaceId: draft.workspaceId,
          environment: draft.environment,
          dataRegion: draft.dataRegion,
        })
      : null;
  const candidateSaved: SavedAiConfiguration = {
    setupProviderKind: draft.providerKind,
    verifiedAt: null,
    enterpriseWorkspace,
    config: candidate,
  };
  const consentScope = credentialScopeForDraft(draft);
  if (
    !draft.consentAccepted ||
    consentScope === null ||
    draft.consentScope !== consentScope
  ) {
    throw new Error("The current endpoint and data categories require fresh consent.");
  }
  const reusableConsentReceipt =
    hasScopedCredentialId(options.previous) &&
    hasCurrentDataTransferConsent(options.previous) &&
    options.previous.consentReceipt.scope === consentScope
      ? options.previous.consentReceipt
      : null;
  candidateSaved.consentReceipt =
    reusableConsentReceipt ?? {
      version: DATA_TRANSFER_CONSENT_VERSION,
      acceptedAtUtc: new Date().toISOString(),
      scope: consentScope,
      dataCategories: ["meal_photo", "aggregated_diet_report"],
    };
  let previousScope: string | null = null;
  let previousCredentialId: string | null = null;
  if (hasScopedCredentialId(options.previous)) {
    try {
      previousScope = credentialScopeForSaved(options.previous);
      previousCredentialId = options.previous.config.id;
    } catch {
      previousScope = null;
      previousCredentialId = null;
    }
  }
  if (
    previousScope !== null &&
    previousCredentialId !== null &&
    previousScope === credentialScopeForSaved(candidateSaved)
  ) {
    candidate.id = previousCredentialId;
  } else if (
    hasScopedCredentialId(options.previous) &&
    options.newCredentialId === options.previous.config.id
  ) {
    throw new Error("A changed credential scope requires a fresh credential id.");
  }

  return candidateSaved;
}

export function providerDisplayName(kind: SetupProviderKind): string {
  switch (kind) {
    case "enterprise":
      return "企业托管网关";
    case "openai":
      return "OpenAI";
    case "openai_compatible":
      return "OpenAI 兼容接口";
    case "gemini":
      return "Google Gemini";
    case "anthropic":
      return "Anthropic Claude";
    case "custom":
      return "Diet AI Contract";
  }
}

export function endpointHost(config: ProviderConfig): string {
  try {
    return new URL(config.baseUrl).host;
  } catch {
    return config.baseUrl;
  }
}

export function savedConfigurationToDraft(
  saved: SavedAiConfiguration,
): Partial<ApiSetupDraft> {
  const protocol: ApiSetupDraft["protocol"] =
    saved.config.kind === "openai_chat_compatible"
      ? "chat_completions"
      : saved.config.kind === "openai_responses"
        ? "responses"
        : saved.config.kind === "gemini_interactions"
          ? "gemini_interactions"
          : saved.config.kind === "anthropic_messages"
            ? "anthropic_messages"
            : "custom_contract";
  const credentialIsScoped = hasScopedCredentialId(saved);
  const consentIsCurrent = credentialIsScoped && hasCurrentDataTransferConsent(saved);
  return {
    providerKind: saved.setupProviderKind,
    protocol,
    baseUrl: saved.config.baseUrl,
    visionModel: saved.config.visionModel,
    reportModel:
      saved.config.reportModel === saved.config.visionModel
        ? ""
        : saved.config.reportModel,
    organizationName: saved.enterpriseWorkspace?.organizationName ?? "",
    workspaceId: saved.enterpriseWorkspace?.workspaceId ?? "",
    environment: saved.enterpriseWorkspace?.environment ?? "production",
    dataRegion: saved.enterpriseWorkspace?.dataRegion ?? "provider_managed",
    consentAccepted: consentIsCurrent,
    consentScope: consentIsCurrent
      ? credentialScopeForSaved(saved)
      : null,
    historicalPhotoPurgeAccepted: saved.setupProviderKind === "enterprise",
  };
}
