import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  DebugClientMessage,
  DebugFrame,
  DebugLanguage,
  DebugSessionState,
  DebugStatus,
  DebugVariable,
} from '@remotepad/shared';
import { NodeBackend } from './node.ts';
import { PyBackend } from './python.ts';

/**
 * One running debug target, normalized across Node and Python so the UI only
 * knows frames / variables / controls.
 */

const PY = new Set(['.py', '.pyw']);
const NODE = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts']);

export function languageFor(file: string): DebugLanguage | null {
  const ext = path.extname(file).toLowerCase();
  if (PY.has(ext)) return 'python';
  if (NODE.has(ext)) return 'node';
  return null;
}

type Socket = { send: (data: string) => void };

export class DebugSession {
  id = randomUUID();
  status: DebugStatus = 'starting';
  createdAt = Date.now();
  frames: DebugFrame[] = [];
  variables: DebugVariable[] = [];
  reason?: string;
  exitCode?: number | null;
  error?: string;
  private breakpoints: { path: string; line: number }[] = [];
  private subscribers = new Set<Socket>();
  private backend: NodeBackend | PyBackend;
  private outputTail: string[] = [];

  constructor(public language: DebugLanguage, public path: string) {
    const events = {
      onPaused: (payload: { reason: string; frames: DebugFrame[]; variables: DebugVariable[] }) => {
        this.status = 'paused';
        this.frames = payload.frames;
        this.variables = payload.variables;
        this.reason = payload.reason;
        this.broadcast({ type: 'paused', state: this.state() });
      },
      onResumed: () => {
        this.status = 'running';
        this.frames = [];
        this.variables = [];
        this.broadcast({ type: 'resumed', state: this.state() });
      },
      onOutput: (stream: 'stdout' | 'stderr', text: string) => {
        this.outputTail.push(text);
        if (this.outputTail.length > 200) this.outputTail.splice(0, this.outputTail.length - 200);
        this.broadcast({ type: 'output', stream, text });
      },
      onExit: (code: number | null) => {
        this.status = 'exited';
        this.exitCode = code;
        this.frames = [];
        this.broadcast({ type: 'exited', state: this.state() });
      },
      onError: (message: string) => {
        this.error = message;
        this.broadcast({ type: 'error', message });
      },
    };
    this.backend = language === 'python'
      ? new PyBackend(path, pathOfRoot(path), events)
      : new NodeBackend(path, events);
  }

  start(breakpoints: { path: string; line: number }[]): void {
    this.breakpoints = breakpoints;
    if (this.backend instanceof PyBackend) this.backend.start(breakpoints);
    else this.backend.start(breakpoints);
  }

  state(): DebugSessionState {
    return {
      id: this.id,
      language: this.language,
      path: this.path,
      status: this.status,
      createdAt: this.createdAt,
      reason: this.reason,
      frame: this.frames[0] ?? null,
      frames: this.frames,
      variables: this.variables,
      exitCode: this.exitCode,
      error: this.error,
    };
  }

  attach(socket: Socket): void {
    this.subscribers.add(socket);
    socket.send(JSON.stringify({ type: 'state', state: this.state() }));
  }

  detach(socket: Socket): void {
    this.subscribers.delete(socket);
  }

  private broadcast(message: Record<string, unknown>): void {
    const data = JSON.stringify(message);
    for (const socket of this.subscribers) {
      try {
        socket.send(data);
      } catch {
        this.subscribers.delete(socket);
      }
    }
  }

  handle(message: DebugClientMessage): void {
    switch (message.type) {
      case 'breakpoints':
        this.breakpoints = message.breakpoints || [];
        if (this.backend instanceof PyBackend) this.backend.applyBreakpoints(this.breakpoints);
        else void this.backend.applyBreakpoints(this.breakpoints);
        break;
      case 'resume':
        this.backend.resume();
        break;
      case 'stepOver':
        this.backend.step('over');
        break;
      case 'stepInto':
        this.backend.step('into');
        break;
      case 'stepOut':
        this.backend.step('out');
        break;
      case 'pause':
        this.backend.pause();
        break;
      case 'stop':
        this.stop();
        break;
      case 'variables':
        void this.variablesFor(message.frameId);
        break;
      case 'evaluate':
        void this.evaluate(message.frameId, message.expression);
        break;
      default:
        break;
    }
  }

  private async variablesFor(frameId: number): Promise<void> {
    if (this.backend instanceof PyBackend) {
      this.backend.onReply = (payload) => {
        if (payload.type !== 'variables') return;
        this.broadcast({
          type: 'variables',
          frameId: Number(payload.frameId),
          variables: payload.variables as DebugVariable[],
        });
      };
      this.backend.send({ type: 'variables', frameId });
      return;
    }
    try {
      const variables = await this.backend.variablesFor(frameId);
      this.broadcast({ type: 'variables', frameId, variables });
    } catch (err) {
      this.broadcast({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  private async evaluate(frameId: number, expression: string): Promise<void> {
    if (this.backend instanceof PyBackend) {
      this.backend.onReply = (payload) => {
        if (payload.type !== 'evaluated') return;
        this.broadcast({
          type: 'evaluated',
          frameId: Number(payload.frameId),
          expression: String(payload.expression),
          value: String(payload.value ?? ''),
          error: payload.error ? String(payload.error) : undefined,
        });
      };
      this.backend.send({ type: 'evaluate', frameId, expression });
      return;
    }
    try {
      const value = await this.backend.evaluate(frameId, expression);
      this.broadcast({ type: 'evaluated', frameId, expression, value });
    } catch (err) {
      this.broadcast({
        type: 'evaluated',
        frameId,
        expression,
        value: '',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  stop(): void {
    this.backend.stop();
    if (this.status !== 'exited') {
      this.status = 'exited';
      this.frames = [];
      this.broadcast({ type: 'exited', state: this.state() });
    }
    sessions.delete(this.id);
  }
}

function pathOfRoot(file: string): string {
  // The runner only stops on lines under this root, so stepping never dives
  // into the standard library. The file's repository (or its own directory)
  // is the boundary the reader expects.
  let dir = path.dirname(file);
  for (let i = 0; i < 64; i += 1) {
    if (
      exists(path.join(dir, '.git'))
      || exists(path.join(dir, 'pyproject.toml'))
      || exists(path.join(dir, 'setup.py'))
    ) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.dirname(file);
}

function exists(target: string): boolean {
  try {
    return fs.existsSync(target);
  } catch {
    return false;
  }
}

export const sessions = new Map<string, DebugSession>();

export function startSession(file: string, breakpoints: { path: string; line: number }[]): DebugSession {
  const language = languageFor(file);
  if (!language) throw new Error('Only JavaScript/TypeScript and Python can be debugged');
  if (sessions.size >= 4) throw new Error('Too many debug sessions — stop one first');
  // A session for the same file is never reused: the UI start button means
  // "run this file again", and a stale process would keep the old breakpoints.
  for (const session of [...sessions.values()]) {
    if (session.path === file) session.stop();
  }
  const session = new DebugSession(language, file);
  sessions.set(session.id, session);
  session.start(breakpoints);
  return session;
}
