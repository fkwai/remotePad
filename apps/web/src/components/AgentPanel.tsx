import { useEffect, useMemo, useRef, useState } from 'react';
import type { AgentChange, AgentSessionInfo, AgentStatus } from '@remotepad/shared';
import { isHelperSessionId } from '@remotepad/shared';
import { basename } from '../files';
import { readEntryDrag, hasEntryDrag } from '../dnd';
import { ActionMenu, type MenuItem } from './ContextMenu';

export type AgentChatMessage = {
  id: number;
  role: 'user' | 'assistant' | 'tool' | 'status';
  text: string;
  name?: string;
  toolId?: string;
  input?: string;
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
  const pinBottom = useRef(false);
  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [openIds, setOpenIds] = useState<string[]>([]);
  const [chips, setChips] = useState<Record<string, { path: string; name: string }[]>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [sessionMenu, setSessionMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [openTools, setOpenTools] = useState<Set<number>>(new Set());
  const [showJump, setShowJump] = useState(false);
  const busy = state === 'running';
  const helperActive = isHelperSessionId(sessionId);
  const activeId = sessionId ?? '';
  const activeChips = chips[activeId] ?? [];
  const draft = drafts[activeId] ?? '';

  useEffect(() => {
    const node = logRef.current;
    if (!node) return;
    const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
    if (nearBottom || pinBottom.current) {
      node.scrollTop = node.scrollHeight;
      pinBottom.current = false;
    }
    const away = node.scrollHeight - node.scrollTop - node.clientHeight;
    setShowJump(away > node.clientHeight);
  }, [messages]);

  useEffect(() => {
    const node = logRef.current;
    if (!node) return;
    const onScroll = () => {
      const away = node.scrollHeight - node.scrollTop - node.clientHeight;
      setShowJump(away > node.clientHeight);
    };
    onScroll();
    node.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(onScroll);
    ro.observe(node);
    return () => {
      node.removeEventListener('scroll', onScroll);
      ro.disconnect();
    };
  }, []);

  useEffect(() => {
    const known = new Set(sessions.map((item) => item.id));
    setOpenIds((prev) => {
      let next = prev.filter((id) => known.has(id) || id === sessionId);
      if (sessionId && !next.includes(sessionId)) next = [...next, sessionId];
      if (!next.some(isHelperSessionId)) {
        const helper = sessions.filter((item) => isHelperSessionId(item.id))
          .sort((a, b) => b.updatedAt - a.updatedAt)[0];
        if (helper) next = [helper.id, ...next];
      }
      return next.length === prev.length && next.every((id, i) => id === prev[i]) ? prev : next;
    });
  }, [sessions, sessionId]);

  useEffect(() => {
    setOpenTools(new Set());
  }, [sessionId]);

  useEffect(() => {
    const node = logRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [sessionId]);

  const openTabs = useMemo(() => {
    const byId = new Map(sessions.map((item) => [item.id, item]));
    const tabs = openIds
      .map((id) => byId.get(id))
      .filter((item): item is AgentSessionInfo => Boolean(item));
    tabs.sort((a, b) => {
      const ah = isHelperSessionId(a.id) ? 0 : 1;
      const bh = isHelperSessionId(b.id) ? 0 : 1;
      return ah - bh;
    });
    return tabs;
  }, [openIds, sessions]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((item) => `${item.title} ${item.preview}`.toLowerCase().includes(q));
  }, [sessions, query]);

  const turns = useMemo(() => groupTurns(messages), [messages]);

  const allToolIds = useMemo(() => {
    const ids: number[] = [];
    for (const turn of turns) {
      if (turn.role === 'tools') for (const tool of turn.tools) ids.push(tool.id);
    }
    return ids;
  }, [turns]);
  const allToolsOpen = allToolIds.length > 0 && allToolIds.every((id) => openTools.has(id));

  function addChip(path: string, name?: string) {
    const label = name || basename(path);
    setChips((prev) => {
      const cur = prev[activeId] ?? [];
      if (cur.some((item) => item.path === path)) return prev;
      return { ...prev, [activeId]: [...cur, { path, name: label }] };
    });
  }

  function jumpToBottom() {
    const node = logRef.current;
    if (node) node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' });
  }

  function toggleAllTools() {
    setOpenTools(allToolsOpen ? new Set() : new Set(allToolIds));
  }

  function submit() {
    const chipBlock = activeChips.map((item) => item.path).join('\n');
    const body = [chipBlock, draft].filter((part) => part.trim()).join('\n\n');
    if (!body.trim() || busy) return;
    pinBottom.current = true;
    onSend(body);
    setDrafts((prev) => ({ ...prev, [activeId]: '' }));
    setChips((prev) => ({ ...prev, [activeId]: [] }));
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function commitRename() {
    if (!renaming) {
      setRenaming(null);
      return;
    }
    const title = renameValue.trim();
    if (title) onRename(renaming, title);
    setRenaming(null);
  }

  function closeTab(id: string) {
    const remaining = openIds.filter((item) => item !== id);
    setOpenIds(remaining);
    if (id !== sessionId) return;
    const helperTab = remaining.find(isHelperSessionId);
    if (helperTab) {
      onOpen(helperTab);
      return;
    }
    const fallback = remaining.at(-1);
    if (fallback) onOpen(fallback);
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
    { type: 'item', id: 'rename', label: 'Rename' },
    { type: 'sep' },
    { type: 'item', id: 'close', label: 'Close tab' },
  ] : [];
  const historySession = sessionMenu ? sessions.find((item) => item.id === sessionMenu.id) : null;
  const sessionMenuItems: MenuItem[] = sessionMenu && historySession ? [
    { type: 'item', id: 'open-jsonl', label: 'Open session JSONL', disabled: !historySession.historyPath },
    { type: 'item', id: 'rename', label: 'Rename', hint: 'Dbl-click' },
  ] : [];

  return (
    <div className="agent-pane">
      <div className="agent-chrome">
        <div className="agent-tabs">
          {openTabs.map((item) => (
            <div
              key={item.id}
              className={`agent-tab ${item.id === sessionId ? 'active' : ''} ${isHelperSessionId(item.id) ? 'helper' : ''}`}
              onClick={() => { if (item.id !== sessionId) onOpen(item.id); }}
              onContextMenu={(e) => {
                e.preventDefault();
                setTabMenu({ x: e.clientX, y: e.clientY, id: item.id });
              }}
              title={isHelperSessionId(item.id) ? item.title + ' · ' + cwd : item.title}
            >
              <span className="agent-tab-title">{item.title}</span>
              <button
                className="ghost close"
                onClick={(e) => { e.stopPropagation(); closeTab(item.id); }}
              >×</button>
            </div>
          ))}
        </div>
        <button className="ghost agent-chrome-btn" onClick={onNew} title="New Agent — works in the selected repo" aria-label="New Agent">+</button>
        <button
          className={`ghost agent-chrome-btn ${historyOpen ? 'on' : ''}`}
          onClick={() => setHistoryOpen((v) => !v)}
          title="Session history"
          aria-label="Session history"
        >☰</button>
        {allToolIds.length > 0 && (
          <button
            type="button"
            className={`ghost agent-chrome-btn ${allToolsOpen ? 'on' : ''}`}
            onClick={toggleAllTools}
            title={allToolsOpen ? 'Fold all tool calls' : 'Unfold all tool calls'}
            aria-label={allToolsOpen ? 'Fold all tool calls' : 'Unfold all tool calls'}
          >{allToolsOpen ? '▾▾' : '▸▸'}</button>
        )}
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
      {sessionMenu && historySession && (
        <ActionMenu
          x={sessionMenu.x}
          y={sessionMenu.y}
          items={sessionMenuItems}
          onClose={() => setSessionMenu(null)}
          onAction={(id) => {
            if (id === 'open-jsonl') {
              const path = historySession.historyPath;
              if (path) onOpenSessionFile?.(path);
            } else if (id === 'rename') {
              setRenaming(historySession.id);
              setRenameValue(historySession.title);
              setHistoryOpen(true);
            }
          }}
        />
      )}
      <div className="agent-body">
        <div className="agent-main">
      {error && <div className="agent-banner">{error}</div>}
      <div className="agent-log-wrap">
        <div className="agent-log" ref={logRef}>
          {messages.length === 0 && !error && (
            <div className="agent-empty">
              {helperActive
                ? 'Helper edits RemotePad. Chat is scratch; lasting work is git + AGENTS.md. Refresh wipes this chat. + starts a general Agent in the selected repo.'
                : 'General Agent — cwd follows the selected repo (or the file-tree root). + starts another one. Helper stays in its own tab.'}
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
                  const open = openTools.has(tool.id);
                  const print = toolPrint(tool);
                  return (
                    <button
                      type="button"
                      key={tool.id}
                      className={`agent-tool-row ${open ? '' : 'collapsed'}`}
                      onClick={() => {
                        setOpenTools((prev) => {
                          const next = new Set(prev);
                          if (next.has(tool.id)) next.delete(tool.id);
                          else next.add(tool.id);
                          return next;
                        });
                      }}
                    >
                      <span className="agent-tool-chevron">{open ? '▾' : '▸'}</span>
                      <span className="agent-tool-name">{tool.name || 'tool'}</span>
                      {!open && print && <span className="agent-tool-hint">{toolPreview(print)}</span>}
                      {open && (
                        <span className="agent-tool-detail">
                          {print || tool.input || 'No output kept in the session file.'}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
        {busy && <div className="agent-busy">Working…</div>}
      </div>
      {showJump && (
        <button type="button" className="agent-jump" onClick={jumpToBottom} title="Jump to bottom" aria-label="Jump to bottom">↓</button>
      )}
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
        {activeChips.length > 0 && (
          <div className="agent-chips">
            {activeChips.map((chip) => (
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
                    setChips((prev) => {
                      const cur = prev[activeId] ?? [];
                      return { ...prev, [activeId]: cur.filter((item) => item.path !== chip.path) };
                    });
                  }}
                >×</button>
              </a>
            ))}
          </div>
        )}
        <textarea
          ref={inputRef}
          rows={3}
          value={draft}
          onChange={(e) => setDrafts((prev) => ({ ...prev, [activeId]: e.target.value }))}
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
              setChips((prev) => ({ ...prev, [activeId]: [] }));
              onClear();
            }}
            disabled={busy}
            title={helperActive
              ? 'Wipe Helper chat. Lasting work is already in git and AGENTS.md.'
              : "Wipe this Agent session's saved history"}
          >{helperActive ? 'Refresh' : 'Clear'}</button>
          <span className="spacer" />
          {busy
            ? <button className="danger" onClick={onStop}>Stop</button>
            : <button className="primary" onClick={submit}>Send</button>}
        </div>
      </div>
        </div>
        {historyOpen && (
          <aside className="agent-history">
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
                    e.stopPropagation();
                    setRenaming(item.id);
                    setRenameValue(item.title);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setSessionMenu({ x: e.clientX, y: e.clientY, id: item.id });
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
                      <span className="agent-session-title" title={item.id}>
                        <span className="agent-session-kind">{isHelperSessionId(item.id) ? 'Helper' : 'Agent'}</span>
                        {item.title}
                      </span>
                    )}
                    <span className="agent-session-time">{formatTime(item.updatedAt)}</span>
                    <button
                      type="button"
                      className="agent-session-delete"
                      aria-label={`Delete session ${item.title}`}
                      title="Delete session"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm('Delete session ' + item.title + '? This removes its saved history.')) {
                          onDelete(item.id);
                        }
                      }}
                    >
                      <svg viewBox="0 0 16 16" aria-hidden="true">
                        <path fill="currentColor" d="M6.5 1.5h3a.5.5 0 0 1 .5.5v.5H11a.5.5 0 0 1 0 1H5a.5.5 0 0 1 0-1h1V2a.5.5 0 0 1 .5-.5zM3.2 4h9.6l-.72 9.1a1.5 1.5 0 0 1-1.5 1.4H5.42a1.5 1.5 0 0 1-1.5-1.4L3.2 4z" />
                      </svg>
                    </button>
                  </div>
                  {item.preview && item.preview !== item.title && (
                    <div className="agent-session-preview">{item.preview}</div>
                  )}
                </div>
              ))}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

type Turn =
  | { key: string; role: 'user' | 'assistant' | 'status'; text: string }
  | { key: string; role: 'tools'; tools: AgentChatMessage[] };

function isStubbedToolPrint(text: string): boolean {
  return /历史工具结果已省略|历史输出已省略/.test(text);
}

function toolPrint(tool: AgentChatMessage): string {
  const text = tool.text?.trim() ?? '';
  if (!text || isStubbedToolPrint(text)) return '';
  return tool.text;
}

function toolPreview(text: string): string {
  const line = text.split('\n').map((item) => item.trim()).find(Boolean) || 'output';
  return line.length > 72 ? `${line.slice(0, 71)}…` : line;
}

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
