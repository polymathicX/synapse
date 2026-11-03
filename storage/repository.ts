import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';
import { LIMITS, metadataOf, parseSnapshot } from '../core/model';
import type { Attachment, ContextMessage, ContextSnapshot, SnapshotContent, SnapshotMetadata } from '../core/model';

interface SynapseDB extends DBSchema {
  snapshots: { key: string; value: SnapshotMetadata; indexes: { updatedAt: number } };
  contexts: { key: string; value: SnapshotContent };
  transcripts: { key: string; value: ContextMessage[] };
  attachments: { key: [string, string]; value: { snapshotId: string; file: Attachment }; indexes: { snapshotId: string } };
  blobs: { key: [string, string]; value: Blob };
}
export class RevisionConflictError extends Error { constructor() { super('This snapshot changed in another window. Reopen it before saving your changes.'); } }

export class SnapshotRepository {
  private connection: Promise<IDBPDatabase<SynapseDB>> | undefined;
  constructor(private readonly name = 'synapse-context') {}

  private db(): Promise<IDBPDatabase<SynapseDB>> {
    this.connection ??= new Promise<IDBPDatabase<SynapseDB>>((resolve, reject) => {
      let blocked = false;
      const opening = openDB<SynapseDB>(this.name, 2, {
        async upgrade(database, oldVersion, _newVersion, transaction) {
          if (oldVersion < 1) {
            database.createObjectStore('snapshots').createIndex('updatedAt', 'updatedAt');
            database.createObjectStore('transcripts');
            database.createObjectStore('attachments').createIndex('snapshotId', 'snapshotId');
            database.createObjectStore('blobs');
          }
          if (oldVersion < 2) {
            database.createObjectStore('contexts');
            // V1 embedded structured context in list rows. Split it without touching originals.
            let cursor = await transaction.objectStore('snapshots').openCursor();
            while (cursor) {
              const previous = cursor.value as SnapshotMetadata & SnapshotContent;
              await transaction.objectStore('contexts').put(previous, previous.id);
              await cursor.update({ schemaVersion: previous.schemaVersion, id: previous.id, revision: previous.revision, title: previous.title, createdAt: previous.createdAt, updatedAt: previous.updatedAt, source: previous.source, messageCount: previous.messageCount, attachmentCount: previous.attachmentCount });
              cursor = await cursor.continue();
            }
          }
        },
        blocked() { blocked = true; reject(new Error('A database upgrade is blocked. Close other Synapse tabs and reopen the workspace.')); },
        blocking: () => { void opening.then(database => database.close()); this.connection = undefined; },
        terminated: () => { this.connection = undefined; },
      });
      void opening.then(database => { if (blocked) database.close(); else resolve(database); }, reject);
    }).catch(error => { this.connection = undefined; throw error; });
    return this.connection;
  }

  async list(offset = 0, limit = 50): Promise<SnapshotMetadata[]> {
    const database = await this.db();
    const transaction = database.transaction('snapshots');
    let cursor = await transaction.store.index('updatedAt').openCursor(null, 'prev');
    if (cursor && offset > 0) cursor = await cursor.advance(offset);
    const results: SnapshotMetadata[] = [];
    while (cursor && results.length < Math.min(limit, 100)) { results.push(cursor.value); cursor = await cursor.continue(); }
    await transaction.done;
    return results;
  }

  async get(id: string): Promise<ContextSnapshot | undefined> {
    const database = await this.db();
    const transaction = database.transaction(['snapshots', 'contexts', 'transcripts', 'attachments']);
    const [metadata, content, messages, attachments] = await Promise.all([
      transaction.objectStore('snapshots').get(id), transaction.objectStore('contexts').get(id),
      transaction.objectStore('transcripts').get(id),
      transaction.objectStore('attachments').index('snapshotId').getAll(id),
    ]);
    await transaction.done;
    if (!metadata) return undefined;
    return parseSnapshot({ ...content, messages: messages ?? [], attachments: attachments.map(record => record.file) });
  }

