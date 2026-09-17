// Shared URL ↔ state sync for page filters and deep-link flags.
//
// Seven pages repeated the same dance: useState seeded from
// `params.get(key)` plus a useEffect that mirrors changes back with
// `setParams(next, { replace: true })` so deep links (?unit=1, ?month=9,
// ?new=1) stay shareable. These two hooks own that pattern once.
//
//   const [unit, setUnit] = useQueryParam('unit');     // string ('' = unset)
//   const [open, setOpen] = useQueryToggle('new');     // boolean flag
//
// Behaviour matches what the pages did by hand:
//   * initial value is read from the URL, so ?unit=1 lands pre-filtered;
//   * setting a value writes it into the query string via replaceState
//     (no history spam) and preserves all *other* params on the page;
//   * clearing (empty string / false) removes the key entirely, keeping
//     URLs clean instead of accumulating `?unit=&month=`.
//   * concurrent multi-param updates are merged through setSearchParams'
//     updater form, so two setters firing in one commit can't overwrite
//     each other's param.

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

function normalize(value: string | null): string {
  return value ?? '';
}

/**
 * A single string query param, mirrored both ways.
 * `''` means "not set" — the key is removed from the URL while empty.
 */
export function useQueryParam(key: string): [string, (value: string) => void] {
  const [params, setParams] = useSearchParams();
  const [value, setValue] = useState(() => normalize(params.get(key)));

  // Keep the URL in sync (replace: true — filter churn must not flood
  // history). Skips the write when nothing changed, and reads the *latest*
  // params inside an updater so simultaneous writers merge instead of
  // clobbering each other's keys.
  useEffect(() => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next.toString() === prev.toString() ? prev : next;
      },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, value]);

  const set = useCallback(
    (next: string) => setValue(next === null || next === undefined ? '' : next),
    [],
  );

  return [value, set];
}

/**
 * A boolean "flag" param such as ?new=1 (quick-action auto-open).
 * `true` writes `1`; `false` removes the key.
 */
export function useQueryToggle(key: string): [boolean, (value: boolean) => void] {
  const [params, setParams] = useSearchParams();
  const [on, setOn] = useState(() => params.get(key) === '1');

  useEffect(() => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (on) next.set(key, '1');
        else next.delete(key);
        return next.toString() === prev.toString() ? prev : next;
      },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, on]);

  return [on, setOn];
}
