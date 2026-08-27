# Clinical Clarity backend

FastAPI 原型负责接收一张餐食图片、调用可注入的视觉识别边界，并用**版本化食品库**确定性计算热量。当前默认视觉实现是明确标记的 `DemoVisionProvider`：它返回固定候选，不分析图片，所有成功响应均为 `isDemo: true`。

## 科学边界

- `VisionProvider` 只能返回食物候选、估计克重、置信度、模型版本和假设。
- Provider 数据结构故意没有 kcal、宏量营养或每 100 g 营养值字段。
- `NutritionEngine` 使用食品库的 `energy_kcal_100g × estimated_grams / 100` 计算每项与总热量。
- 区间由份量置信度、食品匹配分数和资料质量等级 A–D 决定；它是估计范围，不是实验室检测结论。
- 任一候选无法可靠匹配时，请求会以 `422 FOOD_MATCH_LOW_CONFIDENCE` 拒绝，不会猜一个高风险结果。

## 隐私控制

- 仅接受真实内容与声明一致的 JPEG、PNG、WebP。
- 默认最大 8 MiB，可通过 `MAX_IMAGE_BYTES` 调低（最大允许配置为 32 MiB）。
- 图片写入权限为 `0600` 的系统临时文件，并在成功、拒绝或异常后统一删除。
- 服务代码不记录文件名、图片字节、临时路径或表单正文；响应使用 `Cache-Control: no-store`。
- 客户端 `X-Request-Id` 只接受受限字符与长度，防止日志/响应头注入。

## 本地运行

需要 Python 3.10 或更高版本。

食品库默认读取 Android 同一份只读资产：

`../android-app/app/src/main/assets/databases/clinical_clarity_foods.sqlite`

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --no-access-log
```

健康检查：`GET /healthz`。Android 契约：`POST /v1/analyze-meal` multipart fields `image`, `request_id`, `locale`, `market`。

## 注入正式识别实现

正式 Provider 只需实现 `app.providers.VisionProvider` 协议，并在进程启动时通过 `create_app(provider=...)` 注入。当前仓库**没有任何外部视觉 API 调用、密钥读取或暗藏的真实 AI 模式**。上线实现还应满足：

1. 返回值仍只包含候选与克重，绝不接受模型提供的热量。
2. `model_version` 必须固定到可审计版本；正式验证通过后才可设 `is_demo=False`。
3. 如需把图片发送到第三方，必须先新增单独的用户同意、数据处理协议、区域与保留期控制；本原型未授权该行为。
4. 不得在 Provider 内记录图片、临时路径、原始识别响应或秘密。

## 验证

```bash
.venv/bin/pytest
```

测试覆盖 Android JSON 字段、确定性热量公式、100% 占比分配、版本字段、低置信匹配拒绝、MIME 欺骗、大小限制、临时图片删除和明确 Demo 标记。

容器运行时需把只读食品库挂载到容器，并设置 `FOOD_DB_PATH` 指向挂载位置；镜像不会把数据库复制成第二份，避免移动端与服务端的数据版本悄悄分叉。
