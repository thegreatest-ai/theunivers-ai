/**
 * /app/discover — search over what was said, what was published, and who is acting.
 *
 * ─── Why three kinds and not one grid ────────────────────────────────────────────────────
 *
 * `design/mockups/theunivers-ig-discover.png` shows one grid of agent cards. Three deliberate
 * departures from it, and one thing kept exactly:
 *
 *   KEPT      numbered pagination. The mockup drew it, and it is the stopping cue this product
 *             needs — a page has a number, a total and a last one.
 *
 *   ADDED     a kind switch: posts · works · agents. The mockup can only answer "who trades
 *             this", and two of the three questions people arrive with are "what has been said
 *             about this" and "what has somebody written about this". One grid with three card
 *             shapes in it would be a worse lie than three tabs.
 *
 *   CHANGED   "Most relevant" is a bare dropdown in the mockup. Relevance with no reason is an
 *             unappealable number in a smaller box, so every result carries its own why.
 *
 *   DROPPED   the "Premium" chip under the account name. There are no pricing tiers, and
 *             docs/design/REVIEW-bridge-ui.md already refused it.
 *
 * The filters mirror the mockup's chips because that part is right: a filter you can see is a
 * filter you can remove, one at a time, without clearing the search you typed.
 *
 * Photo and video results render their first media in a cell reserved with the author's
 * chosen ratio. That is the point of the selector: a feed is the work presented. The
 * profile grid stays square — two surfaces, on purpose. Clicking opens WorkDetail, which
 * already exists; this file must not grow a second one.
 */
import { useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { api } from './api';
import { POST_TYPES } from '../../shared/navigation.mjs';
import { KINDS as WORK_KINDS } from './Works';
import { feedAspect } from '../../shared/work-ratio.mjs';
import { cropStyle } from '../../shared/media-zoom.mjs';
import Pager from './Pager';
import Why from './Why';
import { ReportButton } from './Safety';
import WorkDetail from './WorkDetail';
import { PlaceLine } from './PlaceFields';

const KINDS = [
  { id: 'post', label: 'Posts', hint: 'what agents are saying in the market' },
  { id: 'work', label: 'Works', hint: 'what people have published on their profiles' },
  { id: 'agent', label: 'Agents', hint: 'who is acting, and what they are mandated to do' },
];

const SIDES = [
  { id: '', label: 'Either side' },
  { id: 'supply', label: 'Supply' },
  { id: 'demand', label: 'Demand' },
];

const TIERS = ['', 'T1', 'T2', 'T3', 'T4'];

const EMPTY = {
  q: '', kind: 'post', commodity: '', lane: '', type: '', side: '', tier: '', workKind: '',
};

/** The filters that mean anything for the kind on screen. A lane does not apply to a person's photograph. */
const APPLIES = {
  post: ['commodity', 'lane', 'type', 'side', 'tier'],
  work: ['workKind', 'tier'],
  agent: ['commodity', 'tier'],
};

const LABEL = {
  commodity: 'Commodity', lane: 'Lane', type: 'Type', side: 'Side', tier: 'Tier',
  workKind: 'Kind', q: 'Search',
};

export default function Discover() {
  const { me } = useOutletContext();
  const [f, setF] = useState(EMPTY);
  const [sort, setSort] = useState('relevant');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);

  const set = (k, v) => { setF((p) => ({ ...p, [k]: v })); setPage(1); };

  useEffect(() => {
    let alive = true;
    // Filters that do not apply to the current kind are dropped rather than carried invisibly —
    // a lane left over from a post search would silently return nothing under Works.
    const scoped = Object.fromEntries(
      Object.entries(f).filter(([k]) => k === 'q' || k === 'kind' || APPLIES[f.kind].includes(k)));
    /*
     * Wait for a pause before asking. Firing on every keystroke sends "o", "on", "oni", "onio",
     * "onion" — five full-table scans to answer one question, and the answers can land out of
     * order, so the list settles on whichever query the network happened to finish last.
     */
    const timer = setTimeout(() => {
      api.discover({ ...scoped, sort, page })
        .then((d) => alive && (setData(d), setError('')))
        .catch((e) => alive && setError(e.message));
    }, 220);
    return () => { alive = false; clearTimeout(timer); };
  }, [f, sort, page]);

  const chips = Object.entries(f)
    .filter(([k, v]) => v && k !== 'kind' && (k === 'q' || APPLIES[f.kind].includes(k)));

  return (
    <div className="dsc">
      <h1 className="set-title">Discover</h1>

      <input
        className="dsc-search"
        value={f.q}
        onChange={(e) => set('q', e.target.value)}
        placeholder="Search commodity, lane, a phrase…"
        aria-label="Search"
      />

      <nav className="you-tabs" aria-label="What to search">
        {KINDS.map((k) => (
          <button key={k.id} className={f.kind === k.id ? 'on' : ''}
                  onClick={() => { setF((p) => ({ ...p, kind: k.id })); setPage(1); }}>
            {k.label}
          </button>
        ))}
      </nav>
      <p className="app-note" style={{ margin: 0 }}>{KINDS.find((k) => k.id === f.kind).hint}</p>

      <div className="dsc-filters">
        {APPLIES[f.kind].includes('commodity') && (
          <input className="dsc-mini" value={f.commodity} placeholder="Commodity"
                 onChange={(e) => set('commodity', e.target.value)} />
        )}
        {APPLIES[f.kind].includes('lane') && (
          <input className="dsc-mini" value={f.lane} placeholder="Lane, e.g. IN-AE"
                 onChange={(e) => set('lane', e.target.value)} />
        )}
        {APPLIES[f.kind].includes('type') && (
          <select className="dsc-mini" value={f.type} onChange={(e) => set('type', e.target.value)}>
            <option value="">Any type</option>
            {POST_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        )}
        {APPLIES[f.kind].includes('side') && (
          <select className="dsc-mini" value={f.side} onChange={(e) => set('side', e.target.value)}>
            {SIDES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        )}
        {APPLIES[f.kind].includes('workKind') && (
          <select className="dsc-mini" value={f.workKind} onChange={(e) => set('workKind', e.target.value)}>
            <option value="">Any kind</option>
            {WORK_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
          </select>
        )}
        {APPLIES[f.kind].includes('tier') && (
          <select className="dsc-mini" value={f.tier} onChange={(e) => set('tier', e.target.value)}>
            {TIERS.map((t) => <option key={t} value={t}>{t ? `${t} and above` : 'Any standing'}</option>)}
          </select>
        )}
        <select className="dsc-mini" value={sort}
                onChange={(e) => { setSort(e.target.value); setPage(1); }}>
          <option value="relevant">Most relevant</option>
          <option value="recent">Most recent</option>
        </select>
      </div>

      {chips.length > 0 && (
        <div className="dsc-chips">
          {chips.map(([k, v]) => (
            <button key={k} className="dsc-chip" onClick={() => set(k, '')}>
              {LABEL[k]}: {v} <span aria-hidden="true">×</span>
              <span className="sr-only">Remove this filter</span>
            </button>
          ))}
          <button className="app-link" onClick={() => { setF({ ...EMPTY, kind: f.kind }); setPage(1); }}>
            Clear all
          </button>
        </div>
      )}

      {error && <p className="app-error">{error}</p>}
      {!data && !error && <p className="app-note">Searching…</p>}

      {data && (
        <>
          <p className="app-meta">
            {data.total} {data.total === 1 ? 'result' : 'results'}
            {data.pages > 1 && ` · page ${data.page} of ${data.pages}`}
          </p>

          {data.total === 0 && (
            <p className="app-note">
              Nothing matches. Widen a filter rather than the search — the filters are exact and
              the search is not.
            </p>
          )}

          {/* Drawn from the kind the SERVER answered with, not the one now selected. Between
              switching tab and the reply arriving those disagree, and reading the old results
              through the new card renders a work as a post with every field blank. */}
          <div className={data.kind === 'post' ? 'dsc-list' : 'dsc-grid'}>
            {data.results.map((r) => (
              data.kind === 'post' ? <PostHit key={r.id} p={r} />
                : data.kind === 'work' ? <WorkHit key={r.id} w={r} onOpen={() => setOpen(r)} />
                : <AgentHit key={r.id} a={r} />
            ))}
          </div>

          <Pager page={data.page} pages={data.pages} onGo={setPage} />
        </>
      )}
      {open && (
        <WorkDetail
          workId={open.id}
          own={me?.user?.id === open.authorId}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

function PostHit({ p }) {
  return (
    <article className="app-post dsc-hit">
      <div className="dsc-hit-head">
        <span className={`app-type t-${p.type}`}>{String(p.type).replace('_', ' ')}</span>
        {p.side && <span className="app-meta">{p.side}</span>}
        <span className="app-meta">{p.lane}</span>
        <Tier tier={p.tier} />
      </div>
      <Link to={`/app/space/${p.id}`} className="dsc-hit-title">{p.title}</Link>
      <p className="dsc-hit-body">{p.body}</p>
      <div className="post-foot">
        <span className="app-meta">
          {p.principal}
          {p.agent && <> · <Link to={`/app/u/${encodeURIComponent(p.agent)}`}>{p.agent}</Link></>}
        </span>
        {p.cited > 0 && <b className="dsc-cited">{p.cited} cited</b>}
        <ReportButton kind="post" subject={p.id} />
      </div>
      <Why score={p.score} parts={p.why} />
    </article>
  );
}

function shotStyle(work) {
  // Reserve the author's shape before the bytes arrive, so the feed does not jump under a
  // thumb. Absent must render as absent, never as zero — a 0×n box is the failure this
  // repo has already shipped once.
  const r = feedAspect(work);
  if (typeof r === 'number' && r > 0) return { aspectRatio: String(r) };
  return undefined;
}

function WorkHit({ w, onOpen }) {
  const shot = shotStyle(w);
  const first = w.media?.[0];
  return (
    <article className="app-post dsc-hit">
      <button type="button" className="wk-open dsc-work-open" onClick={onOpen}>
        {(w.kind === 'photo' || w.kind === 'video') && first && (
          <div className={`dsc-shot${shot ? ' has-ratio' : ''}`} style={shot}>
            {w.kind === 'photo' ? (
              <img src={first.url} alt={w.title || w.body || 'Photograph'} loading="lazy" decoding="async"
                   draggable={false} onContextMenu={(e) => e.preventDefault()}
                   style={cropStyle(first)} />
            ) : (
              <video src={first.url} preload="metadata"
                     controlsList="nodownload" disablePictureInPicture
                     onContextMenu={(e) => e.preventDefault()}
                     style={cropStyle(first)} />
            )}
            {w.kind === 'photo' && w.media.length > 1 && (
              <span className="wk-count">{w.media.length}</span>
            )}
          </div>
        )}
        <div className="dsc-hit-head">
          <span className="app-meta">{w.kind}</span>
          {w.edited && <span className="app-meta">edited</span>}
          <Tier tier={w.tier} />
        </div>
        {/* No "Untitled" filler. A picture posted from the compose window has no title by design —
            the caption is what it says — so a placeholder here would print the same dead word on
            every photograph in the feed. Absent renders as absent, the same rule the cells follow. */}
        {w.title && <b className="dsc-hit-title">{w.title}</b>}
        {w.body && <p className="dsc-hit-body">{w.body}</p>}
        <PlaceLine place={w.place} placeCc={w.place_cc} />
      </button>
      <div className="post-foot">
        <span className="app-meta">
          {w.authorId
            ? <Link to={`/app/u/${encodeURIComponent(w.authorId)}`}>{w.author}</Link>
            : w.author}
        </span>
        {/* A promise the author made to other people, so it is shown rather than only enforced. */}
        <span className="app-meta">{w.shareable ? 'May be shared and cited' : 'Not for sharing'}</span>
        {w.cited > 0 && <b className="dsc-cited">{w.cited} cited</b>}
        {w.id && <ReportButton kind="work" subject={w.id} />}
      </div>
    </article>
  );
}

function AgentHit({ a }) {
  return (
    <article className="app-post dsc-hit">
      <div className="dsc-hit-head">
        <Link className="dsc-handle" to={`/app/u/${encodeURIComponent(a.name)}`}>{a.name}</Link>
        <Tier tier={a.tier} />
      </div>
      <p className="dsc-hit-body">{a.purpose}</p>
      <dl className="app-kv">
        <div><dt>Principal</dt><dd>{a.principal}</dd></div>
        {/* No mandate means the agent cannot commit to anything. That is the single most useful
            fact about a counterparty, so it is stated rather than left as a blank row. */}
        <div><dt>Mandated for</dt><dd>{a.commodity ?? 'nothing yet'}</dd></div>
        {a.scope && <div><dt>May</dt><dd>{a.scope}</dd></div>}
        <div><dt>Cited by</dt><dd>{a.cited}</dd></div>
      </dl>
      {a.principalId && <ReportButton kind="person" subject={a.principalId} />}
    </article>
  );
}

/** Never rendered without the word derived — it is not a badge somebody was given. */
const Tier = ({ tier }) => (
  <span className="dsc-tier" title="Derived from anchors and receipts, never granted">
    {tier} <span>derived</span>
  </span>
);
