import { test, expect, chromium } from '@playwright/test';
import type { BrowserContext, Page, CDPSession } from '@playwright/test';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { importArchive } from '../../core/archive';
import { CHATGPT_HTML, CLAUDE_HTML, officeFile, simplePdf } from '../fixtures';
import { cpus } from 'node:os';

let root: string;
let extension: string;
let profile: string;
let context: BrowserContext;
let extensionId: string;
let page: Page;

interface DebugNode { nodeId: number; nodeName: string; nodeValue?: string; attributes?: string[]; children?: DebugNode[]; shadowRoots?: DebugNode[] }
interface NativeDragData { items: { mimeType: string; data: string; title?: string; baseURL?: string }[]; dragOperationsMask: number; files?: string[] }
async function widgetNode(target: Page, predicate: (node: DebugNode) => boolean): Promise<{ cdp: CDPSession; nodeId: number }> {
  const cdp = await context.newCDPSession(target);
  function find(node: DebugNode): number | undefined {
    if (predicate(node)) return node.nodeId;
    for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])]) { const result = find(child); if (result) return result; }
    return undefined;
  }
  let nodeId: number | undefined;
  await expect.poll(async () => { const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true }); nodeId = find(root); return nodeId; }, { message: 'Widget control should become available' }).toBeTruthy();
  if (!nodeId) { await cdp.detach(); throw new Error('Widget control was not found.'); }
  return { cdp, nodeId };
}
async function shadowAction(target: Page, text: string) {
  const { cdp, nodeId } = await widgetNode(target, node => node.nodeName === 'BUTTON' && !!node.children?.some(child => child.nodeValue === text));
  const { model } = await cdp.send('DOM.getBoxModel', { nodeId });
  const quad = model.content; await target.mouse.click((quad[0]! + quad[4]!) / 2, (quad[1]! + quad[5]!) / 2); await cdp.detach();
}

async function savedCounts(): Promise<number[]> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('synapse-context'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      return await new Promise<number[]>((resolve, reject) => { const request = database.transaction('snapshots').objectStore('snapshots').getAll(); request.onsuccess = () => resolve(request.result.filter((row: { title: string }) => row.title === 'Project Apollo').map((row: { messageCount: number }) => row.messageCount)); request.onerror = () => reject(request.error); });
    } finally { database.close(); }
  });
}

