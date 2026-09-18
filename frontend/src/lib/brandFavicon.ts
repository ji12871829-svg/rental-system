/**
 * Generates a monogram favicon (brand-colored rounded tile + white initials)
 * from the company legal name and swaps it in for the static building-icon
 * favicon. No-op until initials exist — the static /favicon.svg stays as the
 * pre-JS and fallback icon. Called from BrandingProvider whenever the
 * identity loads or changes.
 */
export function applyBrandFavicon(initials: string | null): void {
  if (!initials) return;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">` +
    `<rect width="32" height="32" rx="7" fill="#1559b3"/>` +
    `<text x="16" y="16" text-anchor="middle" dominant-baseline="central" ` +
    `font-family="system-ui,-apple-system,'Segoe UI',sans-serif" ` +
    `font-size="14" font-weight="700" fill="#fff">${initials}</text>` +
    `</svg>`;
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (link) link.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * Uses the uploaded business logo as the favicon (the URL is versioned by
 * upload time, so a new upload replaces it immediately). When no logo is
 * configured the monogram generator above stays in charge.
 */
export function applyLogoFavicon(url: string | null): void {
  if (!url) return;
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (link) link.href = url;
}
