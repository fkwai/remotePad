import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Favorite, FsEntry, Repo, SearchHit } from '@remotepad/shared';
import { api } from '../api';
import { fileMark } from '../files';
import { setEntryDrag } from '../dnd';
import { ContextMenu, type MenuState } from './ContextMenu';

const ROW = 22;

export function FileTree({
  roots,
  treeRoot,
  selected,
  revealTick,
  expanded,
  listings,
  favorites,
  repos,
  onSelect,
  onToggle,
  onOpen,
  onBrowse,
  onBrowseNew,
  onCreate,
  onRename,
  onDelete,
  onTerminal,
  onPin,
  onUnpin,
  onAddRepo,
  onRemoveRepo,
  onGoUp,
  pendingPaths,
}: {
  roots: string[];
  treeRoot: string;
  selected: string | null;
  revealTick: number;
  expanded: Set<string>;
  listings: Record<string, FsEntry[]>;
  favorites: Favorite[];
  repos: Repo[];
  onSelect: (path: string, entry?: FsEntry) => void;
  onToggle: (path: string) => void;
  onOpen: (entry: FsEntry, temp?: boolean) => void;
  onBrowse: (entry: FsEntry) => void;
  onBrowseNew: (entry: FsEntry) => void;
  onCreate: (dir: string, kind: 'file' | 'dir', name: string) => void;
  onRename: (from: string, name: string) => void;
  onDelete: (entry: FsEntry) => void;
  onTerminal: (dir: string) => void;
  onPin: (path: string) => void;
  onUnpin: (path: string) => void;
  onAddRepo: (path: string) => void;
  onRemoveRepo: (path: string) => void;
  onGoUp: () => void;
  pendingPaths?: Set<string>;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [draft, setDraft] = useState<{ dir: string; kind: 'file' | 'dir' | 'rename'; from?: string } | null>(null);
  const [draftName, setDraftName] = useState('');
  const [confirm, setConfirm] = useState<FsEntry | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const pinned = new Set(favorites.map((item) => item.path));
  const inRepo = new Set(repos.map((item) => item.path));

  const clickFolder = (entry: FsEntry, detail: number) => {
    onSelect(entry.path, entry);
    if (detail >= 2) {
      if (!expanded.has(entry.path)) onToggle(entry.path);
      onBrowse(entry);
    } else {
      onToggle(entry.path);
    }
  };

  useEffect(() => {
    if (!revealTick) return;
    const body = bodyRef.current;
    if (!body) return;
    const node = body.querySelector('.tree-node.active') as HTMLElement | null;
    if (!node) return;
    const depth = Number(node.dataset.depth || 0);
    const stickyBase = treeRoot !== '/' ? ROW : 0;
    const stickyOffset = stickyBase + depth * ROW;
    const nodeScrollTop = body.scrollTop + (node.getBoundingClientRect().top - body.getBoundingClientRect().top);
    body.scrollTop = Math.max(0, nodeScrollTop - stickyOffset);
  }, [revealTick]);

  useEffect(() => {
    if (!searchOpen || !query.trim()) {
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
  }, [query, searchOpen, selected, treeRoot, listings]);

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
    if (action === 'copy-path') void navigator.clipboard.writeText(entry.path);
    else if (action === 'explore') onBrowse(entry);
    else if (action === 'explore-new') onBrowseNew(entry);
    else if (action === 'open-keep') onOpen(entry, false);
    else if (action === 'pin') onPin(dir);
    else if (action === 'unpin') onUnpin(dir);
    else if (action === 'ws-add') onAddRepo(dir);
    else if (action === 'ws-remove') onRemoveRepo(dir);
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

  const showUp = treeRoot !== '/';

  return (
    <div className="pane">
      <div className="pane-head">
        Files
        <div className="actions">
          <button
            className={`ghost ${searchOpen ? 'on' : ''}`}
            title="Search files"
            onClick={() => {
              setSearchOpen((v) => {
                const next = !v;
                if (!next) setQuery('');
                else window.setTimeout(() => searchRef.current?.focus(), 0);
                return next;
              });
            }}
          >⌕</button>
          <button className="ghost" onClick={() => {
            const dir = selected ? dirOf(selected, listings) : roots[0];
            if (dir) { setDraft({ dir, kind: 'file' }); setDraftName(''); }
          }}>+</button>
        </div>
      </div>
      {searchOpen && (
        <div className="tree-search">
          <input
            ref={searchRef}
            type="search"
            placeholder="Search files"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setSearchOpen(false);
                setQuery('');
              }
            }}
          />
        </div>
      )}
      <div className="tree-body" ref={bodyRef}>
        {hits ? hits.map((hit) => (
          <div
            key={hit.path}
            className={`search-hit ${selected === hit.path ? 'active' : ''}`}
            draggable
            onDragStart={(e) => setEntryDrag(e, { path: hit.path, kind: hit.kind === 'dir' ? 'dir' : 'file' })}
            onClick={() => {
              onSelect(hit.path);
              if (hit.kind !== 'dir') onOpen({ name: hit.name, path: hit.path, kind: hit.kind }, true);
            }}
            onDoubleClick={() => {
              if (hit.kind === 'dir') onBrowse({ name: hit.name, path: hit.path, kind: hit.kind });
              else onOpen({ name: hit.name, path: hit.path, kind: hit.kind }, false);
            }}
          >
            {hit.name}
            <small>{hit.path}</small>
          </div>
        )) : (
          <>
            {showUp && (
              <button type="button" className="tree-node up sticky-root" onClick={onGoUp} title={parentOf(treeRoot)}>
                <span className="tree-twisty leaf" />
                <span className="tree-name">...</span>
              </button>
            )}
            {roots.map((root) => (
              <TreeNode
                key={root}
                entry={{ name: label(root), path: root, kind: 'dir' }}
                depth={0}
                stickyBase={showUp ? 22 : 0}
                selected={selected}
                expanded={expanded}
                listings={listings}
                pinned={pinned}
                inRepo={inRepo}
                onSelect={onSelect}
                onToggle={onToggle}
                onOpen={onOpen}
                onClickFolder={clickFolder}
                onMenu={setMenu}
                onPin={onPin}
                onUnpin={onUnpin}
                onAddRepo={onAddRepo}
                onRemoveRepo={onRemoveRepo}
                pendingPaths={pendingPaths}
              />
            ))}
          </>
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
      </div>
      {menu && (
        <ContextMenu
          menu={menu}
          pinned={pinned.has(menu.entry.kind === 'dir' ? menu.entry.path : parentOf(menu.entry.path))}
          inRepo={inRepo.has(menu.entry.kind === 'dir' ? menu.entry.path : parentOf(menu.entry.path))}
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
  stickyBase,
  selected,
  expanded,
  listings,
  pinned,
  inRepo,
  onSelect,
  onToggle,
  onOpen,
  onClickFolder,
  onMenu,
  onPin,
  onUnpin,
  onAddRepo,
  onRemoveRepo,
  pendingPaths,
}: {
  entry: FsEntry;
  depth: number;
  stickyBase: number;
  selected: string | null;
  expanded: Set<string>;
  listings: Record<string, FsEntry[]>;
  pinned: Set<string>;
  inRepo: Set<string>;
  onSelect: (path: string, entry?: FsEntry) => void;
  onToggle: (path: string) => void;
  onOpen: (entry: FsEntry, temp?: boolean) => void;
  onClickFolder: (entry: FsEntry, detail: number) => void;
  onMenu: (menu: MenuState) => void;
  onPin: (path: string) => void;
  onUnpin: (path: string) => void;
  onAddRepo: (path: string) => void;
  onRemoveRepo: (path: string) => void;
  pendingPaths?: Set<string>;
}) {
  const isDir = entry.kind === 'dir';
  const open = expanded.has(entry.path);
  const kids = listings[entry.path];
  const isPinned = pinned.has(entry.path);
  const isRepo = inRepo.has(entry.path);
  const mark = isDir ? null : fileMark(entry.path);
  const indent = depth * 16;
  const isSticky = isDir && (
    depth === 0 ||
    (!!selected && selected !== entry.path && selected.startsWith(entry.path + '/'))
  );
  const stickyTop = isSticky ? stickyBase + depth * ROW : undefined;
  return (
    <div className="tree-branch">
      <div
        className={`tree-node ${isDir ? 'dir' : ''} ${selected === entry.path ? 'active' : ''} ${isSticky ? 'sticky-root' : ''}`}
        data-depth={depth}
        style={isSticky ? { top: stickyTop } : undefined}
        draggable
        onDragStart={(e) => setEntryDrag(e, { path: entry.path, kind: isDir ? 'dir' : 'file' })}
        onClick={(e) => {
          if (isDir) onClickFolder(entry, e.detail);
          else {
            onSelect(entry.path, entry);
            onOpen(entry, true);
          }
        }}
        onDoubleClick={() => {
          if (!isDir) onOpen(entry, false);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onSelect(entry.path, entry);
          onMenu({ x: e.clientX, y: e.clientY, entry });
        }}
      >
        <span className="tree-indent" style={{ width: indent }} />
        <span
          className={`tree-twisty ${isDir ? '' : 'leaf'} ${open ? 'open' : ''}`}
          onClick={(e) => {
            if (!isDir) return;
            e.stopPropagation();
            onSelect(entry.path, entry);
            onToggle(entry.path);
          }}
        >
          {isDir && (
            <svg className="tree-chevron" viewBox="0 0 16 16" aria-hidden>
              <path d="M6 3.5L11 8l-5 4.5" />
            </svg>
          )}
        </span>
        {mark && <span className={`file-mark ${mark.cls}`}>{mark.text}</span>}
        <span className="tree-name">{entry.name}</span>
        {pendingPaths?.has(entry.path) && <span className="agent-mark" title="Agent changed">●</span>}
        {isDir && (
          <>
            <button
              className={`ghost pin ${isRepo ? 'on ws' : ''}`}
              title={isRepo ? 'Remove from repos' : 'Add as repo'}
              onClick={(e) => {
                e.stopPropagation();
                if (isRepo) onRemoveRepo(entry.path);
                else onAddRepo(entry.path);
              }}
            >◆</button>
            <button
              className={`ghost pin ${isPinned ? 'on' : ''}`}
              title={isPinned ? 'Unpin favorite' : 'Pin favorite'}
              onClick={(e) => {
                e.stopPropagation();
                if (isPinned) onUnpin(entry.path);
                else onPin(entry.path);
              }}
            >★</button>
          </>
        )}
      </div>
      {isDir && open && kids && kids.length > 0 && (
        <div className="tree-children" style={{ ['--guide']: `${indent + 12}px` } as CSSProperties}>
          {kids.map((child) => (
            <TreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              stickyBase={stickyBase}
              selected={selected}
              expanded={expanded}
              listings={listings}
              pinned={pinned}
              inRepo={inRepo}
              onSelect={onSelect}
              onToggle={onToggle}
              onOpen={onOpen}
              onClickFolder={onClickFolder}
              onMenu={onMenu}
              onPin={onPin}
              onUnpin={onUnpin}
              onAddRepo={onAddRepo}
              onRemoveRepo={onRemoveRepo}
              pendingPaths={pendingPaths}
            />
          ))}
        </div>
      )}
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
