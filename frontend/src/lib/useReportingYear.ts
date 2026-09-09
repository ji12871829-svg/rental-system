// The reporting year (Settings) is the single source of truth for which
// billing year lists and exports cover — never hardcode a year in a page.
// GET /api/settings is open to all authenticated users; only updating it
// requires manager/admin, so every staff page can read it.
// Returns null while loading — callers should hold their queries until it
// resolves (useFetch's `enabled` option) rather than guessing a year.
import { useFetch } from '../components/ui';
import { api } from './api';

export function useReportingYear(): number | null {
  const { data } = useFetch<number>(
    () => api.get<{ data: { reporting_year: number } }>('/api/settings').then((r) => r.data.reporting_year),
    []
  );
  return data;
}

// Year-filter dropdown options around the reporting year: the year itself,
// one year back for history review, one year forward for early payments
// (e.g. January rent received in December).
export function reportingYearOptions(reportingYear: number | null): number[] {
  return reportingYear === null ? [] : [reportingYear - 1, reportingYear, reportingYear + 1];
}
