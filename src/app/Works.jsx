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
 * Clicking a tile opens WorkDetail at the original ratio, without zoom. The profile grid
 * is square for every post (cdda5cb) and applies each image's zoom inside that crop. The
 * bytes are never cropped — WorkDetail is the original, with the action row, caption and
 * comments. Same overlay for all four kinds.
 *
 * Publishing a photo, video or file opens CreatePost: a room between the picker and the
 * upload, so a ratio can be chosen before any byte is sent. The file input's onChange is
 * no longer the commit.
 */
import { useEffect, useState } from 'react';
import { api } from './api';
import { ReportButton } from './Safety';
import WorkDetail from './WorkDetail';
import CreatePost from './CreatePost';
import { cropStyle } from '../../shared/media-zoom.mjs';

export const KINDS = [
  { id: 'photo', label: 'Photos', accept: 'image/jpeg,image/png,image/webp,image/heic', multiple: true,
    empty: 'Photographs and carousels.', invite: 'Share your first photo' },
  { id: 'video', label: 'Videos', accept: 'video/mp4,video/quicktime', multiple: false,
    empty: 'Short clips. Large files are capped while storage is on one small volume.',
    invite: 'Share your first video' },
  { id: 'thread', label: 'Threads', accept: null, multiple: false,
    empty: 'Something written. No upload needed.', invite: 'Write your first thread' },
  { id: 'doc', label: 'Files', accept: 'application/pdf,text/plain,text/markdown', multiple: true,
    empty: 'Documents others can read — and, if you allow it, build on.',
    invite: 'Share your first file' },
];

export default function Works({ userId, own }) {
  const [kind, setKind] = useState('photo');
  const [works, setWorks] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [text, setText] = useState({ title: '', body: '' });
  const [open, setOpen] = useState(null);
  const [creating, setCreating] = useState(false);

  const spec = KINDS.find((k) => k.id === kind);

  // A failed load used to become an empty list, so "we could not read this" rendered as "you have
  // published nothing" — the most misleading thing a profile can say about its owner.
  const [loadError, setLoadError] = useState('');
  const load = () => api.works(userId, kind)
    .then((d) => { setWorks(d.works || []); setLoadError(''); })
    .catch((e) => { setWorks([]); setLoadError(e.message); });
  useEffect(() => { setWorks(null); setLoadError(''); load(); }, [kind, userId]);

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

  return (
    <div className="wk">
      {open && (
        <WorkDetail
          work={open}
          own={own}
          onClose={() => setOpen(null)}
          onChanged={() => load()}
        />
      )}
      {creating && spec.accept && (
        <CreatePost
          kind={kind}
          accept={spec.accept}
          multiple={spec.multiple}
          onClose={() => setCreating(false)}
          onShared={() => { setCreating(false); load(); }}
        />
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
              <button type="button" className="app-cta" onClick={() => setCreating(true)}>
                Create new post
              </button>
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
      {!loadError && works?.length === 0 && (
        own && spec.accept ? (
          <button type="button" className="app-link wk-invite" onClick={() => setCreating(true)}>
            {spec.invite}
          </button>
        ) : (
          <p className="app-note">{own ? spec.invite : `Nothing here yet. ${spec.empty}`}</p>
        )
      )}

      <div className={kind === 'photo' || kind === 'video' ? 'wk-grid' : 'wk-list'}>
        {works?.map((w) => {
          return (
          <article key={w.id} className="wk-item">
            <button type="button" className="wk-open" onClick={() => setOpen(w)}>
              {w.kind === 'photo' && w.media[0] && (
                <div className="wk-shot">
                  {/* No srcset: there is only ever one size of these bytes. The server has no image
                      library and may not gain one, so a full-size photograph is what exists to
                      offer — see docs/design/PERFORMANCE.md for what that costs and what would fix
                      it. `decoding="async"` at least keeps a 3MB decode off the main thread. */}
                  <img src={w.media[0].url} alt={w.title} loading="lazy" decoding="async"
                       draggable={false} onContextMenu={(e) => e.preventDefault()}
                       style={cropStyle(w.media[0])} />
                  {w.media.length > 1 && <span className="wk-count">{w.media.length}</span>}
                </div>
              )}
              {w.kind === 'video' && w.media[0] && (
                <div className="wk-shot">
                  <video src={w.media[0].url} preload="metadata"
                         controlsList="nodownload" disablePictureInPicture
                         onContextMenu={(e) => e.preventDefault()}
                         style={cropStyle(w.media[0])} />
                </div>
              )}
              {w.kind === 'thread' && (
                <div className="wk-thread">
                  {w.title && <h4>{w.title}</h4>}
                  <p>{w.body}</p>
                </div>
              )}
              {w.kind === 'doc' && (
                <div className="wk-file">
                  {decodeURIComponent(w.media[0]?.filename || w.title || 'file')}
                  <span className="app-meta">
                    {w.media[0] ? `${Math.round(w.media[0].bytes / 1024)} KB` : ''}
                  </span>
                </div>
              )}
            </button>

            <div className="wk-foot">
              {/* Shown because it is a promise to other people, not a preference — it decides
                  whether somebody may file this into their research. */}
              <span className="app-meta">
                {w.shareable ? 'May be shared and cited' : 'Not for sharing'}
                {w.edited ? ' · edited' : ''}
              </span>
              {!own && <ReportButton kind="work" subject={w.id} />}
            </div>
          </article>
          );
        })}
      </div>
    </div>
  );
}
