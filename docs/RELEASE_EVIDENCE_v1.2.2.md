# Calorie Steward v1.2.2 public release evidence / 公开发布证据

**Product / 产品：Calorie Steward / 卡路里管家**  
**Developer / 开发者：LAI ZEYU (来泽宇)**  
**Version / 版本：1.2.2 (6)**  
**Evidence time / 证据时间：`2026-08-24T20:37:02Z`**

This document records observed final-release evidence and does not claim a
bit-for-bit reproducible build. Signing secrets, private tokens, emulator
serials, user data and local absolute paths are intentionally excluded. Public
GitHub and Kawan Campus state was independently verified after publication. / 本文记录已观察到的
最终发布证据，不声称构建已达到比特级可复现，也不包含签名密钥、私有 Token、模拟器序列号、
用户数据或本机绝对路径；GitHub 与 Kawan Campus 的公开状态已在发布后独立验证。

## Artifact identity / 产物身份

| Field / 字段 | Verified value / 已验证值 |
|---|---|
| Git tag and Release | Annotated `v1.2.2` tag targets merge commit `2f248a0`; public Release published `2026-08-24T20:51:10Z` |
| Build source commit | `9d1d065` |
| Android asset | `calorie-steward-v1.2.2-android-enterprise.apk` |
| Application ID | `com.laisystems.dietsteward` |
| Version | `1.2.2 (6)` |
| Size | `81,187,073 bytes` (about 77.4 MiB) |
| APK SHA-256 | `150d159681e451ada88bf46311dde851e2d486cb2a46201f46437be34da8c76a` |
| Hermes bundle SHA-256 | `4bd1a199f412a61ccb202b59b327c0b938ddd97204deee4c298fe40c34c9a137` |
| Observed Gradle APK output mtime | `2026-08-24T20:36:34Z` |
| Release evidence/artifact-record time | `2026-08-24T20:37:02Z` |

Independent checksum command / 独立校验命令：

```bash
shasum -a 256 calorie-steward-v1.2.2-android-enterprise.apk
```

## Long-term Android update channel / Android 长期更新通道

| Control / 控制 | Implemented behavior / 已实现行为 |
|---|---|
| Applicability | Android only; v1.2.2 (6) is the first build containing the checker |
| Trigger | One check after startup completes and another whenever the app returns to the foreground |
| Manifest | Credential-free `GET` to `https://kawancampus.com/downloads/calorie-steward-android-release.json` |
| Network limits | `credentials: omit`, `cache: no-store`, 10-second timeout, JSON content-type gate and 32 KiB response cap |
| Identity validation | Exact schema version, Android platform and `com.laisystems.dietsteward` application ID |
| Release validation | Strict semantic version, positive safe-integer builds, support floor not above latest build, parseable release time, bounded bilingual notes and lowercase 64-character SHA-256 |
| URL validation | HTTPS only; no user info, custom port, query or fragment; exact immutable versioned path in the official GitHub Releases repository only |
| Checksum binding | Checksum URL must be exactly the allowlisted APK URL plus `.sha256` |
| Optional policy | A later build can be deferred for six hours; the snooze is scoped to that latest build |
| Required policy | If installed Build is below `minimumSupportedBuild`, a full-screen non-cancelable gate is persisted and offers the official update action plus retry |
| Failure behavior | Before any valid manifest is learned, offline startup cannot know a new support floor. Once successfully persisted, the highest required floor survives restart, offline state, stale disk data and refresh failure; if persistence fails, the current process remains blocked and retries without downgrading the in-memory gate |
| Privacy | Request contains no photo, diet record, profile, provider configuration, API key or other user payload |
| Install boundary | The app opens the official HTTPS APK URL; Android and the user complete the installation |

This channel discovers signed APK releases; it is not remote code execution,
an in-app package installer, a background push service or a replacement for
Android package-signature enforcement. / 该通道用于发现签名 APK，不是远程代码执行、
App 内安装器、后台推送服务，也不能替代 Android 的包签名校验。

## Older-version bridge matrix / 旧版本桥接矩阵

| Installed build / 已安装版本 | Checker present / 是否含检查器 | Upgrade path / 更新路径 |
|---|---|---|
| v1.2.1 (5) and earlier | No | One manual download and same-signed overlay install of v1.2.2 is required |
| v1.2.2 (6) | Yes | Can discover a later build after the public manifest advances |
| Future build 7+ | Expected only if retained in code | Must be verified in that release; future publication is an operational obligation, not guaranteed by this document |

