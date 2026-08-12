/**
 * Follow / Following / Follow back.
 *
 * The label is why the person object carries youFollow AND followsYou. A single "following"
 * flag cannot tell a first follow from a follow-back, and those are different acts — one is
 * introducing yourself, the other is answering. The server already distinguishes them; this
 * is the glass that uses both.
 *
 * Counts are never incremented here. The handler returns a fresh person with derived counts;
 * we hand that up. A client-side +1 is a counter column by another name, and the brief said
 * not to add one.
 */
import { useState } from 'react';
import { api, isUnknown } from './api';

export default function FollowButton({ person, onChange, onUnknown }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!person) return null;

  const ref = person.handle || person.id;
  const label = person.youFollow
    ? 'Following'
    : person.followsYou
      ? 'Follow back'
      : 'Follow';

  async function toggle() {
    if (busy || !ref) return;
    setBusy(true);
    setError('');
    try {
      const r = person.youFollow
        ? await api.unfollow(ref)
        : await api.follow(ref);
      onChange?.(r.person);
    } catch (e) {
      // A 404 on a profile that is still painted is how a block announces itself. Collapse
      // the page the same way a direct load does; do not write the server body onto the card.
      if (isUnknown(e)) onUnknown?.();
      else setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="follow-wrap">
      <button
        type="button"
        className={person.youFollow ? 'app-ghost follow-btn' : 'app-cta follow-btn'}
        disabled={busy}
        onClick={toggle}
        aria-pressed={person.youFollow}
      >
        {busy ? '…' : label}
      </button>
      {error && <span className="app-error follow-err">{error}</span>}
    </span>
  );
}
