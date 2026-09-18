import Editor from '@monaco-editor/react';
import type { OnMount } from '@monaco-editor/react';
import type { ViewerKind } from '../files';
import { hasRenderedView, monacoLanguage } from '../files';
import { MarkdownView } from './viewers/MarkdownView';
import { JsonView, parseJsonSafe } from './viewers/JsonView';
import { JsonlView } from './viewers/JsonlView';
import { CsvView } from './viewers/CsvView';
import { ImageView } from './viewers/ImageView';
import { HtmlView } from './viewers/HtmlView';
import { LogView } from './viewers/LogView';
import { FolderView } from './FolderView';
import type { Favorite, FsEntry, Workspace } from '@remotepad/shared';

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
}

export function EditorArea({
  tabs,
  activePath,
  onSelect,
  onClose,
  onChange,
  onSave,
  onToggleView,
  onRunInTerminal,
  onRevealInTree,
  listings,
  favorites,
  workspaces,
  onOpenFile,
  onOpenFolder,
  onCreate,
  onRename,
  onDelete,
  onTerminal,
  onPin,
  onUnpin,
  onAddWorkspace,
  onRemoveWorkspace,
  onLoadDir,
}: {
  tabs: OpenTab[];
  activePath: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onChange: (path: string, content: string) => void;
  onSave: (path: string) => void;
  onToggleView: (path: string, mode: OpenTab['viewMode']) => void;
  onRunInTerminal: (text: string) => void;
  onRevealInTree: (path: string) => void;
  listings: Record<string, FsEntry[]>;
  favorites: Favorite[];
  workspaces: Workspace[];
  onOpenFile: (entry: FsEntry) => void;
  onOpenFolder: (from: string, to: string) => void;
  onCreate: (dir: string, kind: 'file' | 'dir', name: string) => void;
  onRename: (from: string, name: string) => void;
  onDelete: (entry: FsEntry) => void;
  onTerminal: (dir: string) => void;
  onPin: (path: string) => void;
  onUnpin: (path: string) => void;
  onAddWorkspace: (path: string) => void;
  onRemoveWorkspace: (path: string) => void;
  onLoadDir: (dir: string) => void;
}) {
  const tab = tabs.find((item) => item.path === activePath) || null;
  return (
    <div className="pane">
      <div className="tabs">
        {tabs.map((item) => (
          <div
            key={item.kind === 'folder' ? 'explorer' : item.path}
            className={`tab ${item.path === activePath ? 'active' : ''}`}
            onClick={() => onSelect(item.path)}
            onDoubleClick={() => onRevealInTree(item.path)}
          >
            <span className={item.dirty ? 'dirty' : ''}>{item.dirty ? '● ' : ''}{item.name}</span>
            <button className="ghost close" onClick={(e) => { e.stopPropagation(); onClose(item.path); }} onDoubleClick={(e) => e.stopPropagation()}>×</button>
          </div>
        ))}
      </div>
      {tab && (tab.kind === 'folder' || hasRenderedView(tab.kind) || (!tab.binary && tab.kind !== 'diff')) && (
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
          {hasRenderedView(tab.kind) && (
            <div className="seg">
              <button className={tab.viewMode === 'rendered' ? 'active' : ''} onClick={() => onToggleView(tab.path, 'rendered')}>Rendered</button>
              <button className={tab.viewMode === 'source' ? 'active' : ''} onClick={() => onToggleView(tab.path, 'source')}>Source</button>
            </div>
          )}
          {tab.kind !== 'folder' && <span className="spacer" />}
          {!tab.binary && tab.kind !== 'diff' && tab.kind !== 'folder' && (
            <button
              className={`primary save-btn ${tab.dirty ? 'dirty' : ''}`}
              disabled={!tab.dirty}
              onClick={() => onSave(tab.path)}
            >
              {tab.dirty ? 'Save' : 'Saved'}
            </button>
          )}
        </div>
      )}
      <div className="editor-body">
        {!tab && (
          <div className="empty">
            <h2>RemotePad</h2>
            <div>Open a file from the tree. Ctrl+S saves. Shift+Enter runs the line in the terminal.</div>
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
                workspaces={workspaces}
                onOpenFile={onOpenFile}
                onOpenFolder={(path) => onOpenFolder(tab.path, path)}
                onReveal={() => onRevealInTree(tab.path)}
                onCreate={onCreate}
                onRename={onRename}
                onDelete={onDelete}
                onTerminal={onTerminal}
                onPin={onPin}
                onUnpin={onUnpin}
                onAddWorkspace={onAddWorkspace}
                onRemoveWorkspace={onRemoveWorkspace}
                onLoad={onLoadDir}
              />
            )
            : tab.viewMode === 'rendered' && hasRenderedView(tab.kind)
            ? <Rendered tab={tab} />
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
    </div>
  );
}

function Rendered({ tab }: { tab: OpenTab }) {
  if (tab.kind === 'markdown') return <MarkdownView content={tab.content} path={tab.path} />;
  if (tab.kind === 'json') {
    const parsed = parseJsonSafe(tab.content);
    return parsed.ok ? <JsonView value={parsed.value} /> : <div className="empty">{parsed.error}</div>;
  }
  if (tab.kind === 'jsonl') return <JsonlView content={tab.content} />;
  if (tab.kind === 'csv') return <CsvView content={tab.content} path={tab.path} />;
  if (tab.kind === 'image') return <ImageView path={tab.path} />;
  if (tab.kind === 'html') return <HtmlView content={tab.content} />;
  if (tab.kind === 'log') return <LogView content={tab.content} />;
  return null;
}

function defineTheme(monaco: Parameters<NonNullable<React.ComponentProps<typeof Editor>['beforeMount']>>[0]) {
  monaco.editor.defineTheme('remotepad', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#0b0c0f',
      'editor.foreground': '#e8eaef',
      'editor.lineHighlightBackground': '#1a2744',
      'editor.selectionBackground': '#4d7cff88',
      'editor.inactiveSelectionBackground': '#4d7cff44',
      'editor.selectionHighlightBackground': '#7ee0c540',
      'editor.findMatchBackground': '#e6c07b66',
      'editor.findMatchHighlightBackground': '#e6c07b33',
      'editorCursor.foreground': '#7ee0c5',
      'editorLineNumber.foreground': '#5c6474',
      'editorLineNumber.activeForeground': '#cfe0ff',
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
