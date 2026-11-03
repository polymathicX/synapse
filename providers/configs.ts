import type { DomConfig } from './dom';

export const CONFIGS = {
  chatgpt: { id: 'chatgpt', user: '[data-message-author-role="user"]', assistant: '[data-message-author-role="assistant"]', content: '.markdown,.whitespace-pre-wrap', composer: '#prompt-textarea' },
  claude: { id: 'claude', user: '[data-testid="user-message"]', assistant: '[data-testid="assistant-message"],.font-claude-response', composer: '[contenteditable="true"][data-testid="chat-input"],.ProseMirror[contenteditable="true"]' },
  deepseek: { id: 'deepseek', user: '[data-message-role="user"],.ds-message--user', assistant: '[data-message-role="assistant"],.ds-message--assistant', composer: 'textarea#chat-input,textarea[placeholder*="DeepSeek"]' },
  kimi: { id: 'kimi', user: '[data-role="user"],.chat-item.user', assistant: '[data-role="assistant"],.chat-item.assistant', composer: '.chat-input-editor[contenteditable="true"],textarea.chat-input' },
  qwen: { id: 'qwen', user: '[data-message-role="user"],.user-message', assistant: '[data-message-role="assistant"],.assistant-message', composer: 'textarea#chat-input,#chat-input[contenteditable="true"]' },
} satisfies Record<string, DomConfig>;
