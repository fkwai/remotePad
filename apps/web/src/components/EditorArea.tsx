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
import { DiffView } from './viewers/DiffView';

export interface OpenTab {
  path: string;
  name: string;
  content: string;
  savedContent: string;
  binary: boolean;
  viewMode: 'rendered' | 'source';
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
}: {
  tabs: OpenTab[];
  activePath: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onChange: (path: string, content: string) => void;
  onSave: (path: string) => void;
  onToggleView: (path: string, mode: 'rendered' | 'source') => void;
  onRunInTerminal: (text: string) => void;
}) {
  const tab = tabs.find((item) => item.path === activePath) || null;
  return (
    <div className="pane">
      <div className="tabs">
        {tabs.map((item) => (
          <div
            key={item.path}
            className={`tab ${item.path === activePath ? 'active' : ''}`}
            onClick={() => onSelect(item.path)}
          >
            <span className={item.dirty ? 'dirty' : ''}>{item.dirty ? '● ' : ''}{item.name}</span>
            <button className="ghost close" onClick={(e) => { e.stopPropagation(); onClose(item.path); }}>×</button>
          </div>
        ))}
      </div>
      {tab && (
        <div className="editor-toolbar">
          {hasRenderedView(tab.kind) && (
            <div className="seg">
              <button className={tab.viewMode === 'rendered' ? 'active' : ''} onClick={() => onToggleView(tab.path, 'rendered')}>Rendered</button>
              <button className={tab.viewMode === 'source' ? 'active' : ''} onClick={() => onToggleView(tab.path, 'source')}>Source</button>
            </div>
          )}
          <span>{tab.path}</span>
          <span className="spacer" />
          <span className="hint">Shift+Enter run line</span>
          {!tab.binary && tab.kind !== 'diff' && (
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
          tab.viewMode === 'rendered' && hasRenderedView(tab.kind)
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
                    }}
                    options={{
                      fontSize: 13,
                      fontFamily: 'JetBrains Mono, SF Mono, ui-monospace, monospace',
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
