// Count-up displays shared by the Dashboard's polled KPI strip and the
// provider health cards. Animations live here so every polled figure moves
// the same way. See useCountUp for the motion contract.
import { useEffect, useRef, useState } from 'react';
import { money } from '../lib/format';

// Animates a numeric display from its previous value toward a new one so a
// poll-driven change is *seen* rather than silently swapped. 600ms ease-out,
// requestAnimationFrame-driven. First paint shows the target immediately (no
// 0-to-N theater on load), prefers-reduced-motion jumps straight to the
// target, and a poll landing mid-animation resumes from the painted value.
function useCountUp(target: number, durationMs = 600): { value: number; flash: boolean } {
  const [display, setDisplay] = useState(target);
  const [flash, setFlash] = useState(false);
  const fromRef = useRef(target);
  const rafRef = useRef(0);
  const flashTimer = useRef(0);

  useEffect(() => {
    const from = fromRef.current;
    if (from === target) return;
    // Signal the change so the display can flash (CSS keyframe, index.css).
    window.clearTimeout(flashTimer.current);
    setFlash(true);
    flashTimer.current = window.setTimeout(() => setFlash(false), 1100);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || document.visibilityState === 'hidden') {
      fromRef.current = target;
      setDisplay(target);
      return;
    }
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / durationMs);
      const eased = 1 - Math.pow(1 - k, 3);
      if (k < 1) {
        setDisplay(from + (target - from) * eased);
        rafRef.current = requestAnimationFrame(step);
      } else {
        fromRef.current = target;
        setDisplay(target);
      }
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      window.clearTimeout(flashTimer.current);
      cancelAnimationFrame(rafRef.current);
      // Preserve partial progress as the next animation's start point if a
      // newer target arrived mid-flight.
      setDisplay((cur) => {
        fromRef.current = cur;
        return cur;
      });
    };
  }, [target, durationMs]);

  return { value: display, flash };
}

// Formatted count-up displays for the polled KPI strip. Both keep the label
// readable while animating (real text, no icon-only swap) and hold still
// when a poll returns unchanged numbers.
export function CountMoney({ value, currency }: { value: number; currency?: string }) {
  const { value: v, flash } = useCountUp(value);
  return <span className={flash ? 'value-flash' : undefined}>{money(v, currency)}</span>;
}

export function Count({ value }: { value: number }) {
  const { value: v, flash } = useCountUp(value);
  return <span className={flash ? 'value-flash' : undefined}>{Math.round(v).toLocaleString('en-KE')}</span>;
}
