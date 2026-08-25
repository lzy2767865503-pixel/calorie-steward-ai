# Calorie Steward v1.2.3 release evidence / 发布证据

**Version / 版本：1.2.3 (7)**  
**Developer / 开发者：LAI ZEYU 来泽宇**  
**Evidence time / 证据时间：2026-08-25T18:40:38Z**

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

GitHub Release assets and the Kawan Campus Build 7 manifest are intentionally marked pending until the signed APK and checksum are published, downloaded again, and verified. The public manifest must be advanced last so Build 6 users are never gated to a missing asset.
