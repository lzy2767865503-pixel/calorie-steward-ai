import * as SecureStore from "expo-secure-store";

import {
  apiSecretLast4,
  assertProviderId,
  maskApiSecret,
  normalizeApiSecret,
} from "./secretPolicy";
import type { ApiSecretStatus } from "./types";

const SECURE_KEY_PREFIX = "diet-steward.api-secret.v1.";
const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainService: "com.dietsteward.mobile.api-secrets",
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

function secureKey(providerId: string): string {
  assertProviderId(providerId);
  return `${SECURE_KEY_PREFIX}${providerId.toLowerCase()}`;
}

async function assertSecureStoreAvailable(): Promise<void> {
  if (!(await SecureStore.isAvailableAsync())) {
    throw new Error("Secure device storage is unavailable; refusing to persist an API secret.");
  }
}

/**
 * Creates or atomically replaces the provider's secret in Keychain/Keystore.
 * SQLite, exports, analytics, and application logs never receive this value.
 */
export async function replaceApiSecret(
  providerId: string,
  secret: string,
): Promise<ApiSecretStatus> {
  await assertSecureStoreAvailable();
  const normalized = normalizeApiSecret(secret);
  await SecureStore.setItemAsync(secureKey(providerId), normalized, SECURE_OPTIONS);
  return {
    providerId,
    configured: true,
    last4: apiSecretLast4(normalized),
    masked: maskApiSecret(normalized),
  };
}

/** Intended only for the request adapter immediately before an HTTPS call. */
export async function readApiSecret(providerId: string): Promise<string | null> {
  await assertSecureStoreAvailable();
  return SecureStore.getItemAsync(secureKey(providerId), SECURE_OPTIONS);
}

export async function getApiSecretStatus(providerId: string): Promise<ApiSecretStatus> {
  const secret = await readApiSecret(providerId);
  return secret
    ? {
        providerId,
        configured: true,
        last4: apiSecretLast4(secret),
        masked: maskApiSecret(secret),
      }
    : {
        providerId,
        configured: false,
        last4: null,
        masked: null,
      };
}

export async function deleteApiSecret(providerId: string): Promise<void> {
  await assertSecureStoreAvailable();
  await SecureStore.deleteItemAsync(secureKey(providerId), SECURE_OPTIONS);
}

