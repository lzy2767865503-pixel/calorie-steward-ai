# Contributing / 贡献指南

Thank you for helping improve Diet Steward. / 感谢你帮助改进饮食管家。

## Before opening a change / 提交前

1. Search existing issues and pull requests.
2. Keep the current product boundary: camera-first meal entry, explicit uncertainty, fail-closed AI behavior and local deterministic scoring.
3. Do not add claims of medical accuracy, diagnosis, treatment or a verified accuracy rate without an independent study and review.
4. Never include credentials, signing material, personal data or user meal photos.

1. 先搜索已有 Issue 和 Pull Request。
2. 保持当前产品边界：拍照为主、显式不确定性、AI 失败即停止、本地确定性评分。
3. 没有独立研究与审查时，不得新增医疗精度、诊断、治疗或“已验证准确率”声明。
4. 不要包含凭据、签名材料、个人数据或真实用户餐食照片。

## Development / 开发

```bash
cd mobile-app
npm ci
npm run verify
```

If a change touches the historical catalogue pipeline:

```bash
cd data-pipeline
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m unittest -v test_build_food_database.py
```

Pull requests should explain the user problem, the chosen trade-off, privacy and scientific impact, test evidence and any migration risk. Keep changes focused and update both Chinese and English product copy when behavior changes.

Pull Request 需说明用户问题、取舍、隐私/科学影响、测试证据与迁移风险。功能行为变化时，中英文文案必须一起更新。

## AI-assisted contributions / AI 辅助贡献

AI tools are welcome, but the contributor remains responsible for every submitted line. Disclose material AI assistance in the pull-request description, review generated code, add tests and verify license compatibility. Never paste repository secrets or user data into an external model.

可以使用 AI 工具，但贡献者仍对每一行提交负责。请在 PR 中披露重大 AI 辅助，人工审查代码、补充测试并检查许可证兼容性。不要将仓库密钥或用户数据粘贴到外部模型。

## Attribution and license / 署名与许可证

By intentionally submitting a contribution, you agree that it is provided under Apache-2.0 unless you clearly mark it otherwise before submission. Preserve relevant copyright and attribution notices, including `NOTICE`. Modified files must carry the notices required by the license.

主动提交贡献即表示你同意在 Apache-2.0 下提供该贡献，除非你在提交前明确声明其他条款。请保留 `NOTICE` 等适用归属声明，并按许可证标注已修改文件。
