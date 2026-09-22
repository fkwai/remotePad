import { useLayoutEffect, useRef, useState } from 'react';
import type { FsEntry } from '@remotepad/shared';

export interface MenuState {
  x: number;
  y: number;
  entry: FsEntry;
}

export type MenuItem =
  | { type: 'sep' }
  | {
    type: 'item';
    id: string;
    label: string;
    /** Shown on the right so users learn the gesture / hotkey. */
    hint?: string;
    danger?: boolean;
    disabled?: boolean;
  };

/** Generic right-click menu: label + optional hotkey/gesture hint. */
export function ActionMenu({
  x,
  y,
  items,
  onAction,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onAction: (id: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const margin = 8;
    const rect = node.getBoundingClientRect();
    let left = x;
    let top = y;
    if (top + rect.height + margin > window.innerHeight) {
      top = Math.max(margin, y - rect.height);
    }
    if (left + rect.width + margin > window.innerWidth) {
      left = Math.max(margin, window.innerWidth - rect.width - margin);
    }
    setPos((prev) => (prev.left === left && prev.top === top ? prev : { left, top }));
  }, [x, y, items]);

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onMouseDown={onClose} />
      <div className="menu" ref={ref} style={{ left: pos.left, top: pos.top }} role="menu">
        {items.map((item, i) => {
          if (item.type === 'sep') return <hr key={`sep-${i}`} />;
          return (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className={item.danger ? 'danger' : ''}
              disabled={item.disabled}
              onClick={() => {
                if (item.disabled) return;
                onAction(item.id);
                onClose();
              }}
            >
              <span className="menu-label">{item.label}</span>
              {item.hint && <span className="menu-hint">{item.hint}</span>}
            </button>
          );
        })}
      </div>
    </>
  );
}

export function ContextMenu({
  menu,
  onClose,
  onAction,
  pinned,
  inRepo,
}: {
  menu: MenuState;
  onClose: () => void;
  onAction: (action: string, entry: FsEntry) => void;
  pinned: boolean;
  inRepo: boolean;
}) {
  const isDir = menu.entry.kind === 'dir';
  const items: MenuItem[] = [
    ...(isDir
      ? [
        { type: 'item' as const, id: 'explore', label: 'Open in Explorer', hint: 'Dbl-click' },
        { type: 'item' as const, id: 'explore-new', label: 'Open in new explorer' },
      ]
      : [
        { type: 'item' as const, id: 'open-keep', label: 'Keep tab open', hint: 'Dbl-click' },
      ]),
    { type: 'item', id: 'copy-path', label: 'Copy full path' },
    { type: 'sep' },
    ...(isDir
      ? [
        { type: 'item' as const, id: pinned ? 'unpin' : 'pin', label: pinned ? 'Unpin favorite' : 'Pin favorite' },
        { type: 'item' as const, id: inRepo ? 'ws-remove' : 'ws-add', label: inRepo ? 'Remove from repos' : 'Add as repo' },
        { type: 'sep' as const },
      ]
      : []),
    { type: 'item', id: 'new-file', label: 'New file' },
    { type: 'item', id: 'new-dir', label: 'New folder' },
    { type: 'item', id: 'rename', label: 'Rename' },
    { type: 'item', id: 'delete', label: 'Delete', danger: true },
    { type: 'sep' },
    { type: 'item', id: 'term', label: 'Open terminal here' },
  ];

  return (
    <ActionMenu
      x={menu.x}
      y={menu.y}
      items={items}
      onClose={onClose}
      onAction={(id) => onAction(id, menu.entry)}
    />
  );
}

export function TextClipMenu({
  x,
  y,
  text,
  onClose,
}: {
  x: number;
  y: number;
  text: string;
  onClose: () => void;
}) {
  return (
    <ActionMenu
      x={x}
      y={y}
      items={[{ type: 'item', id: 'copy', label: 'Copy', hint: 'Ctrl/⌘+C' }]}
      onClose={onClose}
      onAction={() => { void navigator.clipboard.writeText(text); }}
    />
  );
}
