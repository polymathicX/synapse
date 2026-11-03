import { browser } from 'wxt/browser';
import * as v from 'valibot';
import { errorMessage, parseSnapshot } from '../core/model';
import type { ContextSnapshot } from '../core/model';
import type { AdapterResult } from '../providers/dom';
import { providerForUrl } from '../providers/registry';
import { RequestSchema } from '../platform/protocol';
import type { Request } from '../platform/protocol';
import { repository } from '../storage/repository';
import { renderHandoff } from '../core/handoff';
import { syncFloating } from '../platform/floating';
import { requireTransferConsent } from '../platform/privacy';
import { extractiveSummary } from '../core/handoff';

const activeAutoSaves = new Set<string>();
let autoSaveQueue: Promise<unknown> = Promise.resolve();

async function captureTab(tabId: number, url: string): Promise<ContextSnapshot> {
  const provider = providerForUrl(url)!;
  await browser.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: [provider.script] });
  const current = await browser.tabs.get(tabId);
  if (current.url !== url) throw new Error('The page navigated. Save again after it finishes loading.');
  const result = await browser.tabs.sendMessage(tabId, { type: 'adapter.capture', expectedUrl: url }, { frameId: 0 }) as AdapterResult<ContextSnapshot>;
  if (!result.value || result.status === 'unavailable') throw new Error(result.reason);
  const captured = parseSnapshot(result.value);
  if (captured.source.url !== url.split('#')[0] || captured.source.provider !== provider.id) throw new Error('Capture source changed. Try again.');
  return captured;
}

async function autoSave(tabId: number, url: string): Promise<unknown> {
  const key = url.split('#')[0]!;
  if (activeAutoSaves.has(key)) return null;
  const settings = await browser.storage.local.get(['autoCaptureProviders', 'autoEntries']);
  const provider = providerForUrl(url)!;
  if (!Array.isArray(settings.autoCaptureProviders) || !settings.autoCaptureProviders.includes(provider.id)) return null;
  activeAutoSaves.add(key);
  try {
    const captured = await captureTab(tabId, url);
    const index: Record<string, string> = settings.autoEntries && typeof settings.autoEntries === 'object' ? settings.autoEntries as Record<string, string> : {};
    const previousId = index[key]; const previous = previousId ? await repository.get(previousId) : undefined;
    let candidate = captured;
    if (previous) {
      // Never replace a larger or differently windowed history with a partial DOM view.
      if (captured.messages.length < previous.messages.length || previous.messages.slice(0, -1).some((message, index) => message.role !== captured.messages[index]?.role || message.text !== captured.messages[index]?.text)) return null;
      if (captured.messages.length === previous.messages.length && captured.messages.every((message, index) => message.role === previous.messages[index]?.role && message.text === previous.messages[index]?.text)) return null;
      candidate = { ...previous, capture: captured.capture, messages: captured.messages.map((message, index) => ({ ...message, id: previous.messages[index]?.id ?? message.id, selected: previous.messages[index]?.selected ?? true })), attachments: [...previous.attachments] };
      for (const file of captured.attachments) if (!candidate.attachments.some(existing => existing.name === file.name)) candidate.attachments.push(file);
      if (candidate.summaryKind === 'extractive') candidate.summary = extractiveSummary(candidate);
    }
    const saved = await repository.save(candidate); index[key] = saved.id;
    await browser.storage.local.set({ autoEntries: Object.fromEntries(Object.entries(index).slice(-100)) });
    return { snapshotId: saved.id };
  } finally { activeAutoSaves.delete(key); }
}

async function openWorkspace(id?: string): Promise<void> {
  await browser.tabs.create({ url: browser.runtime.getURL(`/workspace.html${id ? `?id=${encodeURIComponent(id)}` : ''}`) });
}

