import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  ANDROID_APPLICATION_ID,
  ANDROID_RELEASE_MANIFEST_MAX_BYTES,
  ANDROID_RELEASE_MANIFEST_URL,
  ANDROID_UPDATE_SNOOZE_MS,
  androidUpdatePromptCopy,
  createAndroidUpdateSnooze,
  createOrMergeRequiredUpdateGate,
  decideAndroidUpdate,
  higherRequiredUpdate,
  isAndroidUpdateSnoozed,
  isOfficialAndroidDownloadUrl,
  isStrictRfc3339,
  officialAndroidDownloadUrl,
  openOfficialAndroidDownload,
  reconcileRequiredUpdateGate,
  requestAndroidReleaseManifest,
  requiredUpdateFromPersistedGate,
  validateAndroidReleaseManifest,
  validateAndroidRuntimeApplicationInfo,
  validatePersistedRequiredUpdateGate,
  type AndroidRuntimeApplicationInfo,
  type AndroidUpdate,
} from "./nativeUpdate";

const RUNTIME: AndroidRuntimeApplicationInfo = {
  applicationId: ANDROID_APPLICATION_ID,
  version: "1.2.2",
  build: 6,
};
const LATEST_VERSION = "1.2.3";
const DOWNLOAD_URL = officialAndroidDownloadUrl(LATEST_VERSION);

function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    platform: "android",
    applicationId: ANDROID_APPLICATION_ID,
    latestVersion: LATEST_VERSION,
    latestBuild: 7,
    minimumSupportedBuild: 6,
    downloadUrl: DOWNLOAD_URL,
    checksumUrl: `${DOWNLOAD_URL}.sha256`,
    sha256: "a".repeat(64),
    releasedAt: "2026-08-26T09:00:00+08:00",
    notes: { en: "Reliability improvements.", zh: "可靠性改进。" },
    ...overrides,
  };
}

function update(required = false, minimumSupportedBuild = required ? 7 : 6): AndroidUpdate {
  return {
    ...validateAndroidReleaseManifest(manifest({ minimumSupportedBuild })),
    currentVersion: RUNTIME.version,
    currentBuild: RUNTIME.build,
    required,
  };
}

test("runtime identity comes from strict expo-application metadata", () => {
  assert.deepEqual(validateAndroidRuntimeApplicationInfo({
    applicationId: ANDROID_APPLICATION_ID,
    nativeApplicationVersion: "1.2.2",
    nativeBuildVersion: "6",
  }), RUNTIME);
  assert.throws(() => validateAndroidRuntimeApplicationInfo({
    applicationId: "com.example.repacked",
    nativeApplicationVersion: "1.2.2",
    nativeBuildVersion: "6",
  }), /not official/u);
  for (const nativeBuildVersion of [null, "", "0", "06", " 6", "6.0", "9007199254740992"]) {
    assert.throws(() => validateAndroidRuntimeApplicationInfo({
      applicationId: ANDROID_APPLICATION_ID,
      nativeApplicationVersion: "1.2.2",
      nativeBuildVersion,
    }), /build is invalid/u);
  }
});

test("download allowlist accepts only immutable official version-tagged GitHub assets", () => {
  assert.equal(isOfficialAndroidDownloadUrl(DOWNLOAD_URL, LATEST_VERSION), true);
  assert.equal(isOfficialAndroidDownloadUrl(DOWNLOAD_URL, "1.2.4"), false);
  assert.equal(isOfficialAndroidDownloadUrl(DOWNLOAD_URL.replace("https:", "http:")), false);
  assert.equal(isOfficialAndroidDownloadUrl(DOWNLOAD_URL.replace("github.com", "github.com.evil.test")), false);
  assert.equal(isOfficialAndroidDownloadUrl(DOWNLOAD_URL.replace("calorie-steward-ai", "other-repo")), false);
  assert.equal(isOfficialAndroidDownloadUrl(DOWNLOAD_URL.replace("/v1.2.3/", "/v9.9.9/")), false);
  assert.equal(isOfficialAndroidDownloadUrl(`${DOWNLOAD_URL}?token=secret`), false);
  assert.equal(isOfficialAndroidDownloadUrl(
    "https://github.com/lzy2767865503-pixel/calorie-steward-ai/releases/latest/download/calorie-steward-v1.2.3-android-enterprise.apk",
  ), false);
  assert.equal(isOfficialAndroidDownloadUrl(
    "https://kawancampus.com/downloads/calorie-steward-android.apk",
  ), false);
});

