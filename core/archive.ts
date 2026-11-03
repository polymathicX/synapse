import { Inflate, Zip, ZipPassThrough, strFromU8, strToU8 } from 'fflate';
import { LIMITS, parseSnapshot } from './model';
import type { ContextSnapshot } from './model';

export async function sha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function exportJson(snapshot: ContextSnapshot): string { return JSON.stringify({ format: 'synapse-context', version: 1, snapshot }, null, 2); }

export function importJson(text: string): ContextSnapshot {
  if (strToU8(text).byteLength > LIMITS.contextBytes) throw new Error('Context JSON exceeds 8 MiB.');
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || !('format' in parsed) || parsed.format !== 'synapse-context' || !('version' in parsed) || parsed.version !== 1 || !('snapshot' in parsed)) throw new Error('Unsupported Synapse context format or version.');
  return parseSnapshot(parsed.snapshot);
}

export async function exportArchive(input: ContextSnapshot, files: ReadonlyMap<string, Blob>): Promise<Blob> {
  const snapshot = parseSnapshot(input);
  let size = 0;
  for (const file of snapshot.attachments) {
    if (file.availability !== 'stored') continue;
    const blob = files.get(file.id);
    if (!blob || blob.size !== file.size) throw new Error(`Original file missing: ${file.name}`);
    size += blob.size;
    if (size > LIMITS.archiveBytes - LIMITS.contextBytes) throw new Error('The bundle exceeds the 256 MiB archive limit. Export fewer files.');
    file.sha256 = await sha256(blob);
  }
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let failure: Error | undefined;
  const archive = new Zip((error, chunk) => { if (error) failure = error; else parts.push(chunk); });
  // STORE avoids wasting CPU recompressing PDFs, images and OOXML, and avoids dynamic workers.
  const add = async (name: string, blob: Blob) => {
    const entry = new ZipPassThrough(name); entry.mtime = new Date(2000, 0, 1, 0, 0, 0); archive.add(entry);
    const reader = blob.stream().getReader();
    while (true) { const result = await reader.read(); if (result.done) break; entry.push(result.value); }
    entry.push(new Uint8Array(), true);
  };
  await add('context.json', new Blob([exportJson(snapshot)], { type: 'application/json' }));
  for (const file of snapshot.attachments) if (file.availability === 'stored') await add(`files/${file.id}`, files.get(file.id)!);
  archive.end();
  if (failure) throw failure;
  const blob = new Blob(parts, { type: 'application/zip' });
  if (blob.size > LIMITS.archiveBytes) throw new Error('The bundle exceeds the 256 MiB archive limit.');
  return blob;
}

