/**
 * /app/u/:handle — a person as somebody else may see them.
 *
 * You (/app/account) is owner-only: standing, anchors, the receipt chain, Settings. This is
 * the public face — name, bio, links, derived follow counts, published work. The two screens
 * are not the same page with a flag, because mixing "what I operate" with "what others see"
 * is how a profile becomes a settings dump.
 *
 * Follower counts come from the person object on every load. They are not stored in state
 * across navigations and they are not incremented locally after a follow — both would be a
 * cache of a derived number, which is the counter column the server refused to add.
 */
import { useEffect, useState } from 'react';
import { Link, useOutletContext, useParams } from 'react-router-dom';
import { api } from './api';
import FollowButton from './FollowButton';
import Works from './Works';

export function profilePath(person) {
  const ref = person?.handle || person?.id;
  return ref ? `/app/u/${encodeURIComponent(ref)}` : '/app/discover';
}

export default function Person() {
  const { handle } = useParams();
  const { me } = useOutletContext();
  const [person, setPerson] = useState(null);
  const [error, setError] = useState('');
  const [list, setList] = useState(null);

  useEffect(() => {
    let alive = true;
    setPerson(null);
    setList(null);
    setError('');
    api.person(handle)
      .then((d) => alive && setPerson(d.person))
      .catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [handle]);

  async function openList(direction) {
    if (list?.direction === direction) {
      setList(null);
      return;
    }
    try {
      const d = await api.personFollows(person.handle || person.id, direction);
      setList(d);
    } catch (e) {
      setError(e.message);
    }
  }

  if (error && !person) {
    return (
      <div className="deal-empty">
        <h2>No such person</h2>
        <p className="app-note">{error}</p>
        <Link className="app-cta" to="/app/discover">Discover</Link>
      </div>
    );
  }
  if (!person) return <p className="app-note you-pad">Loading…</p>;

  const self = me?.user?.id === person.id;
  const initials = (person.name || person.handle || '?')
    .split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className="you">
      <header className="you-head">
        <div className="you-avatar" aria-hidden="true">{initials}</div>

        <div className="you-id">
          <h1>{person.name || 'Unnamed'}</h1>
          {person.handle && <p className="you-handle">{person.handle}</p>}
          <p className="app-meta">
            {person.kind === 'business' ? 'Registered business' : 'Individual'}
            {person.profession ? ` · ${person.profession}` : ''}
            {person.jurisdiction ? ` · ${person.jurisdiction}` : ''}
          </p>
          {person.trust?.tier && (
            <span className="you-tier">
              <b>{person.trust.tier}</b>
              <span>derived, not granted</span>
            </span>
          )}
        </div>

        {self
          ? <Link to="/app/settings/profile" className="you-settings">Edit bio and links →</Link>
          : <FollowButton person={person} onChange={setPerson} />}
      </header>

      {person.bio && <p className="you-bio">{person.bio}</p>}

      {person.links?.length > 0 && (
        <ul className="you-links">
          {person.links.map((l) => (
            <li key={l.url}>
              <a href={l.url} target="_blank" rel="noopener noreferrer">{l.label || l.url}</a>
            </li>
          ))}
        </ul>
      )}

      {/* Two counts, both derived, both a button that fetches the list rather than a number
          painted from memory. Opening the same direction again closes it. */}
      <div className="you-stats you-stats-2">
        <button type="button" className={list?.direction === 'followers' ? 'on' : ''}
                onClick={() => openList('followers')}>
          <b>{person.counts.followers}</b><span>Followers</span>
        </button>
        <button type="button" className={list?.direction === 'following' ? 'on' : ''}
                onClick={() => openList('following')}>
          <b>{person.counts.following}</b><span>Following</span>
        </button>
      </div>

      {error && person && <p className="app-error">{error}</p>}

      {list && (
        <div className="app-card you-people">
          <h3>{list.direction === 'followers' ? 'Followers' : 'Following'}</h3>
          {list.people.length === 0 && <p className="app-note">Nobody here yet.</p>}
          {list.people.map((p) => (
            <div key={p.id} className="you-person">
              <Link className="you-person-name" to={profilePath(p)}>
                <span>{p.name || p.handle || p.id}</span>
                {p.handle && <span className="app-meta">{p.handle}</span>}
              </Link>
              {p.id !== me?.user?.id && (
                <FollowButton person={p} onChange={async (next) => {
                  setList((cur) => cur && {
                    ...cur,
                    people: cur.people.map((x) => x.id === next.id ? next : x),
                  });
                  // Refetch the profile so follower counts stay derived, not incremented here.
                  const d = await api.person(person.handle || person.id);
                  setPerson(d.person);
                }} />
              )}
            </div>
          ))}
        </div>
      )}

      <Works userId={person.id} own={self} />
    </div>
  );
}
