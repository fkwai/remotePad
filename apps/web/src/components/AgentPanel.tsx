import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  clearCopied, copiedSelection, expandDraft, makeRef, parseWire, type AgentRef,
} from '../agentRefs';
import type { AgentBackend, AgentCatsCoConversation, AgentCatsCoList, AgentChange, AgentSessionInfo, AgentStatus } from '@remotepad/shared';
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
  backend,
  messages,
  changes,
  onSend,
  onStop,
  onSetBackend,
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
  catscoList,
  onCatsCoSelect,
  onCatsCoRefresh,
  onCatsCoCreateProject,
  onCatsCoCreateTask,
  onCatsCoSwitchBot,
  onCatsCoCloseActive,
  switching,
  sessionRepos,
  onRemoveSessionRepo,
  repoSuggestion,
  onAnswerRepoSuggestion,
}: {
  cwd: string;
  error?: string;
  sessionId?: string;
  sessions: AgentSessionInfo[];
  state: AgentStatus;
  backend: AgentBackend;
  messages: AgentChatMessage[];
  changes: AgentChange[];
  onSend: (text: string) => void;
  onStop: () => void;
  onSetBackend: (backend: AgentBackend) => void;
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
  /** CatsCo only: bots / projects / conversations shown in the left list. */
  catscoList?: AgentCatsCoList;
  onCatsCoSelect?: (topicId: string) => void;
  onCatsCoRefresh?: () => void;
  onCatsCoCreateProject?: (name: string) => void;
  onCatsCoCreateTask?: (name: string, projectId?: number) => void;
  onCatsCoSwitchBot?: (botUid: string) => void;
  /** CatsCo only: every conversation tab was closed, so clear the pane. */
  onCatsCoCloseActive?: () => void;
  /** A session/backend switch is in flight; sending now would hit the old session. */
  switching?: boolean;
  /** Repos this conversation is about; empty means not chosen yet. */
  sessionRepos?: string[];
  onRemoveSessionRepo?: (path: string) => void;
  /** A write outside every attached repo, waiting for a yes/no. */
  repoSuggestion?: { path: string; repo: string } | null;
  onAnswerRepoSuggestion?: (accept: boolean) => void;
}) {
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pinBottom = useRef(false);
  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [openIds, setOpenIds] = useState<string[]>([]);
  /** CatsCo conversations open as tabs (the server only tracks one active topic). */
  const [catscoTabs, setCatscoTabs] = useState<string[]>([]);
  /** True after the reader closes the last CatsCo tab: stay closed until they pick one. */
  const catscoClosedAll = useRef(false);
  /** Stick to the newest message until the reader scrolls up. Starts true so the
   *  first history load (local or CatsCo) lands at the bottom, not at the top. */
  const stick = useRef(true);
  const [refs, setRefs] = useState<Record<string, AgentRef[]>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [sessionMenu, setSessionMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [openTools, setOpenTools] = useState<Set<number>>(new Set());
  /** Collapsed step groups: a tool run shows one line until the reader expands it. */
  const [openSteps, setOpenSteps] = useState<Set<string>>(new Set());
  const [showJump, setShowJump] = useState(false);
  const [catscoOpen, setCatscoOpen] = useState(false);
  const [newProject, setNewProject] = useState('');
  const [collapsedProjects, setCollapsedProjects] = useState<Set<number>>(new Set());
  const catsco = backend === 'catsco';
  /** Cloud task state for the open conversation: starts outside this panel too. */
  const activeConversation = catsco
    ? (catscoList?.conversations ?? []).find((item) => item.id === catscoList?.topicId)
    : undefined;
  const busy = state === 'running' || Boolean(activeConversation?.working) || Boolean(switching);
  const activeId = sessionId ?? '';
  const activeRefs = refs[activeId] ?? [];
  const draft = drafts[activeId] ?? '';
  const catscoBots = catscoList?.bots ?? [];
  const catscoProjects = catscoList?.projects ?? [];
  const catscoBotName = (catscoList?.bots ?? []).find((item) => item.isCurrent)?.name || 'CatsCo';
  const catscoConversations = useMemo(() => {
    const list = [...(catscoList?.conversations ?? [])];
    list.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    return list;
  }, [catscoList]);
  const catscoByProject = useMemo(() => {
    const map = new Map<number, AgentCatsCoConversation[]>();
    for (const item of catscoConversations) {
      if (!item.projectId) continue;
      const bucket = map.get(item.projectId) ?? [];
      bucket.push(item);
      map.set(item.projectId, bucket);
    }
    return map;
  }, [catscoConversations]);
  // A conversation whose project is missing from /projects must still show up,
  // so anything orphaned falls through to the loose chat list instead of vanishing.
  const catscoLoose = catscoConversations.filter(
    (item) => !item.projectId || !catscoProjects.some((project) => project.id === item.projectId),
  );

  useEffect(() => {
    // Both side panels start closed; the ☰ button opens them on demand.
    setHistoryOpen(false);
    setCatscoOpen(false);
  }, [catsco]);

  // A page that loads while CatsCo is already active can miss the first list
  // (socket not yet subscribed, or an aborted request). Re-ask a couple of times
  // instead of leaving the panel on "Loading…" forever.
  const resetCatsCoRef = useRef(onCatsCoRefresh);
  resetCatsCoRef.current = onCatsCoRefresh;

  useEffect(() => {
    if (!catsco || catscoList) return;
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      resetCatsCoRef.current?.();
      if (tries >= 3) clearInterval(timer);
    }, 2500);
    return () => clearInterval(timer);
  }, [catsco, catscoList]);

  useEffect(() => {
    const node = logRef.current;
    if (!node) return;
    const away = node.scrollHeight - node.scrollTop - node.clientHeight;
    if (stick.current || pinBottom.current || away < 80) {
      node.scrollTop = node.scrollHeight;
      stick.current = true;
    }
    pinBottom.current = false;
    const after = node.scrollHeight - node.scrollTop - node.clientHeight;
    setShowJump(after > node.clientHeight);
  }, [messages]);

  useEffect(() => {
    const node = logRef.current;
    if (!node) return;
    // Content growth (new turn, streamed text, swapped history) also fires
    // scroll/Resize events. Treating those as "the reader scrolled up" silently
    // stopped the pane from following new messages, so only deliberate input
    // may detach the stick.
    let gestureAt = 0;
    const gesture = () => { gestureAt = performance.now(); };
    const onScroll = () => {
      const away = node.scrollHeight - node.scrollTop - node.clientHeight;
      if (away < 80) stick.current = true;
      else if (performance.now() - gestureAt < 600) stick.current = false;
      setShowJump(away > node.clientHeight);
    };
    const mo = new MutationObserver(() => {
      if (stick.current) node.scrollTop = node.scrollHeight;
      onScroll();
    });
    mo.observe(node, { childList: true, subtree: true, characterData: true });
    node.addEventListener('scroll', onScroll, { passive: true });
    node.addEventListener('wheel', gesture, { passive: true });
    node.addEventListener('touchmove', gesture, { passive: true });
    node.addEventListener('keydown', gesture);
    onScroll();
    return () => {
      mo.disconnect();
      node.removeEventListener('scroll', onScroll);
      node.removeEventListener('wheel', gesture);
      node.removeEventListener('touchmove', gesture);
      node.removeEventListener('keydown', gesture);
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

  /** Anything that swaps the whole transcript: backend, local session, CatsCo topic. */
  const transcriptKey = catsco ? `catsco:${catscoList?.topicId ?? ''}` : `local:${sessionId ?? ''}`;

  useEffect(() => {
    const node = logRef.current;
    if (!node) return;
    stick.current = true;
    node.scrollTop = node.scrollHeight;
    setShowJump(false);
    setOpenSteps(new Set());
  }, [transcriptKey]);

  // Keep the active CatsCo conversation present as a tab, unless the reader just
  // closed everything (the server keeps polling the topic, so an unguarded
  // effect would immediately reopen the tab they closed).
  useEffect(() => {
    const active = catscoList?.topicId;
    if (!catsco || !active || catscoClosedAll.current) return;
    setCatscoTabs((prev) => (prev.includes(active) ? prev : [...prev, active]));
  }, [catsco, catscoList?.topicId]);

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

  const catscoTabInfo = useMemo(
    () => catscoTabs.map((id) => {
      const found = catscoConversations.find((item) => item.id === id);
      return { id, title: found?.title || (id === catscoList?.topicId ? 'CatsCo cloud' : id) };
    }),
    [catscoTabs, catscoConversations, catscoList?.topicId],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((item) => `${item.title} ${item.preview}`.toLowerCase().includes(q));
  }, [sessions, query]);

  // No CatsCo tab open = an empty pane, even if the cloud poll still has a topic.
  const turns = useMemo(
    () => (catsco && catscoTabs.length === 0 ? [] : groupTurns(messages)),
    [catsco, catscoTabs, messages],
  );
  /** Steps belong to the turn that started after the last user message. */
  const lastUserIdx = turns.reduce((acc, t, i) => (t.role === 'user' ? i : acc), -1);
  const lastIsTool = messages.length > 0 && messages[messages.length - 1]!.role === 'tool';
  /** Hide "… is writing" once the closing assistant message is already on screen. */
  const lastIsAnswer = messages.length > 0 && messages[messages.length - 1]!.role === 'assistant';
  const showTyping = busy && !lastIsAnswer;

  const allToolIds = useMemo(() => {
    const ids: number[] = [];
    for (const turn of turns) {
      if (turn.role === 'tools') for (const tool of turn.tools) ids.push(tool.id);
    }
    return ids;
  }, [turns]);
  const allToolsOpen = allToolIds.length > 0 && allToolIds.every((id) => openTools.has(id));

  function jumpToBottom() {
    const node = logRef.current;
    if (node) node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' });
  }

  function toggleAllTools() {
    setOpenTools(allToolsOpen ? new Set() : new Set(allToolIds));
  }

  function submit() {
    const body = expandDraft(draft, activeRefs);
    if (!body.trim() || busy) return;
    pinBottom.current = true;
    onSend(body);
    setDrafts((prev) => ({ ...prev, [activeId]: '' }));
    setRefs((prev) => ({ ...prev, [activeId]: [] }));
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  /** Insert a token at the caret so the draft reads like prose. */
  function insertToken(token: string) {
    const el = inputRef.current;
    const cur = draft;
    const start = el?.selectionStart ?? cur.length;
    const end = el?.selectionEnd ?? cur.length;
    const before = cur.slice(0, start);
    const after = cur.slice(end);
    const lead = before && !/\s$/.test(before) ? ' ' : '';
    const next = `${before}${lead}@${token} ${after}`;
    setDrafts((prev) => ({ ...prev, [activeId]: next }));
    const caret = (before + lead + '@' + token + ' ').length;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  }

  function addRef(input: { path: string; text?: string; startLine?: number; endLine?: number; lang?: string; kind?: 'file' | 'dir' }) {
    const ref = makeRef({ ...input, taken: activeRefs.map((item) => item.token) });
    setRefs((prev) => ({ ...prev, [activeId]: [...(prev[activeId] ?? []), ref] }));
    insertToken(ref.token);
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

  function catscoNewTask(projectId?: number) {
    const name = window.prompt(projectId ? 'New task name' : 'New CatsCo session name');
    const clean = name?.trim();
    if (clean) onCatsCoCreateTask?.(clean, projectId);
  }

  function toggleProject(id: number) {
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function renderConversation(item: AgentCatsCoConversation) {
    return (
      <div
        key={item.id}
        className={`agent-session agent-catsco-session ${item.id === catscoList?.topicId ? 'active' : ''}`}
        onClick={() => {
          catscoClosedAll.current = false;
          setCatscoTabs((prev) => (prev.includes(item.id) ? prev : [...prev, item.id]));
          onCatsCoSelect?.(item.id);
          // Same as a local session row: the pick is done, so get out of the way.
          setCatscoOpen(false);
        }}
        title={item.id}
      >
        <div className="agent-session-row">
          <span className="agent-session-title">
            <span className="agent-session-kind">{item.isGroup ? 'Group' : item.isTask ? 'Task' : 'Chat'}</span>
            {item.title}
          </span>
          <span className="agent-session-time">{item.updatedAt ? formatTime(item.updatedAt) : ''}</span>
        </div>
        {item.preview && <div className="agent-session-preview">{item.preview}</div>}
      </div>
    );
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

  /** Close one CatsCo tab; switching away reloads that topic's history from cloud. */
  function closeCatscoTab(id: string) {
    const remaining = catscoTabs.filter((item) => item !== id);
    setCatscoTabs(remaining);
    if (id !== catscoList?.topicId) return;
    const next = remaining[remaining.length - 1];
    if (next) {
      catscoClosedAll.current = false;
      onCatsCoSelect?.(next);
      return;
    }
    // Last tab gone: stay empty instead of letting the CatsCo poll reopen it.
    catscoClosedAll.current = true;
    onCatsCoCloseActive?.();
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
      <div className="agent-backend">
        <div className="seg">
          <button
            type="button"
            className={!catsco ? 'active' : ''}
            onClick={() => onSetBackend('local')}
            title="Local XiaoBa runtime on this machine"
          >Local</button>
          <button
            type="button"
            className={catsco ? 'active' : ''}
            onClick={() => onSetBackend('catsco')}
            title="CatsCo cloud employee via the desktop connector"
          >CatsCo</button>
        </div>
        <span className="agent-backend-hint">
          {catsco ? 'Cloud employee · same chat as app.catsco.cc' : 'Local runtime · selected repo'}
        </span>
        {(sessionRepos?.length ?? 0) > 0 && (
          <div className="agent-repos">
            {sessionRepos!.map((repo) => (
              <span className="agent-repo-chip" key={repo} title={repo}>
                {repo.split('/').filter(Boolean).pop() || repo}
                <button
                  className="ghost"
                  onClick={() => onRemoveSessionRepo?.(repo)}
                  title={`Detach ${repo}`}
                >×</button>
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="agent-chrome">
        <div className="agent-tabs">
          {!catsco && openTabs.map((item) => (
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
          {catsco && catscoTabInfo.map((item) => (
            <div
              key={item.id}
              className={`agent-tab catsco ${item.id === catscoList?.topicId ? 'active' : ''}`}
              onClick={() => {
                if (item.id === catscoList?.topicId) return;
                catscoClosedAll.current = false;
                onCatsCoSelect?.(item.id);
              }}
              title={item.id}
            >
              <span className="agent-tab-title">{item.title}</span>
              <button
                className="ghost close"
                onClick={(e) => { e.stopPropagation(); closeCatscoTab(item.id); }}
              >×</button>
            </div>
          ))}
        </div>
        <button
          className="ghost agent-chrome-btn"
          onClick={() => {
            if (catsco) {
              catscoClosedAll.current = false;
              catscoNewTask();
            } else {
              onNew();
            }
          }}
          title={catsco ? 'New CatsCo session' : 'New Agent — works in the selected repo'}
          aria-label={catsco ? 'New CatsCo session' : 'New Agent'}
        >+</button>
        <button
          className={`ghost agent-chrome-btn ${(catsco ? catscoOpen : historyOpen) ? 'on' : ''}`}
          onClick={() => (catsco ? setCatscoOpen((v) => !v) : setHistoryOpen((v) => !v))}
          title={catsco ? 'Projects & sessions' : 'Session history'}
          aria-label={catsco ? 'Projects & sessions' : 'Session history'}
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
          {turns.length === 0 && !error && (
            <div className="agent-empty">
              {catsco
                ? 'CatsCo cloud — messages go to your cloud employee (same chat as app.catsco.cc). History lives on CatsCo; switch Local anytime.'
                : 'Local Agent — cwd follows the selected repo (or the file-tree root). + starts another session.'}
            </div>
          )}
        {turns.map((turn, iTurn) => (
          <div key={turn.key} className={`agent-turn ${turn.role}`}>
            {turn.role === 'user' && (
              <div className="agent-msg user">
                <div className="agent-msg-role">You</div>
                <div className="agent-msg-body">
                  {parseWire(turn.text).map((part, i) => (
                    part.kind === 'text'
                      ? <span key={i} className="agent-msg-text">{part.text}</span>
                      : (
                        <span key={i} className="agent-ref-wrap">
                          <span className="agent-ref" title={part.path}>{part.dir ? '/' : ''}{part.label}</span>
                          {part.code !== undefined && (
                            <details className="agent-ref-code">
                              <summary>{part.code.split('\n').length} lines</summary>
                              <pre>{part.code}</pre>
                            </details>
                          )}
                        </span>
                      )
                  ))}
                </div>
              </div>
            )}
            {turn.role === 'assistant' && (
              <div className="agent-msg assistant">
                <div className="agent-msg-role">{catsco ? 'CatsCo' : 'Agent'}</div>
                <div className="agent-msg-body agent-md">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{turn.text}</ReactMarkdown>
                </div>
              </div>
            )}
            {turn.role === 'status' && (
              <div className="agent-msg status">
                <div className="agent-msg-body">{turn.text}</div>
              </div>
            )}
            {turn.role === 'tools' && (() => {
              const open = openSteps.has(turn.key);
              const count = turn.tools.length;
              const current = turn.tools[count - 1];
              // Only the group opened by this send is "executing"; the previous
              // round's count must not carry over into the new turn.
              const live = busy && iTurn === turns.length - 1 && iTurn > lastUserIdx;
              return (
                <div className={`agent-steps ${open ? 'open' : ''}`}>
                  <button
                    type="button"
                    className="agent-steps-head"
                    onClick={() => {
                      setOpenSteps((prev) => {
                        const next = new Set(prev);
                        if (next.has(turn.key)) next.delete(turn.key);
                        else next.add(turn.key);
                        return next;
                      });
                    }}
                    title={open ? 'Hide steps' : 'Show steps'}
                  >
                    <span className="agent-tool-chevron">{open ? '▾' : '▸'}</span>
                    <span className="agent-steps-label">
                      {live
                        ? `Executing · step ${count} · ${current?.name || 'tool'}`
                        : (count === 1 ? '1 step' : `${count} steps`)}
                    </span>
                  </button>
                  {open && (
                    <div className="agent-tool-block">
                      {turn.tools.map((tool) => {
                        const rowOpen = openTools.has(tool.id);
                        const print = toolPrint(tool);
                        return (
                          <button
                            type="button"
                            key={tool.id}
                            className={`agent-tool-row ${rowOpen ? '' : 'collapsed'}`}
                            onClick={() => {
                              setOpenTools((prev) => {
                                const next = new Set(prev);
                                if (next.has(tool.id)) next.delete(tool.id);
                                else next.add(tool.id);
                                return next;
                              });
                            }}
                          >
                            <span className="agent-tool-chevron">{rowOpen ? '▾' : '▸'}</span>
                            <span className="agent-tool-name">{tool.name || 'tool'}</span>
                            {!rowOpen && print && <span className="agent-tool-hint">{toolPreview(print)}</span>}
                            {rowOpen && (
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
              );
            })()}
          </div>
        ))}
        {showTyping && (
          <div className="agent-typing">
            <span className="agent-typing-label">
              {catsco
                ? `${catscoBotName} is ${lastIsTool ? 'working' : 'writing'}`
                : (lastIsTool ? 'Agent is working' : 'Agent is writing')}
            </span>
            <span className="agent-dots"><i /><i /><i /></span>
          </div>
        )}
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
      {repoSuggestion && (
        <div className="agent-repo-card">
          <div className="agent-repo-card-text">
            This write is outside the session's repos:
            <code>{repoSuggestion.repo}</code>
          </div>
          <div className="agent-repo-card-actions">
            <button className="primary" onClick={() => onAnswerRepoSuggestion?.(true)}>Add repo</button>
            <button className="ghost" onClick={() => onAnswerRepoSuggestion?.(false)}>No</button>
          </div>
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
          // Inline token, not a chip row: the path lands where the caret is and
          // is expanded to the absolute path only on send.
          addRef({ path: entry.path, kind: entry.kind });
        }}
      >
        <textarea
          ref={inputRef}
          rows={3}
          value={draft}
          onChange={(e) => setDrafts((prev) => ({ ...prev, [activeId]: e.target.value }))}
          disabled={busy}
          placeholder={
            switching
              ? 'Switching session…'
              : busy
              ? (catsco ? `${catscoBotName} is working… wait for the answer` : 'Agent is working… (Enter queues after stop)')
              : catsco ? 'Message CatsCo cloud · drop files or paste a selection' : 'Message local XiaoBa · drop files or paste a selection'
          }
          onDragOver={(e) => {
            if (hasEntryDrag(e)) e.preventDefault();
          }}
          onDrop={(e) => {
            const entry = readEntryDrag(e);
            if (!entry) return;
            e.preventDefault();
            addRef({ path: entry.path, kind: entry.kind });
          }}
          onPaste={(e) => {
            const selection = copiedSelection();
            const text = e.clipboardData.getData('text/plain');
            if (!selection || !text) return;
            if (text.replace(/\n$/, '') !== selection.text.replace(/\n$/, '')) return;
            e.preventDefault();
            addRef(selection);
            clearCopied();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="agent-compose-row">
          {!catsco && (
          <button
            className="ghost"
            onClick={() => {
              setRefs((prev) => ({ ...prev, [activeId]: [] }));
              onClear();
            }}
            disabled={busy}
            title="Wipe this Agent session's saved history"
          >Clear</button>
          )}
          <span className="spacer" />
          {busy
            // Stop now reaches the cloud too, so it stays available for a run
            // started from the app or another device.
            ? <button className="danger" onClick={onStop}>Stop</button>
            : <button className="primary" onClick={submit}>Send</button>}
        </div>
      </div>
        </div>
        {catscoOpen && catsco && (
          <aside className="agent-history agent-catsco">
            <div className="agent-history-head">
              <span>Workspace</span>
              <span className="spacer" />
              <button className="ghost" title="Refresh" aria-label="Refresh" onClick={() => onCatsCoRefresh?.()}>⟳</button>
              <button className="ghost" onClick={() => setCatscoOpen(false)}>×</button>
            </div>
            <div className="agent-catsco-scroll">
              {catscoList?.error && <div className="agent-catsco-error">{catscoList.error}</div>}
              {!catscoList && <div className="agent-session-empty">Loading…</div>}
              {catscoList && (
                <>
              <div className="agent-catsco-label">Bots</div>
              {catscoBots.map((bot) => (
                <div
                  key={bot.uid}
                  className={`agent-catsco-row ${bot.isCurrent ? 'active' : ''}`}
                  onClick={() => {
                    if (bot.isCurrent) return;
                    const ok = window.confirm(
                      `Switch the local connector to "${bot.name}"? This machine's tools move to that bot and the current chat may pause for a moment.`,
                    );
                    if (ok) onCatsCoSwitchBot?.(bot.uid);
                  }}
                  title={bot.uid}
                >
                  <span className="agent-catsco-dot" />
                  <span className="agent-catsco-name">{bot.name}</span>
                </div>
              ))}
              {catscoBots.length === 0 && <div className="agent-session-empty">No bots</div>}

              <div className="agent-catsco-label">Projects</div>
              <form
                className="agent-catsco-new"
                onSubmit={(e) => {
                  e.preventDefault();
                  const name = newProject.trim();
                  if (!name) return;
                  onCatsCoCreateProject?.(name);
                  setNewProject('');
                }}
              >
                <input
                  value={newProject}
                  placeholder="New project"
                  onChange={(e) => setNewProject(e.target.value)}
                />
                <button className="ghost" type="submit" title="Create project" aria-label="Create project">+</button>
              </form>
              {catscoProjects.map((project) => {
                const items = catscoByProject.get(project.id) ?? [];
                const collapsed = collapsedProjects.has(project.id);
                return (
                  <div key={project.id} className="agent-catsco-project">
                    <div className="agent-catsco-project-head" onClick={() => toggleProject(project.id)}>
                      <span className="agent-catsco-caret">{collapsed ? '▸' : '▾'}</span>
                      <span className="agent-catsco-name">{project.name}</span>
                      <button
                        className="ghost"
                        title="New task in project"
                        aria-label={`New task in ${project.name}`}
                        onClick={(e) => { e.stopPropagation(); catscoNewTask(project.id); }}
                      >+</button>
                    </div>
                    {!collapsed && items.map(renderConversation)}
                    {!collapsed && items.length === 0 && <div className="agent-session-empty">No sessions</div>}
                  </div>
                );
              })}
              {catscoProjects.length === 0 && <div className="agent-session-empty">No projects yet</div>}

              <div className="agent-catsco-label">Chats</div>
              {catscoLoose.map(renderConversation)}
              {catscoLoose.length === 0 && <div className="agent-session-empty">No chats</div>}
                </>
              )}
            </div>
          </aside>
        )}
        {historyOpen && !catsco && (
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
