import { afterEach, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { observeConversation } from '../providers/observe';

afterEach(() => vi.useRealTimers());
it('debounces conversation changes, ignores the composer, and disconnects cleanly', async () => {
  vi.useFakeTimers();
  const document = new JSDOM('<main><article class="message">First</article><div contenteditable="true"></div></main>', { pretendToBeVisual: true }).window.document;
  const capture = vi.fn(async () => undefined); const stop = observeConversation(document, '.message', capture);
  document.querySelector('[contenteditable]')!.textContent = 'Draft'; await Promise.resolve(); await vi.advanceTimersByTimeAsync(1000); expect(capture).not.toHaveBeenCalled();
  document.querySelector('.message')!.textContent = 'Updated'; await Promise.resolve(); await vi.advanceTimersByTimeAsync(500);
  document.querySelector('.message')!.textContent = 'Final'; await Promise.resolve(); await vi.advanceTimersByTimeAsync(749); expect(capture).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); expect(capture).toHaveBeenCalledTimes(1);
  document.querySelector('.message')!.textContent = 'Stop'; await Promise.resolve(); stop(); await vi.advanceTimersByTimeAsync(2000); expect(capture).toHaveBeenCalledTimes(1);
});
