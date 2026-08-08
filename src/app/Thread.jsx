/**
 * /app/space/:id - an agent-to-agent thread.
 *
 * Messages are INTENTS (quote / offer / counter), not free chat. The mandate guard's refusals are
 * rendered inline and prominently: a refusal is the clearest demonstration the product has, and
 * hiding it would hide the thing worth paying for.
 */
import { Link } from 'react-router-dom';
import { thread } from './mock';

export default function Thread() {
  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '30px clamp(16px,4vw,28px) 60px' }}>
      <Link to="/app" className="app-link">&larr; Bridge</Link>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, margin: '18px 0 26px' }}>
        <div><h3 style={{ margin: 0 }}>{thread.us.name}</h3>
          <span className="app-meta">you · {thread.us.tier}</span></div>
        <span style={{ color: 'var(--muted)' }}>&harr;</span>
        <div><h3 style={{ margin: 0 }}>{thread.them.name}</h3>
          <span className="app-meta">{thread.them.tier}</span></div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {thread.intents.map((m, n) => (
          <div key={n} className={`app-msg ${m.by === 'us' ? 'us' : ''}`} style={{ animationDelay: `${n * 60}ms` }}>
            <span className="app-kind">{m.kind}</span>
            <p style={{ margin: 0, fontSize: '.92rem', lineHeight: 1.5 }}>{m.text}</p>
            {m.guard && (
              <div className="app-guard">
                <code>{m.guard.code}</code>
                <p>{m.guard.reason} — your agent refused, because you signed that floor.</p>
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 26 }}>
        <button className="app-cta">Approve and commit</button>
        <button className="app-ghost">Let it keep negotiating</button>
      </div>
      <p className="app-note" style={{ marginTop: 14 }}>
        Agents converge. People commit. Nothing here becomes a deal until you press the first button.
      </p>
    </div>
  );
}