async function handle(request: Request): Promise<unknown> {
  if (request.type === 'open-workspace') { await openWorkspace(request.snapshotId); return null; }
  if (request.type.startsWith('widget.')) throw new Error('Invalid routing request.');
  if (request.type !== 'capture' && request.type !== 'resume') throw new Error('Invalid request.');
  if (request.type === 'resume') await requireTransferConsent();
  const tabId = request.tabId ?? (await browser.tabs.query({ active: true, currentWindow: true }))[0]?.id;
  if (tabId === undefined) throw new Error('No active tab is available.');
  const tab = await browser.tabs.get(tabId);
  const provider = providerForUrl(tab.url ?? '');
  if (!provider) throw new Error('This page has no direct adapter. Open the workspace to paste context or import a Synapse file.');
  await browser.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: [provider.script] });
  // Recheck navigation after injection. Never route context into a different destination.
  const current = await browser.tabs.get(tabId);
  if (current.url !== tab.url) throw new Error('The page navigated during the operation. Try again.');
  if (request.type === 'capture') {
    const result = await browser.tabs.sendMessage(tabId, { type: 'adapter.capture', expectedUrl: tab.url }, { frameId: 0 }) as AdapterResult<ContextSnapshot>;
    if (!result.value || result.status === 'unavailable') throw new Error(result.reason);
    const snapshot = parseSnapshot(result.value);
    if (snapshot.source.provider !== provider.id || snapshot.source.url !== tab.url?.split('#')[0]) throw new Error('Capture source did not match the intended conversation. Try again.');
    const saved = await repository.save(snapshot);
    await openWorkspace(saved.id);
    return { snapshotId: saved.id, reason: result.reason };
  }
  const result = await browser.tabs.sendMessage(tabId, { type: 'adapter.insert', text: request.text, expectedUrl: tab.url }, { frameId: 0 }) as AdapterResult<null>;
  if (result.status === 'unavailable') throw new Error(result.reason);
  return { reason: result.reason };
}

async function handleWidget(request: Request, tabId: number, url: string): Promise<unknown> {
  if (!providerForUrl(url)) throw new Error('This page does not support the floating tray.');
  if (!await browser.permissions.contains({ origins: [`${new URL(url).origin}/*`] })) throw new Error('Access to this service was revoked. Re-enable floating Synapse from the toolbar.');
  if (request.type === 'widget.list') return (await repository.list(0, 5)).map(item => ({ id: item.id, title: item.title, provider: item.source.provider, files: item.attachmentCount }));
  if (request.type === 'widget.can-transfer') { await requireTransferConsent(); return null; }
  if (request.type === 'widget.auto') {
    const provider = providerForUrl(url)!; const settings = await browser.storage.local.get('autoCaptureProviders');
    const existing: string[] = Array.isArray(settings.autoCaptureProviders) ? settings.autoCaptureProviders : [];
    await browser.storage.local.set({ autoCaptureProviders: request.enabled ? [...new Set([...existing, provider.id])] : existing.filter(id => id !== provider.id) });
    return null;
  }
  if (request.type === 'widget.autosave') {
    const operation = autoSaveQueue.then(() => autoSave(tabId, url));
    autoSaveQueue = operation.catch(() => undefined);
    return operation;
  }
  if (request.type === 'widget.workspace') { await openWorkspace(request.snapshotId); return null; }
  if (request.type === 'widget.capture') {
    const captured = await captureTab(tabId, url);
    const saved = await repository.save(captured);
    return { snapshotId: saved.id, title: saved.title };
  }
  if (request.type === 'widget.handoff' || request.type === 'widget.insert') {
    await requireTransferConsent();
    const snapshot = await repository.get(request.snapshotId); if (!snapshot) throw new Error('This saved entry no longer exists.');
    const handoff = renderHandoff(snapshot);
    if (handoff.text.length > 100_000) throw new Error('This context is large. Shorten it in the workspace before transferring.');
    if (request.type === 'widget.handoff') return { text: handoff.text, files: snapshot.attachments.map(file => ({ name: file.name, available: file.availability === 'stored' })) };
    return handle({ type: 'resume', tabId, text: handoff.text });
  }
  throw new Error('This action is unavailable from a provider page.');
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((input: unknown, sender, respond) => {
    if (sender.id !== browser.runtime.id) return false;
    const parsed = v.safeParse(RequestSchema, input);
    if (!parsed.success) { respond({ ok: false, error: 'Invalid extension request.' }); return false; }
    let operation: Promise<unknown>;
    if (sender.url?.startsWith(browser.runtime.getURL('/'))) {
      operation = handle(parsed.output);
    } else if (sender.tab?.id !== undefined && sender.frameId === 0 && sender.url && providerForUrl(sender.url)) {
      operation = handleWidget(parsed.output, sender.tab.id, sender.url);
    } else return false;
    void operation.then(value => respond({ ok: true, value }), error => respond({ ok: false, error: errorMessage(error) }));
    return true;
  });
  browser.runtime.onInstalled.addListener(() => { void syncFloating().catch(() => undefined); });
  browser.runtime.onStartup.addListener(() => { void syncFloating().catch(() => undefined); });
  browser.permissions.onRemoved.addListener(removed => {
    void syncFloating().catch(() => undefined);
    if (removed.origins?.length) void browser.tabs.query({}).then(tabs => Promise.allSettled(tabs.filter(tab => tab.id !== undefined).map(tab => browser.tabs.sendMessage(tab.id!, { type: 'widget.permissions-removed', origins: removed.origins }))));
  });
});
