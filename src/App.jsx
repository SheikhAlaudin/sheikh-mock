import { useState, useCallback } from 'react';
import { Q, SESSIONS } from './data/questions';
import StartScreen from './components/StartScreen';
import SessionScreen from './components/SessionScreen';
import DoneScreen from './components/DoneScreen';

const API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY || '';

function getStats(history) {
  const ans = history.filter(h => h.verdict !== 'skipped');
  const avg = ans.length ? Math.round(ans.reduce((a, b) => a + b.score, 0) / ans.length) : 0;
  return {
    correct: history.filter(h => h.verdict === 'correct').length,
    partial: history.filter(h => h.verdict === 'partial').length,
    incorrect: history.filter(h => h.verdict === 'incorrect').length,
    skipped: history.filter(h => h.verdict === 'skipped').length,
    avg,
    answered: ans.length,
  };
}

const initial = {
  phase: 'start',
  session: [],
  idx: 0,
  submittedAnswer: '',
  result: null,
  history: [],
  attempts: 0,
  showIdeal: false,
  retrySession: [],
};

export default function App() {
  const [s, setS] = useState(initial);

  const startSession = useCallback((id) => {
    const sess = SESSIONS.find(x => x.id === id);
    const questions = sess.f ? Q.filter(q => q.day === sess.f) : Q.slice();
    setS({ ...initial, phase: 'question', session: questions });
  }, []);

  const goStart = useCallback(() => setS(prev => ({ ...prev, phase: 'start' })), []);

  const skipQ = useCallback(() => {
    setS(prev => {
      const entry = { qId: prev.session[prev.idx].id, verdict: 'skipped', score: 0, attempts: 0 };
      const history = [...prev.history];
      const ei = history.findIndex(h => h.qId === entry.qId);
      if (ei >= 0) history[ei] = entry; else history.push(entry);

      if (prev.idx + 1 >= prev.session.length) {
        return { ...prev, history, phase: 'done', retrySession: prev.session.slice() };
      }
      return { ...prev, history, idx: prev.idx + 1, attempts: 0, submittedAnswer: '', result: null, showIdeal: false, phase: 'question' };
    });
  }, []);

  const nextQ = useCallback(() => {
    setS(prev => {
      if (prev.idx + 1 >= prev.session.length) {
        return { ...prev, phase: 'done', retrySession: prev.session.slice() };
      }
      return { ...prev, idx: prev.idx + 1, attempts: 0, submittedAnswer: '', result: null, showIdeal: false, phase: 'question' };
    });
  }, []);

  const retryQ = useCallback(() => {
    setS(prev => ({ ...prev, submittedAnswer: '', result: null, showIdeal: false, phase: 'question' }));
  }, []);

  const toggleIdeal = useCallback(() => {
    setS(prev => ({ ...prev, showIdeal: !prev.showIdeal }));
  }, []);

  const submitAnswer = useCallback(async (text) => {
    const q = s.session[s.idx];
    setS(prev => ({ ...prev, submittedAnswer: text, phase: 'thinking' }));

    const prompt = `You are a strict but fair senior JavaScript/React technical interviewer. Candidate has 8+ years of experience.

Section: ${q.s}
Question: ${q.q}
Candidate answer: ${text}

Respond with ONLY a raw JSON object. No markdown, no backticks, no explanation outside the JSON:
{"score":<integer 0-100>,"verdict":"correct"|"partial"|"incorrect","strength":"<what they got right in 1 sentence or Nothing significant>","missing":"<key concept(s) missed in 1 sentence or None>","hint":"<Socratic hint without giving answer — empty string if correct>","ideal":"<ideal answer in 2-3 technical sentences>"}`;

    let result;
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      const raw = await res.text();
      let data;
      try { data = JSON.parse(raw); } catch { throw new Error('Non-JSON response: ' + raw.slice(0, 120)); }
      if (data.error) throw new Error('API error: ' + (data.error.message || JSON.stringify(data.error)));
      if (!data.content?.length) throw new Error('API returned empty content');

      const txt = data.content.filter(c => c.type === 'text').map(c => c.text).join('');
      const stripped = txt.replace(/```(?:json)?/gi, '').trim();
      const start = stripped.indexOf('{');
      const end = stripped.lastIndexOf('}');
      if (start === -1 || end <= start) throw new Error('No JSON found in: ' + stripped.slice(0, 120));

      let parsed;
      try { parsed = JSON.parse(stripped.slice(start, end + 1)); } catch (e) { throw new Error('JSON parse failed: ' + e.message); }
      if (typeof parsed.score !== 'number' || !parsed.verdict) throw new Error('Missing required fields');

      parsed.score = Math.max(0, Math.min(100, Math.round(parsed.score)));
      result = parsed;
    } catch (e) {
      result = {
        score: 0, verdict: 'incorrect',
        strength: 'Evaluation error — tap Try Again to resubmit.',
        missing: 'Error detail: ' + e.message.slice(0, 140),
        hint: '', ideal: '',
      };
    }

    setS(prev => {
      const newAttempts = prev.attempts + 1;
      const history = [...prev.history];
      const entry = { qId: q.id, verdict: result.verdict, score: result.score, attempts: newAttempts };
      const ei = history.findIndex(h => h.qId === q.id);
      if (ei >= 0) history[ei] = entry; else history.push(entry);
      return { ...prev, result, history, attempts: newAttempts, phase: 'result' };
    });
  }, [s.session, s.idx]);

  const stats = getStats(s.history);

  if (s.phase === 'start') return <StartScreen onStart={startSession} />;

  if (s.phase === 'done') return (
    <DoneScreen
      stats={stats}
      onNewSession={goStart}
      onRetry={() => setS({ ...initial, phase: 'question', session: s.retrySession })}
    />
  );

  return (
    <SessionScreen
      session={s.session}
      idx={s.idx}
      phase={s.phase}
      submittedAnswer={s.submittedAnswer}
      result={s.result}
      showIdeal={s.showIdeal}
      attempts={s.attempts}
      stats={stats}
      onSubmit={submitAnswer}
      onNext={nextQ}
      onSkip={skipQ}
      onRetry={retryQ}
      onToggleIdeal={toggleIdeal}
      onGoStart={goStart}
    />
  );
}
