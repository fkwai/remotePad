import { JsonView } from './JsonView';

export function JsonlView({ content }: { content: string }) {
  const lines = content.split(/\r?\n/);
  return (
    <div className="viewer">
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
