import { useCallback, useEffect, useState, type RefObject } from 'react';

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 8;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom * 100) / 100));
}

/** Ctrl+wheel zooms the preview. preventDefault stops the browser page zoom. */
export function onPreviewWheel(event: WheelEvent, setZoom: (fn: (zoom: number) => number) => void): void {
  if (!event.ctrlKey) return;
  event.preventDefault();
  const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
  setZoom((zoom) => clampZoom(zoom * factor));
}

export function usePreviewZoom(resetKey: string): {
  zoom: number;
  onWheel: (event: WheelEvent) => void;
} {
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    setZoom(1);
  }, [resetKey]);

  const onWheel = useCallback((event: WheelEvent) => {
    onPreviewWheel(event, setZoom);
  }, []);

  return { zoom, onWheel };
}

export function useZoomListener(ref: RefObject<EventTarget | null>, onWheel: (event: WheelEvent) => void, watch: unknown): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const listener = onWheel as EventListener;
    el.addEventListener('wheel', listener, { passive: false, capture: true });
    return () => el.removeEventListener('wheel', listener, true);
  }, [ref, onWheel, watch]);
}
