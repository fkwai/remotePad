import { useEffect, useRef, useState } from 'react';
import { rawUrl } from '../../api';
import { usePreviewZoom, useZoomListener } from './previewZoom';

/** Large Plotly HTML is served from disk via /api/fs/raw — not inlined into srcDoc. */
export function HtmlView({ path, bust }: { path: string; bust?: number }) {
  const src = bust ? `${rawUrl(path)}&t=${bust}` : rawUrl(path);
  const boxRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const { zoom, onWheel } = usePreviewZoom(src);
  const [frameReady, setFrameReady] = useState(0);
  useZoomListener(boxRef, onWheel, src);

  useEffect(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    const listener = onWheel as EventListener;
    doc.addEventListener('wheel', listener, { passive: false, capture: true });
    return () => doc.removeEventListener('wheel', listener, true);
  }, [onWheel, frameReady, src]);

  return (
    <div className="html-view" ref={boxRef} title="Ctrl+scroll to zoom">
      <iframe
        ref={frameRef}
        key={src}
        className="html-frame"
        sandbox="allow-scripts allow-downloads allow-popups allow-same-origin"
        src={src}
        title="HTML preview"
        style={{ zoom }}
        onLoad={() => setFrameReady((n) => n + 1)}
      />
    </div>
  );
}
