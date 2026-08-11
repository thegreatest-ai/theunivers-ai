/**
 * The four things a person publishes on their profile.
 *
 *   Photos    one image, or several as a carousel
 *   Videos    short clips
 *   Threads   text — the thing that needs no upload at all
 *   Files     documents
 *
 * One component, four kinds. They differ only in what may be attached, and four components would
 * mean four of every fix.
 *
 * `accept` on the input is what makes a phone open the camera roll rather than a file browser, so
 * "upload from your phone or your desktop" is one control rather than two.
 */
import { useEffect, useRef, useState } from 'react';
import { api } from './api';

export const KINDS = [
  { id: 'photo', label: 'Photos', accept: 'image/jpeg,image/png,image/webp,image/heic', multiple: true,
    empty: 'Photographs and carousels.' },
  { id: 'video', label: 'Videos', accept: 'video/mp4,video/quicktime', multiple: false,
    empty: 'Short clips. Large files are capped while storage is on one small volume.' },
  { id: 'thread', label: 'Threads', accept: null, multiple: false,
    empty: 'Something written. No upload needed.' },
  { id: 'doc', label: 'Files', accept: 'application/pdf,text/plain,text/markdown', multiple: true,
    empty: 'Documents others can read — and, if you allow it, build on.' },
];

export default function Works({ userId, own }) {
  const [kind, setKind] = useState('photo');
  const [works, setWorks] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [text, setText] = useState({ title: '', body: '' });
  const fileRef = useRef(null);

  const spec = KINDS.find((k) => k.id === kind);

  const load = () => api.works(userId, kind)
    .then((d) => setWorks(d.works || [])).catch(() => setWorks([]));
  useEffect(() => { setWorks(null); load(); }, [kind, userId]);

  async function addFiles(e) {
    const files = [...(e.target.files || [])];
    if (!files.length) return;
    setBusy('upload'); setError('');
    try {
      const w = await api.createWork({ kind, title: files[0].name });
      // Sequential, not parallel: a carousel has an order, and firing them together would file
      // them in whatever order the network returned.
      for (const f of files) await api.uploadMedia(w.work.id, f);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function addThread(e) {
    e.preventDefault();
    if (!text.body.trim()) return;
    setBusy('thread'); setError('');
    try {
      await api.createWork({ kind: 'thread', title: text.title, body: text.body });
      setText({ title: '', body: '' });
      await load();
    } catch (err) { setError(err.message); } finally { setBusy(''); }
  }

  async function drop(id) {
    if (!confirm('Delete this, and its files?')) return;
    await api.deleteWork(id);
    load();
  }

  return (
    <div className="wk">
      <nav className="you-tabs" aria-label="What you have published">
        {KINDS.map((k) => (
          <button key={k.id} className={kind === k.id ? 'on' : ''} onClick={() => setKind(k.id)}>
            {k.label}
          </button>
        ))}
      </nav>

      {own && (
        <div className="wk-add">
          {kind === 'thread' ? (
            <form onSubmit={addThread}>
              <input placeholder="Title (optional)" value={text.title}
                     onChange={(e) => setText((p) => ({ ...p, title: e.target.value }))} />
              <textarea rows={4} placeholder="Write something worth citing…" value={text.body}
                        onChange={(e) => setText((p) => ({ ...p, body: e.target.value }))} />
              <button className="app-cta" disabled={busy === 'thread' || !text.body.trim()}>
                {busy === 'thread' ? 'Posting…' : 'Post'}
              </button>
            </form>
          ) : (
            <>
              <input ref={fileRef} type="file" accept={spec.accept} multiple={spec.multiple}
                     onChange={addFiles} disabled={Boolean(busy)} />
              <p className="app-note">
                From your phone or your computer. {spec.empty}
              </p>
            </>
          )}
          {error && <p className="app-error">{error}</p>}
        </div>
      )}

      {works === null && <p className="app-note">Loading…</p>}
      {works?.length === 0 && <p className="app-note">Nothing here yet. {spec.empty}</p>}

      <div className={kind === 'photo' || kind === 'video' ? 'wk-grid' : 'wk-list'}>
        {works?.map((w) => (
          <article key={w.id} className="wk-item">
            {w.kind === 'photo' && w.media[0] && (
              <div className="wk-shot">
                <img src={w.media[0].url} alt={w.title} loading="lazy" />
                {w.media.length > 1 && <span className="wk-count">{w.media.length}</span>}
              </div>
            )}
            {w.kind === 'video' && w.media[0] && (
              <video src={w.media[0].url} controls preload="metadata" />
            )}
            {w.kind === 'thread' && (
              <div className="wk-thread">
                {w.title && <h4>{w.title}</h4>}
                <p>{w.body}</p>
              </div>
            )}
            {w.kind === 'doc' && w.media.map((m) => (
              <a key={m.id} className="wk-file" href={m.url}>
                {decodeURIComponent(m.filename || 'file')}
                <span className="app-meta">{Math.round(m.bytes / 1024)} KB</span>
              </a>
            ))}

            <div className="wk-foot">
              {/* Shown because it is a promise to other people, not a preference — it decides
                  whether somebody may file this into their research. */}
              <span className="app-meta">
                {w.shareable ? 'May be shared and cited' : 'Not for sharing'}
              </span>
              {own && <button className="app-link" onClick={() => drop(w.id)}>Delete</button>}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
