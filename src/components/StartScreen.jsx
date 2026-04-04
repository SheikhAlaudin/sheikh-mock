import { SESSIONS } from '../data/questions';

export default function StartScreen({ onStart }) {
  return (
    <>
      <div className="s-title">Mock Interviewer</div>
      <div className="s-sub">Sheikh · React JS · 8+ years · AI-evaluated</div>
      <div className="info">
        Type your answer directly, or click <b>🎤 Voice</b> to speak — transcription fills the box automatically.
        Click <b>Submit Answer</b> when done.
      </div>
      {SESSIONS.map(s => (
        <div key={s.id} className="sess" onClick={() => onStart(s.id)}>
          <div className="sess-dot" style={{ background: s.col }} />
          <div className="sess-body">
            <div className="sess-name">{s.name}</div>
            <div className="sess-count">{s.sub}</div>
          </div>
          <div className="arr">›</div>
        </div>
      ))}
    </>
  );
}
