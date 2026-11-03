import '../../ui/style.css';
import { browser } from 'wxt/browser';
import { createSnapshot, errorMessage, LIMITS, safeFilename } from '../../core/model';
import type { ContextSnapshot } from '../../core/model';
import { extractiveSummary, renderHandoff } from '../../core/handoff';
import { repository } from '../../storage/repository';
import { PROVIDERS, providerForUrl } from '../../providers/registry';
import { request } from '../../platform/client';
import { byId, button, bytes, download } from '../../ui/shared';
import { runWorker } from '../../ui/worker';
import type { ExtractionResult } from '../../core/extraction';
import { disableFloating, enableFloating, requestFloatingPermission } from '../../platform/floating';

let snapshot = createSnapshot();
let dirty = false, busy = false, libraryOffset = 0, persistenceRequested = false;
let destinationTab: number | undefined;
const originals = new Map<string, Blob>();
const previewUrls: string[] = [];
const status = byId('status');
if (import.meta.env.FIREFOX) byId('unlimited').classList.add('hidden');
const field = (id: string) => byId<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(id);

for (const provider of PROVIDERS) {
  const label = document.createElement('label'); label.className = 'switch';
  const input = document.createElement('input'); input.type = 'checkbox'; input.setAttribute('aria-label', `Floating Synapse on ${provider.name}`);
  const origins = provider.hosts.map(host => `https://${host}/*`);
  void browser.storage.local.get('floatingOrigins').then(settings => { const enabled: unknown[] = Array.isArray(settings.floatingOrigins) ? settings.floatingOrigins : []; input.checked = origins.some(origin => enabled.includes(origin)); });
  input.addEventListener('change', () => {
    const enabling = input.checked;
    const permission = enabling ? requestFloatingPermission(origins) : Promise.resolve(true);
    act(async () => {
      try {
        if (!await permission) throw new Error('Site access was not granted.');
        if (enabling) await enableFloating(origins); else await disableFloating(origins);
        notify(enabling ? `Floating Synapse enabled on ${provider.name}. Click Save chat, then drag an entry into another chat.` : `Floating Synapse disabled on ${provider.name}.`);
      } catch (error) { input.checked = !enabling; throw error; }
    });
  });
  label.append(input, document.createTextNode(provider.name)); byId('floating-services').append(label);
}

function notify(message: string, error = false): void { status.textContent = message; status.classList.toggle('error', error); }
function changed(): void { dirty = true; byId('save-state').textContent = 'Unsaved changes'; }
function act(operation: () => Promise<void>, message = ''): void {
  if (busy) return;
  busy = true;
  const controls = [...document.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('button,input,textarea,select')];
  for (const control of controls) control.disabled = true;
  notify(message);
  void operation().catch(error => notify(errorMessage(error), true)).finally(() => {
    busy = false; for (const control of controls) control.disabled = false;
    byId<HTMLButtonElement>('delete').disabled = snapshot.revision === 0;
  });
}

function readFields(): void {
  snapshot.title = field('title').value.trim() || 'Untitled context';
  snapshot.summary = field('summary').value;
  snapshot.task.goal = field('goal').value;
  snapshot.task.status = field('task-status').value as ContextSnapshot['task']['status'];
  snapshot.task.nextSteps = field('next-steps').value;
  snapshot.decisions = field('decisions').value.split('\n').map(value => value.trim()).filter(Boolean);
  snapshot.constraints = field('constraints').value.split('\n').map(value => value.trim()).filter(Boolean);
}
function refreshPreview(): string {
  readFields();
  const handoff = renderHandoff(snapshot);
  byId('handoff').textContent = handoff.text;
  byId('budget-note').textContent = `${handoff.text.length.toLocaleString()} characters · ${handoff.omittedMessages ? `${handoff.omittedMessages} earlier messages omitted` : 'selected messages included'}${handoff.text.length > 30_000 ? ' · Structured fields exceed the default budget; shorten them before transfer.' : ''}`;
  return handoff.text;
}