async function launch(userDataDir: string, source = extension) {
  const browser = await chromium.launchPersistentContext(userDataDir, {
    ...(process.env.SYNAPSE_TEST_BROWSER ? { executablePath: process.env.SYNAPSE_TEST_BROWSER } : { channel: 'chromium' }), headless: true, viewport: { width: 1440, height: 1080 },
    args: [`--disable-extensions-except=${source}`, `--load-extension=${source}`],
  });
  let worker = browser.serviceWorkers()[0]; worker ??= await browser.waitForEvent('serviceworker');
  return { browser, id: new URL(worker.url()).host };
}
test.beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'synapse-e2e-')); extension = path.join(root, 'extension'); profile = path.join(root, 'profile');
  await cp(path.resolve('.output/chrome-mv3'), extension, { recursive: true });
  // Only this disposable test copy pre-grants host access to controlled fixtures.
  const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'));
  manifest.host_permissions = ['https://chatgpt.com/*', 'https://claude.ai/*'];
  await writeFile(path.join(extension, 'manifest.json'), JSON.stringify(manifest));
  ({ browser: context, id: extensionId } = await launch(profile));
  page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/workspace.html`); await expect(page.locator('#save')).toBeEnabled();
  await page.locator('#title').fill('Fixture baseline'); await page.locator('#save').click(); await expect(page.locator('#save-state')).toHaveText('Saved locally');
});
test.afterAll(async () => { await context?.close(); });

test('manual context, text/PDF/Office extraction, bundle, browser restart, clean-profile import', async () => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`chrome-extension://${extensionId}/workspace.html`);
  await expect(page.locator('#save')).toBeEnabled();
  await page.locator('#title').fill('Portable working context');
  await page.locator('#goal').fill('Resume the same task in another service');
  await page.locator('#summary').fill('Keep decisions, constraints, code and original files.');
  await page.locator('#decisions').fill('Keep everything local\nUse original bytes');
  await page.locator('#constraints').fill('No telemetry');
  await page.locator('#next-steps').fill('Review the next implementation');
  await page.locator('#add-message').click(); await page.locator('#message-text').fill('Preserve this code:\n```ts\nconst answer = 42;\n```'); await page.locator('#commit-message').click();
  const originals = [
    { name: 'notes.md', mimeType: 'text/markdown', buffer: Buffer.from('# Original notes\nHello বাংলা') },
    { name: 'reference.pdf', mimeType: 'application/pdf', buffer: simplePdf() },
    { name: 'document.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(officeFile('docx')) },
    { name: 'slides.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: Buffer.from(officeFile('pptx')) },
    { name: 'image.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII=', 'base64') },
  ];
  await page.locator('#file-picker').setInputFiles(originals);
  await expect(page.locator('#files .file')).toHaveCount(5);
  for (const original of originals) {
    await page.locator('#files .file').filter({ has: page.getByText(original.name, { exact: true }) }).getByRole('button', { name: 'Extract text' }).click();
    await expect(page.locator('#save')).toBeEnabled();
    await expect(page.locator('#status'), original.name).not.toHaveClass(/error/);
  }
  await page.locator('#preview').click();
  for (const text of ['Original notes', 'Original PDF text', 'Original docx text', '[Slide 1]', 'Original pptx text']) await expect(page.locator('#handoff')).toContainText(text);
  await page.locator('#save').click(); await expect(page.locator('#save-state')).toHaveText('Saved locally');
  const savedUrl = page.url();
  const downloadEvent = page.waitForEvent('download'); await page.locator('#export-bundle').click(); const download = await downloadEvent;
  const archivePath = path.join(root, 'saved.synapse.zip'); await download.saveAs(archivePath);
  const imported = await importArchive(new Blob([await readFile(archivePath)]));
  expect(imported.snapshot.decisions).toEqual(['Keep everything local', 'Use original bytes']);
  for (const original of originals) {
    const metadata = imported.snapshot.attachments.find(file => file.name === original.name)!;
    expect(Buffer.from(await imported.files.get(metadata.id)!.arrayBuffer())).toEqual(original.buffer);
  }
  expect(errors).toEqual([]);
  await context.close();
  ({ browser: context, id: extensionId } = await launch(profile)); page = await context.newPage(); await page.goto(savedUrl);
  await expect(page.locator('#title')).toHaveValue('Portable working context'); await expect(page.locator('#files .file')).toHaveCount(5);
  const clean = await launch(path.join(root, 'clean-profile'));
  try {
    const cleanPage = await clean.browser.newPage(); await cleanPage.goto(`chrome-extension://${clean.id}/workspace.html`);
    await expect(cleanPage.locator('#save')).toBeEnabled(); await cleanPage.locator('#import-file').setInputFiles(archivePath);
    await expect(cleanPage.locator('#status')).toContainText('Context imported'); await expect(cleanPage.locator('#title')).toHaveValue('Portable working context');
    const originalDownload = cleanPage.waitForEvent('download');
    await cleanPage.locator('#files .file').filter({ has: cleanPage.getByText('notes.md', { exact: true }) }).getByRole('button', { name: 'Download original' }).click();
    expect(await readFile(await (await originalDownload).path())).toEqual(originals[0]!.buffer);
  } finally { await clean.browser.close(); }
  await page.screenshot({ path: 'artifacts/workspace.png', fullPage: true });
});

