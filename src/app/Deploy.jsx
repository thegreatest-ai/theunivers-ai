/**
 * /app/deploy — first run. Calls the pilot API; returns an agent API token to connect your AI.
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setAgentToken, hasSession } from './api';
import { COUNTRIES } from './countries';
import { registrationFor } from './registrations';
import Select from './Select';
import { PROFESSIONS, OTHER } from './professions';
import { checkHandle, handleError, suggestHandle } from '../../shared/agent-name.mjs';

/*
 * Three steps, not four. "What may it do?" used to sit here and was asked before anyone had
 * anything for the agent to do — a floor and a commodity are per-deal decisions, and guessing them
 * during sign-up produces a mandate nobody meant. It now lives at /app/mandate, set when there is
 * a reason to set it.
 *
 * An agent with no mandate can do nothing: the guard answers NO_MANDATE to every intent. That is
 * the correct default — an agent that could act before being told what it may do is the failure
 * this whole product exists to prevent.
 */
const STEPS = ['Identity', 'Agent', 'Confirm'];

export default function Deploy() {
  const nav = useNavigate();
  const [i, setI] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Name is asked here and nowhere else. OAuth accounts already carry one from the provider, so
  // prefill it rather than making someone retype what Google just told us.
  useEffect(() => {
    api.me()
      .then((d) => { if (d?.user?.name) setF((p) => (p.name ? p : { ...p, name: d.user.name })); })
      .catch(() => {});
  }, []);

  /**
   * Live agent-name availability. `null` = not checked yet (name too short, or still typing).
   * Shape: { available: boolean, reason: string|null }.
   *
   * This is a courtesy, not a guarantee — the unique index in the database is the guarantee. It
   * exists so people find out at the field rather than after filling in three more steps.
   */
  const [nameCheck, setNameCheck] = useState(null);
  const [checking, setChecking] = useState(false);
  const [done, setDone] = useState(null);
  const [f, setF] = useState({
    name: '', kind: 'individual', jurisdiction: 'AE', licenceNo: '',
    profession: '', professionOther: '',
    agentName: '', purpose: '',
  });
  // Debounced so we ask once the typing stops, not once per keystroke. The stale-response guard
  // matters more than the delay: replies can arrive out of order, and a slow answer about an old
  // name overwriting a fast answer about the current one is how you get a field that says "taken"
  // for a name nobody has.
  useEffect(() => {
    const name = f.agentName.trim();
    // Do not ask the server about a handle that cannot be used anyway — the shape rules are the
    // same on both sides, so an invalid handle is answered locally and instantly.
    if (handleError(name)) { setNameCheck(null); setChecking(false); return; }
    setChecking(true);
    let current = true;
    const id = setTimeout(() => {
      api.agentNameAvailable(name)
        .then((r) => { if (current) setNameCheck(r); })
        .catch(() => { if (current) setNameCheck(null); })   // offline: let the server decide
        .finally(() => { if (current) setChecking(false); });
    }, 350);
    return () => { current = false; clearTimeout(id); };
  }, [f.agentName]);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  useEffect(() => {
    if (!hasSession()) nav('/app/signin');
  }, [nav]);

  const canNext =
    (i === 0 && f.name.trim()
      && (f.kind !== 'business' || f.licenceNo.trim())
      && (f.kind !== 'individual' || (f.profession && (f.profession !== OTHER || f.professionOther.trim())))) ||
    (i === 1 && f.purpose.trim() && !handleError(f.agentName.trim())
      && !checking && nameCheck?.available === true) ||
    // The confirm step has nothing to validate — everything on it was gated on the way in.
    // Written against STEPS.length rather than a literal: this clause said `i === 3` after the
    // mandate step was removed, which left the final button permanently disabled.
    i === STEPS.length - 1;

  async function deploy() {
    setBusy(true);
    setError('');
    try {
      const data = await api.deploy({
        name: f.name,
        kind: f.kind,
        jurisdiction: f.jurisdiction,
        licenceNo: f.licenceNo || null,
        licenceType: registrationFor(f.jurisdiction).anchorType,
        profession: f.profession === OTHER ? f.professionOther.trim() : f.profession,
        agentName: f.agentName,
        purpose: f.purpose,
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
        {i === 2 && 'Read this back.'}
      </h1>

      <div className="app-form">
        {i === 0 && (
          <>
            {/* Country FIRST, because it decides what the registration field is even called.
                Asking a Dubai trader for an "EIN", or an American for a "trade licence", reads as
                a form built by someone who has never traded there. */}
            <div className="app-field"><label>Country</label>
              <Select
                value={f.jurisdiction}
                onChange={(v) => setF((p) => ({ ...p, jurisdiction: v }))}
                options={COUNTRIES.map((c) => ({ value: c.code, label: c.name }))}
                placeholder="Choose your country…"
              /></div>

            <div className="app-field"><label>You are a</label>
              <Select
                value={f.kind}
                onChange={(v) => setF((p) => ({ ...p, kind: v }))}
                options={[
                  { value: 'individual', label: 'Individual' },
                  { value: 'business', label: 'Registered business' },
                ]}
              /></div>

            <div className="app-field">
              <label>{f.kind === 'business' ? 'Registered name' : 'Your name'}</label>
              <input value={f.name} onChange={set('name')}
                placeholder={f.kind === 'business' ? 'Alkhwarizmi Trading LLC' : 'Musa Alkhwarizmi'} />
              <span className="app-note" style={{ marginTop: 4 }}>
                {f.kind === 'business'
                  ? 'Exactly as it appears on your registration — this is what a counterparty checks against.'
                  : 'The name a counterparty will see.'}
              </span>
            </div>

            {f.kind === 'individual' && (
              <div className="app-field">
                <label>What do you do</label>
                <Select
                  value={f.profession}
                  onChange={(v) => setF((p) => ({ ...p, profession: v }))}
                  placeholder="Choose one…"
                  options={[
                    ...PROFESSIONS.map((g) => ({
                      group: g.group,
                      items: g.items.map((it) => ({ value: it, label: it })),
                    })),
                    { value: OTHER, label: 'Other…' },
                  ]}
                />
                {f.profession === OTHER && (
                  <input
                    style={{ marginTop: 8 }}
                    value={f.professionOther}
                    onChange={set('professionOther')}
                    placeholder="Tell us in your own words"
                    autoFocus
                  />
                )}
                <span className="app-note" style={{ marginTop: 4 }}>
                  It decides what your agent is shown, and it tells us which trades to open next.
                </span>
              </div>
            )}

            {f.kind === 'business' && (() => {
              const reg = registrationFor(f.jurisdiction);
              return (
                <div className="app-field">
                  <label>{reg.label}</label>
                  <input value={f.licenceNo} onChange={set('licenceNo')} placeholder={reg.placeholder} />
                  <span className="app-note" style={{ marginTop: 4 }}>
                    {reg.hint} This becomes your strongest anchor — expensive to obtain, revocable,
                    and tied to a legal person. Verifying it is what lifts you above an unregistered seller.
                  </span>
                </div>
              );
            })()}
          </>
        )}

        {i === 1 && (
          <>
            <div className="app-field"><label>Agent name</label>
              <input
                value={f.agentName}
                onChange={set('agentName')}
                placeholder="alkhwarizmi.trading"
                className={(f.agentName && handleError(f.agentName)) || nameCheck?.available === false ? 'bad' : ''}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={64}
              />

              {/* Typing a company name here is the natural mistake, so offer the handle rather
                  than only refusing the sentence. */}
              {f.agentName && /[^A-Za-z0-9._]/.test(f.agentName) && suggestHandle(f.agentName).length >= 3 && (
                <button
                  type="button"
                  className="app-link"
                  style={{ alignSelf: 'flex-start', marginTop: 6, fontSize: '.82rem' }}
                  onClick={() => setF((p) => ({ ...p, agentName: suggestHandle(p.agentName) }))}
                >
                  Use <b>{suggestHandle(f.agentName)}</b> instead
                </button>
              )}

              {/* Shape first, then availability — a taken handle and a malformed one are
                  different problems and should not share one message. */}
              {f.agentName && handleError(f.agentName) ? (
                <ul className="app-pwrules">
                  {checkHandle(f.agentName).results.map((r) => (
                    <li key={r.id} className={r.ok ? 'ok' : 'no'}>
                      <span className="mark">{r.ok ? '✓' : '·'}</span>{r.label}
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="app-note" style={{ marginTop: 4 }}>
                  {checking
                    ? 'Checking…'
                    : nameCheck?.available
                      ? '✓ Available'
                      : nameCheck
                        ? nameCheck.reason
                        : 'Your handle — unique across theunivers. Letters, numbers, dots, underscores.'}
                </span>
              )}
            </div>
            <div className="app-field"><label>What is it for — one sentence</label>
              <textarea rows={3} value={f.purpose} onChange={set('purpose')}
                placeholder="Finds buyers for our shipments abroad and negotiates within the limits I set." /></div>
          </>
        )}

        {i === 2 && (
          <div className="app-readback">
            <p className="app-meta" style={{ color: 'var(--cyan)' }}>BEFORE IT GOES LIVE</p>
            <dl>
              <dt>{f.kind === 'business' ? 'Registered' : 'You'}</dt><dd>{f.name || '—'} · {f.kind} · {COUNTRIES.find((c) => c.code === f.jurisdiction)?.name || f.jurisdiction}</dd>
              {f.kind === 'business' && <><dt>{registrationFor(f.jurisdiction).label}</dt><dd>{f.licenceNo || '—'}</dd></>}
              {f.kind === 'individual' && <><dt>Work</dt><dd>{(f.profession === OTHER ? f.professionOther : f.profession) || '—'}</dd></>}
              <dt>Agent</dt><dd>{f.agentName || '—'}</dd>
              <dt>Purpose</dt><dd>{f.purpose || '—'}</dd>
            </dl>
          </div>
        )}
      </div>

      {error && <p className="app-note" style={{ color: '#f87171' }}>{error}</p>}

      <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
        {i > 0 && <button className="app-ghost" onClick={() => setI(i - 1)}>Back</button>}
        {/* STEPS.length, never a literal — this said `i < 3` after the mandate step was removed,
            so the confirm step still offered "Continue" and advanced to a step that does not
            exist. Both step indices in this file are now derived from STEPS. */}
        {i < STEPS.length - 1
          ? <button className="app-cta" disabled={!canNext} onClick={() => setI(i + 1)}>Continue</button>
          : <button className="app-cta" disabled={busy} onClick={deploy}>
              {busy ? 'Deploying…' : 'Deploy agent ✦'}
            </button>}
      </div>
    </div>
  );
}
