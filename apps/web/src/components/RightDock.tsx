import type { AgentBackend, AgentCatsCoList, AgentChange, AgentSessionInfo, AgentStatus } from '@remotepad/shared';
import { AgentPanel, type AgentChatMessage } from './AgentPanel';

export function RightDock({
  cwd,
  error,
  sessionId,
  agentSessions,
  state,
  backend,
  messages,
  changes,
  onSend,
  onStop,
  onSetBackend,
  onClear,
  onNew,
  onOpenSession,
  onRenameSession,
  onDeleteSession,
  onAccept,
  onUndo,
  onAcceptAll,
  onUndoAll,
  onOpenAgentDiff,
  onOpenSessionFile,
  catscoList,
  onCatsCoSelect,
  onCatsCoRefresh,
  onCatsCoCreateProject,
  onCatsCoCreateTask,
  onCatsCoSwitchBot,
  onCatsCoCloseActive,
  switching,
}: {
  cwd: string;
  error?: string;
  sessionId?: string;
  agentSessions: AgentSessionInfo[];
  state: AgentStatus;
  backend: AgentBackend;
  messages: AgentChatMessage[];
  changes: AgentChange[];
  onSend: (text: string) => void;
  onStop: () => void;
  onSetBackend: (backend: AgentBackend) => void;
  onClear: () => void;
  onNew: () => void;
  onOpenSession: (id: string) => void;
  onRenameSession: (id: string, title: string) => void;
  onDeleteSession: (id: string) => void;
  onAccept: (path: string) => void;
  onUndo: (path: string) => void;
  onAcceptAll: () => void;
  onUndoAll: () => void;
  onOpenAgentDiff: (change: AgentChange) => void;
  onOpenSessionFile?: (path: string) => void;
  catscoList?: AgentCatsCoList;
  onCatsCoSelect?: (topicId: string) => void;
  onCatsCoRefresh?: () => void;
  onCatsCoCreateProject?: (name: string) => void;
  onCatsCoCreateTask?: (name: string, projectId?: number) => void;
  onCatsCoSwitchBot?: (botUid: string) => void;
  onCatsCoCloseActive?: () => void;
  switching?: boolean;
}) {
  return (
    <div className="pane">
      <AgentPanel
        cwd={cwd}
        error={error}
        sessionId={sessionId}
        sessions={agentSessions}
        state={state}
        backend={backend}
        messages={messages}
        changes={changes}
        onSend={onSend}
        onStop={onStop}
        onSetBackend={onSetBackend}
        onClear={onClear}
        onNew={onNew}
        onOpen={onOpenSession}
        onRename={onRenameSession}
        onDelete={onDeleteSession}
        onAccept={onAccept}
        onUndo={onUndo}
        onAcceptAll={onAcceptAll}
        onUndoAll={onUndoAll}
        onOpenDiff={onOpenAgentDiff}
        onOpenSessionFile={onOpenSessionFile}
        catscoList={catscoList}
        onCatsCoSelect={onCatsCoSelect}
        onCatsCoRefresh={onCatsCoRefresh}
        onCatsCoCreateProject={onCatsCoCreateProject}
        onCatsCoCreateTask={onCatsCoCreateTask}
        onCatsCoSwitchBot={onCatsCoSwitchBot}
        onCatsCoCloseActive={onCatsCoCloseActive}
        switching={switching}
      />
    </div>
  );
}
