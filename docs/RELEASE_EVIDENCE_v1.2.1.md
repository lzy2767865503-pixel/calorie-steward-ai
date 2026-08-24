# Calorie Steward v1.2.1 public release evidence / 公开发布证据

**Product / 产品：Calorie Steward / 卡路里管家**  
**Developer / 开发者：LAI ZEYU (来泽宇)**  
**Version / 版本：1.2.1 (5)**  
**Evidence time / 证据时间：`2026-08-24T18:44:16Z`**

This summary contains reviewable release metadata and observed results. It does
not claim a bit-for-bit reproducible build. Signing secrets, private tokens,
emulator serials, user data and local absolute paths are intentionally excluded.
/本摘要只保留可复核的发布元数据与已观察结果，不声称构建已达到比特级可复现；
不包含签名密钥、私有 Token、模拟器序列号、用户数据或本机绝对路径。

## Artifact identity / 产物身份

| Field / 字段 | Verified value / 已验证值 |
|---|---|
| Git tag | `v1.2.1` |
| Build source commit | `e1741a9a0312b0aaf3772fe0ac9d0e196874ee0c` |
| Android asset | `calorie-steward-v1.2.1-android-enterprise.apk` |
| Application ID | `com.laisystems.dietsteward` |
| Version | `1.2.1 (5)` |
| Size | `81153297` bytes |
| APK SHA-256 | `f574f09621be410708a3bd035a3dcaaa5918be1091969617d3a57e37c5dceb0d` |
| Hermes bundle SHA-256 | `973f73314a9460cebc4ce376d82b9ef32521fc17062ec6401c681c5da57e02e3` |

Independent checksum command / 独立校验命令：

```bash
shasum -a 256 calorie-steward-v1.2.1-android-enterprise.apk
```

## Build and automated verification / 构建与自动化验证

| Check / 检查 | Result / 结果 | Evidence summary / 证据摘要 |
|---|---|---|
| TypeScript and mobile verify | Pass | Typecheck, bilingual and attribution gates passed |
| Mobile automated tests | `148 / 148` | Includes legacy export-cleanup compatibility after the rebrand |
| Catalogue unit tests | `7 / 7` | Deterministic food-pipeline unit suite |
| Historical backend tests | `15 / 15` | Historical backend pytest suite |
| Total automated tests | `170 / 170` | 148 mobile + 15 historical backend + 7 food pipeline |
| Mobile npm high/critical audit | Pass | `0 vulnerabilities` in the locked npm dependency tree; this does not cover Gradle, Python or every supply-chain risk |
| Android release build | Pass | `clean lintRelease assembleRelease`; final incremental rebuild and up-to-date confirmation also passed |
| Public source secret scan | Pass | No usable provider or signing secret in the public source set |
| Embedded APK scan | Pass | 1,182 APK entries checked; no high-confidence credential, private-key filename, removed-provider string or developer-home path found |
| Barcode/ML Kit runtime gate | Pass | Unused scanner modules absent from `releaseRuntimeClasspath` |
| Release compliance assets | Pass | npm SBOM, npm license bundle, Android runtime inventory and Android license bundle generated and checksummed |

## Android package verification / Android 安装包验证

| Check / 检查 | Verified result / 已验证结果 |
|---|---|
| English label | `Calorie Steward` |
| Simplified-Chinese label | `卡路里管家` |
| Minimum / target / compile SDK | `24 / 36 / 36` |
| Native ABIs | `arm64-v8a`, `armeabi-v7a`, `x86`, `x86_64` |
| APK Signature Scheme v2 | Pass; one signer |
| Zip alignment | Pass, including 16 KiB page-alignment check |
| Certificate SHA-256 | `a70538342a5f714d1e1e92901b4408f7b20b2f4e39a435f50171642ff9a80e70` |
| Public key | `RSA, 3072 bits` |
| Declared permissions | Camera, Internet, network state, biometric/fingerprint compatibility and Android package-private dynamic-receiver permission; no location, gallery or external-storage permission |

The certificate subject retains the former product name because the same signing
identity is required for a safe in-place upgrade. Reissuing the certificate only
to rename its subject would break upgrade compatibility. / 证书主体保留旧品牌是为了继续使用同一签名身份；
仅为改证书名称而换证书会破坏覆盖升级兼容性。

## Runtime and upgrade matrix / 运行与升级矩阵

| Device/API | Path / 路径 | Result / 结果 | Notes / 备注 |
|---|---|---|---|
| Android API 24 emulator | Fresh install | Pass | Chinese brand and official developer attribution visible; cold launch completed; no app-fatal launch error |
| Android API 35 emulator | v1.2.0 (4) -> v1.2.1 (5), `adb install -r` | Pass | Package `firstInstallTime` remained unchanged; English brand and attribution visible; cold launch completed; no app-fatal launch error |
| Physical Android device | Not tested | Not assessed | Physical-camera, share-sheet, Keystore/biometric and managed-gateway acceptance remain required for production use |
| iOS Simulator/device | Not built/tested | Not assessed | Source/configuration target only; no Apple signing or App Store submission |

The API 35 check proves same-package, same-certificate overlay installation and
successful launch. It did not separately create and inspect a real meal record,
language preference and SecureStore credential across the upgrade. / API 35 测试证明了同包名、同证书覆盖安装与成功启动；
本次没有另行创建并逐项核对真实餐食、语言偏好与 SecureStore 凭据的迁移。

## Rebrand compatibility / 改名兼容性

- User-visible product name is now `Calorie Steward / 卡路里管家`.
- Application ID, bundle ID, URI scheme, SQLite filename, credential namespaces,
  export schema identifier and signing certificate remain stable to preserve
  compatibility with existing installs and data.
- Newly shared export files use `calorie-steward-export-*`; the cleanup journal
  still accepts the legacy `diet-steward-export-*` filename family.
- Historical v1.2.0 evidence and assets retain their original names and hashes.

## Real-vision regression / 真实视觉回归

The release continues to rely on the historical local `3 / 3` functional run
recorded on `2026-08-24T13:08:10Z`: two meal inputs reached the recordable path
and an empty-plate control was rejected as `NOT_FOOD` through authenticated real
inference. It was not rerun as a paid-provider, final-APK or managed-gateway
acceptance test and does not establish an accuracy benchmark. Private inputs and
raw responses are not published. / 本版继续引用历史本地 `3 / 3` 功能回归，不把它写成付费 Provider、
最终 APK、企业网关验收或准确率基准。

## Explicit boundaries / 明确边界

| Area / 领域 | Status / 状态 |
|---|---|
| Large independent weighed-food accuracy benchmark | **NOT VERIFIED / 未验证** |
| Production paid-provider acceptance | **NOT VERIFIED / 未验证** |
| Production managed-gateway end-to-end acceptance | **NOT VERIFIED / 未验证** |
| Complete enterprise SSO/RBAC/centralized audit | **NOT IMPLEMENTED / 未实现** |
| Google Play review | **NOT SUBMITTED / 未提交** |
| App Store build, signing and review | **NOT BUILT OR SUBMITTED / 未构建、未提交** |
| Medical-device or clinical validation | **NOT VERIFIED / 未验证** |
| Real users, retention, revenue or adoption | **NO EVIDENCE CLAIMED / 不声称有证据** |

## Release conclusion / 发布结论

**GO for a public open-source source release and signed Android portfolio APK.
NO-GO for clinical, store-production or complete enterprise-SaaS claims.**

