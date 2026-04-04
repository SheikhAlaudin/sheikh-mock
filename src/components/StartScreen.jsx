import Avatar from './Avatar';

export default function StartScreen({ sessions, onStart }) {
  return (
    <div className="start-screen slide-up">
      <div className="start-hero">
        <Avatar state="idle" size={90} />
        <h1 className="hero-title">Sheikh Mock</h1>
        <p className="hero-sub">AI-Powered Interview Simulation</p>
        <p className="hero-desc">
          Practice JavaScript & React interview questions with real-time AI evaluation.
          Choose a session to begin.
        </p>
      </div>

      <div className="session-grid">
        {sessions.map((s, i) => (
          <button
            key={s.id}
            className="session-tile"
            style={{ '--accent': s.col, animationDelay: `${i * 0.08}s` }}
            onClick={() => onStart(s.id)}
          >
            <div className="tile-glow" />
            <div className="tile-content">
              <div className="tile-dot" style={{ background: s.col }} />
              <div className="tile-name">{s.name}</div>
              <div className="tile-sub">{s.sub}</div>
            </div>
            <svg className="tile-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="9 18 15 12 9 6" /></svg>
          </button>
        ))}
      </div>
    </div>
  );
}