No new code can retroactively contact an APK that never shipped the checker.
“Long-term” means v1.2.2 establishes a reusable manifest contract; each future
release still has to publish a higher signed build, checksum and current manifest.
/ 新代码无法事后联系从未内置检查器的旧 APK；“长期”表示 v1.2.2 建立可复用清单合同，
后续每个版本仍须发布更高 Build、同签名 APK、校验和与更新后的公开清单。

## Build and automated verification / 构建与自动化验证

| Check / 检查 | Result / 结果 | Evidence summary / 证据摘要 |
|---|---|---|
| Mobile automated tests | `163 / 163 passed` | Exact release source; includes 15 Android update-channel tests and 148 existing mobile tests |
| Android update-channel tests | `15 / 15 passed` | Manifest/URL validation, native identity, bounded fetch, optional/required policy, persistence and anti-downgrade race coverage |
| Catalogue unit tests | `7 / 7 passed` | Final source-tree run |
| Historical backend tests | `15 / 15 passed` | Final source-tree run |
| Total automated tests | `185 / 185 passed` | Mobile 163 + backend 15 + catalogue 7 |
| TypeScript and mobile verify | Passed | TypeScript, bilingual copy, attribution and test-harness typecheck passed |
| Mobile npm high/critical audit | `0 vulnerabilities` | `npm audit --audit-level=high` against the final locked mobile npm dependency tree |
| Android release build | Passed | Gradle `clean lintRelease assembleRelease --no-daemon`; Lint reported 0 errors and 35 warnings |
| Public source secret scan | Passed | High-confidence public-secret patterns and local-path checks |
| Embedded APK scan | Passed | 1,182 extracted entries checked for local paths, credential prefixes, removed-provider references and private-key/signing-secret material |
| Barcode/ML Kit runtime gate | Passed | Gradle `releaseRuntimeClasspath` contains no barcode/ML Kit runtime dependency modules |
| Release compliance assets | Passed | SPDX SBOM, npm license bundle, Android runtime inventory and Android license bundle generated |

The automated run, package inspection, signing checks and emulator runs are
separate evidence layers; none is presented as a physical-device or accuracy study.
/ 自动化、安装包检查、签名检查和模拟器运行是相互独立的证据层，不等同于真机或准确率研究。

## Android package verification / Android 安装包验证

| Check / 检查 | Final result / 最终结果 |
|---|---|
| English label | `Calorie Steward` |
| Simplified-Chinese label | `卡路里管家` |
| Minimum / target / compile SDK | 24 / 36 / 36 |
| Native ABIs | `arm64-v8a`, `armeabi-v7a`, `x86`, `x86_64` |
| APK Signature Scheme | v2 verified; v1, v3, v3.1 and v4 not used |
| Zip alignment | `zipalign -c -P 16 -v 4` verification successful |
| Certificate SHA-256 | `a70538342a5f714d1e1e92901b4408f7b20b2f4e39a435f50171642ff9a80e70`; identical to official v1.2.1 |
| Public key | RSA 3072; SHA-256 `6d8efcebebd7d62790b5434412fc3ae57638e3b2a4f5950b2b60de77404a2b60` |
| Declared permissions | Camera, Internet, network state, biometric/fingerprint compatibility, package dynamic receiver permission and Play install-referrer binding; no storage or package-install permission |

The application ID intentionally remains `com.laisystems.dietsteward` for
upgrade and local-data continuity. Certificate equality and the API 35 overlay
test prove package-level upgrade compatibility from the official v1.2.1 APK;
the test did not separately audit every user record or SecureStore value.
/ 为保留覆盖升级与本地数据连续性，Application ID 继续使用
`com.laisystems.dietsteward`；证书一致性与 API 35 覆盖升级证明了官方 v1.2.1 的包级兼容，
但本次未逐项审计每条用户记录或 SecureStore 值。

## Runtime and upgrade matrix / 运行与升级矩阵