test('floating one-click save, destination tray, drop and existing-draft protection', async () => {
  await context.route('https://chatgpt.com/**', route => route.fulfill({ contentType: 'text/html', body: CHATGPT_HTML }));
  await context.route('https://claude.ai/**', route => route.fulfill({ contentType: 'text/html', body: CLAUDE_HTML }));
  const source = await context.newPage(); await source.goto('https://chatgpt.com/c/fixture');
  // Enable through the real workspace control; the host grant is already present in the disposable manifest.
  await page.goto(`chrome-extension://${extensionId}/workspace.html`); await expect(page.locator('#save')).toBeEnabled();
  await page.getByText('Enable one-click saving & drag to resume').click();
  await page.getByRole('checkbox', { name: 'Floating Synapse on ChatGPT', exact: true }).check(); await expect(page.locator('#save')).toBeEnabled();
  await page.getByRole('checkbox', { name: 'Floating Synapse on Claude', exact: true }).check(); await expect(page.locator('#save')).toBeEnabled();
  await expect(source.locator('#synapse-floating')).toBeAttached();
  await shadowAction(source, '✳ Save chat');
  await expect.poll(async () => {
    await page.reload(); return page.locator('#library').textContent();
  }).toContain('Project Apollo');
  // Intercept a real native drag after the row's actual dragstart handler fills DataTransfer.
  await source.bringToFront();
  const { cdp: dragCdp, nodeId: row } = await widgetNode(source, node => node.nodeName === 'ARTICLE' && !!node.attributes?.includes('entry'));
  const { model: rowModel } = await dragCdp.send('DOM.getBoxModel', { nodeId: row }); const rowQuad = rowModel.content;
  await expect.poll(async () => {
    const { node } = await dragCdp.send('DOM.describeNode', { nodeId: row }); return node.attributes?.join(' ');
  }).toContain('draggable true');
  await dragCdp.send('Input.setInterceptDrags', { enabled: true });
  let dragTimer: ReturnType<typeof setTimeout> | undefined;
  const nativeDrag = new Promise<{ data: NativeDragData }>((resolve, reject) => {
    dragCdp.once('Input.dragIntercepted', resolve); dragTimer = setTimeout(() => reject(new Error('The native drag did not start.')), 5000);
  });
  const startX = (rowQuad[0]! + rowQuad[4]!) / 2, startY = rowQuad[1]! + 12;
  // Raw CDP input avoids Playwright's own drag interceptor stealing this event.
  await dragCdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: startX, y: startY });
  await dragCdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: startX, y: startY, button: 'left', buttons: 1, clickCount: 1 });
  await dragCdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: startX - 25, y: startY - 10, button: 'left', buttons: 1 });
  await dragCdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: startX - 100, y: startY - 50, button: 'left', buttons: 1 });
  const nativePacket = await nativeDrag; clearTimeout(dragTimer);
  await dragCdp.send('Input.cancelDragging');
  await dragCdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: startX - 100, y: startY - 50, button: 'left', buttons: 0, clickCount: 1 });
  await dragCdp.send('Input.setInterceptDrags', { enabled: false }); await dragCdp.detach();
  const handoffText = nativePacket.data.items.find(item => item.mimeType === 'text/plain')!.data;
  expect(handoffText).toContain('Working context: Project Apollo'); expect(handoffText).toContain("const db = openDB('context');");
  const destination = await context.newPage(); await destination.goto('https://claude.ai/new');
  await destination.evaluate(() => document.querySelector('#send')!.addEventListener('click', () => { document.body.dataset.synapseSubmitted = 'true'; }));
  await expect(destination.locator('#synapse-floating')).toBeAttached();
  await shadowAction(destination, '▤');
  const dropCdp = await context.newCDPSession(destination);
  async function dropNativePacket() {
    const box = await destination.locator('.ProseMirror').boundingBox(); if (!box) throw new Error('Destination composer is hidden.');
    for (const type of ['dragEnter', 'dragOver', 'drop'] as const) await dropCdp.send('Input.dispatchDragEvent', { type, x: box.x + 20, y: box.y + 15, data: nativePacket.data });
  }
  await dropNativePacket();
  await expect.poll(() => destination.locator('.ProseMirror').evaluate(element => (element as HTMLElement).innerText.trimEnd())).toBe(handoffText.trimEnd());
  await dropNativePacket();
  await expect(destination.locator('.ProseMirror')).toHaveText(handoffText, { useInnerText: true });
  await destination.screenshot({ path: 'artifacts/floating-context.png' });
  // Verify normal tray insertion uses the saved snapshot, and does not click Send.
  await destination.locator('.ProseMirror').fill(''); await shadowAction(destination, '▤'); await shadowAction(destination, 'Insert');
  await expect(destination.locator('.ProseMirror')).toContainText('Working context: Project Apollo');
  await expect(destination.locator('body')).not.toHaveAttribute('data-synapse-submitted');
  await dropCdp.detach();
  // Opt-in automatic preservation saves changed conversation data, without polling.
  await source.bringToFront();
  const { cdp: autoCdp, nodeId: autoNode } = await widgetNode(source, node => node.nodeName === 'INPUT' && !!node.attributes?.includes('checkbox'));
  const { object: autoObject } = await autoCdp.send('DOM.resolveNode', { nodeId: autoNode });
  await autoCdp.send('Runtime.callFunctionOn', { objectId: autoObject.objectId!, functionDeclaration: 'function () { this.click(); }' });
  await expect.poll(async () => (await autoCdp.send('DOM.getAttributes', { nodeId: autoNode })).attributes.join(' ')).toContain('Auto-save enabled');
  await autoCdp.detach();
  await source.evaluate(() => document.querySelector('main')!.insertAdjacentHTML('beforeend', '<article data-message-author-role="user">An automatically preserved follow-up.</article>'));
  await expect.poll(savedCounts).toContain(3);
  await source.close(); await destination.close();
});

