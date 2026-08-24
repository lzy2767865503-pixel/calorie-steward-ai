# Calorie Steward v1.2.2 release compliance / 发布依赖合规记录

**Developer / 开发者：LAI ZEYU (来泽宇)**  
**Version / 版本：1.2.2 (6)**  
**Evidence time / 证据时间：`2026-08-24T20:37:02Z`**

These checksums and counts come from the final locked dependency graph and the
signed release candidate. Public GitHub and Kawan Campus state remains a
separate post-publication verification gate. / 下列数量与校验和来自最终锁定依赖图及签名
候选安装包；GitHub 与 Kawan Campus 的公开状态仍须在发布后单独核验。

The GitHub Release is expected to publish the following machine-generated
compliance assets beside the signed APK. / GitHub Release 计划在签名 APK 之外同时发布
以下机器生成的依赖合规产物：

| Asset / 产物 | Scope / 范围 | SHA-256 |
|---|---|---|
| `calorie-steward-v1.2.2-npm-sbom.spdx.json` | SPDX 2.3 production npm SBOM; 485 packages from the final locked graph | `16c51fa82a6ec9821f19d681dbd820c96d9a521973984e36cf4304f9ec08329d` |
| `calorie-steward-v1.2.2-third-party-licenses.txt` | npm inventory plus 204 unique installed license/notice texts | `c38eeb55ada17a04d064d513cfa6405780ce4303a596f27977304e185d0f0eb3` |
| `calorie-steward-v1.2.2-android-runtime-dependencies.txt` | 777-line Gradle `releaseRuntimeClasspath` dependency tree; no barcode/ML Kit runtime dependency modules | `c3774010f5f3679b99c5f9e56eb75f12fe902d4add8e02fdb156a8acf732fe91` |
| `calorie-steward-v1.2.2-android-third-party-licenses.txt` | 162 Android runtime dependencies, 6 unique embedded texts and 0 unresolved entries | `f9cd0424627f7de933ef1677c0d4471a6c7fc71b6a42562c05d112d56ec898e2` |

The npm assets can be regenerated from the final locked mobile dependency tree
with the release timestamp substituted below:

```bash
RELEASE_EVIDENCE_UTC=2026-08-24T20:37:02Z node scripts/generate-release-compliance.mjs
```

The Android inventory is generated with
`scripts/generate-android-runtime-inventory.mjs`; the companion license bundle
is generated with `scripts/generate-android-license-bundle.mjs`. All three
generators must run from the exact final release commit, and their output names,
counts and checksums must be reviewed before upload. / Android 运行依赖清单与许可证包分别由
上述脚本生成；三个生成器都必须针对最终发布 Commit 运行，并在上传前复核文件名、数量与哈希。

These are regenerability statements for the inventories, not a claim that the
application build is bit-for-bit reproducible across environments. / 这些命令只说明清单可从
锁定依赖重新生成，不代表 App 构建在不同环境下已达到比特级可复现。

## Update-channel publication artifacts / 更新通道发布产物

The long-term Android checker also depends on distribution artifacts outside
the software-bill-of-materials scope. They must be verified as one release set:
/ Android 长期版本检查器还依赖 SBOM 范围之外的分发产物，必须作为同一发布集合核对：

| Artifact / 产物 | Required release relationship / 必须满足的关系 | Final result / 最终结果 |
|---|---|---|
| `calorie-steward-v1.2.2-android-enterprise.apk` | Application ID `com.laisystems.dietsteward`, version `1.2.2 (6)`, same official signing identity | Verified; 81,187,073 bytes; SHA-256 `150d159681e451ada88bf46311dde851e2d486cb2a46201f46437be34da8c76a`; v2/RSA-3072 signature |
| `calorie-steward-v1.2.2-android-enterprise.apk.sha256` | Must contain the exact final APK SHA-256 | Verified locally; exact hash and filename recorded |
| Kawan Campus public release manifest | Version/build/hash must match the APK; download and checksum URLs must both be live | Pending the separate post-GitHub publication gate; must not advance early |
| GitHub Release | Tag, source commit, APK, checksum and compliance assets must be publicly reachable | Pending the separate public-release gate |

The client validates the manifest structure, application identity, release
metadata, SHA-256 syntax and official URL allowlist. It does **not** hash the APK
after the browser downloads it and does **not** install the package itself.
Android performs package/signature checks during the user-controlled install;
the `.sha256` remains an independent verification artifact. / 客户端会校验清单结构、
应用身份、版本元数据、SHA-256 格式与官方 URL 白名单，但不会在浏览器下载后自行计算 APK
哈希，也不会自行安装；安装时的包与签名检查由 Android 完成，`.sha256` 用于独立核验。

## Privacy and legal boundary / 隐私与法律边界

The release-manifest request is credential-free and carries no photos, diet
records, profile fields, provider settings or API secrets. This statement covers
the implemented client request only; hosting access logs and third-party browser
or download behavior remain governed by their respective operators and policies.
/ 版本清单请求不携带凭据、照片、饮食记录、个人资料、Provider 设置或 API 密钥；该结论
只覆盖客户端已实现请求，托管访问日志以及第三方浏览器/下载行为仍由各自运营者与政策约束。

These artifacts support technical due diligence but are not legal advice. A
production distributor remains responsible for reviewing upstream terms, store
policies, trademarks, export rules, privacy disclosures and notice obligations.
/ 这些产物用于技术尽调，不构成法律意见；生产分发者仍须审查上游条款、商店政策、商标、
出口规则、隐私披露与 Notice 义务。

## Publication gate / 发布门禁

The dependency/compliance bundle is complete. The release is public only after
the GitHub assets and checksum are fetched independently and the matching Kawan
Campus manifest is deployed and re-read from the public endpoint. / 依赖与合规产物已完成；
只有 GitHub 资产及校验文件可独立读取，且匹配的 Kawan Campus 清单部署并从公网重新读取后，
才可称为公开发布完成。
