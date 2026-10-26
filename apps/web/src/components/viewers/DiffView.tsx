import { DiffEditor } from '@monaco-editor/react';
import { monacoLanguage } from '../../files';

type Props = {
  path: string;
  /** Unified patch — used when before/after are missing (e.g. Host git diff). */
  diff?: string;
  /** Original file text (agent change). Empty string = created. */
  before?: string;
  /** New file text (agent change). Empty string = deleted. */
  after?: string;
  /**
   * Called while the reader edits the green side. Present = the review is
   * editable (fix the agent's output in place instead of reopening the file).
   */
  onEdit?: (value: string) => void;
};

/**
 * Cursor-style inline red/green when we have both sides; otherwise colorized unified patch.
 */
export function DiffView({ path, diff = '', before, after, onEdit }: Props) {
  const filePath = path.startsWith('agent:') ? path.slice('agent:'.length)
    : path.startsWith('diff:') ? path.slice('diff:'.length)
    : path;
  const hasSides = before !== undefined && after !== undefined;

  if (hasSides) {
    return (
      <div className="diff-monaco">
        <DiffEditor
          height="100%"
          width="100%"
          theme="remotepad"
          language={monacoLanguage(filePath)}
          original={before}
          modified={after}
          beforeMount={defineTheme}
          onMount={(editor) => {
            if (!onEdit) return;
            // The modified model is the file: every change is the new content.
            editor.getModifiedEditor().onDidChangeModelContent(() => {
              onEdit(editor.getModifiedEditor().getValue());
            });
          }}
          options={{
            readOnly: !onEdit,
            renderSideBySide: false,
            renderIndicators: true,
            renderMarginRevertIcon: false,
            ignoreTrimWhitespace: false,
            originalEditable: false,
            automaticLayout: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize: 13,
            lineNumbers: 'on',
            glyphMargin: false,
            folding: false,
            wordWrap: 'on',
            padding: { top: 8, bottom: 8 },
          }}
        />
      </div>
    );
  }

  if (!diff.trim()) {
    return <div className="empty">No diff for {filePath}</div>;
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

function defineTheme(monaco: Parameters<NonNullable<React.ComponentProps<typeof DiffEditor>['beforeMount']>>[0]) {
  monaco.editor.defineTheme('remotepad', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#050608',
      'editor.foreground': '#f7f8fb',
      'editor.lineHighlightBackground': '#1a2744',
      'editor.selectionBackground': '#6b94ff99',
      'editorLineNumber.foreground': '#8b95a6',
      'editorLineNumber.activeForeground': '#f7f8fb',
      // Low-alpha tints: the text stays the brightest thing on screen, the tint
      // only says which side of the diff you are looking at.
      'diffEditor.insertedTextBackground': '#3fb95055',
      'diffEditor.removedTextBackground': '#f8514955',
      'diffEditor.insertedLineBackground': '#3fb95033',
      'diffEditor.removedLineBackground': '#f8514933',
      'diffEditorGutter.insertedLineBackground': '#3fb95080',
      'diffEditorGutter.removedLineBackground': '#f8514980',
    },
  });
  monaco.editor.setTheme('remotepad');
}