test('background suspension does not lose context and a UI message restarts it', async () => {
  await page.goto(`chrome-extension://${extensionId}/workspace.html`); await expect(page.locator('#save')).toBeEnabled();
  const cdp = await context.newCDPSession(page); await cdp.send('ServiceWorker.enable'); await cdp.send('ServiceWorker.stopAllWorkers');
  const response = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'open-workspace' })); expect(response.ok).toBe(true);
  await page.reload(); await expect(page.locator('#library')).toContainText('Fixture baseline'); await cdp.detach();
});

test('observed logged-out ChatGPT markup saves and restores through the installed extension', async () => {
  const html = await readFile(new URL('../fixtures/chatgpt-logged-out.html', import.meta.url), 'utf8');
  await context.route('https://chatgpt.com/**', route => {
    const pathname = new URL(route.request().url()).pathname;
    const body = pathname === '/new' ? html.replace(/<ol[\s\S]*<\/ol>/, '') : pathname === '/streaming' ? html.replace(' data-message-complete=""', '') : html;
    return route.fulfill({ contentType: 'text/html', body });
  });
  const source = await context.newPage(); await source.goto('https://chatgpt.com/streaming');
  await page.goto(`chrome-extension://${extensionId}/workspace.html`); await expect(page.locator('#save')).toBeEnabled();
  await page.getByRole('checkbox', { name: 'Floating Synapse on ChatGPT', exact: true }).check(); await expect(page.locator('#save')).toBeEnabled();
  await shadowAction(source, '✳ Save chat');
  const error = await widgetNode(source, node => !!node.children?.some(child => child.nodeValue?.includes('still generating')));
  await error.cdp.detach();
  await source.goto('https://chatgpt.com/c/observed');
  // The content script survives SPA navigation, but MessageSender.url can retain its injection URL.
  await source.evaluate(() => history.pushState({}, '', '/c/cedar-spa'));
  const rejected = await page.evaluate(async () => {
    const tab = (await chrome.tabs.query({})).find(tab => tab.url?.endsWith('/c/cedar-spa'))!;
    const results = [];
    for (const pageUrl of ['https://chatgpt.com/c/observed', 'https://claude.ai/new']) {
      const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id! }, func: (pageUrl: string) => chrome.runtime.sendMessage({ type: 'widget.capture', pageUrl }), args: [pageUrl] });
      results.push(result!.result);
    }
    return results;
  });
  for (const result of rejected) { expect(result.ok).toBe(false); expect(result.error).toContain('chat changed'); }
  await shadowAction(source, '✳ Save chat');
  const saved = await widgetNode(source, node => node.nodeName === 'ARTICLE' && !!node.attributes?.includes('entry'));
  await saved.cdp.detach();
  await page.reload();
  const entry = page.locator('#library button').filter({ hasText: 'reading app named Cedar' });
  await expect(entry).toHaveCount(1); await entry.click();
  await expect(page.locator('#messages')).toContainText('```javascript');
  await expect(page.locator('#messages')).not.toContainText('Get better writing help');
  const destination = await context.newPage(); await destination.goto('https://chatgpt.com/new');
  await expect(destination.locator('#synapse-floating')).toBeAttached();
  await destination.evaluate(() => history.replaceState({}, '', '/new?resume=cedar'));
  await shadowAction(destination, '▤'); await shadowAction(destination, 'Insert');
  await expect(destination.locator('#mobile-composer-prompt')).toHaveValue(/Working context:.*Cedar/s);
  const original = await destination.locator('#mobile-composer-prompt').inputValue();
  await shadowAction(destination, '▤'); await shadowAction(destination, 'Insert');
  await expect(destination.locator('#mobile-composer-prompt')).toHaveValue(original);
  await expect(destination.locator('[data-message-role]')).toHaveCount(0);
  await source.close(); await destination.close();
});

