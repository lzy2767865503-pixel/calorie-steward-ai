# Diet Steward v1.2.0 / 饮食管家 v1.2.0

**Bilingual Portfolio Edition / 中英双语作品集版**

Created, product-led and developed by **LAI ZEYU (来泽宇)** with an
AI-assisted vibe-coding workflow.

## 中文

v1.2.0 将 Diet Steward 更新为中英双语作品集版，并补全了开源溯源与持续验证。它的核心仍然是：用一次拍照降低饮食记录摩擦，同时使用热量/营养范围、置信度和假设避免“假精确”。

### 新增

- 中文 / English 应用内语言切换，关键流程和风险说明双语化。
- 在官方 App 内明确展示开发者 **LAI ZEYU (来泽宇)**，并在 README 与作品集案例中披露 AI-assisted vibe-coding 工作流。
- Apache-2.0、NOTICE、AUTHORS、CITATION.cff、SECURITY.md 和 CONTRIBUTING.md。
- GitHub CI：移动端类型/测试、历史后端/食品库单元测试、移动端 npm 锁定依赖树的高/严重级 advisory 审计、高置信密钥扫描与官方署名检查。该 npm 审计不覆盖 Gradle、Python 或全部供应链风险。
- 中英双语产品案例与可直接使用的简历要点。

### 保留的核心能力

- 只保留相机拍照的餐食录入主路径。
- 支持个人 BYO API，并提供连接组织自行运营 HTTPS 网关的客户端配置与契约；仓库不包含生产网关服务。
- AI 返回必须通过本地结构、数值与一致性校验；失败时不生成 Demo 或固定热量。
- 日/周/月/年本地记录与确定性 DietScore。
- SecureStore 凭据管理、照片重编码/去 EXIF/GPS，以及不包含密钥和照片的导出。

## English

v1.2.0 is the bilingual portfolio edition of Diet Steward. It preserves the core product thesis: reduce nutrition-logging friction to one photo while representing calorie and nutrient uncertainty instead of displaying false precision.

### Added

- In-app Chinese / English language switching across the core journey and risk copy.
- Visible official-app credit for **LAI ZEYU (来泽宇)**, with the AI-assisted vibe-coding workflow disclosed in the README and portfolio case study.
- Apache-2.0, NOTICE, AUTHORS, CITATION.cff, security and contribution policies.
- GitHub CI for mobile verification, historical backend/catalogue units, high/critical advisories in the locked mobile npm dependency tree, high-confidence secret scanning and official attribution checks. The npm audit does not cover Gradle, Python or every supply-chain risk.
- A bilingual product case study and evidence-bounded resume bullets.

### Preserved product capabilities

- Camera-only meal-entry journey.
- Personal BYO API plus client-side configuration/contracts for an organization-operated HTTPS gateway; this repository does not include a production gateway service.
- Strict local validation and fail-closed AI behavior.
- Local daily, weekly, monthly and yearly records plus deterministic DietScore.
- Secure credential storage, image metadata stripping and portable exports that exclude keys and photos.

## Android package / Android 安装包

- Asset / 文件：`diet-steward-v1.2.0-android-enterprise.apk`
- Package / 包名：`com.laisystems.dietsteward`
- Version / 版本：`1.2.0 (4)`
- Size / 大小：`81,153,033 bytes (77.39 MiB)`
- SHA-256：`d2cf6f56ec6d67546cad449a03fb6d84714476689561c65ee871b87004e7c170`
- Signature / 签名：`APK Signature Scheme v2; RSA 3072-bit; certificate SHA-256 a70538342a5f714d1e1e92901b4408f7b20b2f4e39a435f50171642ff9a80e70`

Verify before installing / 安装前校验：

```bash
shasum -a 256 diet-steward-v1.2.0-android-enterprise.apk
```

The APK contains no usable AI-provider key. AI analysis and report generation require your own supported API or an organizational gateway. / APK 不内置可用 AI Key；识别和报告需要使用者自己的 API 或企业网关。

## Verification / 验证

- Automated tests / 自动化测试：`169/169 passed (mobile 147, historical backend 15, food pipeline 7)`
- Android install/cold launch matrix / 安装与冷启动：`PASS on API 24 (English + Chinese) and API 35; zero app-fatal launch-log errors`
- APK signature and zip alignment / 签名与对齐：`PASS (v2 signature, one signer, zipalign verified)`
- Source/APK secret scan / 源码与 APK 密钥扫描：`PASS; no usable provider/signing secret and no key files embedded`
- Real-image regression / 真实图片回归：`historical local functional run, 3/3 on 2026-08-24 through an authenticated Codex vision proxy using real inference (not a mock): two meal-recording paths and one NOT_FOOD refusal; private inputs/raw results are not public; not public CI, final-APK paid-provider acceptance, managed-gateway acceptance or an accuracy benchmark`

## Compliance assets / 依赖合规产物

- `diet-steward-v1.2.0-npm-sbom.spdx.json`
- `diet-steward-v1.2.0-third-party-licenses.txt`
- `diet-steward-v1.2.0-android-runtime-dependencies.txt`
- `diet-steward-v1.2.0-android-third-party-licenses.txt`

Checksums and scope / 校验和与范围：`docs/RELEASE_COMPLIANCE_v1.2.0.md`

## Important boundaries / 重要边界

- This is a nutrition estimation and journaling tool, not a medical device or laboratory measurement. / 本产品不是医疗器械或实验室测量。
- No independently weighed large-scale accuracy benchmark has been completed. / 尚未完成大规模独立称重准确率基准。
- The managed edition is an enterprise client foundation, not a complete SSO/RBAC/central-audit SaaS. / 企业版是客户端基础，不是完整的企业 SaaS。
- The installable, signed v1.2.0 release artifact is Android-only. iOS remains source/configuration-only and was not built, tested, signed or submitted to the App Store. / v1.2.0 可安装、已签名的发布产物仅有 Android；iOS 仅为源码/配置目标，未构建、测试、签名或提交 App Store。
- Open-source forks can modify the visible interface; official signing, release hashes, Git history and license notices provide provenance rather than an impossible technical promise that attribution can never be changed. / 开源 fork 技术上可修改界面；官方签名、哈希、Git 历史与许可证归属才是可验证溯源。

## Upgrade note / 升级提示

Upgrade from v1.1.0 was not verified in this release. Export local data before replacing or uninstalling any earlier build; debug-signed packages cannot be upgraded by this release certificate. / 本次发布未实测从 v1.1.0 覆盖升级。替换或卸载任何早期版本前请先导出本机数据；Debug 签名包无法被本发布证书直接覆盖。
