import type { GitStatusResponse, MachineInfo, TermSessionInfo, ViewerModuleId } from '@remotepad/shared';
import { InfoPanel } from './InfoPanel';

export function HelpPop({ onClose }: { onClose: () => void }) {
  return (
    <div className="float-pop help-pop">
      <div className="float-pop-head">
        <span>RemotePad</span>
        <button className="ghost" onClick={onClose}>×</button>
      </div>
      <div className="help-body">
        <section>
          <h3>How to use</h3>
          <p><strong>Click</strong> to select / open. <strong>Drag</strong> to move paths between panes.</p>
          <p><strong>Right-click</strong> anything else — menus show the action and its hotkey or gesture.</p>
        </section>
        <section>
          <h3>General</h3>
          <p><kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>S</kbd> save · unsaved tabs show <em>●</em> · also on the tab / editor menu</p>
          <p><kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>`</kbd> show or hide the terminal</p>
          <p><kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>L</kbd> toggle source / rendered · click the address bar to edit the path</p>
          <p>Click the computer name for host, git, terminals, and viewer modules</p>
        </section>
        <section>
          <h3>Files & Explorer</h3>
          <p>Click a file to temp-open it. Right-click → <em>Keep tab open</em> (or double-click the file)</p>
          <p>Click a folder to expand/collapse. Right-click → <em>Open in Explorer</em></p>
          <p>Right-click for new file/folder, rename, delete, pin, repos, copy path, terminal</p>
          <p>Drag a path into the Editor, Terminal, or Agent to open or insert it</p>
        </section>
        <section>
          <h3>Editor</h3>
          <p>Right-click a tab: reveal in tree, keep, save, revert, close left/right/all</p>
          <p>Viewer files: <kbd>&lt;/&gt;</kbd> or <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>L</kbd> toggles source / rendered</p>
          <p><kbd>Shift</kbd>+<kbd>Enter</kbd> or <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Enter</kbd> run the line or selection in the terminal</p>
        </section>
        <section>
          <h3>Terminal</h3>
          <p>Right-click a tab to rename or close (double-click also renames)</p>
          <p>In the terminal body: select + right-click copies; empty right-click pastes</p>
        </section>
        <section>
          <h3>Pins and repos</h3>
          <p>Right-click a favorite or repo: open explorer, run startup, terminal, remove</p>
          <p>Drag to reorder. Click <kbd>none</kbd> to clear the active repo</p>
        </section>
        <section>
          <h3>Agent</h3>
          <p><kbd>+</kbd> new general Agent (selected repo) · <kbd>☰</kbd> history · Helper <kbd>Refresh</kbd> wipes that chat (git + AGENTS.md keep the work)</p>
          <p><kbd>Enter</kbd> send · <kbd>Shift</kbd>+<kbd>Enter</kbd> newline</p>
        </section>
      </div>
    </div>
  );
}

export function HostPop({
  path,
  machine,
  git,
  sessions,
  modules,
  onToggleModule,
  onOpenDiff,
  onSelectTerm,
  onClose,
}: {
  path: string | null;
  machine: MachineInfo | null;
  git: GitStatusResponse | null;
  sessions: TermSessionInfo[];
  modules?: Record<ViewerModuleId, boolean>;
  onToggleModule?: (id: ViewerModuleId, on: boolean) => void;
  onOpenDiff: (path: string) => void;
  onSelectTerm: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="float-pop host-pop">
      <div className="float-pop-head">
        <span>Host</span>
        <button className="ghost" onClick={onClose}>×</button>
      </div>
      <InfoPanel
        path={path}
        machine={machine}
        git={git}
        sessions={sessions}
        modules={modules}
        onToggleModule={onToggleModule}
        onOpenDiff={onOpenDiff}
        onSelectTerm={onSelectTerm}
      />
    </div>
  );
}
