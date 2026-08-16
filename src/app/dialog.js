/**
 * Focus trap for a modal. One implementation — WorkDetail and CreatePost both use it.
 * Two copies would drift, and the second one is how escape stops working on one of them.
 *
 * Escape closes, Tab cycles inside the dialog, focus returns to whoever opened it.
 */
export function trapFocus(root, onClose) {
  const prev = document.activeElement;
  const items = () => [...root.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
  )].filter((el) => !el.disabled && el.offsetParent !== null);
  items()[0]?.focus();

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key !== 'Tab') return;
    const list = items();
    if (!list.length) return;
    const first = list[0];
    const last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
  document.addEventListener('keydown', onKey);
  return () => {
    document.removeEventListener('keydown', onKey);
    if (prev && typeof prev.focus === 'function') prev.focus();
  };
}
