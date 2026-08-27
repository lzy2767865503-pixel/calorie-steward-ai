"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");
const repositoryRoot = path.resolve(projectRoot, "..");
const metadata = require("../package.json");
const config = require("../electron-builder.config.cjs");
const afterPack = require("../scripts/after-pack.cjs");
const { FuseV1Options } = require("@electron/fuses");

test("desktop bridge and package metadata use the same release version", () => {
  const preload = fs.readFileSync(path.join(projectRoot, "electron", "preload.cjs"), "utf8");
  assert.match(preload, new RegExp(`version: [\"']${metadata.version.replaceAll(".", "\\.")}[\"']`));
});

test("Windows package config is hardened and Store identity is injected", () => {
  assert.equal(metadata.author.name, "LAI ZEYU (来泽宇)");
  assert.match(config.copyright, /LAI ZEYU \(来泽宇\)/);
  assert.match(config.win.legalTrademarks, /LAI ZEYU \(来泽宇\)/);
  assert.equal(config.asar, true);
  assert.equal(config.win.icon, "build/icon.ico");
  assert.deepEqual(config.win.target, ["nsis", "zip"]);
  assert.equal(config.appx.applicationId, "CalorieSteward");
  assert.equal(config.appx.publisherDisplayName, "LAI ZEYU");
  assert.deepEqual(config.appx.languages, ["en-US", "zh-CN"]);
  assert.deepEqual(config.electronLanguages, ["en-US", "zh-CN"]);
  assert.deepEqual(
    config.extraResources.map((entry) => entry.to),
    ["legal/LICENSE", "legal/NOTICE", "legal/THIRD_PARTY_NOTICES.md"],
  );
  assert.equal(config.afterPack, "./scripts/after-pack.cjs");
  assert.equal(afterPack.fuseConfiguration.strictlyRequireAllFuses, true);
  assert.equal(
    afterPack.fuseConfiguration[FuseV1Options.LoadBrowserProcessSpecificV8Snapshot],
    false,
  );
});

test("Store packaging fails closed without Partner Center identity", () => {
  const result = spawnSync(
    process.execPath,
    ["-e", "require('./electron-builder.config.cjs')"],
    {
      cwd: projectRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        CALORIE_STORE_BUILD: "1",
        WINDOWS_IDENTITY_NAME: "",
        WINDOWS_PUBLISHER: "",
      },
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /requires WINDOWS_IDENTITY_NAME and WINDOWS_PUBLISHER/);
});

test("Store packaging rejects development identity and the wrong technical publisher", () => {
  const result = spawnSync(
    process.execPath,
    ["-e", "require('./electron-builder.config.cjs')"],
    {
      cwd: projectRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        CALORIE_STORE_BUILD: "1",
        WINDOWS_IDENTITY_NAME: "LAIZEYU.CalorieStewardWindowsDevelopment",
        WINDOWS_PUBLISHER: "CN=LAI ZEYU",
      },
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /reserved production IdentityName/);
});

