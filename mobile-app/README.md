# 卡路里管家双端客户端

同一份 Expo React Native + TypeScript 业务代码面向 Android 和 iOS。当前版本只保留“拍照识别”一种餐食录入方式。

## 核心规则

- 未配置 API：停留在首页接入向导，不展示伪造的识别结果。
- 首次验证：必须实际拍照并完成图片相关的结构化返回校验，才标记 API 可用。
- 识别失败：显式停止，不降级到 Demo、固定数值或旧结果。
- 记录确认：用户看到热量范围、主要组成、置信度和假设后，可以做±15% 份量校正再写入 SQLite。
- 统计与评分：全部从本机原始餐次重算，AI 不决定日/周/月/年总计或分数。
- 报告：AI 只读取程序已计算的匿名汇总与指标分类，不传照片、姓名、精确地点或 API Key。

## API 适配器

| 类型 | 协议 | 典型基础地址 |
|---|---|---|
| OpenAI | Responses API | `https://api.openai.com/v1` |
| OpenAI-compatible | Chat Completions + vision + JSON mode | 用户填写 HTTPS 地址 |
| Google Gemini | Interactions API | `https://generativelanguage.googleapis.com/v1beta` |
| Anthropic Claude | Messages API | `https://api.anthropic.com/v1` |
| Custom | Diet AI Contract | 用户填写 HTTPS 地址 |

适配层使用 `meal_analysis.v1` 与 `diet_report.v1` 契约。对仅支持 JSON mode 的服务，App 会兼容字段别名、数字字符串和单层 JSON 代码块，然后在本机严格检查 MIME 文件魔数、数值边界、上下界顺序、热量/宏量营养一致性及非食物状态。未知或缺失状态绝不会因夹带热量数字而自动入账。

## 数据和隐私

- 业务数据：Expo SQLite，WAL + foreign keys + 连续迁移。
- API 密钥：Expo SecureStore，按 Provider 类型、端点 origin 和认证类型隔离，与可导出配置分离。
- 图片：拍摄后在本机缩放、重新编码、移除 EXIF/GPS；默认调用后删除。
- 导出：JSON 含餐食、每日状态、个人化参考和报告；不含 API Key、原始照片或本机文件路径。
- 删除：事务删除餐食/日状态/报告，并尝试清理已保留的本地照片。

注意：在可分发的生产 App 内长期直连第三方 API 仍有密钥暴露风险。个人 BYO-key 模式使用 SecureStore；企业部署建议改接用户自己的 HTTPS 代理，由服务端密钥库管理 Provider 凭据。

## 本地验证

```bash
npm install
npm run verify
npx expo-doctor
```

Android：

```bash
npx expo prebuild --platform android --no-install
cd android
./gradlew assembleDebug
```

iOS 工程：

```bash
npx expo prebuild --platform ios --no-install
```

安装到真实 iPhone 需要 macOS 上的完整 Xcode、CocoaPods 和 Apple Developer 签名。云构建可使用仓库中的 `eas.json`，但需要用户自己的 Expo/Apple 账号。

## 运行边界

- 没有用户的真实 API Key 时，自动化仍验证 Provider 协议、schema、失败边界和本地算法；`test-harness/` 还可通过本机鉴权的 Codex 视觉代理发起真实图片推理。该代理不能替代用户在真实手机上的线上 Provider 能力测试。
- 本客户端不是医疗设备，不适用于诊断或药物/治疗决策。
