import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { LIMITS, errorMessage } from '../core/model';

self.onmessage = async (event: MessageEvent<{ file: File }>) => {
  try {
    const { file } = event.data;
    if (file.size > LIMITS.fileBytes) throw new Error('File exceeds the 64 MiB limit.');
    const port = new Worker(workerUrl, { type: 'module' });
    // An explicit port avoids PDF.js's window-dependent automatic/fake-worker setup.
    const worker = pdfjs.PDFWorker.create({ port });
    const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), worker, useWorkerFetch: false, useWasm: false, disableFontFace: true, verbosity: 0 });
    const passwordFailure = new Promise<never>((_resolve, reject) => { task.onPassword = () => reject(new Error('This PDF is encrypted. Supply an unlocked copy to extract text.')); });
    try {
      const document = await Promise.race([task.promise, passwordFailure]);
      let text = '', processed = 0;
      const pages = Math.min(document.numPages, 300);
      for (let pageIndex = 1; pageIndex <= pages; pageIndex++) {
        const page = await document.getPage(pageIndex);
        const content = await page.getTextContent();
        text += `\n[Page ${pageIndex}]\n${content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('')}\n`;
        page.cleanup(); processed++;
        if (text.length >= LIMITS.extractedChars) break;
      }
      const hasText = text.replace(/\[Page \d+\]/g, '').trim().length > 0;
      self.postMessage({ ok: true, result: {
        text: text.slice(0, LIMITS.extractedChars).trim(),
        note: !hasText ? 'No extractable text found. This may be a scanned PDF; OCR is unavailable. Original preserved.' : `PDF text extracted locally with page references. Visuals and layout were not extracted.${processed < document.numPages || text.length > LIMITS.extractedChars ? ' Extraction was truncated.' : ''}`,
      } });
    } finally { await task.destroy(); worker.destroy(); port.terminate(); }
  } catch (error) { self.postMessage({ ok: false, error: `Original preserved. ${errorMessage(error)}` }); }
};
