import { useState } from 'react';

export function JsonView({ value, bare }: { value: unknown; bare?: boolean }) {
  const inner = <JsonNode value={value} name="root" root />;
  if (bare) return inner;
  return <div className="viewer">{inner}</div>;
}

function JsonNode({ value, name, root }: { value: unknown; name: string; root?: boolean }) {
  const [open, setOpen] = useState(true);
  if (value !== null && typeof value === 'object') {
    const entries = Array.isArray(value)
      ? value.map((item, i) => [String(i), item] as const)
      : Object.entries(value);
    return (
      <div className="json-row">
        <span className="twisty" onClick={() => setOpen((v) => !v)}>{open ? '▾' : '▸'}</span>
        {!root && <span className="json-key">{name}</span>}
        <span className="json-null"> {Array.isArray(value) ? `[${value.length}]` : `{${entries.length}}`}</span>
        {open && (
          <div style={{ paddingLeft: 16 }}>
            {entries.map(([k, v]) => <JsonNode key={k} name={k} value={v} />)}
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="json-row">
      <span className="twisty"> </span>
      <span className="json-key">{name}</span>
      <span>: </span>
      <JsonLeaf value={value} />
    </div>
  );
}

function JsonLeaf({ value }: { value: unknown }) {
  if (value === null) return <span className="json-null">null</span>;
  if (typeof value === 'string') return <span className="json-str">"{value}"</span>;
  if (typeof value === 'number') return <span className="json-num">{value}</span>;
  if (typeof value === 'boolean') return <span className="json-bool">{String(value)}</span>;
  return <span>{String(value)}</span>;
}

export function parseJsonSafe(content: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(content) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
