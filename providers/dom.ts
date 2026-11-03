import { createSnapshot, LIMITS, safeFilename } from '../core/model';
import type { ContextSnapshot, ProviderId } from '../core/model';
import { extractiveSummary } from '../core/handoff';

export interface AdapterResult<T> { status: 'success' | 'partial' | 'unavailable'; value?: T; reason: string }
export interface ProviderAdapter {
  id: ProviderId;
  probe(document: Document): { capture: boolean; insert: boolean };
  capture(document: Document): AdapterResult<ContextSnapshot>;
  insertDraft(document: Document, text: string): AdapterResult<null>;
}
export interface DomConfig { id: ProviderId; user: string; assistant: string; composer: string; content?: string }

function visible(element: Element): boolean {
  if (element.closest('[hidden], [aria-hidden="true"]')) return false;
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  return style?.display !== 'none' && style?.visibility !== 'hidden';
}

export function toMarkdown(root: Node): string {
  if (root.nodeType === 3) return root.textContent ?? '';
  if (root.nodeType !== 1) return [...root.childNodes].map(toMarkdown).join('');
  const element = root as Element;
  if (element.matches('script,style,button,svg,[hidden],[aria-hidden="true"],.katex-html')) return '';
  if (element.tagName === 'PRE') {
    const code = element.querySelector('code');
    const body = code?.textContent ?? element.textContent ?? '';
    const longest = Math.max(2, ...[...body.matchAll(/`+/g)].map(match => match[0].length));
    const fence = '`'.repeat(longest + 1);
    const language = /language-([\w+-]+)/.exec(code?.className ?? '')?.[1] ?? '';
    return `\n\n${fence}${language}\n${body}\n${fence}\n\n`;
  }
  if (element.matches('annotation[encoding="application/x-tex"]')) return `$${element.textContent ?? ''}$`;
  if (element.matches('.katex-mathml')) return element.querySelector('annotation') ? toMarkdown(element.querySelector('annotation')!) : '';
  const children = [...element.childNodes].map(toMarkdown).join('');
  if (element.tagName === 'BR') return '\n';
  if (element.tagName === 'IMG') return `[Image: ${element.getAttribute('alt') || 'original unavailable'}]`;
  if (element.tagName === 'CODE') return `\`${children}\``;
  if (element.matches('strong,b')) return `**${children}**`;
  if (element.matches('em,i')) return `*${children}*`;
  if (element.tagName === 'LI') return `\n- ${children}`;
  if (element.tagName === 'TR') return `\n${[...element.children].map(cell => toMarkdown(cell).trim()).join(' | ')}`;
  if (element.matches('p,div,section,article,ul,ol,table,blockquote,h1,h2,h3,h4,h5,h6')) return `\n${children}\n`;
  return children;
}

function composerCandidates(document: Document, selector: string): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(selector)].filter(element => visible(element) && !element.matches(':disabled,[aria-disabled="true"],[readonly]'));
}

export function createDomAdapter(config: DomConfig): ProviderAdapter {
  return {
    id: config.id,
    probe(document) {
      return { capture: document.querySelector(`${config.user},${config.assistant}`) !== null, insert: composerCandidates(document, config.composer).length === 1 };
    },
    capture(document) {
      const roots = [...document.querySelectorAll(`${config.user},${config.assistant}`)]
        .filter(element => visible(element))
        .filter((element, _, all) => !all.some(other => other !== element && other.contains(element)));
      if (!roots.length) return { status: 'unavailable', reason: 'No recognizable conversation found. Open a conversation, or paste your context into the workspace.' };
      const snapshot = createSnapshot(config.id);
      snapshot.source = { provider: config.id, url: document.location.href.split('#')[0]!.slice(0, 2048), title: document.title.slice(0, 500) };
      snapshot.title = document.title.replace(/\s*[-|]\s*(ChatGPT|Claude|DeepSeek|Kimi|Qwen).*$/i, '').trim().slice(0, 200) || 'Captured context';
      snapshot.capture = { complete: false, warnings: ['Only loaded messages were captured. Earlier, collapsed, or virtualized history may be absent. Review before resuming.'] };
      if (document.querySelector('[data-is-streaming="true"],.result-streaming,[data-testid="stop-button"],button[aria-label="Stop generating"]')) {
        return { status: 'unavailable', reason: 'A response is still generating. Wait for it to finish, then capture again.' };
      }
      let bytes = 0;
      for (const element of roots.slice(-LIMITS.messages)) {
        const content = config.content ? element.querySelector(config.content) ?? element : element;
        const text = toMarkdown(content).trim();
        if (!text) continue;
        const bounded = text.slice(0, LIMITS.messageChars);
        bytes += new TextEncoder().encode(bounded).byteLength;
        if (bytes > LIMITS.contextBytes / 2) { snapshot.capture.warnings.push('Capture reached its size limit; remaining messages were excluded.'); break; }
        if (bounded.length !== text.length) snapshot.capture.warnings.push('A long message was truncated.');
        snapshot.messages.push({ id: crypto.randomUUID(), role: element.matches(config.user) ? 'user' : 'assistant', text: bounded, selected: true });
        for (const ref of element.querySelectorAll('[data-filename],a[download],[data-testid="attachment"],img')) {
          if (snapshot.attachments.length >= LIMITS.attachments) break;
          const name = safeFilename(ref.getAttribute('data-filename') || ref.getAttribute('download') || ref.getAttribute('alt') || ref.textContent?.trim() || 'Referenced file');
          if (!snapshot.attachments.some(file => file.name === name)) snapshot.attachments.push({ id: crypto.randomUUID(), name, mediaType: 'application/octet-stream', size: 0, availability: 'missing', extractionNote: 'The page exposes a reference, not the original bytes. Add the original file locally.' });
        }
      }
      if (!snapshot.messages.length) return { status: 'unavailable', reason: 'The recognized conversation contains no extractable text. Paste context manually.' };
      snapshot.summary = extractiveSummary(snapshot);
      snapshot.summaryKind = 'extractive';
      return { status: 'partial', value: snapshot, reason: snapshot.capture.warnings[0]! };
    },
    insertDraft(document, text) {
      const candidates = composerCandidates(document, config.composer);
      if (candidates.length !== 1) return { status: 'unavailable', reason: 'A unique editable composer was not found. Copy the handoff and paste it yourself.' };
      const element = candidates[0]!;
      const isTextarea = element.tagName === 'TEXTAREA';
      const previous = isTextarea ? (element as HTMLTextAreaElement).value : element.innerText ?? element.textContent ?? '';
      if (previous.trim()) return { status: 'unavailable', reason: 'The destination already has a draft. It was left unchanged. Start an empty chat or copy the handoff.' };
      element.focus();
      if (isTextarea) {
        const setter = Object.getOwnPropertyDescriptor(document.defaultView!.HTMLTextAreaElement.prototype, 'value')?.set;
        if (!setter) return { status: 'unavailable', reason: 'This composer cannot be filled safely. Paste the handoff manually.' };
        setter.call(element, text);
      } else {
        const selection = document.getSelection();
        const range = document.createRange(); range.selectNodeContents(element); selection?.removeAllRanges(); selection?.addRange(range);
        // Native insertText turns blank lines into extra block paragraphs in Chromium.
        // Build escaped text + BR nodes so code and paragraph spacing survive exactly.
        const fragment = document.createElement('div');
        const lines = text.replace(/\r\n/g, '\n').split('\n');
        lines.forEach((line, index) => { if (index) fragment.append(document.createElement('br')); fragment.append(document.createTextNode(line)); });
        if (!document.execCommand?.('insertHTML', false, fragment.innerHTML)) element.textContent = text;
      }
      const InputEventClass = document.defaultView!.InputEvent;
      element.dispatchEvent(new InputEventClass('input', { bubbles: true, inputType: 'insertText', data: text }));
      const inserted = isTextarea ? (element as HTMLTextAreaElement).value : element.innerText ?? element.textContent ?? '';
      if (inserted.replace(/\r\n/g, '\n').trimEnd() !== text.replace(/\r\n/g, '\n').trimEnd()) return { status: 'unavailable', reason: 'The composer did not retain the handoff. Review the draft and paste it manually if needed.' };
      return { status: 'success', value: null, reason: 'Draft inserted. Review it and upload the listed originals before sending.' };
    },
  };
}
