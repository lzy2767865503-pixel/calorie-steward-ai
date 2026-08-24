import assert from "node:assert/strict";
import test from "node:test";

import {
  apiSecretLast4,
  assertNonSecretSettingKey,
  assertProviderId,
  maskApiSecret,
  normalizeApiSecret,
} from "./secretPolicy";

test("API secret masking exposes only the final four characters", () => {
  // Keep the fixture visibly synthetic and split so repository scanners do not
  // mistake it for a usable provider credential.
  const secret = ["sk", "proj", "unit-test-not-a-real-secret-9X7Q"].join("-");
  assert.equal(apiSecretLast4(secret), "9X7Q");
  assert.equal(maskApiSecret(secret), "••••9X7Q");
  assert.equal(normalizeApiSecret(`  ${secret}  `), secret);
});

test("provider identifiers are safe SecureStore keys", () => {
  assert.doesNotThrow(() => assertProviderId("openai-compatible.custom-1"));
  assert.throws(() => assertProviderId("provider/with/path"), /providerId/);
});

test("SQLite setting keys reject common secret names", () => {
  assert.doesNotThrow(() => assertNonSecretSettingKey("ai.provider.kind"));
  assert.throws(() => assertNonSecretSettingKey("ai.api_key"), /Secrets/);
  assert.throws(() => assertNonSecretSettingKey("accessToken"), /Secrets/);
});
