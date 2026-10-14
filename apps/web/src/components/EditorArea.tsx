import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import type { OnMount } from '@monaco-editor/react';
import type { ViewerKind } from '../files';
import { hasRenderedView, monacoLanguage, basename } from '../files';
import { readEntryDrag, setEntryDrag } from '../dnd';
import { ActionMenu, type MenuItem } from './ContextMenu';
import { MarkdownView } from './viewers/MarkdownView';
import { JsonView, parseJsonSafe } from './viewers/JsonView';
import { JsonlView } from './viewers/JsonlView';
import { CsvView } from './viewers/CsvView';
import { ImageView } from './viewers/ImageView';
import { HtmlView } from './viewers/HtmlView';
import { LogView } from './viewers/LogView';
import { FolderView } from './FolderView';
import { DiffView } from './viewers/DiffView';
import type { Favorite, FsEntry, Repo } from '@remotepad/shared';

export interface OpenTab {
  path: string;
  name: string;
  content: string;
  savedContent: string;
  binary: boolean;
  viewMode: 'rendered' | 'source' | 'icons' | 'details';
  dirty: boolean;
  loading: boolean;
  error?: string;
  kind: ViewerKind;
  diff?: string;
  agentPath?: string;
  temp?: boolean;
  /** Cache-bust token for image reloads (e.g. plot popup rewrite). */
  mediaRev?: number;
}

