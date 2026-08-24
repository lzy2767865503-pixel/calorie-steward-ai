# Calorie Steward / 卡路里管家 v1.2.1 企业托管部署说明

版本：1.2.1 (5)（客户端策略 `diet-enterprise-client.v1`）  
开发者：LAI ZEYU (来泽宇)

## 定位

本次发布的可安装产物是支持中文 / English 切换的 Android 企业托管客户端基础版；iOS 仅为源码/配置目标，未构建、签名或发布。员工在手机上填写组织、工作区、环境、数据区域声明、企业网关地址和短期 Token；模型选择、AI 厂商主密钥、限额和供应商合同应由企业网关管理。

它不等于完整企业 SaaS。当前客户端没有内置 SSO/OIDC、员工账号、RBAC、设备注册、远程停用、集中式不可篡改审计、跨设备同步或任何 SOC 2 / ISO 27001 / HIPAA 认证。数据区域是管理员声明，客户端无法证明服务端实际驻留或删除行为。

## 推荐数据流

```text
Android App (iOS is an unreleased source target)
  -> HTTPS 企业网关（短期、可撤销的工作区 Token）
     -> 组织选择的视觉 AI / 报告 AI
     -> 服务端限流、费用、日志与保留策略
```

禁止把 AI 厂商长期主 Key 下发到员工手机。真正的租户身份必须由网关从受验证的登录令牌推导，不能信任客户端自报的工作区 ID。

## 网关契约

企业托管模式复用公开的 `diet-ai.custom.v1` 契约：

1. App 从已配置完整 base path 下读取 `<base-path>/.well-known/diet-ai.json`；例如 base URL 为 `https://gateway.example/tenant-a/api` 时，manifest 位于 `https://gateway.example/tenant-a/api/.well-known/diet-ai.json`。
2. manifest 必须严格声明分析路径、报告路径、鉴权方式、MIME、大小上限及 schema 版本。
3. 分析和报告路径必须与 manifest 同源且严格位于同一完整 base path 内；兄弟租户路径、路径遍历、歧义编码、重定向、跨域 URL、URL 内嵌凭据及鉴权头覆盖会在发请求前被拒绝。
4. 照片结果必须通过 `meal_analysis.v1` 结构校验；报告必须通过 `diet_report.v1` 结构校验。失败时 App 停止，不回退到固定热量。
5. 首次连接必须用真实照片完成端到端验证，不能用 ping 代替视觉验证。

网关至少应实现：TLS、短期 Token 签发/轮换/撤销、tenant 强制隔离、速率与费用限制、请求 ID、脱敏日志、供应商超时、数据保留/删除流程和事故响应。

## 客户端治理

- API 凭据只保存到 iOS Keychain / Android Keystore 对应的 SecureStore，不进入 SQLite 或导出。
- 企业凭据和同意范围绑定到完整网关路径、规范化组织名称、大小写敏感的工作区 ID、环境、数据区域声明和策略版本；变化后必须重新授权。
- 同意范围明确包括餐食照片和 AI 报告所需的聚合饮食指标。
- 企业托管模式强制不保留原始餐食照片；切换模式或启动既有企业配置时，会先清理历史照片并在全部文件清理成功后清空数据库引用。
- 饮食导出格式 v2 使用显式字段白名单，不包含凭据、照片、网关地址、供应商/模型/请求诊断、组织配置或连接健康信息。临时 JSON 在写入明文前先登记清理地址，登记、写入和分享共用同一串行锁；删除失败会在下次启动前重试。
- 餐食保存会先确认临时照片已删除，再提交 SQLite。提交返回异常时会按餐食 ID 区分“已提交 / 未提交 / 无法确认”；无法确认时保留可能被引用的照片副本，且不提示用户重复记录。
- 单餐及全部删除先清理本机照片，再提交结构化记录删除；文件清理失败时保留数据库引用以供重试，单餐删除同时失效包含该日期的 AI 周期报告。
- 设置页展示的是设备本机治理状态，不是不可篡改的集中审计日志。

## Android 企业签名

release 构建不再回退到公开 debug keystore。构建环境必须提供：

- `DIET_RELEASE_STORE_FILE`
- `DIET_RELEASE_STORE_PASSWORD`
- `DIET_RELEASE_KEY_ALIAS`
- `DIET_RELEASE_KEY_PASSWORD`

缺失任何一项时，release 任务会失败。签名文件和密码应保存在 CI Secret / 企业密钥库，不得提交到代码仓库。v1.2.1 与 v1.2.0 使用同一证书，已在 Android API 35 验证 `adb install -r` 覆盖升级、保持 `firstInstallTime` 并冷启动进入新品牌界面；本次未另行创建并逐项核对真实餐食、语言与 SecureStore 数据的迁移。由于 1.0.1 内测包使用不同签名，安装 v1.2.1 前需先导出饮食记录再卸载旧包；卸载会删除旧包的本机数据。当前 v1.2.1 尚无导入界面，导出 JSON 仅是备份，不会自动恢复到新版。

## 发布门禁

- TypeScript、单元/契约/隐私测试全部通过。
- 历史本地三图功能回归使用两张餐食图片和一张空盘，通过本机鉴权 Codex 视觉代理进行了真实推理（非 mock），并验证范围、置信度与 `NOT_FOOD` 拒绝路径；这是一次私密输入的历史本地功能运行，不是公开 CI、最终 APK 付费 Provider 验收、企业网关端到端验收或准确率基准。
- APK 通过 `apksigner verify --verbose --print-certs` 与 `zipalign -c`。
- 证书不是 Android Debug；权限只包含发布清单允许项。
- 目标 Android 模拟器的安装与冷启动通过；拍照取消、照片保留策略、导出清理和删除顺序由自动化测试覆盖。企业发布前仍须在受管物理设备上完成相机、系统分享、Keystore、生物识别和企业网关端到端验收。
- 记录版本、SHA-256、构建时间、applicationId、versionCode 和测试证据，并将可公开摘要写入 `docs/RELEASE_EVIDENCE_v1.2.1.md`。

客户端的提交三态核对、重启清理和并发顺序已由自动化测试覆盖；本次没有执行真实 App 进程 kill、系统崩溃或断电故障注入。SQLite 使用 `WAL + synchronous=NORMAL`，因此不宣称这些场景“绝对零残留”。
