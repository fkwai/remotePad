import { useEffect, useMemo, useRef, useState } from 'react';
import type { AgentChange, AgentSessionInfo, AgentStatus } from '@remotepad/shared';
import { HELPER_SESSION_ID } from '@remotepad/shared';
import { basename } from '../files';
import { readEntryDrag, hasEntryDrag } from '../dnd';
import { ActionMenu, type MenuItem } from './ContextMenu';

export type AgentChatMessage = {
  id: number;
  role: 'user' | 'assistant' | 'tool' | 'status';
  text: string;
  name?: string;
};

export function AgentPanel({
  cwd,
  error,
  sessionId,
  sessions,
  state,
  messages,
  changes,
  onSend,
  onStop,
  onClear,
  onNew,
  onOpen,
  onRename,
  onDelete,
  onAccept,
  onUndo,
  onAcceptAll,
  onUndoAll,
  onOpenDiff,
  onOpenSessionFile,
}: {
  cwd: string;
  error?: string;
  sessionId?: string;
  sessions: AgentSessionInfo[];
  state: AgentStatus;
  messages: AgentChatMessage[];
  changes: AgentChange[];
  onSend: (text: string) => void;
  onStop: () => void;
  onClear: () => void;
  onNew: () => void;
  onOpen: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onAccept: (path: string) => void;
  onUndo: (path: string) => void;
  onAcceptAll: () => void;
  onUndoAll: () => void;
  onOpenDiff: (change: AgentChange) => void;
  onOpenSessionFile?: (path: string) => void;
}) {
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [openIds, setOpenIds] = useState<string[]>([HELPER_SESSION_ID]);
  const [chips, setChips] = useState<{ path: string; name: string }[]>([]);
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [collapsedTools, setCollapsedTools] = useState<Set<number>>(new Set());
  const busy = state === 'running';
  const helperActive = sessionId === HELPER_SESSION_ID;

  useEffect(() => {
    const node = logRef.current;
    if (!node) return;
    const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
    if (nearBottom) node.scrollTop = node.scrollHeight;
  }, [messages]);

  useEffect(() => {
    setOpenIds((prev) => {
      let next = prev.includes(HELPER_SESSION_ID) ? prev : [HELPER_SESSION_ID, ...prev];
      if (sessionId && !next.includes(sessionId)) next = [...next, sessionId];
      return next.length === prev.length && next.every((id, i) => id === prev[i]) ? prev : next;
    });
  }, [sessionId]);

  useEffect(() => {
    const known = new Set(sessions.map((item) => item.id));
    setOpenIds((prev) => {
      const next = prev.filter((id) => id === HELPER_SESSION_ID || known.has(id) || id === sessionId);
      if (!next.includes(HELPER_SESSION_ID)) next.unshift(HELPER_SESSION_ID);
      return next.length === prev.length && next.every((id, i) => id === prev[i]) ? prev : next;
    });
  }, [sessions, sessionId]);

  useEffect(() => {
    setCollapsedTools(new Set());
  }, [sessionId]);

  const openTabs = useMemo(() => {
    const byId = new Map(sessions.map((item) => [item.id, item]));
    const tabs = openIds
      .map((id) => byId.get(id) || (id === HELPER_SESSION_ID
        ? { id: HELPER_SESSION_ID, title: 'Helper', preview: '', updatedAt: Date.now(), pinned: true }
        : undefined))
      .filter((item): item is AgentSessionInfo => Boolean(item));
    tabs.sort((a, b) => {
      if (a.id === HELPER_SESSION_ID) return -1;
      if (b.id === HELPER_SESSION_ID) return 1;
      return 0;
    });
    return tabs;
  }, [openIds, sessions]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((item) => `${item.title} ${item.preview}`.toLowerCase().includes(q));
  }, [sessions, query]);

  const turns = useMemo(() => groupTurns(messages), [messages]);

  function addChip(path: string, name?: string) {
    const label = name || basename(path);
    setChips((prev) => prev.some((item) => item.path === path) ? prev : [...prev, { path, name: label }]);
  }

  function submit() {
    const text = inputRef.current?.value ?? '';
    const chipBlock = chips.map((item) => item.path).join('\n');
    const body = [chipBlock, text].filter((part) => part.trim()).join('\n\n');
    if (!body.trim() || busy) return;
    onSend(body);
    if (inputRef.current) inputRef.current.value = '';
    setChips([]);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function commitRename() {
    if (!renaming || renaming === HELPER_SESSION_ID) {
      setRenaming(null);
      return;
    }
    const title = renameValue.trim();
    if (title) onRename(renaming, title);
    setRenaming(null);
  }

  function closeTab(id: string) {
    if (id === HELPER_SESSION_ID) return;
    const next = openIds.filter((item) => item !== id);
    if (!next.includes(HELPER_SESSION_ID)) next.unshift(HELPER_SESSION_ID);
    setOpenIds(next);
    if (id !== sessionId) return;
    const fallback = next.filter((item) => item !== id).at(-1) || HELPER_SESSION_ID;
    onOpen(fallback);
  }

  function openFromHistory(id: string) {
    if (id !== sessionId) onOpen(id);
    setHistoryOpen(false);
  }

  function sessionJsonlPath(id: string): string | undefined {
    return sessions.find((item) => item.id === id)?.historyPath;
  }

  const menuSession = tabMenu ? openTabs.find((item) => item.id === tabMenu.id) : null;
  const tabMenuItems: MenuItem[] = tabMenu && menuSession ? [
    { type: 'item', id: 'open-jsonl', label: 'Open session JSONL', disabled: !sessionJsonlPath(menuSession.id) },
    ...(menuSession.id !== HELPER_SESSION_ID
      ? [
        { type: 'item' as const, id: 'rename', label: 'Rename' },
        { type: 'sep' as const },
        { type: 'item' as const, id: 'close', label: 'Close tab' },
      ]
      : []),
  ] : [];

  return (
    <div className="agent-pane">
      <div className="agent-chrome">
        <div className="agent-tabs">
          {openTabs.map((item) => (
            <div
              key={item.id}
              className={`agent-tab ${item.id === sessionId ? 'active' : ''} ${item.id === HELPER_SESSION_ID ? 'pinned' : ''}`}
              onClick={() => { if (item.id !== sessionId) onOpen(item.id); }}
              onContextMenu={(e) => {
                e.preventDefault();
                setTabMenu({ x: e.clientX, y: e.clientY, id: item.id });
              }}
              title={item.id === HELPER_SESSION_ID ? `${item.title} · ${cwd}` : item.title}
            >
              <span className="agent-tab-title">{item.title}</span>
              {item.id !== HELPER_SESSION_ID && (
                <button
                  className="ghost close"
                  onClick={(e) => { e.stopPropagation(); closeTab(item.id); }}
                >×</button>
              )}
            </div>
          ))}
        </div>
        <button className="ghost agent-chrome-btn" onClick={onNew} title="New session" aria-label="New session">+</button>
        <button
          className={`ghost agent-chrome-btn ${historyOpen ? 'on' : ''}`}
          onClick={() => setHistoryOpen((v) => !v)}
          title="Session history"
          aria-label="Session history"
        >☰</button>
      </div>
      {tabMenu && menuSession && (
        <ActionMenu
          x={tabMenu.x}
          y={tabMenu.y}
          items={tabMenuItems}
          onClose={() => setTabMenu(null)}
          onAction={(id) => {
            if (id === 'open-jsonl') {
              const path = sessionJsonlPath(menuSession.id);
              if (path) onOpenSessionFile?.(path);
            } else if (id === 'rename') {
              setRenaming(menuSession.id);
              setRenameValue(menuSession.title);
              setHistoryOpen(true);
            } else if (id === 'close') {
              closeTab(menuSession.id);
            }
          }}
        />
      )}
      {historyOpen && (
        <button type="button" className="agent-history-mask" aria-label="Close history" onClick={() => setHistoryOpen(false)} />
      )}
      {historyOpen && (
        <div className="agent-history">
          <div className="agent-history-head">
            <span>Sessions</span>
            <button className="ghost" onClick={() => setHistoryOpen(false)}>×</button>
          </div>
          {sessions.length > 4 && (
            <input
              className="agent-session-filter"
              value={query}
              placeholder="Filter sessions"
              onChange={(e) => setQuery(e.target.value)}
            />
          )}
          <div className="agent-session-list">
            {visible.length === 0 && <div className="agent-session-empty">No sessions yet</div>}
            {visible.map((item) => (
              <div
                key={item.id}
                className={`agent-session ${item.id === sessionId ? 'active' : ''}`}
                onClick={() => openFromHistory(item.id)}
                onDoubleClick={(e) => {
                  if (item.id === HELPER_SESSION_ID) return;
                  e.stopPropagation();
                  setRenaming(item.id);
                  setRenameValue(item.title);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setTabMenu({ x: e.clientX, y: e.clientY, id: item.id });
                }}
              >
                <div className="agent-session-row">
                  {renaming === item.id ? (
                    <input
                      className="agent-session-rename"
                      autoFocus
                      value={renameValue}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename();
                        if (e.key === 'Escape') setRenaming(null);
                      }}
                      onBlur={commitRename}
                    />
                  ) : (
                    <span className="agent-session-title" title={item.id}>{item.title}</span>
                  )}
                  <span className="agent-session-time">{formatTime(item.updatedAt)}</span>
                </div>
                {item.preview && item.preview !== item.title && (
                  <div className="agent-session-preview">{item.preview}</div>
                )}
                <div className="agent-session-actions">
                  {item.historyPath && (
                    <button
                      className="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenSessionFile?.(item.historyPath!);
                      }}
                    >JSONL</button>
                  )}
                  {item.id !== HELPER_SESSION_ID && (
                    <button
                      className="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        setRenaming(item.id);
                        setRenameValue(item.title);
                      }}
                    >Rename</button>
                  )}
                  {item.id === HELPER_SESSION_ID ? (
                    <span className="agent-session-pinned">Pinned</span>
                  ) : (
                    <button
                      className="danger"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm(`Delete session “${item.title}”? This removes its saved history.`)) {
                          onDelete(item.id);
                        }
                      }}
                    >Delete</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {error && <div className="agent-banner">{error}</div>}
      <div className="agent-log" ref={logRef}>
        {messages.length === 0 && !error && (
          <div className="agent-empty">
            {helperActive
              ? 'Ask Helper to change RemotePad. Chat is scratch; lasting layout and gesture rules live in AGENTS.md. New task wipes this transcript.'
              : 'Ask XiaoBa to read or edit files in this repo.'}
          </div>
        )}
        {turns.map((turn) => (
          <div key={turn.key} className={`agent-turn ${turn.role}`}>
            {turn.role === 'user' && (
              <div className="agent-msg user">
                <div className="agent-msg-role">You</div>
                <div className="agent-msg-body">{turn.text}</div>
              </div>
            )}
            {turn.role === 'assistant' && (
              <div className="agent-msg assistant">
                <div className="agent-msg-role">{helperActive ? 'Helper' : 'Agent'}</div>
                <div className="agent-msg-body">{turn.text}</div>
              </div>
            )}
            {turn.role === 'status' && (
              <div className="agent-msg status">
                <div className="agent-msg-body">{turn.text}</div>
              </div>
            )}
            {turn.role === 'tools' && (
              <div className="agent-tool-block">
                {turn.tools.map((tool) => {
                  const closed = collapsedTools.has(tool.id);
                  return (
                    <button
                      type="button"
                      key={tool.id}
                      className={`agent-tool-row ${closed ? 'collapsed' : ''}`}
                      onClick={() => {
                        setCollapsedTools((prev) => {
                          const next = new Set(prev);
                          if (next.has(tool.id)) next.delete(tool.id);
                          else next.add(tool.id);
                          return next;
                        });
                      }}
                    >
                      <span className="agent-tool-chevron">{closed ? '▸' : '▾'}</span>
                      <span className="agent-tool-name">{tool.name || 'tool'}</span>
                      {!closed && tool.text && <span className="agent-tool-detail">{tool.text}</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
        {busy && <div className="agent-busy">Working…</div>}
      </div>
      {changes.length > 0 && (
        <div className="agent-changes">
          <div className="agent-changes-head">
            <span>{changes.length} file{changes.length === 1 ? '' : 's'} changed</span>
            <span className="actions">
              <button className="ghost" onClick={onAcceptAll}>Keep all</button>
              <button className="danger" onClick={onUndoAll}>Undo all</button>
            </span>
          </div>
          {changes.map((change) => {
            const stats = diffStats(change.diff);
            return (
              <div className="agent-change" key={change.path}>
                <button type="button" className="agent-change-main" onClick={() => onOpenDiff(change)}>
                  <span className={`git-code ${codeOf(change.kind)}`}>{codeOf(change.kind)}</span>
                  <span className="agent-change-name" title={change.path}>{relName(change.path, cwd)}</span>
                  {(stats.plus > 0 || stats.minus > 0) && (
                    <span className="agent-change-stats">
                      {stats.plus > 0 && <span className="plus">+{stats.plus}</span>}
                      {stats.minus > 0 && <span className="minus">−{stats.minus}</span>}
                    </span>
                  )}
                </button>
                <span className="actions">
                  <button className="ghost" onClick={() => onAccept(change.path)}>Keep</button>
                  <button className="danger" onClick={() => onUndo(change.path)}>Undo</button>
                </span>
              </div>
            );
          })}
        </div>
      )}
      <div
        className="agent-compose"
        onDragOver={(e) => {
          if (hasEntryDrag(e)) e.preventDefault();
        }}
        onDrop={(e) => {
          const entry = readEntryDrag(e);
          if (!entry) return;
          e.preventDefault();
          addChip(entry.path, entry.name);
        }}
      >
        {chips.length > 0 && (
          <div className="agent-chips">
            {chips.map((chip) => (
              <a
                key={chip.path}
                className="agent-chip"
                href={chip.path}
                title={chip.path}
                onClick={(e) => {
                  e.preventDefault();
                  void navigator.clipboard.writeText(chip.path);
                }}
              >
                <span className="agent-chip-name">{chip.name}</span>
                <button
                  type="button"
                  className="ghost"
                  aria-label={`Remove ${chip.name}`}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setChips((prev) => prev.filter((item) => item.path !== chip.path));
                  }}
                >×</button>
              </a>
            ))}
          </div>
        )}
        <textarea
          ref={inputRef}
          rows={3}
          placeholder={busy ? 'Agent is working… (Enter queues after stop)' : helperActive ? 'Message Helper · drop files as chips' : 'Message XiaoBa · drop files as chips'}
          onDragOver={(e) => {
            if (hasEntryDrag(e)) e.preventDefault();
          }}
          onDrop={(e) => {
            const entry = readEntryDrag(e);
            if (!entry) return;
            e.preventDefault();
            addChip(entry.path, entry.name);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="agent-compose-row">
          <button
            className="ghost"
            onClick={() => {
              setChips([]);
              onClear();
            }}
            disabled={busy}
            title={helperActive
              ? 'Wipe Helper chat. AGENTS.md still injects on the next send.'
              : "Wipe this session's saved history"}
          >{helperActive ? 'New task' : 'Clear'}</button>
          <span className="spacer" />
          {busy
            ? <button className="danger" onClick={onStop}>Stop</button>
            : <button className="primary" onClick={submit}>Send</button>}
        </div>
      </div>
    </div>
  );
}

type Turn =
  | { key: string; role: 'user' | 'assistant' | 'status'; text: string }
  | { key: string; role: 'tools'; tools: AgentChatMessage[] };

function groupTurns(messages: AgentChatMessage[]): Turn[] {
  const out: Turn[] = [];
  let toolBuf: AgentChatMessage[] = [];
  const flushTools = () => {
    if (toolBuf.length === 0) return;
    out.push({ key: `tools-${toolBuf[0]!.id}`, role: 'tools', tools: toolBuf });
    toolBuf = [];
  };
  for (const item of messages) {
    if (item.role === 'tool') {
      toolBuf.push(item);
      continue;
    }
    flushTools();
    out.push({ key: `${item.role}-${item.id}`, role: item.role, text: item.text });
  }
  flushTools();
  return out;
}

function formatTime(value: number): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const sameDay = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
  if (sameDay) {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function codeOf(kind: AgentChange['kind']): string {
  if (kind === 'create') return 'A';
  if (kind === 'delete') return 'D';
  return 'M';
}

function relName(filePath: string, cwd: string): string {
  if (cwd && filePath.startsWith(cwd.endsWith('/') ? cwd : cwd + '/')) {
    return filePath.slice(cwd.endsWith('/') ? cwd.length : cwd.length + 1);
  }
  return basename(filePath);
}

function diffStats(diff: string): { plus: number; minus: number } {
  let plus = 0;
  let minus = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) continue;
    if (line.startsWith('+')) plus += 1;
    else if (line.startsWith('-')) minus += 1;
  }
  return { plus, minus };
}
