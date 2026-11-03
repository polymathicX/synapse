import { browser } from 'wxt/browser';
import { providerForUrl } from '../providers/registry';

const REGISTRATION = 'synapse-floating';

export async function syncFloating(): Promise<void> {
  const settings = await browser.storage.local.get('floatingOrigins');
  const enabled = Array.isArray(settings.floatingOrigins) ? settings.floatingOrigins.filter((origin): origin is string => typeof origin === 'string' && providerForUrl(origin.replace(/\/\*$/, '/')) !== undefined) : [];
  const permitted: string[] = [];
  for (const origin of enabled) if (await browser.permissions.contains({ origins: [origin] })) permitted.push(origin);
  const existing = (await browser.scripting.getRegisteredContentScripts()).some(script => script.id === REGISTRATION);
  if (!permitted.length) { if (existing) await browser.scripting.unregisterContentScripts({ ids: [REGISTRATION] }); return; }
  const script = { id: REGISTRATION, matches: permitted, js: ['/widget.js'], runAt: 'document_idle' as const, allFrames: false, persistAcrossSessions: true };
  if (existing) await browser.scripting.updateContentScripts([script]); else await browser.scripting.registerContentScripts([script]);
}

export function requestFloatingPermission(origins: string[]): Promise<boolean> {
  const options = import.meta.env.FIREFOX ? { origins, data_collection: ['websiteContent', 'personalCommunications'] } : { origins };
  return browser.permissions.request(options as Parameters<typeof browser.permissions.request>[0]);
}

export async function enableFloating(origins: string[]): Promise<void> {
  const settings = await browser.storage.local.get('floatingOrigins');
  const previous: string[] = Array.isArray(settings.floatingOrigins) ? settings.floatingOrigins : [];
  await browser.storage.local.set({ floatingOrigins: [...new Set([...previous, ...origins])] });
  await syncFloating();
  const tabs = await browser.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id || !tab.url) continue;
    const origin = `${new URL(tab.url).origin}/*`;
    if (origins.includes(origin)) {
      try { await browser.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, files: ['/widget.js'] }); }
      catch { /* Restricted or navigating pages will receive the widget on their next eligible load. */ }
    }
  }
}

export async function disableFloating(origins: string[]): Promise<void> {
  const settings = await browser.storage.local.get('floatingOrigins');
  const previous: string[] = Array.isArray(settings.floatingOrigins) ? settings.floatingOrigins : [];
  await browser.storage.local.set({ floatingOrigins: previous.filter(origin => !origins.includes(origin)) });
  await syncFloating();
  const tabs = await browser.tabs.query({});
  for (const tab of tabs) {
    if (tab.id && tab.url && origins.includes(`${new URL(tab.url).origin}/*`)) {
      try { await browser.tabs.sendMessage(tab.id, { type: 'widget.disable' }); } catch { /* No widget on this page. */ }
    }
  }
  await browser.permissions.remove({ origins });
}
