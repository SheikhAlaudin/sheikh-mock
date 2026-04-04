import { useState, useCallback, useEffect } from 'react';
import { fetchQuestions, fetchProviders, evaluateAnswer, generateQuestions } from './api';
import { useSettings } from './hooks/useSettings';
import Particles from './components/Particles';
import StatusBar from './components/StatusBar';
import SettingsDrawer from './components/SettingsDrawer';
import StartScreen from './components/StartScreen';
import SessionScreen from './components/SessionScreen';
import DoneScreen from './components/DoneScreen';

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
  sessions: [],
  questions: [],
  providers: [],
  idx: 0,
  submittedAnswer: '',
  result: null,
  history: [],
  attempts: 0,
  showIdeal: false,
  retrySession: [],
  loading: true,
  settingsOpen: false,
};

export default function App() {
  const [s, setS] = useState(initial);
  const { settings, update: updateSettings } = useSettings();

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const [qData, pData] = await Promise.all([fetchQuestions(), fetchProviders()]);
        if (cancelled) return;
        setS(prev => ({
          ...prev,
          questions: qData.questions,
          sessions: qData.sessions,
          providers: pData.providers,
          loading: false,
        }));
      } catch {
        if (cancelled) return;
        setS(prev => ({ ...prev, loading: false }));
      }
    }
    init();
    return () => { cancelled = true; };
  }, []);

  const currentProvider = s.providers.find(p => p.id === settings.provider);

  const startSession = useCallback((id) => {
    setS(prev => {
      const sess = prev.sessions.find(x => x.id === id);
      const questions = sess.filter
        ? prev.questions.filter(q => q.day === sess.filter)
        : prev.questions.slice();
      return { ...prev, phase: 'question', session: questions, idx: 0, history: [], attempts: 0, submittedAnswer: '', result: null, showIdeal: false };
    });
  }, []);

  const goStart = useCallback(() => setS(prev => ({ ...prev, phase: 'start' })), []);

  const startAISession = useCallback(async (topic, count) => {
    setS(prev => ({ ...prev, loading: true }));
    try {
      const data = await generateQuestions(
        settings.provider,
        settings.apiKey,
        settings.model,
        topic,
        count,
      );
      setS(prev => ({
        ...prev,
        loading: false,
        phase: 'question',
        session: data.questions,
        idx: 0,
        history: [],
        attempts: 0,
        submittedAnswer: '',
        result: null,
        showIdeal: false,
      }));
    } catch (e) {
      alert('Failed to generate questions: ' + e.message);
      setS(prev => ({ ...prev, loading: false }));
    }
  }, [settings]);
  const openSettings = useCallback(() => setS(prev => ({ ...prev, settingsOpen: true })), []);
  const closeSettings = useCallback(() => setS(prev => ({ ...prev, settingsOpen: false })), []);

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

    let result;
    try {
      result = await evaluateAnswer(
        q.id,
        text,
        settings.provider,
        settings.apiKey,
        settings.model,
      );
      result.score = Math.max(0, Math.min(100, Math.round(result.score)));
    } catch (e) {
      result = {
        score: 0, verdict: 'incorrect',
        strength: 'Evaluation error — try again.',
        missing: e.message.slice(0, 200),
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
  }, [s.session, s.idx, settings]);

  const stats = getStats(s.history);

  return (
    <div className="app">
      <Particles />

      <div className="app-content">
        {/* Header with settings */}
        <div className="app-header">
          <StatusBar
            provider={currentProvider}
            settings={settings}
            onOpenSettings={openSettings}
          />
        </div>

        {/* Loading */}
        {s.loading && (
          <div className="loading">
            <div className="think-dots"><span /><span /><span /></div>
            <p>Connecting...</p>
          </div>
        )}

        {/* Screens */}
        {!s.loading && s.phase === 'start' && (
          <StartScreen sessions={s.sessions} onStart={startSession} onGenerateAI={startAISession} />
        )}
        {!s.loading && s.phase === 'done' && (
          <DoneScreen
            stats={stats}
            onNewSession={goStart}
            onRetry={() => setS(prev => ({ ...prev, phase: 'question', session: prev.retrySession, idx: 0, history: [], attempts: 0, submittedAnswer: '', result: null, showIdeal: false }))}
          />
        )}
        {!s.loading && ['question', 'thinking', 'result'].includes(s.phase) && (
          <SessionScreen
            session={s.session} idx={s.idx} phase={s.phase}
            submittedAnswer={s.submittedAnswer} result={s.result}
            showIdeal={s.showIdeal} attempts={s.attempts} stats={stats}
            onSubmit={submitAnswer} onNext={nextQ} onSkip={skipQ}
            onRetry={retryQ} onToggleIdeal={toggleIdeal} onGoStart={goStart}
            groqApiKey={settings.provider === 'groq' ? settings.apiKey : (import.meta.env.VITE_GROQ_API_KEY || '')}
          />
        )}
      </div>

      {/* Settings drawer */}
      <SettingsDrawer
        open={s.settingsOpen}
        onClose={closeSettings}
        settings={settings}
        onUpdate={updateSettings}
        providers={s.providers}
      />
    </div>
  );
}
