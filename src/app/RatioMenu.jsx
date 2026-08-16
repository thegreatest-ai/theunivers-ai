import { useEffect, useRef, useState } from 'react';
import { WORK_RATIOS } from '../../shared/work-ratio.mjs';

/**
 * The ratio chooser: a button that says what is chosen, and a popover that lets you change it.
 *
 * Closes on Escape, on outside click, and on choosing — the three ways a person expects a small
 * menu to go away. `aria-expanded` and `role="menu"` because a div that behaves like a menu and
 * does not say so is invisible to anyone not using their eyes.
 */
export function RatioMenu({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const current = WORK_RATIOS.find((r) => r.id === value) ?? WORK_RATIOS[0];

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!wrap.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', onDown);
    // Capture: the compose window traps Escape to close ITSELF, and closing the whole post because
    // somebody dismissed a dropdown would lose the work.
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <div className="cp-ratio-menu" ref={wrap}>
      <button
        type="button"
        className="cp-ratio-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="cp-ratio-word">Ratio</span>
        <span className="cp-ratio-value">{current.label}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M7 10l5 5 5-5z" />
        </svg>
      </button>
      {open && (
        <div className="cp-ratio-pop" role="menu">
          {WORK_RATIOS.map((r) => (
            <button
              key={r.id}
              type="button"
              role="menuitemradio"
              aria-checked={value === r.id}
              className={value === r.id ? 'on' : ''}
              onClick={() => { onChange(r.id); setOpen(false); }}
            >
              {r.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
