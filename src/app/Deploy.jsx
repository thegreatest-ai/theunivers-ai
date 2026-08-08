/**
 * /app/deploy — first run. Calls the pilot API; returns an agent API token to connect your AI.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setAgentToken, hasSession } from './api';
import { useEffect } from 'react';

const STEPS = ['Identity', 'Agent', 'Mandate', 'Confirm'];

export default function Deploy() {
  const nav = useNavigate();
  const [i, setI] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [f, setF] = useState({
    name: '', kind: 'individual', jurisdiction: 'IN',
    agentName: '', purpose: '',
    commodity: '', floor: '', scope: 'negotiate',
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  useEffect(() => {
    if (!hasSession()) nav('/app/signin');
  }, [nav]);

  const canNext =
    (i === 0 && f.name.trim()) ||
    (i === 1 && f.agentName.trim() && f.purpose.trim()) ||
    (i === 2 && f.commodity.trim() && f.floor !== '') ||
    i === 3;

  async function deploy() {
    setBusy(true);
    setError('');
    try {
      const data = await api.deploy({
        name: f.name,
        kind: f.kind,
        jurisdiction: f.jurisdiction,
        agentName: f.agentName,
        purpose: f.purpose,
        commodity: f.commodity,
        floor: Number(f.floor),
        scope: f.scope,
      });
      setAgentToken(data.agentToken);
      setDone(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="app-centre">
        <p className="kicker">Agent live</p>
        <h1 className="app-hero" style={{ fontSize: 'clamp(1.9rem,4vw,2.8rem)' }}>
          Connect your AI
        </h1>
        <p className="app-note">
          Paste this token into your agent / MCP / Cursor skill. It is shown once here — copy it now.
        </p>
        <div className="app-readback" style={{ maxWidth: 520 }}>
          <p className="app-meta" style={{ color: 'var(--cyan)' }}>AGENT API TOKEN</p>
          <code style={{
            display: 'block', wordBreak: 'break-all', fontFamily: 'Space Grotesk, monospace',
            fontSize: '.9rem', color: '#eef1fb', marginTop: 8,
          }}>{done.agentToken}</code>
          <p className="app-meta" style={{ marginTop: 16 }}>Skill doc</p>
          <p style={{ fontSize: '.9rem' }}>{done.skillUrl || '/agent/skill.md'}</p>
          <p className="app-note" style={{ marginTop: 12 }}>
            Your agent: call <code>GET /api/agent/me</code> with this Bearer token, then
            message you via <code>POST /api/messages</code>. Always run
            <code> POST /api/agent/intents/check</code> before offers.
          </p>
        </div>
        <button className="app-cta" style={{ marginTop: 16 }} onClick={() => nav('/app')}>
          Open Bridge ✦
        </button>
      </div>
    );
  }

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
          </>
        )}

        {i === 1 && (
          <>
            <div className="app-field"><label>Agent name</label>
              <input value={f.agentName} onChange={set('agentName')} placeholder="Bhosale Trading" /></div>
            <div className="app-field"><label>What is it for — one sentence</label>
              <textarea rows={3} value={f.purpose} onChange={set('purpose')}
                placeholder="Sells my onion crop into Gulf buyers without me sitting on the phone." /></div>
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
                <option value="quote">Quote only</option>
                <option value="negotiate">Negotiate</option>
                <option value="commit">Commit</option>
              </select></div>
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
              <dt>Floor</dt><dd>{f.floor === '' ? '—' : `${f.floor} — never below`}</dd>
              <dt>Scope</dt><dd>{f.scope}</dd>
            </dl>
          </div>
        )}
      </div>

      {error && <p className="app-note" style={{ color: '#f87171' }}>{error}</p>}

      <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
        {i > 0 && <button className="app-ghost" onClick={() => setI(i - 1)}>Back</button>}
        {i < 3
          ? <button className="app-cta" disabled={!canNext} onClick={() => setI(i + 1)}>Continue</button>
          : <button className="app-cta" disabled={busy} onClick={deploy}>
              {busy ? 'Deploying…' : 'Deploy agent ✦'}
            </button>}
      </div>
    </div>
  );
}
