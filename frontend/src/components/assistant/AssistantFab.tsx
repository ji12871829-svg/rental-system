// Floating assistant cube: one tap opens the copilot from any staff page.
// Bottom-right rounded square (the requested "cube"), opening a chat panel
// with the SAME AssistantChat the /assistant page renders — identical
// labels, mic, drafts and approval flow in both places. Mounted in Layout
// (staff-only shell), so it never appears on public/login/portal surfaces.
// Escape closes; the header links to the full page for long sessions.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, X } from 'lucide-react';
import AssistantChat from './AssistantChat';

export default function AssistantFab() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      {open && (
        <div
          role="dialog"
          aria-label="Assistant chat"
          className="fixed bottom-24 right-4 z-50 flex max-h-[70vh] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-gray-200"
        >
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
            <span className="text-sm font-semibold text-gray-900">Assistant</span>
            <div className="flex items-center gap-1">
              <Link
                to="/assistant"
                onClick={() => setOpen(false)}
                className="rounded-lg px-2 py-1 text-xs font-semibold text-brand-600 transition-colors duration-150 hover:text-brand-700 hover:underline"
              >
                Full page →
              </Link>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close assistant chat"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 transition-colors duration-150 hover:bg-gray-100 active:scale-95"
              >
                <X size={18} strokeWidth={1.75} aria-hidden />
              </button>
            </div>
          </div>
          <div className="overflow-y-auto px-4 py-3">
            <AssistantChat />
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close assistant' : 'Open assistant'}
        aria-expanded={open}
        title="Ask the assistant"
        className="fixed bottom-6 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-500 text-white shadow-lg transition-all duration-150 hover:bg-brand-600 active:scale-95"
      >
        {open ? (
          <X size={22} strokeWidth={2} aria-hidden />
        ) : (
          <Sparkles size={22} strokeWidth={2} aria-hidden />
        )}
      </button>
    </>
  );
}
