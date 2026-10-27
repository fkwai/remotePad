import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  DebugClientMessage,
  DebugServerMessage,
  DebugSessionState,
} from '@remotepad/shared';
import { api } from './api';

export interface DebugApi {
  state: DebugSessionState | null;
  /** Program output, newest last (trimmed). */
  output: string[];
  evaluation: { expression: string; value: string; error?: string } | null;
  start: (path: string, breakpoints: { path: string; line: number }[]) => Promise<void>;
  stop: () => void;
  resume: () => void;
  stepOver: () => void;
  stepInto: () => void;
  stepOut: () => void;
  pause: () => void;
  selectFrame: (frameId: number) => void;
  evaluate: (expression: string) => void;
  syncBreakpoints: (breakpoints: { path: string; line: number }[]) => void;
}

/**
 * Debug session for the bottom panel.
 *
 * The session lives on the server (a child process plus a debugger attachment);
 * this hook only mirrors its state over `/ws/debug` and forwards controls.
 */
export function useDebug(onError: (message: string) => void): DebugApi {
  const [state, setState] = useState<DebugSessionState | null>(null);
  const [output, setOutput] = useState<string[]>([]);
  const [evaluation, setEvaluation] = useState<DebugApi['evaluation']>(null);
  const socket = useRef<WebSocket | null>(null);
  const sessionId = useRef<string | null>(null);
  const errorRef = useRef(onError);
  errorRef.current = onError;

  const send = useCallback((message: DebugClientMessage) => {
    const ws = socket.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  }, []);

  const connect = useCallback((id: string) => {
    socket.current?.close();
    sessionId.current = id;
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/debug?id=${encodeURIComponent(id)}`);
    socket.current = ws;
    ws.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as DebugServerMessage;
      if (message.type === 'state' || message.type === 'paused' || message.type === 'resumed' || message.type === 'exited') {
        setState(message.state);
        if (message.type === 'resumed') setEvaluation(null);
      } else if (message.type === 'output') {
        const lines = message.text.split('\n').filter((line) => line.length > 0);
        if (!lines.length) return;
        setOutput((prev) => [...prev, ...lines].slice(-300));
      } else if (message.type === 'variables') {
        setState((prev) => (prev ? { ...prev, variables: message.variables } : prev));
      } else if (message.type === 'evaluated') {
        setEvaluation({ expression: message.expression, value: message.value, error: message.error });
      } else if (message.type === 'error') {
        errorRef.current(message.message);
      }
    };
    ws.onclose = () => {
      if (socket.current === ws) socket.current = null;
    };
  }, []);

  const start = useCallback(async (path: string, breakpoints: { path: string; line: number }[]) => {
    try {
      setOutput([]);
      setEvaluation(null);
      const res = await api<{ session: DebugSessionState }>('/api/debug/start', {
        method: 'POST',
        body: JSON.stringify({ path, breakpoints }),
      });
      setState(res.session);
      connect(res.session.id);
    } catch (err) {
      errorRef.current(err instanceof Error ? err.message : String(err));
    }
  }, [connect]);

  const stop = useCallback(() => {
    const id = sessionId.current;
    socket.current?.close();
    socket.current = null;
    sessionId.current = null;
    setState(null);
    setEvaluation(null);
    if (id) void api(`/api/debug/session?id=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => undefined);
  }, []);

  const syncBreakpoints = useCallback((breakpoints: { path: string; line: number }[]) => {
    send({ type: 'breakpoints', breakpoints });
  }, [send]);

  useEffect(() => () => socket.current?.close(), []);

  return {
    state,
    output,
    evaluation,
    start,
    stop,
    resume: () => send({ type: 'resume' }),
    stepOver: () => send({ type: 'stepOver' }),
    stepInto: () => send({ type: 'stepInto' }),
    stepOut: () => send({ type: 'stepOut' }),
    pause: () => send({ type: 'pause' }),
    selectFrame: (frameId) => send({ type: 'variables', frameId }),
    evaluate: (expression) => send({ type: 'evaluate', frameId: 0, expression }),
    syncBreakpoints,
  };
}
