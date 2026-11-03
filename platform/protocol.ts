import * as v from 'valibot';
import { IdSchema, LIMITS } from '../core/model';

export const AdapterCommandSchema = v.variant('type', [
  v.object({ type: v.literal('adapter.capture'), expectedUrl: v.optional(v.pipe(v.string(), v.maxLength(4096))) }),
  v.object({ type: v.literal('adapter.insert'), text: v.pipe(v.string(), v.maxLength(LIMITS.contextBytes)), expectedUrl: v.optional(v.pipe(v.string(), v.maxLength(4096))) }),
]);
export const RequestSchema = v.variant('type', [
  v.object({ type: v.literal('capture'), tabId: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))) }),
  v.object({ type: v.literal('resume'), tabId: v.pipe(v.number(), v.integer(), v.minValue(0)), text: v.pipe(v.string(), v.maxLength(LIMITS.contextBytes)) }),
  v.object({ type: v.literal('open-workspace'), snapshotId: v.optional(IdSchema) }),
  v.object({ type: v.literal('widget.list') }),
  v.object({ type: v.literal('widget.capture') }),
  v.object({ type: v.literal('widget.handoff'), snapshotId: IdSchema }),
  v.object({ type: v.literal('widget.insert'), snapshotId: IdSchema }),
  v.object({ type: v.literal('widget.workspace'), snapshotId: v.optional(IdSchema) }),
  v.object({ type: v.literal('widget.can-transfer') }),
  v.object({ type: v.literal('widget.auto'), enabled: v.boolean() }),
  v.object({ type: v.literal('widget.autosave') }),
]);
export type Request = v.InferOutput<typeof RequestSchema>;
export interface Response<T = unknown> { ok: boolean; value?: T; error?: string }
