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
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { api, isUnknown } from './api';
import FollowButton from './FollowButton';
import { BlockButton, ReportButton, UnknownSubject } from './Safety';
import Works from './Works';
import Avatar from './Avatar';
import { safeHref } from '../../shared/safe-href.mjs';

export function profilePath(person) {
  const ref = person?.handle || person?.id;
  return ref ? `/app/u/${encodeURIComponent(ref)}` : '/app/discover';
}

export default function Person() {
  const { handle } = useParams();
  const { me } = useOutletContext();
  const nav = useNavigate();
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
      .catch((e) => alive && setError(isUnknown(e) ? 'unknown' : 'failed'));
    return () => { alive = false; };
  }, [handle]);

  function vanish() {
    setPerson(null);
    setList(null);
    setError('unknown');
  }

  async function openList(direction) {
    if (list?.direction === direction) {
      setList(null);
      return;
    }
    try {
      const d = await api.personFollows(person.handle || person.id, direction);
      setList(d);
    } catch (e) {
      if (isUnknown(e)) vanish();
    }
  }

  if (error === 'unknown') return <UnknownSubject kind="person" />;
  if (error && !person) {
    return (
      <div className="deal-empty">
        <h2>Could not open this</h2>
        <Link className="app-cta" to="/app/discover">Discover</Link>
      </div>
    );
  }
  if (!person) return <p className="app-note you-pad">Loading…</p>;

  const self = me?.user?.id === person.id;

  return (
    <div className="you">
      <header className="you-head">
        {self
          ? (
            <Link to="/app/settings/profile" className="you-avatar-link" aria-label="Change profile photo">
              <Avatar src={person.avatar?.url} name={person.name || person.handle} />
            </Link>
          )
          : <Avatar src={person.avatar?.url} name={person.name || person.handle} />}

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
          ? <Link to="/app/settings/profile" className="you-settings">Edit photo, bio and links →</Link>
          : (
            <div className="person-actions">
              <FollowButton person={person} onChange={setPerson} onUnknown={vanish} />
              <div className="person-more">
                <BlockButton person={person} onBlocked={() => nav('/app/discover')} />
                <ReportButton kind="person" subject={person.id} />
              </div>
            </div>
          )}
      </header>

      {person.bio && <p className="you-bio">{person.bio}</p>}

      {person.links?.some((l) => safeHref(l.url)) && (
        <ul className="you-links">
          {person.links.map((l) => {
            const href = safeHref(l.url);
            if (!href) return null;
            return (
              <li key={href}>
                <a href={href} target="_blank" rel="noopener noreferrer">{l.label || href}</a>
              </li>
            );
          })}
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
          {list.people.length >= 200 && (
            <p className="app-note">
              Showing the 200 most recent. The count above is the full derived total.
            </p>
          )}
          {list.people.map((p) => (
            <div key={p.id} className="you-person">
              <Link className="you-person-name" to={profilePath(p)}>
                <Avatar src={p.avatar?.url} name={p.name || p.handle} className="you-avatar you-avatar-sm" />
                <span className="you-person-id">
                  <span>{p.name || p.handle || p.id}</span>
                  {p.handle && <span className="app-meta">{p.handle}</span>}
                </span>
              </Link>
              {p.id !== me?.user?.id && (
                <FollowButton
                  person={p}
                  onChange={async (next) => {
                    setList((cur) => cur && {
                      ...cur,
                      people: cur.people.map((x) => x.id === next.id ? next : x),
                    });
                    // Refetch the profile so follower counts stay derived, not incremented here.
                    const d = await api.person(person.handle || person.id);
                    setPerson(d.person);
                  }}
                  onUnknown={() => {
                    // A 404 here is a block, not a missing parent. Drop the row; do not
                    // collapse Alice's page because Bob hid himself, and do not paint the body.
                    setList((cur) => cur && {
                      ...cur,
                      people: cur.people.filter((x) => x.id !== p.id),
                    });
                  }}
                />
              )}
            </div>
          ))}
        </div>
      )}

      <Works userId={person.id} own={self} />
    </div>
  );
}
