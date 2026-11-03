import type { DomConfig } from './dom';

export const CONFIGS = {
  chatgpt: {
    id: 'chatgpt',
    user: '[data-message-author-role="user"],[data-conversation-transcript] [data-message-role="user"],[data-turn-key] div:has(> [data-conversation-role="user"])',
    assistant: '[data-message-author-role="assistant"],[data-conversation-transcript] [data-message-role="assistant"],[data-turn-key] div:has(> [data-conversation-role="assistant"])',
    content: '[data-user-message-copy],[data-user-message-bubble],[data-assistant-markdown-root],[data-markdown-text-style],.markdown,.whitespace-pre-wrap',
    composer: '#prompt-textarea,textarea[data-mobile-composer-prompt],textarea#mobile-composer-prompt,[data-chatgpt-composer] [data-composer-markdown][contenteditable="true"]',
    streaming: '[data-conversation-transcript] [data-message-role="assistant"]:not([data-message-complete]),[data-turn-key] [data-talvt-turn-state]:not([data-talvt-turn-state="complete"])',
  },
  claude: { id: 'claude', user: '[data-testid="user-message"]', assistant: '[data-testid="assistant-message"],.font-claude-response', composer: '[contenteditable="true"][data-testid="chat-input"],.ProseMirror[contenteditable="true"]' },
  deepseek: { id: 'deepseek', user: '[data-message-role="user"],.ds-message--user', assistant: '[data-message-role="assistant"],.ds-message--assistant', composer: 'textarea#chat-input,textarea[placeholder*="DeepSeek"]' },
  kimi: { id: 'kimi', user: '[data-role="user"],.chat-item.user', assistant: '[data-role="assistant"],.chat-item.assistant', composer: '.chat-input-editor[contenteditable="true"],textarea.chat-input' },
  qwen: { id: 'qwen', user: '[data-message-role="user"],.user-message', assistant: '[data-message-role="assistant"],.assistant-message', composer: 'textarea#chat-input,#chat-input[contenteditable="true"]' },
} satisfies Record<string, DomConfig>;
