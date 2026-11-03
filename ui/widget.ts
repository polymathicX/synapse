import { browser } from 'wxt/browser';
import { request } from '../platform/client';
import { errorMessage } from '../core/model';
import { createDomAdapter } from '../providers/dom';
import { CONFIGS } from '../providers/configs';
import { providerForUrl } from '../providers/registry';
import { observeConversation } from '../providers/observe';

export const DRAG_TYPE = 'application/x-synapse-context';
const WIDGET_CSS = `
:host{all:initial;position:fixed;right:22px;bottom:24px;z-index:2147483647;font-family:system-ui,-apple-system,sans-serif;font-size:13px;color:#e5e9f2;color-scheme:dark}*{box-sizing:border-box}button{font:inherit;cursor:pointer;border:1px solid #344757;color:#e6f5ee;background:#182432;border-radius:8px;padding:8px 11px}button:hover{background:#2c4050}button:focus-visible{outline:2px solid #a6edca;outline-offset:3px}button:disabled{opacity:.5;cursor:wait}.dock{display:flex;justify-content:flex-end;gap:5px}.save{background:#a6edca;color:#0d2b20;border-color:#a6edca;font-weight:650;border-radius:24px;padding:11px 16px;box-shadow:0 4px 22px #0004}.tray-button{border-radius:24px;min-width:43px}.tray{width:310px;max-height:min(580px,80vh);overflow:auto;background:#111a25;border:1px solid #354455;border-radius:14px;margin-bottom:10px;padding:15px;box-shadow:0 10px 50px #0006}.hidden{display:none}.heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}.heading strong{font-size:15px}.hint{color:#a9b8ca;font-size:11px;line-height:1.5;margin:8px 0}.entry{border:1px solid #304354;border-radius:9px;padding:12px;margin-top:8px;transition:border-color .15s}.entry[draggable=true]{cursor:grab}.entry:hover{border-color:#84bca2}.entry:active{cursor:grabbing}.entry strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}.entry small{display:block;margin:6px 0;color:#a9b8ca;font-size:11px}.actions{display:flex;gap:6px}.actions button{font-size:11px;padding:6px 8px}.toast{max-width:310px;background:#14241f;border:1px solid #4e7f68;color:#d5f3e3;border-radius:9px;padding:11px;margin-bottom:9px;line-height:1.5;font-size:12px}.toast:empty{display:none}.toast.error{background:#321e21;border-color:#9c5e64}.close{padding:2px 7px;font-size:15px}.drop-active{border-color:#a6edca}.footer{margin-top:12px}.footer button{width:100%}
`;

