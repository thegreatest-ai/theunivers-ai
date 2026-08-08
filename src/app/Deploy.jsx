/**
 * /app/deploy - first run. Three steps, then a READBACK before the agent goes live.
 *
 * The readback is not decoration. Corridor's onboarding state machine has it as a tested
 * invariant ("a complete interview reaches readback before going live"), because the step that
 * follows is an agent acting on your behalf with a price floor you may have typed wrong.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const STEPS = ['Identity', 'Agent', 'Mandate', 'Confirm'];

export default function Deploy() {
  const nav = useNavigate();
  const [i, setI] = useState(0);
  const [f, setF] = useState({
    name: '', kind: 'individual', jurisdiction: 'IN',
    agentName: '', purpose: '',
    commodity: '', floor: '', scope: 'negotiate',
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const canNext =
    (i === 0 && f.name.trim()) ||
    (i === 1 && f.agentName.trim() && f.purpose.trim()) ||
    (i === 2 && f.commodity.trim() && f.floor !== '') ||
    i === 3;

  return (
    <div className="app-centre">
      <div className="app-steps">
        {STEPS.map((s, n) => (
          <span key={s}>
            <span className={n === i ? 'on' : ''}>{s}</span>
            {n < STEPS.length - 1 && <i />}
          </span>
        ))}
      </div>

      <h1 className="app-hero" style={{ fontSize: 'clamp(1.9rem,4vw,2.8rem)' }}>
        {i === 0 && 'Who are you?'}
        {i === 1 && 'Name your agent.'}
        {i === 2 && 'What may it do?'}
        {i === 3 && 'Read this back.'}
      </h1>

      <div className="app-form">
        {i === 0 && (
          <>
            <div className="app-field"><label>Name</label>
              <input value={f.name} onChange={set('name')} placeholder="Ramesh Bhosale" /></div>
            <div className="app-field"><label>You are a</label>
              <select value={f.kind} onChange={set('kind')}>
                <option value="individual">Individual</option>
                <option value="collective">Collective or co-operative</option>
                <option value="business">Registered business</option>
              </select></div>
            <div className="app-field"><label>Jurisdiction</label>
              <select value={f.jurisdiction} onChange={set('jurisdiction')}>
                <option value="IN">India</option><option value="AE">United Arab Emirates</option>
              </select></div>
            <p className="app-note">No incorporation certificate needed. Standing can come from a
              Farmer ID, a co-operative that vouches for you, or a trade licence — whichever you have.</p>
          </>
        )}

        {i === 1 && (
          <>
            <div className="app-field"><label>Agent name</label>
              <input value={f.agentName} onChange={set('agentName')} placeholder="Bhosale Trading" /></div>
            <div className="app-field"><label>What is it for — one sentence</label>
              <textarea rows={3} value={f.purpose} onChange={set('purpose')}
                placeholder="Sells my onion crop into Gulf buyers without me sitting on the phone." /></div>
            <p className="app-note">One agent per person. Not several — a second agent would be a
              place to hide a bad record while keeping your name clean.</p>
          </>
        )}

        {i === 2 && (
          <>
            <div className="app-field"><label>Commodity or domain</label>
              <input value={f.commodity} onChange={set('commodity')} placeholder="onion-red" /></div>
            <div className="app-field"><label>Price floor — it may never go below this</label>
              <input type="number" value={f.floor} onChange={set('floor')} placeholder="18" /></div>
            <div className="app-field"><label>Scope</label>
              <select value={f.scope} onChange={set('scope')}>
                <option value="quote">Quote only — it answers, you decide everything</option>
                <option value="negotiate">Negotiate — it may haggle above your floor</option>
                <option value="commit">Commit — it may agree a deal within the floor</option>
              </select></div>
            <p className="app-note">The floor is enforced outside the model. A limit an agent could
              talk its way past would not be a limit.</p>
          </>
        )}

        {i === 3 && (
          <div className="app-readback">
            <p className="app-meta" style={{ color: 'var(--cyan)' }}>BEFORE IT GOES LIVE</p>
            <dl>
              <dt>You</dt><dd>{f.name || '—'} · {f.kind} · {f.jurisdiction}</dd>
              <dt>Agent</dt><dd>{f.agentName || '—'}</dd>
              <dt>Purpose</dt><dd>{f.purpose || '—'}</dd>
              <dt>Commodity</dt><dd>{f.commodity || '—'}</dd>
              <dt>Floor</dt><dd>{f.floor === '' ? '—' : `${f.floor} per unit — it may never go below`}</dd>
              <dt>Scope</dt><dd>{f.scope}</dd>
            </dl>
            <p className="app-note" style={{ marginTop: 12 }}>
              From the moment you deploy, this agent speaks for you inside these limits. Check the
              floor — it is the number that stops a bad deal.
            </p>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
        {i > 0 && <button className="app-ghost" onClick={() => setI(i - 1)}>Back</button>}
        {i < 3
          ? <button className="app-cta" disabled={!canNext} onClick={() => setI(i + 1)}>Continue</button>
          : <button className="app-cta" onClick={() => nav('/app')}>Deploy agent</button>}
      </div>
    </div>
  );
}
