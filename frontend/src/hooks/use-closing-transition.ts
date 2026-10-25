import { useEffect, useState } from 'react';

// Matches the modals' own content-panel animation duration (duration-200) —
// keeping this in step with that class means the real unmount lands right
// as the exit animation finishes, not before or after.
const EXIT_MS = 200;

/**
 * These modals are plain conditionally-rendered `{open && <Modal/>}` — React
 * removes them from the DOM the instant `open` goes false, which skips
 * right past any CSS exit animation (only entrance ever plays). This hook
 * adds a `closing` flag: call `requestClose()` from every user-facing close
 * action (X button, backdrop click, Escape) instead of the real `onClose`
 * prop — it flips `closing` so the caller can swap to exit-animation
 * classes, then calls the real `onClose` after the animation's duration so
 * the parent unmounts once it's actually finished playing.
 */
export function useClosingTransition(onClose: () => void) {
  const [closing, setClosing] = useState(false);

  const requestClose = () => setClosing(true);

  useEffect(() => {
    if (!closing) return;
    const t = setTimeout(onClose, EXIT_MS);
    return () => clearTimeout(t);
    // onClose intentionally excluded — re-running this effect if the parent
    // passes a new onClose identity on re-render would restart the timer
    // and delay the close indefinitely.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closing]);

  return { closing, requestClose };
}
