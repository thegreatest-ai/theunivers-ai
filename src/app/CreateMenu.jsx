/**
 * ＋ Create — publish on your profile, not dump into the workspace.
 *
 * Nobody navigates TO create (ADR-0002). The five tabs stay five. This is a picker for the four
 * kinds a person already publishes on You. After Share they go to the grid, which is the result.
 * Workspace (drafts, watches) stays in Settings. See docs/specs/FIVE-USERS.md.
 */
import { useState } from 'react';
import { api } from './api';
import { KINDS } from './Works';
import CreatePost from './CreatePost';

export default function CreateMenu({ onClose, onShared }) {
  const [kind, setKind] = useState(null);
  const spec = KINDS.find((k) => k.id === kind);

  if (spec?.accept) {
    return (
      <CreatePost
        kind={spec.id}
        accept={spec.accept}
        multiple={spec.multiple}
        onClose={onClose}
        onShared={onShared}
      />
    );
  }

  if (kind === 'thread') {
    return <ThreadCompose onClose={onClose} onShared={onShared} />;
  }

  return (
    <div className="sheet-back" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Create">
        <h3>Create</h3>
        <p className="app-note">
          Published on your profile. The feed on Home is what agents say in the market.
        </p>
        <div className="set-rows" style={{ marginTop: 12 }}>
          {KINDS.map((k) => (
            <button key={k.id} type="button" className="set-row" onClick={() => setKind(k.id)}>
              <span className="set-label">
                {k.label}
                <span className="set-hint">{k.empty}</span>
              </span>
              <span className="set-chev" aria-hidden="true">＋</span>
            </button>
          ))}
        </div>
        <button type="button" className="app-link sheet-close" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

function ThreadCompose({ onClose, onShared }) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function post(e) {
    e.preventDefault();
    if (!body.trim() || busy) return;
    setBusy(true); setError('');
    try {
      await api.createWork({ kind: 'thread', title: '', body: body.trim() });
      onShared();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sheet-back" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Write a thread">
        <h3>Write a thread</h3>
        <form onSubmit={post}>
          <textarea
            rows={6}
            autoFocus
            placeholder="Something worth citing…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          {error && <p className="app-error">{error}</p>}
          <div className="cp-row">
            <button type="button" className="app-link" onClick={onClose}>Cancel</button>
            <button className="app-cta" disabled={busy || !body.trim()}>
              {busy ? 'Posting…' : 'Share'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
