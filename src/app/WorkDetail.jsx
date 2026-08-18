/**
 * One detail view for the four kinds of work.
 *
 * The grid cell is 3:4. This is the original: it holds the shape the bytes actually
 * have, reserved with the server-sent media `ratio` before they arrive, so the page does
 * not jump under a thumb. Zoom is a crop of the cell and is NOT applied here — the owner's
 * instruction is to keep the original detail, and a zoomed detail view would make that
 * original unreachable. Video, threads and documents open here too — they differ only in
 * what is attached, and four overlays would mean four of every fix. Same argument as
 * Works.jsx.
 *
 * Counts are whatever the server last returned. An optimistic comment, an invented view, a
 * "shared!" toast for a request that failed — all the same failure as the fabricated guard
 * refusal Thread.jsx used to render.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { api } from './api';
import { subscribe } from './stream';
import { ShareSheet } from './Projects';
import { ReportButton } from './Safety';
import { trapFocus } from './dialog';
import { bindSwipeX } from './swipe';
import { PlaceFields, PlaceLine } from './PlaceFields';
import { RatioMenu } from './RatioMenu';

function Text({ url }) {
  const [body, setBody] = useState('Loading…');
  useEffect(() => {
    fetch(url).then((r) => r.text()).then(setBody).catch(() => setBody('Could not open this.'));
  }, [url]);
  return <pre className="doc-text">{body}</pre>;
}

function stageStyle(ratio) {
  // Absent must render as absent, never as zero. A 0×n box is worse than reserving a sensible one.
  if (typeof ratio === 'number' && ratio > 0) return { aspectRatio: String(ratio) };
  return undefined;
}

export default function WorkDetail({ work: initial, workId, own: ownProp, onClose, onChanged }) {
  const { me } = useOutletContext() || {};
  const id = initial?.id || workId;
  const box = useRef(null);
  const stage = useRef(null);
  const [work, setWork] = useState(initial || null);
  const [comments, setComments] = useState(null);
  const [slide, setSlide] = useState(0);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [sharing, setSharing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState({ title: '', body: '', ratio: 'original', place: '', place_cc: '' });
  const composer = useRef(null);

  function loadWork() {
    return api.work(id).then((d) => setWork(d.work));
  }
  function loadComments() {
    return api.workComments(id).then((d) => setComments(d.comments || []));
  }

  useEffect(() => {
    let alive = true;
    setError('');
    api.seenWorks([id]).catch(() => {});
    loadWork().catch((e) => alive && setError(e.message));
    loadComments().catch(() => alive && setComments([]));
    const stop = subscribe((kind, data) => {
      if (kind !== 'comment') return;
      if (data?.work && data.work !== id) return;
      loadComments().catch(() => {});
      loadWork().catch(() => {});
    });
    return () => { alive = false; stop(); };
  }, [id]);

  useEffect(() => {
    const root = box.current;
    if (!root) return undefined;
    return trapFocus(root, onClose);
  }, [onClose]);

  const mediaLen = (work?.media || []).length;
  useEffect(() => {
    const el = stage.current;
    if (!el || mediaLen < 2) return undefined;
    return bindSwipeX(el, {
      onPrev: () => setSlide((s) => Math.max(0, s - 1)),
      onNext: () => setSlide((s) => Math.min(mediaLen - 1, s + 1)),
    });
  }, [mediaLen, work?.id]);

  useEffect(() => {
    if (mediaLen < 2) return undefined;
    function onKey(e) {
      if (e.target.closest?.('textarea, input, select')) return;
      if (e.key === 'ArrowLeft') setSlide((s) => Math.max(0, s - 1));
      if (e.key === 'ArrowRight') setSlide((s) => Math.min(mediaLen - 1, s + 1));
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mediaLen]);

  async function sendComment(e) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || busy) return;
    setBusy('comment');
    setError('');
    try {
      const r = await api.commentOnWork(id, body);
      setDraft('');
      // The row the server stored, not a local guess at one.
      setComments((cur) => [...(cur || []), r.comment]);
      const d = await api.work(id);
      setWork(d.work);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  async function dropComment(cid) {
    setError('');
    try {
      await api.deleteComment(cid);
      const d = await api.workComments(id);
      setComments(d.comments || []);
      const w = await api.work(id);
      setWork(w.work);
    } catch (err) {
      setError(err.message);
    }
  }

  async function saveEdit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy('edit');
    setError('');
    try {
      const r = await api.updateWork({
        id,
        title: edit.title,
        body: edit.body,
        ratio: edit.ratio,
        place: edit.place,
        place_cc: edit.place_cc,
      });
      setWork(r.work);
      setEditing(false);
      onChanged?.();
    } catch (err) {
      setError(err.status === 409
        ? 'This is under review by the operator and cannot be edited yet.'
        : (err.message || 'Could not save.'));
    } finally {
      setBusy('');
    }
  }

  async function drop() {
    if (!confirm('Delete this, and its files?')) return;
    setError('');
    setBusy('delete');
    try {
      const r = await api.deleteWork(id);
      if (r.withdrawn) {
        const d = await api.work(id);
        setWork(d.work);
        onChanged?.();
      } else {
        onChanged?.();
        onClose();
      }
    } catch (err) {
      setError(err.status === 409
        ? 'This is under review by the operator and cannot be deleted yet.'
        : (err.message || 'Could not delete.'));
    } finally {
      setBusy('');
    }
  }

  const media = work?.media || [];
  const current = media[slide] || media[0];
  const ratio = current?.ratio;
  const viewerId = me?.user?.id;
  const own = Boolean(ownProp || (viewerId && work?.authorId === viewerId));

  const who = work?.handle || work?.author;
  const whoHref = work?.handle
    ? `/app/u/${encodeURIComponent(work.handle)}`
    : (work?.authorId ? `/app/u/${encodeURIComponent(work.authorId)}` : null);

  return (
    <div className="sheet-back wk-detail-back" onClick={onClose}>
      <div
        ref={box}
        className="wk-detail wk-post"
        role="dialog"
        aria-modal="true"
        aria-label={work?.title || 'Work'}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="wk-post-media" ref={stage}>
          {work && !work.withdrawn && !work.takenDown && !(work.limited && !own) && (
            <>
              {work.kind === 'photo' && current && (
                <div className={`wk-detail-stage${ratio > 0 ? ' has-ratio' : ''}`}
                     style={stageStyle(ratio)}>
                  <img src={current.url} alt={work.title || work.body || 'Photograph'} decoding="async"
                       draggable={false} onContextMenu={(e) => e.preventDefault()} />
                  {media.length > 1 && (
                    <div className="wk-detail-slides">
                      <button type="button" className="app-link" disabled={slide === 0}
                              onClick={() => setSlide((s) => s - 1)}>Previous</button>
                      <span className="wk-dots" aria-hidden="true">
                        {media.map((_, i) => (
                          <i key={i} className={i === slide ? 'on' : ''} />
                        ))}
                      </span>
                      <span className="app-meta">{slide + 1} / {media.length}</span>
                      <button type="button" className="app-link" disabled={slide >= media.length - 1}
                              onClick={() => setSlide((s) => s + 1)}>Next</button>
                    </div>
                  )}
                </div>
              )}
              {work.kind === 'video' && current && (
                <div className="wk-detail-stage">
                  <video src={current.url} controls preload="metadata"
                         controlsList="nodownload" disablePictureInPicture
                         onContextMenu={(e) => e.preventDefault()} />
                </div>
              )}
              {work.kind === 'doc' && media.map((m) => (
                <div key={m.id} className="wk-detail-doc">
                  <p className="app-meta">{decodeURIComponent(m.filename || 'file')} · {Math.round(m.bytes / 1024)} KB</p>
                  {m.mime === 'application/pdf'
                    ? <iframe title="Document" src={`${m.url}#toolbar=0&navpanes=0`} />
                    : <Text url={m.url} />}
                </div>
              ))}
            </>
          )}
        </div>

        <div className="wk-post-pane">
          <header className="wk-detail-head">
            {who && whoHref
              ? <Link className="wk-who" to={whoHref}>{who}</Link>
              : <span className="app-meta">{work?.kind || ''}</span>}
            {work?.edited && <span className="app-meta">edited</span>}
            <button type="button" className="app-link" onClick={onClose}>Close</button>
          </header>

          {!work && !error && <p className="app-note">Loading…</p>}
          {error && <p className="app-error">{error}</p>}

          {work?.limited && !own && (
            <p className="app-note">
              Limited by the operator of this node
              {work.limitedAt ? ` on ${new Date(work.limitedAt).toLocaleDateString()}` : ''}.
              Hidden from the grid. The payload is retained for review — not emptied.
            </p>
          )}

          {work && (work.withdrawn || work.takenDown) && (
            <div className="wk-tomb">
              <h2>{work.takenDown ? 'Removed by the operator of this node' : 'Withdrawn by the author'}</h2>
              <p className="app-note">
                {work.withdrawnAt ? `On ${new Date(work.withdrawnAt).toLocaleDateString()}. ` : ''}
                Historically valid, currently unavailable. Comments still resolve here. The payload
                is gone.
              </p>
            </div>
          )}

          {work && !work.withdrawn && !work.takenDown && !(work.limited && !own) && (
            <>
              {work.kind === 'thread' && (
                <div className="wk-thread wk-detail-thread">
                  {work.title && <h4>{work.title}</h4>}
                  <p>{work.body}</p>
                </div>
              )}
              {work.kind !== 'thread' && (work.title || work.body) && (
                <div className="wk-detail-cap">
                  {who && <b className="wk-cap-who">{who} </b>}
                  {work.title && <h4>{work.title}</h4>}
                  {work.body && <p>{work.body}</p>}
                </div>
              )}
              <PlaceLine place={work.place} placeCc={work.place_cc} />
            </>
          )}

          {work && (
            <div className="wk-actions">
              {!work.withdrawn && !work.takenDown && !(work.limited && !own) && (
                <button type="button" className="wk-act" onClick={() => composer.current?.focus()}>
                  Comment
                </button>
              )}
              {work.shareable && !work.withdrawn && !work.takenDown && !work.limited && (
                <button type="button" className="wk-act" onClick={() => setSharing(true)}>Share</button>
              )}
              <span className="wk-cite-note" title="Citing is an agent's act">
                {work.cited ?? 0} cited
                <em> Citing is an agent&apos;s act.</em>
              </span>
              <span className="app-meta" title={work.views
                ? `${work.views.people} people, ${work.views.agents} agents` : ''}>
                {work.views ? `${work.views.people} read · ${work.views.agents} machine-read` : ''}
              </span>
              <span className="app-meta">{work.comments ?? 0} comments</span>
              {!own && work.id && <ReportButton kind="work" subject={work.id} />}
              {own && !work.withdrawn && !work.takenDown && (
                <>
                  <button type="button" className="app-link" onClick={() => {
                    setEdit({
                      title: work.title || '',
                      body: work.body || '',
                      ratio: work.ratio || 'original',
                      place: work.place || '',
                      place_cc: work.place_cc || '',
                    });
                    setEditing(true);
                  }}>Edit</button>
                  <button type="button" className="app-link" onClick={drop}
                          disabled={busy === 'delete'}>Delete</button>
                </>
              )}
            </div>
          )}

          {editing && (
            <form className="wk-edit" onSubmit={saveEdit}>
              <input value={edit.title} placeholder="Title (optional)"
                     onChange={(e) => setEdit((p) => ({ ...p, title: e.target.value }))} />
              <textarea rows={4} value={edit.body} placeholder="Caption"
                        onChange={(e) => setEdit((p) => ({ ...p, body: e.target.value }))} />
              <PlaceFields
                place={edit.place}
                placeCc={edit.place_cc}
                onPlace={(v) => setEdit((p) => ({ ...p, place: v }))}
                onPlaceCc={(v) => setEdit((p) => ({ ...p, place_cc: v }))}
              />
              {(work.kind === 'photo' || work.kind === 'video') && (
                <RatioMenu value={edit.ratio} onChange={(id) => setEdit((p) => ({ ...p, ratio: id }))} />
              )}
              <div className="wk-edit-row">
                <button className="app-cta" disabled={busy === 'edit'}>
                  {busy === 'edit' ? 'Saving…' : 'Save'}
                </button>
                <button type="button" className="app-link" onClick={() => setEditing(false)}>Cancel</button>
              </div>
            </form>
          )}

          {work && !work.limited && (
            <section className="wk-comments" aria-label="Comments">
              {comments === null && <p className="app-note">Loading comments…</p>}
              {comments?.length === 0 && <p className="app-note">No comments yet.</p>}
              <ul>
                {(comments || []).map((c) => (
                  <li key={c.id}>
                    <b>{c.author}</b>
                    <span className="app-meta">{new Date(c.at).toLocaleString()}</span>
                    <p>{c.body}</p>
                    {(own || c.authorId === viewerId) && (
                      <button type="button" className="app-link" onClick={() => dropComment(c.id)}>
                        Delete
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {!work.withdrawn && !work.takenDown && (
                <form className="wk-composer" onSubmit={sendComment}>
                  <textarea ref={composer} rows={1} maxLength={2000} value={draft}
                            placeholder="Write a comment…"
                            onChange={(e) => setDraft(e.target.value)} />
                  <button className="app-link" disabled={busy === 'comment' || !draft.trim()}>
                    {busy === 'comment' ? 'Posting…' : 'Post'}
                  </button>
                </form>
              )}
            </section>
          )}
        </div>
        {sharing && work && (
          <ShareSheet work={work} onClose={() => setSharing(false)} />
        )}
      </div>
    </div>
  );
}
