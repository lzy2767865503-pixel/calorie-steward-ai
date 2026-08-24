import assert from "node:assert/strict";
import test from "node:test";

import type { ProviderConfig } from "../ai";
import type {
  DataTransferConsentReceipt,
  EnterpriseWorkspace,
} from "../enterprise/deployment";
import type { ApiSetupDraft } from "../screens/ApiSetupScreen";
import {
  canReuseSavedCredential,
  credentialScopeForConfig,
  credentialScopeForDraft,
  credentialScopeForSaved,
  draftConsentCoversCredentialScope,
  hasCurrentDataTransferConsent,
  hasScopedCredentialId,
  providerConfigFromDraft,
  resetDraftAuthorizationIfScopeChanges,
  savedConfigurationToDraft,
  type SavedAiConfiguration,
} from "./providerConfig";

function compatibleDraft(
  overrides: Partial<ApiSetupDraft> = {},
): ApiSetupDraft {
  const unconsented: ApiSetupDraft = {
    providerKind: "openai_compatible",
    protocol: "chat_completions",
    baseUrl: "https://gateway.example/v1",
    visionModel: "codex-local-vision",
    reportModel: "compatible-report-model",
    apiKey: "typed-secret",
    organizationName: "LAI Systems",
    workspaceId: "nutrition-pilot",
    environment: "production",
    dataRegion: "malaysia",
    consentAccepted: false,
    consentScope: null,
    historicalPhotoPurgeAccepted: true,
    ...overrides,
  };
  const scope = credentialScopeForDraft(unconsented);
  assert.notEqual(scope, null);
  return {
    ...unconsented,
    consentAccepted: true,
    consentScope: scope,
  };
}

function savedCompatible(id = "provider-scope-a"): SavedAiConfiguration {
  return providerConfigFromDraft(compatibleDraft(), {
    previous: null,
    newCredentialId: id,
  });
}

test("credential scope binds provider kind, complete endpoint and auth type", () => {
  const saved = savedCompatible();
  const normalizedEquivalent = compatibleDraft({
    baseUrl: "https://GATEWAY.EXAMPLE:443/v1/",
  });
  assert.equal(
    credentialScopeForConfig(saved.config),
    credentialScopeForDraft(normalizedEquivalent),
  );

  const sameOriginDifferentPath = compatibleDraft({
    baseUrl: "https://GATEWAY.EXAMPLE/v2/private",
  });
  assert.notEqual(
    credentialScopeForConfig(saved.config),
    credentialScopeForDraft(sameOriginDifferentPath),
  );

  const changedHost = compatibleDraft({ baseUrl: "https://proxy.example" });
  assert.notEqual(
    credentialScopeForConfig(saved.config),
    credentialScopeForDraft(changedHost),
  );

  const changedProvider = compatibleDraft({
    providerKind: "openai",
    protocol: "responses",
  });
  assert.notEqual(
    credentialScopeForConfig(saved.config),
    credentialScopeForDraft(changedProvider),
  );

  const changedAuth: ProviderConfig = {
    ...saved.config,
    authType: "x-api-key",
  };
  assert.notEqual(
    credentialScopeForConfig(saved.config),
    credentialScopeForConfig(changedAuth),
  );

  const invalidQueryDraft: ApiSetupDraft = {
    ...compatibleDraft(),
    baseUrl: "https://gateway.example/v1?tenant=other",
  };
  assert.equal(
    credentialScopeForDraft(invalidQueryDraft),
    null,
  );
});

test("scope changes clear typed keys and require fresh consent", () => {
  const current = compatibleDraft();
  const changedHost = resetDraftAuthorizationIfScopeChanges(current, {
    ...current,
    baseUrl: "https://proxy.example/v1",
  });
  assert.equal(changedHost.apiKey, "");
  assert.equal(changedHost.consentAccepted, false);
  assert.equal(changedHost.consentScope, null);

  const changedProvider = resetDraftAuthorizationIfScopeChanges(current, {
    ...current,
    providerKind: "openai",
    protocol: "responses",
  });
  assert.equal(changedProvider.apiKey, "");
  assert.equal(changedProvider.consentAccepted, false);
  assert.equal(changedProvider.consentScope, null);

  const compatibleChat = compatibleDraft({
    providerKind: "openai_compatible",
    protocol: "chat_completions",
    baseUrl: "https://gateway.example/v1",
  });
  const changedProtocol = resetDraftAuthorizationIfScopeChanges(compatibleChat, {
    ...compatibleChat,
    protocol: "responses",
  });
  assert.equal(changedProtocol.apiKey, "");
  assert.equal(changedProtocol.consentAccepted, false);
  assert.equal(changedProtocol.consentScope, null);

  const sameOriginPathEdit = resetDraftAuthorizationIfScopeChanges(current, {
    ...current,
    baseUrl: "https://gateway.example/alternate/path",
  });
  assert.equal(sameOriginPathEdit.apiKey, "");
  assert.equal(sameOriginPathEdit.consentAccepted, false);
  assert.equal(sameOriginPathEdit.consentScope, null);
});

