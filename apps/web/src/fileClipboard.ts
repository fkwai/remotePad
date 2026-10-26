import { useEffect, useState } from 'react';

/**
 * Files copied in the Sidebar or an Explorer, waiting for a paste.
 *
 * Deliberately not the system clipboard: it survives a copy inside the app, is
 * visible in the menus ("Paste here" only appears when something is waiting),
 * and cannot be confused with text copied from the editor.
 */
export interface FileClipboard {
  mode: 'copy' | 'cut';
  paths: string[];
}

let current: FileClipboard | null = null;
const listeners = new Set<(value: FileClipboard | null) => void>();

export function fileClipboard(): FileClipboard | null {
  return current;
}

export function setFileClipboard(value: FileClipboard | null) {
  current = value && value.paths.length ? value : null;
  for (const listener of listeners) listener(current);
}

export function clearFileClipboard() {
  setFileClipboard(null);
}

/** React binding: re-renders a menu when the clipboard changes. */
export function useFileClipboard(): FileClipboard | null {
  const [value, setValue] = useState<FileClipboard | null>(current);
  useEffect(() => {
    listeners.add(setValue);
    // Another window may have changed it between render and subscribe.
    setValue(current);
    return () => { listeners.delete(setValue); };
  }, []);
  return value;
}

/** The folder a paste should land in for an entry (a file pastes next to itself). */
export function pasteTargetFor(entryPath: string, isDir: boolean): string {
  if (isDir) return entryPath;
  const cut = entryPath.lastIndexOf('/');
  return cut > 0 ? entryPath.slice(0, cut) : '/';
}

/** True when pasting `path` into `into` would be a no-op or a self-copy. */
export function pasteWouldClash(paths: string[], into: string): boolean {
  return paths.some((path) => into === path || into.startsWith(`${path}/`));
}
