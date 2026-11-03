import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SnapshotRepository, RevisionConflictError } from '../storage/repository';
import { exampleSnapshot } from './fixtures';
import { openDB } from 'idb';

const repositories: SnapshotRepository[] = [];
function repository() { const repository = new SnapshotRepository(`test-${crypto.randomUUID()}`); repositories.push(repository); return repository; }
afterEach(async () => { await Promise.all(repositories.splice(0).map(repository => repository.close())); });

describe('transactional snapshot repository', () => {
  it('persists structured fields and original Blob bytes across connections', async () => {
    const name = `test-${crypto.randomUUID()}`; const first = new SnapshotRepository(name); repositories.push(first);
    const snapshot = exampleSnapshot(); const blob = new Blob(['original bytes']);
    snapshot.attachments.push({ id: 'file', name: 'a.md', mediaType: 'text/markdown', size: blob.size, availability: 'stored' });
    const saved = await first.save(snapshot, new Map([['file', blob]])); await first.close();
    const second = new SnapshotRepository(name); repositories.push(second);
    expect(await second.get(snapshot.id)).toEqual(saved);
    expect(await (await second.file(snapshot.id, 'file'))?.text()).toBe('original bytes');
    const metadata = (await second.list())[0]!; expect(metadata).not.toHaveProperty('messages'); expect(metadata).not.toHaveProperty('attachments'); expect(metadata).not.toHaveProperty('summary'); expect(metadata).not.toHaveProperty('constraints');
  });
  it('rejects stale updates and stale deletes', async () => {
    const repo = repository(); const original = await repo.save(exampleSnapshot());
    const stale = structuredClone(original); original.title = 'New title'; await repo.save(original);
    await expect(repo.save(stale)).rejects.toBeInstanceOf(RevisionConflictError);
    await expect(repo.delete(stale.id, stale.revision)).rejects.toBeInstanceOf(RevisionConflictError);
    expect((await repo.get(original.id))?.title).toBe('New title');
  });
  it('rolls back an entire update when any original is missing', async () => {
    const repo = repository(); const saved = await repo.save(exampleSnapshot());
    const invalid = structuredClone(saved); invalid.title = 'Must not commit';
    invalid.attachments.push({ id: 'absent', name: 'absent.pdf', size: 20, mediaType: 'application/pdf', availability: 'stored' });
    await expect(repo.save(invalid)).rejects.toThrow('Original bytes are missing');
    expect(await repo.get(saved.id)).toEqual(saved);
  });
  it('leaves previous data intact when a quota failure aborts the transaction', async () => {
    const repo = repository(); const saved = await repo.save(exampleSnapshot());
    const { IDBObjectStore } = await import('fake-indexeddb');
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => { throw new DOMException('full', 'QuotaExceededError'); });
    await expect(repo.save({ ...saved, title: 'Failed save' })).rejects.toThrow('full'); put.mockRestore();
    expect(await repo.get(saved.id)).toEqual(saved);
  });
  it('imports as an independent entry and deletes all owned bytes', async () => {
    const repo = repository(); const snapshot = exampleSnapshot(); const blob = new Blob(['x']);
    snapshot.attachments.push({ id: 'a', name: 'a.bin', mediaType: 'application/octet-stream', size: 1, availability: 'stored' });
    const saved = await repo.save(snapshot, new Map([['a', blob]])); const imported = await repo.import(saved, new Map([['a', blob]]));
    expect(imported.id).not.toBe(saved.id); await repo.delete(saved.id, saved.revision);
    expect(await repo.file(saved.id, 'a')).toBeUndefined(); expect(await repo.get(imported.id)).toBeDefined();
  });
  it('migrates V1 records without losing structured fields or original bytes', async () => {
    const name = `migration-${crypto.randomUUID()}`; const snapshot = exampleSnapshot(); snapshot.revision = 1;
    const blob = new Blob(['original']); snapshot.attachments.push({ id: 'file', name: 'a.bin', mediaType: '', size: blob.size, availability: 'stored' });
    const legacy = await openDB(name, 1, { upgrade(database) {
      database.createObjectStore('snapshots').createIndex('updatedAt', 'updatedAt'); database.createObjectStore('transcripts');
      database.createObjectStore('attachments').createIndex('snapshotId', 'snapshotId'); database.createObjectStore('blobs');
    } });
    const { messages, attachments, ...content } = snapshot;
    await legacy.put('snapshots', { ...content, messageCount: messages.length, attachmentCount: attachments.length }, snapshot.id);
    await legacy.put('transcripts', messages, snapshot.id);
    await legacy.put('attachments', { snapshotId: snapshot.id, file: attachments[0] }, [snapshot.id, 'file']);
    await legacy.put('blobs', blob, [snapshot.id, 'file']); legacy.close();
    const repo = new SnapshotRepository(name); repositories.push(repo);
    expect(await repo.get(snapshot.id)).toEqual(snapshot); expect(await (await repo.file(snapshot.id, 'file'))?.text()).toBe('original');
    expect((await repo.list())[0]).not.toHaveProperty('summary');
  });
});
