import { useState } from 'react';
import type { DebugFrame, DebugSessionState } from '@remotepad/shared';
import type { DebugApi } from '../useDebug';
import { basename } from '../files';

/**
 * Bottom-region debug view: where the program is, what the frame holds, and the
 * four controls you need to walk code. Text labels, because a teaching tool
 * should not hide its verbs behind icons.
 */
export function DebugPanel({
  debug,
  onReveal,
}: {
  debug: DebugApi;
  onReveal: (path: string, line: number, column: number) => void;
}) {
  const state = debug.state;
  const [expression, setExpression] = useState('');
  const paused = state?.status === 'paused';

  return (
    <div className="debug-panel">
      <div className="debug-bar">
        <span className={`debug-status ${state?.status || 'idle'}`}>
          {state ? state.status : 'idle'}
        </span>
        {state ? (
          <span className="debug-target" title={state.path}>
            {basename(state.path)}
            {state.frame ? `:${state.frame.line}` : ''}
            <span className="debug-lang">{state.language}</span>
          </span>
        ) : (
          <span className="debug-hint-inline">No session — right-click a file → Debug this file (F5)</span>
        )}
        <span className="spacer" />
        {state && state.status !== 'exited' && (
          <>
            <button className="ghost" disabled={!paused} onClick={debug.resume} title="Continue to the next breakpoint">Continue</button>
            <button className="ghost" disabled={!paused} onClick={debug.stepOver} title="Run this line, stop on the next one in this frame">Step over</button>
            <button className="ghost" disabled={!paused} onClick={debug.stepInto} title="Enter the function called on this line">Step into</button>
            <button className="ghost" disabled={!paused} onClick={debug.stepOut} title="Finish this frame and stop in the caller">Step out</button>
            <button className="ghost danger" onClick={debug.stop} title="Kill the debugged program">Stop</button>
          </>
        )}
        {state?.status === 'exited' && (
          <button className="ghost" onClick={debug.stop}>Clear</button>
        )}
      </div>
      {!state && (
        <div className="debug-empty">
          <p>Click a line number to set a breakpoint, then run the file with F5 or the editor menu.</p>
          <p>Works for JavaScript/TypeScript (Node inspector) and Python (built-in tracer).</p>
        </div>
      )}
      {state && (
        <div className="debug-body">
          <div className="debug-frames">
            <div className="debug-head">Call stack</div>
            {state.frames.length === 0 && <div className="debug-none">Not paused</div>}
            {state.frames.map((frame, index) => (
              <button
                key={frame.id}
                type="button"
                className={`debug-frame ${index === 0 ? 'active' : ''}`}
                onClick={() => {
                  debug.selectFrame(frame.id);
                  onReveal(frame.path, frame.line, frame.column || 1);
                }}
                title={`${frame.path}:${frame.line}`}
              >
                <span className="debug-frame-name">{frame.name}</span>
                <span className="debug-frame-where">{basename(frame.path)}:{frame.line}</span>
              </button>
            ))}
          </div>
          <div className="debug-vars">
            <div className="debug-head">Variables</div>
            {state.variables.length === 0 && <div className="debug-none">None in this frame</div>}
            {state.variables.map((variable) => (
              <div className="debug-var" key={variable.name} title={`${variable.name}: ${variable.value}`}>
                <span className="debug-var-name">{variable.name}</span>
                <span className="debug-var-value">{variable.value}</span>
              </div>
            ))}
          </div>
          <div className="debug-side">
            <div className="debug-head">Output</div>
            <div className="debug-output">
              {debug.output.length === 0 ? <div className="debug-none">No output yet</div> : debug.output.slice(-40).map((line, index) => (
                <div key={`${index}-${line.slice(0, 12)}`}>{line}</div>
              ))}
            </div>
            <form
              className="debug-eval"
              onSubmit={(event) => {
                event.preventDefault();
                if (!expression.trim()) return;
                debug.evaluate(expression.trim());
              }}
            >
              <input
                value={expression}
                disabled={!paused}
                spellCheck={false}
                placeholder={paused ? 'Evaluate in this frame (Enter)' : 'Paused only'}
                onChange={(event) => setExpression(event.target.value)}
              />
            </form>
            {debug.evaluation && (
              <div className={`debug-eval-result ${debug.evaluation.error ? 'error' : ''}`}>
                {debug.evaluation.expression} → {debug.evaluation.error || debug.evaluation.value}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function frameLabel(frame: DebugFrame): string {
  return `${frame.name} · ${basename(frame.path)}:${frame.line}`;
}

export function statusLabel(state: DebugSessionState | null): string {
  if (!state) return 'idle';
  if (state.status === 'exited') return `exited${state.exitCode !== undefined ? ` (${state.exitCode})` : ''}`;
  return state.reason ? `${state.status} · ${state.reason}` : state.status;
}
