/**
 * Which window this page is.
 *
 * Tabs opened with `?w=<id>` get their own layout and their own Agent
 * conversation; everything else is the default window, so ordinary links and
 * older bookmarks keep behaving as before.
 */
const VALID = /^[A-Za-z0-9_-]{1,32}$/;

export function windowIdFromUrl(search = typeof location !== 'undefined' ? location.search : ''): string {
  const raw = new URLSearchParams(search).get('w') || '';
  return VALID.test(raw) ? raw : 'default';
}

/** Query suffix for API/socket calls; empty for the default window. */
export function windowQuery(id: string): string {
  return id && id !== 'default' ? `?w=${encodeURIComponent(id)}` : '';
}

export function newWindowId(): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  const bytes = new Uint8Array(6);
  (globalThis.crypto || { getRandomValues: (a: Uint8Array) => a.map(() => Math.floor(Math.random() * 256)) } as Crypto)
    .getRandomValues(bytes);
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return out;
}

/** Absolute URL for a window id, for "open new window" and "copy link". */
export function windowUrl(id: string): string {
  const base = `${location.origin}${location.pathname}`;
  return id === 'default' ? base : `${base}?w=${encodeURIComponent(id)}`;
}