export async function unzipBounded(blob: Blob, options: { maxBytes?: number; maxEntries?: number; allowPath?: (path: string) => boolean; selectPath?: (path: string) => boolean; maxFileBytes?: number } = {}): Promise<Map<string, Uint8Array<ArrayBuffer>>> {
  const maxBytes = options.maxBytes ?? LIMITS.archiveBytes;
  const maxEntries = options.maxEntries ?? LIMITS.archiveEntries;
  const maxFileBytes = options.maxFileBytes ?? LIMITS.fileBytes;
  if (blob.size > LIMITS.archiveBytes) throw new Error('Archive exceeds 256 MiB.');
  // Use the central directory's offsets rather than scanning for PK signatures:
  // original DOCX/PPTX/ZIP bytes can themselves contain complete ZIP headers.
  const tailStart = Math.max(0, blob.size - 65_557);
  const tail = new DataView(await blob.slice(tailStart).arrayBuffer());
  let end = tail.byteLength - 22;
  while (end >= 0 && (tail.getUint32(end, true) !== 0x06054b50 || end + 22 + tail.getUint16(end + 20, true) !== tail.byteLength)) end--;
  if (end < 0) throw new Error('Archive is incomplete or corrupt.');
  const count = tail.getUint16(end + 10, true);
  const directorySize = tail.getUint32(end + 12, true), directoryOffset = tail.getUint32(end + 16, true);
  if (count > maxEntries || count === 65_535) throw new Error('Archive contains too many entries.');
  if (tail.getUint32(end + 4, true) !== 0 || tail.getUint16(end + 8, true) !== count || directoryOffset + directorySize !== tailStart + end || directorySize > 2 * 1024 * 1024) throw new Error('Unsupported or corrupt ZIP directory.');
  const directory = new DataView(await blob.slice(directoryOffset, directoryOffset + directorySize).arrayBuffer());
  const entries = new Map<string, Uint8Array<ArrayBuffer>>();
  const names = new Set<string>();
  const ranges: [number, number][] = [];
  let offset = 0, total = 0;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > directory.byteLength || directory.getUint32(offset, true) !== 0x02014b50) throw new Error('Corrupt ZIP directory entry.');
    const flags = directory.getUint16(offset + 8, true), compression = directory.getUint16(offset + 10, true);
    const expectedCrc = directory.getUint32(offset + 16, true), compressedSize = directory.getUint32(offset + 20, true), size = directory.getUint32(offset + 24, true);
    const nameLength = directory.getUint16(offset + 28, true), extraLength = directory.getUint16(offset + 30, true), commentLength = directory.getUint16(offset + 32, true);
    const localOffset = directory.getUint32(offset + 42, true);
    const recordEnd = offset + 46 + nameLength + extraLength + commentLength;
    if (recordEnd > directory.byteLength || !nameLength || nameLength > 512) throw new Error('Invalid ZIP filename or entry.');
    const name = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(directory.buffer, offset + 46, nameLength));
    if (name.includes('\\') || name.includes('\0') || name.startsWith('/') || name.split('/').some(part => part === '..' || part === '.') || names.has(name)) throw new Error('Archive contains duplicate or unsafe paths.');
    names.add(name);
    if (options.allowPath && !options.allowPath(name)) throw new Error(`Unexpected archive entry: ${name.slice(0, 100)}`);
    if ((flags & 1) || directory.getUint16(offset + 34, true) !== 0 || (compression !== 0 && compression !== 8)) throw new Error('Encrypted, split, or unsupported ZIP entries cannot be imported.');
    if (options.selectPath && !options.selectPath(name)) { offset = recordEnd; continue; }
    total += size;
    if (size > maxFileBytes || total > maxBytes) throw new Error('Archive decompressed output exceeds the size limit.');
    if (localOffset + 30 > directoryOffset) throw new Error('Invalid ZIP entry offset.');
    const local = new DataView(await blob.slice(localOffset, localOffset + 30).arrayBuffer());
    if (local.getUint32(0, true) !== 0x04034b50 || local.getUint16(8, true) !== compression || (local.getUint16(6, true) & 1)) throw new Error('Corrupt ZIP local header.');
    const localNameLength = local.getUint16(26, true), localExtraLength = local.getUint16(28, true);
    const start = localOffset + 30 + localNameLength + localExtraLength, finish = start + compressedSize;
    if (finish > directoryOffset || ranges.some(([a, b]) => localOffset < b && finish > a)) throw new Error('Overlapping or invalid ZIP entries.');
    const localName = await blob.slice(localOffset + 30, localOffset + 30 + localNameLength).text();
    if (localName !== name) throw new Error('ZIP filename headers do not match.');
    ranges.push([localOffset, finish]);
    const output = new Uint8Array(size); let written = 0, crc = -1;
    const accept = (chunk: Uint8Array) => {
      if (written + chunk.length > size) throw new Error('Archive decompressed output exceeds the size limit.');
      output.set(chunk, written); written += chunk.length;
      for (const byte of chunk) crc = CRC_TABLE[(crc ^ byte) & 255]! ^ (crc >>> 8);
    };
    const inflate = compression === 8 ? new Inflate(accept) : undefined;
    const reader = blob.slice(start, finish).stream().getReader();
    try {
      while (true) { const result = await reader.read(); if (result.done) break; if (inflate) inflate.push(result.value, false); else accept(result.value); }
      inflate?.push(new Uint8Array(), true);
    } finally { await reader.cancel(); reader.releaseLock(); }
    if (written !== size || ((crc ^ -1) >>> 0) !== expectedCrc) throw new Error('Archive entry failed its CRC integrity check.');
    entries.set(name, output); offset = recordEnd;
  }
  if (offset !== directory.byteLength) throw new Error('Unexpected ZIP directory content.');
  return entries;
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index; for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

export async function importArchive(blob: Blob): Promise<{ snapshot: ContextSnapshot; files: Map<string, Blob> }> {
  const entries = await unzipBounded(blob, { allowPath: path => path === 'context.json' || /^files\/[a-zA-Z0-9_-]{1,100}$/.test(path) });
  const context = entries.get('context.json');
  if (!context) throw new Error('The bundle has no context.json.');
  const snapshot = importJson(strFromU8(context));
  const files = new Map<string, Blob>();
  const expected = new Set(['context.json']);
  for (const file of snapshot.attachments) {
    if (file.availability !== 'stored') continue;
    const path = `files/${file.id}`; expected.add(path);
    const bytes = entries.get(path);
    if (!bytes || bytes.byteLength !== file.size || !file.sha256) throw new Error(`Missing or invalid original: ${file.name}`);
    const original = new Blob([bytes], { type: file.mediaType });
    if (await sha256(original) !== file.sha256) throw new Error(`Original failed its integrity check: ${file.name}`);
    files.set(file.id, original);
  }
  if ([...entries.keys()].some(path => !expected.has(path))) throw new Error('The archive contains unreferenced files.');
  return { snapshot, files };
}
