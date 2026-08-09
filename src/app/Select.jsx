/**
 * Select — a listbox with a fixed-height, scrolling panel.
 *
 * ─── Why this exists instead of <select> ──────────────────────────────────────────────────
 *
 * A native <select> hands its open list to the operating system. The browser ignores CSS
 * height/max-height on that popup, so with 150 countries you get an enormous OS-drawn list whose
 * position and scroll behaviour we do not control and cannot make consistent across platforms.
 *
 * This panel is an ordinary absolutely-positioned element inside the field's own stacking
 * context. It has a real max-height, it scrolls inside itself, and because it is anchored to the
 * field it travels with the field when the page scrolls — which is the behaviour people expect
 * and the native control does not reliably give.
 *
 * The cost of leaving the native control is that accessibility becomes our job. So it is done
 * properly here rather than left as a div that looks like a dropdown:
 *   - role=combobox on the trigger, role=listbox on the panel, role=option on each row
 *   - aria-expanded, aria-activedescendant, aria-selected
 *   - full keyboard: ↑ ↓ Home End Enter Escape Tab
 *   - the highlighted row is scrolled into view as you arrow through it
 *   - focus returns to the trigger on close, so Tab order is never lost
 * ─────────────────────────────────────────────────────────────────────────────────────────
 *
 * Accepts either shape:
 *   flat    [{ value, label }, …]
 *   grouped [{ group: 'Professional', items: [{ value, label }, …] }, …]
 */
import { useEffect, useMemo, useRef, useState } from 'react';

/** Flatten to the linear list the keyboard moves through. Groups are labels, not stops. */
function flatten(options) {
  return options.flatMap((o) => (o.items ? o.items : [o]));
}

export default function Select({
  value,
  onChange,
  options,
  placeholder = 'Choose one…',
  // Search appears on its own once a list is long enough to be tedious to scan. Below that it is
  // clutter — nobody wants to filter a two-item list.
  searchable = null,
  id,
  invalid = false,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const wrapRef = useRef(null);
  const triggerRef = useRef(null);
  const listRef = useRef(null);
  const searchRef = useRef(null);

  const all = useMemo(() => flatten(options), [options]);
  const showSearch = searchable ?? all.length > 8;
  const selected = all.find((o) => o.value === value) ?? null;

  /** Filter within groups, then drop groups that emptied — never show a heading with nothing under it. */
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    const keep = (o) => o.label.toLowerCase().includes(q);
    return options
      .map((o) => (o.items ? { ...o, items: o.items.filter(keep) } : o))
      .filter((o) => (o.items ? o.items.length > 0 : keep(o)));
  }, [options, query]);

  const shownFlat = useMemo(() => flatten(shown), [shown]);

  // Opening lands the highlight on the current value, so ↓ continues from where you are rather
  // than jumping to the top of the list.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    const i = shownFlat.findIndex((o) => o.value === value);
    setActive(i >= 0 ? i : 0);
    // The search box takes focus when present; otherwise the panel does, so keys reach us.
    requestAnimationFrame(() => (showSearch ? searchRef.current : listRef.current)?.focus());
  }, [open]);

  // Filtering can leave the highlight past the end of a shorter list.
  useEffect(() => { setActive(0); }, [query]);

  // Keep the highlighted row visible. block:'nearest' scrolls the panel only when it has to,
  // so arrowing through a visible list does not jerk it around.
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector(`[data-i="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  // Close on any click outside. pointerdown rather than click so the panel is gone before a
  // click on another control lands on it.
  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  function choose(opt) {
    if (!opt) return;
    onChange(opt.value);
    setOpen(false);
    triggerRef.current?.focus();   // never strand focus on a panel that no longer exists
  }

  function onKeyDown(e) {
    if (!open) {
      if (['Enter', ' ', 'ArrowDown'].includes(e.key)) { e.preventDefault(); setOpen(true); }
      return;
    }
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); setActive((i) => Math.min(i + 1, shownFlat.length - 1)); break;
      case 'ArrowUp':   e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); break;
      case 'Home':      e.preventDefault(); setActive(0); break;
      case 'End':       e.preventDefault(); setActive(shownFlat.length - 1); break;
      case 'Enter':     e.preventDefault(); choose(shownFlat[active]); break;
      case 'Escape':    e.preventDefault(); setOpen(false); triggerRef.current?.focus(); break;
      case 'Tab':       setOpen(false); break;   // let Tab move on; don't trap focus
      default: break;
    }
  }

  // Running index across groups — the keyboard sees one list, the eye sees sections.
  let i = -1;

  return (
    <div className="app-select" ref={wrapRef}>
      <button
        type="button"
        id={id}
        ref={triggerRef}
        className={`app-select-trigger${invalid ? ' bad' : ''}${open ? ' open' : ''}`}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKeyDown}
      >
        <span className={selected ? '' : 'app-select-ph'}>{selected ? selected.label : placeholder}</span>
        <svg width="11" height="7" viewBox="0 0 11 7" aria-hidden="true">
          <path d="M1 1l4.5 4.5L10 1" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div className="app-select-panel">
          {showSearch && (
            <input
              ref={searchRef}
              className="app-select-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Type to filter…"
              aria-label="Filter options"
              autoComplete="off"
            />
          )}

          <div
            className="app-select-list"
            ref={listRef}
            role="listbox"
            tabIndex={-1}
            onKeyDown={onKeyDown}
            aria-activedescendant={shownFlat[active] ? `opt-${active}` : undefined}
          >
            {shownFlat.length === 0 && <p className="app-select-empty">No match</p>}

            {shown.map((o) =>
              o.items ? (
                <div key={o.group} role="group" aria-label={o.group}>
                  <p className="app-select-group">{o.group}</p>
                  {o.items.map((it) => {
                    i += 1;
                    return <Row key={it.value} opt={it} i={i} active={active} value={value}
                                setActive={setActive} choose={choose} />;
                  })}
                </div>
              ) : (() => {
                i += 1;
                return <Row key={o.value} opt={o} i={i} active={active} value={value}
                            setActive={setActive} choose={choose} />;
              })(),
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ opt, i, active, value, setActive, choose }) {
  return (
    <div
      id={`opt-${i}`}
      data-i={i}
      role="option"
      aria-selected={opt.value === value}
      className={`app-select-opt${i === active ? ' on' : ''}${opt.value === value ? ' sel' : ''}`}
      // pointerdown, not click: the trigger's blur would otherwise close the panel first.
      onPointerDown={(e) => { e.preventDefault(); choose(opt); }}
      onMouseEnter={() => setActive(i)}
    >
      {opt.label}
    </div>
  );
}
