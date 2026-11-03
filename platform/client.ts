import { browser } from 'wxt/browser';
import type { Request, Response } from './protocol';

export async function request<T>(message: Request): Promise<T> {
  // A content script can survive history.pushState; sender.url may remain its initial URL.
  const payload = message.type.startsWith('widget.') ? { ...message, pageUrl: location.href } : message;
  const response = await browser.runtime.sendMessage(payload) as Response<T>;
  if (!response?.ok) throw new Error(response?.error ?? 'The background did not respond. Reopen the extension and try again.');
  return response.value as T;
}
