// One DeepSeek call. The key stays in the environment, not in this file.
//
//   DEEPSEEK_API_KEY=sk-... node playground/testapi.mjs
//
// Optional:
//   DEEPSEEK_MODEL=deepseek-chat   (default)
//   DEEPSEEK_BASE=https://api.deepseek.com

const key = process.env.DEEPSEEK_API_KEY || 'sk-014ab53972ba4a1b85ae2eb49db611ee';
const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const base = (process.env.DEEPSEEK_BASE || 'https://api.deepseek.com/v1').replace(/\/$/, '');

if (!key) {
  console.error('Set DEEPSEEK_API_KEY, then re-run. The key is not stored in this file.');
  process.exit(1);
}

const url = `${base}/chat/completions`;
const res = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${key}`,
  },
  body: JSON.stringify({
    model,
    messages: [{ role: 'user', content: 'Reply with the single word pong.' }],
    max_tokens: 16,
  }),
});

const text = await res.text();
let body;
try {
  body = JSON.parse(text);
} catch {
  body = null;
}

if (!res.ok) {
  const msg = body?.error?.message || text.slice(0, 400);
  console.error(`HTTP ${res.status} ${url}`);
  console.error(msg);
  process.exit(1);
}

const reply = body?.choices?.[0]?.message?.content ?? text;
console.log(`model: ${body?.model || model}`);
console.log(String(reply).trim());
