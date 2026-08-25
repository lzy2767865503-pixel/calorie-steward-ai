# Calorie Steward v1.2.3 / 卡路里管家 v1.2.3

## 更容易识别，但不伪造 / More useful recognition without fabricated data

v1.2.3 / Build 7 调整了照片识别策略。只要 AI 返回包含明确食物身份与正数、有界热量，App 就优先展示可记录的宽区间估算；低置信度、未知状态或建议重拍不再自动导致整次失败。结果页会继续显示范围、置信度、假设和重拍入口。

v1.2.3 / Build 7 makes photo analysis best-effort by default. If the AI response contains an explicit food identity and a positive bounded calorie estimate, the app shows a recordable wide-range result instead of discarding it only because confidence is low, status is unknown, or a retake was suggested.

### 兼容性改进 / Compatibility improvements

- 通用 OpenAI-compatible API 会收到完整 `meal_analysis.v1` JSON Schema。
- 支持常见平面字段、数字字符串、一个 JSON 对象外的简短说明、分段文字和非标准 `finish_reason`。
- 轻度模糊、份量不确定、隐藏油脂或多组分会扩大区间并降低置信度，而不是优先拒绝。
- 不可用的克重或组分热量显示“未知”，不再显示误导性的 `0 g` / `0 kcal`。

- Generic OpenAI-compatible endpoints receive the complete `meal_analysis.v1` JSON Schema.
- Common flat fields, numeric strings, short prose around one JSON object, split text parts, and non-standard `finish_reason` values are accepted when the final result remains complete and valid.
- Mild blur, uncertain portions, hidden oil, and mixed dishes widen the interval and reduce confidence instead of causing an automatic rejection.
- Unavailable component weight or calories are shown as unknown rather than misleading zeroes.

### 仍然拒绝 / Still rejected

明确非食物、只有热量但没有食物身份、没有可用热量、负数、倒置区间、鉴权失败、内容过滤、Provider refusal 和损坏/多重 JSON 仍然不会写入记录。

Explicit non-food, calories without a food identity, missing calories, negative or inverted values, authentication failures, content filtering, provider refusals, and damaged or ambiguous JSON still fail closed.

### 验证 / Verification

- Version / 版本：`1.2.3 (7)`
- Application ID：`com.laisystems.dietsteward`
- Android：minSdk 24；target/compile SDK 36；4 ABIs
- 自动化测试：`196/196`（移动端 174、历史后端 15、食品管道 7）
- 本地真实视觉回归：清晰热食、轻度模糊餐食均可记录；空盘保持 `NOT_FOOD`
- Android API 24：全新安装与冷启动通过
- Android API 35：从同签名 v1.2.2 覆盖升级，`firstInstallTime` 保持不变
- APK SHA-256：`4598d47d26a44bb1e31272cca12054b2b8e504d6d94c8fdbfc7b71886e729450`
- 签名：单一 RSA-3072 signer，证书与 v1.2.2 相同，APK Signature Scheme v2

### 持续更新已上线 / Live update channel

- Kawan Campus 已发布 v1.2.3 / Build 7 清单，并将最低支持版本推进到 Build 7。
- v1.2.2 / Build 6 在冷启动和回到前台时都会显示必须更新；同签名覆盖安装 v1.2.3 后门禁自动解除。
- Kawan Campus 桌面与手机版均显示独立的 v1.2.3 下载入口，永久 latest 链接与版本化 APK 的公网下载哈希一致。

- The Kawan Campus manifest is live at v1.2.3 / Build 7 with minimum supported Build 7.
- v1.2.2 / Build 6 shows the required-update gate after cold start and foreground return; a same-signed v1.2.3 overlay clears it.
- Kawan Campus desktop and mobile surfaces show the independent v1.2.3 download entry. The stable latest URL and immutable versioned APK produced the same public-download digest.

本地 Codex 视觉回归是真实推理但不是付费 Provider、企业网关或临床准确率验收。卡路里结果仍是估算范围，不是实验室检测或医疗建议。

The local Codex vision regression used real inference, but it is not paid-provider, enterprise-gateway, or clinical-accuracy acceptance. Calorie results remain estimates, not laboratory measurements or medical advice.

Developed by **LAI ZEYU 来泽宇** using an AI-assisted vibe-coding workflow.
