export const ANDROID_APPLICATION_ID = "com.laisystems.dietsteward";
export const ANDROID_RELEASE_MANIFEST_URL =
  "https://kawancampus.com/downloads/calorie-steward-android-release.json";
export const ANDROID_UPDATE_SNOOZE_SETTING_KEY = "app.android-update-snooze.v1";
export const ANDROID_REQUIRED_UPDATE_GATE_SETTING_KEY = "app.android-required-update-gate.v1";
export const ANDROID_UPDATE_SNOOZE_MS = 6 * 60 * 60 * 1000;
export const ANDROID_RELEASE_MANIFEST_MAX_BYTES = 32 * 1024;

const MAX_RELEASE_NOTE_CHARACTERS = 2_000;
const MANIFEST_TIMEOUT_MS = 10_000;
const GITHUB_OWNER = "lzy2767865503-pixel";
const GITHUB_REPOSITORY = "calorie-steward-ai";
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const POSITIVE_INTEGER_STRING_PATTERN = /^[1-9]\d*$/u;
const RFC3339_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-](\d{2}):(\d{2}))$/u;
const MANIFEST_KEYS = [
  "applicationId", "checksumUrl", "downloadUrl", "latestBuild", "latestVersion",
  "minimumSupportedBuild", "notes", "platform", "releasedAt", "schemaVersion", "sha256",
] as const;
const NOTE_KEYS = ["en", "zh"] as const;
const PERSISTED_GATE_KEYS = [
  "highestSeenMinimumSupportedBuild", "manifest", "recordedAtUtc", "schemaVersion",
] as const;
const SNOOZE_KEYS = ["latestBuild", "schemaVersion", "untilUtc"] as const;

// This is an APK discovery channel, not remote code execution. Only an APK
// that already contains this checker can discover later signed releases.

export type AndroidRuntimeApplicationInfo = {
  applicationId: typeof ANDROID_APPLICATION_ID;
  version: string;
  build: number;
};

export type NativeApplicationMetadata = {
  applicationId: string | null;
  nativeApplicationVersion: string | null;
  nativeBuildVersion: string | null;
};

export type AndroidReleaseManifest = {
  schemaVersion: 1;
  platform: "android";
  applicationId: typeof ANDROID_APPLICATION_ID;
  latestVersion: string;
  latestBuild: number;
  minimumSupportedBuild: number;
  downloadUrl: string;
  checksumUrl: string;
  sha256: string;
  releasedAt: string;
  notes: { en: string; zh: string };
};

export type AndroidUpdate = AndroidReleaseManifest & {
  currentVersion: string;
  currentBuild: number;
  required: boolean;
};

export type AndroidUpdateSnooze = {
  schemaVersion: 1;
  latestBuild: number;
  untilUtc: string;
};

export type PersistedRequiredUpdateGate = {
  schemaVersion: 1;
  highestSeenMinimumSupportedBuild: number;
  manifest: AndroidReleaseManifest;
  recordedAtUtc: string;
};

export type RequiredUpdateGateReconciliation = {
  effectiveUpdate: AndroidUpdate | null;
  gateToPersist: PersistedRequiredUpdateGate | null;
  mustPersist: boolean;
  shouldDeletePersisted: boolean;
};

export type AndroidUpdatePromptCopy = {
  title: string;
  message: string;
  updateNow: string;
  remindLater: string;
  retry: string;
  openFailedMessage: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index]);
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`Invalid Android release field: ${field}`);
  }
  return value as number;
}

export function isStrictRfc3339(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = value.match(RFC3339_PATTERN);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[8] === "Z" ? 0 : Number(match[9]);
  const offsetMinute = match[8] === "Z" ? 0 : Number(match[10]);
  if (
    year < 1 || month < 1 || month > 12 || day < 1 ||
    day > new Date(Date.UTC(year, month, 0)).getUTCDate() ||
    hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59
  ) {
    return false;
  }
  return Number.isFinite(Date.parse(value));
}

