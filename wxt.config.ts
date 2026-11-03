import { defineConfig } from 'wxt';

export default defineConfig({
  debug: false,
  manifestVersion: 3,
  manifest: ({ browser }) => ({
    name: 'Synapse',
    description: 'Preserve your AI working context and original files. Resume anywhere.',
    icons: { 16: '/icon/16.png', 32: '/icon/32.png', 48: '/icon/48.png', 128: '/icon/128.png' },
    permissions: ['activeTab', 'scripting', 'storage'],
    optional_permissions: browser === 'firefox' ? [] : ['unlimitedStorage'],
    optional_host_permissions: [
      'https://chatgpt.com/*', 'https://claude.ai/*', 'https://chat.deepseek.com/*',
      'https://www.kimi.com/*', 'https://kimi.com/*', 'https://kimi.moonshot.cn/*',
      'https://chat.qwen.ai/*',
    ],
    content_security_policy: {
      extension_pages: "default-src 'self'; script-src 'self'; object-src 'none'; worker-src 'self'; connect-src 'none'; img-src 'self' blob: data:; base-uri 'none'",
    },
    ...(browser === 'firefox' ? {
      browser_specific_settings: {
        gecko: {
          id: 'synapse-context@extension.local',
          strict_min_version: '140.0',
          data_collection_permissions: {
            required: ['none'],
            optional: ['websiteContent', 'personalCommunications'],
          },
        },
        gecko_android: { strict_min_version: '142.0' },
      },
    } : { minimum_chrome_version: '120' }),
  }),
  vite: () => ({ build: { sourcemap: false } }),
});
