# Calorie Steward v1.2.3 release evidence / 发布证据

**Version / 版本：1.2.3 (7)**  
**Developer / 开发者：LAI ZEYU 来泽宇**  
**Evidence time / 证据时间：2026-08-25T18:40:38Z**

**Public verification time / 公网验证时间：2026-08-25T18:57:38Z**

## Candidate artifact / 候选产物

| Item | Verified value |
|---|---|
| APK | `calorie-steward-v1.2.3-android-enterprise.apk` |
| Size | `81,189,145` bytes |
| SHA-256 | `4598d47d26a44bb1e31272cca12054b2b8e504d6d94c8fdbfc7b71886e729450` |
| Application ID | `com.laisystems.dietsteward` |
| Android SDK | min 24; target/compile 36 |
| ABIs | `arm64-v8a`, `armeabi-v7a`, `x86`, `x86_64` |
| Signature | v2, one RSA-3072 signer |
| Certificate SHA-256 | `a70538342a5f714d1e1e92901b4408f7b20b2f4e39a435f50171642ff9a80e70` |
| Public key SHA-256 | `6d8efcebebd7d62790b5434412fc3ae57638e3b2a4f5950b2b60de77404a2b60` |
| Alignment | 16 KiB zip alignment verified |
| Lint | `0 errors, 35 warnings` |

## Functional change / 功能变化

- A result becomes best-effort recordable only when it has an explicit food identity and positive bounded calories.
- Low confidence, unknown status, `needs_retake`, or `unquantifiable` may be promoted only under that evidence condition; the wide interval and warning remain visible.
- Explicit `not_food`, missing identity/calories, negative or inverted values, authentication failure, content filtering, provider refusal, damaged JSON, and multiple JSON objects remain rejected.
- OpenAI-compatible endpoints receive the full schema and accept common bounded response variations.

## Verification / 验证

| Gate | Result |
|---|---|
| Mobile tests | 174/174 |
| Historical backend tests | 15/15 |
| Food-pipeline tests | 7/7 |
| Total automated tests | 196/196 |
| Mobile npm audit | 0 vulnerabilities at `--audit-level=high` |
| Public secret scan | Passed |
| Attribution and bilingual gates | Passed |
| Local vision regression | Clear hot meal: recordable; lightly blurred meal: recordable; empty plate: `NOT_FOOD` |
| Android API 24 | Fresh install, cold launch, PID alive, Chinese UI rendered, no app FATAL/ANR observed |
| Android API 35 | Same-signed v1.2.2 -> v1.2.3 overlay upgrade, unchanged `firstInstallTime`, cold launch, English UI rendered, no app FATAL/ANR observed |

The local vision run uses an authenticated Codex local proxy and is not acceptance against a paid production provider or an independent accuracy benchmark. / 本地视觉回归使用已认证的 Codex 本地代理，不等于付费生产 Provider 或独立准确率验收。

## Public state / 公网状态

- [GitHub Release v1.2.3](https://github.com/lzy2767865503-pixel/calorie-steward-ai/releases/tag/v1.2.3) is public, non-draft, and non-prerelease. All eight assets report uploaded state and expected server-side digests.
- Both the immutable versioned APK and the stable `releases/latest/download/calorie-steward-android-enterprise.apk` alias were anonymously downloaded again; each produced SHA-256 `4598d47d26a44bb1e31272cca12054b2b8e504d6d94c8fdbfc7b71886e729450`. Both public checksum files contain the same digest.
- The [Kawan Campus release manifest](https://kawancampus.com/downloads/calorie-steward-android-release.json) is live at v1.2.3 / Build 7 / minimum supported Build 7, with the immutable GitHub asset, checksum URL, and exact APK digest. The Cloudflare deployment sends 100% of traffic to version `b767fad2-6c97-41d8-9fe5-7fa5ea223267`; GET and HEAD returned JSON, CORS, bounded revalidation, ETag, `nosniff`, and cross-origin resource headers.
- Kawan Campus desktop and 390 x 844 mobile rendering both show the independent Calorie Steward v1.2.3 entry and stable latest-download URL. English/Chinese switching worked, the mobile card stayed inside the viewport, and no page console warnings/errors were observed.
- On Android API 24, a clean v1.2.2 / Build 6 install showed the required Build 7 gate after cold start and again after returning to the foreground. A same-signed `adb install -r` upgrade to v1.2.3 retained `firstInstallTime`, removed the gate, and launched the main app without an observed app FATAL/ANR.
