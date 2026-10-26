import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

/**
 * Minimal stand-in for the XiaoBa Dashboard, for the CatsCo end-to-end test.
 *
 * The state lives in `.e2e/dashboard.json`, rewritten by the test, so a spec can
 * say "the transcript has the answer but the cloud still reports running" — the
 * exact lag that kept the Stop button on. Shapes mirror what
 * `apps/server/src/catsco-chat.ts` reads.
 */
const STATE_FILE = process.argv[2];
const PORT = Number(process.argv[3] || 3871);

const USER = { uid: '1', username: 'e2e', display_name: 'E2E user' };
const BOT = { uid: '2', username: 'e2e-bot', display_name: 'CatsCo', isCurrent: true };
const TOPIC = 'p2p_1_2';

function state() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { taskState: 'idle', messages: [] };
  }
}

function send(res, body) {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
  const current = state();

  if (url.pathname === '/api/cats/status') {
    send(res, { connected: true, user: USER, httpBaseUrl: 'https://e2e.invalid' });
    return;
  }
  if (url.pathname === '/api/cats/bots') {
    send(res, { bots: [BOT], currentBotUid: BOT.uid });
    return;
  }
  if (url.pathname === '/api/cats/conversations') {
    send(res, {
      conversations: [{
        id: TOPIC,
        name: 'e2e round',
        preview: 'plot it',
        project_id: 0,
        last_time: new Date().toISOString(),
        latest_seq: current.messages.length,
        is_agent_task: true,
        task_status: { state: current.taskState, summary: current.taskState },
      }],
    });
    return;
  }
  if (url.pathname === '/api/cats/messages') {
    const limit = Number(url.searchParams.get('limit') || 50);
    send(res, { messages: current.messages.slice(-limit) });
    return;
  }
  if (url.pathname === '/api/cats/config') {
    send(res, { configPath: path.join(path.dirname(STATE_FILE), 'no-account.json') });
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`fake dashboard on ${PORT}`);
});
