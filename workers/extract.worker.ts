import { extractOffice, extractText, isTextFile } from '../core/extraction';
import { LIMITS, errorMessage } from '../core/model';
import type { ExtractionResult } from '../core/extraction';

self.onmessage = async (event: MessageEvent<{ file: File }>) => {
  try {
    const { file } = event.data;
    if (file.size > LIMITS.fileBytes) throw new Error('File exceeds the 64 MiB limit.');
    let result: ExtractionResult;
    if (isTextFile(file.name, file.type)) result = await extractText(file);
    else if (/\.docx$/i.test(file.name)) result = await extractOffice(file, 'docx');
    else if (/\.pptx$/i.test(file.name)) result = await extractOffice(file, 'pptx');
    else result = { text: '', note: 'Original preserved. Text extraction is unavailable for this file type. Images are preserved without OCR or cloud vision.' };
    self.postMessage({ ok: true, result });
  } catch (error) { self.postMessage({ ok: false, error: `Original preserved. ${errorMessage(error)}` }); }
};
