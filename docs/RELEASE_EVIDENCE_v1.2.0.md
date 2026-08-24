# Diet Steward v1.2.0 public release evidence / 公开发布证据

**Product / 产品：Diet Steward / 饮食管家**  
**Developer / 开发者：LAI ZEYU (来泽宇)**  
**Version / 版本：1.2.0 (4)**  
**Evidence date / 证据日期：`2026-08-24T16:04:04Z`**

This public summary contains only reviewable release metadata. It records the
procedure and observed results; it does not claim a bit-for-bit reproducible build. Signing secrets,
private tokens, emulator serials, raw provider identifiers, user data and local
absolute paths are intentionally excluded. / 本摘要只保留可复核的发布元数据与已观察结果，不声称构建已达到比特级可复现；
不包含签名密钥、私有 Token、模拟器序列号、Provider 原始标识、用户数据或本机绝对路径。

## Artifact identity / 产物身份

| Field / 字段 | Verified value / 已验证值 |
|---|---|
| Git tag | `v1.2.0` |
| Source commit | `e2e7fa900790bf742921b51587c0c7c4632875a5` |
| Android asset | `diet-steward-v1.2.0-android-enterprise.apk` |
| Application ID | `com.laisystems.dietsteward` |
| Version | `1.2.0 (4)` |
| Size | `81153033` bytes |
| APK SHA-256 | `d2cf6f56ec6d67546cad449a03fb6d84714476689561c65ee871b87004e7c170` |
| Hermes bundle SHA-256 | `8c3976bcc2559719caa621e2dcf1f7349f4fb67d765d8f1f7dffc73d7c700a22` |

Independent checksum command / 独立校验命令：

```bash
shasum -a 256 diet-steward-v1.2.0-android-enterprise.apk
```

## Build and automated verification / 构建与自动验证

| Check / 检查 | Result / 结果 | Evidence summary / 证据摘要 |
|---|---|---|
| Locked dependency install | Pass | `npm ci` from `mobile-app/package-lock.json` |
| TypeScript | Pass | `npm run typecheck` |
| Mobile automated tests | `147 / 147` | `npm test` |
| Combined mobile verify | Pass | `npm run verify` including type, bilingual and attribution gates |
| Public-set secret scan | Pass | `bash scripts/scan-public-secrets.sh` |
| Attribution guard | Pass | `bash scripts/check-attribution.sh` |
| Catalogue unit tests | Pass, `7 / 7` | project virtual environment + `python -m unittest -v test_build_food_database.py` |
| Historical backend tests | Pass, `15 / 15` | project virtual environment + `pytest` |
| Total automated tests | `169 / 169` | 147 mobile + 15 historical backend + 7 food pipeline |
| Mobile npm high/critical audit | Pass | `npm audit --audit-level=high` reported `0 vulnerabilities` for the dependency tree locked by `mobile-app/package-lock.json`; this row does not cover Gradle, Python or every supply-chain risk |
| Android release build | Pass | `lintRelease assembleRelease`; bilingual and attribution Gradle gates passed |
| Source/API-key pattern scan | Pass | No usable provider or signing secret in public source |
| Embedded APK secret/provider scan | Pass | No high-confidence provider/signing secret, key file or disallowed provider string in the final APK |
| Native build-path scan | Pass | No `/Users/` developer-home marker remained in the final APK after compile-time path remapping |
| Barcode/ML Kit runtime dependency gate | Pass | The final Gradle `releaseRuntimeClasspath` contains none of the unused scanner modules; Expo Camera compile-only API references are not packaged implementations |
| Release compliance artifacts | Pass | SPDX npm SBOM, npm license-text bundle, Android release-runtime dependency inventory and Android third-party-license bundle generated, reviewed and checksummed |

## Android package verification / Android 安装包验证

| Check / 检查 | Verified result / 已验证结果 |
|---|---|
| Minimum SDK | `24` |
| Target SDK | `36` |
| Compile SDK | `36` |
| Native ABIs | `arm64-v8a`, `armeabi-v7a`, `x86`, `x86_64` |
| APK Signature Scheme v2 | Pass; one signer |
| Zip alignment | Pass |
| Debuggable | `false` |
| Certificate subject | `CN=LAI Systems Diet Steward Enterprise, OU=Mobile Engineering, O=LAI Systems, L=Bangi, ST=Selangor, C=MY` |
| Certificate SHA-256 | `a70538342a5f714d1e1e92901b4408f7b20b2f4e39a435f50171642ff9a80e70` |
| Public key | `RSA, 3072 bits` |
| Declared permissions | Camera, Internet, network state, biometric/fingerprint compatibility, and Android's package-private dynamic-receiver permission; no location, gallery or external-storage permission |

Only the public certificate subject/fingerprint belongs here. The private signing store, alias passwords and environment-variable values must never be published.

这里只能公开证书主体和指纹。私钥库、密码和签名环境变量值绝不能公开。

## Runtime matrix / 运行时矩阵

