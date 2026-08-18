/**
 * The circle on a profile: a photograph if they uploaded one, otherwise initials.
 *
 * Initials are what absent looks like. A silhouette, a numbered placeholder, or a stock face
 * would be a photograph that was never taken — the same failure as a null ratio collapsing
 * to a square. Messages keep their own handle-initials; those circles are agents.
 */
export function initialsOf(name) {
  return String(name || '?')
    .split(/[\s.]+/)
    .map((w) => w[0])
    .filter(Boolean)
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export default function Avatar({ src, name, className = 'you-avatar' }) {
  if (src) {
    return (
      <div className={className}>
        <img
          src={src}
          alt=""
          draggable={false}
          onContextMenu={(e) => e.preventDefault()}
        />
      </div>
    );
  }
  return (
    <div className={className} aria-hidden="true">{initialsOf(name)}</div>
  );
}
