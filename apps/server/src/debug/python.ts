import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { DebugFrame, DebugVariable } from '@remotepad/shared';

/**
 * Python debugger: the runner (py-runner.py) is launched with the target script
 * and calls back over loopback. `sys.settrace` gives line events, so breakpoints
 * and stepping need no debugpy install and no project changes.
 */

export interface PyEvents {
  onPaused: (payload: {
    reason: string;
    frames: DebugFrame[];
    variables: DebugVariable[];
  }) => void;
  onResumed: () => void;
  onOutput: (stream: 'stdout' | 'stderr', text: string) => void;
  onExit: (code: number | null) => void;
  onError: (message: string) => void;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const RUNNER = path.join(here, 'py-runner.py');

export class PyBackend {
  private server: net.Server | null = null;
  private socket: net.Socket | null = null;
  private child: ChildProcess | null = null;
  private buffer = '';
  private token = randomBytes(12).toString('hex');
  private exited = false;

  constructor(private script: string, private root: string, private events: PyEvents) {}

  start(breakpoints: { path: string; line: number }[]): void {
    const server = net.createServer((socket) => {
      socket.setEncoding('utf8');
      let first = true;
      socket.on('data', (chunk) => {
        this.buffer += chunk;
        if (first) {
          const index = this.buffer.indexOf('\n');
          if (index < 0) return;
          const token = this.buffer.slice(0, index).trim();
          this.buffer = this.buffer.slice(index + 1);
          first = false;
          if (token !== this.token) {
            this.events.onError('Debugger handshake failed');
            socket.destroy();
            return;
          }
          this.socket = socket;
          this.applyBreakpoints(breakpoints);
        }
        this.drain();
      });
      socket.on('error', () => undefined);
    });
    this.server = server;
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as net.AddressInfo).port;
      this.spawn(port);
    });
    server.on('error', (err) => this.events.onError(err.message));
  }

  private spawn(port: number): void {
    const env = {
      ...process.env,
      RP_DEBUG_PORT: String(port),
      RP_DEBUG_TOKEN: this.token,
      RP_DEBUG_ROOT: this.root,
      PYTHONUNBUFFERED: '1',
    };
    const python = process.env.REMOTEPAD_PYTHON || 'python3';
    let child: ChildProcess;
    try {
      child = spawn(python, ['-u', RUNNER, this.script], {
        cwd: path.dirname(this.script),
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      this.events.onError(err instanceof Error ? err.message : String(err));
      this.events.onExit(1);
      return;
    }
    this.child = child;
    child.stdout?.on('data', (chunk: Buffer) => this.events.onOutput('stdout', chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      // The runner's own startup failures must reach the panel, not the program log.
      if (/RemotePad debugger:/.test(text)) this.events.onError(text.trim());
      else this.events.onOutput('stderr', text);
    });
    child.on('error', (err) => this.events.onError(err.message));
    child.on('exit', (code) => {
      this.exited = true;
      this.events.onExit(code);
    });
  }

  private drain(): void {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      const type = message.type;
      if (type === 'paused') {
        this.events.onPaused({
          reason: String(message.reason || 'breakpoint'),
          frames: (message.frames as DebugFrame[]) || [],
          variables: (message.locals as DebugVariable[]) || [],
        });
      } else if (type === 'resumed') {
        this.events.onResumed();
      } else if (type === 'exit') {
        // the process exit handler reports the code; nothing extra needed
      } else if (type === 'error') {
        this.events.onError(String(message.message || 'Debugger error'));
      } else if (type === 'ready') {
        // handshake complete
      } else if (type === 'variables' || type === 'evaluated') {
        this.onReply?.(message);
      }
    }
  }

  /** Replies to `variables` / `evaluate` requests land here. */
  onReply: ((message: Record<string, unknown>) => void) | null = null;

  send(message: Record<string, unknown>): void {
    if (!this.socket || this.socket.destroyed) return;
    this.socket.write(`${JSON.stringify(message)}\n`);
  }

  applyBreakpoints(breakpoints: { path: string; line: number }[]): void {
    this.send({ type: 'breakpoints', breakpoints });
  }

  resume(): void {
    this.send({ type: 'resume' });
  }

  step(kind: 'over' | 'into' | 'out'): void {
    this.send({ type: kind === 'over' ? 'stepOver' : kind === 'into' ? 'stepInto' : 'stepOut' });
  }

  pause(): void {
    this.send({ type: 'pause' });
  }

  stop(): void {
    this.send({ type: 'stop' });
    try {
      this.socket?.destroy();
    } catch {
      // gone
    }
    if (this.child && !this.exited) {
      this.child.kill('SIGTERM');
      const child = this.child;
      setTimeout(() => {
        try {
          if (!this.exited) child.kill('SIGKILL');
        } catch {
          // gone
        }
      }, 1200).unref();
    }
    this.server?.close();
  }
}
