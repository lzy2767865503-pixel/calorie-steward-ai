# Calorie Steward v1.2.1 release compliance / 发布依赖合规记录

**Developer / 开发者：LAI ZEYU (来泽宇)**  
**Evidence time / 证据时间：2026-08-24T18:44:16Z**

The GitHub Release publishes the following machine-generated compliance assets
beside the signed APK. / GitHub Release 在签名 APK 之外同时发布以下机器生成的依赖合规产物：

| Asset / 产物 | Scope / 范围 | SHA-256 |
|---|---|---|
| `calorie-steward-v1.2.1-npm-sbom.spdx.json` | SPDX 2.3 production npm SBOM; 484 packages from the locked graph | `b872318c5af073abea5b1456d71d6a2516c30c81c593f5d022d2be1e12ea5b6c` |
| `calorie-steward-v1.2.1-third-party-licenses.txt` | npm inventory plus 204 unique installed license/notice texts | `affc43f18b55b706435bd74d23fb2b625010b8f889f0c7e50359f279cb71085c` |
| `calorie-steward-v1.2.1-android-runtime-dependencies.txt` | 772-line Gradle `releaseRuntimeClasspath` inventory; unused barcode/ML Kit modules absent | `343f424110a2641a06cf559157b37be1ec200a046f0a3ec14a2c171fc8f093ce` |
| `calorie-steward-v1.2.1-android-third-party-licenses.txt` | 160 Android runtime dependencies, 6 unique embedded texts and 0 unresolved entries | `dc527a35a4d6b4e2779c0215f288afa598e334e9b84c81867bb1afd46108c99f` |

The npm assets can be regenerated from the locked mobile dependency tree with:

```bash
RELEASE_EVIDENCE_UTC=2026-08-24T18:44:16Z node scripts/generate-release-compliance.mjs
```

The Android inventory is generated with
`scripts/generate-android-runtime-inventory.mjs`; the companion license bundle
is generated with `scripts/generate-android-license-bundle.mjs`. These are
regenerability statements for the inventories, not a claim that the application
build is bit-for-bit reproducible across environments. / 上述命令说明清单可从锁定依赖重新生成，
不代表 App 构建在不同环境下已达到比特级可复现。

These artifacts support technical due diligence but are not legal advice. A
production distributor remains responsible for reviewing upstream terms, store
policies, trademarks, export rules and notice obligations. / 这些产物用于技术尽调，不构成法律意见。

