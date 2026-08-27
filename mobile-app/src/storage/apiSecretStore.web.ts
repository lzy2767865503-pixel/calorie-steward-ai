import {
  apiSecretLast4,
  assertProviderId,
  maskApiSecret,
  normalizeApiSecret,
} from "./secretPolicy";
import type { ApiSecretStatus } from "./types";
import { desktopBridge } from "../platform/desktopRuntime";

const SECURE_KEY_PREFIX = "diet-steward.api-secret.v1.";

function secureKey(providerId: string): string {
  assertProviderId(providerId);
  return `${SECURE_KEY_PREFIX}${providerId.toLowerCase()}`;
}

function requireBridge() {
  const bridge = desktopBridge();
  if (!bridge) {
    throw new Error(
      "Windows Credential Protection is unavailable; refusing to persist an API secret.",
    );
  }
  return bridge;
}

export async function replaceApiSecret(
  providerId: string,
  secret: string,
): Promise<ApiSecretStatus> {
  const normalized = normalizeApiSecret(secret);
  await requireBridge().secrets.set(secureKey(providerId), normalized);
  return {
    providerId,
    configured: true,
    last4: apiSecretLast4(normalized),
    masked: maskApiSecret(normalized),
  };
}

export async function readApiSecret(providerId: string): Promise<string | null> {
  return requireBridge().secrets.get(secureKey(providerId));
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
  await requireBridge().secrets.delete(secureKey(providerId));
}
