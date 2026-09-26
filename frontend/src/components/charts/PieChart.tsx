// Pie/donut chart renderer. Moved verbatim from the former single-file
// charts.tsx (imports adjusted to the charts/ modules).
import {
  Children,
  isValidElement,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import type { CellConfig, ChartDatum, DataKey, SeriesConfig, TooltipFormatter } from './types';
import { Tooltip, Legend, Pie, Cell } from './elements';
import { pick, getVal } from './chartUtils';
import { TooltipBox, TooltipRow, ChartLegend } from './chartChrome';

export function PieChart(props: {
  containerWidth?: number;
  width?: number;
  height?: number;
  children?: ReactNode;
  className?: string;
  // Optional click handler — fires with the slice's datum + index. Used for
  // chart → page deep links.
  onSliceClick?: (datum: ChartDatum, index: number) => void;
}) {
  const { children, containerWidth, className, onSliceClick } = props;
  const width = containerWidth ?? 600;
  const height = 260;
  const [hover, setHover] = useState<{ name: string; value: any; px: number; py: number } | null>(null);

  const pies = pick<{ data: ChartDatum[]; dataKey: DataKey; nameKey?: DataKey; innerRadius?: number; outerRadius?: number; label?: SeriesConfig['label']; children?: ReactNode }>(children, Pie);
  const pie = pies[0];
  const tooltips = pick<{ formatter?: TooltipFormatter }>(children, Tooltip);
  const tooltipFormatter = tooltips[0]?.props.formatter;
  const hasLegend = pick(children, Legend).length > 0;

  const slices = useMemo(() => {
    if (!pie) return [];
    const cells = Children.toArray(pie.props.children)
      .filter((c): c is ReactElement<CellConfig> => isValidElement(c) && c.type === Cell)
      .map((c) => c.props.fill);
    const total = pie.props.data.reduce((acc: number, d) => acc + (Number(getVal(d, pie.props.dataKey)) || 0), 0);
    let angle = 0;
    return pie.props.data.map((d, i) => {
      const value = Number(getVal(d, pie.props.dataKey)) || 0;
      const name = String(getVal(d, pie.props.nameKey) ?? '');
      const sweep = total > 0 ? (value / total) * Math.PI * 2 : 0;
      const start = angle;
      angle += sweep;
      return {
        d,
        name,
        value,
        color: cells[i] ?? '#1d6fd6',
        start,
        end: angle,
      };
    });
  }, [pie]);

  if (!pie) return null;
  const outerRadius = pie.props.outerRadius ?? 90;
  // Donut support: an innerRadius > 0 punches a hole in each sector so a
  // centered readout (occupancy %, dominant method) can sit in the middle.
  const innerRadius = Math.min(pie.props.innerRadius ?? 0, outerRadius - 2);
  const cx = width / 2;
  const cy = (height - (hasLegend ? 24 : 0)) / 2;
  const arc = (r: number, a: number) => ({ x: cx + r * Math.sin(a), y: cy - r * Math.cos(a) });
  const sectorPath = (s: { start: number; end: number }) => {
    if (innerRadius > 0) {
      // Donut sector: outer arc clockwise, line to inner arc, back.
      if (s.end - s.start >= Math.PI * 2 - 1e-9) {
        const p1 = arc(outerRadius, 0);
        const p2 = arc(outerRadius, Math.PI * 2 - 1e-6);
        const q1 = arc(innerRadius, 0);
        const q2 = arc(innerRadius, Math.PI * 2 - 1e-6);
        return `M${p1.x},${p1.y} A${outerRadius},${outerRadius} 0 1 1 ${p2.x},${p2.y} L${q2.x},${q2.y} A${innerRadius},${innerRadius} 0 1 0 ${q1.x},${q1.y} Z`;
      }
      const p1 = arc(outerRadius, s.start);
      const p2 = arc(outerRadius, s.end);
      const q2 = arc(innerRadius, s.end);
      const q1 = arc(innerRadius, s.start);
      const large = s.end - s.start > Math.PI ? 1 : 0;
      return `M${p1.x},${p1.y} A${outerRadius},${outerRadius} 0 ${large} 1 ${p2.x},${p2.y} L${q2.x},${q2.y} A${innerRadius},${innerRadius} 0 ${large} 0 ${q1.x},${q1.y} Z`;
    }
    if (s.end - s.start >= Math.PI * 2 - 1e-9) {
      return `M${cx},${cy - outerRadius} A${outerRadius},${outerRadius} 0 1 1 ${cx - 0.01},${cy - outerRadius} Z`;
    }
    const p1 = arc(outerRadius, s.start);
    const p2 = arc(outerRadius, s.end);
    const large = s.end - s.start > Math.PI ? 1 : 0;
    return `M${cx},${cy} L${p1.x},${p1.y} A${outerRadius},${outerRadius} 0 ${large} 1 ${p2.x},${p2.y} Z`;
  };
  const labelOf = (d: ChartDatum) => {
    const l = pie.props.label;
    if (l === true) return String(getVal(d, pie.props.nameKey) ?? '');
    if (typeof l === 'function') return l(d);
    return null;
  };

  return (
    <div className={className} style={{ position: 'relative', width, height: height + (hasLegend ? 24 : 0) }}>
      <svg width={width} height={height} role="img" style={{ display: 'block' }}>
        {slices.map((s, i) => {
          const mid = (s.start + s.end) / 2;
          const lp = arc(outerRadius + 12, mid);
          const text = labelOf(s.d);
          return (
            <g key={i}>
              <path
                d={sectorPath(s)}
                fill={s.color}
                stroke="var(--chart-surface)"
                strokeWidth={1.5}
                opacity={hover && hover.name !== s.name ? 0.55 : 1}
                onPointerMove={(e) => {
                  const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                  setHover({ name: s.name, value: s.value, px: e.clientX - rect.left, py: e.clientY - rect.top });
                }}
                onPointerLeave={() => setHover(null)}
                style={onSliceClick ? { cursor: 'pointer' } : undefined}
                onClick={onSliceClick ? () => onSliceClick(s.d, i) : undefined}
              />
              {text && s.value > 0 && (
                <text
                  x={lp.x}
                  y={lp.y + 3.5}
                  textAnchor={Math.sin(mid) >= 0 ? 'start' : 'end'}
                  fontSize={12}
                  fill="var(--chart-text)"
                  stroke="var(--chart-surface)"
                  strokeWidth={3}
                  paintOrder="stroke"
                >
                  {text}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {hasLegend && <ChartLegend items={slices.map((s) => ({ color: s.color, name: s.name }))} />}

      {hover && (
        <TooltipBox x={hover.px} y={hover.py} width={width}>
          <TooltipRow color={slices.find((s) => s.name === hover.name)?.color} name={hover.name} value={tooltipFormatter ? tooltipFormatter(hover.value, hover.name) : String(hover.value)} />
        </TooltipBox>
      )}
    </div>
  );
}
