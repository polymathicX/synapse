# Milestones and remaining release work

## Implemented

- **P0:** WXT/strict TypeScript scaffold; popup/workspace; capture/review/save; structured context; Blob originals; JSON/Markdown/bundles; import; insertion/copy fallback; tests and production builds.
- **Usability update:** opt-in floating one-click save; five recent draggable entries; destination drop/Insert; original-file access through Review / files. Services are enabled individually once.
- **P1 implementation:** five independent provider adapters and synthetic fixture coverage. Authenticated compatibility remains a release gate.
- **ChatGPT 0.1.1:** observed logged-out markup, SPA-safe capture/insertion, recognizable entry titles, and eight successful real-site checks in Brave. See [live evidence](live-chatgpt.md). Other providers and authenticated variants remain unverified live.
- **P2 implementation:** UTF-8/source, PDF, DOCX and PPTX text extraction with limitations; image previews; arbitrary original preservation. Direct binary attachment staging is capability-gated off because it has not been verified.
- **P3 implementation:** default-off per-provider auto-save, scoped debouncing, duplicate-write avoidance, partial-history protection, metadata pagination, storage estimates, and manual deletion. No silent retention deletion.
- **Engineering:** V1→V2 storage migration, archive corruption defenses, deterministic build/package scripts, CI, privacy disclosures and explicit browser-specific manifests.

## Release gates

1. Test authenticated capture and draft insertion on ChatGPT, Claude, DeepSeek, Kimi and Qwen across Chrome, Brave and native Firefox. Maintain a dated service/browser matrix. Adjust selectors from real current markup where necessary.
2. Verify packaged Firefox installation, consent prompts/revocation, event-page suspension, restart persistence and native drop behavior. Temporary add-on reloads are not persistence evidence.
3. Exercise virtualized histories, regenerated responses, provider-specific editors, long conversations, large documents, disk pressure, and permission-denial recovery with realistic accounts/data supplied by the tester.
4. Review PDF.js lint findings and current store policies; sign Firefox artifacts and publish only through a separate distribution process.
5. Measure larger attachment/library workloads on representative hardware before raising safety limits or promising latency/memory targets.

## Later, only with evidence

- Direct file staging per provider after browser/account verification; preserve a download/upload fallback.
- Better transcript reconstruction for explicitly supported provider exports.
- OCR, encrypted backups, and larger archives if justified by actual usage. Each adds cost and remains outside this lightweight initial release.
- UI frameworks or side panels only if the interface becomes complex enough to justify their maintenance and payload.
