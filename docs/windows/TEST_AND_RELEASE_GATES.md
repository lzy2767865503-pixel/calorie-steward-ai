# Calorie Steward Windows test and release gates

Version under test: 1.2.3  
Target: Windows 11 x64, Microsoft Store AppX and GitHub signed portable ZIP  
Status: release candidate; not yet certified or published
Author and publisher: LAI ZEYU (来泽宇)

## Local/source verification

- Mobile/product attribution and bilingual gates.
- TypeScript strict type-check.
- 183 product tests, including Windows-only in-memory photo, image-safety, and export boundary tests.
- Ten Electron/package tests for path confinement, security headers, encrypted credential lifecycle, corrupt-store refusal, metadata consistency, fail-closed production Store identity injection, public-artifact isolation, trusted-build delegation, and exact `LAI ZEYU`/`来泽宇` signing gates.
- Expo web export with SQLite WASM and font assets.
- Electron runtime smoke: real preload bridge, sandbox, cross-origin isolation, UI bootstrap, and an operating-system encrypted credential set/read/delete round trip in an isolated temporary profile.
- Full npm audit at `high` threshold for both dependency trees.

These checks can run on a developer machine, but they do not prove Windows packaging.

## Pass A — clean Windows build and packaged lifecycle

The `private-two-pass-qa` GitHub Actions job starts from a clean `windows-latest` runner, installs both lockfiles, reruns every source/runtime check, captures a non-sensitive desktop screenshot, builds private x64 NSIS and ZIP candidates, generates two CycloneDX SBOMs, and records SHA-256 for every top-level release file. Pass A then checks the packaged React DOM, exact `LAI ZEYU（来泽宇）` author, executable hash marker, portable launch, NSIS install, installed launch, uninstall, and user-data removal.

Pass A is successful only when the workflow concludes successfully on the exact commit intended for release.

## Pass B — same-byte repeat

The same job repeats the complete packaged lifecycle without rebuilding. This keeps the unsigned candidate inside one controlled runner while proving that Pass A and Pass B used identical NSIS and ZIP hashes.

This is the second automated pass and is intentionally sequential after Pass A.

Unsigned NSIS/ZIP bytes and raw evidence are never uploaded from private QA;
only a canonical PASS/BLOCKED summary is written to the GitHub job summary. The
public GitHub edition is a portable ZIP rather than an NSIS installer, because
the release policy forbids shipping unsigned third-party installer helper PEs.
Every PE recursively discovered in the ZIP and extracted ASAR content must have
exactly one embedded SHA-256 Authenticode signature with an RFC 3161 timestamp,
must produce zero warnings under current Windows SDK SignTool
`verify /pa /all /v /tw`, and must use a trusted certificate whose verified
signer CN/SimpleName is exactly `LAI ZEYU` or `来泽宇`. The certificate and
timestamp also pass `Get-AuthenticodeSignature` plus online chain verification. The
existing Android `v1.2.3` tag must not be reused; the Windows release uses a
source-matching platform tag such as `windows-v1.2.3`.

The manual `Trusted Windows GitHub release` workflow is the only path allowed to
create that public release. Its YAML gate accepts only the repository owner's
dispatch from `main`; the GitHub Environment must independently restrict
deployment branches to `main` before credentials are configured. Current CA/B
Forum rules keep the private key in a
hardware-backed service rather than an exportable PFX. The workflow therefore
requires an SSL.com individual eSigner credential, downloads the official
CodeSignTool 1.3.2 archive with pinned archive and JAR SHA-256 values, and
delegates every Electron portable-package PE signing callback to that cloud-HSM credential.
It recursively requires every shipped EXE/DLL/native binary in the portable ZIP
and extracted ASAR content to have a trusted timestamp and a certificate
SimpleName exactly equal to `LAI ZEYU` or `来泽宇`. Electron `.node` PE files are
signed through an exclusive temporary `.dll` copy because CodeSignTool's
documented extension allowlist does not include `.node`; the exact signed bytes
are copied back and the temporary file is deleted. The workflow runs the same
signed ZIP through two process-bound UI rounds, creates a private draft,
downloads and hashes every remote asset, removes signing state, rechecks the
remote tag commit, and only then publishes.
Missing credentials, wrong identity, unsigned nested binaries, an untrusted
chain, a missing timestamp, or a third-party signer all fail closed.

## Exact Store package sideload gate

Partner Center has reserved Store ID `9PBQ8LD3VKTS` and Identity `LAIZEYU.CalorieStewardbyLAIZEYU`; repository variables provide that exact identity and the account's technical publisher, and the scripts hard-lock both. A manually approved workflow from the owner's `main` branch on a dedicated self-hosted, active-desktop, elevated Windows runner builds one unsigned Store AppX. It then performs two sequential clean passes on those identical source bytes. Each pass unpacks and checks the manifest, creates an ephemeral same-publisher test certificate, signs only a temporary copy, runs bounded strict WACK `reset`/`test`, requires the report root to prove `LATEST_VERSION=TRUE` and `PARTIAL_RUN=FALSE`, binds exactly one PASS/NOT-APPLICABLE result to every uniquely identified test, installs and launches it, verifies the exact installed executable plus PID/hash-bound UI/author marker and listener, uninstalls it, and removes and rechecks the certificate. The canonical summary rejects any source commit, AppX hash, executable hash, or identity difference between Pass A and Pass B. The original unsigned Partner Center candidate and raw evidence stay private inside the runner and are deleted after the summary is written. Secure transfer to Partner Center is a separate controlled step.

## Interactive Windows release blockers

Before GitHub Release or Microsoft certification submission, a clean Windows 11 standard-user session must also pass:

- system picker with licensed JPEG, PNG, and WebP inputs plus the cancel flow;
- JPEG resize/re-encode, EXIF/GPS removal verification, AI transfer consent, and memory release;
- SQLite create, close/reopen persistence, JSON export, delete-all, and credential replace/delete through Windows protection;
- offline and invalid-credential failure behavior without fabricated analysis;
- 100%, 125%, 150%, and 200% scaling; 1366×768; keyboard-only use; Narrator; high contrast;
- Store AppX fresh install, upgrade from the prior candidate, uninstall, and reinstall;
- Partner Center generative-AI declaration selected and automatic Windows/OneDrive app-data backup cleared;
- Microsoft Defender scan;
- latest Windows App Certification Kit pass.

The tester must record the Windows build, package SHA-256, date, and result. A CI pass is not a WACK pass, and a Partner Center submission is not a public Store listing.
