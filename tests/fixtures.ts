import { strToU8, zipSync } from 'fflate';
import { createSnapshot } from '../core/model';

export function exampleSnapshot() {
  const snapshot = createSnapshot(); snapshot.title = 'Design a context extension';
  snapshot.summary = 'A local-first context manager.'; snapshot.task.goal = 'Preserve working context';
  snapshot.decisions = ['Use native browser APIs']; snapshot.constraints = ['No telemetry'];
  snapshot.task.nextSteps = 'Verify persistence';
  snapshot.messages = [
    { id: 'user-1', role: 'user', text: 'Keep all original files.', selected: true },
    { id: 'assistant-1', role: 'assistant', text: 'Use IndexedDB.\n\n```ts\nconst answer = 42;\n```', selected: true },
  ];
  return snapshot;
}

export const CHATGPT_HTML = `<!doctype html><html><head><title>Project Apollo - ChatGPT</title></head><body><main>
<article data-message-author-role="user"><div class="whitespace-pre-wrap">Build a local-first extension.<span data-filename="spec.pdf">spec.pdf</span></div></article>
<article data-message-author-role="assistant"><div class="markdown"><p>Preserve originals.</p><pre><code class="language-ts">const db = openDB('context');</code></pre></div></article>
<div id="prompt-textarea" contenteditable="true" role="textbox" aria-label="Message"></div><button id="send">Send</button>
</main></body></html>`;
export const CLAUDE_HTML = `<!doctype html><html><head><title>Destination - Claude</title><style>.ProseMirror{white-space:pre-wrap;min-height:40px}</style></head><body><main>
<div data-testid="user-message">Continue the task.</div><div class="font-claude-response"><p>Ready to continue.</p></div>
<div class="ProseMirror" contenteditable="true" role="textbox" aria-label="Message"></div><button id="send">Send</button>
</main></body></html>`;

export function officeFile(kind: 'docx' | 'pptx'): Uint8Array<ArrayBuffer> {
  const namespace = kind === 'docx' ? 'http://schemas.openxmlformats.org/wordprocessingml/2006/main' : 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const prefix = kind === 'docx' ? 'w' : 'a';
  return zipSync({ [kind === 'docx' ? 'word/document.xml' : 'ppt/slides/slide1.xml']: strToU8(`<${prefix}:document xmlns:${prefix}="${namespace}"><${prefix}:p><${prefix}:r><${prefix}:t>Original ${kind} text</${prefix}:t></${prefix}:r></${prefix}:p></${prefix}:document>`) });
}

export function simplePdf(): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Length 51 >>\nstream\nBT /F1 14 Tf 50 750 Td (Original PDF text) Tj ET\nendstream',
  ];
  let document = '%PDF-1.4\n'; const offsets = [0];
  for (let index = 0; index < objects.length; index++) { offsets.push(Buffer.byteLength(document)); document += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`; }
  const start = Buffer.byteLength(document); document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) document += `${String(offset).padStart(10, '0')} 00000 n \n`;
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(document);
}
