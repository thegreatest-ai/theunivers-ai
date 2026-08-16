/**
 * The author's claim of where a work is. ONE BUTTON, and nothing to type.
 *
 * It began as a typed field plus a country select, with "Use my location" added beside them.
 * The owner removed both: a person adding a location wants to press a button, not fill in a
 * form, and a country dropdown next to a resolved place name is a second way to say the same
 * thing — which is a second way to disagree with it. The geocoder still returns the country
 * code, so `place_cc` is still stored; it is simply no longer something to argue with.
 *
 * The inspection screens grade a captured position; this is a caption. Sharing their visual
 * language is how a string starts looking like evidence — the mock.js failure in a new costume.
 * So the published line is still `<where> · added by the author`, via `placeClaim()`. A device
 * position is trivially spoofable (`shared/assurance.mjs`); a resolved name is no better.
 *
 * The browser is asked on an explicit click, never on opening the form. Coordinates go to OUR
 * origin, the server names them and discards the fix.
 *
 * WITH NOTHING TO TYPE, EVERY FAILURE IS TERMINAL — there is no "you can type it instead" to
 * fall back on, so the messages say what happened and nothing more. A refusal must not re-prompt
 * in a loop: the browser will not ask again until the site setting changes, and pretending
 * otherwise is how a button becomes a thing people press repeatedly for no result.
 *
 * Never pre-filled from a previous post or the profile country. A location that reappears by
 * itself is how someone publishes a place they did not mean to. The chip is the way back out.
 */
import { useState } from 'react';
import { api } from './api';
import { PLACE_MAX, placeClaim } from '../../shared/place.mjs';

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
      setLocateError('Location is unavailable. Write it below instead.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const data = await api.reverseGeocode(pos.coords.latitude, pos.coords.longitude);
          if (!data?.place) {
            setLocateError('Could not find a place name for where you are. Write it below instead.');
            return;
          }
          onPlace(data.place);
          onPlaceCc(data.place_cc ?? '');
        } catch (err) {
          setLocateError(err.message || 'Could not look up this location.');
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
          setLocateError('Location is off for this site. Write it below instead.');
          return;
        }
        if (err?.code === 3) {
          setLocateError('Location timed out. Write it below instead.');
          return;
        }
        setLocateError('Location is unavailable. Write it below instead.');
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
      </div>
      {/*
        * EDITABLE, not just settable. The typed field was removed when the button arrived, and
        * that went too far: a geocoder returns the wrong suburb often enough, and a place nobody
        * can correct is one they either publish wrongly or abandon. So the resolved name lands
        * HERE, in a field, and the author confirms or fixes it before Share.
        *
        * The button still leads — pressing it is the fast path — and this is the correction, which
        * is why it sits under rather than beside. It appears once there is something to correct,
        * or when someone wants to write a place the sensor cannot name: a room, a site, a stand at
        * a fair.
        */}
      <div className="cp-place-edit">
        <input
          className="cp-place-input"
          placeholder="Or write where this is"
          aria-label="Location"
          maxLength={PLACE_MAX}
          value={place}
          autoComplete="off"
          onChange={(e) => onPlace(e.target.value)}
        />
        {chip ? (
          <button type="button" className="cp-place-chip-x" onClick={clearPlace}>
            ×<span className="sr-only">Remove location</span>
          </button>
        ) : null}
      </div>
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
