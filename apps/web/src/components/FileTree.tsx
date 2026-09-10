import { useEffect, useState } from 'react';
import type { Favorite, FsEntry, SearchHit } from '@remotepad/shared';
import { api } from '../api';
import { ContextMenu, type MenuState } from './ContextMenu';

export function FileTree({
  roots,
  treeRoot,
  selected,
  expanded,
  listings,
  favorites,
  onSelect,
  onToggle,
  onOpen,
  onCreate,
  onRename,
  onDelete,
  onTerminal,
  onPin,
  onUnpin,
  onFavorite,
  onResetRoot,
}: {
  roots: string[];
  treeRoot: string;
  selected: string | null;
  expanded: Set<string>;
  listings: Record<string, FsEntry[]>;
  favorites: Favorite[];
  onSelect: (path: string, entry?: FsEntry) => void;
  onToggle: (path: string) => void;
  onOpen: (entry: FsEntry) => void;
  onCreate: (dir: string, kind: 'file' | 'dir', name: string) => void;
  onRename: (from: string, name: string) => void;
  onDelete: (entry: FsEntry) => void;
  onTerminal: (dir: string) => void;
  onPin: (path: string) => void;
  onUnpin: (path: string) => void;
  onFavorite: (path: string) => void;
  onResetRoot: () => void;
}) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [draft, setDraft] = useState<{ dir: string; kind: 'file' | 'dir' | 'rename'; from?: string } | null>(null);
  const [draftName, setDraftName] = useState('');
  const [confirm, setConfirm] = useState<FsEntry | null>(null);
  const pinned = new Set(favorites.map((item) => item.path));

  useEffect(() => {
    if (!query.trim()) {
      setHits(null);
      return;
    }
    const root = selected && listings[selected] ? selected : selected ? selected.slice(0, selected.lastIndexOf('/') || 1) : treeRoot;
    if (!root) return;
    const handle = window.setTimeout(() => {
      api<{ hits: SearchHit[] }>(`/api/search?q=${encodeURIComponent(query)}&path=${encodeURIComponent(root)}`)
        .then((res) => setHits(res.hits))
        .catch(() => setHits([]));
    }, 180);
    return () => window.clearTimeout(handle);
  }, [query, selected, treeRoot, listings]);

  function submitDraft() {
    if (!draft || !draftName.trim()) {
      setDraft(null);
      return;
    }
    if (draft.kind === 'rename' && draft.from) onRename(draft.from, draftName.trim());
    else if (draft.kind !== 'rename') onCreate(draft.dir, draft.kind, draftName.trim());
    setDraft(null);
    setDraftName('');
  }

  function onAction(action: string, entry: FsEntry) {
    const dir = entry.kind === 'dir' ? entry.path : parentOf(entry.path);
    if (action === 'pin') onPin(dir);
    else if (action === 'unpin') onUnpin(dir);
    else if (action === 'new-file') {
      setDraft({ dir, kind: 'file' });
      setDraftName('');
    } else if (action === 'new-dir') {
      setDraft({ dir, kind: 'dir' });
      setDraftName('');
    } else if (action === 'rename') {
      setDraft({ dir, kind: 'rename', from: entry.path });
      setDraftName(entry.name);
    } else if (action === 'delete') {
      setConfirm(entry);
    } else if (action === 'term') {
      onTerminal(dir);
    }
  }

  return (
    <div className="pane">
      <div className="pane-head">
        Files
        <div className="actions">
          {treeRoot !== '/' && (
            <button className="ghost" onClick={onResetRoot}>↑ /</button>
          )}
          <button className="ghost" onClick={() => {
            const dir = selected ? dirOf(selected, listings) : roots[0];
            if (dir) { setDraft({ dir, kind: 'file' }); setDraftName(''); }
          }}>+</button>
        </div>
      </div>
      <div className="tree-search">
        <input
          type="search"
          placeholder="Search files"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="tree-body">
        {!hits && favorites.length > 0 && (
          <div className="fav-block">
            <div className="fav-label">Favorites</div>
            {favorites.map((item) => (
              <div
                key={item.path}
                className={`tree-node dir fav-item ${treeRoot === item.path ? 'active' : ''}`}
                onClick={() => onFavorite(item.path)}
              >
                <span className="tree-icon pin-mark">★</span>
                <span className="tree-name">{item.name}</span>
                <button
                  className="ghost pin"
                  onClick={(e) => { e.stopPropagation(); onUnpin(item.path); }}
                >×</button>
              </div>
            ))}
          </div>
        )}
        {hits ? hits.map((hit) => (
          <div
            key={hit.path}
            className={`search-hit ${selected === hit.path ? 'active' : ''}`}
            onClick={() => {
              onSelect(hit.path);
              onOpen({ name: hit.name, path: hit.path, kind: hit.kind });
            }}
          >
            {hit.name}
            <small>{hit.path}</small>
          </div>
        )) : roots.map((root) => (
          <TreeNode
            key={root}
            entry={{ name: label(root), path: root, kind: 'dir' }}
            depth={0}
            selected={selected}
            expanded={expanded}
            listings={listings}
            pinned={pinned}
            onSelect={onSelect}
            onToggle={onToggle}
            onOpen={onOpen}
            onMenu={setMenu}
            onPin={onPin}
            onUnpin={onUnpin}
          />
        ))}
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
      </div>
      {menu && (
        <ContextMenu
          menu={menu}
          pinned={pinned.has(menu.entry.kind === 'dir' ? menu.entry.path : parentOf(menu.entry.path))}
          onClose={() => setMenu(null)}
          onAction={onAction}
        />
      )}
    </div>
  );
}

