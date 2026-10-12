import { useState, useRef, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Search, Building2, Users, Home, Receipt } from 'lucide-react';
import { api } from '../lib/api';

// ---------------------------------------------------------------------------
// Types — mirror the backend envelope for /api/reports/search
// ---------------------------------------------------------------------------

interface SearchResultItem {
  id: number;
  label: string;
  sub: string;
  to: string;
}

interface SearchResponse {
  properties: SearchResultItem[];
  tenants: SearchResultItem[];
  units: SearchResultItem[];
  receipts: SearchResultItem[];
}

// ---------------------------------------------------------------------------
// Icon per section — mirrors the xampp RMS material-symbol icons per section:
//   Properties  → domain  (building)
//   Tenants     → group   (users)
//   Units       → home    (home)
//   Invoices   → description (receipt/file)
// Localization: use lucide equivalents so we keep one icon set (lucide,
// stroke 1.75) across the whole app.
// ---------------------------------------------------------------------------

const SECTION_CONFIG: {
  key: keyof SearchResponse;
  label: string;
  icon: React.ReactNode;
}[] = [
  { key: 'properties', label: 'Properties', icon: <Building2 size={15} strokeWidth={1.75} aria-hidden /> },
  { key: 'tenants', label: 'Tenants', icon: <Users size={15} strokeWidth={1.75} aria-hidden /> },
  { key: 'units', label: 'Units', icon: <Home size={15} strokeWidth={1.75} aria-hidden /> },
  { key: 'receipts', label: 'Receipts', icon: <Receipt size={15} strokeWidth={1.75} aria-hidden /> },
];

// ---------------------------------------------------------------------------
// TopbarSearch — mirrors the xampp RMS topbar `topbar-search` + `#searchDropdown`
// behavior (design-system.css §SEARCH DROPDOWN):
//   * input with inline search icon, placeholder, autocomplete off;
//   * debounce 300ms (same as the PHP page's setTimeout);
//   * q.length < 2 → close (same guard);
//   * sectioned dropdown, one row per result with icon + label + sub + link;
//   * empty state "No results found" when every bucket is empty;
//   * close on outside click / Escape / blur.
// ---------------------------------------------------------------------------

export function TopbarSearch() {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setError(null);
  }, []);

  // Outside-click + Escape close — same as the PHP page's document-level
  // listener that hides #searchDropdown when the click lands outside the
  // input and the dropdown.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)
          && inputRef.current && !inputRef.current.contains(e.target as Node)) {
        close();
      }
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
  }, [open, close]);

  // Fetch search results — mirrors the PHP page's apiGet('/search?q=...')
  // call, debounced 300ms, with the same q.length < 2 guard.
  const runSearch = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setResults(null);
      setOpen(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<{ data: SearchResponse }>(`/api/reports/search?q=${encodeURIComponent(q.trim())}`).then((r) => r.data);
      setResults(data);
      setOpen(true);
    } catch (err) {
      setError((err as Error).message);
      setOpen(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleInput = useCallback((value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length < 2) {
      setResults(null);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(() => runSearch(value), 300);
  }, [runSearch]);

  // Re-run when query changes from the input — but only the debounced path
  // should call runSearch; this effect is the keyboard-input entry point.
  useEffect(() => {
    if (!query) { setResults(null); setOpen(false); return; }
  }, [query]);

  // Clear the debounce timer on unmount.
  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  // Focus the input when the panel opens via a section click isn't needed —
  // the input stays focused (the dropdown is a floating companion). But if
  // the user clicks a result link, the input should keep its text (the PHP
  // page does not clear it either).

  const hasResults = results && (
    results.properties.length > 0 ||
    results.tenants.length > 0 ||
    results.units.length > 0 ||
    results.receipts.length > 0
  );

  return (
    <div className="relative" ref={panelRef}>
      {/* Input — xampp RMS `.topbar-search` : position:relative, flex:1,
          max-width 480px, with a search icon absolutely positioned at
          left:10px, top:50%. Use lucide Search inside a button-like slot
          so we keep one icon set. */}
      <div className="relative flex w-full max-w-md items-center">
        <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2">
          <Search size={16} strokeWidth={1.75} className="text-gray-400" aria-hidden />
        </div>
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-expanded={open}
          aria-label="Search properties, tenants, units, or receipts"
          aria-autocomplete="list"
          aria-controls="topbarSearchDropdown"
          placeholder="Search properties, tenants, or invoices…"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          value={query}
          onChange={(e) => handleInput(e.target.value)}
          onFocus={() => {
            if (query.trim().length >= 2 && !loading) {
              // Re-open the last results when the user returns to the input,
              // mirroring the PHP page where the dropdown stays visible until
              // an outside click.
              if (hasResults) setOpen(true);
            }
          }}
          onBlur={() => {
            // Delay closing so a result-link click (which blurs the input)
            // lands first. The outside-click handler already covers pointer
            // dismissal, so a pure blur with open results keeps the panel.
            if (hasResults) return;
            setTimeout(() => { if (!open) return; close(); }, 120);
          }}
          className="w-full rounded-lg border border-gray-200 bg-white px-8 py-1.5 text-sm text-gray-900 placeholder-gray-400 transition-[border-color,box-shadow] duration-150 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/30"
        />
        {loading && (
          <div className="pointer-events-none animate-spin" aria-hidden>
            <Search size={14} strokeWidth={1.75} className="text-brand-500" />
          </div>
        )}
      </div>

      {/* Dropdown — xampp RMS `#searchDropdown` : absolute below the input,
          full width of the search column, max-height 300px, scroll, hidden
          until a result is available. */}
      {open && (hasResults || error) && (
        <div
          id="topbarSearchDropdown"
          role="listbox"
          aria-label="Search results"
          className="absolute z-50 mt-1 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg"
        >
          {error && (
            <div className="px-4 py-3 text-xs text-red-600">{error}</div>
          )}

          {results && (
            <>
              {SECTION_CONFIG.map(({ key, label, icon }) => {
                const items = results[key];
                if (items.length === 0) return null;
                return (
                  <div key={key} className="border-b border-gray-50 py-1">
                    {/* Section label — xampp RMS `.sd-label` : uppercase,
                        10px, gray-500, with the section icon. */}
                    <div className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                      {icon}
                      {label}
                      <span className="ml-auto text-[10px] font-normal text-gray-300">{items.length}</span>
                    </div>
                    {items.map((item) => (
                      <Link
                        key={`${key}-${item.id}`}
                        to={item.to}
                        className="flex items-center gap-2 px-3 py-2 text-sm text-gray-900 transition-colors duration-100 hover:bg-gray-50 hover:text-gray-700"
                        onClick={close}
                      >
                        <span className="shrink-0 text-gray-400">{icon}</span>
                        <span className="truncate font-medium">{item.label}</span>
                        {item.sub && (
                          <span className="ml-auto truncate text-[11px] text-gray-400">{item.sub}</span>
                        )}
                      </Link>
                    ))}
                  </div>
                );
              })}
            </>
          )}

          {results && !hasResults && (
            <div className="px-4 py-5 text-center text-sm text-gray-400">
              No results found
            </div>
          )}
        </div>
      )}

      {/* When the input is focused and there are no results yet but the query
          is long enough, show a one-line empty hint so the user knows the
          dropdown is waiting on the next keystroke. */}
      {open && query.trim().length >= 2 && !hasResults && !error && !loading && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-gray-100 bg-white shadow-sm">
          <div className="px-4 py-3 text-xs text-gray-400">Searching…</div>
        </div>
      )}
    </div>
  );
}