export function EditorArea({
  tabs,
  activePath,
  onSelect,
  onClose,
  onCloseMany,
  onChange,
  onSave,
  onRevert,
  canRevert,
  onKeepTab,
  onToggleView,
  onRunInTerminal,
  onRevealInTree,
  onAcceptChange,
  onUndoChange,
  listings,
  favorites,
  repos,
  onOpenFile,
  onOpenFolder,
  onOpenFolderNew,
  onCreate,
  onRename,
  onDelete,
  onDeleteMany,
  onTerminal,
  onPin,
  onUnpin,
  onAddRepo,
  onRemoveRepo,
  onLoadDir,
}: {
  tabs: OpenTab[];
  activePath: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onCloseMany: (paths: string[], keepPath: string | null) => void;
  onChange: (path: string, content: string) => void;
  onSave: (path: string) => void;
  onRevert: (path: string) => void;
  canRevert?: (path: string) => boolean;
  onKeepTab: (path: string) => void;
  onToggleView: (path: string, mode: OpenTab['viewMode']) => void;
  onRunInTerminal: (text: string) => void;
  onRevealInTree: (path: string) => void;
  onAcceptChange?: (path: string) => void;
  onUndoChange?: (path: string) => void;
  listings: Record<string, FsEntry[]>;
  favorites: Favorite[];
  repos: Repo[];
  onOpenFile: (entry: FsEntry) => void;
  onOpenFolder: (from: string, to: string) => void;
  onOpenFolderNew: (path: string) => void;
  onCreate: (dir: string, kind: 'file' | 'dir', name: string) => void;
  onRename: (from: string, name: string) => void;
  onDelete: (entry: FsEntry) => void;
  onDeleteMany: (entries: FsEntry[]) => void;
  onTerminal: (dir: string) => void;
  onPin: (path: string) => void;
  onUnpin: (path: string) => void;
  onAddRepo: (path: string) => void;
  onRemoveRepo: (path: string) => void;
  onLoadDir: (dir: string) => void;
}) {
  const tab = tabs.find((item) => item.path === activePath) || null;
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; index: number } | null>(null);
  const [edMenu, setEdMenu] = useState<{ x: number; y: number } | null>(null);
  const [filesOpen, setFilesOpen] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const tabsRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const edRef = useRef<Parameters<OnMount>[0] | null>(null);
  const [viewInfo, setViewInfo] = useState<string | null>(null);

  useEffect(() => {
    setViewInfo(null);
  }, [tab?.path]);

  useLayoutEffect(() => {
    const el = tabsRef.current;
    const measure = measureRef.current;
    if (!el || !measure) return;
    const check = () => setOverflowing(measure.scrollWidth > el.clientWidth + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    window.addEventListener('resize', check);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', check);
    };
  }, [tabs]);

  const menuTab = tabMenu ? tabs[tabMenu.index] : null;
  const revertOk = (path: string, dirty: boolean) => dirty || Boolean(canRevert?.(path));
  const tabMenuItems: MenuItem[] = tabMenu && menuTab ? [
    ...(menuTab.kind !== 'folder' && menuTab.kind !== 'diff'
      ? [{ type: 'item' as const, id: 'reveal', label: 'Reveal in tree', hint: 'Dbl-click' }]
      : []),
    ...(menuTab.temp
      ? [{ type: 'item' as const, id: 'keep', label: 'Keep tab open' }]
      : []),
    ...(hasRenderedView(menuTab.kind)
      ? [{
        type: 'item' as const,
        id: 'source',
        label: menuTab.viewMode === 'source' ? 'Show rendered' : 'Show source',
        hint: 'Ctrl/⌘+L',
      }]
      : []),
    ...(!menuTab.binary && menuTab.kind !== 'diff' && menuTab.kind !== 'folder'
      ? [
        { type: 'item' as const, id: 'save', label: 'Save', hint: 'Ctrl/⌘+S', disabled: !menuTab.dirty },
        { type: 'item' as const, id: 'revert', label: 'Revert', disabled: !revertOk(menuTab.path, menuTab.dirty) },
      ]
      : []),
    ...(menuTab.kind === 'folder'
      ? [{ type: 'item' as const, id: 'refresh', label: 'Refresh' }]
      : []),
    { type: 'sep' },
    { type: 'item', id: 'close', label: 'Close' },
    { type: 'item', id: 'close-left', label: 'Close Left', disabled: tabMenu.index === 0 },
    { type: 'item', id: 'close-right', label: 'Close Right', disabled: tabMenu.index >= tabs.length - 1 },
    { type: 'item', id: 'close-all', label: 'Close All' },
  ] : [];

  return (
    <div className="pane">
      <div className="tabs-bar">
        <div className="tabs" ref={tabsRef}>
          {tabs.map((item, idx) => (
            <div
              key={item.path}
              className={`tab ${item.kind === 'folder' ? 'folder' : ''} ${item.temp ? 'temp' : ''} ${item.dirty ? 'unsaved' : ''} ${item.path === activePath ? 'active' : ''}`}
              title={item.dirty ? `${item.path} · unsaved (Ctrl/⌘+S)` : (item.temp ? 'Temp tab — right-click to keep, or edit the file' : item.path)}
              draggable={item.kind !== 'diff' && !item.agentPath}
              onDragStart={(e) => {
                if (item.kind === 'diff' || item.agentPath) return;
                setEntryDrag(e, {
                  path: item.path,
                  kind: item.kind === 'folder' ? 'dir' : 'file',
                  name: item.name,
                });
              }}
              onClick={() => onSelect(item.path)}
              onDoubleClick={() => onRevealInTree(item.path)}
              onContextMenu={(e) => {
                e.preventDefault();
                setTabMenu({ x: e.clientX, y: e.clientY, index: idx });
              }}
            >
              <span className={item.dirty ? 'dirty' : ''}>{item.dirty ? '● ' : ''}{overflowing ? compactTabName(item.name) : item.name}</span>
              <button className="ghost close" title="Close" aria-label="Close" onClick={(e) => { e.stopPropagation(); onClose(item.path); }} onDoubleClick={(e) => e.stopPropagation()}>×</button>
            </div>
          ))}
        </div>
        <button
          className={`ghost files-toggle ${filesOpen ? 'on' : ''}`}
          onClick={() => setFilesOpen((v) => !v)}
          title={filesOpen ? 'Hide open files' : 'Show open files'}
        >Files</button>
      </div>
      <div ref={measureRef} className="tabs-measure" aria-hidden="true">
        {tabs.map((item) => (
          <div key={item.path} className="tab"><span>{item.name}</span></div>
        ))}
      </div>
      {tabMenu && menuTab && (
        <ActionMenu
          x={tabMenu.x}
          y={tabMenu.y}
          items={tabMenuItems}
          onClose={() => setTabMenu(null)}
          onAction={(id) => {
            const clicked = menuTab;
            const idx = tabMenu.index;
            if (id === 'reveal') onRevealInTree(clicked.path);
            else if (id === 'keep') onKeepTab(clicked.path);
            else if (id === 'source') onToggleView(clicked.path, clicked.viewMode === 'source' ? 'rendered' : 'source');
            else if (id === 'save') onSave(clicked.path);
            else if (id === 'revert') onRevert(clicked.path);
            else if (id === 'refresh') onLoadDir(clicked.path);
            else if (id === 'close') onClose(clicked.path);
            else if (id === 'close-left') onCloseMany(tabs.slice(0, idx).map((t) => t.path), clicked.path);
            else if (id === 'close-right') onCloseMany(tabs.slice(idx + 1).map((t) => t.path), clicked.path);
            else if (id === 'close-all') onCloseMany(tabs.map((t) => t.path), null);
          }}
        />
      )}
      {edMenu && tab && (
        <ActionMenu
          x={edMenu.x}
          y={edMenu.y}
          items={[
            { type: 'item', id: 'run', label: 'Run line / selection in terminal', hint: 'Shift+Enter' },
            { type: 'item', id: 'save', label: 'Save', hint: 'Ctrl/⌘+S', disabled: !tab.dirty },
            { type: 'item', id: 'revert', label: 'Revert', disabled: !revertOk(tab.path, tab.dirty) },
          ]}
          onClose={() => setEdMenu(null)}
          onAction={(id) => {
            if (id === 'run' && edRef.current) {
              const text = textForTerminal(edRef.current);
              if (text) onRunInTerminal(text);
            } else if (id === 'save') onSave(tab.path);
            else if (id === 'revert') onRevert(tab.path);
          }}
        />
      )}
      <div className="editor-main">
        <div className="editor-col">
      {tab && (tab.kind === 'folder' || tab.agentPath) && (
        <div className="editor-toolbar">
          {tab.kind === 'folder' && (
            <>
              <div className="seg">
                <button className={tab.viewMode === 'icons' ? 'active' : ''} onClick={() => onToggleView(tab.path, 'icons')}>Icons</button>
                <button className={tab.viewMode === 'details' ? 'active' : ''} onClick={() => onToggleView(tab.path, 'details')}>Details</button>
              </div>
              {tab.path !== '/' && (
                <button className="ghost" onClick={() => onOpenFolder(tab.path, parentOf(tab.path))}>↑</button>
              )}
              <PathCrumbs path={tab.path} onOpen={(dir) => onOpenFolder(tab.path, dir)} />
              <span className="spacer" />
              <button className="ghost" onClick={() => onTerminal(tab.path)}>Terminal</button>
            </>
          )}
          {tab.agentPath && (
            <>
              <span className="hint">{tab.agentPath}</span>
              <span className="spacer" />
              <button className="primary" onClick={() => onAcceptChange?.(tab.agentPath!)}>Accept</button>
              <button className="danger" onClick={() => onUndoChange?.(tab.agentPath!)}>Undo</button>
            </>
          )}
        </div>
      )}
      <div
        className="editor-body"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          const entry = readEntryDrag(e);
          if (!entry) return;
          e.preventDefault();
          if (entry.kind === 'dir') onOpenFolderNew(entry.path);
          else onOpenFile({ name: basename(entry.path), path: entry.path, kind: 'file' });
        }}
      >
        {!tab && (
          <div className="empty">
            <h2>RemotePad</h2>
            <div>Open a file from the tree.</div>
          </div>
        )}
        {tab?.loading && <div className="empty">Loading…</div>}
        {tab?.error && <div className="empty">{tab.error}</div>}
        {tab && !tab.loading && !tab.error && (
          tab.kind === 'folder'
            ? (
              <FolderView
                dir={tab.path}
                entries={listings[tab.path]}
                view={tab.viewMode === 'details' ? 'details' : 'icons'}
                favorites={favorites}
                repos={repos}
                onOpenFile={onOpenFile}
                onOpenFolder={(path) => onOpenFolder(tab.path, path)}
                onOpenFolderNew={onOpenFolderNew}
                onReveal={() => onRevealInTree(tab.path)}
                onCreate={onCreate}
                onRename={onRename}
                onDelete={onDelete}
                onDeleteMany={onDeleteMany}
                onTerminal={onTerminal}
                onPin={onPin}
                onUnpin={onUnpin}
                onAddRepo={onAddRepo}
                onRemoveRepo={onRemoveRepo}
                onLoad={onLoadDir}
              />
            )
            : tab.viewMode === 'rendered' && hasRenderedView(tab.kind)
            ? <Rendered tab={tab} onInfo={setViewInfo} />
            : tab.kind === 'diff'
              ? <DiffView diff={tab.diff || ''} path={tab.path} />
              : tab.binary
                ? <div className="empty">Binary file — switch to rendered view if this is an image.</div>
                : (
                  <Editor
                    theme="remotepad"
                    language={monacoLanguage(tab.path)}
                    value={tab.content}
                    onChange={(value) => onChange(tab.path, value ?? '')}
                    beforeMount={defineTheme}
                    onMount={(editor, monaco) => {
                      edRef.current = editor;
                      const run = () => {
                        const text = textForTerminal(editor);
                        if (text) onRunInTerminal(text);
                      };
                      editor.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.Enter, run);
                      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, run);
                      const area = editor.getDomNode()?.querySelector('textarea');
                      if (area) {
                        area.setAttribute('spellcheck', 'false');
                        area.setAttribute('autocomplete', 'off');
                      }
                      const node = editor.getDomNode();
                      if (node) {
                        const onMenu = (ev: MouseEvent) => {
                          ev.preventDefault();
                          ev.stopPropagation();
                          setEdMenu({ x: ev.clientX, y: ev.clientY });
                        };
                        node.addEventListener('contextmenu', onMenu);
                        editor.onDidDispose(() => {
                          node.removeEventListener('contextmenu', onMenu);
                          if (edRef.current === editor) edRef.current = null;
                        });
                      }
                    }}
                    options={{
                      fontSize: 13,
                      fontFamily: 'ui-monospace, Menlo, Monaco, Consolas, "Courier New", monospace',
                      minimap: { enabled: false },
                      automaticLayout: true,
                      scrollBeyondLastLine: false,
                      wordWrap: 'on',
                      padding: { top: 8 },
                      contextmenu: false,
                      parameterHints: { enabled: false },
                      quickSuggestions: false,
                      suggestOnTriggerCharacters: false,
                      wordBasedSuggestions: 'off',
                      snippetSuggestions: 'none',
                      acceptSuggestionOnEnter: 'off',
                      occurrencesHighlight: 'off',
                      renderLineHighlight: 'line',
                      selectionHighlight: true,
                    }}
                  />
                )
        )}
      </div>
      {tab && !tab.loading && !tab.error && hasRenderedView(tab.kind) && (
        <div className="editor-status">
          <button
            type="button"
            className={`status-src ${tab.viewMode === 'source' ? 'on' : ''}`}
            title={tab.viewMode === 'source' ? 'Show rendered (Ctrl/⌘+L)' : 'Show source (Ctrl/⌘+L)'}
            onClick={() => onToggleView(tab.path, tab.viewMode === 'source' ? 'rendered' : 'source')}
          >{'</>'}</button>
          <span className="status-info">{viewInfo || ''}</span>
        </div>
      )}
        </div>
        {filesOpen && (
          <aside className="editor-files-col">
            <div className="editor-files-panel-head">Open files</div>
            {tabs.map((item) => (
              <div
                key={item.path}
                className={`editor-files-item ${item.path === activePath ? 'active' : ''}`}
                title={item.path}
                onClick={() => onSelect(item.path)}
              >
                <span className={item.dirty ? 'dirty' : ''}>{item.dirty ? '● ' : ''}{item.name}</span>
              </div>
            ))}
          </aside>
        )}
      </div>
    </div>
  );
}

