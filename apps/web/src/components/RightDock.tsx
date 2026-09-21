import type { AgentChange, AgentSessionInfo, AgentStatus } from '@remotepad/shared';
import { AgentPanel, type AgentChatMessage } from './AgentPanel';

export function RightDock({
  cwd,
  error,
  sessionId,
  agentSessions,
  state,
  messages,
  changes,
  onSend,
  onStop,
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
}: {
  cwd: string;
  error?: string;
  sessionId?: string;
  agentSessions: AgentSessionInfo[];
  state: AgentStatus;
  messages: AgentChatMessage[];
  changes: AgentChange[];
  onSend: (text: string) => void;
  onStop: () => void;
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
}) {
  return (
    <div className="pane">
      <AgentPanel
        cwd={cwd}
        error={error}
        sessionId={sessionId}
        sessions={agentSessions}
        state={state}
        messages={messages}
        changes={changes}
        onSend={onSend}
        onStop={onStop}
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
      />
    </div>
  );
}
