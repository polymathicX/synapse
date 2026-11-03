import * as v from 'valibot';

export const LIMITS = {
  fileBytes: 64 * 1024 * 1024,
  archiveBytes: 256 * 1024 * 1024,
  contextBytes: 8 * 1024 * 1024,
  messageChars: 200_000,
  messages: 2_000,
  attachments: 200,
  archiveEntries: 1_000,
  extractedChars: 1_000_000,
} as const;

const text = (max: number) => v.pipe(v.string(), v.maxLength(max));
export const IdSchema = v.pipe(v.string(), v.regex(/^[a-zA-Z0-9_-]{1,100}$/));
export const ProviderIdSchema = v.picklist(['chatgpt', 'claude', 'deepseek', 'kimi', 'qwen', 'manual']);
export type ProviderId = v.InferOutput<typeof ProviderIdSchema>;
export const MessageSchema = v.object({
  id: IdSchema,
  role: v.picklist(['user', 'assistant']),
  text: text(LIMITS.messageChars),
  selected: v.boolean(),
});
export type ContextMessage = v.InferOutput<typeof MessageSchema>;
export const AttachmentSchema = v.object({
  id: IdSchema,
  name: v.pipe(text(255), v.minLength(1)),
  mediaType: text(255),
  size: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(LIMITS.fileBytes)),
  availability: v.picklist(['stored', 'missing']),
  sha256: v.optional(v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/))),
  extractedText: v.optional(text(LIMITS.extractedChars)),
  extractionNote: v.optional(text(2000)),
});
export type Attachment = v.InferOutput<typeof AttachmentSchema>;
export const SnapshotSchema = v.object({
  schemaVersion: v.literal(1),
  id: IdSchema,
  revision: v.pipe(v.number(), v.integer(), v.minValue(0)),
  title: v.pipe(text(200), v.minLength(1)),
  createdAt: v.pipe(v.number(), v.integer(), v.minValue(0)),
  updatedAt: v.pipe(v.number(), v.integer(), v.minValue(0)),
  source: v.object({ provider: ProviderIdSchema, url: text(2048), title: text(500) }),
  summary: text(50_000),
  summaryKind: v.picklist(['extractive', 'user']),
  messages: v.pipe(v.array(MessageSchema), v.maxLength(LIMITS.messages)),
  decisions: v.pipe(v.array(text(5000)), v.maxLength(200)),
  constraints: v.pipe(v.array(text(5000)), v.maxLength(200)),
  task: v.object({ goal: text(10_000), status: v.picklist(['active', 'paused', 'complete']), nextSteps: text(20_000) }),
  attachments: v.pipe(v.array(AttachmentSchema), v.maxLength(LIMITS.attachments)),
  capture: v.object({ complete: v.boolean(), warnings: v.pipe(v.array(text(2000)), v.maxLength(100)) }),
});
export type ContextSnapshot = v.InferOutput<typeof SnapshotSchema>;
export type SnapshotContent = Omit<ContextSnapshot, 'messages' | 'attachments'>;
export type SnapshotMetadata = Pick<ContextSnapshot, 'schemaVersion' | 'id' | 'revision' | 'title' | 'createdAt' | 'updatedAt' | 'source'> & { messageCount: number; attachmentCount: number };

export function parseSnapshot(input: unknown): ContextSnapshot {
  const snapshot = v.parse(SnapshotSchema, input);
  for (const items of [snapshot.messages, snapshot.attachments]) {
    if (new Set(items.map(item => item.id)).size !== items.length) throw new Error('Duplicate identifiers in context.');
  }
  if (snapshot.updatedAt < snapshot.createdAt) throw new Error('Invalid snapshot timestamps.');
  if (snapshot.source.url && !/^https?:\/\//.test(snapshot.source.url)) throw new Error('Invalid source URL.');
  return snapshot;
}

export function createSnapshot(provider: ProviderId = 'manual'): ContextSnapshot {
  const now = Date.now();
  return {
    schemaVersion: 1, id: crypto.randomUUID(), revision: 0, title: 'Untitled context',
    createdAt: now, updatedAt: now, source: { provider, url: '', title: '' },
    summary: '', summaryKind: 'user', messages: [], decisions: [], constraints: [],
    task: { goal: '', status: 'active', nextSteps: '' }, attachments: [],
    capture: { complete: provider === 'manual', warnings: [] },
  };
}

export function metadataOf(snapshot: ContextSnapshot): SnapshotMetadata {
  const { schemaVersion, id, revision, title, createdAt, updatedAt, source } = snapshot;
  return { schemaVersion, id, revision, title, createdAt, updatedAt, source, messageCount: snapshot.messages.length, attachmentCount: snapshot.attachments.length };
}

export function safeFilename(name: string): string {
  // Control characters are deliberately removed from untrusted download names.
  // eslint-disable-next-line no-control-regex
  return name.replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_').replace(/^\.+|[. ]+$/g, '').slice(0, 180) || 'attachment';
}

export function errorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'QuotaExceededError') return 'Storage is full. Export or remove snapshots, or enable larger local storage. Your previous saves are unchanged.';
  return error instanceof Error ? error.message : 'The operation could not be completed.';
}
