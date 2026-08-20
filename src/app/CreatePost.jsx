/**
 * The room between the picker and the upload.
 *
 * Choosing a file used to BE the commit, so there was nowhere for a ratio or a zoom decision
 * to live and every image landed at whatever shape it happened to be. This window is that
 * room: drop or select, choose a shape, frame each picture, write a caption, then Share.
 * Cancel discards and uploads nothing.
 *
 * The ratio is a presentation choice for the FEED, one per post. Zoom is per image, applied
 * as CSS on the cropped surfaces. The bytes go up untouched — the server has no image library
 * and must not gain one for this. WorkDetail still opens the photograph at its true shape,
 * without zoom, because that is the original.
 *
 * The photograph is the subject, so it gets the stage. Zoom and ratio sit under it because a
 * control that covers the picture is eating the thing it is for. Add-more lives in the film
 * strip, next to the pictures it extends — a dashed box on the far right reads as a second
 * dropzone. The header close is a mark, not a second Cancel: the worded choice belongs next
 * to Share, where the decision is actually made.
 */
import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { trapFocus } from './dialog';
import { WORK_RATIOS, ratioAspect } from '../../shared/work-ratio.mjs';
import {
  MEDIA_CAP, ZOOM_MIN, ZOOM_MAX, ZOOM_DEFAULT, cropStyle,
} from '../../shared/media-zoom.mjs';
import { PlaceFields } from './PlaceFields';
import { RatioMenu } from './RatioMenu';

/**
 * The picture, whole.
 *
 * `object-fit: contain` and not `cover`: the owner's complaint was that the preview cut the
 * photograph off, and they are right that it should not. This window is where you decide what to
 * publish, and deciding requires seeing the thing — a preview that hides part of the frame is
 * asking someone to approve what they have not been shown.
 *
 * It reports its NATURAL size upward so that Original can shape the frame to the photograph
 * instead of to a fixed box. Reading naturalWidth is right HERE and wrong everywhere else in this
 * codebase: elsewhere the server has already measured the bytes and sending a number the client
 * could assert would be a layout the client controls. This file has no server measurement — the
 * picture has not been uploaded yet.
 */
