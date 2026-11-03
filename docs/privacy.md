# Privacy and data handling

Synapse stores context and user-selected originals in the extension's IndexedDB on your device. It has no backend, analytics, tracking, account integration, cloud sync, API keys, or remote scripts. It does not request cookies, browsing history, all-sites access, or network interception.

Capture is explicit by default. Floating buttons require optional access to the services you enable. Optional auto-save applies only to enabled services and is disabled initially. Capture includes loaded page content; files shown on a page may be references without accessible original bytes.

Dragging a context, clicking Insert, or pasting copied context exposes that content to the selected destination. Providers may sync drafts before Send. Synapse never presses Send automatically. Original files require separate upload. Firefox declares no required data collection, with optional websiteContent/personalCommunications consent for transfers. Denying transfer consent does not prevent local context storage.

Local storage and exports are not encrypted. Other users with access to your operating-system account, browser profile, or exported files may access them. SHA-256 and ZIP CRC checks detect corruption; they are not encryption or authentication.

You control deletion in the workspace. Deleting an entry removes its associated context and locally stored originals in one transaction. Synapse does not automatically delete saved entries to free disk space. Storage persistence depends on browser and disk conditions; exported bundles provide independent backups. Uninstalling Synapse or deleting a profile can remove local data. Removing extension data cannot erase copies already sent to a provider or exported elsewhere.

The extension's own logs do not include conversation text or original bytes. Development and browser-test artifacts contain synthetic data only. No developer receives your saved context through the application.