test("manifest and notes use exact keys and bind version, tag, filename and checksum", () => {
  assert.equal(validateAndroidReleaseManifest(manifest()).latestBuild, 7);
  assert.throws(() => validateAndroidReleaseManifest(manifest({ extra: true })), /keys/u);
  const missing = manifest();
  delete missing.sha256;
  assert.throws(() => validateAndroidReleaseManifest(missing), /keys/u);
  assert.throws(() => validateAndroidReleaseManifest(manifest({
    notes: { en: "ok", zh: "好", extra: "no" },
  })), /notes.*keys/u);
  assert.throws(() => validateAndroidReleaseManifest(manifest({
    latestVersion: "1.2.4",
  })), /failed validation/u);
  assert.throws(() => validateAndroidReleaseManifest(manifest({
    downloadUrl: DOWNLOAD_URL.replace("/v1.2.3/", "/v9.9.9/"),
  })), /failed validation/u);
  assert.throws(() => validateAndroidReleaseManifest(manifest({
    checksumUrl: "https://example.com/file.sha256",
  })), /failed validation/u);
});

test("releasedAt accepts strict real RFC3339 timestamps only", () => {
  assert.equal(isStrictRfc3339("2026-08-26T09:00:00Z"), true);
  assert.equal(isStrictRfc3339("2026-08-26T09:00:00.123456789+08:00"), true);
  for (const value of [
    "2026-08-26", "2026-08-26 09:00:00Z", "2026-02-30T09:00:00Z",
    "2026-08-26T24:00:00Z", "2026-08-26T09:00:60Z", "2026-08-26T09:00:00",
  ]) assert.equal(isStrictRfc3339(value), false, value);
  assert.throws(() => validateAndroidReleaseManifest(manifest({
    releasedAt: "August 26, 2026",
  })), /failed validation/u);
});

test("update decision uses validated runtime build and distinguishes required updates", () => {
  assert.equal(decideAndroidUpdate(manifest(), RUNTIME)?.required, false);
  assert.equal(decideAndroidUpdate(manifest({ minimumSupportedBuild: 7 }), RUNTIME)?.required, true);
  assert.equal(decideAndroidUpdate(manifest(), { ...RUNTIME, version: "1.2.3", build: 7 }), null);
  assert.throws(() => decideAndroidUpdate(manifest(), {
    ...RUNTIME,
    applicationId: "com.example.other" as typeof ANDROID_APPLICATION_ID,
  }), /not official/u);
});

test("manifest request is credential-free and rejects oversized Content-Length before body read", async () => {
  let requestedUrl = "";
  let requestedInit: RequestInit | undefined;
  const goodFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requestedUrl = String(input);
    requestedInit = init;
    return new Response(JSON.stringify(manifest()), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }) as typeof fetch;
  assert.equal((await requestAndroidReleaseManifest(goodFetch)).latestBuild, 7);
  assert.equal(requestedUrl, ANDROID_RELEASE_MANIFEST_URL);
  assert.equal(requestedInit?.credentials, "omit");
  assert.equal(requestedInit?.cache, "no-store");
  assert.equal("body" in (requestedInit ?? {}), false);

  let bodyRead = false;
  const oversizedResponse = {
    ok: true,
    status: 200,
    headers: new Headers({
      "content-type": "application/json",
      "content-length": String(ANDROID_RELEASE_MANIFEST_MAX_BYTES + 1),
    }),
    body: {
      getReader() {
        bodyRead = true;
        throw new Error("must not read");
      },
    },
  } as unknown as Response;
  const oversizedFetch = (async () => oversizedResponse) as typeof fetch;
  await assert.rejects(() => requestAndroidReleaseManifest(oversizedFetch), /exceeds the size limit/u);
  assert.equal(bodyRead, false);
});

test("manifest byte limit and JSON content type remain enforced without Content-Length", async () => {
  const oversizedFetch = (async () => new Response("界".repeat(ANDROID_RELEASE_MANIFEST_MAX_BYTES), {
    status: 200,
    headers: { "content-type": "application/json" },
  })) as typeof fetch;
  await assert.rejects(() => requestAndroidReleaseManifest(oversizedFetch), /size limit/u);
  const htmlFetch = (async () => new Response("{}", {
    status: 200,
    headers: { "content-type": "text/html" },
  })) as typeof fetch;
  await assert.rejects(() => requestAndroidReleaseManifest(htmlFetch), /content type/u);
});

test("required gate persists the highest seen minimum and survives offline restart", () => {
  const firstRequired = update(true, 7);
  const firstGate = createOrMergeRequiredUpdateGate(undefined, firstRequired, new Date("2026-08-26T00:00:00Z"));
  assert.equal(firstGate.highestSeenMinimumSupportedBuild, 7);
  assert.equal(requiredUpdateFromPersistedGate(firstGate, RUNTIME)?.required, true);

  const lowerManifest = validateAndroidReleaseManifest(manifest({
    latestVersion: "1.2.2",
    latestBuild: 6,
    minimumSupportedBuild: 6,
    downloadUrl: officialAndroidDownloadUrl("1.2.2"),
    checksumUrl: `${officialAndroidDownloadUrl("1.2.2")}.sha256`,
  }));
  const lowerRequired: AndroidUpdate = {
    ...lowerManifest,
    currentVersion: "1.2.1",
    currentBuild: 5,
    required: true,
  };
  assert.deepEqual(createOrMergeRequiredUpdateGate(firstGate, lowerRequired), firstGate);
  assert.equal(higherRequiredUpdate(firstRequired, lowerRequired).latestBuild, firstRequired.latestBuild);
  assert.equal(requiredUpdateFromPersistedGate(firstGate, { ...RUNTIME, version: "1.2.3", build: 7 }), null);
});

