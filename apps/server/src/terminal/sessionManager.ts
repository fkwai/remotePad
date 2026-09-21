import os from 'node:os';
import { randomUUID } from 'node:crypto';
import pty from 'node-pty';
import type { TermSessionInfo } from '@remotepad/shared';
import { resolveSafe } from '../paths.ts';
import { buildTerminalEnv } from '../plugins.ts';
import { clearTermPlots } from '../routes/ui.ts';

const MAX_REPLAY = 200_000;

interface Session {
  id: string;
  name: string;
  cwd: string;
  createdAt: number;
  cols: number;
  rows: number;
  proc: pty.IPty | null;
  alive: boolean;
  replay: string;
}

function shell(): string {
  return process.env.SHELL || (os.platform() === 'win32' ? 'powershell.exe' : '/bin/bash');
}

export class SessionManager {
  private sessions = new Map<string, Session>();
  private seq = 1;

  list(): TermSessionInfo[] {
    return [...this.sessions.values()].map((session) => this.info(session));
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  create(opts: { cwd?: string; name?: string; cols?: number; rows?: number }): Session {
    const cwd = opts.cwd ? resolveSafe(opts.cwd) : os.homedir();
    const cols = opts.cols || 80;
    const rows = opts.rows || 24;
    const id = randomUUID();
    const name = opts.name?.trim() || `term-${this.seq++}`;
    const env = buildTerminalEnv(process.env);
    env.REMOTEPAD_TERM_ID = id;
    const proc = pty.spawn(shell(), [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env,
    });
    const session: Session = {
      id,
      name,
      cwd,
      createdAt: Date.now(),
      cols,
      rows,
      proc,
      alive: true,
      replay: '',
    };
    proc.onData((data) => {
      session.replay += data;
      if (session.replay.length > MAX_REPLAY) {
        session.replay = session.replay.slice(-MAX_REPLAY);
      }
    });
    proc.onExit(() => {
      session.alive = false;
      session.proc = null;
    });
    this.sessions.set(id, session);
    return session;
  }

  rename(id: string, name: string): Session {
    const session = this.must(id);
    session.name = name.trim() || session.name;
    return session;
  }

  write(id: string, data: string) {
    const session = this.must(id);
    session.proc?.write(data);
  }

  resize(id: string, cols: number, rows: number) {
    const session = this.must(id);
    session.cols = cols;
    session.rows = rows;
    session.proc?.resize(cols, rows);
  }

  close(id: string) {
    const session = this.must(id);
    try {
      session.proc?.kill();
    } catch {
      // already gone
    }
    this.sessions.delete(id);
    clearTermPlots(id);
  }

  info(session: Session): TermSessionInfo {
    return {
      id: session.id,
      name: session.name,
      cwd: session.cwd,
      createdAt: session.createdAt,
      cols: session.cols,
      rows: session.rows,
      alive: session.alive,
    };
  }

  private must(id: string): Session {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Unknown terminal session ${id}`);
    return session;
  }
}

export const sessions = new SessionManager();
