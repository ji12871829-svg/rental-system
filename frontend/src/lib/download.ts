// One implementation of "download this authenticated endpoint as a file":
// fetch with the session cookie + CSRF header, surface the backend's error
// message when the response isn't OK, then save the blob via a temporary
// anchor. Replaces the copy-pasted fetch→blob→anchor block that had spread
// across the report/export pages.
import { authenticatedFetch } from './api';
import type { ApiErrorBody } from '@rpms/shared';

export async function downloadBlob(
  path: string,
  filename: string,
  /** Fallback message when the error body carries none (or isn't JSON). */
  failureMessage: (status: number) => string = (status) => `Download failed (${status}).`,
): Promise<void> {
  const res = await authenticatedFetch(path);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new Error(body?.message ?? failureMessage(res.status));
  }
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