function Rendered({ tab, onInfo }: { tab: OpenTab; onInfo?: (text: string | null) => void }) {
  if (tab.kind === 'markdown') return <MarkdownView content={tab.content} path={tab.path} />;
  if (tab.kind === 'json') {
    const parsed = parseJsonSafe(tab.content);
    return parsed.ok ? <JsonView value={parsed.value} /> : <div className="empty">{parsed.error}</div>;
  }
  if (tab.kind === 'jsonl') return <JsonlView content={tab.content} />;
  if (tab.kind === 'csv') return <CsvView content={tab.content} path={tab.path} />;
  if (tab.kind === 'image') return <ImageView path={tab.path} bust={tab.mediaRev} onInfo={onInfo} />;
  if (tab.kind === 'html') return <HtmlView path={tab.path} bust={tab.mediaRev} />;
  if (tab.kind === 'log') return <LogView content={tab.content} />;
  return null;
}

function defineTheme(monaco: Parameters<NonNullable<React.ComponentProps<typeof Editor>['beforeMount']>>[0]) {
  monaco.editor.defineTheme('remotepad', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#050608',
      'editor.foreground': '#f7f8fb',
      'editor.lineHighlightBackground': '#1a2744',
      'editor.selectionBackground': '#6b94ff99',
      'editor.inactiveSelectionBackground': '#4d7cff55',
      'editor.selectionHighlightBackground': '#7ee0c540',
      'editor.findMatchBackground': '#e6c07b66',
      'editor.findMatchHighlightBackground': '#e6c07b33',
      'editorCursor.foreground': '#8aead0',
      'editorLineNumber.foreground': '#8b95a6',
      'editorLineNumber.activeForeground': '#f7f8fb',
    },
  });
}

