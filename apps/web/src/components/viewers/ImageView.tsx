import { useEffect, useRef, useState, type MouseEvent, type MutableRefObject } from 'react';
import { rawUrl } from '../../api';
import { usePreviewZoom, useZoomListener } from './previewZoom';

type PickPx = { x: number; y: number; r: number; g: number; b: number; a: number; w: number; h: number };

export function ImageView({ path, bust, onInfo }: { path: string; bust?: number; onInfo?: (text: string | null) => void }) {
  const src = bust ? `${rawUrl(path)}&t=${bust}` : rawUrl(path);
  const boxRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [pick, setPick] = useState<PickPx | null>(null);
  const { zoom, onWheel } = usePreviewZoom(src);
  useZoomListener(boxRef, onWheel, src);

  const report = (next: PickPx | null) => {
    setPick(next);
    onInfo?.(next ? formatPick(next) : null);
  };

  useEffect(() => () => onInfo?.(null), [onInfo]);

  const onPick = (e: MouseEvent<HTMLImageElement>) => {
    if (e.button !== 0) return;
    const img = imgRef.current;
    if (!img?.naturalWidth) return;
    const rect = img.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = Math.floor((e.clientX - rect.left) * img.naturalWidth / rect.width);
    const y = Math.floor((e.clientY - rect.top) * img.naturalHeight / rect.height);
    if (x < 0 || y < 0 || x >= img.naturalWidth || y >= img.naturalHeight) return;
    const px = samplePixel(img, canvasRef, x, y);
    report({ x, y, w: img.naturalWidth, h: img.naturalHeight, ...px });
  };

  return (
    <div className="image-view" ref={boxRef} title="Click a pixel · Ctrl+scroll to zoom">
      <div className="image-stage">
        <div className="image-frame" style={{ zoom }}>
          <img
            key={src}
            ref={imgRef}
            src={src}
            alt={path}
            draggable={false}
            onClick={onPick}
            onLoad={() => report(null)}
          />
          {pick && (
            <span
              className="image-cross"
              style={{
                left: `${((pick.x + 0.5) / pick.w) * 100}%`,
                top: `${((pick.y + 0.5) / pick.h) * 100}%`,
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function samplePixel(
  img: HTMLImageElement,
  canvasRef: MutableRefObject<HTMLCanvasElement | null>,
  x: number,
  y: number,
): { r: number; g: number; b: number; a: number } {
  try {
    let canvas = canvasRef.current;
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      canvasRef.current = canvas;
    }
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { r: 0, g: 0, b: 0, a: 0 };
    ctx.clearRect(0, 0, 1, 1);
    ctx.drawImage(img, x, y, 1, 1, 0, 0, 1, 1);
    const data = ctx.getImageData(0, 0, 1, 1).data;
    return { r: data[0], g: data[1], b: data[2], a: data[3] };
  } catch {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
}

function formatPick(pick: PickPx): string {
  const grey = Math.round((pick.r + pick.g + pick.b) / 3);
  const gray = pick.r === pick.g && pick.g === pick.b;
  const alpha = pick.a < 255 ? `  A=${pick.a}` : '';
  if (gray) return `x=${pick.x}  y=${pick.y}  grey=${pick.r}${alpha}`;
  return `x=${pick.x}  y=${pick.y}  R=${pick.r}  G=${pick.g}  B=${pick.b}  grey=${grey}${alpha}`;
}