async function refreshStorage(): Promise<void> {
  try {
    const estimate = await navigator.storage.estimate();
    const persisted = await navigator.storage.persisted();
    byId('storage-status').textContent = `${bytes(estimate.usage ?? 0)} used of approximately ${bytes(estimate.quota ?? 0)}. ${persisted ? 'Persistent storage granted.' : 'Storage is best effort; keep an exported backup.'}`;
  } catch { byId('storage-status').textContent = 'Storage estimates are unavailable. Your committed saves remain local; keep an exported backup.'; }
}

async function saveCurrent(): Promise<void> {
  readFields();
  snapshot = await repository.save(snapshot, originals);
  originals.clear(); dirty = false;
  history.replaceState(null, '', `?id=${encodeURIComponent(snapshot.id)}`);
  byId('save-state').textContent = 'Saved locally';
  byId<HTMLButtonElement>('delete').disabled = false;
  await loadLibrary();
  await refreshStorage();
}

function renderMessages(): void {
  const container = byId('messages'); container.replaceChildren();
  if (!snapshot.messages.length) { container.textContent = 'No messages yet. Add text here, or capture a conversation using the toolbar.'; container.classList.add('empty'); return; }
  container.classList.remove('empty');
  for (const message of snapshot.messages) {
    const item = document.createElement('article'); item.className = 'message';
    const label = document.createElement('label');
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = message.selected;
    checkbox.addEventListener('change', () => { message.selected = checkbox.checked; changed(); refreshPreview(); });
    label.append(checkbox, document.createTextNode(message.role === 'user' ? 'You' : 'Assistant'));
    const text = document.createElement('pre'); text.textContent = message.text;
    const remove = button('Remove', () => { snapshot.messages = snapshot.messages.filter(item => item.id !== message.id); changed(); renderMessages(); refreshPreview(); });
    item.append(label, text, remove); container.append(item);
  }
}

function renderFiles(): void {
  for (const url of previewUrls) URL.revokeObjectURL(url); previewUrls.length = 0;
  const container = byId('files'); container.replaceChildren();
  if (!snapshot.attachments.length) { container.textContent = 'No files attached to this context.'; container.className = 'empty'; return; }
  container.className = '';
  for (const file of snapshot.attachments) {
    const item = document.createElement('article'); item.className = 'file';
    const title = document.createElement('strong'); title.textContent = file.name;
    const detail = document.createElement('p'); detail.textContent = file.availability === 'stored' ? `${bytes(file.size)} · original preserved` : 'Original unavailable — add this file locally';
    const note = document.createElement('p'); note.textContent = file.extractionNote ?? '';
    const actions = document.createElement('div'); actions.className = 'actions';
    actions.append(button('Remove', () => { snapshot.attachments = snapshot.attachments.filter(item => item.id !== file.id); originals.delete(file.id); changed(); renderFiles(); refreshPreview(); }));
    if (file.availability === 'stored') {
      actions.prepend(button('Download original', () => act(async () => {
        const blob = originals.get(file.id) ?? await repository.file(snapshot.id, file.id);
        if (!blob) throw new Error('Original is missing. Add the file again.');
        download(blob, file.name); notify('Original downloaded. Upload it to your destination when ready.');
      })));
      actions.append(button('Extract text', () => act(async () => {
        const blob = originals.get(file.id) ?? await repository.file(snapshot.id, file.id);
        if (!blob) throw new Error('Original is missing. Add the file again.');
        const { default: ExtractWorker } = /\.pdf$/i.test(file.name) || file.mediaType === 'application/pdf' ? await import('../../workers/pdf.worker?worker') : await import('../../workers/extract.worker?worker');
        try {
          const response = await runWorker<{ ok: true; result: ExtractionResult }>(new ExtractWorker(), { file: new File([blob], file.name, { type: file.mediaType }) });
          file.extractedText = response.result.text; file.extractionNote = response.result.note;
          changed(); renderFiles(); refreshPreview(); notify(response.result.note);
        } catch (error) { file.extractionNote = errorMessage(error); changed(); renderFiles(); throw error; }
      }, 'Extracting text locally…')));
    }
    item.append(title, detail, note, actions); container.append(item);
    if (/^image\/(png|jpeg|webp|gif)$/.test(file.mediaType) && file.availability === 'stored' && file.size <= 10 * 1024 * 1024) {
      void (async () => {
        const blob = originals.get(file.id) ?? await repository.file(snapshot.id, file.id);
        if (!blob || !item.isConnected) return;
        const url = URL.createObjectURL(blob); previewUrls.push(url);
        const image = document.createElement('img'); image.src = url; image.alt = `Preview of ${file.name}`; image.loading = 'lazy'; item.append(image);
      })().catch(() => undefined);
    }
  }
}

