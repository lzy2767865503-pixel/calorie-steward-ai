# Microsoft Store certification notes — Windows 1.2.3

Author and publisher: **LAI ZEYU (来泽宇)**

The package is an Electron desktop application and therefore declares `runFullTrust`. It uses that capability only to host its bundled local UI on `127.0.0.1:47823`, open a Windows save dialog, and protect user-supplied API credentials with the operating system. It does not install a service, driver, shell extension, scheduled task, startup task, or global file association.

The reviewer can launch the app, inspect the bilingual setup and consent flow, and use local settings without an account. The app accurately reports an unconfigured connection and does not fabricate an analysis.

**Submission blocker:** before certification submission, the secure Partner Center tester notes must contain a dedicated, revocable, least-privilege test provider, exact HTTPS endpoint, vision model, report model, credential, expiry date, and the expected one-photo test sequence. Those secrets must be entered directly in Partner Center and must never be committed to this repository or bundled in the package. Until that dedicated test configuration is supplied and verified against the final package, this file is a template and the submission is not ready.

Meal source images are opened through the system picker. The renderer re-encodes pixels as JPEG, strips EXIF/GPS, and holds the result only in memory. The Windows edition disables photo retention. Structured records are stored in package-local SQLite. The app contains no developer telemetry or advertising.

App account: none. External AI tester configuration: **required before submission; not stored in source**.

Restricted capability justification: `runFullTrust` is required by the Electron/Win32 runtime and the Windows Credential Protection/save-dialog bridge described above.

Partner Center product declarations must identify that the app incorporates
generative-AI features. The automatic Windows/OneDrive app-data backup option
must be cleared for this product so private diet records and provider settings
are not represented as device-only while also being eligible for automatic
cloud backup.
