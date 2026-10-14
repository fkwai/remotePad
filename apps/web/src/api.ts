export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // keep status text
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export function rawUrl(path: string): string {
  return `/api/fs/raw?path=${encodeURIComponent(path)}`;
}

export function downloadFile(filePath: string, name?: string) {
  const a = document.createElement('a');
  a.href = rawUrl(filePath);
  a.download = name || filePath.split('/').filter(Boolean).pop() || 'download';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
