# Calorie Steward for Windows Privacy Policy

Effective date: 27 August 2026

Calorie Steward for Windows is authored and published by **LAI ZEYU (来泽宇)**. It is a local-first meal journal and an AI-assisted nutrition-estimation tool. It is not a medical device, diagnosis, or substitute for a qualified clinician or dietitian.

## Data stored on the PC

The app stores structured meal records, profile references, report results, language choice, and confirmed AI-provider configuration in an app-private SQLite database on the user's Windows account. API credentials are stored separately with Electron `safeStorage`, which uses Windows operating-system credential encryption. The app does not include an API credential, create a developer account, or operate developer-controlled cloud storage.

The Windows edition does not retain meal photos. A selected source image is read in renderer memory, resized, re-encoded as JPEG, and stripped of EXIF/GPS metadata before analysis. The source file is not copied into app storage. The in-memory JPEG is released after cancel, retry, or saving the structured record.

## Data sent to a service chosen by the user

AI features work only after the user configures and verifies a supported AI service or organizational gateway and accepts the displayed transfer notice. For meal analysis, the re-encoded JPEG and prompt instructions are sent directly from the PC to that chosen endpoint. For reports, aggregate meal and nutrition information is sent to the same confirmed endpoint. The endpoint operator's terms, retention, security, and charges apply. Calorie Steward does not silently reroute this data to the developer.

## Collection, telemetry, and advertising

The Windows app has no developer analytics, advertising SDK, crash-reporting service, account system, or cross-device tracking. The developer does not receive meal records, photos, profile details, API credentials, or AI responses through the app.

## Export and deletion

The user can export a JSON copy of structured diet records through a Windows save dialog. API credentials, photos, local file paths, enterprise gateway details, and organization policies are excluded. The Settings screen can delete the configured credential and all local diet data. Uninstalling the Store package removes its app-local records; an exported file remains wherever the user saved it.

## Children and sensitive health information

Meal and profile information can be sensitive. The app is not directed to unsupervised children under 13. A parent or guardian should control any use by a child and the selected AI provider. Users should not enter information they are not authorized to process.

## Security and changes

The app uses a sandboxed renderer, a loopback-only local origin, operating-system credential encryption, explicit transfer consent, and no default photo retention. No software can guarantee absolute security. Material policy changes will be published in this repository and reflected in the app or Store listing when required.

## Contact

Privacy and support requests can be filed through the public repository's issue tracker: <https://github.com/lzy2767865503-pixel/calorie-steward-ai/issues>.

This repository is the authoritative public policy location: <https://github.com/lzy2767865503-pixel/calorie-steward-ai/blob/main/docs/privacy/windows.md>.