test("stale consent and blank credentials cannot authorize a changed scope", () => {
  const saved = savedCompatible();
  const savedDraft = savedConfigurationToDraft(saved);
  const current = compatibleDraft(savedDraft);
  assert.equal(draftConsentCoversCredentialScope(current), true);
  assert.equal(canReuseSavedCredential(saved, current), true);

  const changedHostWithStaleConsent: ApiSetupDraft = {
    ...current,
    baseUrl: "https://attacker.example/v1",
    apiKey: "",
  };
  assert.equal(
    draftConsentCoversCredentialScope(changedHostWithStaleConsent),
    false,
  );
  assert.equal(
    canReuseSavedCredential(saved, changedHostWithStaleConsent),
    false,
  );
});

test("configuration preserves a credential id only inside the same scope", () => {
  const saved = savedCompatible("provider-scope-a");
  const sameScope = providerConfigFromDraft(
    compatibleDraft(),
    { previous: saved, newCredentialId: "provider-unused-b" },
  );
  assert.equal(sameScope.config.id, "provider-scope-a");

  const changedScope = providerConfigFromDraft(
    compatibleDraft({ baseUrl: "https://other-gateway.example/v1" }),
    { previous: saved, newCredentialId: "provider-scope-b" },
  );
  assert.equal(changedScope.config.id, "provider-scope-b");
  assert.notEqual(changedScope.config.id, saved.config.id);

  const changedProvider = providerConfigFromDraft(
    compatibleDraft({ providerKind: "openai", protocol: "responses" }),
    { previous: saved, newCredentialId: "provider-scope-c" },
  );
  assert.equal(changedProvider.config.id, "provider-scope-c");

  assert.throws(
    () =>
      providerConfigFromDraft(
        compatibleDraft({ baseUrl: "https://other-gateway.example/v1" }),
        { previous: saved, newCredentialId: saved.config.id },
      ),
    /fresh credential id/,
  );
});

test("saving the same valid scope preserves the original consent time", () => {
  const saved = savedCompatible("provider-consent-time");
  assert.ok(saved.consentReceipt);
  const acceptedAtUtc = "2026-08-01T01:02:03.000Z";
  const previous: SavedAiConfiguration = {
    ...saved,
    consentReceipt: {
      ...saved.consentReceipt,
      acceptedAtUtc,
    },
  };
  assert.equal(hasCurrentDataTransferConsent(previous), true);

  const unchanged = providerConfigFromDraft(compatibleDraft(), {
    previous,
    newCredentialId: "provider-unused-consent-time",
  });
  assert.equal(unchanged.consentReceipt?.acceptedAtUtc, acceptedAtUtc);

  const changed = providerConfigFromDraft(
    compatibleDraft({ baseUrl: "https://gateway.example/v2" }),
    {
      previous,
      newCredentialId: "provider-fresh-consent-time",
    },
  );
  assert.notEqual(changed.consentReceipt?.acceptedAtUtc, acceptedAtUtc);
});