test("required gate combines a higher minimum with the highest non-rollback release", () => {
  const highLatestUrl = officialAndroidDownloadUrl("9.9.9");
  const highLatest: AndroidUpdate = {
    ...validateAndroidReleaseManifest(manifest({
      latestVersion: "9.9.9",
      latestBuild: 100,
      minimumSupportedBuild: 7,
      downloadUrl: highLatestUrl,
      checksumUrl: `${highLatestUrl}.sha256`,
    })),
    currentVersion: RUNTIME.version,
    currentBuild: RUNTIME.build,
    required: true,
  };
  const existing = createOrMergeRequiredUpdateGate(undefined, highLatest);
  const higherMinimumUrl = officialAndroidDownloadUrl("1.2.4");
  const higherMinimumLowerLatest: AndroidUpdate = {
    ...validateAndroidReleaseManifest(manifest({
      latestVersion: "1.2.4",
      latestBuild: 8,
      minimumSupportedBuild: 8,
      downloadUrl: higherMinimumUrl,
      checksumUrl: `${higherMinimumUrl}.sha256`,
    })),
    currentVersion: RUNTIME.version,
    currentBuild: RUNTIME.build,
    required: true,
  };
  const merged = createOrMergeRequiredUpdateGate(existing, higherMinimumLowerLatest);
  assert.equal(merged.highestSeenMinimumSupportedBuild, 8);
  assert.equal(merged.manifest.latestBuild, 100);
  assert.equal(merged.manifest.downloadUrl, highLatestUrl);
  assert.equal(requiredUpdateFromPersistedGate(merged, RUNTIME)?.minimumSupportedBuild, 8);
  const inMemory = higherRequiredUpdate(highLatest, higherMinimumLowerLatest);
  assert.equal(inMemory.minimumSupportedBuild, 8);
  assert.equal(inMemory.latestBuild, 100);
  assert.equal(inMemory.downloadUrl, highLatestUrl);
});

test("failed persistence cannot let an old satisfied disk gate clear a higher in-memory gate", () => {
  const oldUrl = officialAndroidDownloadUrl("1.2.2");
  const oldRequired: AndroidUpdate = {
    ...validateAndroidReleaseManifest(manifest({
      latestVersion: "1.2.2",
      latestBuild: 6,
      minimumSupportedBuild: 6,
      downloadUrl: oldUrl,
      checksumUrl: `${oldUrl}.sha256`,
    })),
    currentVersion: "1.2.1",
    currentBuild: 5,
    required: true,
  };
  const oldPersistedGate = createOrMergeRequiredUpdateGate(undefined, oldRequired);
  const newUrl = officialAndroidDownloadUrl("1.2.4");
  const newMemoryRequired: AndroidUpdate = {
    ...validateAndroidReleaseManifest(manifest({
      latestVersion: "1.2.4",
      latestBuild: 8,
      minimumSupportedBuild: 8,
      downloadUrl: newUrl,
      checksumUrl: `${newUrl}.sha256`,
    })),
    currentVersion: RUNTIME.version,
    currentBuild: RUNTIME.build,
    required: true,
  };

  const firstAttempt = reconcileRequiredUpdateGate(
    oldPersistedGate,
    newMemoryRequired,
    RUNTIME,
  );
  assert.equal(firstAttempt.effectiveUpdate?.minimumSupportedBuild, 8);
  assert.equal(firstAttempt.effectiveUpdate?.latestBuild, 8);
  assert.equal(firstAttempt.mustPersist, true);
  assert.equal(firstAttempt.gateToPersist?.highestSeenMinimumSupportedBuild, 8);

  // Simulate setSetting failure: disk remains old, while the in-memory overlay
  // retains firstAttempt.effectiveUpdate. A retry followed by network failure
  // must still reconcile to the higher in-memory gate before any fetch result.
  const retryBeforeOfflineFetch = reconcileRequiredUpdateGate(
    oldPersistedGate,
    firstAttempt.effectiveUpdate,
    RUNTIME,
  );
  assert.equal(retryBeforeOfflineFetch.effectiveUpdate?.required, true);
  assert.equal(retryBeforeOfflineFetch.effectiveUpdate?.minimumSupportedBuild, 8);
  assert.equal(retryBeforeOfflineFetch.mustPersist, true);
  assert.equal(retryBeforeOfflineFetch.shouldDeletePersisted, false);
});