function StageMedia({ item, onNatural }) {
  const style = cropStyle({ zoom: item.zoom });
  if (item.file.type.startsWith('video/')) {
    return (
      <video
        src={item.url} muted preload="metadata" style={style}
        onLoadedMetadata={(e) => onNatural?.(e.currentTarget.videoWidth, e.currentTarget.videoHeight)}
      />
    );
  }
  return (
    <img
      src={item.url} alt="" style={style}
      onLoad={(e) => onNatural?.(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
    />
  );
}

export default function CreatePost({ kind, accept, multiple, onClose, onShared }) {
  const box = useRef(null);
  const fileRef = useRef(null);
  const urls = useRef([]);
  const itemsRef = useRef([]);
  const appending = useRef(false);
  const [items, setItems] = useState([]);
  const [current, setCurrent] = useState(0);
  const [ratio, setRatio] = useState('original');
  const [text, setText] = useState({ title: '', body: '' });
  const [place, setPlace] = useState('');
  const [placeCc, setPlaceCc] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const zoomable = kind === 'photo' || kind === 'video';
  const named = kind === 'doc' || kind === 'video';

  useEffect(() => {
    const root = box.current;
    if (!root) return undefined;
    return trapFocus(root, onClose);
  }, [onClose]);

  useEffect(() => () => {
    for (const u of urls.current) URL.revokeObjectURL(u);
  }, []);

  function take(list, { append = false } = {}) {
    const incoming = [...(list || [])].filter(Boolean);
    if (!incoming.length) return;
    // Initial pick replaces. Add more concatenates. Replacing from Add more is the bug:
    // a person who has chosen four and wants a fifth must not lose the four.
    if (!append) {
      for (const u of urls.current) URL.revokeObjectURL(u);
      urls.current = [];
      itemsRef.current = [];
    }
    const cap = multiple ? MEDIA_CAP : 1;
    const room = cap - itemsRef.current.length;
    const extra = incoming.slice(0, Math.max(room, 0));
    if (!extra.length) {
      setError(`A post can hold ${MEDIA_CAP} pictures.`);
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    const added = extra.map((file) => {
      const url = URL.createObjectURL(file);
      urls.current.push(url);
      return { file, url, zoom: ZOOM_DEFAULT };
    });
    const start = itemsRef.current.length;
    const next = [...itemsRef.current, ...added];
    itemsRef.current = next;
    setItems(next);
    setCurrent(start);
    setError(incoming.length > extra.length
      ? `A post can hold ${MEDIA_CAP} pictures.`
      : '');
    if (fileRef.current) fileRef.current.value = '';
  }

  function addMore() {
    appending.current = true;
    fileRef.current?.click();
  }

  function onPick(list) {
    const append = appending.current;
    appending.current = false;
    take(list, { append });
  }

  function removeAt(i) {
    const doomed = itemsRef.current[i];
    if (!doomed) return;
    URL.revokeObjectURL(doomed.url);
    urls.current = urls.current.filter((u) => u !== doomed.url);
    const next = itemsRef.current.filter((_, j) => j !== i);
    itemsRef.current = next;
    setItems(next);
    setCurrent((c) => {
      if (!next.length) return 0;
      if (c > i) return c - 1;
      if (c >= next.length) return next.length - 1;
      return c;
    });
    if (!next.length) appending.current = false;
  }

  function setZoomAt(i, raw) {
    // The slider's min/max is the courtesy. The server is the gate — it will 400 a value
    // outside 1–3 rather than clamp it into a framing the author did not choose.
    const n = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(raw)));
    const next = itemsRef.current.map((item, j) => (j === i ? { ...item, zoom: n } : item));
    itemsRef.current = next;
    setItems(next);
  }

  function discard() {
    for (const u of urls.current) URL.revokeObjectURL(u);
    urls.current = [];
    itemsRef.current = [];
    setItems([]);
    setCurrent(0);
    appending.current = false;
    setRatio('original');
    setText({ title: '', body: '' });
    setPlace('');
    setPlaceCc('');
    setError('');
    onClose();
  }

  async function share(e) {
    let created = null;
    e.preventDefault();
    if (!items.length || busy) return;
    setBusy(true);
    setError('');
    try {
      const w = created = await api.createWork({
        kind,
        title: named ? String(text.title || '').slice(0, 200) : '',
        body: text.body,
        ratio,
        place,
        place_cc: placeCc,
      });
      // Sequential, not parallel: a carousel has an order, and firing them together would file
      // them in whatever order the network returned.
      for (const item of items) {
        await api.uploadMedia(w.work.id, item.file, { zoom: item.zoom });
      }
      onShared();
    } catch (err) {
      /*
       * THE WORK IS CREATED BEFORE THE BYTES ARRIVE, so an upload that fails used to leave a row
       * behind that could never render — a tile on someone's profile showing nothing, with no way
       * to tell it apart from a bug. Two of those are in production right now: a video and a photo
       * of Frida's from 2026-08-12, both works with no media at all.
       *
       * Removing it is safe precisely here and nowhere else: it has just been created, it has no
       * media, and nobody can have commented on or cited something that was never visible. If the
       * removal itself fails we keep the original error — the upload failure is what the person
       * needs to read, not a second one about tidying up.
       */
      if (created?.work?.id) {
        try { await api.deleteWork(created.work.id); } catch { /* keep the real error */ }
      }
      setError(err.message);
      setBusy(false);
    }
  }

  /*
   * ORIGINAL MEANS THE PHOTOGRAPH'S OWN SHAPE, and until now it meant "a fixed-height box that
   * crops". The frame took --cp-stage as a height and the media was object-fit:cover, so a
   * portrait chose Original and still lost its top and bottom — the fault the owner reported.
   * With the natural ratio known, Original frames the picture exactly and nothing is cut.
   */
  const [natural, setNatural] = useState(null);
  useEffect(() => { setNatural(null); }, [current, items.length]);
  const chosenAspect = ratioAspect(ratio);
  const previewAspect = chosenAspect ?? natural;
  const atCap = items.length >= MEDIA_CAP;
  const currentItem = items[current] || items[0];
  // The strip is how you switch pictures and how you add one. A single video has
  // neither job, so it would be a row of one thumbnail under a stage of the same
  // picture — noise. Remove then lives on the stage, because a way in with no way
  // out is how people cancel the window to drop one file.
  const showStrip = items.length > 1 || (multiple && !atCap);

  const picker = (
    <input
      ref={fileRef}
      className="sr-only"
      type="file"
      accept={accept}
      multiple={multiple}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onPick(e.target.files)}
    />
  );

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
          <button type="button" className="app-link cp-dismiss" onClick={discard} aria-label="Cancel">
            ×
          </button>
        </header>

        <div className="cp-body">
          {error && <p className="app-error">{error}</p>}
          {picker}

          {!items.length ? (
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
              <p>
                {kind === 'video' ? 'Drag a video here'
                  : kind === 'doc' ? 'Drag a PDF or text file here'
                    : 'Drag photos and videos here'}
              </p>
              {kind === 'video' && (
                <p className="app-note">Up to 40MB — larger files will not upload.</p>
              )}
              <span className="app-cta">Select from computer</span>
            </div>
          ) : (
            <form className="cp-form" onSubmit={share}>
              {kind !== 'doc' ? (
              <>
              <div
                className="cp-hero"
                style={previewAspect ? { '--ar': String(previewAspect) } : undefined}
              >
                <div className={`cp-hero-frame${previewAspect ? ' has-ratio' : ''}`}>
                  <StageMedia
                    item={currentItem}
                    onNatural={(w, h) => { if (w > 0 && h > 0) setNatural(w / h); }}
                  />
                  {!showStrip && (
                    <button
                      type="button"
                      className="cp-remove"
                      onClick={() => removeAt(current)}
                    >
                      ×<span className="sr-only">Remove this picture</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="cp-tools">
                {zoomable && (
                  <div className="cp-zoom" role="group" aria-label={`Zoom picture ${current + 1}`}>
                    <button
                      type="button"
                      onClick={() => setZoomAt(current, currentItem.zoom - 0.25)}
                      disabled={currentItem.zoom <= ZOOM_MIN}
                    >
                      −<span className="sr-only">Zoom out</span>
                    </button>
                    <input
                      type="range"
                      min={ZOOM_MIN}
                      max={ZOOM_MAX}
                      step={0.05}
                      value={currentItem.zoom}
                      aria-label="Zoom"
                      onChange={(e) => setZoomAt(current, e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => setZoomAt(current, currentItem.zoom + 0.25)}
                      disabled={currentItem.zoom >= ZOOM_MAX}
                    >
                      +<span className="sr-only">Zoom in</span>
                    </button>
                  </div>
                )}
                {/*
                  * One button that OPENS the choices, rather than four chips holding a row open
                  * forever. The owner asked for this and it is right: a ratio is decided once and
                  * then wanted out of the way.
                  *
                  * The button NAMES THE CURRENT VALUE. That is the whole condition on collapsing
                  * it — flat chips at least showed which one was active, and hiding them behind a
                  * control labelled only "Ratio" would trade clutter for something a person has to
                  * open before they can understand it.
                  */}
                <RatioMenu value={ratio} onChange={setRatio} />
              </div>

              {showStrip && (
                <div className="cp-strip">
                  {items.map((item, i) => (
                    <div
                      key={item.url}
                      className={`cp-strip-item${i === current ? ' on' : ''}`}
                    >
                      <button
                        type="button"
                        className="cp-strip-pick"
                        aria-label={`Picture ${i + 1}`}
                        aria-current={i === current ? 'true' : undefined}
                        onClick={() => setCurrent(i)}
                      >
                        <StageMedia item={item} />
                      </button>
                      <button
                        type="button"
                        className="cp-remove"
                        onClick={() => removeAt(i)}
                      >
                        ×<span className="sr-only">Remove this picture</span>
                      </button>
                    </div>
                  ))}
                  {multiple && !atCap && (
                    <button type="button" className="cp-add-more" onClick={addMore}>
                      Add more
                    </button>
                  )}
                </div>
              )}
              </>
              ) : (
              <ul className="cp-files">
                {items.map((item, i) => (
                  <li key={item.url}>
                    <span>{item.file.name}</span>
                    <span className="app-meta">{Math.round(item.file.size / 1024)} KB</span>
                    <button type="button" className="app-link" onClick={() => removeAt(i)}>
                      ×<span className="sr-only">Remove this file</span>
                    </button>
                  </li>
                ))}
                {multiple && !atCap && (
                  <li>
                    <button type="button" className="cp-add-more" onClick={addMore}>Add more</button>
                  </li>
                )}
              </ul>
              )}
              {multiple && atCap && (
                <p className="app-note cp-cap">A post can hold {MEDIA_CAP} pictures.</p>
              )}

              {named && (
                <input
                  maxLength={200}
                  placeholder="Name"
                  value={text.title}
                  onChange={(e) => setText((p) => ({ ...p, title: e.target.value }))}
                />
              )}
              <textarea
                rows={3}
                maxLength={10000}
                placeholder={named ? 'Description (optional)' : 'Caption (optional)'}
                value={text.body}
                onChange={(e) => setText((p) => ({ ...p, body: e.target.value }))}
              />
              <PlaceFields
                place={place}
                placeCc={placeCc}
                onPlace={setPlace}
                onPlaceCc={setPlaceCc}
              />

              {/* Sticky, not just last. The stage is deliberately large, so on a short window the
                  form scrolls — and an action row that scrolls with it hides SHARE, the one control
                  the whole window exists to reach. It stays inside the <form> so it still submits. */}
              <div className="cp-row cp-actions">
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
    </div>
  );
}
