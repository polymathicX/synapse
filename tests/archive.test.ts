import { describe, expect, it } from 'vitest';
import { strToU8, zipSync, Zip, ZipPassThrough } from 'fflate';
import { exportArchive, exportJson, importArchive, importJson, unzipBounded } from '../core/archive';
import { exampleSnapshot } from './fixtures';
import { officeFile } from './fixtures';

describe('portable archive boundary', () => {
  it('round-trips structured context and original bytes with SHA-256 checks', async () => {
    const snapshot = exampleSnapshot(); const blob = new Blob(['binary\0original']);
    snapshot.attachments.push({ id: 'original', name: 'file.docx', mediaType: 'application/octet-stream', size: blob.size, availability: 'stored' });
    const bundle = await exportArchive(snapshot, new Map([['original', blob]]));
    const imported = await importArchive(bundle);
    expect(imported.snapshot.messages).toEqual(snapshot.messages); expect(imported.snapshot.attachments[0]?.sha256).toHaveLength(64);
    expect(await imported.files.get('original')?.text()).toBe('binary\0original');
  });
  it('rejects unsupported versions and missing originals', async () => {
    expect(() => importJson('{"format":"synapse-context","version":2}')).toThrow('Unsupported');
    const snapshot = exampleSnapshot(); snapshot.attachments.push({ id: 'absent', name: 'a', size: 1, mediaType: '', availability: 'stored' });
    await expect(importArchive(new Blob([zipSync({ 'context.json': strToU8(exportJson(snapshot)) })]))).rejects.toThrow('Missing');
  });
  it('rejects path traversal, unknown paths, excess output and incomplete archives', async () => {
    await expect(importArchive(new Blob([zipSync({ '../context.json': strToU8('{}') })]))).rejects.toThrow('unsafe');
    await expect(importArchive(new Blob([zipSync({ 'unknown.txt': strToU8('x') })]))).rejects.toThrow('Unexpected');
    await expect(unzipBounded(new Blob([zipSync({ 'file': strToU8('x'.repeat(500)) })]), { maxBytes: 100 })).rejects.toThrow('size limit');
    const zip = zipSync({ 'context.json': strToU8(exportJson(exampleSnapshot())) });
    await expect(importArchive(new Blob([zip.slice(0, 40)]))).rejects.toThrow();
  });
  it('rejects mismatching file digests and unreferenced originals', async () => {
    const snapshot = exampleSnapshot(); snapshot.attachments.push({ id: 'file', name: 'a', mediaType: '', size: 1, availability: 'stored', sha256: '0'.repeat(64) });
    await expect(importArchive(new Blob([zipSync({ 'context.json': strToU8(exportJson(snapshot)), 'files/file': strToU8('x') })]))).rejects.toThrow('integrity');
    await expect(importArchive(new Blob([zipSync({ 'context.json': strToU8(exportJson(exampleSnapshot())), 'files/extra': strToU8('x') })]))).rejects.toThrow('unreferenced');
  });
  it('exports deterministic archives for unchanged content', async () => {
    const snapshot = exampleSnapshot();
    expect(await (await exportArchive(snapshot, new Map())).arrayBuffer()).toEqual(await (await exportArchive(snapshot, new Map())).arrayBuffer());
  });
  it('preserves nested ZIP originals without mistaking their headers for bundle entries', async () => {
    const snapshot = exampleSnapshot(); const blob = new Blob([officeFile('docx')]);
    snapshot.attachments.push({ id: 'office', name: 'document.docx', mediaType: 'application/zip', size: blob.size, availability: 'stored' });
    const result = await importArchive(await exportArchive(snapshot, new Map([['office', blob]])));
    expect(await result.files.get('office')!.arrayBuffer()).toEqual(await blob.arrayBuffer());
  });
  it('rejects CRC corruption even when JSON remains syntactically valid', async () => {
    const archive = zipSync({ 'context.json': strToU8(exportJson(exampleSnapshot())) }, { level: 0 });
    const needle = strToU8('Design'); let position = -1;
    for (let offset = 0; offset < archive.length - needle.length; offset++) if (needle.every((byte, index) => archive[offset + index] === byte)) { position = offset; break; }
    expect(position).toBeGreaterThan(0); archive[position] = 88;
    await expect(importArchive(new Blob([archive]))).rejects.toThrow('CRC');
  });
  it('rejects duplicate paths and excessive entry counts before import', async () => {
    const parts: Uint8Array<ArrayBuffer>[] = [];
    const archive = new Zip((error, bytes) => { if (error) throw error; parts.push(bytes); });
    for (let index = 0; index < 2; index++) { const entry = new ZipPassThrough('context.json'); archive.add(entry); entry.push(strToU8(exportJson(exampleSnapshot())), true); }
    archive.end(); await expect(importArchive(new Blob(parts))).rejects.toThrow('duplicate');
    await expect(unzipBounded(new Blob([zipSync({ a: strToU8('a'), b: strToU8('b') })]), { maxEntries: 1 })).rejects.toThrow('too many');
  });
});
