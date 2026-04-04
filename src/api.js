/**
 * API client — multi-provider backend.
 */
const BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export async function fetchQuestions() {
  const res = await fetch(`${BASE}/api/questions`);
  if (!res.ok) throw new Error('Failed to load questions');
  return res.json();
}

export async function fetchProviders() {
  const res = await fetch(`${BASE}/api/providers`);
  if (!res.ok) throw new Error('Failed to load providers');
  return res.json();
}

export async function evaluateAnswer(questionId, answer, provider, apiKey, model) {
  const res = await fetch(`${BASE}/api/evaluate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question_id: questionId,
      answer,
      provider: provider || 'ollama',
      api_key: apiKey || '',
      model: model || '',
    }),
  });
  if (!res.ok) {
    let detail;
    try { const d = await res.json(); detail = d.detail; } catch { detail = await res.text(); }
    throw new Error(detail || `Evaluation failed (${res.status})`);
  }
  return res.json();
}

export async function transcribeAudio(audioBlob, groqApiKey) {
  const form = new FormData();
  form.append('audio', audioBlob, 'recording.webm');
  form.append('groq_api_key', groqApiKey);

  const res = await fetch(`${BASE}/api/transcribe`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    let detail;
    try { const d = await res.json(); detail = d.detail; } catch { detail = await res.text(); }
    throw new Error(detail || `Transcription failed (${res.status})`);
  }
  const data = await res.json();
  return data.text || '';
}

export async function healthCheck() {
  try {
    const res = await fetch(`${BASE}/api/health`);
    return res.json();
  } catch {
    return { status: 'unreachable', ollama: false };
  }
}
