# Verification — 2026-11-03 (Asia/Dhaka)

## Executed checks

| Check | Result |
| --- | --- |
| Clean lockfile installation (`npm ci`) | Passed on Node 26.6.0 / npm 11.18.0, Windows |
| Strict TypeScript + ESLint | Passed |
| Unit/integration suite | 37 tests across 6 files passed |
| Installed Chromium extension + Firefox DOM fixtures | 10 browser checks passed |
| Installed native Brave, disposable profiles | 5 extension checks passed |
| Chromium and Firefox production MV3 builds | Passed; distinct background manifests asserted |
| Bundle budgets | Passed for background, each adapter, floating widget, popup, and workspace |
| Reproducible production output | Passed: 26 files per browser reproduced byte-for-byte |
| Local distribution packages | Chromium/Brave and Firefox ZIPs + SHA-256 checksums generated |
| Firefox `web-ext` validation | 0 errors, 2 explicitly reviewed PDF.js warnings, 0 unexpected findings |
| Firefox temporary add-on installation/reload | Passed using Playwright-distributed Firefox 157 |
| Runtime dependency audit | 0 known vulnerabilities (`npm audit --omit=dev`) |

The browser checks use synthetic provider HTML at controlled provider origins, never authenticated accounts. The extension fixture copy pre-grants only ChatGPT/Claude host access; a separate case verifies rejection with the untouched production permission manifest. Browser/API behavior is real; the provider markup is a fixture.

The Chromium/Brave suite covers:

- Creating structured context, adding text and original files, local extraction, and saving.
- PDF, DOCX, PPTX, Markdown and image originals surviving bundle export, clean-profile import, and byte-for-byte comparison.
- Browser process restart retaining saved context and originals.
- Floating one-click saving into the same local library.
- A physical mouse drag triggering the actual tray row's native `dragstart`, with its real drag data checked. The same native packet is delivered through CDP dragEnter/dragOver/drop input to a second controlled provider origin, exercising browser format handling and the real drop handler. OS tab-bar hover switching itself is not automated.
- Exact handoff spacing, empty-draft insertion, nonempty-draft protection, and no Send-button click.
- Opt-in auto-save after a conversation mutation; checkbox activation uses DOM activation in the closed-root test harness.
- Background service-worker termination and restart via a UI request, with library persistence.
- Capture rejection when host access/activeTab is absent.

Firefox's five DOM checks run compiled Firefox adapter bundles in Firefox with a minimal messaging harness. They validate extraction, native editor insertion, escaped markup, and draft protection; they do **not** verify an installed Firefox extension's full interaction, permissions, storage, or drag workflow. The separate `web-ext` startup check verifies temporary installation/reload only.

## Size and performance evidence

Production JavaScript sizes below are gzip measurements. Initial UI counts include static shared imports; lazy workers are separate.

| Entry | Chromium | Firefox | Budget |
| --- | ---: | ---: | ---: |
| Background | 8.54 KiB | 8.61 KiB | 50 KiB |
| Individual provider adapter | 4.99 KiB | 4.99 KiB | 50 KiB |
| Floating widget | 6.78 KiB | 6.78 KiB | 50 KiB |
| Popup initial JS | 7.37 KiB | 7.41 KiB | 150 KiB |
| Workspace initial JS | 12.87 KiB | 12.95 KiB | 150 KiB |

Lazy archive worker: about 11.0 KiB gzip. Text/Office extraction worker: about 11.7 KiB gzip. PDF API worker: about 130.1 KiB gzip, plus the PDF parser worker at about 371.2 KiB gzip. PDF code is not loaded for startup, capture, browsing the library, or text/Office extraction. The complete unpacked extension is approximately 1.95 MB.

Five workspace reload samples with 100 synthetic list records were recorded on Windows, AMD Ryzen 5 3600. Measurements include test-driver/renderer scheduling overhead and use warm OS/browser caches; they are not system-cold-boot guarantees. Current machine-readable samples are in `artifacts/performance-chromium.json` and `artifacts/performance-brave.json`.

The final recorded medians were approximately 67 ms in Chromium 156.0.8078.4 and 85 ms in Brave's Chromium 156.0.8078.80, with sampled renderer JavaScript heap around 18–20 MiB. Later runs may vary. Renderer heap is **not** total browser/worker memory or peak attachment-processing memory. Large-file peak memory, service latency, and real provider capture latency require representative workloads before publishing performance promises.

## Reproduction and distribution

```sh
npm ci
npm run check
npx playwright install chromium firefox
npm run test:e2e
npm run test:firefox-startup
npm run check:reproducible
npm audit --omit=dev
npm run package
```

`check:reproducible` compares relative file lists and SHA-256 content hashes from two successive production builds per browser. Packaging sorts entries and fixes ZIP wall-clock timestamps. Local artifacts are unsigned; Firefox signing/store distribution is not included. CI is configured but has not been run on a remote CI service in this session.

## Findings and unverified behavior

- **No live provider certification:** all five adapters need authenticated tests against current service markup, account variants, streaming, virtualization, and regenerated responses. Unknown layouts produce an explicit manual fallback.
- **Firefox:** full installed-extension capture/save/drop, permission prompts/revocation, event-page lifecycle and restart persistence remain unverified. Google Chrome itself is not installed here; Chromium and installed Brave were exercised.
- **Files:** byte preservation is verified with small synthetic originals. Binary upload automation is disabled for all adapters. OCR, image understanding, encrypted-PDF extraction, legacy Office decoding, complete layout/media extraction, and unlimited file sizes are not implemented.
- **Reviewed vendor warnings:** PDF.js contains variable imports in optional fake-worker/decoder paths. Synapse supplies a packaged worker port, disables WASM/image rendering, and enforces self-only executable resources. `scripts/lint-firefox.mjs` permits only this warning code/message in the PDF worker assets, records the complete findings, and fails on anything else. Store review may still require further changes.
- **Development audit:** the full npm audit reports 18 development-tool findings (1 low, 17 moderate), largely propagated through ESLint/web-ext/minimatch/deepmerge. Runtime audit is clean. Suggested automatic fixes include incompatible downgrades; none were forced. Reassess upstream tooling updates before public release.
- **Durability:** transaction completion, rollback, revisions, migration, and browser restart are tested. Disk failure, uninstall, profile loss, and browser eviction cannot be eliminated; retain exported bundles.
