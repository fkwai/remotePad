import type { GitStatusResponse, MachineInfo, TermSessionInfo, ViewerModuleId } from '@remotepad/shared';
import { InfoPanel } from './InfoPanel';

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
