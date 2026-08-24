import assert from "node:assert/strict";
import test from "node:test";

import type { SavedAiConfiguration } from "./providerConfig";
import {
  EnterpriseTransitionPendingError,
  createPendingEnterpriseTransition,
  executeEnterpriseTransition,
  recoverTransitionTargetProviderId,
  resumeEnterpriseTransition,
} from "./providerTransitionLifecycle";

const target = {
  setupProviderKind: "enterprise",
  verifiedAt: null,
  enterpriseWorkspace: null,
  config: { id: "provider-enterprise-target" },
} as unknown as SavedAiConfiguration;

test("settings commit failure leaves a journal and restart completes transition", async () => {
  let journalPersisted = false;
  let historicalPhotosPresent = true;
  let activeConfiguration = "personal";
  await assert.rejects(
    executeEnterpriseTransition({
      persistJournal: async () => { journalPersisted = true; },
      purgeAndVerifyHistoricalPhotos: async () => { historicalPhotosPresent = false; },
      commitConfigurationAndClearJournal: async () => { throw new Error("injected setSetting failure"); },
    }),
    EnterpriseTransitionPendingError,
  );
  assert.equal(historicalPhotosPresent, false);
  assert.equal(activeConfiguration, "personal");
  assert.equal(journalPersisted, true);

  await resumeEnterpriseTransition({
    purgeAndVerifyHistoricalPhotos: async () => { historicalPhotosPresent = false; },
    commitConfigurationAndClearJournal: async () => {
      activeConfiguration = "enterprise";
      journalPersisted = false;
    },
  });
  assert.equal(activeConfiguration, "enterprise");
  assert.equal(journalPersisted, false);
});

test("journal persistence failure occurs before irreversible photo cleanup", async () => {
  let cleanupCalled = false;
  await assert.rejects(
    executeEnterpriseTransition({
      persistJournal: async () => { throw new Error("injected journal write failure"); },
      purgeAndVerifyHistoricalPhotos: async () => { cleanupCalled = true; },
      commitConfigurationAndClearJournal: async () => undefined,
    }),
    /journal write failure/,
  );
  assert.equal(cleanupCalled, false);
});

test("enterprise journal contains identifiers and configuration but no secret", () => {
  const journal = createPendingEnterpriseTransition({
    targetConfiguration: target,
    previousProviderId: "provider-personal-old",
    startedAtUtc: "2026-08-24T10:00:00.000Z",
  });
  assert.equal(journal.targetConfiguration.config.id, "provider-enterprise-target");
  assert.doesNotMatch(JSON.stringify(journal), /api[_-]?key|workspace-token-value|secret/i);
});

test("a malformed journal can recover only a safe target id for cleanup", () => {
  assert.equal(
    recoverTransitionTargetProviderId({ targetConfiguration: { config: { id: "provider-safe-orphan" } } }),
    "provider-safe-orphan",
  );
  assert.equal(
    recoverTransitionTargetProviderId({ targetConfiguration: { config: { id: "../unsafe" } } }),
    null,
  );
});
