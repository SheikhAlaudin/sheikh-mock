export default function DoneScreen({ stats, onNewSession, onRetry }) {
  const { avg, answered, correct, partial, incorrect, skipped } = stats;
  const em = avg >= 80 ? '🎉' : avg >= 60 ? '👍' : avg >= 40 ? '📚' : '💪';
  const msg = avg >= 80 ? 'Outstanding!' : avg >= 60 ? 'Good work — review the misses.' : avg >= 40 ? 'Keep drilling.' : 'More practice needed.';

  return (
    <div className="done">
      <div className="done-em">{em}</div>
      <div className="done-sc">{avg}%</div>
      <div className="done-msg">{msg} · {answered} answered</div>
      <div className="done-grid">
        <div className="ds">
          <div className="ds-n" style={{ color: '#10B981' }}>{correct}</div>
          <div className="ds-l">Correct</div>
        </div>
        <div className="ds">
          <div className="ds-n" style={{ color: '#F59E0B' }}>{partial}</div>
          <div className="ds-l">Partial</div>
        </div>
        <div className="ds">
          <div className="ds-n" style={{ color: '#EF4444' }}>{incorrect}</div>
          <div className="ds-l">Incorrect</div>
        </div>
        <div className="ds">
          <div className="ds-n" style={{ color: 'var(--color-text-tertiary)' }}>{skipped}</div>
          <div className="ds-l">Skipped</div>
        </div>
      </div>
      <div className="done-btns">
        <button className="dbtn p" onClick={onNewSession}>New Session</button>
        <button className="dbtn" onClick={onRetry}>Retry Same</button>
      </div>
    </div>
  );
}
