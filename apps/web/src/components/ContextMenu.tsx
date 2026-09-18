import type { FsEntry } from '@remotepad/shared';

export interface MenuState {
  x: number;
  y: number;
  entry: FsEntry;
}

export function ContextMenu({
  menu,
  onClose,
  onAction,
  pinned,
  inWorkspace,
}: {
  menu: MenuState;
  onClose: () => void;
  onAction: (action: string, entry: FsEntry) => void;
  pinned: boolean;
  inWorkspace: boolean;
}) {
  const isDir = menu.entry.kind === 'dir';
  const actions = [
    ...(isDir ? [[pinned ? 'unpin' : 'pin', pinned ? 'Unpin favorite' : 'Pin favorite'] as const] : []),
    ...(isDir ? [[inWorkspace ? 'ws-remove' : 'ws-add', inWorkspace ? 'Remove from workspace' : 'Add to workspace'] as const] : []),
    ['new-file', 'New file'],
    ['new-dir', 'New folder'],
    ['rename', 'Rename'],
    ['delete', 'Delete'],
    ['sep', ''],
    ['term', 'Open terminal here'],
  ] as const;

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={onClose} />
      <div className="menu" style={{ left: menu.x, top: menu.y }}>
        {actions.map(([id, label]) =>
          id === 'sep' ? <hr key="sep" /> : (
            <button
              key={id}
              className={id === 'delete' ? 'danger' : ''}
              onClick={() => { onAction(id, menu.entry); onClose(); }}
            >
              {label}
            </button>
          ))}
      </div>
    </>
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
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onMouseDown={onClose} />
      <div className="menu" style={{ left: x, top: y }}>
        <button
          onClick={() => {
            void navigator.clipboard.writeText(text);
            onClose();
          }}
        >Copy</button>
      </div>
    </>
  );
}
