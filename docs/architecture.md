# Architecture and decisions

## Product interaction

The main interface is a floating **Save chat** button and saved-context tray on explicitly enabled provider origins. One click captures an entry. In a destination chat, drag an entry into an empty composer or choose Insert. The full workspace handles review, original files, storage, and backups. Automatic submission and overwriting nonempty drafts are excluded.

## Execution boundaries

WXT 0.21.5 builds native MV3 service workers for Chromium and nonpersistent background scripts for Firefox. The background registers listeners synchronously and performs short event-driven operations. No polling, keepalive, backend, persistent network connection, side-panel abstraction, or UI framework is needed.

The pure `core` owns validation, snapshot data, handoff assembly, and portable formats. `providers` owns DOM adapters and bounded observation. `storage` owns IndexedDB. `platform` owns permissions, messaging, injection, and privacy checks. Entrypoints compose these modules. Workers are packaged and instantiated only for explicit import/export/extraction; they are terminated after completion or timeout.

Runtime dependencies are deliberately small except PDF.js, which is isolated in a separately loaded PDF worker: idb for transaction promises, Valibot for shared schemas, fflate for ZIP/DEFLATE, saxes for bounded namespace-aware XML, and PDF.js for PDF text. No dependency loads documents over the network.

## Durable state

The `synapse-context` IndexedDB database is version 2:

| Store | Purpose |
| --- | --- |
| snapshots | Small list records indexed by updatedAt: identity, revision, title, source, counts |
| contexts | Summary, decisions, constraints, task state and capture warnings |
| transcripts | Ordered role-labelled messages, with handoff selection flags |
| attachments | Original-file metadata keyed by snapshot ID and attachment ID |
| blobs | Original bytes using the same compound ownership key |

V1 embedded structured fields in list records. The V2 upgrade moves them transactionally to `contexts`, preserving transcripts and Blobs. A blocked upgrade is reported instead of silently hanging. Open connections close when another instance needs an upgrade.

Saves compare the caller's revision inside a single read/write transaction and acknowledge only transaction completion. Validation, large reads, hashing, and parsing occur outside write transactions. Failed imports are validated before saving and receive independent snapshot IDs. Deletion removes all owned records atomically. There is no implicit eviction or automatic retention deletion.

`navigator.storage.persist()` and storage estimates expose actual protection and capacity. Chromium offers optional unlimitedStorage; Firefox relies on persistence and its quota handling because unlimitedStorage is not a valid optional permission there. Disk exhaustion is always possible. Export is the backup mechanism.

## Adapter and message contracts

Each compiled provider adapter implements probe/capture/insertDraft and returns success, partial, or unavailable with a reason. Only recognizable, loaded message roots are captured; generated responses are rejected while a recognized streaming indicator is present. Visible code blocks are preserved. Provider selectors are independently replaceable and tested against synthetic fixtures; they are not a stable upstream API.

The observed signed-in ChatGPT layout uses role headings within shared turn containers. A turn contains both sides of the conversation; the adapter selects each role heading's immediate message container and its corresponding content body. Its composer selector is scoped to the chat composer so editable writing documents inside responses are preserved.

Runtime messages are JSON-only. Files never cross Chrome runtime messaging as Blob objects. Blobs are written/read in the extension origin or passed using dedicated-worker structured clone. The router validates schema, sender ID, frame and origin. Extension-page requests and content-script widget requests have separate capabilities; provider scripts cannot request arbitrary tab orchestration. Revoked host access blocks widget data requests and removes the floating UI. Firefox transfer consent is rechecked before exposing handoffs.

Widget requests include the current page URL at the moment of the action. A content script can survive SPA history changes while its runtime sender URL retains the injection URL. The background validates the action URL against the sender's origin and the current tab, then carries it through capture/insertion checks. This permits in-page chat navigation while rejecting stale destinations and different-origin requests.

Only opted-in origins receive dynamically registered content scripts. The widget uses an isolated execution world and a closed shadow root; it never bridges requests through page `postMessage`. Dragging intentionally exposes text/plain context to the drop destination. Drop insertion checks the composer, protects drafts, and never clicks Send.

## Portability and hostile input

Snapshots are versioned and validated. JSON imports preserve structured context but mark originals unavailable. ZIP bundles contain `context.json` and `files/<id>` entries. Exports use STORE mode to avoid recompressing already compressed originals. Entries have fixed timestamps for deterministic output.

ZIP extraction uses central-directory offsets, bounded incremental DEFLATE and CRC verification. Scanning streaming ZIP signatures would misinterpret nested DOCX/PPTX originals as bundle entries; a regression test covers this. Duplicate/unsafe paths, split/encrypted archives, unsupported methods, overlapping entries, missing files, excessive output, mismatched headers, and digest failures are rejected. SHA-256 verifies original bytes. Integrity checks detect corruption, not the identity/trustworthiness of an archive's author.

OOXML extraction selects document/slide XML only, rejecting entity declarations and ignoring macros, relationships, external resources, embedded media, and rendering. PDF extraction uses a packaged nested worker with an explicit port, avoiding a window-dependent fake-worker fallback. OCR, rendering parity, legacy Office decoding, remote vision, and automatic uploads are excluded.

## Optional preservation

Auto-save is off until enabled per provider in the tray. DOM mutations within message roots schedule a 750 ms settling delay, bounded by 5 seconds during continuous changes. Composer edits do not schedule saves. Observers disconnect on page exit/disable; no timer runs while idle. The background tracks up to 100 auto-saved conversation mappings, skips unchanged captures, preserves user-edited fields and original files, and refuses shrinking or differently windowed history. Explicit Save chat always creates an entry.

## Packaging and release

Production manifests prohibit network connections from extension pages and remote executable resources. Two PDF.js variable-import lint warnings are explicitly recorded, narrowly allow-listed, and protected by self-only execution CSP; changed warning classes or locations fail validation. These still need attention during store review.

Lockfile installation, strict TypeScript, lint, tests, both MV3 builds, manifest assertions, gzip budgets, byte-for-byte build comparison, deterministic packages, and runtime dependency audit are automated. Live authenticated verification is recorded separately, never inferred from fixtures.
