import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { createDomAdapter } from '../providers/dom';
import { CONFIGS } from '../providers/configs';
import { CHATGPT_HTML, CLAUDE_HTML } from './fixtures';

describe('provider adapter contracts (synthetic fixtures)', () => {
  it.each([
    ['chatgpt', CHATGPT_HTML, 'https://chatgpt.com/c/test'],
    ['claude', CLAUDE_HTML, 'https://claude.ai/chat/test'],
    ['deepseek', '<div data-message-role="user">Question</div><div data-message-role="assistant">Answer</div><textarea id="chat-input"></textarea>', 'https://chat.deepseek.com/'],
    ['kimi', '<div class="chat-item user">Question</div><div class="chat-item assistant">Answer</div><div class="chat-input-editor" contenteditable="true"></div>', 'https://www.kimi.com/'],
    ['qwen', '<div class="user-message">Question</div><div class="assistant-message">Answer</div><textarea id="chat-input"></textarea>', 'https://chat.qwen.ai/'],
  ] as const)('%s captures ordered messages and inserts without submitting', (id, html, url) => {
    const document = new JSDOM(html, { url }).window.document; const adapter = createDomAdapter(CONFIGS[id]);
    const result = adapter.capture(document); expect(result.status).toBe('partial');
    expect(result.value?.messages.map(message => message.role)).toEqual(['user', 'assistant']); expect(result.value?.capture.complete).toBe(false);
    expect(adapter.insertDraft(document, 'Transferred context').status).toBe('success');
    expect(adapter.insertDraft(document, 'Do not replace').reason).toContain('already has a draft');
  });
  it('preserves fenced code and missing original references', () => {
    const document = new JSDOM(CHATGPT_HTML, { url: 'https://chatgpt.com/' }).window.document;
    const snapshot = createDomAdapter(CONFIGS.chatgpt).capture(document).value!;
    expect(snapshot.messages[1]!.text).toContain("```ts\nconst db = openDB('context');\n```");
    expect(snapshot.attachments[0]?.availability).toBe('missing');
  });
  it('refuses streaming, unknown layouts, hidden messages, and ambiguous composers', () => {
    const document = new JSDOM(CHATGPT_HTML, { url: 'https://chatgpt.com/' }).window.document; const adapter = createDomAdapter(CONFIGS.chatgpt);
    document.body.insertAdjacentHTML('beforeend', '<div data-is-streaming="true"></div>'); expect(adapter.capture(document).status).toBe('unavailable');
    document.body.innerHTML = '<p>Unknown UI</p>'; expect(adapter.capture(document).status).toBe('unavailable');
    document.body.innerHTML = '<div hidden data-message-author-role="user">Private hidden content</div>'; expect(adapter.capture(document).status).toBe('unavailable');
    document.body.innerHTML = '<textarea id="prompt-textarea"></textarea><textarea id="prompt-textarea"></textarea>'; expect(adapter.insertDraft(document, 'Context').status).toBe('unavailable');
  });
  it('avoids duplicate nested assistant roots', () => {
    const document = new JSDOM('<div data-testid="assistant-message"><div class="font-claude-response">Only once</div></div>', { url: 'https://claude.ai/' }).window.document;
    expect(createDomAdapter(CONFIGS.claude).capture(document).value?.messages).toHaveLength(1);
  });
  it('preserves code whitespace and records image-only messages as missing originals', () => {
    const document = new JSDOM('<main><div data-message-author-role="user"><img alt="diagram.png" src="blob:fixture"></div><div data-message-author-role="assistant"><pre><code>line one\n\n\n  indented line</code></pre></div></main>', { url: 'https://chatgpt.com/' }).window.document;
    const result = createDomAdapter(CONFIGS.chatgpt).capture(document).value!;
    expect(result.messages[0]?.text).toContain('Image: diagram.png'); expect(result.attachments[0]?.availability).toBe('missing');
    expect(result.messages[1]?.text).toContain('line one\n\n\n  indented line');
  });
});
