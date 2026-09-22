import { useEffect, useState, type MouseEvent } from 'react';
import type { Favorite, FsEntry, Repo } from '@remotepad/shared';
import { fileMark } from '../files';
import { rawUrl } from '../api';
import { ActionMenu, type MenuItem, type MenuState as BaseMenu } from './ContextMenu';

type FolderMenu = BaseMenu & { paths?: string[] };

export function FolderView({
  dir,
  entries,
  view,
  favorites,
  repos,
  onOpenFile,
  onOpenFolder,
  onOpenFolderNew,
  onReveal,
  onCreate,
  onRename,
  onDelete,
  onDeleteMany,
  onTerminal,
  onPin,
  onUnpin,
  onAddRepo,
  onRemoveRepo,
  onLoad,
}: {
  dir: string;
  entries: FsEntry[] | undefined;
  view: 'icons' | 'details';
  favorites: Favorite[];
  repos: Repo[];
  onOpenFile: (entry: FsEntry) => void;
  onOpenFolder: (path: string) => void;
  onOpenFolderNew: (path: string) => void;
  onReveal?: () => void;
  onCreate: (dir: string, kind: 'file' | 'dir', name: string) => void;
  onRename: (from: string, name: string) => void;
  onDelete: (entry: FsEntry) => void;
  onDeleteMany?: (entries: FsEntry[]) => void;
  onTerminal: (dir: string) => void;
  onPin: (path: string) => void;
  onUnpin: (path: string) => void;
  onAddRepo: (path: string) => void;
  onRemoveRepo: (path: string) => void;
  onLoad: (dir: string) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [menu, setMenu] = useState<FolderMenu | null>(null);
  const [draft, setDraft] = useState<{ kind: 'file' | 'dir' | 'rename'; from?: string } | null>(null);
  const [draftName, setDraftName] = useState('');
  const [confirm, setConfirm] = useState<FsEntry[] | null>(null);
  const pinned = new Set(favorites.map((item) => item.path));
  const inRepo = new Set(repos.map((item) => item.path));

  useEffect(() => {
    if (!entries) onLoad(dir);
  }, [dir, entries, onLoad]);

  useEffect(() => {
    setPicked([]);
    setAnchor(null);
    setDraft(null);
    setConfirm(null);
  }, [dir]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (draft || menu || confirm) return;
      if (picked.length === 0) return;
      e.preventDefault();
      const list = entries || [];
      const targets = list.filter((item) => picked.includes(item.path));
      if (targets.length === 0) return;
      setConfirm(targets);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [picked, entries, draft, menu, confirm]);

  const items = entries || [];
  const blank: FsEntry = { name: dir, path: dir, kind: 'dir' };
  const byPath = new Map(items.map((item) => [item.path, item]));

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

  function selectOne(path: string, e: MouseEvent) {
    if (e.metaKey || e.ctrlKey) {
      setPicked((prev) => {
        if (prev.includes(path)) return prev.filter((item) => item !== path);
        return [...prev, path];
      });
      setAnchor(path);
      return;
    }
    if (e.shiftKey && anchor) {
      const a = items.findIndex((item) => item.path === anchor);
      const b = items.findIndex((item) => item.path === path);
      if (a >= 0 && b >= 0) {
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        setPicked(items.slice(lo, hi + 1).map((item) => item.path));
        return;
      }
    }
    setPicked([path]);
    setAnchor(path);
  }

  function openItem(item: FsEntry) {
    if (item.kind === 'dir') onOpenFolder(item.path);
    else onOpenFile(item);
  }

  function downloadEntries(list: FsEntry[]) {
    for (const item of list) {
      if (item.kind === 'dir') continue;
      const a = document.createElement('a');
      a.href = rawUrl(item.path);
      a.download = item.name;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  }

  function onAction(action: string, entry: FsEntry, paths?: string[]) {
    const multi = (paths || []).map((path) => byPath.get(path)).filter((item): item is FsEntry => Boolean(item));
    const targets = multi.length > 1 ? multi : [entry];
    const folder = entry.kind === 'dir' ? entry.path : parentOf(entry.path);
    if (action === 'copy-path') {
      void navigator.clipboard.writeText(targets.map((item) => item.path).join('\n'));
    } else if (action === 'explore') onOpenFolder(entry.path);
    else if (action === 'explore-new') onOpenFolderNew(folder);
    else if (action === 'open-keep') onOpenFile(entry);
    else if (action === 'download') downloadEntries(targets);
    else if (action === 'pin') onPin(folder);
    else if (action === 'unpin') onUnpin(folder);
    else if (action === 'ws-add') onAddRepo(folder);
    else if (action === 'ws-remove') onRemoveRepo(folder);
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
      setConfirm(targets);
    } else if (action === 'term') {
      onTerminal(folder);
    }
  }

  function onMenuBlank(x: number, y: number) {
    setMenu({ x, y, entry: blank });
  }

  function clearSelection() {
    setPicked([]);
    setAnchor(null);
  }

  function onBlankClick(e: MouseEvent) {
    if (e.target !== e.currentTarget) return;
    clearSelection();
  }

  function confirmDelete() {
    if (!confirm || confirm.length === 0) return;
    if (confirm.length === 1) onDelete(confirm[0]!);
    else if (onDeleteMany) onDeleteMany(confirm);
    else for (const item of confirm) onDelete(item);
    setConfirm(null);
    setPicked([]);
  }

  return (
    <div
      className="folder-view"
      onClick={onBlankClick}
      onDoubleClick={(e) => {
        if (e.target === e.currentTarget) onReveal?.();
      }}
      onContextMenu={(e) => {
        if (e.target === e.currentTarget) {
          e.preventDefault();
          clearSelection();
          onMenuBlank(e.clientX, e.clientY);
        }
      }}
    >
      {view === 'icons' ? (
        <div
          className="folder-icons"
          onClick={onBlankClick}
          onDoubleClick={(e) => {
            if (e.target === e.currentTarget) onReveal?.();
          }}
          onContextMenu={(e) => {
            if (e.target === e.currentTarget) {
              e.preventDefault();
              clearSelection();
              onMenuBlank(e.clientX, e.clientY);
            }
          }}
        >
          {items.map((item) => (
            <div
              key={item.path}
              className={`folder-tile ${item.kind === 'dir' ? 'dir' : 'file'} ${picked.includes(item.path) ? 'active' : ''}`}
              onClick={(e) => selectOne(item.path, e)}
              onDoubleClick={(e) => {
                e.preventDefault();
                openItem(item);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const paths = picked.includes(item.path) && picked.length > 1 ? picked : [item.path];
                if (!picked.includes(item.path)) {
                  setPicked([item.path]);
                  setAnchor(item.path);
                }
                setMenu({ x: e.clientX, y: e.clientY, entry: item, paths });
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
        <div
          className="folder-details"
          onClick={onBlankClick}
          onContextMenu={(e) => {
            if (e.target === e.currentTarget) {
              e.preventDefault();
              clearSelection();
              onMenuBlank(e.clientX, e.clientY);
            }
          }}
        >
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
                  className={picked.includes(item.path) ? 'active' : ''}
                  onClick={(e) => selectOne(item.path, e)}
                  onDoubleClick={(e) => {
                    e.preventDefault();
                    openItem(item);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const paths = picked.includes(item.path) && picked.length > 1 ? picked : [item.path];
                    if (!picked.includes(item.path)) {
                      setPicked([item.path]);
                      setAnchor(item.path);
                    }
                    setMenu({ x: e.clientX, y: e.clientY, entry: item, paths });
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
        </div>
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
          <span>
            {confirm.length === 1
              ? `Delete ${confirm[0]!.name}?`
              : `Delete ${confirm.length} items?`}
          </span>
          <button className="danger" onClick={confirmDelete}>Delete</button>
          <button className="ghost" onClick={() => setConfirm(null)}>Cancel</button>
        </div>
      )}
      {menu && (
        <ExplorerMenu
          menu={menu}
          multi={Boolean(menu.paths && menu.paths.length > 1)}
          pinned={pinned.has(menu.entry.kind === 'dir' ? menu.entry.path : parentOf(menu.entry.path))}
          inRepo={inRepo.has(menu.entry.kind === 'dir' ? menu.entry.path : parentOf(menu.entry.path))}
          onClose={() => setMenu(null)}
          onAction={(id) => onAction(id, menu.entry, menu.paths)}
        />
      )}
    </div>
  );
}

function ExplorerMenu({
  menu,
  multi,
  pinned,
  inRepo,
  onClose,
  onAction,
}: {
  menu: FolderMenu;
  multi: boolean;
  pinned: boolean;
  inRepo: boolean;
  onClose: () => void;
  onAction: (id: string) => void;
}) {
  const isDir = menu.entry.kind === 'dir';
  const isBlank = menu.entry.path === menu.entry.name && !menu.paths;
  const items: MenuItem[] = multi
    ? [
      { type: 'item', id: 'copy-path', label: 'Copy paths' },
      { type: 'item', id: 'download', label: 'Download' },
      { type: 'sep' },
      { type: 'item', id: 'delete', label: 'Delete', hint: 'Del', danger: true },
    ]
    : [
      ...(isBlank
        ? []
        : isDir
          ? [
            { type: 'item' as const, id: 'explore', label: 'Open in Explorer', hint: 'Dbl-click' },
            { type: 'item' as const, id: 'explore-new', label: 'Open in new explorer' },
          ]
          : [
            { type: 'item' as const, id: 'open-keep', label: 'Open', hint: 'Dbl-click' },
            { type: 'item' as const, id: 'download', label: 'Download' },
          ]),
      ...(isBlank ? [] : [{ type: 'item' as const, id: 'copy-path', label: 'Copy full path' }, { type: 'sep' as const }]),
      ...(isDir && !isBlank
        ? [
          { type: 'item' as const, id: pinned ? 'unpin' : 'pin', label: pinned ? 'Unpin favorite' : 'Pin favorite' },
          { type: 'item' as const, id: inRepo ? 'ws-remove' : 'ws-add', label: inRepo ? 'Remove from repos' : 'Add as repo' },
          { type: 'sep' as const },
        ]
        : []),
      { type: 'item', id: 'new-file', label: 'New file' },
      { type: 'item', id: 'new-dir', label: 'New folder' },
      ...(!isBlank ? [{ type: 'item' as const, id: 'rename', label: 'Rename' }] : []),
      ...(!isBlank ? [{ type: 'item' as const, id: 'delete', label: 'Delete', hint: 'Del', danger: true }] : []),
      { type: 'sep' },
      { type: 'item', id: 'term', label: 'Open terminal here' },
    ];

  return (
    <ActionMenu
      x={menu.x}
      y={menu.y}
      items={items}
      onClose={onClose}
      onAction={onAction}
    />
  );
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
