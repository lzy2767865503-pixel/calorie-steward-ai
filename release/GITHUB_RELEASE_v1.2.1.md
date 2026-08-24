# Calorie Steward v1.2.1 / 卡路里管家 v1.2.1

**Enterprise Rebrand & Upgrade-Compatible Portfolio Release / 企业级改名与可覆盖升级作品集版**

Created, product-led and developed by **LAI ZEYU (来泽宇)** with an
AI-assisted vibe-coding workflow.

## 中文

v1.2.1 将官方产品名统一为 **卡路里管家 · Calorie Steward**，同时保留覆盖升级和旧数据所需的内部兼容标识。

### 更新

- Android、iOS 源码、Expo 配置、App 内中英文界面与开源文档统一改名。
- Android 版本升至 `1.2.1 (5)`，并使用与 v1.2.0 相同的企业签名证书。
- API 35 通过从 v1.2.0 到 v1.2.1 的同包名覆盖升级；API 24 通过中文新装与冷启动。
- 新导出文件使用 `calorie-steward-export-*`，同时保留对旧导出文件清理队列的兼容。
- 增强品牌/版本同步门禁，防止 Expo、Android、iOS 和 About 页面漂移。

### 为什么内部还有 `dietsteward`

`com.laisystems.dietsteward`、URI scheme、SQLite 文件名、SecureStore/Keychain 命名空间、导出 schema 和旧签名证书都是兼容性合同，不是用户可见品牌。机械改名会导致无法覆盖升级、旧记录或 API 凭据不可见。

## English

v1.2.1 establishes **Calorie Steward / 卡路里管家** as the official
product brand while deliberately preserving the machine identifiers required
for safe upgrades and continuity of existing local data.

### Changed

- Unified the visible brand across the React Native app, Android/iOS metadata,
  bilingual copy and public documentation.
- Advanced Android to `1.2.1 (5)` and retained the v1.2.0 release certificate.
- Passed an in-place v1.2.0 -> v1.2.1 upgrade on API 35 and a Chinese fresh
  install/cold launch on API 24.
- Renamed newly shared export files while retaining cleanup compatibility for
  pre-rebrand export filenames.
- Strengthened cross-platform brand/version consistency gates.

## Android package / Android 安装包

- Asset / 文件：`calorie-steward-v1.2.1-android-enterprise.apk`
- Package / 包名：`com.laisystems.dietsteward`
- Version / 版本：`1.2.1 (5)`
- Size / 大小：`81,153,297 bytes (77.39 MiB)`
- SHA-256：`f574f09621be410708a3bd035a3dcaaa5918be1091969617d3a57e37c5dceb0d`
- Signature / 签名：`APK Signature Scheme v2; RSA 3072-bit; certificate SHA-256 a70538342a5f714d1e1e92901b4408f7b20b2f4e39a435f50171642ff9a80e70`

Verify before installing / 安装前校验：

```bash
shasum -a 256 calorie-steward-v1.2.1-android-enterprise.apk
```

## Verification / 验证

- Automated tests / 自动化测试：`170/170 passed (mobile 148, historical backend 15, food pipeline 7)`
- Android package / 安装包：`lint, build, signature, zipalign, labels, permissions and embedded-secret scans passed`
- Runtime / 运行：`API 24 Chinese fresh install + API 35 same-signed upgrade passed; no app-fatal launch errors`
- Compliance / 合规：`SPDX npm SBOM, npm license bundle, Android runtime inventory and Android license bundle included`

## Important boundaries / 重要边界

- This is a nutrition estimation and journaling tool, not a medical device or
  laboratory measurement. / 本产品不是医疗器械或实验室测量。
- No large independent weighed-food accuracy benchmark or production paid-provider
  acceptance has been completed. / 尚未完成大规模独立称重基准或付费 Provider 生产验收。
- The signed installable artifact is Android-only. iOS remains source/configuration
  only and was not built, signed or submitted. / 已签名可安装产物仅有 Android。
- The app has no automatic updater. Existing users must download the new APK and
  install it over the official v1.2.0 package. / App 没有自动更新器，需手动下载并覆盖安装。

Detailed evidence / 详细证据：`docs/RELEASE_EVIDENCE_v1.2.1.md`  
Compliance checksums / 合规校验和：`docs/RELEASE_COMPLIANCE_v1.2.1.md`

