# Diet Steward / 饮食管家——产品与 AI 设计案例

**Creator, product lead and developer / 发起人、产品负责人与开发者：LAI ZEYU (来泽宇)**  
**Method / 方法：AI-assisted vibe coding with human-owned product and release decisions / AI 辅助 vibe coding，人负责产品与发布决策**

[中文](#中文) · [English](#english)

## 中文

### 1. 问题发现

饮食记录并不是没有工具，而是很多工具要求用户搜索食物、匹配菜名、估算克重和手动输入。这种摩擦使“每天坚持”比“偶尔记一次”难得多。拍照可以降低记录成本，但如果产品只给出一个看似精确的热量数，就会隐藏份量、烹调油、酱汁和配方差异。

我将产品问题定义为：**如何让饮食记录快到愿意每天使用，同时让 AI 对自己的不确定性负责？**

### 2. 待验证的用户假设

以下判断来自产品与工作流分析，尚未经过正式用户研究验证：

- 用户真正想要的不只是一餐的 kcal，而是“我这段时间吃得怎么样”。
- 一个需要多次选择和输入的流程，会让数据在还没有价值前就中断。
- 对健康相关产品，“不知道”和“需要重拍”是有价值的结果，不应被 Demo 或旧数据掩盖。
- 个人用户可以接受 BYO API，但企业使用者需要租户、同意、数据区域、凭据和审计边界。

### 3. 商业假设

本项目的商业假设是：如果产品能用一次拍照代替手工记录，并把单次估算转换成可追踪的长期饮食结构，就可能为三类场景提供价值：

1. 个人健康管理：降低记录成本，用趋势代替对单餐数值的过度关注。
2. 营养与健身服务：让用户与教练看到有时间范围、数据覆盖率和不确定性的结构化记录。
3. 企业健康计划：通过受管网关、范围化短期 Token 和可声明的数据区域，建立可治理的客户端基础。

这些是待验证的商业假设，不是已有营收、付费客户或活跃用户的声明。

### 4. AI 与产品架构

我没有把大模型放在所有决策的中心，而是把它限定为“生成结构化估算和文字解释”的组件。

- 照片先在本机缩放、重编码并移除 EXIF/GPS。
- 只有经用户同意且凭据范围匹配时，才发送到用户的 API 或企业网关。
- 模型返回菜品、份量、营养范围、证据和假设；本地代码再校验 schema、数值边界和宏量营养一致性。
- 日/周/月/年汇总和 DietScore 从本机餐次确定性重算，AI 无权改分。
- AI 报告只获取匿名汇总和已计算分类，不获取照片、姓名、精确位置或 API Key。

这套边界展示的 AI 设计能力不是“能调用一次模型”，而是把模型嵌入一个有契约、失败状态、隐私范围和确定性规则的产品系统。

### 5. 隐私与科学边界

应用不请求整个相册，API Key 保存在 SecureStore，照片默认不保留。企业模式对网关完整路径、组织、工作区、环境、数据区域和策略版本进行绑定，避免凭据在范围之间默默复用。

科学上，单张照片不能确定隐藏油、糖、酱汁、内馅和精确克重。因此记录使用上下限和置信度；数据覆盖不足时拒绝给出可审计的单一健康分数。DietScore 的参考范围来自 WHO/FAO 健康成人建议，但权重和 0–100 算法是产品政策，不是 WHO 官方评分。

### 6. 验证方法

验证不只是“页面能打开”，而是包括：

- TypeScript 类型检查和领域规则自动化测试。
- Provider 协议、输出解析、数值边界、非食物与失败路径测试。
- 数据库事务、照片删除失败重试和导出清理测试。
- 历史本地三图功能回归：两张餐食图片与一张空盘通过本机鉴权的 Codex 视觉代理进行真实推理（非 mock），验证了可记录和 `NOT_FOOD` 拒绝路径。它不在公开 CI 中运行，私密输入/原始结果不公开，也不构成最终 APK 付费 Provider 验收、企业网关生产验收或准确率基准。
- Android 签名包的安装、冷启动、权限、签名与密钥残留检查。
- GitHub CI 在 `main` 分支 push、pull request 或手动触发时运行移动端验证、历史后端/食品库单元测试、`mobile-app/package-lock.json` 锁定 npm 依赖树的高/严重级 advisory 审计、高置信密钥扫描和官方署名检查。这不等于已对 Gradle、Python 或所有供应链风险完成全面审计。

上述证据支持“已实现并验证产品链路”，但不支持“已达到某个未经测量的准确率”。

### 7. 商业价值

- **更低的行为摩擦**：拍照路径比手工搜索和填表更适合频繁记录。
- **更长的数据价值链**：从一餐估算扩展到日/周/月/年的饮食结构。
- **可解释的信任**：使用范围、证据和拒绝状态，而不是用“AI 很确定”代替证据。
- **可扩展的供应商层**：多 Provider 契约降低对单一模型的绑定。
- **企业化起点**：客户端可连接组织自行运营的 HTTPS 网关，并绑定凭据、租户、区域声明与同意范围；仓库不包含生产网关、Token 签发服务、SSO、RBAC 或中央审计 SaaS。

### 8. 局限

- 尚未完成至少 5,000 盘称重餐食的独立准确率基准。
- 尚未验证真实付费 Provider 和企业网关的全链路生产性能。
- 尚无真实用户增长、留存、付费转化或营收数据。
- 当前是企业客户端基础，不是完整的 SSO/RBAC/中央审计 SaaS。
- iOS 源码配置不等于已经完成 App Store 签名与审核。

本次实际发布的可安装产物只有已签名 Android APK；iOS 仅是跨平台源码/配置目标，未构建、验收、签名或提交 App Store。官方 App 界面、签名证书、Git 历史、NOTICE、AUTHORS 和 CITATION.cff 共同记录 **LAI ZEYU (来泽宇)** 的官方来源；但开源 fork 在技术上可以修改界面，因此不做“可见署名永远无法被移除”的不可实现承诺。

### 9. 下一步

1. 建立马来西亚主要菜系的称重基准集，按菜系、设备、光线和价格带分组评估。
2. 用可丢弃短期 Token 建立最小企业网关，补充租户 RBAC、限额、费用和删除回执。
3. 进行小规模用户研究，测量拍照完成率、7 日记录持续率和估算修正率，再决定付费模式。
4. 完成 iOS 真机、可访问性、低网络和突然断电故障注入验收。

## English

### 1. Problem discovery

The market does not lack food trackers; it lacks a sufficiently low-friction way to build a reliable daily habit. Search, dish matching, gram estimates and manual forms create abandonment before the data becomes useful. A photo can reduce that effort, but one apparently exact calorie value hides uncertainty from portions, oil, sauces and recipes.

I framed the product question as: **How can nutrition logging become fast enough for daily use while making the AI accountable for uncertainty?**

### 2. User hypotheses to validate

These statements come from product and workflow analysis and have not yet been validated through formal user research:

- The durable need is not just “How many calories were in this meal?” but “What does my diet look like over time?”
- Every extra choice before capture increases the chance of losing the record.
- In a health-adjacent product, “unknown,” “not food” and “retake required” are valuable outcomes, not failures to conceal with demo data.
- Personal BYO-key use and organizational deployment require different governance boundaries.

### 3. Commercial hypothesis

If one photo can replace manual logging and each estimate becomes part of a transparent longitudinal record, the product may create value in personal wellness, coaching/nutrition services and managed employee-wellness programs. The client supports personal BYO API use and can connect to an organization-operated HTTPS gateway with credential, tenant, region-declaration and consent-scope binding. This repository does not include a production gateway, token issuer, SSO, RBAC or centralized-audit SaaS.

This is a hypothesis to test. The project does not claim existing revenue, customers, active users or conversion.

### 4. AI and product architecture

The generative model is not the authority for every decision. It proposes structured meal components, portions, nutrition ranges, evidence and assumptions. Deterministic client code validates the schema, numeric bounds and macronutrient consistency before anything can enter the record. Local records generate daily/weekly/monthly/yearly summaries and DietScore; AI may explain computed anonymous aggregates but cannot alter the score.

That boundary demonstrates AI product design beyond a one-off API call: model contracts, explicit failure states, privacy scope, deterministic policy and evidence-backed release criteria.

### 5. Privacy and scientific boundary

The app avoids broad photo-library access, stores credentials in SecureStore, re-encodes images without EXIF/GPS and defaults to deleting them. Managed mode binds authorization to gateway path, organization, workspace, environment, declared region and policy version.

A photo cannot determine hidden ingredients or exact grams. Results therefore preserve ranges and confidence. DietScore uses WHO/FAO adult reference ranges, but its weights and 0–100 formula are a product policy, not an official WHO score or clinical tool.

### 6. Validation

Validation spans type checks, domain tests, provider contracts, refusal paths, database/file-cleanup behavior, historical local three-image functional regression, and Android package installation/signature/permission checks. In the historical run, two meal images and an empty-plate control went through an authenticated local Codex vision proxy using real inference rather than a mock: the meals reached the recordable path and the control reached `NOT_FOOD`. The private inputs/raw results are not published and the run is not part of public CI, final-APK paid-provider acceptance, enterprise-gateway production acceptance or an accuracy benchmark. Repository CI also checks mobile tests, historical backend/catalogue units, high/critical npm advisories for the dependency tree locked by `mobile-app/package-lock.json`, high-confidence secret patterns and official attribution; it does not audit Gradle, Python or every supply-chain risk.

This supports the statement “the implemented product path has been verified.” It does not support an invented model-accuracy percentage.

### 7. Commercial value

- Lower behavioral friction through a camera-first journey.
- A longer value chain from a meal estimate to longitudinal structure.
- Explainable trust through ranges, evidence and refusal states.
- Provider portability through versioned contracts.
- A governance-ready client starting point for future SSO, RBAC, cost control and centralized audit.

### 8. Limitations

There is no large independently weighed accuracy benchmark, production paid-provider/gateway acceptance, user-growth dataset or revenue evidence yet. The managed capability is a client foundation rather than a complete enterprise SaaS. The only installable, signed artifact released here is Android; iOS remains an unbuilt, untested, unsigned and unreleased source/configuration target.

The official app UI, signing certificate, Git history, NOTICE, AUTHORS and CITATION.cff preserve strong provenance for **LAI ZEYU (来泽宇)**. An open-source fork can technically alter the interface, so the project does not make the impossible promise that visible attribution can never be removed; license duties and verifiable official-release history provide the durable record.

### 9. Next steps

Build a weighed Malaysian-food benchmark; operate a short-lived-token gateway with tenant controls; run small user studies measuring capture completion and seven-day continuity; and complete iOS, accessibility, poor-network and abrupt-power-loss acceptance.