| Device/API | Install | Cold launch | App fatal errors | Notes |
|---|---|---|---:|---|
| Android API 24 emulator | Pass | Pass | 0 in captured cold-launch logs | Final signed APK; English and Chinese launch/attribution verified |
| Android API 35 emulator | Pass | Pass | 0 in captured cold-launch logs | Final signed APK; English setup layout and attribution verified |
| Physical Android device | Not tested | Not tested | Not assessed | A physical-device acceptance pass remains required before store/production claims |
| iOS Simulator/device | Not built/tested | Not tested | Not assessed | Cross-platform source/configuration is present, but no iOS build, CocoaPods acceptance, Apple signing or App Store release was completed |

## Product-path evidence / 产品链路证据

| Path / 链路 | Result / 结果 | Boundary / 边界 |
|---|---|---|
| Chinese/English language behavior | Pass | Automated UI gate plus API 24 cold launches in both locales |
| Visible developer attribution | Pass | Both `LAI ZEYU` and `来泽宇` verified in English and Chinese official-app UI |
| Camera-only meal entry | Pass (source + automated policy checks) | No gallery-wide permission or manual meal creation; emulator camera quality is not a physical-camera test |
| Personal API setup | Pass (client contract/tests) | No production paid-provider account was used for this release acceptance |
| Managed gateway setup | Pass (client contract/tests) | Client foundation only; no production enterprise gateway/SSO/RBAC acceptance |
| Fail-closed invalid response | Pass | Automated regressions prevent demo, fixed or stale results from entering the diary |
| Local daily/weekly/monthly/yearly views | Pass | Recomputed and paginated from local structured records; large-history regression included |
| Photo deletion retry | Pass (automated fault injection) | Retry journals survive simulated restart/delete failures; physical OS kill/power loss remains untested |
| Export privacy whitelist | Pass | Tests exclude keys, gateway/provider diagnostics, photos and local paths |

## Real-vision regression / 真实视觉回归

- Backend / 后端：Authenticated local Codex vision proxy connected through the public generic OpenAI-compatible adapter; real inference rather than a mock, but not public CI, final-APK paid-provider acceptance or enterprise-gateway acceptance
- Rounds passed / 通过轮次：`3 / 3` (historical local functional run on `2026-08-24T13:08:10Z`; it was not a final paid-provider or managed-gateway acceptance run)
- Meal inputs / 餐食图：`2`
- Non-food controls / 非食物对照：`1`
- Summary / 摘要：Both meal inputs reached the recordable-meal path with uncertainty ranges; the empty-plate control was rejected as `NOT_FOOD`. Original images, paths, hashes, model request identifiers and raw responses are not published.

The public repository does not distribute the original images, raw responses or provider request identifiers. The public harness can be rerun with contributor-owned/licensed images and a separately configured vision service, but it cannot independently reproduce the private historical inputs or establish an accuracy benchmark. This evidence therefore describes only reviewed aggregate outcomes. / 公开仓库不分发原始图片、原始响应或 Provider 请求标识。公开 harness 可使用贡献者自有/获授权图片与自行配置的视觉服务重跑，但无法独立复现私密历史输入，也不构成准确率基准。此处只写经审查的汇总结果。

## Explicitly not verified / 明确未验证

These are explicit release states, not forgotten checklist items. / 以下是明确的发布状态，不是遗漏的待办事项。

| Area / 领域 | Status / 状态 |
|---|---|
| Large independent weighed-food accuracy benchmark / 大规模独立称重准确率基准 | **NOT VERIFIED / 未验证** |
| Production paid-provider acceptance with a real account / 真实付费 Provider 生产验收 | **NOT VERIFIED / 未验证** |
| Production managed-gateway end-to-end acceptance / 企业网关生产端到端验收 | **NOT VERIFIED / 未验证** |
| SSO/OIDC, RBAC, centralized immutable audit and certified data residency / 完整企业治理 | **NOT IMPLEMENTED / 未实现** |
| Google Play review and Data Safety approval / Google Play 审核 | **NOT SUBMITTED / 未提交** |
| App Store build, signing, privacy submission and review / App Store 发布 | **NOT BUILT OR SUBMITTED / 未构建、未提交** |
| Medical-device or clinical validation / 医疗器械或临床验证 | **NOT VERIFIED / 未验证** |
| Real app-process kill, OS crash and sudden power-loss fault injection / 真实进程、崩溃和断电故障注入 | **NOT VERIFIED / 未验证** |
| Real user adoption, retention, conversion or revenue / 真实用户、留存、转化或营收 | **NO EVIDENCE CLAIMED / 不宣称有证据** |

## Release conclusion / 发布结论

**GO for a public open-source source release and signed Android portfolio APK. NO-GO for clinical, store-production or complete enterprise-SaaS claims.**

Decision rationale / 决策理由：The recorded release build, signature, checksum, automated suites, secret/attribution gates and API 24/35 cold launches passed. The build procedure is reviewable and repeatable, but no bit-for-bit clean-checkout reproducibility claim is made. The unverified items above remain explicit release boundaries rather than being converted into unsupported claims. / 已记录的发布构建、签名、校验和、自动化测试、密钥/署名门禁以及 API 24/35 冷启动全部通过。构建流程可审查、可重复执行，但不声称已达到清洁 checkout 的比特级可复现；上述未验证项仍作为明确边界，不转换为无证据宣称。
