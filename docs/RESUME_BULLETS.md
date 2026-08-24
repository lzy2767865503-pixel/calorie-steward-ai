# Resume bullets / 简历要点

These bullets are deliberately evidence-bounded and use the verified v1.2.2 release results. Do not add user, revenue or accuracy numbers unless they come from a documented study.

以下要点可直接使用，其中 v1.2.2 数字来自已验证的发布证据。没有正式证据时，不要增加用户数、营收或准确率。

## 中文简历版

### 产品 / 商业分析方向

- 发起并主导中英双语 AI 卡路里管家 Calorie Steward，从“手工记录摩擦高”与“拍照热量假精确”两个用户问题出发，设计拍照—估算区间—确认—长期趋势的完整产品链路。
- 将单次 AI 识别转化为日/周/月/年饮食记录与可解释 DietScore，并定义个人 BYO API 与企业受管网关两类商业路径。
- 把隐私、准确性与失败边界纳入产品验收：照片去 EXIF/GPS、默认删除、本地确定性评分，AI 失败时拒绝生成假数据。

### AI / 技术产品方向

- 使用 AI-assisted vibe coding 构建 Expo React Native + TypeScript 跨平台代码库，完成 Android 签名包验证，并设计多 Provider 结构化契约、严格本地校验、SQLite 事务记录、SecureStore 凭据管理和失败即停止机制；iOS 仅为源码兼容，未完成签名发布。
- 通过模型契约与确定性代码分工：AI 负责提出菜品、份量与营养范围，应用负责数值/一致性校验、汇总和评分，降低将生成内容直接写入健康记录的风险。
- 建立 GitHub CI 门禁，覆盖移动端类型/自动化测试、历史后端/食品库单元测试、移动端 npm 依赖树高/严重级 advisory 审计、高置信密钥扫描与官方署名检查；v1.2.2 通过 **185/185** 项自动化测试，并完成 v1.2.1 同签名覆盖升级及启动/回前台持续版本检查后发布 Android 作品集 APK，iOS 仅为未发布的源码兼容目标。

### 一行项目描述

> Calorie Steward 发起人与产品开发者：使用 AI-assisted vibe coding 将拍照营养估算、不确定性设计、长期饮食分析与企业网关治理整合为中英双语移动产品。

## English resume version

### Product / business roles

- Initiated and product-led Calorie Steward, a bilingual AI nutrition journal, translating two user problems—manual-logging friction and false precision from photo calorie estimates—into a camera-to-range-to-confirmation-to-longitudinal-insight journey.
- Extended one-off AI inference into daily, weekly, monthly and yearly nutrition records with an explainable DietScore, while defining separate BYO-API and managed enterprise-gateway paths.
- Made privacy, uncertainty and refusal behavior release criteria: EXIF/GPS removal, default photo deletion, deterministic local scoring, and fail-closed behavior instead of fabricated fallback results.

### AI / technical product roles

- Built an Expo React Native + TypeScript cross-platform codebase through an AI-assisted vibe-coding workflow, verified the signed Android release, and designed multi-provider structured contracts, strict local validation, transactional SQLite records, SecureStore credential handling and explicit failure states; iOS remains source-compatible but unsigned and unreleased.
- Separated generative inference from deterministic policy: AI proposes dish, portion and nutrition ranges; application code validates numeric consistency, aggregates longitudinal data and computes scores.
- Established GitHub CI for mobile type/tests, historical backend/catalogue units, high/critical advisory auditing of the locked mobile npm dependency tree, high-confidence secret scanning and official attribution checks; published the signed Android portfolio APK after **185/185** automated tests, a same-signed v1.2.1 in-place upgrade and startup/foreground release checks passed, while keeping iOS explicitly source-compatible but unreleased.

### One-line project description

> Creator and product developer of Calorie Steward, a bilingual mobile product that combines AI-assisted food-photo estimation, uncertainty-aware design, longitudinal nutrition insights and managed-gateway governance.

## Interview explanation / 面试可说

### 中文

我做 Calorie Steward 不是从“我想调一个 AI API”开始，而是从用户为什么无法长期记录饮食开始。我保留了最快的拍照入口，但没有把 AI 估算包装成精确测量，而是设计范围、置信度、失败拒绝和本地确定性评分。我用 AI-assisted vibe coding 加快实现和测试，但产品问题、架构边界、验收标准和最终责任由我决定。它展示的是我把 AI 转化成一个可使用、可验证和有商业路径的系统的能力。

### English

I did not start Calorie Steward with “I want to call an AI API.” I started with why people fail to maintain a food log. I kept the fastest camera-first entry but did not package an estimate as an exact measurement; I designed ranges, confidence, refusal states and deterministic local scoring. AI-assisted vibe coding accelerated implementation and testing, while I owned the product question, architecture boundaries, acceptance criteria and release accountability. The project demonstrates my ability to turn AI into a usable, testable system with a credible commercial path.

## Do not claim / 不要宣称

- “识别准确率 95%” / “95% accurate”—no independent benchmark supports it.
- “已有用户/客户/营收” / existing users, customers or revenue—not documented.
- “医疗级” / medical grade—the app is not a medical device.
- “企业 SaaS 已完成” / complete enterprise SaaS—SSO, RBAC and centralized immutable audit are future work.
