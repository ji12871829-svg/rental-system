import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../lib/theme';

// Compact icon button for headers. Swaps sun/moon by current theme and
// inherits color like every other header control, so the staff header, the
// portal top bar, and the landing header all style it the same.
//
// Touch sizing: 44px on phones (the comfortable minimum for a thumb target),
// back to the compact 40px on md+ screens where a pointer is precise. The
// size must live on the button itself — an absolutely-positioned overlay
// span "hit-area patch" was tried before and actively BROKE phones: the
// empty span painted on top with pointer-events:auto, so every tap hit the
// span (which has no handler) and the button underneath never fired.
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      className="flex h-11 w-11 items-center justify-center rounded-lg text-gray-500 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-700 active:scale-95 md:h-10 md:w-10"
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {theme === 'dark' ? <Sun size={18} strokeWidth={1.75} aria-hidden /> : <Moon size={18} strokeWidth={1.75} aria-hidden />}
    </button>
  );
}

// Landing header slot. Same component as everywhere else — the touch sizing
// is built in (44px below md, 40px from md up), so no wrapper is needed.
export function LandingThemeToggle() {
  return <ThemeToggle />;
}
