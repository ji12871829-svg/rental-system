// Line chart renderer. Moved verbatim from the former single-file charts.tsx
// (imports adjusted to the charts/ modules).
import {
  Children,
  useState,
  useMemo,
  type ReactNode,
} from 'react';
import type { ChartDatum, DataKey, TooltipFormatter } from './types';
import { isAxis, YAxis, Tooltip, Legend, Line } from './elements';
import { pick, getVal, niceTicks, monotonePath, fmtTick } from './chartUtils';
import { TooltipBox, TooltipRow, ChartLegend } from './chartChrome';

export function LineChart(props: {
  data: ChartDatum[];
  width?: number;
  height?: number;
  containerWidth?: number;
  children?: ReactNode;
  className?: string;
}) {
  const { data, children, containerWidth, height: _h, width: _w, className } = props;
  const height = 260;
  const width = containerWidth ?? 600;
  const [hover, setHover] = useState<{ i: number; px: number; py: number } | null>(null);

  const catAxis = Children.toArray(children).filter(isAxis).find((c) => c.props.type !== 'number');
  const yAxis = Children.toArray(children).filter(isAxis).find((c) => c.props.type === 'number' || c.type === YAxis);
  const tooltips = pick<{ formatter?: TooltipFormatter }>(children, Tooltip);
  const hasLegend = pick(children, Legend).length > 0;
  const lines = pick<{ dataKey: DataKey; stroke?: string; name?: string; type?: string }>(children, Line);

  const series = lines.map((l) => ({
    key: l.props.dataKey,
    name: l.props.name ?? (typeof l.props.dataKey === 'string' ? l.props.dataKey : 'value'),
    color: l.props.stroke ?? '#11a8ff',
    monotone: (l.props.type ?? 'linear') === 'monotone',
  }));

  const marginLeft = yAxis?.props.width ?? 60;
  const marginRight = 14;
  const marginTop = 10;
  const marginBottom = 30;
  const plotW = Math.max(10, width - marginLeft - marginRight);
  const plotH = Math.max(10, height - marginTop - marginBottom - (hasLegend ? 24 : 0));

  const tooltipFormatter = tooltips[0]?.props.formatter;
  const catKey = catAxis?.props.dataKey;
  const catLabel = (d: ChartDatum) => String(getVal(d, catKey) ?? '');

  const ticks = useMemo(() => {
    const keys = series.map((s) => s.key);
    const vals = data.flatMap((d) => keys.map((k) => Number(getVal(d, k)) || 0));
    if (vals.length === 0) return niceTicks(0, 1);
    return niceTicks(Math.min(0, ...vals), Math.max(0, ...vals));
  }, [data, series]);

  const numMin = Math.min(...ticks);
  const numMax = Math.max(...ticks);
  const n = data.length;
  const step = n > 1 ? plotW / (n - 1) : 0;
  const px = (i: number) => marginLeft + i * step;
  const py = (v: number) => marginTop + plotH - ((v - numMin) / (numMax - numMin || 1)) * plotH;

  const catSkip = Math.max(1, Math.ceil((Math.max(...data.map((d) => catLabel(d).length), 1) * 7 + 8) / Math.max(step, 1)));

  const hoveredDatum = hover && data[hover.i] ? data[hover.i] : null;

  return (
    <div className={className} style={{ position: 'relative', width, height: height + (hasLegend ? 24 : 0) }}>
      <svg width={width} height={height} role="img" style={{ display: 'block' }}>
        <g stroke="var(--chart-grid)" strokeDasharray="3 3">
          {ticks.map((t) => (
            <line key={t} x1={marginLeft} x2={marginLeft + plotW} y1={py(t)} y2={py(t)} />
          ))}
        </g>

        <line x1={marginLeft} x2={marginLeft + plotW} y1={marginTop + plotH} y2={marginTop + plotH} stroke="var(--chart-axis)" />
        <line x1={marginLeft} x2={marginLeft} y1={marginTop} y2={marginTop + plotH} stroke="var(--chart-axis)" />

        {series.map((s, si) => {
          const pts = data.map((d, i) => ({ x: px(i), y: py(Number(getVal(d, s.key)) || 0) }));
          return (
            <g key={si}>
              <path d={s.monotone ? monotonePath(pts) : `M${pts.map((p) => `${p.x},${p.y}`).join('L')}`} fill="none" stroke={s.color} strokeWidth={2} />
              {pts.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={hover?.i === i ? 4.5 : 3} fill="var(--chart-surface)" stroke={s.color} strokeWidth={2} />
              ))}
            </g>
          );
        })}

        {data.map((d, i) =>
          i % catSkip === 0 ? (
            <text key={i} x={px(i)} y={marginTop + plotH + 17} textAnchor="middle" fontSize={11} fill="var(--chart-tick)">
              {catLabel(d)}
            </text>
          ) : null,
        )}
        {ticks.map((t) => (
          <text key={t} x={marginLeft - 6} y={py(t) + 3.5} textAnchor="end" fontSize={11} fill="var(--chart-tick)">
            {fmtTick(t)}
          </text>
        ))}

        <rect
          x={marginLeft}
          y={marginTop}
          width={plotW}
          height={plotH}
          fill="transparent"
          onPointerMove={(e) => {
            const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
            const i = Math.round((e.clientX - rect.left - marginLeft) / (step || 1));
            setHover({ i: Math.max(0, Math.min(n - 1, i)), px: e.clientX - rect.left, py: e.clientY - rect.top });
          }}
          onPointerLeave={() => setHover(null)}
        />
      </svg>

      {hasLegend && <ChartLegend items={series.map((s) => ({ color: s.color, name: s.name }))} />}

      {hoveredDatum && (
        <TooltipBox x={hover!.px} y={hover!.py} width={width}>
          <div className="mb-0.5 font-medium text-gray-500">{catLabel(hoveredDatum)}</div>
          {series.map((s, i) => {
            const v = getVal(hoveredDatum, s.key);
            return <TooltipRow key={i} color={s.color} name={s.name} value={tooltipFormatter ? tooltipFormatter(v, s.name, hoveredDatum) : String(v)} />;
          })}
        </TooltipBox>
      )}
    </div>
  );
}
