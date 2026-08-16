/**
 * The author's claim of where a work is.
 *
 * The inspection screens grade a captured position; this is a caption. Sharing
 * their visual language is how a string starts looking like evidence — the
 * mock.js failure in a new costume. So the published line is still
 * `<where> · added by the author`, via `placeClaim()`, whether the name was
 * typed or resolved from a sensor. A device position is trivially spoofable
 * (`shared/assurance.mjs`); a resolved name is no better.
 *
 * "Use my location" asks the browser on an explicit click, never on opening
 * the form. The coordinates go to OUR origin; the server names them and
 * discards the fix. What lands here is the editable text field, so the author
 * confirms before Share — a geocoder that returns the wrong suburb is common,
 * and a location they never read is one they never agreed to publish.
 *
 * Both halves optional, both clearable, never pre-filled from a previous post
 * or from the author's profile country. A location that reappears by itself
 * is how someone publishes a place they did not mean to.
 */
import { useState } from 'react';
import Select from './Select';
import { api } from './api';
import { COUNTRIES } from './countries';
import { PLACE_MAX, placeClaim } from '../../shared/place.mjs';

const COUNTRY_OPTIONS = [
  { value: '', label: 'No country' },
  ...COUNTRIES.filter((c) => !c.disabled).map((c) => ({ value: c.code, label: c.name })),
];

function chipLabel(place, placeCc) {
  const name = place == null ? '' : String(place).trim();
  const cc = placeCc == null ? '' : String(placeCc).trim();
  if (!name && !cc) return '';
  return name && cc ? `${name}, ${cc}` : (name || cc);
}

export function PlaceFields({ place, placeCc, onPlace, onPlaceCc }) {
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState('');
  const chip = chipLabel(place, placeCc);

  function useMyLocation() {
    // Permission is the click. Opening the form must not prompt — that is what
    // "enable" means, and a prompt nobody asked for is the privacy default
    // this control used to refuse to have at all.
    if (locating) return;
    setLocateError('');
    if (!navigator.geolocation) {
      setLocateError('Location is unavailable. You can type it instead.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const data = await api.reverseGeocode(pos.coords.latitude, pos.coords.longitude);
          if (!data?.place) {
            setLocateError('Could not find a place name for this location. You can type it instead.');
            return;
          }
          onPlace(data.place);
          onPlaceCc(data.place_cc ?? '');
        } catch (err) {
          setLocateError(err.message || 'Could not look up this location. You can type it instead.');
        } finally {
          setLocating(false);
        }
      },
      (err) => {
        setLocating(false);
        if (err?.code === 1) {
          // PERMISSION_DENIED. Never re-prompt in a loop — the browser will
          // not ask again until the user changes the site setting, and we
          // must not pretend otherwise.
          setLocateError('Location is off for this site. You can type it instead.');
          return;
        }
        if (err?.code === 3) {
          setLocateError('Location timed out. You can type it instead.');
          return;
        }
        setLocateError('Location is unavailable. You can type it instead.');
      },
      // A suburb name needs no GPS fix. High accuracy costs battery and time
      // for precision the server is about to throw away.
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 0 },
    );
  }

  function clearPlace() {
    onPlace('');
    onPlaceCc('');
    setLocateError('');
  }

  return (
    <fieldset className="cp-place">
      <legend className="cp-place-label">
        <svg className="cp-place-pin" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor"
            d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z" />
        </svg>
        Location
      </legend>
      <div className="cp-place-row">
        <button
          type="button"
          className="cp-place-use"
          onClick={useMyLocation}
          disabled={locating}
        >
          {locating ? 'Looking up…' : 'Use my location'}
        </button>
        <input
          placeholder="Add a location"
          aria-label="Location name"
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
      {chip ? (
        <span className="cp-place-chip">
          {chip}
          <button type="button" className="cp-place-chip-x" onClick={clearPlace}>
            ×<span className="sr-only">Remove location</span>
          </button>
        </span>
      ) : null}
      <p className="cp-place-note">
        Your coordinates are used to look up a place name and are not saved.
      </p>
      {locateError ? <p className="cp-place-err">{locateError}</p> : null}
    </fieldset>
  );
}

/**
 * Absent renders as absent: no empty row, no placeholder, no "Location: —".
 * Text content, never markup, never a URL — it is user text on other people's screens.
 * No pin: that glyph labels the compose control. Here it would borrow the inspection
 * screens' language, and a caption that looks attested is the failure this exists to prevent.
 */
export function PlaceLine({ place, placeCc }) {
  const line = placeClaim(place, placeCc);
  if (!line) return null;
  return <p className="app-meta wk-place">{line}</p>;
}