| Device/API | Path / 路径 | Result / 结果 | Notes / 备注 |
|---|---|---|---|
| Android API 24 emulator | Fresh install | Passed | Install succeeded; v1.2.2 (6), PID remained alive, MainActivity focused, no app FATAL/ANR in the cleared cold-launch log; Chinese branded setup rendered |
| Android API 35 emulator | v1.2.1 (5) -> v1.2.2 (6), `adb install -r` | Passed | Same certificate; `firstInstallTime` remained `2026-08-25 02:40:21`; cold launch succeeded with English brand and LAI ZEYU 来泽宇 attribution; no app FATAL/ANR observed |
| Android API 35 emulator | Update prompt against controlled later-build manifest | Not runtime-tested | 15/15 logic and source-wiring tests passed; no claim of rendered controlled-manifest acceptance |
| Physical Android device | Not tested | Not tested | Camera, browser handoff, unknown-source install, Keystore/biometric and managed-gateway acceptance remain device-dependent |
| iOS Simulator/device | Not built/tested | Not tested | The v1.2.2 long-term checker is Android-only |

## Publication contract / 发布合同

For each later Android release, the maintainer must keep the stable application
ID and release certificate, increment `versionCode`, publish the APK and its
`.sha256` file, verify both URLs, then update the Kawan Campus manifest with the
matching version, build, hash, timestamp and bilingual notes. The support floor
must never exceed the latest build. / 后续每个 Android 版本都必须保留稳定包名与发布证书、
递增 `versionCode`、发布 APK 与 `.sha256`、验证链接，再同步更新 Kawan Campus 清单中的
版本、Build、哈希、时间和双语说明；最低支持 Build 不得高于最新 Build。

The manifest should not advertise an APK before that exact signed asset and
checksum are publicly reachable. A broken or prematurely advanced required
manifest can persistently gate an older build without giving the user a working
download, so asset publication and independent URL verification must happen first.
/ 不应在对应签名 APK 与校验和可公开访问前提前推进清单，否则会造成更新失败体验。

For v1.2.2, the six GitHub assets were published first. GitHub's asset digest,
an independent streamed download and the downloadable checksum all matched
`150d159681e451ada88bf46311dde851e2d486cb2a46201f46437be34da8c76a`.
The Kawan Campus manifest was then deployed at 100% traffic and re-read publicly
as JSON with Build 6, the same digest, CORS, `nosniff`, browser revalidation and
the bounded CDN cache policy. / v1.2.2 先公开 6 个 GitHub 资产，再独立下载核对 APK、
GitHub 资产摘要与校验文件；三者哈希一致后才将 Kawan Campus 清单部署到 100% 流量，
并从公网复核 JSON、Build 6、同一哈希、CORS、`nosniff` 与缓存策略。

## Explicit boundaries / 明确边界

| Area / 领域 | Status / 状态 |
|---|---|
| v1.2.1-or-earlier remote notification | **IMPOSSIBLE WITHOUT ONE MANUAL BRIDGE INSTALL / 未手动桥接前无法实现** |
| Silent/background APK installation | **NOT IMPLEMENTED / 未实现** |
| In-app verification of downloaded APK bytes against manifest SHA-256 | **NOT IMPLEMENTED / 未实现** |
| Required gate before first successful manifest fetch | **CANNOT KNOW A NEW SERVER FLOOR WHILE OFFLINE / 首次成功读取清单前，离线无法得知服务器新门槛** |
| Previously learned required gate | **PERSISTED AND BLOCKING ACROSS RESTART/OFFLINE/REFRESH FAILURE / 已持久化，重启、断网或刷新失败仍阻断** |
| Large independent weighed-food accuracy benchmark | **NOT VERIFIED / 未验证** |
| Production paid-provider acceptance | **NOT VERIFIED / 未验证** |
| Production managed-gateway end-to-end acceptance | **NOT VERIFIED / 未验证** |
| Complete enterprise SSO/RBAC/centralized audit | **NOT IMPLEMENTED / 未实现** |
| Google Play review | **NOT SUBMITTED / 未提交** |
| App Store build, signing and review | **NOT BUILT OR SUBMITTED / 未构建、未提交** |
| Medical-device or clinical validation | **NOT VERIFIED / 未验证** |
| Real users, retention, revenue or adoption | **NO EVIDENCE CLAIMED / 不声称有证据** |

## Release conclusion / 发布结论

**GO: the signed Android portfolio release, checksum, compliance assets and
Kawan Campus manifest are public and independently re-read. The physical-device,
iOS, paid-provider and weighed-food accuracy boundaries above remain open.
/ GO：签名 Android 作品集版本、校验文件、合规资产与 Kawan Campus 清单均已公开并完成
独立复核；真机、iOS、付费 Provider 与称重准确率边界仍未关闭。**
