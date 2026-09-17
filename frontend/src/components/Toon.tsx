/**
 * Toon — the Olbano Plaza property-manager mascot.
 *
 * Flat-vector character introduced in the launch video (brag run
 * 2026-09-17-001151): a friendly property manager in the brand-blue blazer,
 * now the recurring face of empty states and onboarding surfaces.
 *
 * Pure inline SVG (no assets, no dependencies). Three poses:
 *  - "idle"   — neutral stance, for dense surfaces like empty states
 *  - "wave"   — one raised arm with a gentle CSS wave, for welcomes/onboarding
 *  - "point"  — presenting gesture, for guiding users toward an action
 *
 * The wave animation is defined once in index.css (@keyframes toon-wave) and
 * is automatically disabled by the global prefers-reduced-motion guard.
 */
const SKIN = '#f4c9a3';
const HAIR = '#2b2126';
const BLAZER = '#2563eb';
const BLAZER_DARK = '#1d4ed8';
const SKIRT = '#17306b';
const LEG_DARK = '#1e293b';
const LEG_LIGHT = '#243247';
const SHOE_DARK = '#0f172a';
const SHOE_LIGHT = '#111c33';

/** One shared SVG body; `pose` only changes the raised arm's transform. */
function poseTransform(pose: 'idle' | 'wave' | 'point'): string {
  if (pose === 'wave') return 'rotate(-140 135 152)';
  if (pose === 'point') return 'rotate(-100 135 152)';
  return 'none';
}

export function Toon({
  size = 96,
  pose = 'idle',
  animated = false,
  className = '',
  title,
}: {
  /** Rendered width in px; the drawing keeps its 200x320 ratio. */
  size?: number;
  pose?: 'idle' | 'wave' | 'point';
  /** Adds the waving animation to the raised arm (wave pose only). */
  animated?: boolean;
  className?: string;
  /** Accessible description; omit when the mascot is purely decorative. */
  title?: string;
}) {
  const height = Math.round((size * 320) / 200);
  const armClass = animated && pose === 'wave' ? 'toon-wave-arm' : undefined;
  return (
    <svg
      viewBox="0 0 200 320"
      width={size}
      height={height}
      className={className}
      role={title ? 'img' : 'presentation'}
      aria-hidden={title ? undefined : true}
      style={{ overflow: 'visible' }}
    >
      {title && <title>{title}</title>}
      {/* ground shadow */}
      <ellipse cx="100" cy="308" rx="50" ry="9" fill="rgba(0,0,0,0.15)" />
      {/* legs */}
      <g>
        <rect x="79" y="212" width="17" height="82" rx="8.5" fill={LEG_DARK} />
        <ellipse cx="87" cy="297" rx="15" ry="7.5" fill={SHOE_DARK} />
      </g>
      <g>
        <rect x="104" y="212" width="17" height="82" rx="8.5" fill={LEG_LIGHT} />
        <ellipse cx="113" cy="297" rx="15" ry="7.5" fill={SHOE_LIGHT} />
      </g>
      {/* skirt */}
      <path d="M64,206 L136,206 L150,240 L50,240 Z" fill={SKIRT} />
      {/* left arm (static; becomes the wave arm's anchor when mirrored poses are added) */}
      <g>
        <rect x="57" y="150" width="15" height="46" rx="7.5" fill={BLAZER} />
        <rect x="59" y="192" width="12" height="34" rx="6" fill={SKIN} />
        <circle cx="65" cy="228" r="7" fill={SKIN} />
      </g>
      {/* torso: blazer, tee, lanyard + badge */}
      <g>
        <rect x="67" y="138" width="66" height="74" rx="18" fill={BLAZER} />
        <path d="M100,140 L88,150 L100,166 L112,150 Z" fill="#f8fafc" />
        <rect x="93" y="156" width="15" height="20" rx="2.5" fill="#f8fafc" stroke="#cbd5e1" />
        <path d="M93,156 L100,146 L108,156" stroke={BLAZER_DARK} strokeWidth="2.5" fill="none" />
      </g>
      <rect x="92" y="126" width="16" height="16" fill={SKIN} />
      {/* head */}
      <g>
        <circle cx="100" cy="98" r="33" fill={SKIN} />
        <path d="M67,96 A33,33 0 0 1 133,96 L133,88 Q100,54 67,88 Z" fill={HAIR} />
        <circle cx="100" cy="52" r="13" fill={HAIR} />
        <circle cx="66" cy="106" r="3" fill="#f59e0b" />
        <circle cx="134" cy="106" r="3" fill="#f59e0b" />
        <circle cx="88" cy="100" r="3.4" fill="#1f2937" />
        <circle cx="112" cy="100" r="3.4" fill="#1f2937" />
        <rect x="82" y="90" width="12" height="3" rx="1.5" fill={HAIR} />
        <rect x="106" y="90" width="12" height="3" rx="1.5" fill={HAIR} />
        <circle cx="80" cy="110" r="4" fill="#f1a08c" opacity="0.55" />
        <circle cx="120" cy="110" r="4" fill="#f1a08c" opacity="0.55" />
        <path d="M91,112 Q100,120 109,112" stroke="#7c2d12" strokeWidth="3" fill="none" strokeLinecap="round" />
      </g>
      {/* right arm — pose depends on variant */}
      <g transform={poseTransform(pose)} className={armClass} style={{ transformOrigin: '135px 152px' }}>
        <rect x="128" y="150" width="15" height="46" rx="7.5" fill={BLAZER} />
        <rect x="129" y="192" width="12" height="34" rx="6" fill={SKIN} />
        <circle cx="135" cy="228" r="7" fill={SKIN} />
      </g>
    </svg>
  );
}
