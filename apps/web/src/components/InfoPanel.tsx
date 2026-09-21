import type { GitStatusResponse, MachineInfo, TermSessionInfo } from '@remotepad/shared';
import { basename } from '../files';

export function InfoPanel({
  path,
  machine,
  git,
  sessions,
  onOpenDiff,
  onSelectTerm,
}: {
  path: string | null;
  machine: MachineInfo | null;
  git: GitStatusResponse | null;
  sessions: TermSessionInfo[];
  onOpenDiff: (path: string) => void;
  onSelectTerm: (id: string) => void;
}) {
  return (
    <div className="info-pane">
      <div className="info">
        <h3>Path</h3>
        <div className="kv">{path || '—'}</div>
        {machine && (
          <>
            <h3>Host</h3>
            <div className="kv"><b>{machine.user}</b>@{machine.hostname}</div>
            <div className="kv">{machine.platform} {machine.release} · {machine.arch}</div>
          </>
        )}
        {git?.repoRoot && (
          <>
            <h3>Git</h3>
            <div className="kv"><b>{git.branch || 'detached'}</b></div>
            <div className="kv">{git.repoRoot}</div>
            {git.ahead || git.behind ? (
              <div className="kv">↑{git.ahead} ↓{git.behind}</div>
            ) : null}
            {git.files.length === 0 && <div className="kv">clean</div>}
            {git.files.map((file) => (
              <div className="git-file" key={file.path} onClick={() => onOpenDiff(file.path)}>
                <span className={`git-code ${file.working || file.index}`}>{file.working !== ' ' ? file.working : file.index}</span>
                <span>{rel(file.path, git.repoRoot || '')}</span>
              </div>
            ))}
          </>
        )}
        <h3>Terminals</h3>
        {sessions.length === 0 && <div className="kv">none</div>}
        {sessions.map((session) => (
          <div className="git-file" key={session.id} onClick={() => onSelectTerm(session.id)}>
            <span className={`status-dot ${session.alive ? '' : 'off'}`} />
            <span>{session.name} · {basename(session.cwd)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function rel(path: string, root: string): string {
  if (path.startsWith(root + '/')) return path.slice(root.length + 1);
  return path;
}
