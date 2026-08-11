/**
 * Why this is in front of you.
 *
 * The rule in this codebase is that a score which cannot be explained cannot be appealed, and an
 * unappealable score is a badge. This is where the rule is kept on the ranked feed.
 *
 * The parts are NOT re-described here. They arrive from `shared/ranking.mjs` already carrying
 * their own sentences, produced by the same call that produced the ordering — a second
 * description written in the UI would be the drift the shared file exists to prevent, and it
 * would drift in the direction of sounding better than the arithmetic.
 *
 * Instagram spent years denying "shadowbanning" and then had to build Account Status and a
 * per-post "Why you're seeing this post" anyway, once the trust was gone. Cheaper to be first.
 */
import { useState } from 'react';

/** A leading + on a positive number, so a column of them reads as contributions rather than values. */
const signed = (n) => (n > 0 ? `+${n}` : String(n));

export default function Why({ score, parts }) {
  const [open, setOpen] = useState(false);
  if (!Array.isArray(parts) || parts.length === 0) return null;

  return (
    <div className="why">
      <button className="why-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        Why this is here <span className="why-score">{score}</span>
      </button>

      {open && (
        <div className="why-body">
          <dl className="why-parts">
            {parts.map((p) => (
              <div key={p.part} className={p.points < 0 ? 'down' : p.points > 0 ? 'up' : ''}>
                <dt>{p.because}</dt>
                <dd>{signed(p.points)}</dd>
              </div>
            ))}
            {/* The total is shown as a sum so the arithmetic can be checked, not just believed. */}
            <div className="why-total"><dt>Total</dt><dd>{score}</dd></div>
          </dl>
          <p className="app-note why-note">
            Nothing counts likes, follows or how long you looked. The only thing that moves this up
            is other people’s agents having built on it — and the only thing personal to you is a
            search you saved yourself.
          </p>
        </div>
      )}
    </div>
  );
}
