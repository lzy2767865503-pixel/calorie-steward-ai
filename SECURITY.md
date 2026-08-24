# Security Policy / 安全政策

[中文](#中文) · [English](#english)

## 中文

### 支持范围

当前受支持的开源版本是最新的 GitHub Release 和默认分支。早期的 Clinical Clarity 原型只作历史参考，除非同一问题仍影响当前 `mobile-app/`，否则不承诺单独修复。

### 私密报告漏洞

1. 优先使用 GitHub 仓库 **Security → Report a vulnerability** 进行私密报告。
2. 若该入口尚未开启，请不要在公开 Issue 中粘贴利用代码、API Key、照片或个人数据。可以只发一个不含技术细节的 Issue，请求项目维护者开启私密报告。
3. 请提供受影响版本、影响范围、可重现的最小步骤、建议修复和联系方式，但不要提交真实用户数据。

项目会尽快确认报告，然后根据严重性给出修复和披露计划。在修复发布前，请避免公开技术细节。

### 不应报告的内容

- 单张照片热量估算的固有不确定性，除非存在绕过本地校验或伪造记录的可重现漏洞。
- 用户配置的第三方 AI Provider 自身的价格、限额或保留政策。
- 仅影响已不支持历史实验的问题。

### 密钥处理

不要提交或发布 Provider Key、企业 Token、Android 签名库、Apple 签名材料、`.env`、`local.properties` 或真实用户照片。若秘密已进入 Git 历史，先立即撤销/轮换，再清理历史；删除文件不等于密钥失效。

## English

### Supported versions

The latest GitHub Release and the default branch are supported. The earlier Clinical Clarity experiments are historical unless the same issue affects the current `mobile-app/` product.

### Report a vulnerability privately

Use **Security → Report a vulnerability** in the GitHub repository. If private vulnerability reporting is not enabled, do not place exploit details, credentials, meal photos or personal data in a public issue. Open a metadata-only issue asking the maintainer to enable a private channel.

Include the affected version, impact, minimal reproduction, suggested mitigation and a safe contact route. Avoid real user data. Please allow coordinated remediation before publishing technical details.

### Secrets

Never commit provider keys, enterprise tokens, Android signing stores, Apple signing material, `.env`, `local.properties` or real user photos. If a secret enters Git history, revoke or rotate it first and then rewrite the history; deleting the file alone does not invalidate the secret.

