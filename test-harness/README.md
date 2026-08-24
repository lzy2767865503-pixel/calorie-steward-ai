# Real vision E2E harness / 真实视觉端到端验证

`runThreeRealRounds.ts` sends three independently supplied images through the application's `openai_chat_compatible` adapter, HTTP transport, structured parser, conservative normalizer, semantic validator and recordability gate.

`runThreeRealRounds.ts` 将使用者自行提供的三张图片依次通过 App 的 `openai_chat_compatible` 适配器、HTTP 传输、结构解析、保守规范化、语义校验和可记录性门禁。

## Public-source image policy / 公开图片政策

The repository intentionally does **not** distribute the original regression images or raw result JSON. This avoids publishing meal photos without verified ownership, redistribution rights and personal-data clearance. The harness is not run automatically in public CI.

公开仓库故意**不包含**原始回归图片和原始结果 JSON，以避免在未确认所有权、再分发权和个人数据许可时公开餐食照片。公开 CI 不会自动运行该测试。

Only use images that you created, own or are licensed to process. Do not use real people's private photos without consent.

只能使用你自行创作、拥有或已获得处理许可的图片。未取得同意时，不要使用他人的私人照片。

## Inputs / 输入

Provide two different meal images and one non-food or empty-plate control. JPEG, PNG and WebP are accepted.

提供两张不同餐食图片和一张非食物/空盘对照图。支持 JPEG、PNG 和 WebP。

Set explicit paths:

```bash
export DIET_STEWARD_MEAL_IMAGE_1="/absolute/path/to/meal-one.jpg"
export DIET_STEWARD_MEAL_IMAGE_2="/absolute/path/to/meal-two.png"
export DIET_STEWARD_NON_FOOD_IMAGE="/absolute/path/to/empty-plate.webp"
./mobile-app/node_modules/.bin/tsx test-harness/runThreeRealRounds.ts
```

For local-only compatibility, the harness also checks these ignored paths when the environment variables are absent:

```text
test-harness/images/chicken-rice.png
test-harness/images/yogurt-fruit-bowl.png
test-harness/images/empty-plate.png
```

## Backend boundary / 后端边界

The local HTTP endpoint invokes an authenticated local Codex CLI for real vision inference. It is a developer verification backend, not a mock and not a substitute for acceptance testing against a production paid provider or enterprise gateway. No user provider key is stored by the harness.

本地 HTTP 端点通过已鉴权的本地 Codex CLI 进行真实视觉推理。它是开发验证后端，不是 mock，也不能替代真实付费 Provider 或企业网关的验收。Harness 不保存用户 Provider Key。

The CLI path can be overridden if necessary:

```bash
export DIET_STEWARD_CODEX_BIN="/absolute/path/to/codex"
```

## Pass criteria / 通过条件

1. Meal image 1 becomes a recordable meal with bounded nutrition estimates.
2. Meal image 2 becomes a different recordable meal with bounded estimates.
3. The control image is rejected as `NOT_FOOD` and cannot enter the diary.

1. 餐食图 1 生成可记录且有上下界的营养估算。
2. 餐食图 2 生成不同的可记录结果。
3. 对照图被 `NOT_FOOD` 拒绝，不得进入饮食日记。

Results are written to the ignored local path `test-harness/results/three-real-rounds.latest.json`. Review and redact evidence before publishing a summary.

结果写入已忽略的本机路径 `test-harness/results/three-real-rounds.latest.json`。公开证据摘要前必须人工审查并去标识化。
