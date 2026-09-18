// Brand image: renders the operator's uploaded logo (from
// /api/branding/logo, versioned so re-uploads bust caches) inside the same
// tile slot BrandMark occupies. Falls back to the monogram BrandMark until
// a logo exists — call sites swap one component for the other with no
// layout change.
import { useBranding } from '../lib/BrandingContext';
import { BrandMark } from './BrandMark';

export function BrandLogo({ className, iconSize, textClassName, alt = 'Business logo' }: {
  className: string;
  iconSize: number;
  textClassName?: string;
  alt?: string;
}) {
  const { logoUrl } = useBranding();
  if (!logoUrl) {
    return <BrandMark className={className} iconSize={iconSize} textClassName={textClassName} />;
  }
  // object-contain keeps wide/short marks inside the square tile without
  // distortion; overflow-hidden clips transparent padding the file may carry.
  return (
    <span className={`overflow-hidden ${className}`}>
      <img
        src={logoUrl}
        alt={alt}
        className="h-full w-full object-contain"
        draggable={false}
        loading="lazy"
        decoding="async"
      />
    </span>
  );
}