function render(): void {
  field('title').value = snapshot.title;
  field('goal').value = snapshot.task.goal;
  field('summary').value = snapshot.summary;
  field('decisions').value = snapshot.decisions.join('\n');
  field('constraints').value = snapshot.constraints.join('\n');
  field('task-status').value = snapshot.task.status;
  field('next-steps').value = snapshot.task.nextSteps;
  byId('summary-kind').textContent = snapshot.summaryKind === 'extractive' ? 'EXTRACTIVE DRAFT' : 'USER EDITED';
  byId('capture-warning').textContent = snapshot.capture.warnings.join(' ');
  byId('source').textContent = snapshot.source.url ? `Captured from ${snapshot.source.provider} · ${snapshot.source.url}` : 'Manually created context';
  byId('save-state').textContent = snapshot.revision ? 'Saved locally' : 'Unsaved';
  byId<HTMLButtonElement>('delete').disabled = snapshot.revision === 0;
  byId('message-editor').classList.add('hidden');
  renderMessages(); renderFiles(); refreshPreview();
}

async function loadLibrary(append = false): Promise<void> {
  if (!append) { libraryOffset = 0; byId('library').replaceChildren(); }
  const items = await repository.list(libraryOffset, 50);
  for (const item of items) {
    const element = button('', () => act(async () => {
      if (dirty && !window.confirm('Discard unsaved changes and open this context?')) return;
      const loaded = await repository.get(item.id); if (!loaded) throw new Error('This context was deleted in another window.');
      snapshot = loaded; originals.clear(); dirty = false;
      history.replaceState(null, '', `?id=${encodeURIComponent(snapshot.id)}`);
      render(); await loadLibrary();
    }), `snapshot-item${item.id === snapshot.id ? ' active' : ''}`);
    const title = document.createElement('strong'); title.textContent = item.title;
    const metadata = document.createElement('small'); metadata.textContent = `${item.source.provider} · ${new Date(item.updatedAt).toLocaleDateString()} · ${item.messageCount} msgs`;
    element.append(title, metadata); byId('library').append(element);
  }
  libraryOffset += items.length;
  byId('library-count').textContent = String(libraryOffset);
  byId('more').classList.toggle('hidden', items.length < 50);
  if (!libraryOffset) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'Your next idea starts here. Save a context to build your library.'; byId('library').append(empty); }
}

