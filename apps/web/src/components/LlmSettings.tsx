import { useEffect, useState } from 'react';
import { LLM_DEFAULT_BASE, LLM_DEFAULT_MODEL, LLM_MODELS, type LlmSettingsView } from '@remotepad/shared';
import { api } from '../api';

export function LlmSettings() {
  const [model, setModel] = useState(LLM_DEFAULT_MODEL);
  const [apiBase, setApiBase] = useState(LLM_DEFAULT_BASE);
  const [apiKey, setApiKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [keyHint, setKeyHint] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    api<LlmSettingsView>('/api/llm')
      .then((view) => {
        if (!live) return;
        setModel(view.model);
        setApiBase(view.apiBase);
        setHasKey(view.hasKey);
        setKeyHint(view.keyHint);
      })
      .catch((err: Error) => {
        if (live) setNote(err.message);
      });
    return () => { live = false; };
  }, []);

  async function save() {
    setBusy(true);
    setNote('');
    try {
      const view = await api<LlmSettingsView>('/api/llm', {
        method: 'PUT',
        body: JSON.stringify({
          model: model.trim() || LLM_DEFAULT_MODEL,
          apiBase: apiBase.trim() || LLM_DEFAULT_BASE,
          apiKey: apiKey.trim(),
        }),
      });
      setModel(view.model);
      setApiBase(view.apiBase);
      setHasKey(view.hasKey);
      setKeyHint(view.keyHint);
      setApiKey('');
      setNote('Saved. The next Agent message uses this model.');
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="llm-form">
      <label>
        Model
        <input
          type="text"
          list="llm-models"
          value={model}
          spellCheck={false}
          onChange={(event) => setModel(event.target.value)}
        />
        <datalist id="llm-models">
          {LLM_MODELS.map((item) => <option key={item.id} value={item.id}>{item.hint}</option>)}
        </datalist>
      </label>
      <div className="kv">{LLM_MODELS.find((item) => item.id === model)?.hint || 'Custom model id'}</div>
      <label>
        API base
        <input type="text" value={apiBase} spellCheck={false} onChange={(event) => setApiBase(event.target.value)} />
      </label>
      <label>
        API key
        <input
          type="password"
          value={apiKey}
          placeholder={hasKey ? `saved ····${keyHint}` : 'sk-…'}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setApiKey(event.target.value)}
        />
      </label>
      <div className="kv">Stored in ~/.remotepad/llm.json. Leave the key blank to keep the saved one.</div>
      <button type="button" className="llm-save" disabled={busy} onClick={() => void save()}>
        {busy ? 'Saving…' : 'Save model'}
      </button>
      {note && <div className="kv">{note}</div>}
    </div>
  );
}
