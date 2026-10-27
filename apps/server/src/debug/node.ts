import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { DebugFrame, DebugVariable } from '@remotepad/shared';
import { config } from '../config.ts';

/**
 * Node debugger over the inspector protocol (CDP).
 *
 * No debugger dependency: `node --inspect-brk` (or `tsx --inspect-brk` for
 * TypeScript) opens a WebSocket that the server speaks directly. Scripts are
 * matched by `file://` URL, so a breakpoint survives a reload of the same file.
 */

export interface PausedPayload {
  reason: string;
  frames: DebugFrame[];
  variables: DebugVariable[];
}

export interface NodeEvents {
  onPaused: (payload: PausedPayload) => void;
  onResumed: () => void;
  onOutput: (stream: 'stdout' | 'stderr', text: string) => void;
  onExit: (code: number | null) => void;
  onError: (message: string) => void;
}

interface CdpFrame {
  callFrameId: string;
  functionName: string;
  url: string;
  location: { scriptId?: string; lineNumber: number; columnNumber: number };
  scopeChain: { type: string; object?: { objectId?: string } }[];
}

interface RemoteObject {
  type: string;
  value?: unknown;
  description?: string;
  objectId?: string;
}

const EXT_TS = new Set(['.ts', '.tsx', '.mts', '.cts']);

function tsxBinary(): string | null {
  const candidates = [
    path.resolve(config.repoRoot, 'apps/server/node_modules/.bin/tsx'),
    path.resolve(config.repoRoot, 'node_modules/.bin/tsx'),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // keep looking
    }
  }
  return null;
}

function toPath(url: string): string {
  if (url.startsWith('file://')) {
    try {
      return fileURLToPath(url);
    } catch {
      return url;
    }
  }
  return url;
}

function render(object: RemoteObject | undefined): string {
  if (!object) return 'undefined';
  if (object.type === 'undefined') return 'undefined';
  if ('value' in object) {
    const value = object.value;
    if (typeof value === 'string') return JSON.stringify(value);
    if (value === null) return 'null';
    return String(value);
  }
  const description = object.description ?? object.type;
  return description.length > 240 ? `${description.slice(0, 240)}…` : description;
}

export class NodeBackend {
  private child: ChildProcess | null = null;
  private socket: WebSocket | null = null;
  private seq = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private cdpFrames: CdpFrame[] = [];
  /** scriptId → url, for frames that come back without their own url. */
  private scripts = new Map<string, string>();
  private breakpoints: { path: string; line: number }[] = [];
  private bpIds = new Map<string, string>();
  private started = false;
  private exited = false;

  constructor(private file: string, private events: NodeEvents) {}

