import { useState, useRef, useCallback } from 'react';
import { useVoice } from '../hooks/useVoice';

export default function SessionScreen({ session, idx, phase, submittedAnswer, result, showIdeal, attempts, stats,
  onSubmit, onNext, onSkip, onRetry, onToggleIdeal, onGoStart }) {

  const [error, setError] = useState('');
  const taRef = useRef(null);

  const handleTranscript = useCallback((text) => {
    if (!taRef.current) return;
    const ta = taRef.current;
    ta.value += (ta.value && !ta.value.endsWith(' ') ? ' ' : '') + text;
    ta.scrollTop = ta.scrollHeight;
  }, []);

  const { isRecording, hasMic, label, toggle, stop } = useVoice(handleTranscript);

  const handleSubmit = () => {
    const text = taRef.current?.value.trim() || '';
    if (!text) { setError('Please write or speak an answer before submitting.'); return; }
    setError('');
    stop();
    onSubmit(text);
  };

  const handleSkip = () => { stop(); onSkip(); };
  const handleNext = () => { stop(); onNext(); };
  const handleRetry = () => { stop(); onRetry(); };

  const q = session[idx];
  const prog = (idx / session.length) * 100;

  const Header = () => (
    <>
      <div className="hdr">
        <div className="hdr-l">
          {q.s} · Q{idx + 1}/{session.length}
          {attempts > 1 && <span className="atag">Attempt {attempts}</span>}
        </div>
        <div className="hdr-r">
          {stats.answered > 0 && <span className="spill">{stats.avg}% avg</span>}
          <button className="back" onClick={onGoStart}>← Sessions</button>
        </div>
      </div>
      <div className="prog"><div className="prog-fill" style={{ width: `${prog}%` }} /></div>
    </>
  );

  const QuestionCard = () => (
    <div className="qcard">
      <div className="qtags">
        <span className="qtag">{q.s}</span>
        <span className="qtag">Day {q.day}</span>
        <span className="qn">Q{idx + 1} of {session.length}</span>
      </div>
      <div className="qtext">{q.q}</div>
    </div>
  );

  const YourAnswer = () => submittedAnswer ? (
    <div className="your-ans">
      <div className="ya-lbl">Your answer</div>
      <div className="ya-text">{submittedAnswer}</div>
    </div>
  ) : null;

  if (phase === 'question') {
    return (
      <>
        <Header />
        <QuestionCard />
        <div className="voice-row">
          <div className={`rdot${isRecording ? ' on' : ''}`} />
          <span className="vlbl">{label}</span>
          {hasMic && (
            <button className={`vbtn${isRecording ? ' on' : ''}`} onClick={toggle}>
              {isRecording ? '⏹ Stop Voice' : '🎤 Voice'}
            </button>
          )}
        </div>
        <textarea
          ref={taRef}
          className="ans-ta"
          placeholder="Type your answer here, or use the Voice button above..."
          autoFocus
        />
        <div className="ctrl">
          <button className="btn-sub" onClick={handleSubmit}>Submit Answer</button>
          <button className="btn-skip" onClick={handleSkip}>Skip this question</button>
        </div>
        {error && <div className="err">{error}</div>}
      </>
    );
  }

  if (phase === 'thinking') {
    return (
      <>
        <Header />
        <QuestionCard />
        <YourAnswer />
        <div className="thinking">
          <div className="spinner" />
          <span>Evaluating your answer...</span>
        </div>
      </>
    );
  }

  if (phase === 'result' && result) {
    const vc = result.verdict === 'correct' ? 'correct' : result.verdict === 'partial' ? 'partial' : 'incorrect';
    const vi = result.verdict === 'correct' ? '✓' : result.verdict === 'partial' ? '≈' : '✗';
    const vt = result.verdict === 'correct' ? 'Correct' : result.verdict === 'partial' ? 'Partially Correct' : 'Incorrect';
    const isLast = idx + 1 >= session.length;

    return (
      <>
        <Header />
        <QuestionCard />
        <YourAnswer />
        <div className={`rcard ${vc}`}>
          <div className="rv">
            <span className="rv-icon">{vi}</span>
            <span className="rv-lbl">{vt}</span>
            <span className="rv-sc">{result.score}%</span>
          </div>
          {result.strength && result.strength !== 'Nothing significant' && (
            <div className="rrow">
              <div className="rlbl">What you got right</div>
              <div className="rval">{result.strength}</div>
            </div>
          )}
          {result.missing && result.missing !== 'None' && (
            <div className="rrow">
              <div className="rlbl">What was missing</div>
              <div className="rval">{result.missing}</div>
            </div>
          )}
          {result.hint && (
            <div className="rrow">
              <div className="rlbl">Hint for retry</div>
              <div className="rval">{result.hint}</div>
            </div>
          )}
          <button className="itog" onClick={onToggleIdeal}>
            {showIdeal ? 'Hide ideal answer ▲' : 'Show ideal answer ▼'}
          </button>
          {showIdeal && result.ideal && <div className="ibox">{result.ideal}</div>}
        </div>
        <div className="nav">
          {result.verdict !== 'correct' && (
            <button className="nbtn n-r" onClick={handleRetry}>↺ Try Again</button>
          )}
          <button className="nbtn n-nx" onClick={handleNext}>
            {isLast ? 'Finish Session' : 'Next Question →'}
          </button>
          {result.verdict !== 'correct' && (
            <button className="nbtn n-sk" onClick={handleSkip}>Skip</button>
          )}
        </div>
      </>
    );
  }

  return <><Header /><QuestionCard /></>;
}
