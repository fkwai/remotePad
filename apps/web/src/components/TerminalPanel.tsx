import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import type { TermPlotInfo, TermSessionInfo } from '@remotepad/shared';
import { readEntryDrag } from '../dnd';
import { ActionMenu, type MenuItem } from './ContextMenu';
import { basename } from '../files';

export function TerminalPanel({
  sessions,
  activeId,
  plots,
  onSelect,
  onCreate,
  onRename,
  onClose,
  onInput,
  onResize,
  onOpenPlot,
  onDataRef,
}: {
  sessions: TermSessionInfo[];
  activeId: string | null;
  plots: TermPlotInfo[];
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, name: string) => void;
  onClose: (id: string) => void;
  onInput: (id: string, data: string) => void;
  onResize: (id: string, cols: number, rows: number) => void;
  onOpenPlot: (path: string) => void;
  onDataRef: React.MutableRefObject<(id: string, data: string) => void>;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terms = useRef(new Map<string, { term: Terminal; fit: FitAddon; el: HTMLDivElement }>());
  const activeRef = useRef(activeId);
  const onInputRef = useRef(onInput);
  const onResizeRef = useRef(onResize);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  activeRef.current = activeId;
  onInputRef.current = onInput;
  onResizeRef.current = onResize;

  const activePlots = plots
    .filter((item) => item.termId === activeId)
    .slice()
    .sort((a, b) => b.at - a.at);

  useEffect(() => {
    onDataRef.current = (id, data) => {
      terms.current.get(id)?.term.write(data);
    };
  }, [onDataRef]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    for (const session of sessions) {
      if (terms.current.has(session.id)) continue;
      const el = document.createElement('div');
      el.style.display = 'none';
      el.style.height = '100%';
      host.appendChild(el);
      const term = new Terminal({
        fontSize: 13,
        fontFamily: 'ui-monospace, Menlo, Monaco, Consolas, Courier New, monospace',
        theme: {
          background: '#0b0c0f',
          foreground: '#e8eaef',
          cursor: '#7ee0c5',
          selectionBackground: '#4d7cff88',
          selectionInactiveBackground: '#4d7cff44',
        },
        cursorBlink: true,
        rightClickSelectsWord: false,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.loadAddon(new WebLinksAddon());
      term.open(el);
      term.attachCustomKeyEventHandler((ev) => {
        if (ev.type !== 'keydown') return true;
        const mod = ev.ctrlKey || ev.metaKey;
        const key = ev.key.toLowerCase();
        if (mod && key === 'c' && term.hasSelection()) {
          void writeClipboard(term.getSelection());
          return false;
        }
        if (mod && ev.shiftKey && key === 'c') {
          void writeClipboard(term.getSelection());
          return false;
        }
        if (key === 'insert' && mod && !ev.shiftKey && term.hasSelection()) {
          void writeClipboard(term.getSelection());
          return false;
        }
        return true;
      });
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (term.hasSelection()) {
          void writeClipboard(term.getSelection());
          return;
        }
        void readClipboard().then((text) => {
          if (text) onInputRef.current(session.id, text);
        });
      });
      term.onData((data) => onInputRef.current(session.id, data));
      terms.current.set(session.id, { term, fit, el });
    }

    for (const [id, item] of terms.current) {
      if (!sessions.some((session) => session.id === id)) {
        item.term.dispose();
        item.el.remove();
        terms.current.delete(id);
      }
    }
  }, [sessions]);

  useEffect(() => {
    for (const [id, item] of terms.current) {
      const show = id === activeId;
      item.el.style.display = show ? 'block' : 'none';
      if (show) {
        item.fit.fit();
        item.term.focus();
        onResizeRef.current(id, item.term.cols, item.term.rows);
      }
    }
  }, [activeId, sessions, activePlots.length]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const obs = new ResizeObserver(() => {
      const id = activeRef.current;
      if (!id) return;
      const item = terms.current.get(id);
      if (!item) return;
      item.fit.fit();
      onResizeRef.current(id, item.term.cols, item.term.rows);
    });
    obs.observe(host);
    return () => obs.disconnect();
  }, []);

  return (
    <div className="pane">
      <div className="term-bar">
        {sessions.map((session) => (
          <div
            key={session.id}
            className={`term-tab ${session.id === activeId ? 'active' : ''} ${session.alive ? '' : 'dead'}`}
            onClick={() => onSelect(session.id)}
            onDoubleClick={() => {
              setRenaming(session.id);
              setRenameValue(session.name);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onSelect(session.id);
              setTabMenu({ x: e.clientX, y: e.clientY, id: session.id });
            }}
          >
            <span className={`status-dot ${session.alive ? '' : 'off'}`} />
            {renaming === session.id ? (
              <input
                autoFocus
                autoComplete="off"
                spellCheck={false}
                value={renameValue}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (renameValue.trim()) onRename(session.id, renameValue.trim());
                    setRenaming(null);
                  }
                  if (e.key === 'Escape') setRenaming(null);
                }}
                onBlur={() => {
                  if (renameValue.trim()) onRename(session.id, renameValue.trim());
                  setRenaming(null);
                }}
              />
            ) : session.name}
            <button className="ghost close" onClick={(e) => { e.stopPropagation(); onClose(session.id); }}>×</button>
          </div>
        ))}
        <button className="ghost" onClick={onCreate}>+ Terminal</button>
      </div>
      {tabMenu && (
        <ActionMenu
          x={tabMenu.x}
          y={tabMenu.y}
          items={[
            { type: 'item', id: 'rename', label: 'Rename', hint: 'Dbl-click' },
            { type: 'item', id: 'close', label: 'Close', danger: true },
          ] satisfies MenuItem[]}
          onClose={() => setTabMenu(null)}
          onAction={(id) => {
            if (id === 'rename') {
              const session = sessions.find((item) => item.id === tabMenu.id);
              setRenaming(tabMenu.id);
              setRenameValue(session?.name || '');
            } else if (id === 'close') onClose(tabMenu.id);
          }}
        />
      )}
      <div className="term-split">
        <div
          className="term-body"
          ref={hostRef}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            const entry = readEntryDrag(e);
            if (!entry) return;
            e.preventDefault();
            const id = activeRef.current;
            if (id) onInputRef.current(id, entry.path);
          }}
        />
        <aside className={`term-plots ${activePlots.length ? '' : 'empty'}`}>
          <div className="term-plots-head">Plots</div>
          {activePlots.length === 0 ? (
            <div className="term-plots-empty">fig.show() plots from this terminal appear here</div>
          ) : (
            <div className="term-plots-list">
              {activePlots.map((plot) => (
                <button
                  type="button"
                  key={plot.path}
                  className="term-plot"
                  title={plot.path}
                  onClick={() => onOpenPlot(plot.path)}
                >
                  <span className="term-plot-title">{plot.title || basename(plot.path)}</span>
                  <span className="term-plot-time">{formatTime(plot.at)}</span>
                </button>
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function formatTime(value: number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
}

async function writeClipboard(text: string) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

async function readClipboard(): Promise<string> {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return '';
  }
}
