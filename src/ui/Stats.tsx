import { useStore } from './storeContext';
import { fmtMs } from './labels';

const MODE_TAGS = { zetamac: 'zeta', optiver: '80-in-8', focus: 'focus' } as const;

export function Stats() {
  const { store } = useStore();
  const sessions = [...store.sessions].reverse();

  return (
    <div className="page">
      <h2>Stats</h2>
      {sessions.length === 0 ? (
        <div className="empty-state">
          <p>No sessions yet — run a drill and your training curve starts here.</p>
        </div>
      ) : (
        <section>
          <h3>Sessions</h3>
          <table className="sessions-table">
            <thead>
              <tr>
                <th>Date</th><th>Mode</th><th className="num">Score</th>
                <th className="num">Acc</th><th className="num">Median</th>
              </tr>
            </thead>
            <tbody>
              {sessions.slice(0, 50).map((s) => (
                <tr key={s.id}>
                  <td>{new Date(s.startedAt).toLocaleDateString()}</td>
                  <td>
                    <span className="tag">{MODE_TAGS[s.mode]}</span>
                    {s.mode === 'zetamac' && !s.benchmark && <span className="tag">custom</span>}
                    {s.replay && <span className="tag">replay</span>}
                  </td>
                  <td className="num">{s.score}</td>
                  <td className="num">{Math.round(s.accuracy * 100)}%</td>
                  <td className="num">{fmtMs(s.medianMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
