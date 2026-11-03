// Opt-in test against the real website. Sends only the generated Cedar test task.
// Uses a disposable profile and the unmodified production extension; no routing/mocks.
/* global document, indexedDB, getComputedStyle */
import { chromium, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout, clearTimeout } from 'node:timers';

const extension = path.resolve('.output/chrome-mv3');
const root = await mkdtemp(path.join(tmpdir(), 'synapse-chatgpt-live-'));
const profile = path.join(root, 'profile');
const report = { url: 'https://chatgpt.com/', mocked: false, profile: 'disposable', checks: [] };
const prompt = 'We are planning a small reading app named Cedar. Our decision is to keep notes on the device, and the constraint is no account required. Next step: implement a local search box. Reply with a short summary and a JavaScript code block containing const project = "Cedar";';
const composerSelector = '#prompt-textarea,textarea[data-mobile-composer-prompt],textarea#mobile-composer-prompt';
let context;

async function launch() {
  context = await chromium.launchPersistentContext(profile, {
    ...(process.env.SYNAPSE_TEST_BROWSER ? { executablePath: process.env.SYNAPSE_TEST_BROWSER } : { channel: 'chromium' }),
    headless: process.env.SYNAPSE_LIVE_HEADLESS === '1', viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  return new URL(worker.url()).host;
}

async function control(page, predicate) {
  const cdp = await context.newCDPSession(page);
  function find(node, matches) {
    if (matches(node)) return node;
    for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])]) {
      const result = find(child, matches); if (result) return result;
    }
  }
  let nodeId;
  try {
    await expect.poll(async () => {
      const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
      const host = find(root, node => node.attributes?.includes('synapse-floating'));
      nodeId = host ? find(host, predicate)?.nodeId : undefined; return !!nodeId;
    }, { timeout: 15_000, message: 'Real-page Synapse control should be available' }).toBe(true);
    return { cdp, nodeId };
  } catch (error) { await cdp.detach(); throw error; }
}

async function click(page, label) {
  await page.bringToFront();
  const { cdp, nodeId } = await control(page, node => node.nodeName === 'BUTTON' && node.children?.some(child => child.nodeValue === label));
  try {
    const box = await bounds(cdp, nodeId);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  } finally { await cdp.detach(); }
}

async function bounds(cdp, nodeId) {
  const { object } = await cdp.send('DOM.resolveNode', { nodeId });
  const result = await cdp.send('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: 'function () { const r = this.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }', returnByValue: true });
  return result.result.value;
}

async function widgetText(page, className) {
  const { cdp, nodeId } = await control(page, node => node.attributes?.some((value, index, attrs) => index % 2 === 0 && value === 'class' && attrs[index + 1]?.split(' ').includes(className)));
  try {
    const { object } = await cdp.send('DOM.resolveNode', { nodeId });
    const result = await cdp.send('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: 'function () { return this.textContent; }', returnByValue: true });
    return result.result.value;
  } finally { await cdp.detach(); }
}

async function draft(page) {
  return page.locator(composerSelector).filter({ visible: true }).evaluate(element => element.tagName === 'TEXTAREA' ? element.value : element.innerText);
}

async function captureDrag(page) {
  await page.bringToFront();
  const { cdp, nodeId } = await control(page, node => node.nodeName === 'ARTICLE' && node.attributes?.includes('entry') && node.attributes?.includes('true'));
  try {
    const box = await bounds(cdp, nodeId);
    await cdp.send('Input.setInterceptDrags', { enabled: true });
    let timer;
    const intercepted = new Promise((resolve, reject) => {
      cdp.once('Input.dragIntercepted', resolve);
      timer = setTimeout(() => reject(new Error('Native saved-entry drag did not start.')), 10_000);
    });
    const x = box.x + box.width / 2, y = box.y + 12;
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    for (const offset of [25, 100]) await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x - offset, y: y - offset / 2, button: 'left', buttons: 1 });
    const packet = await intercepted.finally(() => clearTimeout(timer));
    await cdp.send('Input.cancelDragging');
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x - 100, y: y - 50, button: 'left', buttons: 0, clickCount: 1 });
    await cdp.send('Input.setInterceptDrags', { enabled: false });
    return packet.data;
  } finally { await cdp.detach(); }
}

async function waitForAnswer(page) {
  await expect.poll(() => page.evaluate(() => {
    const streaming = [...document.querySelectorAll('[data-is-streaming="true"],.result-streaming,[data-testid="stop-button"],button[aria-label="Stop generating"]')];
    if (streaming.some(element => element.checkVisibility() && getComputedStyle(element).visibility !== 'hidden')) return false;
    const modern = [...document.querySelectorAll('[data-conversation-transcript] [data-message-role="assistant"]')];
    if (modern.length) return modern.every(element => element.hasAttribute('data-message-complete')) && !!modern.at(-1).querySelector('[data-assistant-markdown-root]')?.textContent.trim();
    return !!document.querySelector('[data-message-author-role="assistant"]')?.textContent.trim()
      && !document.querySelector('[data-testid="stop-button"],.result-streaming,button[aria-label="Stop generating"]');
  }), { timeout: 180_000, message: 'Real ChatGPT should finish a response' }).toBe(true);
}

