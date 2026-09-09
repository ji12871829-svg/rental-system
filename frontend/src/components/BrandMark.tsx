import { Building2 } from 'lucide-react';
import { useBranding } from '../lib/BrandingContext';

/**
 * Brand tile: shows the monogram initials derived from the company legal
 * name (live from /api/branding), falling back to the building icon until
 * then. Pass the tile's className and icon size exactly as before — only the
 * inner content switches.
 */
export function BrandMark({ className, iconSize, textClassName = 'text-sm font-bold' }: {
  className: string;
  iconSize: number;
  textClassName?: string;
}) {
  const { identity } = useBranding();
  const initials = identity?.brandInitials ?? null;
  if (!initials) {
    return (
      <span className={className}>
        <Building2 size={iconSize} strokeWidth={1.75} aria-hidden />
      </span>
    );
  }
  return (
    <span className={className} aria-hidden>
      <span className={textClassName}>{initials}</span>
    </span>
  );
}
