# Signed-in ChatGPT / Project verification — 2026-11-03

The reported failure was reproduced in the user's actual signed-in Brave conversation, described by the user as a chat inside a Project. The installed extension was already version 0.1.1. Its capture request returned `No recognizable conversation found`; the failure was an adapter gap rather than a stale release.

## Observed layout and fix

This layout has none of the legacy author-role markers, logged-out transcript markers, or `prompt-textarea` IDs. Roles are headings marked `data-conversation-role` inside `data-turn-key` boundaries. Each `data-talvt-turn-state` container holds both a user message and the assistant response, so capturing the whole turn as one role would be incorrect.

Version 0.1.2 identifies each heading's message container, selects user bubbles and assistant Markdown bodies, and targets the editable `data-composer-markdown` element specifically within `data-chatgpt-composer`. It does not target the editable writing blocks embedded in assistant responses. Auto-save also observes the signed-in turn completion attribute.

The new regression fixture contains anonymized content and identifiers derived from the inspected structure. Its capture, insertion, and streaming tests failed before the fix and pass afterward. Browser fixtures include the observed `white-space: break-spaces` editor behavior.

## Actual installed-extension results

The existing unpacked extension directory was backed up, updated in place, and reloaded through Brave's extension management API, retaining the extension ID and extension-origin data. The relevant chat page was refreshed. Verification used the installed extension's floating tray and native browser accessibility controls, not injected provider-response fixtures.

- Clicking Save created a local entry containing all 10 loaded messages, with five alternating user/assistant pairs. The workspace and IndexedDB both contained 10 messages.
- Clicking Insert restored a 28,173-character handoff into the actual signed-in chat composer.
- SHA-256 comparisons confirmed that both editable writing documents already embedded in the conversation were unchanged.
- The message count stayed unchanged during insertion; nothing was submitted.
- Cleanup stopped when the current draft no longer matched the inserted test handoff; the different remaining draft was left untouched.

No private conversation text, account identifiers, Project names, screenshots of the signed-in session, or original files are included in this repository. Verification records expose only counts and outcomes.

## Scope

This verifies the observed signed-in layout in Brave, including the reported Project conversation. It does not certify every account rollout, browser variant, or interface state. Project instructions, hidden history, and Project-level files are not automatically recovered; capture preserves the loaded conversation and marks its completeness accordingly.

Existing ChatGPT tabs must be refreshed once after an unpacked-extension reload to replace their old content-script instances. Updating only a separate build output directory does not update an unpacked extension installed from another directory.