try {
  await mkdir('artifacts', { recursive: true });
  console.log('Live ChatGPT test: sending a generated Cedar task in a disposable logged-out profile.');
  let id = await launch(); report.browser = await context.browser()?.version();
  const source = await context.newPage(); await source.goto(report.url, { waitUntil: 'domcontentloaded' });
  await expect(source.getByRole('button', { name: 'Log in', exact: true }).first()).toBeVisible({ timeout: 30_000 });
  const ui = await context.newPage(); await ui.goto(`chrome-extension://${id}/workspace.html`);
  await expect(ui.locator('#save')).toBeEnabled();
  await ui.getByRole('checkbox', { name: 'Floating Synapse on ChatGPT', exact: true }).check();
  console.log('Approve the ChatGPT host-access prompt in the disposable browser if it appears.');
  await expect(ui.locator('#status')).toContainText('Floating Synapse enabled', { timeout: 120_000 });
  console.log('ChatGPT permission granted through the real workspace control.');
  await source.bringToFront();
  const composer = source.locator(composerSelector).filter({ visible: true });
  await composer.fill(prompt); await composer.press('Enter');
  await waitForAnswer(source); report.checks.push('logged-out real prompt and completed response'); console.log('Real ChatGPT response complete.');
  report.layout = await source.locator('[data-conversation-transcript]').count() ? 'conversation-transcript' : 'message-author-role';
  await click(source, '✳ Save chat');
  await expect.poll(async () => { const text = await widgetText(source, 'toast'); if (text) report.captureToast = text; return !!text; }, { timeout: 30_000 }).toBe(true);
  expect(report.captureToast).toContain('Saved “');
  await expect.poll(() => widgetText(source, 'entry')).toContain('Cedar');
  await ui.reload();
  const stored = await ui.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('synapse-context'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    try {
      const read = store => new Promise((resolve, reject) => { const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      return { snapshots: await read('snapshots'), transcripts: await read('transcripts') };
    } finally { db.close(); }
  });
  expect(stored.snapshots).toHaveLength(1);
  expect(stored.snapshots[0].messageCount).toBe(2);
  const raw = JSON.stringify(stored.transcripts); expect(raw).toContain('Cedar'); expect(raw).toContain('```javascript'); expect(raw).not.toContain('Get better writing help');
  report.checks.push('one-click save commits both roles and fenced code to IndexedDB');
  await source.screenshot({ path: 'artifacts/chatgpt-live-save.png' });
  const packet = await captureDrag(source);
  const handoff = packet.items.find(item => item.mimeType === 'text/plain')?.data;
  expect(handoff).toContain('Cedar');
  const destination = await context.newPage(); await destination.goto(report.url, { waitUntil: 'domcontentloaded' });
  await expect(destination.locator('#synapse-floating')).toBeAttached({ timeout: 30_000 });
  const target = destination.locator(composerSelector).filter({ visible: true });
  await click(destination, '▤');
  await target.fill('Keep this existing draft.'); await click(destination, 'Insert');
  await expect.poll(() => widgetText(destination, 'toast')).toContain('already has a draft');
  expect(await draft(destination)).toBe('Keep this existing draft.'); report.checks.push('existing real ChatGPT draft is preserved');
  await target.fill(''); await click(destination, 'Insert');
  await expect.poll(() => draft(destination)).toBe(handoff);
  await destination.locator('body').click({ position: { x: 300, y: 80 } });
  expect(await draft(destination)).toBe(handoff); report.checks.push('saved entry inserts and survives blur in fresh real ChatGPT');
  await target.fill('');
  const dropCdp = await context.newCDPSession(destination);
  const box = await target.boundingBox(); if (!box) throw new Error('Real destination composer is not visible.');
  for (const type of ['dragEnter', 'dragOver', 'drop']) await dropCdp.send('Input.dispatchDragEvent', { type, x: box.x + 30, y: box.y + 20, data: packet });
  await dropCdp.detach();
  await expect.poll(() => draft(destination)).toBe(handoff); report.checks.push('native saved-entry drag packet drops into fresh real ChatGPT');
  await expect(destination.locator('[data-message-role="user"],[data-message-author-role="user"]')).toHaveCount(0);
  report.checks.push('extension did not submit the handoff');
  await destination.screenshot({ path: 'artifacts/chatgpt-live-resume.png' });
  // Explicit test submission verifies the site's own state consumed the inserted draft.
  await target.press('Enter'); await waitForAnswer(destination);
  await expect(destination.locator('[data-message-role="user"],[data-message-author-role="user"]').first()).toContainText('Cedar');
  await expect(destination.locator('[data-message-role="assistant"],[data-message-author-role="assistant"]').last()).toContainText('Cedar');
  report.checks.push('ChatGPT consumes the transferred draft and replies about Cedar after explicit test submission');
  await context.close(); id = await launch();
  const reopened = await context.newPage(); await reopened.goto(`chrome-extension://${id}/workspace.html?id=${stored.snapshots[0].id}`);
  await expect(reopened.locator('#title')).toHaveValue(stored.snapshots[0].title);
  await expect(reopened.locator('#messages')).toContainText('Cedar');
  report.checks.push('saved snapshot reopens after a complete browser restart');
  report.result = 'passed'; console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.result = 'failed'; report.error = error.message;
  for (const [index, page] of (context?.pages() ?? []).entries()) await page.screenshot({ path: `artifacts/chatgpt-live-failure-${index}.png` }).catch(() => {});
  console.error(error); process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile('artifacts/chatgpt-live.json', JSON.stringify(report, null, 2));
  await context?.close();
}
