import { useEffect, useState } from 'react';
import type { Favorite, FsEntry, Workspace } from '@remotepad/shared';
import { fileMark } from '../files';
import { ContextMenu, type MenuState } from './ContextMenu';

export function FolderView({
  dir,
  entries,
  view,
  favorites,
  workspaces,
  onOpenFile,
  onOpenFolder,
  onReveal,
  onCreate,
  onRename,
  onDelete,
  onTerminal,
  onPin,
  onUnpin,
  onAddWorkspace,
  onRemoveWorkspace,
  onLoad,
}: {
  dir: string;
  entries: FsEntry[] | undefined;
  view: 'icons' | 'details';
  favorites: Favorite[];
  workspaces: Workspace[];
  onOpenFile: (entry: FsEntry) => void;
  onOpenFolder: (path: string) => void;
  onReveal?: () => void;
  onCreate: (dir: string, kind: 'file' | 'dir', name: string) => void;
  onRename: (from: string, name: string) => void;
  onDelete: (entry: FsEntry) => void;
  onTerminal: (dir: string) => void;
  onPin: (path: string) => void;
  onUnpin: (path: string) => void;
  onAddWorkspace: (path: string) => void;
  onRemoveWorkspace: (path: string) => void;
  onLoad: (dir: string) => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [draft, setDraft] = useState<{ kind: 'file' | 'dir' | 'rename'; from?: string } | null>(null);
  const [draftName, setDraftName] = useState('');
  const [confirm, setConfirm] = useState<FsEntry | null>(null);
  const pinned = new Set(favorites.map((item) => item.path));
  const inWorkspace = new Set(workspaces.map((item) => item.path));

  useEffect(() => {
    if (!entries) onLoad(dir);
  }, [dir, entries, onLoad]);

  useEffect(() => {
    setPicked(null);
    setDraft(null);
    setConfirm(null);
  }, [dir]);

  function submitDraft() {
    if (!draft || !draftName.trim()) {
      setDraft(null);
      return;
    }
    if (draft.kind === 'rename' && draft.from) onRename(draft.from, draftName.trim());
    else if (draft.kind !== 'rename') onCreate(dir, draft.kind, draftName.trim());
    setDraft(null);
    setDraftName('');
  }

  function onAction(action: string, entry: FsEntry) {
    const folder = entry.kind === 'dir' ? entry.path : parentOf(entry.path);
    if (action === 'pin') onPin(folder);
    else if (action === 'unpin') onUnpin(folder);
    else if (action === 'ws-add') onAddWorkspace(folder);
    else if (action === 'ws-remove') onRemoveWorkspace(folder);
    else if (action === 'new-file') {
      setDraft({ kind: 'file' });
      setDraftName('');
    } else if (action === 'new-dir') {
      setDraft({ kind: 'dir' });
      setDraftName('');
    } else if (action === 'rename') {
      setDraft({ kind: 'rename', from: entry.path });
      setDraftName(entry.name);
    } else if (action === 'delete') {
      setConfirm(entry);
    } else if (action === 'term') {
      onTerminal(folder);
    }
  }

  const items = entries || [];
  const blank: FsEntry = { name: dir, path: dir, kind: 'dir' };

  return (
    <div
      className="folder-view"
      onDoubleClick={(e) => {
        if (e.target === e.currentTarget) onReveal?.();
      }}
      onContextMenu={(e) => {
        if (e.target === e.currentTarget) {
          e.preventDefault();
          onMenuBlank(e.clientX, e.clientY);
        }
      }}
    >
      {view === 'icons' ? (
        <div className="folder-icons" onDoubleClick={(e) => {
          if (e.target === e.currentTarget) onReveal?.();
        }} onContextMenu={(e) => {
          if (e.target === e.currentTarget) {
            e.preventDefault();
            onMenuBlank(e.clientX, e.clientY);
          }
        }}>
          {items.map((item) => (
            <div
              key={item.path}
              className={`folder-tile ${item.kind === 'dir' ? 'dir' : 'file'} ${picked === item.path ? 'active' : ''}`}
              onClick={() => {
                setPicked(item.path);
                if (item.kind === 'dir') openItem(item);
              }}
              onDoubleClick={() => {
                if (item.kind !== 'dir') openItem(item);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setPicked(item.path);
                setMenu({ x: e.clientX, y: e.clientY, entry: item });
              }}
              title={item.path}
            >
              <span className={item.kind === 'dir' ? 'glyph folder' : `file-mark ${fileMark(item.path).cls}`}>
                {item.kind === 'dir' ? '▣' : fileMark(item.path).text}
              </span>
              <span className="label">{item.name}</span>
            </div>
          ))}
        </div>
      ) : (
        <table className="folder-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Size</th>
              <th>Modified</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                key={item.path}
                className={picked === item.path ? 'active' : ''}
                onClick={() => {
                  setPicked(item.path);
                  if (item.kind === 'dir') openItem(item);
                }}
                onDoubleClick={() => {
                  if (item.kind !== 'dir') openItem(item);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setPicked(item.path);
                  setMenu({ x: e.clientX, y: e.clientY, entry: item });
                }}
              >
                <td>
                  <span className="folder-name">
                    {item.kind === 'dir'
                      ? <span className="glyph folder">▣</span>
                      : <span className={`file-mark ${fileMark(item.path).cls}`}>{fileMark(item.path).text}</span>}
                    {item.name}
                  </span>
                </td>
                <td>{typeLabel(item)}</td>
                <td>{formatSize(item)}</td>
                <td>{formatTime(item.mtimeMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {draft && (
        <div className="inline-input">
          <input
            autoFocus
            autoComplete="off"
            spellCheck={false}
            type="text"
            placeholder={draft.kind === 'dir' ? 'folder name' : 'file name'}
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitDraft();
              if (e.key === 'Escape') setDraft(null);
            }}
            onBlur={submitDraft}
          />
        </div>
      )}
      {confirm && (
        <div className="confirm-bar">
          <span>Delete {confirm.name}?</span>
          <button className="danger" onClick={() => { onDelete(confirm); setConfirm(null); }}>Delete</button>
          <button className="ghost" onClick={() => setConfirm(null)}>Cancel</button>
        </div>
      )}
      {menu && (
        <ContextMenu
          menu={menu}
          pinned={pinned.has(menu.entry.kind === 'dir' ? menu.entry.path : parentOf(menu.entry.path))}
          inWorkspace={inWorkspace.has(menu.entry.kind === 'dir' ? menu.entry.path : parentOf(menu.entry.path))}
          onClose={() => setMenu(null)}
          onAction={onAction}
        />
      )}
    </div>
  );

  function openItem(item: FsEntry) {
    if (item.kind === 'dir') onOpenFolder(item.path);
    else onOpenFile(item);
  }

  function onMenuBlank(x: number, y: number) {
    setMenu({ x, y, entry: blank });
  }
}

function parentOf(filePath: string): string {
  const i = filePath.lastIndexOf('/');
  return i <= 0 ? '/' : filePath.slice(0, i);
}

function typeLabel(item: FsEntry): string {
  if (item.kind === 'dir') return 'Folder';
  if (item.kind === 'symlink') return 'Link';
  const i = item.name.lastIndexOf('.');
  if (i > 0) return item.name.slice(i + 1).toUpperCase() + ' file';
  return 'File';
}

function formatSize(item: FsEntry): string {
  if (item.kind === 'dir' || item.size == null) return '—';
  const n = item.size;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatTime(ms?: number): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString();
}
