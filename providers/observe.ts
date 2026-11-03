/** A bounded observer: no polling, no work before changes, one save after settling. */
export function observeConversation(document: Document, selector: string, capture: () => Promise<void>): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let firstChange = 0, running = false, stopped = false, pending = false;
  const schedule = () => {
    if (stopped) return;
    firstChange ||= Date.now(); clearTimeout(timer);
    timer = setTimeout(() => {
      firstChange = 0;
      if (stopped || document.visibilityState === 'hidden') return;
      if (running) { pending = true; return; }
      running = true; void capture().catch(() => undefined).finally(() => { running = false; if (pending) { pending = false; schedule(); } });
    }, Math.min(750, Math.max(0, 5000 - (Date.now() - firstChange))));
  };
  const observer = new document.defaultView!.MutationObserver(records => {
    if (records.some(record => {
      const element = record.target.nodeType === 1 ? record.target as Element : record.target.parentElement;
      if (element?.closest('[contenteditable="true"],textarea')) return false;
      return element?.closest(selector) || [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1 && ((node as Element).matches(selector) || (node as Element).querySelector(selector)));
    })) schedule();
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-is-streaming', 'data-message-complete'] });
  return () => { stopped = true; observer.disconnect(); clearTimeout(timer); };
}
