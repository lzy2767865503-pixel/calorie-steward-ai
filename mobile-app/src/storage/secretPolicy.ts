const PROVIDER_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const FORBIDDEN_SETTING_KEY = /(?:secret|password|credential|token|apikey|api_key)/i;

export function assertProviderId(providerId: string): void {
  if (!PROVIDER_ID_PATTERN.test(providerId)) {
    throw new Error("providerId must be 1-64 ASCII letters, digits, dot, underscore, or hyphen.");
  }
}

export function normalizeApiSecret(secret: string): string {
  const normalized = secret.trim();
  if (normalized.length < 4 || normalized.length > 4096) {
    throw new Error("API secret must contain between 4 and 4096 characters.");
  }
  if (/\r|\n|\0/.test(normalized)) {
    throw new Error("API secret must be a single text line.");
  }
  return normalized;
}

export function apiSecretLast4(secret: string): string {
  const normalized = normalizeApiSecret(secret);
  return normalized.slice(-4);
}

export function maskApiSecret(secret: string): string {
  return `••••${apiSecretLast4(secret)}`;
}

export function assertNonSecretSettingKey(key: string): void {
  if (!key.trim() || key.length > 96) {
    throw new Error("Setting key must contain between 1 and 96 characters.");
  }
  if (FORBIDDEN_SETTING_KEY.test(key)) {
    throw new Error("Secrets must be stored with ApiSecretStore, never in SQLite settings.");
  }
}

