/** Optional editor viewers. Core (code / folder / diff) is always on. */
export const VIEWER_MODULE_IDS = ['markdown', 'json', 'jsonl', 'csv', 'image', 'html', 'log'] as const;
export type ViewerModuleId = (typeof VIEWER_MODULE_IDS)[number];

export interface ViewerModuleInfo {
  id: ViewerModuleId;
  title: string;
  hint: string;
  extensions: string[];
  /** Shipped modules start on; set false for new ones so they stay opt-in. */
  defaultOn: boolean;
}

export const VIEWER_MODULES: ViewerModuleInfo[] = [
  { id: 'markdown', title: 'Markdown preview', hint: 'md', extensions: ['md', 'markdown'], defaultOn: true },
  { id: 'jsonl', title: 'JSONL cards', hint: 'jsonl ndjson', extensions: ['jsonl', 'ndjson'], defaultOn: true },
  { id: 'json', title: 'JSON tree', hint: 'json', extensions: ['json'], defaultOn: true },
  { id: 'csv', title: 'CSV table', hint: 'csv tsv', extensions: ['csv', 'tsv'], defaultOn: true },
  { id: 'image', title: 'Image preview', hint: 'png jpg … · click pixel for x/y/grey', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'], defaultOn: true },
  { id: 'html', title: 'HTML / plot preview', hint: 'html htm', extensions: ['html', 'htm'], defaultOn: true },
  { id: 'log', title: 'Log viewer', hint: 'log txt', extensions: ['log', 'txt'], defaultOn: true },
];

export type ViewerEnabledMap = Partial<Record<ViewerModuleId, boolean>>;

export interface ModulesResponse {
  catalog: ViewerModuleInfo[];
  enabled: Record<ViewerModuleId, boolean>;
  path: string;
}

export interface ModulesToggleBody {
  id: ViewerModuleId;
  on: boolean;
}

export function isViewerModuleId(value: string): value is ViewerModuleId {
  return (VIEWER_MODULE_IDS as readonly string[]).includes(value);
}

export function defaultViewerEnabled(): Record<ViewerModuleId, boolean> {
  const enabled = {} as Record<ViewerModuleId, boolean>;
  for (const mod of VIEWER_MODULES) enabled[mod.id] = mod.defaultOn;
  return enabled;
}

export function resolveViewerEnabled(overrides: ViewerEnabledMap): Record<ViewerModuleId, boolean> {
  const enabled = defaultViewerEnabled();
  for (const id of VIEWER_MODULE_IDS) {
    if (typeof overrides[id] === 'boolean') enabled[id] = overrides[id]!;
  }
  return enabled;
}
