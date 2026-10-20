import type { FastifyInstance } from 'fastify';
import { LLM_DEFAULT_BASE, LLM_DEFAULT_MODEL, type LlmSettingsPut } from '@remotepad/shared';
import { agentHost } from '../agent/host.ts';
import { llmView, normalizeMaxTokens, readLlmFile, writeLlmFile } from '../llm-settings.ts';
import { PathError } from '../paths.ts';

function httpsBase(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PathError('API base must be an https URL', 400);
  }
  if (url.protocol !== 'https:') throw new PathError('API base must be https', 400);
  return url.toString().replace(/\/$/, '');
}

export async function registerLlmRoutes(app: FastifyInstance) {
  app.get('/api/llm', async () => llmView());

  app.put<{ Body: LlmSettingsPut }>('/api/llm', async (req) => {
    const body = req.body || {};
    const model = (typeof body.model === 'string' ? body.model.trim() : '') || LLM_DEFAULT_MODEL;
    if (!/^[A-Za-z0-9._:-]{1,80}$/.test(model)) throw new PathError('Invalid model name', 400);
    const apiBase = httpsBase((typeof body.apiBase === 'string' ? body.apiBase.trim() : '') || LLM_DEFAULT_BASE);
    const incoming = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    const previous = readLlmFile();
    const apiKey = incoming || previous?.apiKey || '';
    if (!apiKey) throw new PathError('API key is required', 400);
    if (incoming && (incoming.length < 8 || /[\r\n]/.test(incoming))) throw new PathError('Invalid API key', 400);
    const maxTokens = body.maxTokens !== undefined
      ? normalizeMaxTokens(body.maxTokens)
      : (previous?.maxTokens ?? normalizeMaxTokens(undefined));
    writeLlmFile({ model, apiBase, apiKey, maxTokens });
    agentHost.dropLlmCache();
    return llmView();
  });
}
