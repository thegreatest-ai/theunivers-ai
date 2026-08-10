/**
 * /app/mandate — what your agent may do.
 *
 * This used to be step 3 of sign-up, which asked for a price floor and a commodity before anyone
 * had a reason to have either. Those are per-deal decisions, and guessing them during onboarding
 * produced a mandate nobody meant.
 *
 * Until one is set the agent can do nothing — the guard answers NO_MANDATE to every intent. That
 * is the right default: an agent that could act before being told what it may do is the failure
 * this whole product exists to prevent.
 */
import { useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { api } from './api';
import Select from './Select';

export default function Mandate() {
  const { me, setMe } = useOutletContext();
  const nav = useNavigate();
  const current = me?.mandate;

  const [f, setF] = useState({
    commodity: current?.commodity ?? '',
    floor: current?.priceFloor?.amount ?? '',
    ceiling: current?.priceCeiling?.amount ?? '',
    currency: current?.priceFloor?.currency ?? 'AED',
    scope: current?.scope ?? 'negotiate',
    counterpartyMinTier: current?.counterpartyMinTier ?? 'T2',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const set = (k) => (e) => {
    setF((p) => ({ ...p, [k]: e?.target ? e.target.value : e }));
    setError(''); setDone('');
  };

  const ceilingBelowFloor =
    f.ceiling !== '' && f.floor !== '' && Number(f.ceiling) < Number(f.floor);
  const ready = f.commodity.trim() && f.floor !== '' && Number(f.floor) >= 0 && !ceilingBelowFloor;

  async function submit(e) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true); setError(''); setDone('');
    try {
      const r = await api.setMandate({
        commodity: f.commodity.trim(),
        floor: Number(f.floor),
        ceiling: f.ceiling === '' ? null : Number(f.ceiling),
        currency: f.currency,
        scope: f.scope,
        counterpartyMinTier: f.counterpartyMinTier,
      });
      setMe((m) => ({ ...m, mandate: r.mandate }));
      setDone(current ? 'Updated. The previous mandate is retired, not deleted.' : 'Set. Your agent can act within these limits.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-centre">
      <div className="app-card" style={{ width: '100%', maxWidth: 480 }}>
        <h2 style={{ margin: '0 0 4px', fontSize: '1.1rem' }}>What may your agent do?</h2>
        <p className="app-note" style={{ margin: '0 0 18px' }}>
          These limits are enforced in code, not in the model’s judgement. Nothing said in chat can
          widen them.
        </p>

        {!current && (
          <p className="app-note" style={{ marginBottom: 16, lineHeight: 1.55 }}>
            Your agent has no mandate yet, so it cannot act at all. That is deliberate.
          </p>
        )}

        <form onSubmit={submit}>
          <div className="app-field">
            <label>Commodity or domain</label>
            <input value={f.commodity} onChange={set('commodity')}
                   placeholder="what it may trade in — e.g. organic tomatoes" />
            <span className="app-note" style={{ marginTop: 4 }}>
              Anything else is refused before it reaches you.
            </span>
          </div>

          <div className="app-field" style={{ marginTop: 14 }}>
            <label>Price floor — it may never go below this</label>
            <input type="number" inputMode="decimal" value={f.floor} onChange={set('floor')}
                   placeholder="the lowest price you would accept" />
          </div>

          <div className="app-field" style={{ marginTop: 14 }}>
            <label>Price ceiling — optional</label>
            <input type="number" inputMode="decimal" value={f.ceiling} onChange={set('ceiling')}
                   className={ceilingBelowFloor ? 'bad' : ''}
                   placeholder="the most you would pay, if buying" />
            {ceilingBelowFloor && (
              <span className="app-error" style={{ marginTop: 4 }}>
                The ceiling cannot be below the floor.
              </span>
            )}
          </div>

          <div className="app-field" style={{ marginTop: 14 }}>
            <label>Currency</label>
            {/* The currency a floor is AGREED in is the currency it is enforced in, always. It is
                never converted — an FX move would otherwise raise or lower the floor without the
                principal agreeing to anything, and the receipt would still record consent. */}
            <Select value={f.currency} onChange={set('currency')} options={[
              { value: 'AED', label: 'AED — UAE dirham' },
              { value: 'USD', label: 'USD — US dollar' },
              { value: 'INR', label: 'INR — Indian rupee' },
            ]} />
            <span className="app-note" style={{ marginTop: 4 }}>
              Enforced in this currency, never converted.
            </span>
          </div>

          <div className="app-field" style={{ marginTop: 14 }}>
            <label>How far it may go alone</label>
            <Select value={f.scope} onChange={set('scope')} options={[
              { value: 'quote', label: 'Quote only — state a price, nothing more' },
              { value: 'negotiate', label: 'Negotiate — haggle, then bring it back to me' },
              { value: 'commit', label: 'Commit — bind me to the deal' },
            ]} />
            <span className="app-note" style={{ marginTop: 4 }}>
              With “negotiate”, closing a deal becomes a question you answer here.
            </span>
          </div>

          <div className="app-field" style={{ marginTop: 14 }}>
            <label>Minimum standing of who it deals with</label>
            <Select value={f.counterpartyMinTier} onChange={set('counterpartyMinTier')} options={[
              { value: 'T0', label: 'T0 — anyone' },
              { value: 'T1', label: 'T1 — has some anchor' },
              { value: 'T2', label: 'T2 — transactable (recommended)' },
              { value: 'T3', label: 'T3 — proven record' },
              { value: 'T4', label: 'T4 — may vouch for others' },
            ]} />
            <span className="app-note" style={{ marginTop: 4 }}>
              Standing is derived from anchors and completed deals — never granted, never bought.
            </span>
          </div>

          {error && <p className="app-error">{error}</p>}
          {done && <p className="app-notice">{done}</p>}

          <button className="app-cta" style={{ width: '100%', marginTop: 18 }} disabled={!ready || busy}>
            {busy ? 'Saving…' : current ? 'Replace mandate' : 'Set mandate'}
          </button>
          {done && (
            <button type="button" className="app-link" style={{ width: '100%', marginTop: 10 }}
                    onClick={() => nav('/app')}>
              Back to your bridge
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
