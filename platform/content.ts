import { browser } from 'wxt/browser';
import * as v from 'valibot';
import { AdapterCommandSchema } from './protocol';
import type { ProviderAdapter } from '../providers/dom';

export function installAdapter(adapter: ProviderAdapter): void {
  const globals = globalThis as typeof globalThis & { synapseAdapterListener?: Parameters<typeof browser.runtime.onMessage.addListener>[0] };
  if (globals.synapseAdapterListener) browser.runtime.onMessage.removeListener(globals.synapseAdapterListener);
  const listener: Parameters<typeof browser.runtime.onMessage.addListener>[0] = (message, sender, respond) => {
    if (sender.id !== browser.runtime.id) return false;
    const parsed = v.safeParse(AdapterCommandSchema, message);
    if (!parsed.success) return false;
    browser.runtime.onMessage.removeListener(listener);
    delete globals.synapseAdapterListener;
    const command = parsed.output;
    if (command.expectedUrl && location.href !== command.expectedUrl) {
      respond({ status: 'unavailable', reason: 'The chat changed before the operation completed. Try again on the intended conversation.' });
      return false;
    }
    const value = command.type === 'adapter.capture' ? adapter.capture(document) : adapter.insertDraft(document, command.text);
    respond(value);
    return false;
  };
  globals.synapseAdapterListener = listener;
  browser.runtime.onMessage.addListener(listener);
}
