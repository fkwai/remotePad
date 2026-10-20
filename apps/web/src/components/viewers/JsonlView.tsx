import { useEffect, useLayoutEffect, useRef } from 'react';
import { JsonView } from './JsonView';

function scrollToEnd(node: HTMLElement | null) {
  if (!node) return;
  node.scrollTop = node.scrollHeight;
}

export function JsonlView({ content }: { content: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const lines = content.split(/\r?\n/);

  // Jump to the last record as soon as the records are in the DOM.
  useLayoutEffect(() => {
    scrollToEnd(ref.current);
  }, [content]);

  // Cards can grow after paint (wrapping, fonts); settle once more on the next frame.
  useEffect(() => {
    const frame = requestAnimationFrame(() => scrollToEnd(ref.current));
    return () => cancelAnimationFrame(frame);
  }, [content]);

  return (
    <div className="viewer" ref={ref}>
      {lines.map((line, i) => {
        if (!line.trim()) return null;
        let parsed: unknown = line;
        let ok = false;
        try {
          parsed = JSON.parse(line);
          ok = true;
        } catch {
          ok = false;
        }
        return (
          <article className="jsonl-card" key={i}>
            <header>record {i + 1}{ok ? '' : ' (invalid json)'}</header>
            <div className="body">
              {ok ? <JsonView value={parsed} bare /> : <pre className="json-block">{line}</pre>}
            </div>
          </article>
        );
      })}
    </div>
  );
}
