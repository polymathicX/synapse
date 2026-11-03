export function runWorker<T>(worker: Worker, job: unknown, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => finish(undefined, new Error('Processing timed out. Try a smaller file.')), 120_000);
    const abort = () => finish(undefined, new Error('Processing cancelled.'));
    const finish = (value?: T, error?: Error) => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort); worker.terminate();
      if (error) reject(error); else resolve(value as T);
    };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    worker.onmessage = (event: MessageEvent<T & { ok: boolean; error?: string }>) => {
      if (!event.data || typeof event.data.ok !== 'boolean') { finish(undefined, new Error(`Unexpected processor response (${Object.keys(event.data ?? {}).join(', ')}).`)); return; }
      if (!event.data.ok) finish(undefined, new Error(event.data.error ?? 'Processing failed.'));
      else finish(event.data);
    };
    worker.onerror = () => finish(undefined, new Error('The file processor failed. The original is unchanged.'));
    worker.postMessage(job);
  });
}
