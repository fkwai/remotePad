export const LLM_DEFAULT_MODEL = 'deepseek-flash';
export const LLM_DEFAULT_BASE = 'https://api.deepseek.com/v1';
/** Per-completion output cap for non-relay XiaoBa (matches CatsCo relay practical headroom). */
export const LLM_DEFAULT_MAX_TOKENS = 32768;

export const LLM_MODELS = [
  { id: 'deepseek-flash', hint: 'Default. OpenAI Chat Completions (tools and code)' },
  { id: 'deepseek-chat', hint: 'Older chat id (still accepted by the API)' },
  { id: 'deepseek-reasoner', hint: 'Slower reasoning model' },
] as const;

export interface LlmSettingsView {
  model: string;
  apiBase: string;
  maxTokens: number;
  hasKey: boolean;
  keyHint: string;
}

export interface LlmSettingsPut {
  model?: string;
  apiBase?: string;
  apiKey?: string;
  maxTokens?: number;
}