for (const id of ['title', 'goal', 'summary', 'decisions', 'constraints', 'task-status', 'next-steps']) {
  field(id).addEventListener('input', () => { changed(); if (id === 'summary') { snapshot.summaryKind = 'user'; byId('summary-kind').textContent = 'USER EDITED'; } });
}
byId('save').addEventListener('click', () => {
  // Start the persistence request from the user's gesture; never treat denial as save failure.
  if (!persistenceRequested) { persistenceRequested = true; void navigator.storage.persist().catch(() => false); }
  act(async () => { await saveCurrent(); notify('Context and original files saved on this device.'); }, 'Saving locally…');
});
byId('new').addEventListener('click', () => act(async () => {
  if (dirty && !window.confirm('Discard unsaved changes and start a new context?')) return;
  snapshot = createSnapshot(); originals.clear(); dirty = false; history.replaceState(null, '', 'workspace.html'); render(); await loadLibrary(); field('title').focus();
}));
byId('more').addEventListener('click', () => act(() => loadLibrary(true)));
byId('preview').addEventListener('click', () => { refreshPreview(); notify('Preview refreshed.'); });
byId('extractive').addEventListener('click', () => { readFields(); snapshot.summary = extractiveSummary(snapshot); snapshot.summaryKind = 'extractive'; field('summary').value = snapshot.summary; byId('summary-kind').textContent = 'EXTRACTIVE DRAFT'; changed(); refreshPreview(); });
byId('add-message').addEventListener('click', () => { byId('message-editor').classList.remove('hidden'); field('message-text').focus(); });
byId('cancel-message').addEventListener('click', () => byId('message-editor').classList.add('hidden'));
byId('commit-message').addEventListener('click', () => {
  const text = field('message-text').value.trim(); if (!text) return;
  if (snapshot.messages.length >= LIMITS.messages) { notify('This context has reached the message limit.', true); return; }
  snapshot.messages.push({ id: crypto.randomUUID(), role: field('message-role').value as 'user' | 'assistant', text, selected: true });
  field('message-text').value = ''; byId('message-editor').classList.add('hidden'); changed(); renderMessages(); refreshPreview();
});
byId('add-files').addEventListener('click', () => byId<HTMLInputElement>('file-picker').click());
byId('file-picker').addEventListener('change', () => act(async () => {
  const picker = byId<HTMLInputElement>('file-picker');
  try {
    for (const file of picker.files ?? []) {
      if (file.size > LIMITS.fileBytes) throw new Error(`${file.name} exceeds the 64 MiB per-file limit.`);
      const missing = snapshot.attachments.find(item => item.name === safeFilename(file.name) && item.availability === 'missing');
      if (!missing && snapshot.attachments.length >= LIMITS.attachments) throw new Error('The attachment count limit has been reached.');
      const metadata = { id: missing?.id ?? crypto.randomUUID(), name: safeFilename(file.name), size: file.size, mediaType: file.type || 'application/octet-stream', availability: 'stored' as const, extractionNote: 'Original added locally. Extract text if you want it included in the handoff.' };
      if (missing) snapshot.attachments.splice(snapshot.attachments.indexOf(missing), 1, metadata); else snapshot.attachments.push(metadata);
      originals.set(metadata.id, file); changed();
    }
    notify('Original files added. Save this context to preserve them.');
  } finally { picker.value = ''; renderFiles(); refreshPreview(); }
}));

for (const provider of PROVIDERS) { const option = document.createElement('option'); option.value = provider.id; option.textContent = provider.name; byId('provider').append(option); }
const manualOption = document.createElement('option'); manualOption.value = 'manual'; manualOption.textContent = 'Another service · copy and paste'; byId('provider').append(manualOption);
field('provider').addEventListener('change', () => { destinationTab = undefined; });
byId('open-provider').addEventListener('click', () => act(async () => {
  const provider = PROVIDERS.find(item => item.id === field('provider').value);
  if (!provider) { notify('Copy the handoff and paste it into your chosen service. Download originals to upload separately.'); return; }
  const tab = await browser.tabs.create({ url: provider.url }); destinationTab = tab.id;
  notify('Destination opened. Sign in if needed, then return here to insert the handoff, or copy and paste it.');
}));

byId('insert').addEventListener('click', () => {
  const provider = PROVIDERS.find(item => item.id === field('provider').value);
  if (!provider) { notify('Use Copy handoff for this service.'); return; }
  // permissions.request must be invoked in the gesture, before asynchronous tab lookup.
  const permissionOptions = { origins: provider.hosts.map(host => `https://${host}/*`), ...(import.meta.env.FIREFOX ? { data_collection: ['websiteContent', 'personalCommunications'] } : {}) };
  const granted = browser.permissions.request(permissionOptions as Parameters<typeof browser.permissions.request>[0]);
  act(async () => {
    if (!await granted) throw new Error('Destination access was not granted. Copy the handoff instead.');
    if (destinationTab === undefined) {
      const tabs = await browser.tabs.query({});
      const candidates = tabs.filter(tab => providerForUrl(tab.url ?? '')?.id === provider.id);
      if (candidates.length !== 1 || candidates[0]?.id === undefined) throw new Error('Open one destination with “Open destination”, then try insertion again.');
      destinationTab = candidates[0].id;
    }
    const response = await request<{ reason: string }>({ type: 'resume', tabId: destinationTab, text: refreshPreview() });
    await browser.tabs.update(destinationTab, { active: true }); notify(response.reason);
  }, 'Preparing reviewed handoff…');
});
byId('copy').addEventListener('click', () => {
  const text = refreshPreview();
  const copying = navigator.clipboard.writeText(text);
  act(async () => { await copying; notify('Handoff copied. Paste it into any AI and upload your preserved originals separately.'); });
});

