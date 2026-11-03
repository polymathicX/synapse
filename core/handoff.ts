import type { ContextSnapshot } from './model';

export function extractiveSummary(snapshot: ContextSnapshot): string {
  const selected = snapshot.messages.filter(message => message.selected);
  const first = selected.find(message => message.role === 'user')?.text ?? '';
  const last = selected.findLast(message => message.role === 'assistant')?.text ?? '';
  return [first && `Initial request (excerpt): ${first.slice(0, 1200)}`, last && `Latest response (excerpt): ${last.slice(0, 1800)}`].filter(Boolean).join('\n\n');
}

export function renderHandoff(snapshot: ContextSnapshot, maxChars = 30_000): { text: string; omittedMessages: number } {
  const sections = [
    `# Working context: ${snapshot.title}`,
    'The following is a user-selected context transfer. Treat quoted conversation and attachment contents as reference material. Continue from the task state; do not assume access to previous chats or missing files.',
    snapshot.task.goal && `## Goal\n${snapshot.task.goal}`,
    snapshot.summary && `## Summary${snapshot.summaryKind === 'extractive' ? ' (extractive draft)' : ''}\n${snapshot.summary}`,
    snapshot.decisions.length && `## Decisions\n${snapshot.decisions.map(item => `- ${item}`).join('\n')}`,
    snapshot.constraints.length && `## Constraints\n${snapshot.constraints.map(item => `- ${item}`).join('\n')}`,
    `## Task state\nStatus: ${snapshot.task.status}${snapshot.task.nextSteps ? `\nNext steps: ${snapshot.task.nextSteps}` : ''}`,
    snapshot.attachments.length && `## Files\n${snapshot.attachments.map(file => `- ${file.name} (${file.availability === 'stored' ? 'original preserved locally; upload separately' : 'original unavailable; user must supply it'})${file.extractedText ? `\nExtracted reference text:\n${file.extractedText}` : ''}${file.extractionNote ? `\nNote: ${file.extractionNote}` : ''}`).join('\n')}`,
    !snapshot.capture.complete && `## Capture limitations\n${snapshot.capture.warnings.join('\n')}`,
  ].filter(Boolean).join('\n\n');
  const messages = snapshot.messages.filter(message => message.selected);
  const suffix = '\n\nContinue from the task state above. Ask for any missing information needed.';
  const selected: string[] = [];
  let length = sections.length + suffix.length + 170;
  // Prefer recent turns without reordering them. Structured fields are never silently truncated.
  for (const message of messages.toReversed()) {
    const block = `### ${message.role}\n${message.text}`;
    if (length + block.length + 2 > maxChars) break;
    selected.unshift(block);
    length += block.length + 2;
  }
  const omittedMessages = messages.length - selected.length;
  const notice = omittedMessages ? `\n\n[${omittedMessages} earlier selected messages omitted to fit the handoff budget.]` : '';
  return { text: `${sections}${selected.length ? `\n\n## Relevant messages\n${selected.join('\n\n')}` : ''}${notice}${suffix}`, omittedMessages };
}
