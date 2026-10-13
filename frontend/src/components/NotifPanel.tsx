import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, MessageSquare, Smartphone } from 'lucide-react';
import { api, authenticatedFetch } from '../lib/api';

// ---------------------------------------------------------------------------
// Types — mirror the backend envelope for /api/reports/notifications-summary
// ---------------------------------------------------------------------------

interface NotifFeedItem {
  id: number;
  channel: 'SMS' | 'EMAIL';
  status: 'PENDING' | 'SENT' | 'FAILED' | 'ERRONEOUS';
  unread: boolean;
  subject: string | null;
  recipient: string;
  createdAt: string | null;
  failureReason: string | null;
  providerMessageId: string | null;
}

export interface NotifSummary {
  unread: number;
  unreadCounts: {
    sms: { unread: number; pending: number; failed: number; erroneous: number };
    email: { unread: number; pending: number; failed: number; erroneous: number };
  };
  feed: NotifFeedItem[];
}

// ---------------------------------------------------------------------------
// Status → visual tone, following the xampp RMS `.notif-item` convention
// (icon + text + time), with local Tailwind color tokens for status.
// ---------------------------------------------------------------------------

function itemTone(status: NotifFeedItem['status']): { dot: string; text: string; icon: React.ReactNode } {
  if (status === 'SENT') {
    return {
      dot: 'bg-emerald-500',
      text: 'text-gray-600',
      icon: <CheckCheck size={15} strokeWidth={2} className="shrink-0 text-emerald-600" aria-hidden />,
    };
  }
  if (status === 'PENDING') {
    return {
      dot: 'bg-amber-500',
      text: 'text-gray-900',
      icon: <Smartphone size={15} strokeWidth={2} className="shrink-0 text-amber-600" aria-hidden />,
    };
  }
  if (status === 'FAILED') {
    return {
      dot: 'bg-red-500',
      text: 'text-red-700',
      icon: <Smartphone size={15} strokeWidth={2} className="shrink-0 text-red-600" aria-hidden />,
    };
  }
  // ERRONEOUS — terminal address rejection
  return {
    dot: 'bg-red-500',
    text: 'text-red-700',
    icon: <MessageSquare size={15} strokeWidth={2} className="shrink-0 text-red-600" aria-hidden />,
  };
}

