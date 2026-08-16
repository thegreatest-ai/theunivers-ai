/**
 * The room between the picker and the upload.
 *
 * Choosing a file used to BE the commit, so there was nowhere for a ratio decision to live
 * and every image landed at whatever shape it happened to be. This window is that room:
 * drop or select, choose a shape, write a caption, then Share. Cancel discards and
 * uploads nothing.
 *
 * The ratio is a presentation choice for the grid, one per post. The bytes go up untouched —
 * the server has no image library and must not gain one for this. WorkDetail still opens
 * the photograph at its true shape.
 */
import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { trapFocus } from './dialog';
import { WORK_RATIOS, ratioAspect } from '../../shared/work-ratio.mjs';

export default function CreatePost({ kind, accept, multiple, onClose, onShared }) {
  const box = useRef(null);
  const fileRef = useRef(null);
  const urls = useRef([]);
  const [files, setFiles] = useState([]);
  const [previews, setPreviews] = useState([]);
  const [ratio, setRatio] = useState('original');
  const [text, setText] = useState({ title: '', body: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const root = box.current;
    if (!root) return undefined;
    return trapFocus(root, onClose);
  }, [onClose]);

  useEffect(() => () => {
    for (const u of urls.current) URL.revokeObjectURL(u);
  }, []);

  function take(list) {
    const next = [...(list || [])].filter(Boolean);
    if (!next.length) return;
    const picked = multiple ? next : next.slice(0, 1);
    for (const u of urls.current) URL.revokeObjectURL(u);
    urls.current = picked.map((f) => URL.createObjectURL(f));
    setPreviews(urls.current);
    setFiles(picked);
    setText((p) => ({ ...p, title: p.title || picked[0].name }));
    setError('');
    if (fileRef.current) fileRef.current.value = '';
  }

  function discard() {
    for (const u of urls.current) URL.revokeObjectURL(u);
    urls.current = [];
    setFiles([]);
    setPreviews([]);
    setRatio('original');
    setText({ title: '', body: '' });
    setError('');
    onClose();
  }

  async function share(e) {
    e.preventDefault();
    if (!files.length || busy) return;
    setBusy(true);
    setError('');
    try {
      const w = await api.createWork({
        kind,
        title: text.title || files[0].name,
        body: text.body,
        ratio,
      });
      // Sequential, not parallel: a carousel has an order, and firing them together would file
      // them in whatever order the network returned.
      for (const f of files) await api.uploadMedia(w.work.id, f);
      onShared();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const previewAspect = ratioAspect(ratio);

  return (
    <div className="sheet-back wk-detail-back" onClick={discard}>
      <div
        ref={box}
        className="wk-detail cp"
        role="dialog"
        aria-modal="true"
        aria-label="Create new post"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="wk-detail-head">
          <h2 className="cp-title">Create new post</h2>
          <button type="button" className="app-link" onClick={discard}>Cancel</button>
        </header>

        {error && <p className="app-error">{error}</p>}

        {!files.length ? (
          <div
            className="cp-drop"
            role="button"
            tabIndex={0}
            aria-label="Drag photos and videos here, or select from computer"
            onClick={() => fileRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                fileRef.current?.click();
              }
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); take(e.dataTransfer.files); }}
          >
            <p>Drag photos and videos here</p>
            <span className="app-cta">Select from computer</span>
            <input
              ref={fileRef}
              className="sr-only"
              type="file"
              accept={accept}
              multiple={multiple}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => take(e.target.files)}
            />
          </div>
        ) : (
          <form className="cp-form" onSubmit={share}>
            <div className="cp-thumbs">
              {files.map((f, i) => (
                <div
                  key={previews[i]}
                  className={`wk-shot${previewAspect ? ' has-ratio' : ''}`}
                  style={previewAspect ? { aspectRatio: String(previewAspect) } : undefined}
                >
                  {f.type.startsWith('video/')
                    ? <video src={previews[i]} muted preload="metadata" />
                    : <img src={previews[i]} alt="" />}
                </div>
              ))}
            </div>

            <fieldset className="cp-ratios">
              <legend>Ratio</legend>
              {WORK_RATIOS.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className={ratio === r.id ? 'on' : ''}
                  onClick={() => setRatio(r.id)}
                >
                  {r.label}
                </button>
              ))}
            </fieldset>

            <input
              placeholder="Title (optional)"
              value={text.title}
              onChange={(e) => setText((p) => ({ ...p, title: e.target.value }))}
            />
            <textarea
              rows={3}
              placeholder="Caption (optional)"
              value={text.body}
              onChange={(e) => setText((p) => ({ ...p, body: e.target.value }))}
            />

            <div className="cp-row">
              <button className="app-cta" disabled={busy}>
                {busy ? 'Sharing…' : 'Share'}
              </button>
              <button type="button" className="app-link" onClick={discard} disabled={busy}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