function textForTerminal(ed: Parameters<OnMount>[0]): string {
  const model = ed.getModel();
  const sel = ed.getSelection();
  if (!model || !sel) return '';
  const picked = model.getValueInRange(sel);
  if (picked.length > 0) return picked.endsWith('\n') ? picked : `${picked}\n`;
  return `${model.getLineContent(sel.startLineNumber)}\n`;
}

function parentOf(filePath: string): string {
  const i = filePath.lastIndexOf('/');
  return i <= 0 ? '/' : filePath.slice(0, i);
}

function compactTabName(name: string): string {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  if (stem.length <= 8) return stem;
  return `${stem.slice(0, 4)}…${stem.slice(-4)}`;
}

function PathCrumbs({ path, onOpen }: { path: string; onOpen: (dir: string) => void }) {
  const parts = path === '/' ? [] : path.split('/').filter(Boolean);
  return (
    <span className="folder-path crumbs">
      <button type="button" className="crumb" title="/" onClick={() => onOpen('/')}>/</button>
      {parts.map((part, i) => {
        const dir = '/' + parts.slice(0, i + 1).join('/');
        return (
          <span key={dir} className="crumb-seg">
            {i > 0 && <span className="crumb-sep">/</span>}
            <button type="button" className="crumb" title={dir} onClick={() => onOpen(dir)}>{part}</button>
          </span>
        );
      })}
    </span>
  );
}