export function validateAndroidRuntimeApplicationInfo(
  value: NativeApplicationMetadata,
): AndroidRuntimeApplicationInfo {
  if (value.applicationId !== ANDROID_APPLICATION_ID) {
    throw new Error("The installed Android application id is not official");
  }
  if (typeof value.nativeApplicationVersion !== "string" || !SEMVER_PATTERN.test(value.nativeApplicationVersion)) {
    throw new Error("The installed Android version is invalid");
  }
  if (typeof value.nativeBuildVersion !== "string" || !POSITIVE_INTEGER_STRING_PATTERN.test(value.nativeBuildVersion)) {
    throw new Error("The installed Android build is invalid");
  }
  const build = Number(value.nativeBuildVersion);
  if (!Number.isSafeInteger(build)) throw new Error("The installed Android build is invalid");
  return {
    applicationId: ANDROID_APPLICATION_ID,
    version: value.nativeApplicationVersion,
    build,
  };
}

function strictHttpsUrl(value: unknown): URL | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" || url.username !== "" || url.password !== "" ||
      url.port !== "" || url.search !== "" || url.hash !== ""
    ) return null;
    return url;
  } catch {
    return null;
  }
}

export function officialAndroidDownloadUrl(version: string): string {
  if (!SEMVER_PATTERN.test(version)) throw new Error("Invalid Android release version");
  return `https://github.com/${GITHUB_OWNER}/${GITHUB_REPOSITORY}/releases/download/v${version}/calorie-steward-v${version}-android-enterprise.apk`;
}

export function isOfficialAndroidDownloadUrl(value: unknown, expectedVersion?: string): value is string {
  const url = strictHttpsUrl(value);
  if (!url || url.hostname !== "github.com") return false;
  const match = url.pathname.match(
    /^\/lzy2767865503-pixel\/calorie-steward-ai\/releases\/download\/v(\d+\.\d+\.\d+)\/calorie-steward-v(\d+\.\d+\.\d+)-android-enterprise\.apk$/u,
  );
  if (!match || match[1] !== match[2]) return false;
  return expectedVersion === undefined || match[1] === expectedVersion;
}

function releaseNote(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`Invalid Android release field: ${field}`);
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_RELEASE_NOTE_CHARACTERS) {
    throw new Error(`Invalid Android release field: ${field}`);
  }
  return normalized;
}

export function validateAndroidReleaseManifest(value: unknown): AndroidReleaseManifest {
  if (!isRecord(value) || !hasExactKeys(value, MANIFEST_KEYS)) {
    throw new Error("Invalid Android release manifest keys");
  }
  const candidate = value;
  const latestBuild = positiveInteger(candidate.latestBuild, "latestBuild");
  const minimumSupportedBuild = positiveInteger(candidate.minimumSupportedBuild, "minimumSupportedBuild");
  if (minimumSupportedBuild > latestBuild) {
    throw new Error("Android minimum build cannot exceed latest build");
  }
  if (
    candidate.schemaVersion !== 1 || candidate.platform !== "android" ||
    candidate.applicationId !== ANDROID_APPLICATION_ID ||
    typeof candidate.latestVersion !== "string" || !SEMVER_PATTERN.test(candidate.latestVersion) ||
    !isOfficialAndroidDownloadUrl(candidate.downloadUrl, candidate.latestVersion) ||
    candidate.downloadUrl !== officialAndroidDownloadUrl(candidate.latestVersion) ||
    candidate.checksumUrl !== `${candidate.downloadUrl}.sha256` ||
    typeof candidate.sha256 !== "string" || !SHA256_PATTERN.test(candidate.sha256) ||
    !isStrictRfc3339(candidate.releasedAt)
  ) {
    throw new Error("Android release manifest failed validation");
  }
  if (!isRecord(candidate.notes) || !hasExactKeys(candidate.notes, NOTE_KEYS)) {
    throw new Error("Android release notes have invalid keys");
  }
  return {
    schemaVersion: 1,
    platform: "android",
    applicationId: ANDROID_APPLICATION_ID,
    latestVersion: candidate.latestVersion,
    latestBuild,
    minimumSupportedBuild,
    downloadUrl: candidate.downloadUrl,
    checksumUrl: candidate.checksumUrl as string,
    sha256: candidate.sha256,
    releasedAt: candidate.releasedAt,
    notes: {
      en: releaseNote(candidate.notes.en, "notes.en"),
      zh: releaseNote(candidate.notes.zh, "notes.zh"),
    },
  };
}

