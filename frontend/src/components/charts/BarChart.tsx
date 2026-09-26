// Horizontal/vertical bar chart renderer. Moved verbatim from the former
// single-file charts.tsx (imports adjusted to the charts/ modules).
import {
  Children,
  isValidElement,
  useState,
  useMemo,
  type ReactElement,
  type ReactNode,
} from 'react';
import type { AxisConfig, CellConfig, ChartDatum, DataKey, TooltipFormatter } from './types';
import { XAxis, YAxis, Tooltip, Legend, Bar, Cell } from './elements';
import { pick, getVal, niceTicks, fmtTick } from './chartUtils';
import { TooltipBox, TooltipRow, ChartLegend } from './chartChrome';

export function BarChart(props: {
  data: ChartDatum[];
  layout?: 'horizontal' | 'vertical';
  width?: number;
  height?: number;
  containerWidth?: number;
  children?: ReactNode;
  className?: string;
  // Optional click handler — fires with the band's datum + index when a bar
  // (or anywhere in its band) is clicked. Used for chart → page deep links.
  onBarClick?: (datum: ChartDatum, index: number) => void;
}) {
  const { data, layout = 'horizontal', children, containerWidth, height: _h, width: _w, className, onBarClick } = props;
  const height = 260;
  const width = containerWidth ?? 600;

  const [hover, setHover] = useState<{ i: number; px: number; py: number } | null>(null);

  const xAxes = Children.toArray(children).filter((c): c is ReactElement<AxisConfig> => isValidElement(c) && c.type === XAxis);
  const yAxes = Children.toArray(children).filter((c): c is ReactElement<AxisConfig> => isValidElement(c) && c.type === YAxis);
  const tooltips = pick<{ formatter?: TooltipFormatter }>(children, Tooltip);
  const hasLegend = pick(children, Legend).length > 0;
  const bars = pick<{ dataKey: DataKey; fill?: string; name?: string; children?: ReactNode }>(children, Bar);

  const series = bars.map((b) => ({
    el: b,
    key: b.props.dataKey,
    name: b.props.name ?? (typeof b.props.dataKey === 'string' ? b.props.dataKey : 'value'),
    fill: b.props.fill ?? '#1d6fd6',
    cells: (Children.toArray(b.props.children).filter(
      (c): c is ReactElement<CellConfig> => isValidElement(c) && c.type === Cell,
    )).map((c) => c.props.fill),
  }));

  const numAxis = (layout === 'vertical' ? xAxes : yAxes)[0];
  const catAxis = (layout === 'vertical' ? yAxes : xAxes)[0];

  const marginLeft = layout === 'vertical' ? (catAxis?.props.width ?? 60) : (yAxes[0]?.props.width ?? 60);
  const marginRight = 14;
  const marginTop = 10;
  const marginBottom = 30; // x tick labels; legend lives below the svg
  const plotW = Math.max(10, width - marginLeft - marginRight);
  const plotH = Math.max(10, height - marginTop - marginBottom - (hasLegend ? 24 : 0));

  const tooltipFormatter = tooltips[0]?.props.formatter;

  const xTicks = useMemo(() => {
    if (layout !== 'vertical') return null;
    // The number axis reads the Bar series' dataKeys when it has none of its own
    // (recharts semantics — <XAxis type="number" /> is typically declared bare).
    const keys = numAxis?.props.dataKey ? [numAxis.props.dataKey] : series.map((s) => s.key);
    const vals = data.flatMap((d) => keys.map((k) => Number(getVal(d, k)) || 0));
    if (vals.length === 0) return niceTicks(0, 1);
    return niceTicks(Math.min(0, ...vals), Math.max(0, ...vals));
  }, [data, layout, numAxis, series]);

  const yTicks = useMemo(() => {
    if (layout !== 'horizontal') return null;
    const keys = series.map((s) => s.key);
    const vals = data.flatMap((d) => keys.map((k) => Number(getVal(d, k)) || 0));
    if (vals.length === 0) return niceTicks(0, 1);
    return niceTicks(Math.min(0, ...vals), Math.max(0, ...vals));
  }, [data, series, layout]);

  const n = data.length;
  const band = n > 0 ? (layout === 'horizontal' ? plotW : plotH) / n : 0;
  const numMax = layout === 'vertical'
    ? Math.max(...(xTicks ?? [1]))
    : Math.max(...(yTicks ?? [1]));
  const numMin = layout === 'vertical'
    ? Math.min(...(xTicks ?? [0]))
    : Math.min(...(yTicks ?? [0]));
  const val2px = (v: number) =>
    layout === 'horizontal'
      ? marginTop + plotH - ((v - numMin) / (numMax - numMin || 1)) * plotH
      : marginLeft + ((v - numMin) / (numMax - numMin || 1)) * plotW;

  const bandCenter = (i: number) =>
    layout === 'horizontal'
      ? marginLeft + i * band + band / 2
      : marginTop + i * band + band / 2;

  const groupW = Math.max(4, band * 0.62);
  const barW = Math.max(2, groupW / Math.max(1, series.length));

  const catKey = catAxis?.props.dataKey;
  const catFmt = catAxis?.props.tickFormatter;
  const catLabel = (d: ChartDatum) => {
    const raw = getVal(d, catKey);
    return catFmt ? catFmt(raw, 0) : String(raw ?? '');
  };

  const hoverIndex = hover?.i ?? -1;
  const hoveredDatum = hoverIndex >= 0 ? data[hoverIndex] : null;

  const onPointerMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    const i =
      layout === 'horizontal'
        ? Math.floor((e.clientX - rect.left - marginLeft) / (band || 1))
        : Math.floor((e.clientY - rect.top - marginTop) / (band || 1));
    const clamped = Math.max(0, Math.min(n - 1, i));
    if (clamped === hover?.i && hover) {
      setHover({ ...hover, px: e.clientX - rect.left, py: e.clientY - rect.top });
    } else {
      setHover({ i: clamped, px: e.clientX - rect.left, py: e.clientY - rect.top });
    }
  };

  const seriesOf = (d: ChartDatum) =>
    series.map((s) => ({
      name: s.name,
      color: s.fill,
      value: getVal(d, s.key),
    }));

  // Tick thinning for crowded category axes (12 monthly labels in ~450px).
  const approxLabelPx = 7;
  const catSkip = layout === 'horizontal'
    ? Math.max(1, Math.ceil((Math.max(...data.map((d) => catLabel(d).length), 1) * approxLabelPx + 8) / Math.max(band, 1)))
    : 1;

  return (
    <div className={className} style={{ position: 'relative', width, height: height + (hasLegend ? 24 : 0) }}>
      <svg width={width} height={height} role="img" style={{ display: 'block' }}>
        {/* grid */}
        <g stroke="var(--chart-grid)" strokeDasharray="3 3">
          {layout === 'horizontal'
            ? (yTicks ?? []).map((t) => (
                <line key={t} x1={marginLeft} x2={marginLeft + plotW} y1={val2px(t)} y2={val2px(t)} />
              ))
            : (xTicks ?? []).map((t) => (
                <line key={t} y1={marginTop} y2={marginTop + plotH} x1={val2px(t)} x2={val2px(t)} />
              ))}
          {layout === 'horizontal'
            ? data.map((_, i) =>
                i === 0 ? null : (
                  <line key={`v${i}`} y1={marginTop} y2={marginTop + plotH} x1={marginLeft + i * band} x2={marginLeft + i * band} />
                ),
              )
            : data.map((_, i) =>
                i === 0 ? null : (
                  <line key={`h${i}`} x1={marginLeft} x2={marginLeft + plotW} y1={marginTop + i * band} y2={marginTop + i * band} />
                ),
              )}
        </g>

        {/* bars */}
        {data.map((d, i) =>
          series.map((s, si) => {
            const v = Number(getVal(d, s.key)) || 0;
            const fill = s.cells?.[i] ?? s.fill;
            const y0 = val2px(0);
            if (layout === 'horizontal') {
              const x = marginLeft + i * band + (band - groupW) / 2 + si * barW;
              const yv = val2px(v);
              const top = Math.min(yv, y0);
              const h = Math.max(v === 0 ? 0 : 2, Math.abs(y0 - yv));
              return (
                <rect
                  key={`${i}-${si}`}
                  x={x}
                  y={top}
                  width={barW - 2 > 0 ? barW - 2 : barW}
                  height={h}
                  fill={fill}
                  opacity={hoverIndex >= 0 && hoverIndex !== i ? 0.55 : 1}
                  style={onBarClick ? { cursor: 'pointer' } : undefined}
                  onClick={onBarClick ? () => onBarClick(d, i) : undefined}
                />
              );
            }
            const y = marginTop + i * band + (band - groupW) / 2 + si * barW;
            const xv = val2px(v);
            const left = Math.min(xv, val2px(0));
            const w = Math.max(v === 0 ? 0 : 2, Math.abs(xv - val2px(0)));
            return (
              <rect
                key={`${i}-${si}`}
                x={left}
                y={y}
                width={w}
                height={barW - 2 > 0 ? barW - 2 : barW}
                fill={fill}
                opacity={hoverIndex >= 0 && hoverIndex !== i ? 0.55 : 1}
                style={onBarClick ? { cursor: 'pointer' } : undefined}
                onClick={onBarClick ? () => onBarClick(d, i) : undefined}
              />
            );
          }),
        )}

        {/* axis lines + ticks */}
        {layout === 'horizontal' ? (
          <g>
            <line x1={marginLeft} x2={marginLeft + plotW} y1={marginTop + plotH} y2={marginTop + plotH} stroke="var(--chart-axis)" />
            <line x1={marginLeft} x2={marginLeft} y1={marginTop} y2={marginTop + plotH} stroke="var(--chart-axis)" />
            {data.map((d, i) =>
              i % catSkip === 0 ? (
                <g key={i}>
                  <line x1={bandCenter(i)} x2={bandCenter(i)} y1={marginTop + plotH} y2={marginTop + plotH + 5} stroke="var(--chart-axis)" />
                  <text x={bandCenter(i)} y={marginTop + plotH + 17} textAnchor="middle" fontSize={11} fill="var(--chart-tick)">
                    {catLabel(d)}
                  </text>
                </g>
              ) : null,
            )}
            {(yTicks ?? []).map((t) => (
              <text key={t} x={marginLeft - 6} y={val2px(t) + 3.5} textAnchor="end" fontSize={11} fill="var(--chart-tick)">
                {fmtTick(t)}
              </text>
            ))}
          </g>
        ) : (
          <g>
            <line x1={marginLeft} x2={marginLeft} y1={marginTop} y2={marginTop + plotH} stroke="var(--chart-axis)" />
            <line x1={marginLeft} x2={marginLeft + plotW} y1={marginTop + plotH} y2={marginTop + plotH} stroke="var(--chart-axis)" />
            {data.map((d, i) => (
              <text key={i} x={marginLeft - 8} y={bandCenter(i) + 3.5} textAnchor="end" fontSize={11} fill="var(--chart-tick)">
                {catFmt ? catFmt(getVal(d, catKey), i) : String(getVal(d, catKey) ?? '')}
              </text>
            ))}
            {(xTicks ?? []).map((t) => (
              <text key={t} x={val2px(t)} y={marginTop + plotH + 17} textAnchor="middle" fontSize={11} fill="var(--chart-tick)">
                {fmtTick(t)}
              </text>
            ))}
          </g>
        )}

        {/* hover capture — also the click target for band-wide bar clicks,
            so thin bars still give a generous hit area. */}
        <rect
          x={marginLeft}
          y={marginTop}
          width={plotW}
          height={plotH}
          fill="transparent"
          onPointerMove={onPointerMove}
          onPointerLeave={() => setHover(null)}
          style={onBarClick ? { cursor: 'pointer' } : undefined}
          onClick={
            onBarClick
              ? (e) => {
                  const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                  const i =
                    layout === 'horizontal'
                      ? Math.floor((e.clientX - rect.left - marginLeft) / (band || 1))
                      : Math.floor((e.clientY - rect.top - marginTop) / (band || 1));
                  const clamped = Math.max(0, Math.min(n - 1, i));
                  onBarClick(data[clamped], clamped);
                }
              : undefined
          }
        />
      </svg>

      {hasLegend && <ChartLegend items={series.map((s) => ({ color: s.fill, name: s.name }))} />}

      {hoveredDatum && (
        <TooltipBox x={hover!.px} y={hover!.py} width={width}>
          <div className="mb-0.5 font-medium text-gray-500">{catLabel(hoveredDatum)}</div>
          {seriesOf(hoveredDatum).map((s, i) => (
            <TooltipRow key={i} color={s.color} name={s.name} value={tooltipFormatter ? tooltipFormatter(s.value, s.name, hoveredDatum) : String(s.value)} />
          ))}
        </TooltipBox>
      )}
    </div>
  );
}
