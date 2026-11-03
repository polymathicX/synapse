import type { ProviderId } from '../core/model';

export interface ProviderInfo { id: Exclude<ProviderId, 'manual'>; name: string; url: string; hosts: readonly string[]; script: `/${Exclude<ProviderId, 'manual'>}.js` }
export const PROVIDERS: readonly ProviderInfo[] = [
  { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/', hosts: ['chatgpt.com'], script: '/chatgpt.js' },
  { id: 'claude', name: 'Claude', url: 'https://claude.ai/new', hosts: ['claude.ai'], script: '/claude.js' },
  { id: 'deepseek', name: 'DeepSeek', url: 'https://chat.deepseek.com/', hosts: ['chat.deepseek.com'], script: '/deepseek.js' },
  { id: 'kimi', name: 'Kimi', url: 'https://www.kimi.com/', hosts: ['www.kimi.com', 'kimi.com', 'kimi.moonshot.cn'], script: '/kimi.js' },
  { id: 'qwen', name: 'Qwen', url: 'https://chat.qwen.ai/', hosts: ['chat.qwen.ai'], script: '/qwen.js' },
];
export function providerForUrl(value: string): ProviderInfo | undefined {
  try { const url = new URL(value); return url.protocol === 'https:' ? PROVIDERS.find(provider => provider.hosts.includes(url.hostname)) : undefined; }
  catch { return undefined; }
}
