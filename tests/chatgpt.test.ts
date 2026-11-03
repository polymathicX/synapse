import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { CONFIGS } from '../providers/configs';
import { createDomAdapter } from '../providers/dom';

const html = readFileSync(new URL('./fixtures/chatgpt-logged-out.html', import.meta.url), 'utf8');
const adapter = createDomAdapter(CONFIGS.chatgpt);
const conversation = () => new JSDOM(html, { url: 'https://chatgpt.com/' }).window.document;

describe('ChatGPT markup captured from a real logged-out session', () => {
  it('captures both turns, preserves code and excludes account prompts', () => {
    const document = conversation();
    const result = adapter.capture(document);
    expect(result.status).toBe('partial');
    expect(result.value?.messages.map(message => message.role)).toEqual(['user', 'assistant']);
    expect(result.value?.messages[0]?.text).toContain('reading app named Cedar');
    expect(result.value?.title).toContain('reading app named Cedar');
    expect(result.value?.messages[1]?.text).toContain('```javascript\nconst project = "Cedar";\n```');
    expect(result.value?.messages[1]?.text).not.toMatch(/Log in|Sign up|Get better writing help/);
    expect(adapter.probe(document)).toEqual({ capture: true, insert: true });
  });

  it('restores into the logged-out textarea without replacing an existing draft', () => {
    const document = conversation();
    const composer = document.querySelector('textarea')!;
    const text = 'Continue Cedar.\n\n```js\nconst project = "Cedar";\n```';
    expect(adapter.insertDraft(document, text).status).toBe('success');
    expect(composer.value).toBe(text);
    expect(adapter.insertDraft(document, 'Replacement').status).toBe('unavailable');
    expect(composer.value).toBe(text);
  });

  it('waits for the current assistant turn to complete', () => {
    const document = conversation();
    document.querySelector('[data-message-role="assistant"]')!.removeAttribute('data-message-complete');
    document.querySelector('[aria-busy]')!.setAttribute('aria-busy', 'true');
    expect(adapter.capture(document).reason).toContain('still generating');
  });
});
