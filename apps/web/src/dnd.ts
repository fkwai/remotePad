import type { DragEvent } from 'react';

export type DraggedEntry = { path: string; kind: 'file' | 'dir'; name?: string };

const TYPE = 'application/x-remotepad-entry';

export function setEntryDrag(e: DragEvent, entry: DraggedEntry) {
  const name = entry.name || entry.path.split('/').filter(Boolean).pop() || entry.path;
  e.dataTransfer.setData(TYPE, JSON.stringify({ ...entry, name }));
  // Browser address-bar drops read text/plain (or text/uri-list) and navigate to it,
  // so both must carry the full `?pad=` URL — a raw path here opens an empty editor.
  const url = browserPadUrl(entry.path);
  e.dataTransfer.setData('text/plain', url);
  e.dataTransfer.setData('text/uri-list', url);
  e.dataTransfer.effectAllowed = 'copy';
}

export function readEntryDrag(e: DragEvent): DraggedEntry | null {
  const raw = e.dataTransfer.getData(TYPE);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as DraggedEntry;
      if (parsed && typeof parsed.path === 'string' && (parsed.kind === 'file' || parsed.kind === 'dir')) {
        return parsed;
      }
    } catch {
      /* ignore malformed payload */
    }
  }
  const text = e.dataTransfer.getData('text/plain');
  if (text && text.startsWith('/')) {
    const name = text.split('/').filter(Boolean).pop() || text;
    return { path: text, kind: 'file', name };
  }
  return null;
}

export function hasEntryDrag(e: DragEvent): boolean {
  return Array.from(e.dataTransfer.types).includes(TYPE);
}

/** Slim tree + editor window for this path (drop on the browser address bar). */
export function browserPadUrl(filePath: string): string {
  const origin = typeof location !== 'undefined' ? location.origin : '';
  return `${origin}/?pad=${encodeURIComponent(filePath)}`;
}

/** Absolute URL that streams the raw file bytes. */
export function browserFileUrl(filePath: string): string {
  const origin = typeof location !== 'undefined' ? location.origin : '';
  return `${origin}/api/fs/raw?path=${encodeURIComponent(filePath)}`;
}