test("Store packaging accepts only the reserved Calorie Steward identity", () => {
  const result = spawnSync(
    process.execPath,
    ["-e", "const c=require('./electron-builder.config.cjs');process.stdout.write(c.appx.identityName)"],
    {
      cwd: projectRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        CALORIE_STORE_BUILD: "1",
        WINDOWS_IDENTITY_NAME: "LAIZEYU.CalorieStewardbyLAIZEYU",
        WINDOWS_PUBLISHER: "CN=A5F91D0A-30C6-48EE-944F-B767FA872BE8",
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "LAIZEYU.CalorieStewardbyLAIZEYU");
});

test("trusted GitHub packaging delegates every PE signature to the pinned eSigner hook", () => {
  const result = spawnSync(
    process.execPath,
    [
      "-e",
      "const c=require('./electron-builder.config.cjs');process.stdout.write(JSON.stringify({force:c.forceCodeSigning,exts:c.win.signExts,tool:c.win.signtoolOptions,store:c.appx.publisherDisplayName}))",
    ],
    {
      cwd: projectRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        CALORIE_STORE_BUILD: "0",
        CALORIE_TRUSTED_GITHUB_BUILD: "1",
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const trusted = JSON.parse(result.stdout);
  assert.equal(trusted.force, true);
  assert.deepEqual(trusted.exts, [".dll", ".node"]);
  assert.deepEqual(trusted.tool.signingHashAlgorithms, ["sha256"]);
  assert.deepEqual(trusted.tool.publisherName, ["LAI ZEYU", "来泽宇"]);
  assert.match(trusted.tool.sign, /esigner-sign\.cjs$/);
  assert.equal(trusted.store, "LAI ZEYU");
});

test("public Windows workflows never upload unsigned binaries and require LAI ZEYU signing", () => {
  const qaWorkflow = fs.readFileSync(
    path.join(repositoryRoot, ".github", "workflows", "windows-desktop.yml"),
    "utf8",
  );
  assert.match(qaWorkflow, /Private candidate - Pass A and Pass B on identical bytes/);
  assert.match(qaWorkflow, /windows-lifecycle\.ps1[\s\S]*-Round 1/);
  assert.match(qaWorkflow, /windows-lifecycle\.ps1[\s\S]*-Round 2/);
  assert.match(qaWorkflow, /windows-store-lifecycle\.ps1/);
  assert.equal(
    (qaWorkflow.match(/prepare-store-test-candidate\.ps1/g) ?? []).length,
    1,
    "Store QA must create and sign exactly one private candidate before both rounds",
  );
  assert.equal(
    (qaWorkflow.match(/cleanup-store-test-candidate\.ps1/g) ?? []).length,
    1,
    "Store QA must clean its one signing state exactly once after both rounds",
  );
  assert.equal(
    (qaWorkflow.match(/-SigningStatePath \$env:CALORIE_STORE_SIGNING_STATE/g) ?? []).length,
    2,
    "both WACK rounds must consume the exact same frozen signed AppX",
  );
  assert.match(qaWorkflow, /group: trusted-windows-interactive-calorie-store/);
  assert.match(qaWorkflow, /- ephemeral\n\s+- windows-11-24h2/);
  assert.match(qaWorkflow, /signedAppxSha256 -cne \$Second\.signedAppxSha256/);
  assert.match(
    qaWorkflow,
    /temporaryCertificateThumbprint -cne \$Second\.temporaryCertificateThumbprint/,
  );
  for (const uploadBlock of qaWorkflow.split(/uses: actions\/upload-artifact@/).slice(1)) {
    const step = uploadBlock.split(/\n\s+- name:/, 1)[0];
    assert.doesNotMatch(step, /\*\.(?:exe|dll|zip|appx|msix|pfx|p12|cer|key)/i);
  }

  const releaseWorkflow = fs.readFileSync(
    path.join(repositoryRoot, ".github", "workflows", "windows-github-release.yml"),
    "utf8",
  );
  assert.match(releaseWorkflow, /SSL_ESIGNER_CREDENTIAL_ID/);
  assert.match(
    releaseWorkflow,
    /github\.ref == 'refs\/heads\/main'[\s\S]*github\.actor == 'lzy2767865503-pixel'/,
  );
  assert.match(releaseWorkflow, /CALORIE_TRUSTED_GITHUB_BUILD: '1'/);
  assert.match(releaseWorkflow, /f14b1e1ef14bfa1fd00279c363aab0debbf5dcfba0e4bcdce5d22bb771de0e3a/);
  assert.doesNotMatch(releaseWorkflow, /WINDOWS_SIGNING_PFX|CSC_LINK|CSC_KEY_PASSWORD/);
  assert.match(releaseWorkflow, /-RequireTrustedLaiSignature/g);
  assert.match(releaseWorkflow, /-PortableOnly/g);
  assert.match(releaseWorkflow, /build:github-portable/);
  assert.match(releaseWorkflow, /no NSIS installer/i);
  const [signedReleaseJob, isolatedPublisher] = releaseWorkflow.split(/\n  publish-release:/);
  assert.ok(isolatedPublisher, "release workflow must have an isolated publisher job");
  assert.match(releaseWorkflow, /permissions:\n  contents: read/);
  assert.doesNotMatch(signedReleaseJob, /contents: write/);
  assert.match(signedReleaseJob, /actions\/upload-artifact@/);
  assert.match(isolatedPublisher, /contents: write/);
  assert.match(isolatedPublisher, /actions\/download-artifact@/);
  assert.doesNotMatch(isolatedPublisher, /actions\/checkout@/);
  assert.match(isolatedPublisher, /RELEASE_OWNERSHIP_MARKER/);
  assert.match(isolatedPublisher, /releases\/\$ReleaseId/);
  assert.match(isolatedPublisher, /uploads\.github\.com[\s\S]*releases\/\$ReleaseId\/assets/);
  assert.match(isolatedPublisher, /Get-ReleaseByTagOrNull/);
  assert.match(isolatedPublisher, /Get-ReleaseByIdOrNull/);
  assert.match(isolatedPublisher, /Assert-OwnedRelease/);
  assert.match(isolatedPublisher, /created_at/);
  assert.match(isolatedPublisher, /sha256:/);
  assert.match(isolatedPublisher, /Restore-OwnedReleaseToDraft/);
  assert.match(isolatedPublisher, /exact current protected main commit/);
  assert.match(isolatedPublisher, /failed before exact ownership was established; no remote Release was edited/);
  assert.doesNotMatch(isolatedPublisher, /\$Created\s*=\s*\$PossibleOwned/);
  assert.match(isolatedPublisher, /observed Release ID \$ObservedId is not owned and will not be edited/);
  assert.doesNotMatch(releaseWorkflow, /gh release (?:create|edit|upload|download)/);
  assert.doesNotMatch(qaWorkflow, /actions\/upload-artifact@/);
  assert.match(
    qaWorkflow,
    /github\.ref == 'refs\/heads\/main'[\s\S]*github\.actor == 'lzy2767865503-pixel'[\s\S]*inputs\.build_store_package/,
  );

  const storeLifecycle = fs.readFileSync(
    path.join(projectRoot, "scripts", "windows-store-lifecycle.ps1"),
    "utf8",
  );
  const prepareStoreCandidate = fs.readFileSync(
    path.join(projectRoot, "scripts", "prepare-store-test-candidate.ps1"),
    "utf8",
  );
  const cleanupStoreCandidate = fs.readFileSync(
    path.join(projectRoot, "scripts", "cleanup-store-test-candidate.ps1"),
    "utf8",
  );
  const trustedWindowsSdkTool = fs.readFileSync(
    path.join(projectRoot, "scripts", "trusted-windows-sdk-tool.ps1"),
    "utf8",
  );
  assert.doesNotMatch(storeLifecycle, /New-SelfSignedCertificate|signtool\.exe/);
  assert.match(storeLifecycle, /\[string\]\$SigningStatePath/);
  assert.match(storeLifecycle, /signedAppxSha256 = \$ExpectedSignedHash/);
  assert.match(storeLifecycle, /Assert-FrozenSigningCandidate/g);
  assert.equal(
    (prepareStoreCandidate.match(/New-SelfSignedCertificate/g) ?? []).length,
    1,
  );
  assert.equal((prepareStoreCandidate.match(/ sign \/sha1 /g) ?? []).length, 1);
  assert.match(prepareStoreCandidate, /KeyExportPolicy NonExportable/);
  assert.match(cleanupStoreCandidate, /Remove-Item[^\n]*-DeleteKey/);
  assert.match(cleanupStoreCandidate, /CngKey\]::Open/);
  assert.match(cleanupStoreCandidate, /ReparsePoint/);
  assert.match(trustedWindowsSdkTool, /versioned Windows SDK x64 directory/);
  assert.match(trustedWindowsSdkTool, /Microsoft Corporation/);
  assert.match(trustedWindowsSdkTool, /X509RevocationMode\]::Online/);
  assert.match(trustedWindowsSdkTool, /TimeStamperCertificate/);

  const lifecycle = fs.readFileSync(
    path.join(projectRoot, "scripts", "windows-lifecycle.ps1"),
    "utf8",
  );
  assert.match(lifecycle, /SimpleName -cnotin @\('LAI ZEYU', '来泽宇'\)/);
  assert.match(lifecycle, /TimeStamperCertificate/);
  assert.match(lifecycle, /signtool\.exe/);
  assert.match(lifecycle, /'verify', '\/pa', '\/all', '\/tw'/);
  assert.match(lifecycle, /Invoke-BoundedSignToolVerify -BinaryPath \$BinaryPath -Verbose/);
  assert.match(lifecycle, /exactly one SHA-256 signature with an RFC 3161 timestamp/);
  assert.match(lifecycle, /chain is not publicly trusted with online revocation checking/);
});
