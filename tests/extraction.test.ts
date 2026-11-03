import { describe, expect, it } from 'vitest';
import { extractOffice, extractOoxmlXml, extractText, isTextFile } from '../core/extraction';
import { officeFile } from './fixtures';

describe('local text extraction', () => {
  it.each(['notes.md', 'main.tex', 'references.bib', 'source.ts'])('preserves UTF-8 %s source without execution', async name => {
    expect(isTextFile(name, '')).toBe(true);
    expect((await extractText(new Blob(['Hello বাংলা \\section{Title}']))).text).toBe('Hello বাংলা \\section{Title}');
  });
  it('rejects invalid UTF-8 and binary masquerading as text', async () => {
    await expect(extractText(new Blob([new Uint8Array([255, 254])]))).rejects.toThrow();
    await expect(extractText(new Blob(['a\0b']))).rejects.toThrow('binary');
  });
  it.each(['docx', 'pptx'] as const)('extracts %s text with limitations and references', async kind => {
    const result = await extractOffice(new Blob([officeFile(kind)]), kind);
    expect(result.text).toContain(`Original ${kind} text`); expect(result.note).toContain('embedded visuals');
    if (kind === 'pptx') expect(result.text).toContain('[Slide 1]');
  });
  it('rejects XML entity declarations', () => {
    expect(() => extractOoxmlXml('<!DOCTYPE x [<!ENTITY secret SYSTEM "file:///etc/passwd">]><x/>', 'docx')).toThrow('entity');
  });
});
