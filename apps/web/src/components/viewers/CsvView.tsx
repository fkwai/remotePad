import Papa from 'papaparse';
import { extOf } from '../../files';

export function CsvView({ content, path }: { content: string; path: string }) {
  const delimiter = extOf(path) === 'tsv' ? '\t' : undefined;
  const parsed = Papa.parse<string[]>(content, { delimiter, skipEmptyLines: true });
  const rows = parsed.data;
  if (!rows.length) return <div className="empty">Empty CSV</div>;
  const header = rows[0];
  const body = rows.slice(1);
  return (
    <div className="csv-wrap">
      <table className="csv-table">
        <thead>
          <tr>{header.map((cell, i) => <th key={i}>{cell}</th>)}</tr>
        </thead>
        <tbody>
          {body.map((row, r) => (
            <tr key={r}>
              {header.map((_, c) => <td key={c}>{row[c] ?? ''}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
