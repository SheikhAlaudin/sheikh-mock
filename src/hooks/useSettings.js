import { useState, useCallback } from 'react';

const STORAGE_KEY = 'sheikh-mock-settings';

const DEFAULTS = {
  provider: 'ollama',
  model: '',
  apiKey: '',
};

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch { /* ignore */ }
}

export function useSettings() {
  const [settings, setSettings] = useState(load);

  const update = useCallback((patch) => {
    setSettings(prev => {
      const next = { ...prev, ...patch };
      save(next);
      return next;
    });
  }, []);

  return { settings, update };
}
