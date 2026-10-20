import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LLM_DEFAULT_BASE, LLM_DEFAULT_MODEL, type LlmSettingsView } from '@remotepad/shared';

export interface LlmFile {
  model: string;
  apiBase: string;
  apiKey: string;
}

const FILE = path.join(os.homedir(), '.remotepad', 'llm.json');

function clean(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

export function llmSettingsPath(): string {
  return FILE;
}

export function readLlmFile(): LlmFile | null {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8')) as Partial<LlmFile>;
    const model = clean(raw.model, 80);
    const apiBase = clean(raw.apiBase, 200);
    const apiKey = clean(raw.apiKey, 400);
    if (!model && !apiBase && !apiKey) return null;
    return {
      model: model || LLM_DEFAULT_MODEL,
      apiBase: apiBase || LLM_DEFAULT_BASE,
      apiKey,
    };
  } catch {
    return null;
  }
}

export function llmView(): LlmSettingsView {
  const saved = readLlmFile();
  const apiKey = saved?.apiKey || '';
  return {
    model: saved?.model || LLM_DEFAULT_MODEL,
    apiBase: saved?.apiBase || LLM_DEFAULT_BASE,
    hasKey: apiKey.length > 0,
    keyHint: apiKey.length >= 4 ? apiKey.slice(-4) : '',
  };
}

export function writeLlmFile(next: LlmFile): void {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const body = JSON.stringify({
    provider: 'deepseek',
    model: next.model,
    apiBase: next.apiBase,
    apiKey: next.apiKey,
  }, null, 2);
  fs.writeFileSync(FILE, `${body}\n`, { mode: 0o600 });
  try { fs.chmodSync(FILE, 0o600); } catch { /* ignore */ }
}

/** Portal file wins over XiaoBa-CLI `.env` when it has a key. */
export function applyLlmSettingsToEnv(): void {
  const saved = readLlmFile();
  if (!saved?.apiKey) return;
  process.env.GAUZ_LLM_PROVIDER = 'openai';
  process.env.GAUZ_LLM_API_BASE = saved.apiBase;
  process.env.GAUZ_LLM_API_KEY = saved.apiKey;
  process.env.GAUZ_LLM_MODEL = saved.model;
  process.env.GAUZ_LLM_OPENAI_API_MODE = 'chat_completions';
  if (!process.env.GAUZ_LLM_REASONING_EFFORT) process.env.GAUZ_LLM_REASONING_EFFORT = 'high';
}