function timeAgo(createdAt: string | null): string {
  if (!createdAt) return 'just now';
  const e = new Date(createdAt);
  if (isNaN(e.getTime())) return '';
  const s = Math.floor((Date.now() - e.getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

// ---------------------------------------------------------------------------
// NotifPanel — dropdown triggered by a bell button, mirrored on the xampp
// RMS topbar `notifBtn` + `#notifPanel` pattern (design-system.css §NOTIFICATION
// PANEL). Unlike the static PHP page, the local panel:
//   * polls the live unread count + recent feed, so it reflects real delivery
//     state instead of a PHP render-time snapshot;
//   * calls PATCH .../mark-all-read to clear the unread badge (the xampp RMS
//     `markAllRead` button wired to GET ?action=mark_all_read).
// ---------------------------------------------------------------------------

export function NotifPanel({
  unread,
  onUnreadChange,
}: {
  unread: number;
  onUnreadChange?: (unread: number) => void;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<NotifSummary | null>(null);
  const [markingRead, setMarkingRead] = useState(false);
  const [markReadError, setMarkReadError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  // The trigger lives OUTSIDE panelRef, so an outside-click on the bell would
  // close the panel a beat before the button's own onClick toggled it open
  // again — the panel then looked impossible to dismiss. Track the trigger
  // separately and let its onClick own that element.
  const triggerRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback(() => setOpen(false), []);

  // Dismiss on outside click and Escape — same behavior as the xampp RMS
  // `#notifPanel` toggle (clicking the bell again or outside closes it).
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return; // the button's onClick handles it
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('mousedown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, close]);

  // Poll summary + recent feed every 30s while the panel is open so the
  // badge reflects live delivery state (PENDING/FAILED/ERRONEOUS) instead of
  // a render-time snapshot. Closed panels do not poll — the topbar badge is
  // the only live indicator, and it refreshes on the page's own cadence via
  // the parent component (Layout) passing `unread` from the dashboard poll.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const load = async () => {
      try {
        const data = await api.get<{ data: NotifSummary }>('/api/reports/notifications-summary').then((r) => r.data);
        if (!cancelled) setSummary(data);
      } catch {
        // Non-blocking: the panel still renders whatever summary it last had.
      }
      if (!cancelled) timer = setTimeout(load, 30_000);
    };

    load();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleMarkAllRead = async () => {
    setMarkingRead(true);
    setMarkReadError(null);
    try {
      await authenticatedFetch('/api/reports/notifications-summary/mark-all-read', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channels: ['SMS', 'EMAIL'] }),
      }).then((res) => {
        if (!res.ok) throw new Error(`mark-all-read failed: ${res.status}`);
        return res.json() as Promise<{ data: { cleared: number } }>;
      });
      // Re-fetch so the panel reflects the cleared state immediately.
      const data = await api.get<{ data: NotifSummary }>('/api/reports/notifications-summary').then((r) => r.data);
      setSummary(data);
      onUnreadChange?.(data.unread);
    } catch (err) {
      setMarkReadError((err as Error).message);
    } finally {
      setMarkingRead(false);
    }
  };

  const feed = summary?.feed ?? [];
  const unreadCount = summary?.unread ?? unread;

  return (
    <>
      {/* Bell trigger — xampp RMS `.topbar-btn` bell pattern, with an
          absolute badge dot when there are unread items. Visible at every
          breakpoint: this is the only bell in the app (the badge below is a
          sibling span, not a button), so hiding the trigger at md+ used to
          leave an unclickable "9+" floating next to the date. */}
      <div className="relative" ref={triggerRef}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-500 transition-colors duration-150 hover:bg-gray-100 active:scale-95"
          aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
          aria-expanded={open}
          aria-haspopup="true"
        >
          <Bell size={20} strokeWidth={1.75} aria-hidden />
        </button>
        {unreadCount > 0 && (
          <span
            className="pointer-events-none absolute -top-0.5 right-0 flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-[10px] font-bold text-white"
            aria-label={`${unreadCount} unread notifications`}
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </div>

      {/* Panel — xampp RMS `.notif-panel` + `.notif-panel.show` : absolute,
          right-aligned, 320px, shadow-lg, hidden until open. */}
      {open && (
        <div
          ref={panelRef}
          className="absolute right-0 mt-2 w-80 animate-in fade-in duration-150 md:right-auto md:w-72 md:animate-in md:slide-in-from-top-2"
          role="region"
          aria-label="Notifications"
        >
          <div className="z-50">
            {/* Header — xampp RMS `.notif-header` : title + "Mark all read". */}
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
              <h4 className="text-sm font-semibold text-gray-900">Notifications</h4>
              <button
                type="button"
                onClick={handleMarkAllRead}
                disabled={markingRead || unreadCount === 0}
                className="text-xs font-medium text-brand-600 transition-colors duration-150 hover:text-brand-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {markingRead ? 'Marking…' : unreadCount > 0 ? 'Mark all read' : 'All read'}
              </button>
            </div>

            {markReadError && (
              <div className="px-4 py-2 text-xs text-red-600">{markReadError}</div>
            )}

            {/* List — xampp RMS `.notif-list` : max-height + scroll. */}
            <div className="max-h-[320px] overflow-y-auto">
              {summary === null && feed.length === 0 && (
                <div className="flex items-center justify-center py-8 text-sm text-gray-400">
                  Loading…
                </div>
              )}

              {summary !== null && feed.length === 0 && (
                <div className="px-4 py-6 text-center text-sm text-gray-400">
                  No notifications yet.
                </div>
              )}

              {feed.map((item) => {
                const tone = itemTone(item.status);
                return (
                  <div
                    key={`${item.channel}-${item.id}`}
                    className={`border-b border-gray-50 px-4 py-3 transition-colors duration-100 ${
                      item.unread ? 'bg-brand-50/40' : ''
                    }`}
                  >
                    <div className="flex gap-3">
                      {/* Icon slot — xampp RMS `.ni-icon`, recolored by status. */}
                      <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${tone.dot} border-transparent`}>
                        {tone.icon}
                      </div>
                      <div className={`min-w-0 flex-1 ${tone.text}`}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs font-medium text-gray-900">
                            {item.subject ?? `${item.channel} message`}
                          </span>
                          <span className="shrink-0 text-[10px] uppercase tracking-wide text-gray-400">
                            {timeAgo(item.createdAt)}
                          </span>
                        </div>
                        <div className="mt-0.5 truncate text-[11px] text-gray-500">
                          {item.channel === 'SMS'
                            ? `To ${item.recipient}`
                            : item.recipient}
                          {item.failureReason && (
                            <span className="ml-1 text-red-500">· {item.failureReason}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer — deep links to the full history pages
                (xampp RMS has these as sidebar nav; we surface them here too). */}
            <div className="border-t border-gray-100 px-4 py-2 space-y-1">
              <button
                type="button"
                onClick={() => { close(); navigate('/sms'); }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-gray-500 transition-colors duration-150 hover:bg-gray-50 hover:text-gray-700"
              >
                <Smartphone size={13} strokeWidth={2} aria-hidden />
                Review SMS
              </button>
              <button
                type="button"
                onClick={() => { close(); navigate('/emails'); }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-gray-500 transition-colors duration-150 hover:bg-gray-50 hover:text-gray-700"
              >
                <MessageSquare size={13} strokeWidth={2} aria-hidden />
                Review Emails
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
