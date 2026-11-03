# Browser platform research

Research date: 2026-11-03. These findings describe documented platform capabilities and engineering decisions. They do **not** verify Synapse behavior, authenticated provider integration, performance, or attachment fidelity. Consult the project's test results and compatibility records for those claims.

## Tooling and browser targets

The WXT documentation inspected identifies its current release as **0.21.5**. Pin the selected version and package-manager lockfile for reproducible installation; reassess upgrades deliberately. WXT supports browser-specific manifests, TypeScript, vanilla HTML entrypoints, and separate browser builds. It is suitable as build tooling without requiring a UI framework. This is a maintainability choice, not a measured performance comparison with other frameworks. [WXT targeting](https://wxt.dev/guide/essentials/target-different-browsers), [WXT entrypoints](https://wxt.dev/guide/essentials/entrypoints)

Explicitly target MV3 in both production builds: `wxt build --mv3` and `wxt build -b firefox --mv3`. WXT otherwise defaults Firefox to MV2. Inspect generated manifests in tests: Firefox MV3 uses nonpersistent background scripts/event pages, while Chromium MV3 uses a service worker. A single source entrypoint therefore does not imply identical output manifests. [WXT manifest versions](https://wxt.dev/guide/essentials/target-different-browsers), [Mozilla background manifest](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background)

Use native WebExtension APIs through `wxt/browser`. Its current implementation selects the native `browser` or `chrome` global; an additional runtime polyfill is unnecessary for the selected modern API subset. Types alone do not establish API availability: feature-detect browser-specific capabilities. [WXT extension APIs](https://wxt.dev/guide/essentials/extension-apis)

Brave should consume the Chromium package, but Chrome verification does not establish Brave behavior. Record a distinct installed-extension smoke check before claiming Brave compatibility.

## Background execution and permissions

Chrome normally terminates an extension service worker after 30 seconds of inactivity; long operations have other limits. Persist durable state instead of depending on globals. Register event listeners synchronously inside the WXT background main function, open storage when needed, and use no keepalive polling. Parsing and exports that may take time belong in the visible workspace, with workers added only where processing warrants them. [Chrome service-worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)

For user-invoked capture, `activeTab` plus `scripting` permits injection into the current page without permanent host grants. It does not grant arbitrary access to a newly opened destination tab. Destination preparation must use another explicit invocation there, or a separately granted optional host permission. Firefox ends activeTab access on new-document navigation; Chromium retains it across same-origin navigation. Denied access must produce a usable manual path. [Chrome scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting), [Mozilla activeTab](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/activeTab_permission)

Do not request broad browsing-history, cookie, request-interception, or all-site permissions for the initial workflow. Optional host permissions can support later per-provider enablement. Host grants remain subject to the browser's controls and do not prove that a site's DOM integration works. [Mozilla permissions](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/permissions)

## Local storage and communication

Use IndexedDB in the extension origin for structured snapshots and attachment Blobs. Extension pages and background contexts share that origin. Content-script web-storage calls instead access the website's origin, so content scripts must not open Synapse's database. Store preferences separately through extension storage if needed. [Chrome extension storage](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies)

Save acknowledgments must wait for transaction completion, rather than individual request success. Related records should commit in one transaction, with expensive parsing performed beforehand. Explicit saves may request strict transaction durability, accepting browser support and performance costs; this remains a durability hint rather than an absolute crash-proof guarantee. [IndexedDB transaction options](https://developer.mozilla.org/en-US/docs/Web/API/IDBDatabase/transaction)

Storage is not an independent backup. Use `navigator.storage.estimate()` and request persistence from the workspace where available; display the actual outcome and handle quota failures without reporting a successful save. Chrome documents `persist()` and `unlimitedStorage` as ways to protect extension storage from eviction. Firefox can still encounter global storage limits even with unlimitedStorage. Keep user-controlled export available and never silently discard snapshots to free space. [Chrome persistence](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies), [Storage quotas](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria), [Firefox storage limits](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/local)

Chrome runtime messaging serializes JSON, while other browsers use structured cloning. Define a common JSON-only protocol with validated bounded text, IDs, and metadata. Do not send Blob, File, or ArrayBuffer values through it. The workspace can store binary directly in IndexedDB and send identifiers. For asynchronous message replies, the callback plus literal `return true` pattern avoids depending on gradually introduced Promise-listener behavior. [Chrome message passing](https://developer.chrome.com/docs/extensions/develop/concepts/messaging)

## Original attachments and portability

The File API exposes original bytes when users select files or drop them into the workspace. A displayed filename, a page thumbnail, or a provider's attachment label does not establish access to the original bytes. File inputs hide the real filesystem path, and a script cannot select an arbitrary local path by assigning its value. Therefore Synapse must distinguish referenced attachments from locally retained originals and offer users a way to add missing originals. [File API](https://developer.mozilla.org/en-US/docs/Web/API/File_API), [File input security](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/file)

Preserving a Blob and reading its semantics are separate capabilities. Images, PDFs, Office documents, Markdown, and LaTeX can be retained as bytes without claiming that all their contents were extracted. Text extraction, PDF processing, OCR, and Office conversion need format-specific implementations and fixtures. Any derived text must keep provenance and must not replace the original file. This is a design consequence of the File/Blob model, not verification of Synapse parsers. [File API model](https://developer.mozilla.org/en-US/docs/Web/API/File_API)

Automatic re-upload is a provider-specific integration that must be separately tested. A destination may reject a format or size, require authentication, or change its composer. The portable fallback is a context preview/copy/export plus download of retained originals for manual upload. Never label a referenced-but-unavailable attachment as transferred, and never report that a provider accepted a file based only on successful DOM manipulation.

## UI and verification strategy

A small popup plus a full extension-page workspace is the portable initial UI. Chrome's sidePanel and Firefox's sidebarAction are incompatible APIs; they can share workspace code later through a platform facade. Chrome offscreen documents have a separate permission and restricted API access and should not be a prerequisite for the portable core. [Chrome sidePanel](https://developer.chrome.com/docs/extensions/reference/api/sidePanel), [Firefox sidebarAction](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/sidebarAction), [Chrome offscreen](https://developer.chrome.com/docs/extensions/reference/api/offscreen)

WXT integrates Vitest and fake WebExtension APIs. Use unit and integration tests for serialization, validation, adapter DOM fixtures, storage transactions, and migrations. Such tests do not establish behavior of the real browser's storage implementation or authenticated provider UI. [WXT unit testing](https://wxt.dev/guide/essentials/unit-testing)

Use Playwright's bundled Chromium with a persistent browser context for installed-extension end-to-end flows. Its documented extension workflow is Chromium-specific; a passing test is not Firefox extension verification. Run Firefox `web-ext lint` and installed Firefox smoke checks separately. Record the exact browser, provider page state, and result of live checks, and mark unchecked combinations as unverified. [Playwright extension testing](https://playwright.dev/docs/chrome-extensions), [Mozilla web-ext](https://www.extensionworkshop.com/documentation/develop/getting-started-with-web-ext/)

Performance acceptance needs measurement on stated hardware and data sizes: popup startup, bounded capture, snapshot save, large-library listing, package size, and memory during attachment import. No benchmark was performed as part of this research.

## Resulting priorities and unresolved risks

1. Establish capture, user review, transactional save, export/import, and explicit destination preparation before adding automation.
2. Preserve original attachments and availability status before adding heavy format parsers.
3. Keep the background small and event driven, with no retained transcript or binary cache.
4. Maintain provider adapters independently and preserve manual fallback for selector changes, inaccessible histories, unsupported uploads, and revoked permissions.
5. Treat DOM fixtures, real-browser extension tests, and authenticated provider smoke tests as distinct evidence levels. Complete-history capture and cross-provider file acceptance remain risks until tested on the actual services.
