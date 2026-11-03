import { browser } from 'wxt/browser';

export async function requireTransferConsent(): Promise<void> {
  if (!import.meta.env.FIREFOX) return;
  const granted = await browser.permissions.contains({ data_collection: ['websiteContent', 'personalCommunications'] } as Parameters<typeof browser.permissions.contains>[0]);
  if (!granted) throw new Error('Provider transfer consent is disabled. Re-enable floating Synapse or grant transfer consent in the workspace.');
}
