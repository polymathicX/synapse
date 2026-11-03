import { exportArchive, importArchive, importJson } from '../core/archive';
import { LIMITS, errorMessage } from '../core/model';
import { repository } from '../storage/repository';

type ArchiveJob = { type: 'export'; snapshotId: string } | { type: 'import'; file: File };
self.onmessage = async (event: MessageEvent<ArchiveJob>) => {
  try {
    const job = event.data;
    if (job.type === 'export') {
      const snapshot = await repository.get(job.snapshotId);
      if (!snapshot) throw new Error('Snapshot no longer exists.');
      const files = new Map<string, Blob>();
      for (const attachment of snapshot.attachments) {
        if (attachment.availability !== 'stored') continue;
        const blob = await repository.file(snapshot.id, attachment.id);
        if (!blob) throw new Error(`Missing original: ${attachment.name}`);
        files.set(attachment.id, blob);
      }
      self.postMessage({ ok: true, blob: await exportArchive(snapshot, files) });
    } else {
      if (job.file.size > LIMITS.archiveBytes) throw new Error('Import exceeds 256 MiB.');
      const isJson = job.file.name.toLowerCase().endsWith('.json');
      let imported;
      if (isJson) {
        if (job.file.size > LIMITS.contextBytes) throw new Error('Context JSON exceeds 8 MiB.');
        const snapshot = importJson(await job.file.text());
        for (const file of snapshot.attachments) {
          file.availability = 'missing';
          file.extractionNote = 'Imported context without original bytes. Import a bundle or add the original file.';
        }
        imported = await repository.import(snapshot, new Map());
      } else {
        const { snapshot, files } = await importArchive(job.file);
        imported = await repository.import(snapshot, files);
      }
      self.postMessage({ ok: true, snapshotId: imported.id });
    }
  } catch (error) { self.postMessage({ ok: false, error: errorMessage(error) }); }
};