test("enterprise consent binds normalized organization and exact-case workspace identity", () => {
  const enterpriseDraft = compatibleDraft({
    providerKind: "enterprise",
    protocol: "custom_contract",
    baseUrl: "https://enterprise.example/diet-ai",
    visionModel: "managed-vision",
    reportModel: "managed-report",
    organizationName: "  LAI\u00a0 Systems  ",
    workspaceId: "Nutrition-Pilot",
  });
  const saved = providerConfigFromDraft(enterpriseDraft, {
    previous: null,
    newCredentialId: "provider-enterprise-a",
  });
  assert.equal(saved.config.kind, "custom_contract");
  assert.equal(saved.enterpriseWorkspace?.organizationName, "LAI Systems");
  assert.equal(saved.enterpriseWorkspace?.workspaceId, "Nutrition-Pilot");
  assert.equal(hasCurrentDataTransferConsent(saved), true);
  assert.equal(credentialScopeForSaved(saved), credentialScopeForDraft(enterpriseDraft));
  assert.ok(saved.enterpriseWorkspace);
  const renamedSaved: SavedAiConfiguration = {
    ...saved,
    enterpriseWorkspace: {
      ...saved.enterpriseWorkspace,
      organizationName: "LAI Systems Malaysia",
    },
  };
  assert.equal(hasCurrentDataTransferConsent(renamedSaved), false);

  const formattingOnly = compatibleDraft({
    ...enterpriseDraft,
    organizationName: "LAI Systems",
  });
  assert.equal(
    credentialScopeForDraft(formattingOnly),
    credentialScopeForSaved(saved),
  );
  assert.equal(
    resetDraftAuthorizationIfScopeChanges(enterpriseDraft, formattingOnly).apiKey,
    enterpriseDraft.apiKey,
  );

  for (const changed of [
    compatibleDraft({ ...enterpriseDraft, organizationName: "LAI Systems Malaysia" }),
    compatibleDraft({ ...enterpriseDraft, workspaceId: "nutrition-pilot" }),
    compatibleDraft({ ...enterpriseDraft, environment: "staging" }),
    compatibleDraft({ ...enterpriseDraft, dataRegion: "singapore" }),
  ]) {
    assert.notEqual(credentialScopeForDraft(changed), credentialScopeForSaved(saved));
    const reset = resetDraftAuthorizationIfScopeChanges(enterpriseDraft, changed);
    assert.equal(reset.apiKey, "");
    assert.equal(reset.consentAccepted, false);
    assert.equal(reset.consentScope, null);
  }
});

test("legacy consent cannot authorize the expanded photo and report disclosure", () => {
  const current = savedCompatible();
  const legacy: SavedAiConfiguration = { ...current };
  delete legacy.consentReceipt;
  assert.equal(hasCurrentDataTransferConsent(legacy), false);
  const draft = savedConfigurationToDraft(legacy);
  assert.equal(draft.consentAccepted, false);
  assert.equal(draft.consentScope, null);
});

test("malformed consent timestamps and extra data categories fail closed", () => {
  const current = savedCompatible();
  assert.ok(current.consentReceipt);
  const malformedTimestamp: SavedAiConfiguration = {
    ...current,
    consentReceipt: {
      ...current.consentReceipt,
      acceptedAtUtc: "not-a-real-consent-time",
    },
  };
  assert.equal(hasCurrentDataTransferConsent(malformedTimestamp), false);

  const extraCategory: SavedAiConfiguration = {
    ...current,
    consentReceipt: {
      ...current.consentReceipt,
      dataCategories: [
        "meal_photo",
        "aggregated_diet_report",
        "unexpected_category",
      ] as unknown as DataTransferConsentReceipt["dataCategories"],
    },
  };
  assert.equal(hasCurrentDataTransferConsent(extraCategory), false);

  for (const malformedCategories of [
    null,
    undefined,
    { 0: "meal_photo", 1: "aggregated_diet_report", length: 2 },
  ]) {
    const corrupt: SavedAiConfiguration = {
      ...current,
      consentReceipt: {
        ...current.consentReceipt,
        dataCategories: malformedCategories,
      } as unknown as DataTransferConsentReceipt,
    };
    assert.doesNotThrow(() => hasCurrentDataTransferConsent(corrupt));
    assert.equal(hasCurrentDataTransferConsent(corrupt), false);
  }
});

test("enterprise setup rejects invalid workspace identity before persistence", () => {
  const valid = compatibleDraft({
    providerKind: "enterprise",
    protocol: "custom_contract",
    baseUrl: "https://enterprise.example/diet-ai",
  });
  const invalid: ApiSetupDraft = { ...valid, workspaceId: "bad workspace id" };
  assert.throws(
    () => providerConfigFromDraft(invalid, { previous: null, newCredentialId: "provider-invalid" }),
    /workspace|工作区/i,
  );

  for (const prototypeName of ["toString", "__proto__", "constructor", "hasOwnProperty"]) {
    const invalidEnum = {
      ...valid,
      environment: prototypeName,
      dataRegion: prototypeName,
    } as unknown as ApiSetupDraft;
    assert.equal(credentialScopeForDraft(invalidEnum), null);
    assert.throws(
      () => providerConfigFromDraft(invalidEnum, {
        previous: null,
        newCredentialId: `provider-invalid-${prototypeName.replaceAll("_", "x")}`,
      }),
      /环境|区域|environment|region/i,
    );
  }
});