test("persisted required gate rejects corrupt or expanded records", () => {
  const gate = createOrMergeRequiredUpdateGate(undefined, update(true));
  assert.equal(validatePersistedRequiredUpdateGate(gate).highestSeenMinimumSupportedBuild, 7);
  assert.throws(() => validatePersistedRequiredUpdateGate({ ...gate, bypass: true }), /keys/u);
  assert.throws(() => validatePersistedRequiredUpdateGate({
    ...gate,
    highestSeenMinimumSupportedBuild: 6,
  }), /Invalid persisted/u);
});

test("optional snooze expires while required updates ignore it", () => {
  const now = new Date("2026-08-26T00:00:00Z");
  const optional = update(false);
  const snooze = createAndroidUpdateSnooze(optional, now);
  assert.equal(Date.parse(snooze.untilUtc) - now.getTime(), ANDROID_UPDATE_SNOOZE_MS);
  assert.equal(isAndroidUpdateSnoozed(optional, snooze, now), true);
  assert.equal(isAndroidUpdateSnoozed(optional, snooze, new Date(now.getTime() + ANDROID_UPDATE_SNOOZE_MS)), false);
  assert.equal(isAndroidUpdateSnoozed(update(true), snooze, now), false);
});

test("bilingual copy states the privacy boundary without claiming APK-byte verification", () => {
  const zh = androidUpdatePromptCopy("zh", update(true));
  assert.match(zh.title, /必须更新卡路里管家/u);
  assert.match(zh.message, /不会发送照片、饮食记录、个人资料或 API 凭据/u);
  assert.doesNotMatch(zh.message, /校验.*APK|SHA/u);
  const en = androidUpdatePromptCopy("en", update(false));
  assert.match(en.message, /never sends photos, diet records, profile data, or API credentials/u);
  assert.doesNotMatch(en.message, /verif(?:y|ies).*APK|SHA/iu);
});

test("external opener revalidates immutable version before invoking Linking", async () => {
  const opened: string[] = [];
  const open = async (url: string) => { opened.push(url); };
  await openOfficialAndroidDownload(DOWNLOAD_URL, LATEST_VERSION, open);
  assert.deepEqual(opened, [DOWNLOAD_URL]);
  await assert.rejects(
    () => openOfficialAndroidDownload(DOWNLOAD_URL, "1.2.4", open),
    /untrusted/u,
  );
  assert.deepEqual(opened, [DOWNLOAD_URL]);
});

test("source gate keeps runtime identity, foreground checks and blocking Modal wired above screens", () => {
  const appSource = readFileSync(resolve(process.cwd(), "App.tsx"), "utf8");
  const overlaySource = readFileSync(
    resolve(process.cwd(), "src/ui/NativeUpdateOverlay.tsx"),
    "utf8",
  );
  for (const field of [
    "Application.applicationId",
    "Application.nativeApplicationVersion",
    "Application.nativeBuildVersion",
  ]) assert.match(appSource, new RegExp(field.replaceAll(".", "\\."), "u"));
  assert.match(appSource, /AppState\.addEventListener\("change"/u);
  assert.match(appSource, /nextAppState === "active"/u);
  assert.match(appSource, /getSetting<unknown>\(ANDROID_REQUIRED_UPDATE_GATE_SETTING_KEY\)/u);
  assert.match(
    appSource,
    /setSetting\(\s*ANDROID_REQUIRED_UPDATE_GATE_SETTING_KEY,\s*reconciliation\.gateToPersist/gu,
  );
  assert.match(
    appSource,
    /reconcileRequiredUpdateGate\(\s*stored\?\.value,\s*requiredAndroidUpdateRef\.current/gu,
  );
  assert.ok(
    appSource.lastIndexOf("<NativeUpdateOverlay") > appSource.lastIndexOf("<SettingsScreen"),
    "native update overlay must render after app screens",
  );
  const openHandler = appSource.slice(
    appSource.indexOf("const openAndroidUpdate"),
    appSource.indexOf("const remindAndroidUpdateLater"),
  );
  assert.match(openHandler, /\.catch\(\(\) => \{/u);
  assert.match(openHandler, /setAndroidUpdateActionError/u);
  assert.doesNotMatch(openHandler, /setRequiredAndroidUpdate\(null\)/u);
  assert.match(overlaySource, /<Modal/u);
  assert.match(overlaySource, /presentationStyle="fullScreen"/u);
  assert.match(overlaySource, /onRequestClose=\{blocking \? \(\) => undefined/u);
  assert.match(overlaySource, /gateFailure !== null \|\| update\?\.required === true/u);
});
