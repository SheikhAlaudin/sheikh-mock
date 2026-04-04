import { useState, useEffect } from 'react';

export default function SettingsDrawer({ open, onClose, settings, onUpdate, providers }) {
  const [local, setLocal] = useState({ ...settings });

  useEffect(() => {
    if (open) setLocal({ ...settings });
  }, [open, settings]);

  const currentProvider = providers.find(p => p.id === local.provider);

  const handleSave = () => {
    onUpdate(local);
    onClose();
  };

  if (!open) return null;

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={e => e.stopPropagation()}>
        <div className="drawer-header">
          <h2 className="drawer-title">Settings</h2>
          <button className="drawer-close" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div className="drawer-body">
          {/* Provider selection */}
          <label className="field-label">LLM Provider</label>
          <div className="provider-grid">
            {providers.map(p => (
              <button
                key={p.id}
                className={`provider-card${local.provider === p.id ? ' active' : ''}`}
                onClick={() => setLocal({ ...local, provider: p.id, model: '', apiKey: local.provider === p.id ? local.apiKey : '' })}
              >
                <span className="provider-icon">{providerIcon(p.id)}</span>
                <span className="provider-name">{p.name}</span>
                {!p.needs_key && <span className="provider-badge">Free</span>}
              </button>
            ))}
          </div>

          {/* API key */}
          {currentProvider?.needs_key && (
            <>
              <label className="field-label">{currentProvider.name} API Key</label>
              <div className="key-input-wrap">
                <input
                  type="password"
                  className="field-input"
                  placeholder={`Paste your ${currentProvider.name} API key...`}
                  value={local.apiKey}
                  onChange={e => setLocal({ ...local, apiKey: e.target.value })}
                  autoComplete="off"
                />
              </div>
              <p className="field-hint">Stored locally in your browser. Never sent to our servers.</p>
            </>
          )}

          {/* Model selection */}
          {currentProvider && (
            <>
              <label className="field-label">Model</label>
              <select
                className="field-select"
                value={local.model || currentProvider.default_model}
                onChange={e => setLocal({ ...local, model: e.target.value })}
              >
                {currentProvider.models.map(m => (
                  <option key={m} value={m}>{m}{m === currentProvider.default_model ? ' (default)' : ''}</option>
                ))}
              </select>
            </>
          )}
        </div>

        <div className="drawer-footer">
          <button className="btn-save" onClick={handleSave}>Save Settings</button>
        </div>
      </div>
    </div>
  );
}

function providerIcon(id) {
  switch (id) {
    case 'ollama': return '🖥️';
    case 'gemini': return '💎';
    case 'openai': return '🤖';
    case 'anthropic': return '🔮';
    default: return '⚡';
  }
}