test('records cold workspace timing and renderer heap with 100 metadata rows', async () => {
  await page.goto(`chrome-extension://${extensionId}/workspace.html`); await expect(page.locator('#save')).toBeEnabled();
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('synapse-context'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      const transaction = database.transaction('snapshots', 'readwrite');
      const sample = await new Promise<Record<string, unknown>>(resolve => { const request = transaction.objectStore('snapshots').getAll(); request.onsuccess = () => resolve(request.result[0]); });
      for (let index = 0; index < 100; index++) transaction.objectStore('snapshots').put({ ...sample, id: `performance-${index}`, title: `Performance fixture ${index}`, updatedAt: index }, `performance-${index}`);
      await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
    } finally { database.close(); }
  });
  const timings: number[] = [];
  for (let iteration = 0; iteration < 5; iteration++) { const start = performance.now(); await page.reload(); await expect(page.locator('#save')).toBeEnabled(); timings.push(performance.now() - start); }
  timings.sort((a, b) => a - b);
  const cdp = await context.newCDPSession(page); await cdp.send('Performance.enable'); const { metrics } = await cdp.send('Performance.getMetrics'); await cdp.detach();
  const report = { browser: await context.browser()?.version(), executable: process.env.SYNAPSE_TEST_BROWSER ? 'Brave' : 'Playwright Chromium', platform: process.platform, cpu: cpus()[0]?.model, samples: timings, medianMs: timings[2], maximumMs: timings[4], rendererHeapBytes: metrics.find(metric => metric.name === 'JSHeapUsedSize')?.value, note: 'Five reloads, 100 synthetic metadata rows. Renderer JS heap is not total browser/worker memory.' };
  await writeFile(`artifacts/performance-${process.env.SYNAPSE_TEST_BROWSER ? 'brave' : 'chromium'}.json`, JSON.stringify(report, null, 2));
});

test('production build denies capture without host access or activeTab and rejects page-origin requests', async () => {
  const production = await launch(path.join(root, 'least-privilege'), path.resolve('.output/chrome-mv3'));
  try {
    await production.browser.route('https://chatgpt.com/**', route => route.fulfill({ contentType: 'text/html', body: CHATGPT_HTML }));
    const target = await production.browser.newPage(); await target.goto('https://chatgpt.com/c/test');
    const ui = await production.browser.newPage(); await ui.goto(`chrome-extension://${production.id}/workspace.html`); await expect(ui.locator('#save')).toBeEnabled();
    const result = await ui.evaluate(async () => {
      const tabs = await chrome.tabs.query({}); const tab = tabs.find(tab => tab.url?.startsWith('https://chatgpt.com/'));
      // Without host/tabs permission even the target URL may be withheld. The unprivileged ID still cannot be injected.
      const id = tab?.id ?? tabs.find(tab => !tab.url)?.id;
      return chrome.runtime.sendMessage({ type: 'capture', tabId: id });
    });
    expect(result.ok).toBe(false);
  } finally { await production.browser.close(); }
});
