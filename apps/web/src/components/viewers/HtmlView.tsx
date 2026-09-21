import { rawUrl } from '../../api';

/** Large Plotly HTML is served from disk via /api/fs/raw — not inlined into srcDoc. */
export function HtmlView({ path, bust }: { path: string; bust?: number }) {
  const src = bust ? `${rawUrl(path)}&t=${bust}` : rawUrl(path);
  return (
    <iframe
      key={src}
      className="html-frame"
      sandbox="allow-scripts allow-downloads allow-popups allow-same-origin"
      src={src}
      title="HTML preview"
    />
  );
}
