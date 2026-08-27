# Microsoft Store certification notes — Windows 1.2.3

Author and publisher: **LAI ZEYU (来泽宇)**

The package is an Electron desktop application and therefore declares `runFullTrust`. It uses that capability only to host its bundled local UI on `127.0.0.1:47823`, open a Windows save dialog, and protect user-supplied API credentials with the operating system. It does not install a service, driver, shell extension, scheduled task, startup task, or global file association.

The reviewer can launch the app, inspect the bilingual setup and consent flow, and use local settings without an account. AI analysis requires a reviewer-supplied supported endpoint and credential; no developer credential is included. The app accurately reports an unconfigured connection and does not fabricate an analysis.

Meal source images are opened through the system picker. The renderer re-encodes pixels as JPEG, strips EXIF/GPS, and holds the result only in memory. The Windows edition disables photo retention. Structured records are stored in package-local SQLite. The app contains no developer telemetry or advertising.

Test accounts: none.

Restricted capability justification: `runFullTrust` is required by the Electron/Win32 runtime and the Windows Credential Protection/save-dialog bridge described above.
