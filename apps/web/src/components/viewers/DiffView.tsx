export function DiffView({ diff, path }: { diff: string; path: string }) {
  if (!diff.trim()) {
    return <div className="empty">No diff for {path}</div>;
  }
  return (
    <div className="diff-view">
      {diff.split('\n').map((line, i) => {
        let cls = 'diff-line';
        if (line.startsWith('+') && !line.startsWith('+++')) cls += ' diff-add';
        else if (line.startsWith('-') && !line.startsWith('---')) cls += ' diff-del';
        else if (line.startsWith('@@')) cls += ' diff-hunk';
        return <div className={cls} key={i}>{line || ' '}</div>;
      })}
    </div>
  );
}
