/**
 * Author asks the operator of this node to look at a limit. There is no panel.
 *
 * Shared because WorkDetail and the Receipts tab would otherwise write two sentences for one
 * act, which is the same drift shared/moderation-actions.mjs exists to stop.
 *
 * No success toast. The caller refetches; what appears next is what the server stored.
 */
import { useState } from 'react';
import { api } from './api';

export function Contest({ commentId, operator, onDone }) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function send(e) {
    e.preventDefault();
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    setError('');
    try {
      await api.appealComment(commentId, text);
      setBody('');
      onDone?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="wk-contest" onSubmit={send}>
      <p className="app-note" style={{ margin: 0 }}>
        Your appeal goes directly to the operator of this node
        {operator ? ` (${operator})` : ''}. There is no panel.
      </p>
      <textarea
        rows={3}
        maxLength={2000}
        value={body}
        placeholder="Anything you want considered"
        onChange={(e) => setBody(e.target.value)}
      />
      <button className="app-cta" disabled={busy || !body.trim()}>
        {busy ? 'Sending…' : 'Ask the operator to look'}
      </button>
      {error && <p className="app-error">{error}</p>}
    </form>
  );
}