byId('export-json').addEventListener('click', () => act(async () => {
  readFields(); const { exportJson } = await import('../../core/archive');
  download(new Blob([exportJson(snapshot)], { type: 'application/json' }), `${snapshot.title}.synapse.json`); notify('Context JSON exported. Original bytes require a bundle.');
}));
byId('export-md').addEventListener('click', () => { download(new Blob([refreshPreview()], { type: 'text/markdown' }), `${snapshot.title}.md`); notify('Readable handoff exported.'); });
byId('export-bundle').addEventListener('click', () => act(async () => {
  await saveCurrent(); const { default: ArchiveWorker } = await import('../../workers/archive.worker?worker');
  const response = await runWorker<{ ok: true; blob: Blob }>(new ArchiveWorker(), { type: 'export', snapshotId: snapshot.id });
  download(response.blob, `${snapshot.title}.synapse.zip`); notify('Bundle exported with original files and integrity checks.');
}, 'Saving and packaging original files…'));
byId('import').addEventListener('click', () => byId<HTMLInputElement>('import-file').click());
byId('import-file').addEventListener('change', () => act(async () => {
  const input = byId<HTMLInputElement>('import-file'); const file = input.files?.[0]; if (!file) return;
  try {
    if (dirty && !window.confirm('Discard unsaved changes and import this context?')) return;
    const { default: ArchiveWorker } = await import('../../workers/archive.worker?worker');
    const response = await runWorker<{ ok: true; snapshotId: string }>(new ArchiveWorker(), { type: 'import', file });
    const imported = await repository.get(response.snapshotId); if (!imported) throw new Error('The imported context could not be reopened.');
    snapshot = imported; originals.clear(); dirty = false;
    history.replaceState(null, '', `?id=${encodeURIComponent(snapshot.id)}`); render(); await loadLibrary(); await refreshStorage();
    notify('Context imported as a new snapshot. Existing contexts were unchanged.');
  } finally { input.value = ''; }
}, 'Validating and importing…'));
byId('delete').addEventListener('click', () => act(async () => {
  if (!window.confirm('Delete this context and its locally preserved original files? This cannot be undone.')) return;
  await repository.delete(snapshot.id, snapshot.revision);
  snapshot = createSnapshot(); originals.clear(); dirty = false; history.replaceState(null, '', 'workspace.html'); render(); await loadLibrary(); await refreshStorage(); notify('Context deleted.');
}));
byId('persist').addEventListener('click', () => {
  const protection = navigator.storage.persist();
  act(async () => { const granted = await protection; await refreshStorage(); notify(granted ? 'Persistent storage granted. Keep exported backups as well.' : 'The browser did not grant persistent storage. Keep an exported backup.'); });
});
byId('unlimited').addEventListener('click', () => {
  const permission = browser.permissions.request({ permissions: ['unlimitedStorage'] });
  act(async () => { const granted = await permission; await refreshStorage(); notify(granted ? 'Larger storage enabled. Available disk space and per-file limits still apply.' : 'Larger storage was not enabled.'); });
});
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });

act(async () => {
  const id = new URLSearchParams(location.search).get('id');
  if (id) { const loaded = await repository.get(id); if (!loaded) throw new Error('This context does not exist. Create a new one or import a backup.'); snapshot = loaded; }
  render(); await loadLibrary(); await refreshStorage();
});
