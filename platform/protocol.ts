import * as v from 'valibot';
import { IdSchema, LIMITS } from '../core/model';

const widgetPage = { pageUrl: v.optional(v.pipe(v.string(), v.maxLength(4096))) };

export const AdapterCommandSchema = v.variant('type', [
  v.object({ type: v.literal('adapter.capture'), expectedUrl: v.optional(v.pipe(v.string(), v.maxLength(4096))) }),
  v.object({ type: v.literal('adapter.insert'), text: v.pipe(v.string(), v.maxLength(LIMITS.contextBytes)), expectedUrl: v.optional(v.pipe(v.string(), v.maxLength(4096))) }),
]);
export const RequestSchema = v.variant('type', [
  v.object({ type: v.literal('capture'), tabId: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))) }),
  v.object({ type: v.literal('resume'), tabId: v.pipe(v.number(), v.integer(), v.minValue(0)), text: v.pipe(v.string(), v.maxLength(LIMITS.contextBytes)) }),
  v.object({ type: v.literal('open-workspace'), snapshotId: v.optional(IdSchema) }),
  v.object({ type: v.literal('widget.list'), ...widgetPage }),
  v.object({ type: v.literal('widget.capture'), ...widgetPage }),
  v.object({ type: v.literal('widget.handoff'), snapshotId: IdSchema, ...widgetPage }),
  v.object({ type: v.literal('widget.insert'), snapshotId: IdSchema, ...widgetPage }),
  v.object({ type: v.literal('widget.workspace'), snapshotId: v.optional(IdSchema), ...widgetPage }),
  v.object({ type: v.literal('widget.can-transfer'), ...widgetPage }),
  v.object({ type: v.literal('widget.auto'), enabled: v.boolean(), ...widgetPage }),
  v.object({ type: v.literal('widget.autosave'), ...widgetPage }),
]);
export type Request = v.InferOutput<typeof RequestSchema>;
export interface Response<T = unknown> { ok: boolean; value?: T; error?: string }
