import { useState, useEffect } from 'react';

// Pre-filled keys from env (public-safe ones only — Groq is set via .env)
const ENV_GROQ_KEY = import.meta.env.VITE_GROQ_API_KEY || '';

export default function SettingsDrawer({ open, onClose, settings, onUpdate, providers }) {
  const [local, setLocal] = useState({ ...settings });
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    if (open) {
      // Auto-fill Groq key from env if user hasn't saved one yet
      const saved = { ...settings };
      if (!saved.apiKey && saved.provider === 'groq' && ENV_GROQ_KEY) {
        saved.apiKey = ENV_GROQ_KEY;
      }
      setLocal(saved);
      setShowKey(false);
    }
  }, [open, settings]);

  const currentProvider = providers.find(p => p.id === local.provider);

  const handleSave = () => {
    onUpdate(local);
    onClose();
  };

  const handleProviderSwitch = (providerId) => {
    const autoKey = providerId === 'groq' && ENV_GROQ_KEY ? ENV_GROQ_KEY : '';
    setLocal({ ...local, provider: providerId, model: '', apiKey: autoKey });
    setShowKey(false);
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
                onClick={() => handleProviderSwitch(p.id)}
              >
                <span className="provider-icon">{providerIcon(p.id)}</span>
                <span className="provider-name">{p.name}</span>
                {p.id === 'groq' && ENV_GROQ_KEY && <span className="provider-badge groq-badge">Key ready</span>}
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
                  type={showKey ? 'text' : 'password'}
                  className="field-input"
                  placeholder={`Paste your ${currentProvider.name} API key...`}
                  value={local.apiKey}
                  onChange={e => setLocal({ ...local, apiKey: e.target.value })}
                  autoComplete="off"
                />
                <button
                  type="button"
                  className="key-toggle"
                  onClick={() => setShowKey(v => !v)}
                  title={showKey ? 'Hide key' : 'Show key'}
                >
                  {showKey ? '🙈' : '👁️'}
                </button>
              </div>
              {local.provider === 'groq' && (
                <p className="field-hint groq-hint">
                  Free tier — 1,000 requests/day. Get your key at{' '}
                  <a href="https://console.groq.com" target="_blank" rel="noreferrer">console.groq.com</a>
                </p>
              )}
              {local.provider !== 'groq' && (
                <p className="field-hint">Stored locally in your browser. Never sent to our servers.</p>
              )}
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
    case 'groq': return '⚡';
    case 'openai': return '🤖';
    case 'anthropic': return '🔮';
    default: return '🔧';
  }
}
