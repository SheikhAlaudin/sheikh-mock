import { useState, useRef, useCallback } from 'react';
import { useVoice } from '../hooks/useVoice';
import { useTypewriter } from '../hooks/useTypewriter';
import Avatar from './Avatar';
import ScoreReveal from './ScoreReveal';
import WaveformVisualizer from './WaveformVisualizer';

export default function SessionScreen({
  session, idx, phase, submittedAnswer, result, showIdeal, attempts, stats,
  onSubmit, onNext, onSkip, onRetry, onToggleIdeal, onGoStart, groqApiKey,
}) {
  const [error, setError] = useState('');
  const taRef = useRef(null);
  const q = session[idx];

  const handleTranscript = useCallback((text) => {
    if (!taRef.current) return;
    const ta = taRef.current;
    ta.value += (ta.value && !ta.value.endsWith(' ') ? ' ' : '') + text;
    ta.scrollTop = ta.scrollHeight;
  }, []);

  const { isRecording, isTranscribing, hasMic, label, error: voiceError, mode, toggle, stop } = useVoice(handleTranscript, groqApiKey);
  const { displayed: typedQuestion, done: typingDone, skip: skipTyping } = useTypewriter(
    phase === 'question' || phase === 'thinking' || phase === 'result' ? q.q : '',
    22
  );

  const handleSubmit = () => {
    const text = taRef.current?.value.trim() || '';
    if (!text) { setError('Write or speak an answer first.'); return; }
    setError('');
    stop();
    onSubmit(text);
  };

  const handleRetry = () => { stop(); if (taRef.current) taRef.current.value = ''; onRetry(); };
  const handleSkip = () => { stop(); onSkip(); };
  const handleNext = () => { stop(); onNext(); };

  const prog = ((idx + (phase === 'result' ? 1 : 0)) / session.length) * 100;

  // Avatar state
  const avatarState =
    phase === 'thinking' ? 'thinking' :
    phase === 'result' && result?.verdict === 'correct' ? 'happy' :
    phase === 'result' && result?.verdict === 'incorrect' ? 'disappointed' :
    (!typingDone && phase === 'question') ? 'speaking' :
    'idle';

  return (
    <div className="interview-screen slide-up">
      {/* Top bar */}
      <div className="interview-top">
        <button className="ghost-btn" onClick={onGoStart}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="15 18 9 12 15 6" /></svg>
          Back
        </button>
        <div className="interview-meta">
          <span className="meta-section">{q.s}</span>
          <span className="meta-divider">·</span>
          <span className="meta-progress">Q{idx + 1}/{session.length}</span>
          {attempts > 1 && <span className="meta-attempt">Attempt {attempts}</span>}
        </div>
        {stats.answered > 0 && <span className="avg-badge">{stats.avg}%</span>}
      </div>

      {/* Progress */}
      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${prog}%` }} />
      </div>

      {/* Interviewer area */}
      <div className="interviewer-area">
        <Avatar state={avatarState} size={72} />
        <div className="interviewer-bubble">
          <div className="bubble-tags">
            <span className="bubble-tag">{q.s}</span>
            <span className="bubble-tag">Day {q.day}</span>
          </div>
          <p className="bubble-text" onClick={!typingDone ? skipTyping : undefined}>
            {typedQuestion}
            {!typingDone && <span className="cursor-blink">|</span>}
          </p>
          {!typingDone && <p className="tap-hint">tap to skip animation</p>}
        </div>
      </div>

      {/* Answer phase */}
      {phase === 'question' && (
        <div className="answer-area slide-up">
          <div className="voice-controls">
            <WaveformVisualizer active={isRecording} />
            <span className="voice-label">{isTranscribing ? 'Transcribing...' : label}</span>
            {mode !== 'none' && hasMic && (
              <div className="voice-right">
                <span className="voice-mode-badge">
                  {mode === 'whisper' ? '⚡ Whisper' : '🌐 Browser'}
                </span>
                <button
                  className={`voice-toggle${isRecording ? ' active' : ''}${isTranscribing ? ' transcribing' : ''}`}
                  onClick={toggle}
                  disabled={isTranscribing}
                >
                  {isTranscribing ? '...' : isRecording ? '⏹ Stop' : '🎤 Voice'}
                </button>
              </div>
            )}
          </div>
          {voiceError && <div className="inline-error">{voiceError}</div>}
          <textarea
            ref={taRef}
            className="answer-input"
            placeholder="Type or speak your answer..."
            autoFocus
          />
          {error && <div className="inline-error">{error}</div>}
          <div className="answer-actions">
            <button className="action-btn primary" onClick={handleSubmit}>
              Submit Answer
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
            </button>
            <button className="action-btn ghost" onClick={handleSkip}>Skip</button>
          </div>
        </div>
      )}

      {/* Thinking phase */}
      {phase === 'thinking' && (
        <div className="thinking-area slide-up">
          <div className="your-answer-box">
            <span className="ya-label">Your answer</span>
            <p className="ya-text">{submittedAnswer}</p>
          </div>
          <div className="thinking-indicator">
            <div className="think-dots">
              <span /><span /><span />
            </div>
            <span>Evaluating your answer...</span>
          </div>
        </div>
      )}

      {/* Result phase */}
      {phase === 'result' && result && (
        <div className="result-area slide-up">
          <div className="your-answer-box">
            <span className="ya-label">Your answer</span>
            <p className="ya-text">{submittedAnswer}</p>
          </div>

          <div className={`result-panel ${result.verdict}`}>
            <div className="result-top">
              <ScoreReveal score={result.score} verdict={result.verdict} />
              <div className="result-verdict-info">
                <span className="verdict-text">
                  {result.verdict === 'correct' ? 'Correct' : result.verdict === 'partial' ? 'Partially Correct' : 'Incorrect'}
                </span>
                {result.strength && result.strength !== 'Nothing significant' && (
                  <div className="feedback-row">
                    <span className="fb-label">Strength</span>
                    <p className="fb-value">{result.strength}</p>
                  </div>
                )}
                {result.missing && result.missing !== 'None' && (
                  <div className="feedback-row">
                    <span className="fb-label">Missing</span>
                    <p className="fb-value">{result.missing}</p>
                  </div>
                )}
              </div>
            </div>

            {result.hint && (
              <div className="hint-box">
                <span className="hint-icon">💡</span>
                <p>{result.hint}</p>
              </div>
            )}

            <button className="ideal-btn" onClick={onToggleIdeal}>
              {showIdeal ? 'Hide ideal answer ▲' : 'Show ideal answer ▼'}
            </button>
            {showIdeal && result.ideal && (
              <div className="ideal-answer">{result.ideal}</div>
            )}
          </div>

          <div className="answer-actions">
            {result.verdict !== 'correct' && (
              <button className="action-btn outline" onClick={handleRetry}>↺ Try Again</button>
            )}
            <button className="action-btn primary" onClick={handleNext}>
              {idx + 1 >= session.length ? 'Finish Session' : 'Next Question →'}
            </button>
            {result.verdict !== 'correct' && (
              <button className="action-btn ghost ml-auto" onClick={handleSkip}>Skip</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
