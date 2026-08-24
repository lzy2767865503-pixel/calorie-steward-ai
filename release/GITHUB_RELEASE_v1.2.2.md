# Calorie Steward v1.2.2 / 卡路里管家 v1.2.2

**Android Long-Term Update Bridge / Android 长期更新桥接版**

Created, product-led and developed by **LAI ZEYU (来泽宇)** with an
AI-assisted vibe-coding workflow.

## 中文

v1.2.2 是首个内置 Android 长期版本检查器的 **卡路里管家 · Calorie Steward**
版本。它把后续版本发现接入 Kawan Campus 的公开发布清单，同时继续保留旧安装、
本地饮食记录和 API 凭据所依赖的兼容标识。

### 更新

- App 完成启动后会检查一次 Android 公开版本清单；每次从后台回到前台时再次检查。
- 严格校验应用 ID、版本号、Build、最低支持 Build、发布时间、双语说明、SHA-256
  格式，以及官方 GitHub Release 的不可变、版本化 HTTPS 下载地址。
- 普通更新可选择“6 小时后提醒”；当已安装 Build 低于清单声明的最低支持 Build
  时，显示不可延后的更新提示。
- 版本检查只执行不携带凭据的公开 `GET` 请求，不上传照片、饮食记录、个人资料、
  Provider 配置或 API Key。首次成功读取清单前，断网无法得知服务器的新要求；一旦
  App 已记录必须更新门槛，重启、断网、过期缓存或重新打开失败都不能解除该门禁。
- “立即更新”只会打开受信任的官方 APK 地址，安装仍由 Android 处理并需要用户确认；
  本版不实施静默下载或静默安装。
- Mobile 自动化测试现为 `163 / 163 passed`，其中包含 15 项更新清单、URL 信任边界、
  必须/可选更新、持久化门禁、防降级竞态、延后提醒、隐私文案和外部打开器测试。

### 旧版本的一次手动桥接

`v1.2.1 (5)` 及更早 APK 没有版本检查器，因此无法被 v1.2.2 事后远程唤醒。
这些用户需要从 Kawan Campus 或官方 GitHub Release **手动下载 v1.2.2，并覆盖安装一次**。
在 v1.2.2 成功安装后，App 才能在未来公开清单升至更高 Build 时持续提示更新。

覆盖升级仍必须满足 Android 的基本条件：相同 Application ID、相同签名证书、
更高的 `versionCode`。最终 APK 已在 Android API 35 从 v1.2.1 (5) 覆盖升级到
v1.2.2 (6)，`firstInstallTime` 保持不变并成功冷启动。

## English

v1.2.2 is the first **Calorie Steward / 卡路里管家** release to include a
long-lived Android release checker. It discovers later builds from a public
Kawan Campus manifest while preserving the compatibility identifiers required
by existing installs, local diet records and stored API credentials.

### Changed

- Checks the public Android release manifest once after app startup and again
  whenever the app returns to the foreground.
- Strictly validates the application ID, semantic version, build numbers,
  minimum supported build, release timestamp, bilingual notes, SHA-256 format,
  and the immutable versioned HTTPS path in the official GitHub Releases repository.
- Optional updates can be snoozed for six hours. A valid manifest can show a
  non-deferrable prompt when the installed build is below its support floor.
- The check is a credential-free public `GET`. It never uploads photos, diet
  records, profile data, provider configuration or API keys. Before the first
  successful manifest fetch, an offline client cannot know a new server-side
  requirement. Once a required floor is learned, restart, offline state, stale
  disk data or a failed reopen cannot dismiss the persisted gate.
- “Update now” opens only an allowlisted official APK URL. Android still owns
  the install flow and requires user action; this is not silent downloading or
  silent installation.
- The mobile suite is now `163 / 163 passed`, including 15 update-manifest,
  trusted-URL, persistence, anti-downgrade race, policy, snooze, privacy-copy
  and external-opener tests.

### One-time bridge for older installs