test("enterprise setup requires explicit acknowledgement of irreversible local-photo cleanup", () => {
  const enterpriseDraft = compatibleDraft({
    providerKind: "enterprise",
    protocol: "custom_contract",
    baseUrl: "https://enterprise.example/diet-ai",
    historicalPhotoPurgeAccepted: false,
  });
  assert.throws(
    () => providerConfigFromDraft(enterpriseDraft, {
      previous: null,
      newCredentialId: "provider-enterprise-photo-consent",
    }),
    /explicit consent.*local photos/i,
  );
});

test("enterprise records without workspace identity fail closed", () => {
  const enterpriseDraft = compatibleDraft({
    providerKind: "enterprise",
    protocol: "custom_contract",
    baseUrl: "https://enterprise.example/diet-ai",
  });
  const saved = providerConfigFromDraft(enterpriseDraft, {
    previous: null,
    newCredentialId: "provider-enterprise-corrupt",
  });
  assert.ok(saved.consentReceipt);
  const corrupt: SavedAiConfiguration = {
    ...saved,
    enterpriseWorkspace: null,
    consentReceipt: {
      ...saved.consentReceipt,
      scope: credentialScopeForConfig(saved.config),
    },
  };

  assert.throws(() => credentialScopeForSaved(corrupt), /workspace identity/i);
  assert.doesNotThrow(() => hasCurrentDataTransferConsent(corrupt));
  assert.equal(hasCurrentDataTransferConsent(corrupt), false);
  assert.equal(canReuseSavedCredential(corrupt, enterpriseDraft), false);

  const rebound = providerConfigFromDraft(enterpriseDraft, {
    previous: corrupt,
    newCredentialId: "provider-enterprise-rebound",
  });
  assert.equal(rebound.config.id, "provider-enterprise-rebound");
  assert.ok(rebound.enterpriseWorkspace);
});

test("corrupt or stale persisted enterprise workspace fields fail closed", () => {
  const enterpriseDraft = compatibleDraft({
    providerKind: "enterprise",
    protocol: "custom_contract",
    baseUrl: "https://enterprise.example/diet-ai",
  });
  const saved = providerConfigFromDraft(enterpriseDraft, {
    previous: null,
    newCredentialId: "provider-enterprise-validation",
  });
  assert.ok(saved.enterpriseWorkspace);
  assert.ok(saved.consentReceipt);

  const invalidWorkspaces = [
    { ...saved.enterpriseWorkspace, policyVersion: "old-policy" },
    { ...saved.enterpriseWorkspace, workspaceId: "bad workspace" },
    { ...saved.enterpriseWorkspace, environment: "evil" },
    { ...saved.enterpriseWorkspace, dataRegion: "moon" },
    { ...saved.enterpriseWorkspace, organizationName: "X" },
    { ...saved.enterpriseWorkspace, environment: "toString" },
    { ...saved.enterpriseWorkspace, environment: "__proto__" },
    { ...saved.enterpriseWorkspace, dataRegion: "constructor" },
    { ...saved.enterpriseWorkspace, dataRegion: "hasOwnProperty" },
  ];
  for (const enterpriseWorkspace of invalidWorkspaces) {
    const corrupt: SavedAiConfiguration = {
      ...saved,
      enterpriseWorkspace: enterpriseWorkspace as unknown as EnterpriseWorkspace,
      consentReceipt: {
        ...saved.consentReceipt,
        scope: `${credentialScopeForConfig(saved.config)}|managed|${JSON.stringify(enterpriseWorkspace)}`,
      },
    };
    assert.doesNotThrow(() => hasCurrentDataTransferConsent(corrupt));
    assert.equal(hasCurrentDataTransferConsent(corrupt), false);
    assert.equal(canReuseSavedCredential(corrupt, enterpriseDraft), false);
  }
});

test("legacy global credential slots are never treated as scope-bound", () => {
  const scoped = savedCompatible("provider-scope-a");
  const legacy: SavedAiConfiguration = {
    ...scoped,
    config: { ...scoped.config, id: "primary-ai-provider" },
  };
  const legacyDraft: ApiSetupDraft = {
    ...compatibleDraft(),
    ...savedConfigurationToDraft(legacy),
    apiKey: "",
  };

  assert.equal(hasScopedCredentialId(legacy), false);
  assert.equal(canReuseSavedCredential(legacy, legacyDraft), false);
  assert.equal(draftConsentCoversCredentialScope(legacyDraft), false);

  const rebound = providerConfigFromDraft(compatibleDraft(), {
    previous: legacy,
    newCredentialId: "provider-rebound",
  });
  assert.equal(rebound.config.id, "provider-rebound");
  assert.notEqual(rebound.config.id, legacy.config.id);
});
