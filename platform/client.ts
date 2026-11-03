import { browser } from 'wxt/browser';
import type { Request, Response } from './protocol';

export async function request<T>(message: Request): Promise<T> {
  const response = await browser.runtime.sendMessage(message) as Response<T>;
  if (!response?.ok) throw new Error(response?.error ?? 'The background did not respond. Reopen the extension and try again.');
  return response.value as T;
}
