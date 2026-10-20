export const LLM_DEFAULT_MODEL = 'deepseek-chat';
export const LLM_DEFAULT_BASE = 'https://api.deepseek.com/v1';

export const LLM_MODELS = [
  { id: 'deepseek-chat', hint: 'Best default for the agent (tools and code)' },
  { id: 'deepseek-reasoner', hint: 'Slower reasoning model' },
] as const;

export interface LlmSettingsView {
  model: string;
  apiBase: string;
  hasKey: boolean;
  keyHint: string;
}

export interface LlmSettingsPut {
  model?: string;
  apiBase?: string;
  apiKey?: string;
}
