import {
  forwardRef, useEffect, useImperativeHandle, useRef, useState,
} from 'react';
import {
  copiedSelection, makeRef, refLabel, renderRefBlock, sameClipboardText, type AgentRef,
} from '../agentRefs';

export interface ComposerHandle {
  submit: () => void;
  clear: () => void;
  focus: () => void;
  /** Insert a reference (file, folder or terminal snippet) at the caret. */
  insertRef: (input: { path: string; text?: string; startLine?: number; endLine?: number; lang?: string; kind?: AgentRef['kind'] }) => void;
}

interface Props {
  /** Chat id; changing it empties the editor. */
  sessionKey: string;
  disabled?: boolean;
  placeholder: string;
  /** Receives the wire text: references already expanded to `[file] …` blocks. */
  onSubmit: (wireText: string) => void;
  onChange?: () => void;
}

/**
 * Compose box with real inline reference chips.
 *
 * A textarea can only hold plain text, so a `@file` token never looked like a
 * reference. This is a contenteditable: references are `<span contenteditable=false>`
 * chips (colored, atomic for backspace/arrow keys), and the draft is serialized
 * back to `[file] /abs/path:12-20` + fenced code on send.
 */
export const AgentComposer = forwardRef<ComposerHandle, Props>(function AgentComposer(
  { sessionKey, disabled, placeholder, onSubmit, onChange },
  ref,
) {
  const editorRef = useRef<HTMLDivElement>(null);
  const refsRef = useRef<Map<string, AgentRef>>(new Map());
  const [empty, setEmpty] = useState(true);

  const syncEmpty = () => {
    const el = editorRef.current;
    const blank = !el || !serialize(el, refsRef.current).trim();
    setEmpty(blank);
    onChange?.();
  };

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    el.innerHTML = '';
    refsRef.current = new Map();
    setEmpty(true);
  }, [sessionKey]);

  function caretRange() {
    const el = editorRef.current;
    const sel = window.getSelection();
    if (!el || !sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    return el.contains(range.startContainer) ? range : null;
  }

  function caretAfter(node: Node) {
    const el = editorRef.current;
    if (!el) return;
    const range = document.createRange();
    range.setStartAfter(node);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    el.focus();
  }

  function insertNode(node: Node) {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    const range = caretRange();
    if (!range) {
      el.appendChild(node);
      return;
    }
    range.deleteContents();
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  function insertRef(input: Parameters<ComposerHandle['insertRef']>[0]) {
    const ref = makeRef({
      ...input,
      taken: [...refsRef.current.keys()],
    });
    refsRef.current.set(ref.token, ref);

    const chip = document.createElement('span');
    chip.className = `agent-ref-chip ${ref.kind ?? 'file'}`;
    chip.contentEditable = 'false';
    chip.dataset.ref = ref.token;
    chip.title = ref.path;
    const termLines = ref.kind === 'term' && ref.text ? ref.text.replace(/\n$/, '').split('\n').length : 0;
    chip.textContent = ref.kind === 'term'
      ? `terminal${termLines ? ` · ${termLines} line${termLines === 1 ? '' : 's'}` : ''}`
      : refLabel(ref);

    const space = document.createTextNode('\u00a0');
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    const range = caretRange();
    if (range) {
      range.deleteContents();
      range.insertNode(chip);
    } else {
      el.appendChild(chip);
    }
    chip.after(space);
    const after = document.createRange();
    after.setStart(space, space.length);
    after.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(after);
    syncEmpty();
  }

  function clear() {
    const el = editorRef.current;
    if (el) el.innerHTML = '';
    refsRef.current = new Map();
    setEmpty(true);
    onChange?.();
  }

  function submit() {
    const el = editorRef.current;
    if (!el || disabled) return;
    const wire = serialize(el, refsRef.current);
    if (!wire.trim()) return;
    onSubmit(wire);
    clear();
  }

  useImperativeHandle(ref, () => ({
    submit,
    clear,
    focus: () => editorRef.current?.focus(),
    insertRef,
  }));

  return (
    <div
      className={`agent-compose-editor ${disabled ? 'disabled' : ''}`}
      data-empty={empty ? 'true' : 'false'}
      data-placeholder={placeholder}
      ref={editorRef}
      role="textbox"
      aria-multiline="true"
      aria-label="Message the agent"
      contentEditable={!disabled}
      suppressContentEditableWarning
      onInput={syncEmpty}
      onMouseDown={(e) => {
        const chip = (e.target as HTMLElement).closest?.('.agent-ref-chip');
        if (!chip || !(chip instanceof HTMLElement)) return;
        e.preventDefault();
        // Clicking the box parks the caret after it instead of starting a
        // selection that the next keypress would replace.
        caretAfter(chip);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault();
          submit();
        }
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('application/x-remotepad-entry')) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      onDrop={(e) => {
        const raw = e.dataTransfer.getData('application/x-remotepad-entry');
        if (!raw) return;
        e.preventDefault();
        e.stopPropagation(); // the compose container has its own drop fallback
        try {
          const entry = JSON.parse(raw) as { path: string; kind?: 'file' | 'dir' };
          insertRef({ path: entry.path, kind: entry.kind === 'dir' ? 'dir' : 'file' });
        } catch { /* malformed drag */ }
      }}
      onPaste={(e) => {
        const selection = copiedSelection();
        const text = e.clipboardData.getData('text/plain');
        if (selection && text && sameClipboardText(text, selection.text)) {
          e.preventDefault();
          insertRef(selection);
          return;
        }
        // Plain text only: pasted HTML would bring its own markup into the draft.
        e.preventDefault();
        const plain = text ?? '';
        if (plain) insertNode(document.createTextNode(plain));
        syncEmpty();
      }}
    />
  );
});

/** Flatten the editor into wire text, expanding chips back to `[file]` blocks. */
export function serialize(root: HTMLElement, refs: Map<string, AgentRef>): string {
  let out = '';
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.nodeValue ?? '';
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    const token = node.dataset?.ref;
    if (token) {
      const ref = refs.get(token);
      if (ref) {
        // A reference is a block: keep following text on its own line so the
        // wire parser cannot read prose as part of the path.
        out += renderRefBlock(ref);
        if (!out.endsWith('\n')) out += '\n';
      }
      return;
    }
    if (node.tagName === 'BR') {
      out += '\n';
      return;
    }
    const block = node.tagName === 'DIV' || node.tagName === 'P';
    node.childNodes.forEach(walk);
    if (block && !out.endsWith('\n')) out += '\n';
  };
  root.childNodes.forEach(walk);
  return out.replace(/\u00a0/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
