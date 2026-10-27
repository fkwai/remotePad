import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { stateDir } from '../e2e/support/prepare';

/**
 * Breakpoints and stepping, end to end through the API the panel uses.
 *
 * Both backends answer the same state shape: paused(frame, frames, variables),
 * resumed, exited. Node goes through the inspector, Python through the tracer —
 * the assertions here are what a reader sees, not which protocol produced them.
 */

const API = `http://127.0.0.1:${process.env.E2E_API_PORT || 3999}`;
const WS = `ws://127.0.0.1:${process.env.E2E_API_PORT || 3999}`;
const fixtures = path.join(stateDir, 'work', 'debug-fixtures');

test.beforeAll(() => {
  fs.mkdirSync(fixtures, { recursive: true });
  fs.writeFileSync(path.join(fixtures, 'app.py'), [
    'def add(a, b):',
    '    total = a + b',
    '    return total',
    '',
    '',
    'result = add(2, 3)',
    'print("result", result)',
  ].join('\n'));
  fs.writeFileSync(path.join(fixtures, 'app.js'), [
    'function add(a, b) {',
    '  const sum = a + b;',
    '  return sum;',
    '}',
    '',
    'const total = add(2, 3);',
    "console.log('total', total);",
  ].join('\n'));
});

interface PausedState {
  status: string;
  reason?: string;
  frame: { path: string; line: number; name: string } | null;
  frames: { name: string; path: string; line: number }[];
  variables: { name: string; value: string }[];
}

async function openSession(file: string, line: number) {
  const res = await fetch(`${API}/api/debug/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: file, breakpoints: [{ path: file, line }] }),
  });
  expect(res.ok).toBe(true);
  const body = await res.json() as { session: { id: string } };
  const socket = new WebSocket(`${WS}/ws/debug?id=${body.session.id}`);
  const messages: Record<string, unknown>[] = [];
  socket.onmessage = (event) => messages.push(JSON.parse(String(event.data)) as Record<string, unknown>);
  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve();
    socket.onerror = () => reject(new Error('debug socket failed'));
  });

  const send = (message: Record<string, unknown>) => socket.send(JSON.stringify(message));
  const waitFor = async (predicate: (message: Record<string, unknown>) => boolean) => {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const hit = messages.find(predicate);
      if (hit) return hit;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    throw new Error(`timed out; saw ${messages.map((item) => item.type).join(',')}`);
  };
  const stop = async () => {
    send({ type: 'stop' });
    socket.close();
    await fetch(`${API}/api/debug/session?id=${encodeURIComponent(body.session.id)}`, { method: 'DELETE' }).catch(() => undefined);
  };
  return { id: body.session.id, send, waitFor, stop, messages };
}

test.describe('debugger', () => {
  test('Python: stops on a breakpoint, steps, reads and evaluates a frame', async () => {
    test.setTimeout(45_000);
    const file = path.join(fixtures, 'app.py');
    const session = await openSession(file, 2);
    try {
      const paused = await session.waitFor((message) => message.type === 'paused');
      const state = paused.state as PausedState;
      expect(state.status).toBe('paused');
      expect(state.reason).toBe('breakpoint');
      expect(state.frame?.path).toBe(file);
      expect(state.frame?.line).toBe(2);
      expect(state.variables.map((item) => `${item.name}=${item.value}`)).toEqual(
        expect.arrayContaining(['a=2', 'b=3']),
      );

      session.send({ type: 'stepOver' });
      const stepped = await session.waitFor((message) => message.type === 'paused'
        && (message.state as PausedState).frame?.line === 3);
      expect((stepped.state as PausedState).variables.map((item) => item.name)).toEqual(
        expect.arrayContaining(['total']),
      );

      session.send({ type: 'evaluate', frameId: 0, expression: 'a + b' });
      const evaluated = await session.waitFor((message) => message.type === 'evaluated');
      expect(evaluated.value).toBe('5');

      session.send({ type: 'resume' });
      const exited = await session.waitFor((message) => message.type === 'exited');
      expect((exited.state as PausedState).status).toBe('exited');
    } finally {
      await session.stop();
    }
  });

  test('JavaScript: entry pause, then the breakpoint, with live values', async () => {
    test.setTimeout(45_000);
    const file = path.join(fixtures, 'app.js');
    const session = await openSession(file, 3);
    try {
      const entry = await session.waitFor((message) => message.type === 'paused');
      expect((entry.state as PausedState).reason).toBe('entry');

      session.send({ type: 'resume' });
      const paused = await session.waitFor((message) => message.type === 'paused'
        && (message.state as PausedState).reason === 'breakpoint');
      const state = paused.state as PausedState;
      expect(state.frame?.path).toBe(file);
      expect(state.frame?.line).toBe(3);
      const values = state.variables.map((item) => `${item.name}=${item.value}`);
      expect(values).toEqual(expect.arrayContaining(['a=2', 'b=3']));

      session.send({ type: 'evaluate', frameId: 0, expression: 'a * 10' });
      const evaluated = await session.waitFor((message) => message.type === 'evaluated');
      expect(evaluated.value).toBe('20');
    } finally {
      await session.stop();
    }
  });

  test('a second Control click cannot kill the server', async () => {
    test.setTimeout(45_000);
    const file = path.join(fixtures, 'app.js');
    const session = await openSession(file, 3);
    try {
      await session.waitFor((message) => message.type === 'paused');
      // Two resumes in a row: the second is "already running", not a crash.
      session.send({ type: 'resume' });
      session.send({ type: 'resume' });
      await new Promise((resolve) => setTimeout(resolve, 800));
      const alive = await fetch(`${API}/api/machine`);
      expect(alive.ok).toBe(true);
    } finally {
      await session.stop();
    }
  });
});