function TreeNode({
  entry,
  depth,
  selected,
  expanded,
  listings,
  pinned,
  onSelect,
  onToggle,
  onOpen,
  onMenu,
  onPin,
  onUnpin,
}: {
  entry: FsEntry;
  depth: number;
  selected: string | null;
  expanded: Set<string>;
  listings: Record<string, FsEntry[]>;
  pinned: Set<string>;
  onSelect: (path: string, entry?: FsEntry) => void;
  onToggle: (path: string) => void;
  onOpen: (entry: FsEntry) => void;
  onMenu: (menu: MenuState) => void;
  onPin: (path: string) => void;
  onUnpin: (path: string) => void;
}) {
  const isDir = entry.kind === 'dir';
  const open = expanded.has(entry.path);
  const kids = listings[entry.path];
  const isPinned = pinned.has(entry.path);
  return (
    <div>
      <div
        className={`tree-node ${isDir ? 'dir' : ''} ${selected === entry.path ? 'active' : ''}`}
        style={{ paddingLeft: 6 + depth * 12 }}
        onClick={() => {
          onSelect(entry.path, entry);
          if (isDir) onToggle(entry.path);
          else onOpen(entry);
        }}
        onDoubleClick={() => onOpen(entry)}
        onContextMenu={(e) => {
          e.preventDefault();
          onSelect(entry.path, entry);
          onMenu({ x: e.clientX, y: e.clientY, entry });
        }}
      >
        <span className="tree-twisty">{isDir ? (open ? '▾' : '▸') : ''}</span>
        <span className="tree-icon">{isDir ? '▣' : '▤'}</span>
        <span className="tree-name">{entry.name}</span>
        {isDir && (
          <button
            className={`ghost pin ${isPinned ? 'on' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              if (isPinned) onUnpin(entry.path);
              else onPin(entry.path);
            }}
          >★</button>
        )}
      </div>
      {isDir && open && kids?.map((child) => (
        <TreeNode
          key={child.path}
          entry={child}
          depth={depth + 1}
          selected={selected}
          expanded={expanded}
          listings={listings}
          pinned={pinned}
          onSelect={onSelect}
          onToggle={onToggle}
          onOpen={onOpen}
          onMenu={onMenu}
          onPin={onPin}
          onUnpin={onUnpin}
        />
      ))}
    </div>
  );
}

function label(root: string): string {
  const parts = root.split('/').filter(Boolean);
  return parts[parts.length - 1] || '/';
}

function parentOf(filePath: string): string {
  const i = filePath.lastIndexOf('/');
  return i <= 0 ? '/' : filePath.slice(0, i);
}

function dirOf(filePath: string, listings: Record<string, FsEntry[]>): string {
  if (listings[filePath] || filePath === '/') return filePath;
  return parentOf(filePath);
}
