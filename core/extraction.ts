import { SaxesParser } from 'saxes';
import { unzipBounded } from './archive';
import { LIMITS } from './model';

export interface ExtractionResult { text: string; note: string }
const TEXT_EXTENSIONS = /\.(txt|md|mdx|tex|latex|bib|json|csv|tsv|log|yaml|yml|xml|html|css|js|mjs|cjs|ts|tsx|jsx|py|rs|go|java|c|cpp|h|hpp|sh|sql|toml|ini|r|rb|php)$/i;
export function isTextFile(name: string, type: string): boolean { return type.startsWith('text/') || TEXT_EXTENSIONS.test(name) || type === 'application/json'; }

export async function extractText(blob: Blob): Promise<ExtractionResult> {
  const truncated = blob.size > 4 * 1024 * 1024;
  const bytes = await blob.slice(0, 4 * 1024 * 1024).arrayBuffer();
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: truncated });
  if (text.includes('\0')) throw new Error('This file appears to contain binary content. The original is preserved.');
  return { text: text.slice(0, LIMITS.extractedChars), note: truncated || text.length > LIMITS.extractedChars ? 'Text extraction was truncated; the original is preserved.' : 'UTF-8 text extracted locally. LaTeX and code are preserved as source, without execution.' };
}

export function extractOoxmlXml(xml: string, kind: 'docx' | 'pptx'): string {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Document XML contains unsupported entity declarations.');
  const parser = new SaxesParser({ xmlns: true });
  let result = '', inText = false;
  parser.on('opentag', tag => {
    if (tag.local === 't' && (kind === 'docx' ? tag.uri === 'http://schemas.openxmlformats.org/wordprocessingml/2006/main' : tag.uri === 'http://schemas.openxmlformats.org/drawingml/2006/main')) inText = true;
    if (tag.local === 'tab') result += '\t';
    if (tag.local === 'br') result += '\n';
  });
  parser.on('text', text => { if (inText) { result += text; if (result.length > LIMITS.extractedChars) throw new Error('Document text exceeds the extraction limit.'); } });
  parser.on('closetag', tag => { if (tag.local === 't') inText = false; if (tag.local === 'p') result += '\n'; });
  parser.write(xml).close();
  return result.trim();
}

export async function extractOffice(blob: Blob, kind: 'docx' | 'pptx'): Promise<ExtractionResult> {
  // Ignore relationships, embedded binaries and macros. Only the desired XML is parsed.
  const entries = await unzipBounded(blob, { maxBytes: 32 * 1024 * 1024, maxFileBytes: 16 * 1024 * 1024, selectPath: path => kind === 'docx' ? path === 'word/document.xml' : /^ppt\/slides\/slide\d+\.xml$/.test(path) });
  const paths = [...entries.keys()].filter(path => kind === 'docx' ? path === 'word/document.xml' : /^ppt\/slides\/slide\d+\.xml$/.test(path));
  paths.sort((a, b) => Number(/slide(\d+)/.exec(a)?.[1] ?? 0) - Number(/slide(\d+)/.exec(b)?.[1] ?? 0));
  if (!paths.length) throw new Error('The document contains no supported document or slide XML.');
  let text = '';
  for (const path of paths) {
    const xml = new TextDecoder('utf-8', { fatal: true }).decode(entries.get(path)!);
    const part = extractOoxmlXml(xml, kind);
    text += `${kind === 'pptx' ? `\n[Slide ${/slide(\d+)/.exec(path)?.[1]}]\n` : ''}${part}\n`;
    if (text.length > LIMITS.extractedChars) return { text: text.slice(0, LIMITS.extractedChars), note: 'Extraction truncated. Original preserved; embedded visuals, layout, and notes were not extracted.' };
  }
  return { text: text.trim(), note: 'Text extracted locally. Original preserved; embedded visuals, layout, and notes were not extracted.' };
}