  async save(input: ContextSnapshot, files: ReadonlyMap<string, Blob> = new Map()): Promise<ContextSnapshot> {
    const snapshot = parseSnapshot(input);
    if (new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > LIMITS.contextBytes) throw new Error('Context exceeds the 8 MiB limit. Reduce selected content or extracted text.');
    for (const [id, blob] of files) {
      const metadata = snapshot.attachments.find(file => file.id === id);
      if (!metadata || metadata.availability !== 'stored' || metadata.size !== blob.size || blob.size > LIMITS.fileBytes) throw new Error('Attachment bytes do not match their metadata.');
    }
    const database = await this.db();
    const transaction = database.transaction(['snapshots', 'contexts', 'transcripts', 'attachments', 'blobs'], 'readwrite', { durability: 'strict' });
    try {
      const current = await transaction.objectStore('snapshots').get(snapshot.id);
      if ((current?.revision ?? 0) !== snapshot.revision || (!current && snapshot.revision !== 0)) throw new RevisionConflictError();
      snapshot.revision += 1;
      snapshot.updatedAt = Math.max(Date.now(), snapshot.createdAt);
      const previous = await transaction.objectStore('attachments').index('snapshotId').getAllKeys(snapshot.id);
      for (const key of previous) {
        if (!snapshot.attachments.some(file => file.id === key[1])) {
          await transaction.objectStore('attachments').delete(key);
          await transaction.objectStore('blobs').delete(key);
        }
      }
      for (const file of snapshot.attachments) {
        const key: [string, string] = [snapshot.id, file.id];
        const blob = files.get(file.id);
        if (blob) await transaction.objectStore('blobs').put(blob, key);
        if (file.availability === 'stored' && !blob) {
          const existing = await transaction.objectStore('blobs').get(key);
          if (!existing || existing.size !== file.size) throw new Error(`Original bytes are missing for ${file.name}. Add the original before saving.`);
        }
        if (file.availability === 'missing') await transaction.objectStore('blobs').delete(key);
        await transaction.objectStore('attachments').put({ snapshotId: snapshot.id, file }, key);
      }
      await transaction.objectStore('snapshots').put(metadataOf(snapshot), snapshot.id);
      const { messages: _messages, attachments: _attachments, ...content } = snapshot;
      await transaction.objectStore('contexts').put(content, snapshot.id);
      await transaction.objectStore('transcripts').put(snapshot.messages, snapshot.id);
      await transaction.done;
      return snapshot;
    } catch (error) {
      try { transaction.abort(); } catch { /* The browser may already have aborted it. */ }
      await transaction.done.catch(() => undefined);
      throw error;
    }
  }

  async import(snapshot: ContextSnapshot, files: ReadonlyMap<string, Blob>): Promise<ContextSnapshot> {
    return this.save({ ...snapshot, id: crypto.randomUUID(), revision: 0 }, files);
  }

  async file(snapshotId: string, fileId: string): Promise<Blob | undefined> {
    return (await this.db()).get('blobs', [snapshotId, fileId]);
  }

  async delete(id: string, expectedRevision: number): Promise<void> {
    const database = await this.db();
    const transaction = database.transaction(['snapshots', 'contexts', 'transcripts', 'attachments', 'blobs'], 'readwrite');
    try {
      const current = await transaction.objectStore('snapshots').get(id);
      if (!current || current.revision !== expectedRevision) throw new RevisionConflictError();
      const keys = await transaction.objectStore('attachments').index('snapshotId').getAllKeys(id);
      for (const key of keys) { await transaction.objectStore('attachments').delete(key); await transaction.objectStore('blobs').delete(key); }
      await transaction.objectStore('transcripts').delete(id);
      await transaction.objectStore('contexts').delete(id);
      await transaction.objectStore('snapshots').delete(id);
      await transaction.done;
    } catch (error) {
      try { transaction.abort(); } catch { /* Already finished. */ }
      await transaction.done.catch(() => undefined);
      throw error;
    }
  }

  async close(): Promise<void> { (await this.connection)?.close(); this.connection = undefined; }
}

export const repository = new SnapshotRepository();
