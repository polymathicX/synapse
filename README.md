# Synapse

A local-first browser extension for keeping your working context when switching AI services.

**The everyday flow:** enable Synapse once on your services → click the floating **✳ Save chat** → open the saved-context tray in another service → drag an entry into an empty composer, or click **Insert**. Synapse prepares a draft; you decide when to send it.

## Install locally

Requires Node.js **26.6.0** and npm. Production builds contain packaged code only.

```sh
npm ci
npm run check
npm run package
```

- **Chrome / Brave:** open `chrome://extensions` or `brave://extensions`, enable Developer mode, select **Load unpacked**, and choose `.output/chrome-mv3`.
- **Firefox:** open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select `.output/firefox-mv3/manifest.json`. Temporary installs are removed on restart; a signed Firefox distribution is needed for normal persistent installation. Data-restart tests use Chromium profiles, not temporary Firefox installs.
- Local ZIP packages and SHA-256 checksums are written to `artifacts/`. These are unsigned local builds; nothing is published to extension stores.

Open a provider, click the Synapse toolbar icon, and select **Enable floating Synapse on this service**. Alternatively open **Workspace** and check the services in the setup card. The first grant is required by the browser; after that saving and resuming happen on the chat pages.

## What is implemented

- Floating one-click save, five recent draggable entries, insertion into an empty composer, and a workspace for all entries.
- Structured summaries, selected messages, decisions, constraints, goal, task status, next steps, source, and capture warnings.
- Transactional IndexedDB saves, conflict detection, V1→V2 migration, metadata-only pagination, and explicit deletion.
- Original binary storage for arbitrary file types, JSON context import/export, Markdown handoffs, and portable ZIP bundles with CRC and SHA-256 integrity checks.
- Local UTF-8/Markdown/LaTeX/code extraction, PDF text with page references, and DOCX/PPTX text with slide references. Originals remain available when extraction fails. Images have local previews; no OCR or cloud vision is included.
- Per-service optional auto-save in the floating tray. It is off by default, observes conversation changes without polling, and refuses to replace larger saved history with a smaller or differently windowed capture.
- Adapters for ChatGPT, Claude, DeepSeek, Kimi, and Qwen. Unknown layouts fall back to manual context and file transfer.

## Boundaries that matter

Provider adapters have **synthetic fixture coverage**, not authenticated live-service certification. Sites change their markup. Captures include loaded messages; Synapse cannot recover hidden history, provider memory, or original bytes that a page does not expose. Add original files through the workspace when necessary.

Drag/drop and Insert transfer the text handoff. Files are listed in the handoff and preserved locally, but require separate upload. Automatic binary attachment staging stays disabled until a provider integration is verified. The tray's **Review / files** button opens originals for download.

Limits: 64 MiB per original, 256 MiB per bundle, 8 MiB context JSON, 2,000 messages, 200 attachments. Extraction is bounded and may be partial. Provider context/upload limits also apply. A handoff that exceeds the default 30,000-character budget keeps structured fields and explicitly reports omitted conversation turns; shorten large structured fields when needed.

## Development and verification

```sh
npm run dev                  # Chromium MV3
npm run dev:firefox          # Firefox MV3 event page
npm run typecheck
npm run lint
npm test
npm run build                # both browsers + manifest/bundle budgets
npm run lint:firefox
npx playwright install chromium firefox
npm run test:e2e
npm run check:reproducible
npm audit --omit=dev
```

The installed-extension tests use a disposable copy with host grants for controlled ChatGPT/Claude fixtures. A separate test uses the unmodified least-privilege production manifest. No real account, conversation, or existing browser profile is used.

To run the Chromium extension suite against an installed Brave browser in PowerShell:

```powershell
$env:SYNAPSE_TEST_BROWSER = 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe'
npm run test:e2e
Remove-Item Env:SYNAPSE_TEST_BROWSER
```

Firefox validation fails on any error or unexpected warning. Two narrowly reviewed PDF.js variable-import warnings remain visible in `artifacts/firefox-lint.json`; the application supplies a packaged worker port, disables WASM/image rendering, and restricts executable resources to the extension. Store review and authenticated browser/provider checks remain release gates. See [verification](docs/verification.md).

## Privacy

No accounts, API keys, telemetry, cloud synchronization, or remote scripts. Browser permissions are granted per service. A context becomes accessible to a destination when you drag/drop, insert, or manually paste it; the destination may sync drafts before you press Send.

Storage and exports are **unencrypted**. Persistent storage is requested but not guaranteed. Keep exported backups: uninstalling the extension or losing a browser profile can remove your library. See [privacy](docs/privacy.md), [architecture](docs/architecture.md), [research](docs/research.md), and [milestones](docs/roadmap.md).
