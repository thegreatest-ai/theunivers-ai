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
import { ReportButton } from './Safety';

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

/** Plain-text and markdown read in place; a PDF is handed to the browser's embedded viewer. */
function Text({ url }) {
  const [body, setBody] = useState('Loading…');
  useEffect(() => { fetch(url).then((r) => r.text()).then(setBody).catch(() => setBody('Could not open this.')); }, [url]);
  return <pre className="doc-text">{body}</pre>;
}

export default function Works({ userId, own }) {
  const [kind, setKind] = useState('photo');
  const [works, setWorks] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [text, setText] = useState({ title: '', body: '' });
  const fileRef = useRef(null);
  const [viewing, setViewing] = useState(null);

  const spec = KINDS.find((k) => k.id === kind);

  // A failed load used to become an empty list, so "we could not read this" rendered as "you have
  // published nothing" — the most misleading thing a profile can say about its owner.
  const [loadError, setLoadError] = useState('');
  const load = () => api.works(userId, kind)
    .then((d) => { setWorks(d.works || []); setLoadError(''); })
    .catch((e) => { setWorks([]); setLoadError(e.message); });
  useEffect(() => { setWorks(null); setLoadError(''); load(); }, [kind, userId]);

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
      {/* The document reader. Documents open here rather than in a new tab, because a new tab is
          the browser's file viewer with its own download button — outside the app and outside any
          decision we make about it. */}
      {viewing && (
        <div className="sheet-back" onClick={() => setViewing(null)}>
          <div className="doc-view" onClick={(e) => e.stopPropagation()}>
            <header>
              <span>{decodeURIComponent(viewing.filename || 'Document')}</span>
              <button className="app-link" onClick={() => setViewing(null)}>Close</button>
            </header>
            {viewing.mime === 'application/pdf'
              ? <iframe title="Document" src={`${viewing.url}#toolbar=0&navpanes=0`} />
              : <Text url={viewing.url} />}
          </div>
        </div>
      )}
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
      {loadError && <p className="app-error">{spec.label} could not be loaded — {loadError}</p>}
      {!loadError && works?.length === 0 && <p className="app-note">Nothing here yet. {spec.empty}</p>}

      <div className={kind === 'photo' || kind === 'video' ? 'wk-grid' : 'wk-list'}>
        {works?.map((w) => (
          <article key={w.id} className="wk-item">
            {w.kind === 'photo' && w.media[0] && (
              <div className="wk-shot">
                {/* No srcset: there is only ever one size of these bytes. The server has no image
                    library and may not gain one, so a full-size photograph is what exists to
                    offer — see docs/design/PERFORMANCE.md for what that costs and what would fix
                    it. `decoding="async"` at least keeps a 3MB decode off the main thread. */}
                <img src={w.media[0].url} alt={w.title} loading="lazy" decoding="async"
                     draggable={false} onContextMenu={(e) => e.preventDefault()} />
                {w.media.length > 1 && <span className="wk-count">{w.media.length}</span>}
              </div>
            )}
            {w.kind === 'video' && w.media[0] && (
              <video src={w.media[0].url} controls preload="metadata"
                     controlsList="nodownload" disablePictureInPicture
                     onContextMenu={(e) => e.preventDefault()} />
            )}
            {w.kind === 'thread' && (
              <div className="wk-thread">
                {w.title && <h4>{w.title}</h4>}
                <p>{w.body}</p>
              </div>
            )}
            {/* Opened in place rather than linked. A link is a download waiting to happen — the
                browser offers to save it, and the file leaves the platform. */}
            {w.kind === 'doc' && w.media.map((m) => (
              <button key={m.id} className="wk-file" onClick={() => setViewing(m)}>
                {decodeURIComponent(m.filename || 'file')}
                <span className="app-meta">{Math.round(m.bytes / 1024)} KB</span>
              </button>
            ))}

            <div className="wk-foot">
              {/* Shown because it is a promise to other people, not a preference — it decides
                  whether somebody may file this into their research. */}
              <span className="app-meta">
                {w.shareable ? 'May be shared and cited' : 'Not for sharing'}
              </span>
              {!own && <ReportButton kind="work" subject={w.id} />}
              {own && <button className="app-link" onClick={() => drop(w.id)}>Delete</button>}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
