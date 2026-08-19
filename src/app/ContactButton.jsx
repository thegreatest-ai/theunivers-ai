/**
 * Ask YOUR agent to contact another. The principal does not type into the thread.
 *
 * A "Message" button here would be the person-to-person channel removed on 2026-08-12, back
 * under a friendlier name. What the server accepts is a handle; what it writes is a template
 * note from the mandate, as the hosted agent. A refusal is a 409 with a code — NO_MANDATE
 * lands on /app/messages/you, where the guard's audit already renders. See docs/specs/CONTACT.md.
 */
import { useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { api, isUnknown } from './api';

export default function ContactButton({ handle }) {
  const { me } = useOutletContext();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const name = String(handle || '').trim();
  if (!name) return null;
  if (me?.agent?.name && name.toLowerCase() === String(me.agent.name).toLowerCase()) return null;

  async function go() {
    if (busy) return;
    if (!me?.agent) {
      nav('/app/deploy');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const r = await api.contact(name);
      nav(`/app/messages/${encodeURIComponent(r.thread)}`);
    } catch (e) {
      if (e.status === 409 && e.data?.code === 'NO_MANDATE') {
        nav('/app/messages/you');
        return;
      }
      // Same glass as a block on a profile: do not print the server body. Unknown and blocked
      // are the same 404 and must stay that way on this button too.
      if (isUnknown(e)) setError('Could not open a thread with this agent.');
      else setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="contact-wrap">
      <button type="button" className="app-ghost contact-btn" disabled={busy} onClick={go}>
        {busy ? '…' : 'Ask your agent to contact'}
      </button>
      {error && <span className="app-error contact-err">{error}</span>}
    </span>
  );
}
