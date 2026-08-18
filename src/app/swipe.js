/**
 * Horizontal swipe on an element. A carousel on a phone is a finger, not a labelled
 * button — but the buttons stay, because a swipe is an extra path, not the only one.
 *
 * Pointer events cover mouse and touch. A mostly-vertical drag is ignored so scrolling
 * the page does not steal the carousel, which is the failure a naive dx-threshold has.
 */
export function bindSwipeX(el, { onPrev, onNext, threshold = 48 } = {}) {
  if (!el) return () => {};
  let origin = null;

  function point(e) {
    const t = e.changedTouches?.[0] || e.touches?.[0];
    return { x: t?.clientX ?? e.clientX, y: t?.clientY ?? e.clientY };
  }

  function down(e) { origin = point(e); }
  function cancel() { origin = null; }
  function up(e) {
    if (!origin) return;
    const p = point(e);
    const dx = p.x - origin.x;
    const dy = p.y - origin.y;
    origin = null;
    if (Math.abs(dx) < threshold || Math.abs(dx) < Math.abs(dy)) return;
    if (dx < 0) onNext?.();
    else onPrev?.();
  }

  el.addEventListener('pointerdown', down);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', cancel);
  return () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', cancel);
  };
}