`v1.2.1 (5)` and earlier APKs do not contain this checker, so v1.2.2 cannot
retroactively notify them. Those users must **manually download v1.2.2 from
Kawan Campus or the official GitHub Release and install it over the existing
official app once**. Only after that bridge installation can the app discover
later builds when the public manifest advances.

An Android in-place upgrade still requires the same application ID, the same
signing certificate and a higher `versionCode`. The final APK passed an Android
API 35 overlay upgrade from v1.2.1 (5) to v1.2.2 (6), retained the original
`firstInstallTime`, and cold-launched successfully.

## Android package / Android 安装包

- Asset / 文件：`calorie-steward-v1.2.2-android-enterprise.apk`
- Package / 包名：`com.laisystems.dietsteward`
- Version / 版本：`1.2.2 (6)`
- Size / 大小：`81,187,073 bytes`（约 77.4 MiB）
- APK SHA-256：`150d159681e451ada88bf46311dde851e2d486cb2a46201f46437be34da8c76a`
- Signature / 签名：APK Signature Scheme v2；RSA 3072；证书 SHA-256 `a70538342a5f714d1e1e92901b4408f7b20b2f4e39a435f50171642ff9a80e70`
- Build time / 构建时间：`2026-08-24T20:37:02Z`

Verify before installing / 安装前校验：

```bash
shasum -a 256 calorie-steward-v1.2.2-android-enterprise.apk
```

## Verification / 验证

- Mobile automated tests / Mobile 自动化测试：`163 / 163 passed`
- Total automated tests / 自动化测试总计：`185 / 185 passed`（Mobile 163、backend 15、food pipeline 7）
- Android package / 安装包：`clean + lintRelease + assembleRelease` 通过；v2 签名、16 KiB zip alignment、权限与内嵌敏感信息扫描通过
- Runtime / 运行：Android API 24 新装与 API 35 从 v1.2.1 覆盖升级均通过；冷启动日志未发现 App FATAL/ANR
- Compliance / 合规：npm SPDX SBOM、npm license bundle、Android runtime inventory 与 Android license bundle 已生成；Android 许可证未解析项为 0

## Important boundaries / 重要边界

- This is release discovery by polling at startup/foreground, not a background
  push service. / 这是启动与回前台时的版本发现，不是后台推送服务。
- The app does not download, verify or install an APK internally. The manifest
  checksum is published for independent verification, while Android performs
  the actual package/signature checks during installation. / App 不在内部下载、校验或安装 APK；
  清单校验和供独立核对，实际安装与包签名检查由 Android 完成。
- Before any valid manifest is learned, a network failure cannot reveal a new
  server-side floor. Once a required floor is learned, the full-screen gate is
  persisted and cannot be cleared by restart, offline state or failed refresh.
  It remains app-level policy, not MDM-grade silent enforcement. / 首次成功读取有效清单前，
  断网无法得知服务器的新门槛；一旦记录必须更新门槛，全屏门禁会持久化，重启、断网或
  刷新失败都不能解除，但它仍是 App 层策略，不是 MDM 级静默强制。
- v1.2.1 and earlier need one manual bridge installation. No code added to
  v1.2.2 can retroactively notify an APK that does not contain the checker.
  / v1.2.1 及更早版本必须手动桥接一次，无法被新代码事后远程唤醒。
- This is a nutrition estimation and journaling tool, not a medical device or
  laboratory measurement. / 本产品不是医疗器械或实验室测量。
- No large independent weighed-food accuracy benchmark or production paid-provider
  acceptance has been completed. / 尚未完成大规模独立称重基准或付费 Provider 生产验收。
- The signed installable artifact is Android-only. iOS remains source/configuration
  only and was not built, signed or submitted. / 已签名可安装产物仅有 Android；iOS 仍只有源码与配置。

Detailed evidence / 详细证据：`docs/RELEASE_EVIDENCE_v1.2.2.md`  
Compliance checksums / 合规校验和：`docs/RELEASE_COMPLIANCE_v1.2.2.md`
