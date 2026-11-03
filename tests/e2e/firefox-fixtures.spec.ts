import { test, expect, firefox } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { CHATGPT_HTML, CLAUDE_HTML } from '../fixtures';
import { parseSnapshot } from '../../core/model';

let browser: Browser;
let page: Page;
test.beforeAll(async () => { browser = await firefox.launch(); page = await browser.newPage(); });
test.afterAll(async () => browser?.close());

const fixtures = [
  { id: 'chatgpt', url: 'https://chatgpt.com/c/fixture', html: CHATGPT_HTML, composer: '#prompt-textarea' },
  { id: 'chatgpt', label: 'chatgpt logged-out observed markup', url: 'https://chatgpt.com/', html: readFileSync(new URL('../fixtures/chatgpt-logged-out.html', import.meta.url), 'utf8'), composer: '#mobile-composer-prompt' },
  { id: 'chatgpt', label: 'chatgpt signed-in Project observed markup', url: 'https://chatgpt.com/g/g-p-fixture/project/c/fixture', html: readFileSync(new URL('../fixtures/chatgpt-signed-in-project.html', import.meta.url), 'utf8'), composer: '[data-composer-markdown]' },
  { id: 'claude', url: 'https://claude.ai/chat/fixture', html: CLAUDE_HTML, composer: '.ProseMirror' },
  { id: 'deepseek', url: 'https://chat.deepseek.com/', html: '<div data-message-role="user">Question</div><div data-message-role="assistant">Answer</div><textarea id="chat-input"></textarea>', composer: '#chat-input' },
  { id: 'kimi', url: 'https://www.kimi.com/', html: '<div class="chat-item user">Question</div><div class="chat-item assistant">Answer</div><div class="chat-input-editor" contenteditable="true"></div>', composer: '.chat-input-editor' },
  { id: 'qwen', url: 'https://chat.qwen.ai/', html: '<div class="user-message">Question</div><div class="assistant-message">Answer</div><textarea id="chat-input"></textarea>', composer: '#chat-input' },
];
for (const fixture of fixtures) {
  test(`Firefox DOM fixture: ${fixture.label ?? fixture.id} capture and draft preservation`, async () => {
    await page.route(`${new URL(fixture.url).origin}/**`, route => route.fulfill({ body: fixture.html, contentType: 'text/html' }));
    await page.goto(fixture.url);
    // This is a browser-neutral adapter harness, not an installed Firefox add-on test.
    await page.evaluate(() => {
      const runtime = { id: 'synapse-fixture', onMessage: {
        addListener(listener: unknown) { (globalThis as unknown as Record<string, unknown>).fixtureListener = listener; },
        removeListener() { /* Keep a test-only reference to the callback. */ },
      } };
      (globalThis as unknown as Record<string, unknown>).browser = { runtime };
    });
    const script = path.resolve(`.output/firefox-mv3/${fixture.id}.js`);
    await page.addScriptTag({ path: script });
    const captured = await page.evaluate(() => new Promise<Record<string, unknown>>(resolve => {
      const listener = (globalThis as unknown as { fixtureListener: (message: unknown, sender: unknown, respond: (value: Record<string, unknown>) => void) => void }).fixtureListener;
      listener({ type: 'adapter.capture' }, { id: 'synapse-fixture' }, resolve);
    }));
    expect(captured.status).toBe('partial'); expect(parseSnapshot(captured.value).messages).toHaveLength(2);
    await page.addScriptTag({ path: script });
    const stale = await page.evaluate(() => new Promise<Record<string, unknown>>(resolve => {
      const listener = (globalThis as unknown as { fixtureListener: (message: unknown, sender: unknown, respond: (value: Record<string, unknown>) => void) => void }).fixtureListener;
      listener({ type: 'adapter.insert', text: 'Do not insert into a different chat', expectedUrl: 'https://different.example/' }, { id: 'synapse-fixture' }, resolve);
    }));
    expect(stale.status).toBe('unavailable');
    for (const expected of ['success', 'unavailable']) {
      await page.addScriptTag({ path: script });
      const result = await page.evaluate(() => new Promise<Record<string, unknown>>(resolve => {
        const listener = (globalThis as unknown as { fixtureListener: (message: unknown, sender: unknown, respond: (value: Record<string, unknown>) => void) => void }).fixtureListener;
        listener({ type: 'adapter.insert', text: 'Resumed context <img src=x onerror="throw Error()">' }, { id: 'synapse-fixture' }, resolve);
      }));
      expect(result.status).toBe(expected);
    }
    const composer = page.locator(fixture.composer);
    if (await composer.evaluate(element => element.tagName === 'TEXTAREA')) await expect(composer).toHaveValue('Resumed context <img src=x onerror="throw Error()">');
    else await expect(composer).toHaveText('Resumed context <img src=x onerror="throw Error()">');
    await expect(page.locator('img')).toHaveCount(0);
  });
}
