import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../lib/theme';

// Compact icon button for headers. Swaps sun/moon by current theme and
// inherits color like every other header control, so both the staff header
// and the portal top bar style it the same. The button itself stays a compact
// 40px control (correct for dense app headers); the LANDING page — a public,
// phone-first marketing surface — wraps it in a hit-area patch to reach the
// 44px touch minimum without inflating the button everywhere.
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-500 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-700 active:scale-95"
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {theme === 'dark' ? <Sun size={18} strokeWidth={1.75} aria-hidden /> : <Moon size={18} strokeWidth={1.75} aria-hidden />}
    </button>
  );
}

// Landing-only touch patch: stretches the compact 40px ThemeToggle to a 44px
// tap target without restyling the shared button (which app headers rely on).
// The pseudo-element sits at the button's center and grows the clickable area
// by 2px on each edge; layout is untouched.
export function LandingThemeToggle() {
  return (
    <span className="relative inline-flex">
      <ThemeToggle />
      <span
        aria-hidden
        className="absolute left-1/2 top-1/2 h-11 w-11 -translate-x-1/2 -translate-y-1/2"
        style={{ pointerEvents: 'auto' }}
      />
    </span>
  );
}
