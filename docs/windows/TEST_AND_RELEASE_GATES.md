# Calorie Steward Windows test and release gates

Version under test: 1.2.3  
Target: Windows 11 x64, Microsoft Store AppX and GitHub NSIS/ZIP  
Status: release candidate; not yet certified or published
Author and publisher: LAI ZEYU (来泽宇)

## Local/source verification

- Mobile/product attribution and bilingual gates.
- TypeScript strict type-check.
- 179 product tests, including five Windows-only in-memory photo/export boundary tests.
- Seven Electron/package tests for path confinement, security headers, encrypted credential lifecycle, corrupt-store refusal, metadata consistency, and fail-closed Store identity injection.
- Expo web export with SQLite WASM and font assets.
- Electron runtime smoke: real preload bridge, sandbox, cross-origin isolation, UI bootstrap, and an operating-system encrypted credential set/read/delete round trip in an isolated temporary profile.
- Full npm audit at `high` threshold for both dependency trees.

These checks can run on a developer machine, but they do not prove Windows packaging.

## Pass A — clean Windows build

The `pass-a-build-and-test` GitHub Actions job starts from a clean `windows-latest` runner, installs both lockfiles, reruns every source/runtime check, captures a non-sensitive desktop screenshot, builds x64 NSIS and ZIP artifacts, generates two CycloneDX SBOMs, and records SHA-256 for every top-level release file.

Pass A is successful only when the workflow concludes successfully on the exact commit intended for release.

## Pass B — independent packaged smoke

The `pass-b-installed-smoke` job downloads Pass A rather than rebuilding. It verifies the recorded hashes, launches the portable ZIP, probes the protected loopback UI, silently installs the NSIS build, launches and probes the installed app, then uninstalls it and verifies that the executable was removed.

This is the second automated pass and is intentionally downstream of Pass A.

## Exact Store package sideload gate

After Partner Center name reservation, repository variables provide the exact identity and publisher. A manual workflow builds the unsigned Store AppX, unpacks and checks its manifest, creates an ephemeral same-publisher test certificate, signs a temporary copy, trusts it only on the disposable CI account, installs/launches/probes/uninstalls the copy, and removes the certificate. The uploaded Partner Center candidate remains the original unsigned package; no test certificate or test-signed package is uploaded.

## Interactive Windows release blockers

Before GitHub Release or Microsoft certification submission, a clean Windows 11 standard-user session must also pass:

- system picker with licensed JPEG, PNG, WebP, HEIC/HEIF inputs and cancel flow;
- JPEG resize/re-encode, EXIF/GPS removal verification, AI transfer consent, and memory release;
- SQLite create, close/reopen persistence, JSON export, delete-all, and credential replace/delete through Windows protection;
- offline and invalid-credential failure behavior without fabricated analysis;
- 100%, 125%, 150%, and 200% scaling; 1366×768; keyboard-only use; Narrator; high contrast;
- Store AppX fresh install, upgrade from the prior candidate, uninstall, and reinstall;
- Microsoft Defender scan;
- latest Windows App Certification Kit pass.

The tester must record the Windows build, package SHA-256, date, and result. A CI pass is not a WACK pass, and a Partner Center submission is not a public Store listing.
