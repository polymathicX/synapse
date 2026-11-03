import { safeFilename } from '../core/model';

export function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing view element: ${id}`);
  return element as T;
}
export function button(label: string, onClick: () => void, className = 'button subtle'): HTMLButtonElement {
  const element = document.createElement('button'); element.type = 'button'; element.className = className; element.textContent = label; element.addEventListener('click', onClick); return element;
}
export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = safeFilename(name); document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
export function bytes(value: number): string { return value < 1024 * 1024 ? `${(value / 1024).toFixed(1)} KiB` : `${(value / (1024 * 1024)).toFixed(1)} MiB`; }
