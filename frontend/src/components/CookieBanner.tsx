import { useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { branding } from '../lib/branding';

const STORAGE_KEY = 'rpms.storage-notice-ack';

// The banner publishes its live height as a CSS custom property on <html> so
// other bottom-docked surfaces (the landing page's sticky mobile action bar)
// can lift themselves above this notice instead of being painted over by it.
// ResizeObserver keeps the value exact when the text wraps differently per
// viewport width; the property is removed on acknowledge/unmount so the bar
// settles back to the true bottom edge.
const BANNER_H_VAR = '--rpms-banner-h';

/**
 * Storage-notice banner. The app uses no tracking cookies — only a required
 * an HttpOnly session cookie and a dismissal flag in localStorage — but we say so once,
 * prominently, and link to the full policy.
 */
export default function CookieBanner() {
  const [acknowledged, setAcknowledged] = useState(() => localStorage.getItem(STORAGE_KEY) === '1');
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (acknowledged) {
      document.documentElement.style.removeProperty(BANNER_H_VAR);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const publish = () => document.documentElement.style.setProperty(BANNER_H_VAR, `${el.offsetHeight}px`);
    publish();
    // Text rewraps on viewport width changes (and once after fonts load),
    // so republish on resize plus a short settle tick — deterministic and
    // cheap, and the value is only consumed by bottom-docked surfaces.
    window.addEventListener('resize', publish, { passive: true });
    const settle = window.setTimeout(publish, 350);
    return () => {
      window.removeEventListener('resize', publish);
      window.clearTimeout(settle);
      document.documentElement.style.removeProperty(BANNER_H_VAR);
    };
  }, [acknowledged]);

  if (acknowledged) return null;

  function accept() {
    localStorage.setItem(STORAGE_KEY, '1');
    setAcknowledged(true);
  }

  return (
    <div
      ref={ref}
      role="region"
      aria-label="Storage notice"
      className="fixed inset-x-0 bottom-0 z-[70] border-t border-gray-200 bg-white/95 p-3 shadow-[0_-4px_16px_rgb(0_0_0/0.06)] backdrop-blur animate-in slide-in-from-bottom-2 duration-200"
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
    >
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-1 sm:px-4">
        <ShieldCheck size={18} strokeWidth={1.75} className="shrink-0 text-brand-600" aria-hidden />
        <p className="min-w-0 flex-1 text-xs leading-5 text-gray-700">
          {branding.appName} stores a sign-in session in a secure cookie and your preferences in this browser's local storage. No advertising or
          tracking cookies are used.{' '}
          <Link to="/cookies" className="font-medium text-brand-600 underline underline-offset-2 hover:text-brand-700">
            Learn more
          </Link>
        </p>
        <button
          onClick={accept}
          className="inline-flex min-h-[36px] items-center rounded-lg bg-brand-500 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition-[background-color,transform] duration-150 hover:bg-brand-600 active:scale-[0.96]"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
