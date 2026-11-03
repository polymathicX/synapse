import { describe, expect, it } from 'vitest';
import { createSnapshot, parseSnapshot, safeFilename } from '../core/model';
import { renderHandoff, extractiveSummary } from '../core/handoff';
import { providerForUrl } from '../providers/registry';
import { exampleSnapshot } from './fixtures';

describe('snapshot and handoff', () => {
  it('validates versions and duplicate identifiers', () => {
    expect(() => parseSnapshot({ ...exampleSnapshot(), schemaVersion: 2 })).toThrow();
    const snapshot = exampleSnapshot(); snapshot.messages.push(snapshot.messages[0]!);
    expect(() => parseSnapshot(snapshot)).toThrow('Duplicate');
  });
  it('preserves structured context, message order, code and missing-file notices', () => {
    const snapshot = exampleSnapshot();
    snapshot.attachments.push({ id: 'file-1', name: 'spec.pdf', size: 0, mediaType: 'application/pdf', availability: 'missing' });
    const { text } = renderHandoff(snapshot);
    for (const value of ['No telemetry', 'Use native browser APIs', 'Verify persistence', 'const answer = 42;', 'original unavailable']) expect(text).toContain(value);
    expect(text.indexOf('### user')).toBeLessThan(text.indexOf('### assistant'));
  });
  it('prioritizes recent messages and explicitly reports omissions', () => {
    const snapshot = exampleSnapshot();
    snapshot.messages[0]!.text = 'x'.repeat(5000);
    const result = renderHandoff(snapshot, 1500);
    expect(result.omittedMessages).toBe(1); expect(result.text).toContain('const answer = 42;'); expect(result.text).toContain('omitted');
  });
  it('does not fabricate decisions in an extractive summary', () => {
    const snapshot = createSnapshot(); snapshot.messages = [{ id: 'u', role: 'user', text: 'Try option A?', selected: true }];
    expect(extractiveSummary(snapshot)).toBe('Initial request (excerpt): Try option A?'); expect(snapshot.decisions).toEqual([]);
  });
  it('recognizes exact HTTPS provider hosts only', () => {
    expect(providerForUrl('https://chatgpt.com/c/123')?.id).toBe('chatgpt');
    expect(providerForUrl('https://chatgpt.com.attacker.example/')).toBeUndefined();
    expect(providerForUrl('http://claude.ai/')).toBeUndefined();
    for (const forbidden of ['\\', '/', '\0']) expect(safeFilename('../a\\b\u0000.pdf')).not.toContain(forbidden);
  });
});