export function decideAndroidUpdate(
  manifestValue: unknown,
  runtime: AndroidRuntimeApplicationInfo,
): AndroidUpdate | null {
  if (runtime.applicationId !== ANDROID_APPLICATION_ID) {
    throw new Error("The installed Android application id is not official");
  }
  const installedBuild = positiveInteger(runtime.build, "currentBuild");
  const manifest = validateAndroidReleaseManifest(manifestValue);
  if (installedBuild >= manifest.latestBuild) return null;
  return {
    ...manifest,
    currentVersion: runtime.version,
    currentBuild: installedBuild,
    required: installedBuild < manifest.minimumSupportedBuild,
  };
}

function contentLength(response: Response): number | null {
  const raw = response.headers.get("content-length");
  if (raw === null) return null;
  if (!/^(?:0|[1-9]\d*)$/u.test(raw)) {
    throw new Error("Android release manifest has an invalid Content-Length");
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error("Android release manifest has an invalid Content-Length");
  }
  return parsed;
}

async function boundedManifestText(response: Response): Promise<string> {
  const declaredLength = contentLength(response);
  if (declaredLength !== null && declaredLength > ANDROID_RELEASE_MANIFEST_MAX_BYTES) {
    throw new Error("Android release manifest exceeds the size limit");
  }
  const body = response.body;
  if (body !== null && typeof body.getReader === "function") {
    const reader = body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let byteLength = 0;
    let text = "";
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        byteLength += chunk.value.byteLength;
        if (byteLength > ANDROID_RELEASE_MANIFEST_MAX_BYTES) {
          try {
            await reader.cancel("manifest size limit exceeded");
          } catch {
            // The authoritative size error is preserved if cancellation fails.
          }
          throw new Error("Android release manifest exceeds the size limit");
        }
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
      return text;
    } finally {
      reader.releaseLock();
    }
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > ANDROID_RELEASE_MANIFEST_MAX_BYTES) {
    throw new Error("Android release manifest exceeds the size limit");
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export async function requestAndroidReleaseManifest(fetchImpl: typeof fetch = fetch): Promise<AndroidReleaseManifest> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MANIFEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(ANDROID_RELEASE_MANIFEST_URL, {
      method: "GET",
      headers: { Accept: "application/json", "Cache-Control": "no-cache" },
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Android release check failed (${response.status})`);
    const contentType = response.headers.get("content-type") ?? "";
    if (!/^application\/(?:[a-z0-9.+-]*\+)?json(?:\s*;|$)/iu.test(contentType)) {
      throw new Error("Android release manifest has an invalid content type");
    }
    const text = await boundedManifestText(response);
    if (!text) throw new Error("Android release manifest is empty");
    return validateAndroidReleaseManifest(JSON.parse(text) as unknown);
  } finally {
    clearTimeout(timeout);
  }
}

export async function checkForAndroidUpdate(
  runtime: AndroidRuntimeApplicationInfo,
  fetchImpl: typeof fetch = fetch,
): Promise<AndroidUpdate | null> {
  return decideAndroidUpdate(await requestAndroidReleaseManifest(fetchImpl), runtime);
}

export function createAndroidUpdateSnooze(update: AndroidUpdate, now = new Date()): AndroidUpdateSnooze {
  return {
    schemaVersion: 1,
    latestBuild: update.latestBuild,
    untilUtc: new Date(now.getTime() + ANDROID_UPDATE_SNOOZE_MS).toISOString(),
  };
}

export function isAndroidUpdateSnoozed(update: AndroidUpdate, value: unknown, now = new Date()): boolean {
  if (
    update.required || !isRecord(value) || !hasExactKeys(value, SNOOZE_KEYS) ||
    value.schemaVersion !== 1 || value.latestBuild !== update.latestBuild || !isStrictRfc3339(value.untilUtc)
  ) return false;
  return Date.parse(value.untilUtc) > now.getTime();
}

export function validatePersistedRequiredUpdateGate(value: unknown): PersistedRequiredUpdateGate {
  if (!isRecord(value) || !hasExactKeys(value, PERSISTED_GATE_KEYS)) {
    throw new Error("Invalid persisted Android required-update gate keys");
  }
  const manifest = validateAndroidReleaseManifest(value.manifest);
  const highestSeenMinimumSupportedBuild = positiveInteger(
    value.highestSeenMinimumSupportedBuild,
    "highestSeenMinimumSupportedBuild",
  );
  if (
    value.schemaVersion !== 1 ||
    highestSeenMinimumSupportedBuild < manifest.minimumSupportedBuild ||
    highestSeenMinimumSupportedBuild > manifest.latestBuild ||
    !isStrictRfc3339(value.recordedAtUtc)
  ) {
    throw new Error("Invalid persisted Android required-update gate");
  }
  return {
    schemaVersion: 1,
    highestSeenMinimumSupportedBuild,
    manifest,
    recordedAtUtc: value.recordedAtUtc,
  };
}

function manifestFromUpdate(update: AndroidUpdate): AndroidReleaseManifest {
  return validateAndroidReleaseManifest({
    schemaVersion: update.schemaVersion,
    platform: update.platform,
    applicationId: update.applicationId,
    latestVersion: update.latestVersion,
    latestBuild: update.latestBuild,
    minimumSupportedBuild: update.minimumSupportedBuild,
    downloadUrl: update.downloadUrl,
    checksumUrl: update.checksumUrl,
    sha256: update.sha256,
    releasedAt: update.releasedAt,
    notes: update.notes,
  });
}

export function createOrMergeRequiredUpdateGate(
  existingValue: unknown,
  update: AndroidUpdate,
  now = new Date(),
): PersistedRequiredUpdateGate {
  if (!update.required || update.currentBuild >= update.minimumSupportedBuild) {
    throw new Error("Only a required Android update can create the persistent gate");
  }
  const candidateManifest = manifestFromUpdate(update);
  if (existingValue !== undefined && existingValue !== null) {
    const existing = validatePersistedRequiredUpdateGate(existingValue);
    const highestSeenMinimumSupportedBuild = Math.max(
      existing.highestSeenMinimumSupportedBuild,
      candidateManifest.minimumSupportedBuild,
    );
    const selectedManifest = existing.manifest.latestBuild >= candidateManifest.latestBuild
      ? existing.manifest
      : candidateManifest;
    if (selectedManifest.latestBuild < highestSeenMinimumSupportedBuild) {
      throw new Error("Required-update gate has no release satisfying the highest minimum build");
    }
    if (
      highestSeenMinimumSupportedBuild === existing.highestSeenMinimumSupportedBuild &&
      selectedManifest.latestBuild === existing.manifest.latestBuild
    ) {
      return existing;
    }
    return {
      schemaVersion: 1,
      highestSeenMinimumSupportedBuild,
      manifest: selectedManifest,
      recordedAtUtc: now.toISOString(),
    };
  }
  return {
    schemaVersion: 1,
    highestSeenMinimumSupportedBuild: candidateManifest.minimumSupportedBuild,
    manifest: candidateManifest,
    recordedAtUtc: now.toISOString(),
  };
}

export function requiredUpdateFromPersistedGate(
  value: unknown,
  runtime: AndroidRuntimeApplicationInfo,
): AndroidUpdate | null {
  const gate = validatePersistedRequiredUpdateGate(value);
  if (runtime.build >= gate.highestSeenMinimumSupportedBuild) return null;
  return {
    ...gate.manifest,
    minimumSupportedBuild: gate.highestSeenMinimumSupportedBuild,
    currentVersion: runtime.version,
    currentBuild: runtime.build,
    required: true,
  };
}

export function higherRequiredUpdate(current: AndroidUpdate | null, candidate: AndroidUpdate): AndroidUpdate {
  if (!candidate.required) throw new Error("Candidate update is not required");
  if (!current) return candidate;
  const highestMinimumSupportedBuild = Math.max(
    current.minimumSupportedBuild,
    candidate.minimumSupportedBuild,
  );
  const selectedRelease = current.latestBuild >= candidate.latestBuild ? current : candidate;
  if (selectedRelease.latestBuild < highestMinimumSupportedBuild) {
    throw new Error("Required update has no release satisfying the highest minimum build");
  }
  return {
    ...selectedRelease,
    minimumSupportedBuild: highestMinimumSupportedBuild,
    currentVersion: candidate.currentVersion,
    currentBuild: candidate.currentBuild,
    required: true,
  };
}

export function reconcileRequiredUpdateGate(
  persistedValue: unknown,
  inMemoryUpdate: AndroidUpdate | null,
  runtime: AndroidRuntimeApplicationInfo,
  now = new Date(),
): RequiredUpdateGateReconciliation {
  if (
    inMemoryUpdate &&
    (!inMemoryUpdate.required ||
      inMemoryUpdate.currentBuild !== runtime.build ||
      inMemoryUpdate.currentVersion !== runtime.version)
  ) {
    throw new Error("In-memory required update does not match the installed runtime");
  }
  const hasPersisted = persistedValue !== undefined && persistedValue !== null;
  const persistedGate = hasPersisted
    ? validatePersistedRequiredUpdateGate(persistedValue)
    : null;
  const persistedUpdate = persistedGate
    ? requiredUpdateFromPersistedGate(persistedGate, runtime)
    : null;
  let effectiveUpdate = inMemoryUpdate;
  if (persistedUpdate) effectiveUpdate = higherRequiredUpdate(effectiveUpdate, persistedUpdate);
  if (!effectiveUpdate) {
    return {
      effectiveUpdate: null,
      gateToPersist: null,
      mustPersist: false,
      shouldDeletePersisted: hasPersisted,
    };
  }
  const gateToPersist = createOrMergeRequiredUpdateGate(
    persistedGate,
    effectiveUpdate,
    now,
  );
  const canonicalUpdate = requiredUpdateFromPersistedGate(gateToPersist, runtime);
  if (!canonicalUpdate) {
    throw new Error("Reconciled required update unexpectedly satisfies the installed runtime");
  }
  effectiveUpdate = higherRequiredUpdate(effectiveUpdate, canonicalUpdate);
  return {
    effectiveUpdate,
    gateToPersist,
    mustPersist: !persistedGate || JSON.stringify(persistedGate) !== JSON.stringify(gateToPersist),
    shouldDeletePersisted: false,
  };
}

export function androidUpdatePromptCopy(language: "zh" | "en", update: AndroidUpdate): AndroidUpdatePromptCopy {
  const versionLine = language === "zh"
    ? `当前：${update.currentVersion}（Build ${update.currentBuild}）\n最新：${update.latestVersion}（Build ${update.latestBuild}）`
    : `Current: ${update.currentVersion} (Build ${update.currentBuild})\nLatest: ${update.latestVersion} (Build ${update.latestBuild})`;
  const privacyLine = language === "zh"
    ? "更新检查只读取 Kawan Campus 的公开版本清单，不会发送照片、饮食记录、个人资料或 API 凭据。"
    : "The update check only reads Kawan Campus's public release manifest. It never sends photos, diet records, profile data, or API credentials.";
  if (language === "zh") {
    return {
      title: update.required ? "必须更新卡路里管家" : "卡路里管家有新版本",
      message: `${update.required ? "当前版本已低于安全支持范围，请更新后继续使用。" : "新版本已经准备好，可获得最新修复与改进。"}\n\n${versionLine}\n\n本次更新：${update.notes.zh}\n\n${privacyLine}`,
      updateNow: "立即更新",
      remindLater: "6 小时后提醒",
      retry: "重新检查",
      openFailedMessage: "无法打开官方更新地址，请检查网络后重试。",
    };
  }
  return {
    title: update.required ? "Calorie Steward update required" : "Calorie Steward update available",
    message: `${update.required ? "This version is below the supported security level. Update to continue." : "A new version is ready with the latest fixes and improvements."}\n\n${versionLine}\n\nWhat's new: ${update.notes.en}\n\n${privacyLine}`,
    updateNow: "Update now",
    remindLater: "Remind me in 6 hours",
    retry: "Check again",
    openFailedMessage: "The official update address could not be opened. Check your connection and try again.",
  };
}

export async function openOfficialAndroidDownload(
  value: unknown,
  expectedVersion: string,
  openUrl: (url: string) => Promise<unknown>,
): Promise<void> {
  if (!isOfficialAndroidDownloadUrl(value, expectedVersion)) {
    throw new Error("Refusing to open an untrusted Android package URL");
  }
  // The app validates the release record and URL only. The external browser
  // owns the download, so this code never claims to verify downloaded bytes.
  await openUrl(value);
}