  start(breakpoints: { path: string; line: number }[]): void {
    this.breakpoints = breakpoints;
    const ext = path.extname(this.file).toLowerCase();
    const useTsx = EXT_TS.has(ext);
    const tsx = useTsx ? tsxBinary() : null;
    if (useTsx && !tsx) {
      this.events.onError('tsx is not installed next to the server — cannot run a TypeScript file');
      this.events.onExit(1);
      return;
    }
    const command = tsx || process.execPath;
    const args = ['--inspect-brk=127.0.0.1:0', this.file];
    const env = { ...process.env };
    // An inherited --require/--inspect from a parent shell would attach the
    // wrong inspector; the child must own its port.
    delete env.NODE_OPTIONS;

    let child: ChildProcess;
    try {
      child = spawn(command, args, { cwd: path.dirname(this.file), env, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      this.events.onError(err instanceof Error ? err.message : String(err));
      this.events.onExit(1);
      return;
    }
    this.child = child;

    let stderrBuffer = '';
    child.stdout?.on('data', (chunk: Buffer) => this.events.onOutput('stdout', chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderrBuffer += text;
      const lines = stderrBuffer.split('\n');
      stderrBuffer = lines.pop() || '';
      for (const line of lines) {
        const match = /Debugger listening on (ws:\/\/\S+)/.exec(line);
        if (match && !this.socket) {
          this.connect(match[1]);
          continue;
        }
        if (/^(Debugger attached|For help, see:)/.test(line.trim())) continue;
        // The program is done; Node holds the process until the inspector lets
        // go. Closing here is what turns "finished" into an exit event.
        if (/Waiting for the debugger to disconnect/.test(line)) {
          this.socket?.close();
          continue;
        }
        if (line.trim()) this.events.onOutput('stderr', `${line}\n`);
      }
    });
    child.on('exit', (code) => {
      this.exited = true;
      try {
        this.socket?.close();
      } catch {
        // already closed
      }
      this.events.onExit(code);
    });
    child.on('error', (err) => {
      this.events.onError(err.message);
      this.events.onExit(1);
    });
  }

  private connect(url: string): void {
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.onmessage = (event) => this.onMessage(String(event.data));
    socket.onopen = async () => {
      try {
        await this.send('Runtime.enable');
        await this.send('Debugger.enable');
        this.started = true;
        await this.applyBreakpoints(this.breakpoints);
        // `--inspect-brk` holds the process until the client asks it to run;
        // the entry pause arrives right after, which is the first thing the
        // panel shows (Continue from there).
        await this.send('Runtime.runIfWaitingForDebugger');
        // `--inspect-brk` already reports the entry pause through Debugger.enable;
        // nothing to resume here. The user decides when the program runs.
      } catch (err) {
        this.events.onError(err instanceof Error ? err.message : String(err));
      }
    };
    socket.onerror = () => {
      if (!this.exited) this.events.onError('Inspector connection failed');
    };
  }

  private send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('Debugger is not attached'));
    }
    const id = this.seq++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }

  private onMessage(raw: string): void {
    let message: {
      id?: number;
      result?: unknown;
      error?: { message?: string };
      method?: string;
      params?: Record<string, unknown>;
    };
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (message.id !== undefined) {
      const waiter = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) waiter?.reject(new Error(message.error.message || 'Inspector error'));
      else waiter?.resolve(message.result);
      return;
    }
    if (message.method === 'Debugger.paused') {
      const params = message.params as { reason?: string; callFrames?: CdpFrame[]; hitBreakpoints?: string[] };
      this.cdpFrames = params.callFrames || [];
      const reason = params.hitBreakpoints?.length
        ? 'breakpoint'
        : params.reason === 'Break on start' || params.reason === 'other'
          ? 'entry'
          : params.reason || 'breakpoint';
      void this.reportPaused(reason);
    } else if (message.method === 'Debugger.scriptParsed') {
      const params = message.params as { scriptId?: string; url?: string };
      if (params.scriptId && params.url) this.scripts.set(params.scriptId, params.url);
    } else if (message.method === 'Debugger.resumed') {
      this.cdpFrames = [];
      this.events.onResumed();
    } else if (message.method === 'Runtime.consoleAPICalled') {
      const params = message.params as { type?: string; args?: RemoteObject[] };
      const text = (params.args || []).map((arg) => render(arg)).join(' ');
      this.events.onOutput('stdout', `${text}\n`);
    }
  }

  private frameList(): DebugFrame[] {
    // Node's module loader frames are noise in a call stack meant for reading
    // code; keep the top frame and anything that is a real file.
    return this.cdpFrames
      .map((frame, index) => ({
        id: index,
        name: frame.functionName || '(module)',
        path: toPath(frame.url || (frame.location.scriptId ? this.scripts.get(frame.location.scriptId) : '') || ''),
        line: frame.location.lineNumber + 1,
        column: frame.location.columnNumber + 1,
      }))
      .filter((frame, index) => index === 0 || (frame.path.startsWith('/') && !frame.path.includes('/internal/')));
  }

  private async reportPaused(reason: string): Promise<void> {
    const frames = this.frameList();
    let variables: DebugVariable[] = [];
    try {
      variables = await this.variablesFor(0);
    } catch {
      // a scope object can be gone if the program resumed itself
    }
    this.events.onPaused({ reason, frames, variables });
  }

  private scopeId(frameIndex: number): string | null {
    const frame = this.cdpFrames[frameIndex];
    if (!frame) return null;
    const chain = frame.scopeChain || [];
    const preferred = chain.find((scope) => scope.type === 'local')
      || chain.find((scope) => scope.type === 'closure')
      || chain[0];
    const id = preferred?.object?.objectId;
    return id ?? null;
  }

  async variablesFor(frameIndex: number): Promise<DebugVariable[]> {
    const objectId = this.scopeId(frameIndex);
    if (!objectId) return [];
    const result = await this.send('Runtime.getProperties', {
      objectId,
      ownProperties: true,
      generatePreview: false,
    }) as { result?: (RemoteObject & { name?: string })[] };
    const out: DebugVariable[] = [];
    for (const property of result.result || []) {
      if (!property.name || property.name === 'this') continue;
      const value = (property as { value?: RemoteObject }).value;
      out.push({
        name: property.name,
        value: value ? render(value) : '<accessor>',
        type: value?.type,
      });
      if (out.length >= 100) break;
    }
    return out;
  }

  async evaluate(frameIndex: number, expression: string): Promise<string> {
    const frame = this.cdpFrames[frameIndex];
    if (!frame) throw new Error('Frame is gone');
    const result = await this.send('Debugger.evaluateOnCallFrame', {
      callFrameId: frame.callFrameId,
      expression,
      contextId: undefined,
      returnByValue: false,
      silent: false,
    }) as { result?: RemoteObject; exceptionDetails?: { text?: string; exception?: RemoteObject } };
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails.exception;
      throw new Error(detail ? render(detail) : result.exceptionDetails.text || 'Evaluation failed');
    }
    return render(result.result);
  }

  async applyBreakpoints(breakpoints: { path: string; line: number }[]): Promise<void> {
    this.breakpoints = breakpoints;
    if (!this.started) return;
    const wanted = new Set(breakpoints.map((bp) => `${bp.path}:${bp.line}`));
    for (const [key, id] of this.bpIds) {
      if (wanted.has(key)) continue;
      this.bpIds.delete(key);
      await this.send('Debugger.removeBreakpoint', { breakpointId: id }).catch(() => undefined);
    }
    for (const bp of breakpoints) {
      const key = `${bp.path}:${bp.line}`;
      if (this.bpIds.has(key)) continue;
      try {
        const result = await this.send('Debugger.setBreakpointByUrl', {
          url: pathToFileURL(bp.path).href,
          lineNumber: bp.line - 1,
          columnNumber: 0,
        }) as { breakpointId?: string };
        if (result.breakpointId) this.bpIds.set(key, result.breakpointId);
      } catch {
        // a breakpoint on a blank line is rejected; the UI still shows the dot
      }
    }
  }

  /**
   * Controls are best-effort: pressing Continue twice, or stepping while the
   * program is already running, is a normal mis-click. An unhandled rejection
   * here used to take the whole server down.
   */
  private control(method: string): void {
    this.send(method).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      if (/paused/i.test(message) || /not attached/i.test(message)) return;
      this.events.onError(message);
    });
  }

  resume(): void {
    this.control('Debugger.resume');
  }

  step(kind: 'over' | 'into' | 'out'): void {
    this.control(kind === 'over' ? 'Debugger.stepOver' : kind === 'into' ? 'Debugger.stepInto' : 'Debugger.stepOut');
  }

  pause(): void {
    this.control('Debugger.pause');
  }

  stop(): void {
    try {
      this.socket?.close();
    } catch {
      // already closed
    }
    this.socket = null;
    if (this.child && !this.exited) {
      this.child.kill('SIGTERM');
      const child = this.child;
      setTimeout(() => {
        try {
          if (!this.exited) child.kill('SIGKILL');
        } catch {
          // gone
        }
      }, 1500).unref();
    }
  }
}
