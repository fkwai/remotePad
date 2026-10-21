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
};

/**
 * Cursor-style inline red/green when we have both sides; otherwise colorized unified patch.
 */
export function DiffView({ path, diff = '', before, after }: Props) {
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
          options={{
            readOnly: true,
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
      'diffEditor.insertedTextBackground': '#1b7a40cc',
      'diffEditor.removedTextBackground': '#a82838cc',
      'diffEditor.insertedLineBackground': '#1b7a40aa',
      'diffEditor.removedLineBackground': '#a82838aa',
      'diffEditorGutter.insertedLineBackground': '#1b7a40',
      'diffEditorGutter.removedLineBackground': '#a82838',
    },
  });
  monaco.editor.setTheme('remotepad');
}
