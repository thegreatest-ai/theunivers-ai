/**
 * The author's claim of where a work is, typed rather than sensed.
 *
 * Not a pin, not a badge, not navigator.geolocation. The inspection screens grade a
 * captured position; this is a caption. Sharing their visual language is how a typed
 * string starts looking like evidence — the mock.js failure in a new costume.
 *
 * Both halves optional, both clearable, never pre-filled from a previous post or from
 * the author's profile country. A location that reappears by itself is how someone
 * publishes a place they did not mean to.
 */
import Select from './Select';
import { COUNTRIES } from './countries';
import { PLACE_MAX, placeClaim } from '../../shared/place.mjs';

const COUNTRY_OPTIONS = [
  { value: '', label: 'No country' },
  ...COUNTRIES.filter((c) => !c.disabled).map((c) => ({ value: c.code, label: c.name })),
];

export function PlaceFields({ place, placeCc, onPlace, onPlaceCc }) {
  return (
    <div className="cp-place">
      <input
        placeholder="Add a location"
        maxLength={PLACE_MAX}
        value={place}
        autoComplete="off"
        onChange={(e) => onPlace(e.target.value)}
      />
      <Select
        value={placeCc}
        onChange={onPlaceCc}
        placeholder="Country (optional)"
        options={COUNTRY_OPTIONS}
      />
    </div>
  );
}

/**
 * Absent renders as absent: no empty row, no placeholder, no "Location: —".
 * Text content, never markup, never a URL — it is user text on other people's screens.
 */
export function PlaceLine({ place, placeCc }) {
  const line = placeClaim(place, placeCc);
  if (!line) return null;
  return <p className="app-meta wk-place">{line}</p>;
}