interface Entry { id: string; title: string; provider: string; files: number }
export function installWidget(): void {
  const state = globalThis as typeof globalThis & { synapseFloatingInstalled?: boolean };
  if (state.synapseFloatingInstalled || window !== window.top) return;
  const provider = providerForUrl(location.href); if (!provider) return;
  state.synapseFloatingInstalled = true;
  const adapter = createDomAdapter(CONFIGS[provider.id]);
  const host = document.createElement('div'); host.id = 'synapse-floating';
  const shadow = host.attachShadow({ mode: 'closed' });
  const sheet = new CSSStyleSheet(); sheet.replaceSync(WIDGET_CSS); shadow.adoptedStyleSheets = [sheet];
  const toast = document.createElement('div'); toast.className = 'toast'; toast.setAttribute('role', 'status'); toast.setAttribute('aria-live', 'polite');
  const tray = document.createElement('section'); tray.className = 'tray hidden'; tray.setAttribute('aria-label', 'Saved Synapse contexts');
  const heading = document.createElement('div'); heading.className = 'heading';
  const title = document.createElement('strong'); title.textContent = 'Your saved contexts';
  const close = makeButton('×', () => closeTray()); close.className = 'close'; close.setAttribute('aria-label', 'Close saved contexts'); heading.append(title, close);
  const hint = document.createElement('p'); hint.className = 'hint'; hint.textContent = 'Drag an entry into this chat, or click Insert. Existing drafts stay intact. Nothing is sent automatically.';
  const entries = document.createElement('div');
  const autoLabel = document.createElement('label'); autoLabel.className = 'hint';
  const auto = document.createElement('input'); auto.type = 'checkbox';
  autoLabel.append(auto, document.createTextNode(` Auto-save changes on ${provider.name} (optional)`));
  const footer = document.createElement('div'); footer.className = 'footer'; footer.append(makeButton('Open workspace · all contexts & files', () => { void request({ type: 'widget.workspace' }).catch(showError); }));
  tray.append(heading, hint, autoLabel, entries, footer);
  const dock = document.createElement('div'); dock.className = 'dock';
  const save = makeButton('✳ Save chat', () => { void saveChat(); }); save.className = 'save'; save.title = 'Save this conversation to Synapse';
  const browse = makeButton('▤', () => { if (tray.classList.contains('hidden')) void openTray(); else closeTray(); }); browse.className = 'tray-button'; browse.setAttribute('aria-label', 'Open saved Synapse contexts'); browse.title = 'Drag a saved context into this chat';
  dock.append(save, browse); shadow.append(toast, tray, dock); document.documentElement.append(host);
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  let stopObserving: (() => void) | undefined;
  const configureAuto = (enabled: boolean) => {
    auto.checked = enabled; auto.title = enabled ? 'Auto-save enabled' : 'Auto-save disabled'; stopObserving?.(); stopObserving = undefined;
    if (enabled) stopObserving = observeConversation(document, `${CONFIGS[provider.id].user},${CONFIGS[provider.id].assistant}`, async () => { await request({ type: 'widget.autosave' }); });
  };
  void browser.storage.local.get('autoCaptureProviders').then(settings => configureAuto(Array.isArray(settings.autoCaptureProviders) && settings.autoCaptureProviders.includes(provider.id))).catch(() => undefined);
  auto.addEventListener('change', () => {
    const enabled = auto.checked;
    void request({ type: 'widget.auto', enabled }).then(() => { configureAuto(enabled); say(enabled ? 'Auto-save enabled for this service. Changes are saved locally after messages settle.' : 'Auto-save disabled. Use Save chat whenever you want.'); }, error => { auto.checked = !enabled; showError(error); });
  });
  const storageChanged: Parameters<typeof browser.storage.onChanged.addListener>[0] = (changes, area) => {
    if (area === 'local' && changes.autoCaptureProviders) configureAuto(Array.isArray(changes.autoCaptureProviders.newValue) && changes.autoCaptureProviders.newValue.includes(provider.id));
  };
  browser.storage.onChanged.addListener(storageChanged);
  function say(message: string, error = false): void { toast.textContent = message; toast.classList.toggle('error', error); clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.textContent = ''; }, 9_000); }
  function showError(error: unknown): void { say(errorMessage(error), true); }
  function closeTray(): void { generation++; tray.classList.add('hidden'); entries.replaceChildren(); browse.setAttribute('aria-expanded', 'false'); }
  async function saveChat(): Promise<void> {
    save.disabled = true; save.textContent = 'Saving…';
    try { const saved = await request<{ title: string }>({ type: 'widget.capture' }); say(`Saved “${saved.title}” on this device. Loaded messages only; review in the workspace.`); await openTray(); }
    catch (error) { showError(error); }
    finally { save.disabled = false; save.textContent = '✳ Save chat'; }
  }
  async function openTray(): Promise<void> {
    const current = ++generation; tray.classList.remove('hidden'); browse.setAttribute('aria-expanded', 'true'); entries.textContent = 'Loading saved contexts…';
    try {
      const list = await request<Entry[]>({ type: 'widget.list' });
      if (generation !== current) return;
      entries.replaceChildren();
      if (!list.length) { entries.textContent = 'No saved contexts yet. Click Save chat to create your first entry.'; return; }
      for (const entry of list) {
        const row = document.createElement('article'); row.className = 'entry'; row.tabIndex = 0; row.setAttribute('aria-label', `Saved context: ${entry.title}`);
        const name = document.createElement('strong'); name.textContent = entry.title;
        const detail = document.createElement('small'); detail.textContent = `${entry.provider} · ${entry.files} files · preparing drag…`;
        const actions = document.createElement('div'); actions.className = 'actions';
        const insert = makeButton('Insert', () => { void request<{ reason: string }>({ type: 'widget.insert', snapshotId: entry.id }).then(result => { say(result.reason); closeTray(); }, showError); });
        const edit = makeButton('Review / files', () => { void request({ type: 'widget.workspace', snapshotId: entry.id }).catch(showError); });
        actions.append(insert, edit); row.append(name, detail, actions); entries.append(row);
        void request<{ text: string; files: { name: string; available: boolean }[] }>({ type: 'widget.handoff', snapshotId: entry.id }).then(handoff => {
          if (generation !== current) return;
          row.draggable = true; row.title = 'Drag this saved context into an empty chat composer';
          detail.textContent = `${entry.provider} · drag to chat${entry.files ? ` · ${entry.files} files: upload separately` : ''}`;
          row.addEventListener('dragstart', event => {
            if (!event.dataTransfer) return;
            event.dataTransfer.setData('text/plain', handoff.text); event.dataTransfer.setData(DRAG_TYPE, entry.id); event.dataTransfer.effectAllowed = 'copy';
          });
        }, error => { if (generation === current) detail.textContent = errorMessage(error); });
      }
    } catch (error) { entries.textContent = 'Could not load saved contexts.'; showError(error); }
  }
  const over = (event: DragEvent) => {
    if (!event.dataTransfer?.types.includes(DRAG_TYPE)) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(CONFIGS[provider.id].composer)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }
  };
  const drop = (event: DragEvent) => {
    if (!event.dataTransfer?.types.includes(DRAG_TYPE)) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest(CONFIGS[provider.id].composer)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const text = event.dataTransfer.getData('text/plain');
    if (!text || text.length > 100_000) { say('This context is too large to drop. Use the workspace to shorten it.', true); return; }
    const destination = location.href;
    void request({ type: 'widget.can-transfer' }).then(() => {
      if (location.href !== destination) throw new Error('The destination changed while dropping context. Try again.');
      const result = adapter.insertDraft(document, text); say(result.reason, result.status === 'unavailable');
      if (result.status === 'success') closeTray();
    }).catch(showError);
  };
  document.addEventListener('dragover', over, true); document.addEventListener('drop', drop, true);
  const disable: Parameters<typeof browser.runtime.onMessage.addListener>[0] = (message: unknown, sender) => {
    if (sender.id === browser.runtime.id && message && typeof message === 'object' && 'type' in message && (message.type === 'widget.disable' || (message.type === 'widget.permissions-removed' && 'origins' in message && Array.isArray(message.origins) && message.origins.includes(`${location.origin}/*`)))) {
      closeTray(); stopObserving?.(); clearTimeout(toastTimer); host.remove(); state.synapseFloatingInstalled = false;
      document.removeEventListener('dragover', over, true); document.removeEventListener('drop', drop, true); browser.runtime.onMessage.removeListener(disable);
      browser.storage.onChanged.removeListener(storageChanged);
    }
    return false;
  };
  browser.runtime.onMessage.addListener(disable);
  window.addEventListener('pagehide', () => { stopObserving?.(); clearTimeout(toastTimer); }, { once: true });
}

function makeButton(label: string, handler: () => void): HTMLButtonElement {
  const element = document.createElement('button'); element.type = 'button'; element.textContent = label; element.addEventListener('click', handler); return element;
}
