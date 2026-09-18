import { useNavigate } from 'react-router-dom';
import { Droplets, ReceiptText, Wallet, type LucideIcon } from 'lucide-react';
import { Button } from './ui';
import { useAuth } from '../lib/auth';

// The one-tap task shortcuts shared by the Dashboard header and the mobile
// drawer, so they're reachable from any page. Each lands with ?new=1, which
// auto-opens the target page's form — or focuses it, for the inline rent
// form. Add Expense is manager-only, matching the Expenses page's own
// permissions.
interface QuickAction {
  to: string;
  label: string;
  icon: LucideIcon;
  managerOnly?: boolean;
}

const ACTIONS: QuickAction[] = [
  { to: '/rent?new=1', label: 'Record Payment', icon: Wallet },
  { to: '/water-meter?new=1', label: 'Log Reading', icon: Droplets },
  { to: '/expenses?new=1', label: 'Add Expense', icon: ReceiptText, managerOnly: true },
];

export function QuickActions({ variant, onNavigate }: { variant: 'header' | 'drawer'; onNavigate?: () => void }) {
  const navigate = useNavigate();
  const { canManage } = useAuth();
  const items = ACTIONS.filter((a) => !a.managerOnly || canManage);

  const go = (to: string) => {
    onNavigate?.();
    navigate(to);
  };

  if (variant === 'header') {
    return (
      <>
        {items.map((a) => (
          <Button key={a.to} variant="secondary" onClick={() => go(a.to)}>
            <a.icon size={16} strokeWidth={1.75} aria-hidden /> {a.label}
          </Button>
        ))}
      </>
    );
  }

  // Drawer variant: compact full-width rows on the dark sidebar, matching
  // the nav tabs' geometry (insets, min-height, icon size) so the drawer
  // reads as one menu.
  return (
    <div className="px-3 pt-1">
      <div className="flex min-h-6 items-center px-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        Quick actions
      </div>
      <div className="space-y-0.5 pl-1">
        {items.map((a) => (
          <button
            key={a.to}
            type="button"
            onClick={() => go(a.to)}
            className="flex min-h-[26px] w-full items-center gap-2 rounded-md px-2.5 py-1 text-[13px] leading-tight font-medium text-slate-300 transition-colors duration-150 hover:bg-slate-700/60 hover:text-white"
          >
            <a.icon size={15} strokeWidth={1.75} aria-hidden className="shrink-0" />
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}
