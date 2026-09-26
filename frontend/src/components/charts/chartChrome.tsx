// Shared tooltip + legend chrome for the chart renderers. Moved verbatim from
// the former single-file charts.tsx.
import type { ReactNode } from 'react';

export function TooltipBox(props: { x: number; y: number; width: number; children: ReactNode }) {
  const W = 180;
  const flip = props.x > props.width - W - 16;
  return (
    <div
      className="pointer-events-none absolute z-10 min-w-[110px] rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs shadow-md"
      style={{ left: props.x, top: props.y, transform: flip ? 'translate(calc(-100% - 12px), -50%)' : 'translate(12px, -50%)' }}
    >
      {props.children}
    </div>
  );
}

export function TooltipRow({ color, name, value }: { color?: string; name?: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5">
      <span className="flex items-center gap-1.5 text-gray-600">
        {color && <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />}
        {name}
      </span>
      <span className="font-medium tabular-nums text-gray-900">{value}</span>
    </div>
  );
}

export function ChartLegend({ items }: { items: { color: string; name: string }[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-1" style={{ minHeight: 20 }}>
      {items.map((it, i) => (
        <span key={i} className="flex items-center gap-1.5 text-xs text-gray-600">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: it.color }} />
          {it.name}
        </span>
      ))}
    </div>
  );
}
