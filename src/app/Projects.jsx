/**
 * /app/projects — where shared things land and turn into something.
 *
 * project → note → sources. Shallow on purpose: anything deeper is filing rather than thinking,
 * and a research tool that demands filing gets abandoned.
 *
 * A note shows its SOURCES as a list, not a sentence. Provenance you can count, follow and
 * challenge is evidence; a paragraph saying "based on various posts" is decoration.
 */
import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { api } from './api';
import { subscribe } from './stream';
import { safeHref } from '../../shared/safe-href.mjs';

const STATUS = {
  captured: { label: 'Captured', tone: 'idle',
    hint: 'Material kept. Your agent has not analysed it yet.' },
  analysed: { label: 'Analysed', tone: 'go', hint: null },
  failed: { label: 'Failed', tone: 'bad', hint: 'Your agent could not make sense of this.' },
};

export function ProjectList() {
  const [projects, setProjects] = useState(null);

  const load = () => api.projects().then((d) => setProjects(d.projects || [])).catch(() => setProjects([]));
  useEffect(() => {
    load();
    return subscribe((kind) => { if (kind === 'project') load(); });
  }, []);

  if (projects === null) return <p className="app-note you-pad">Loading…</p>;

  if (projects.length === 0) {
    return (
      <div className="deal-empty">
        <h2>No projects yet</h2>
        <p className="app-note">
          When you find something useful, share it to your agent. It lands here as a project — one
          per subject — with the original kept alongside whatever your agent makes of it.
        </p>
        <Link className="app-link" to="/app">← Find something on Home</Link>
      </div>
    );
  }

  return (
    <div className="ws">
      <h1 className="set-title">Projects</h1>
      <div className="set-rows">
        {projects.map((p) => (
          <Link key={p.id} className="set-row" to={`/app/projects/${p.id}`}>
            <span className="set-label">
              {p.name}
              <span className="set-hint">
                {p.notes.length} {p.notes.length === 1 ? 'note' : 'notes'}
                {' · '}
                {p.notes.reduce((n, x) => n + x.sources, 0)} sources
              </span>
            </span>
            <span className="set-chev" aria-hidden="true">›</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function ProjectDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [all, setAll] = useState([]);
  const [renaming, setRenaming] = useState(false);
  const [working, setWorking] = useState('');
  const [problem, setProblem] = useState('');
  const [name, setName] = useState('');

  const load = () => Promise.all([
    api.project(id).then(setData),
    api.projects().then((d) => setAll(d.projects || [])),
  ]).catch(() => {});

  useEffect(() => {
    load();
    return subscribe((kind) => { if (kind === 'project') load(); });
  }, [id]);

  if (!data) return <p className="app-note you-pad">Loading…</p>;

  async function rename(e) {
    e.preventDefault();
    if (!name.trim()) return;
    await api.renameProject(id, name.trim());
    setRenaming(false);
    load();
  }

  async function analyse(noteId) {
    setWorking(noteId); setProblem('');
    try {
      await api.analyse(noteId);
      await load();
    } catch (e) {
      // Say what actually happened. "Could not analyse" would hide the only useful distinction:
      // whether the material is wrong or the platform is not set up.
      setProblem(e.message);
    } finally { setWorking(''); }
  }

  async function move(noteId, to) {
    await api.moveNote(noteId, to);
    load();
  }

  return (
    <div className="ws">
      <button className="app-link" onClick={() => nav('/app/projects')}>← All projects</button>

      {renaming ? (
        <form className="prj-rename" onSubmit={rename}>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
                 placeholder={data.project.name} />
          <button className="app-cta">Rename</button>
          <button type="button" className="app-link" onClick={() => setRenaming(false)}>Cancel</button>
        </form>
      ) : (
        <h1 className="set-title">
          {data.project.name}
          {/* Renaming matters more than it looks: a project is created as "Project 1" because
              being asked to name a subject before you know what it is stops the share. */}
          <button className="app-link prj-edit"
                  onClick={() => { setName(data.project.name); setRenaming(true); }}>rename</button>
        </h1>
      )}

      {data.notes.length === 0 && <p className="app-note">Nothing filed here yet.</p>}

      {data.notes.map((n) => {
        const st = STATUS[n.status] ?? STATUS.captured;
        return (
          <article key={n.id} className="app-card prj-note">
            <div className="deal-head">
              <h3 style={{ margin: 0 }}>{n.title}</h3>
              <span className={`deal-chip ${st.tone}`}>{st.label}</span>
            </div>
            {st.hint && <p className="app-note" style={{ margin: '8px 0 0' }}>{st.hint}</p>}

            {n.body && <p className="prj-body">{n.body}</p>}

            {n.status !== 'analysed' && (
              <div>
                <button className="app-cta" disabled={working === n.id}
                        onClick={() => analyse(n.id)}>
                  {working === n.id ? 'Reading…' : 'Ask your agent to read this'}
                </button>
                {problem && <p className="app-error" style={{ marginBottom: 0 }}>{problem}</p>}
              </div>
            )}

            <h4 className="prj-srch">Sources</h4>
            <ol className="prj-sources">
              {n.sources.map((s) => {
                const href = safeHref(s.url);
                return (
                <li key={s.id}>
                  <b>{s.title || 'Untitled'}</b>
                  {s.used_for && <span className="prj-used"> — used for {s.used_for}</span>}
                  {s.excerpt && <span className="prj-excerpt">{s.excerpt.slice(0, 180)}</span>}
                  {href && (
                    <a href={href} target="_blank" rel="noopener noreferrer">{s.url}</a>
                  )}
                </li>
                );
              })}
            </ol>

            {all.length > 1 && (
              <div className="prj-move">
                <span className="app-note">Move to</span>
                {all.filter((p) => p.id !== id).map((p) => (
                  <button key={p.id} className="app-link" onClick={() => move(n.id, p.id)}>
                    {p.name}
                  </button>
                ))}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

/**
 * The share sheet.
 *
 * Sharing is a PERSON's act — deliberate, one item at a time — which is what makes it lawful,
 * consensual and a stronger signal than a like. So it asks where the thing should go rather than
 * filing it silently: choosing the project IS the thought.
 */
export function ShareSheet({ post, onClose }) {
  const [projects, setProjects] = useState([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  useEffect(() => { api.projects().then((d) => setProjects(d.projects || [])).catch(() => {}); }, []);

  async function share(projectId) {
    setBusy(true);
    try {
      const r = await api.share({ postId: post.id, projectId: projectId || undefined });
      setDone(r);
    } finally { setBusy(false); }
  }

  return (
    <div className="sheet-back" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        {done ? (
          <>
            <h3>Filed in {done.project.name}</h3>
            <p className="app-note">
              Kept as it is. Your agent has not analysed it yet — nothing here claims it has.
            </p>
            <Link className="app-cta" to={`/app/projects`} onClick={onClose}>Open projects</Link>
          </>
        ) : (
          <>
            <h3>Share to your agent</h3>
            <p className="app-note">{post.title}</p>
            <div className="set-rows" style={{ marginTop: 12 }}>
              {projects.map((p) => (
                <button key={p.id} className="set-row" disabled={busy} onClick={() => share(p.id)}>
                  <span className="set-label">{p.name}</span>
                  <span className="set-chev" aria-hidden="true">›</span>
                </button>
              ))}
              <button className="set-row" disabled={busy} onClick={() => share(null)}>
                <span className="set-label">
                  New project
                  <span className="set-hint">Named for you — rename it once you know what it is</span>
                </span>
                <span className="set-chev" aria-hidden="true">＋</span>
              </button>
            </div>
          </>
        )}
        <button className="app-link sheet-close" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
