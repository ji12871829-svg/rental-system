/*
 * Minimal chart kit — API-compatible with the subset of recharts RPMS uses
 * (BarChart / LineChart / PieChart + CartesianGrid, XAxis, YAxis, Tooltip,
 * Legend, Bar, Line, Pie, Cell, ResponsiveContainer), rendered as plain SVG
 * with zero dependencies. Replaces recharts (~375 kB min / ~104 kB gzip in a
 * shared chunk) with ~15 kB of in-repo code.
 *
 * The declarative children (XAxis, Tooltip, Bar, ...) render nothing
 * themselves — each chart inspects its children and uses their props as
 * configuration, exactly like recharts does. Page code therefore swaps only
 * its import source.
 */
import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

// ---------------------------------------------------------------- types ----

export type ChartDatum = Record<string, any>;
export type DataKey = string | ((datum: ChartDatum) => any);
export type TickFormatter = (value: any, index: number) => string;
export type TooltipFormatter = (value: any, name?: string, datum?: ChartDatum) => ReactNode;

interface AxisConfig {
  dataKey?: DataKey;
  type?: 'number' | 'category';
  width?: number;
  tickFormatter?: TickFormatter;
}
interface SeriesConfig {
  dataKey: DataKey;
  name?: string;
  fill?: string;
  stroke?: string;
  label?: boolean | ((datum: ChartDatum) => ReactNode);
  outerRadius?: number;
  nameKey?: DataKey;
  type?: string;
}
interface CellConfig {
  fill?: string;
}

// --------------------------------------------------------------- config ----

export function CartesianGrid(_props: { strokeDasharray?: string }) {
  return null;
}

export function XAxis(_props: {
  dataKey?: DataKey;
  type?: 'number' | 'category';
  tickFormatter?: TickFormatter;
}) {
  return null;
}

export function YAxis(_props: {
  dataKey?: DataKey;
  type?: 'number' | 'category';
  width?: number;
  tickFormatter?: TickFormatter;
}) {
  return null;
}

export function Tooltip(_props: { formatter?: TooltipFormatter }) {
  return null;
}

export function Legend(_props: Record<string, never>) {
  return null;
}

export function Bar(_props: { dataKey: DataKey; fill?: string; name?: string; children?: ReactNode }) {
  return null;
}

export function Line(_props: { dataKey: DataKey; stroke?: string; name?: string; type?: string }) {
  return null;
}

export function Pie(_props: {
  data: ChartDatum[];
  dataKey: DataKey;
  nameKey?: DataKey;
  outerRadius?: number;
  label?: boolean | ((datum: ChartDatum) => ReactNode);
  children?: ReactNode;
}) {
  return null;
}

export function Cell(_props: { fill?: string }) {
  return null;
}

// ------------------------------------------------------------ utilities ----

const isAxis = (el: unknown): el is ReactElement<AxisConfig> =>
  isValidElement(el) && (el.type === XAxis || el.type === YAxis);

/** All JSX children of the given declarative chart type, with typed props. */
function pick<P>(children: ReactNode, type: unknown): ReactElement<P>[] {
  return Children.toArray(children).filter(
    (c): c is ReactElement<P> => isValidElement(c) && c.type === type,
  );
}

const getVal = (d: ChartDatum, key: DataKey | undefined) =>
  key === undefined ? undefined : typeof key === 'function' ? key(d) : d?.[key];

/** Nice round tick values covering [min, max] (Fritsch-style 1/2/5 steps). */
function niceTicks(min: number, max: number, count = 5): number[] {
  if (!isFinite(min) || !isFinite(max)) return [0, 1];
  if (min === max) {
    if (min === 0) return [0, 1];
    const bump = Math.abs(min) * 0.1 || 1;
    min -= bump;
    max += bump;
  }
  const rawStep = (max - min) / (count - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const step = (norm >= 7.5 ? 10 : norm >= 3.5 ? 5 : norm >= 1.5 ? 2 : 1) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let t = lo; t <= hi + step * 1e-6; t += step) {
    ticks.push(Math.round(t * 1e6) / 1e6);
  }
  return ticks;
}

/** Monotone cubic (Fritsch–Carlson) path — same shape recharts' "monotone" gives. */
function monotonePath(pts: { x: number; y: number }[]): string {
  const n = pts.length;
  if (n === 0) return '';
  if (n === 1) return `M${pts[0].x},${pts[0].y}`;
  const dx: number[] = [], dy: number[] = [], m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1].x - pts[i].x;
    dy[i] = pts[i + 1].y - pts[i].y;
    m[i] = dy[i] / (dx[i] || 1e-9);
  }
  const t: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) {
    t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  }
  t[n - 1] = m[n - 2];
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i];
    const s = a * a + b * b;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      t[i] = a * tau * m[i];
      t[i + 1] = b * tau * m[i];
    }
  }
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < n - 1; i++) {
    const x1 = pts[i].x + dx[i] / 3, y1 = pts[i].y + t[i] * dx[i] / 3;
    const x2 = pts[i + 1].x - dx[i] / 3, y2 = pts[i + 1].y - t[i + 1] * dx[i] / 3;
    d += `C${x1},${y1} ${x2},${y2} ${pts[i + 1].x},${pts[i + 1].y}`;
  }
  return d;
}

const fmtTick = (v: number): string => (Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100));

// ------------------------------------------------------ tooltip chrome -----

function TooltipBox(props: { x: number; y: number; width: number; children: ReactNode }) {
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

function TooltipRow({ color, name, value }: { color?: string; name?: string; value: ReactNode }) {
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

function ChartLegend({ items }: { items: { color: string; name: string }[] }) {
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

/**
 * Shared measured-width wrapper (recharts' ResponsiveContainer equivalent).
 *
 * Lazy by default: the chart inside is not rendered until the container
 * scrolls within 200px of the viewport. Charts are the heaviest thing RPMS
 * renders (the dashboard alone mounts nine SVGs), and everything below the
 * fold was being paid for on every page load. The height prop reserves the
 * box, so there is no layout shift — a quiet skeleton pulse fills the space
 * until the real chart takes over. Pass `lazy={false}` to force immediate
 * rendering (e.g. print/export contexts).
 */
export function ResponsiveContainer(props: {
  width?: string | number;
  height?: number | string;
  children: ReactElement;
  className?: string;
  style?: React.CSSProperties;
  lazy?: boolean;
}) {
  const { height = '100%', children, className, style, lazy = true } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  // Render immediately when lazy loading is off, unsupported, or the container
  // starts on-screen — otherwise wait for the intersection below.
  const [visible, setVisible] = useState(
    !lazy || typeof IntersectionObserver === 'undefined',
  );

  // Flip to visible once the (reserved-space) box approaches the viewport.
  // One-shot: after the first intersection the observer disconnects and the
  // chart renders for good — scrolling away never unmounts it.
  useEffect(() => {
    if (visible) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      // 200px head start so the chart is ready before the user reaches it.
      { rootMargin: '200px 0px' },
    );
    io.observe(el);

    // Safety valve: IntersectionObserver callbacks are delivered with frames.
    // In renderers that never produce frames (occluded/throttled webviews,
    // odd embedders) rAF stalls and IO never fires, which would leave the
    // skeleton up forever. If the first frame hasn't arrived shortly after
    // mount, render immediately; on healthy browsers rAF lands within one
    // frame and this fallback cancels itself — true scroll laziness holds.
    let sawFrame = false;
    requestAnimationFrame(() => {
      sawFrame = true;
    });
    const failSafe = setTimeout(() => {
      if (!sawFrame) setVisible(true);
    }, 1500);
    return () => {
      io.disconnect();
      clearTimeout(failSafe);
    };
  }, [visible]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const cw = entries[0]?.contentRect.width ?? 0;
      if (cw > 0) setW(cw);
    });
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className={className} style={{ width: '100%', height, ...style }}>
      {w > 0 && visible && isValidElement(children)
        ? cloneElement(children as ReactElement<any>, { containerWidth: w })
        : !visible
          ? <div className="h-full w-full animate-pulse rounded-lg bg-gray-100/70" aria-hidden />
          : null}
    </div>
  );
}

// ------------------------------------------------------------- BarChart ----

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
        <g stroke="#e5e7eb" strokeDasharray="3 3">
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
            <line x1={marginLeft} x2={marginLeft + plotW} y1={marginTop + plotH} y2={marginTop + plotH} stroke="#d1d5db" />
            <line x1={marginLeft} x2={marginLeft} y1={marginTop} y2={marginTop + plotH} stroke="#d1d5db" />
            {data.map((d, i) =>
              i % catSkip === 0 ? (
                <g key={i}>
                  <line x1={bandCenter(i)} x2={bandCenter(i)} y1={marginTop + plotH} y2={marginTop + plotH + 5} stroke="#d1d5db" />
                  <text x={bandCenter(i)} y={marginTop + plotH + 17} textAnchor="middle" fontSize={11} fill="#6b7280">
                    {catLabel(d)}
                  </text>
                </g>
              ) : null,
            )}
            {(yTicks ?? []).map((t) => (
              <text key={t} x={marginLeft - 6} y={val2px(t) + 3.5} textAnchor="end" fontSize={11} fill="#6b7280">
                {fmtTick(t)}
              </text>
            ))}
          </g>
        ) : (
          <g>
            <line x1={marginLeft} x2={marginLeft} y1={marginTop} y2={marginTop + plotH} stroke="#d1d5db" />
            <line x1={marginLeft} x2={marginLeft + plotW} y1={marginTop + plotH} y2={marginTop + plotH} stroke="#d1d5db" />
            {data.map((d, i) => (
              <text key={i} x={marginLeft - 8} y={bandCenter(i) + 3.5} textAnchor="end" fontSize={11} fill="#6b7280">
                {catFmt ? catFmt(getVal(d, catKey), i) : String(getVal(d, catKey) ?? '')}
              </text>
            ))}
            {(xTicks ?? []).map((t) => (
              <text key={t} x={val2px(t)} y={marginTop + plotH + 17} textAnchor="middle" fontSize={11} fill="#6b7280">
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

// ------------------------------------------------------------ LineChart ----

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

  const xAxes = Children.toArray(children).filter(isAxis).filter((c) => c.props.type !== 'number');
  const yAxes = Children.toArray(children).filter(isAxis).filter((c) => c.props.type === 'number' || c.type === YAxis);
  const tooltips = pick<{ formatter?: TooltipFormatter }>(children, Tooltip);
  const hasLegend = pick(children, Legend).length > 0;
  const lines = pick<{ dataKey: DataKey; stroke?: string; name?: string; type?: string }>(children, Line);

  const series = lines.map((l) => ({
    key: l.props.dataKey,
    name: l.props.name ?? (typeof l.props.dataKey === 'string' ? l.props.dataKey : 'value'),
    color: l.props.stroke ?? '#1d6fd6',
    monotone: (l.props.type ?? 'linear') === 'monotone',
  }));

  const catAxis = xAxes[0];
  const marginLeft = yAxes[0]?.props.width ?? 60;
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
        <g stroke="#e5e7eb" strokeDasharray="3 3">
          {ticks.map((t) => (
            <line key={t} x1={marginLeft} x2={marginLeft + plotW} y1={py(t)} y2={py(t)} />
          ))}
        </g>

        <line x1={marginLeft} x2={marginLeft + plotW} y1={marginTop + plotH} y2={marginTop + plotH} stroke="#d1d5db" />
        <line x1={marginLeft} x2={marginLeft} y1={marginTop} y2={marginTop + plotH} stroke="#d1d5db" />

        {series.map((s, si) => {
          const pts = data.map((d, i) => ({ x: px(i), y: py(Number(getVal(d, s.key)) || 0) }));
          return (
            <g key={si}>
              <path d={s.monotone ? monotonePath(pts) : `M${pts.map((p) => `${p.x},${p.y}`).join('L')}`} fill="none" stroke={s.color} strokeWidth={2} />
              {pts.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={hover?.i === i ? 4.5 : 3} fill="#fff" stroke={s.color} strokeWidth={2} />
              ))}
            </g>
          );
        })}

        {data.map((d, i) =>
          i % catSkip === 0 ? (
            <text key={i} x={px(i)} y={marginTop + plotH + 17} textAnchor="middle" fontSize={11} fill="#6b7280">
              {catLabel(d)}
            </text>
          ) : null,
        )}
        {ticks.map((t) => (
          <text key={t} x={marginLeft - 6} y={py(t) + 3.5} textAnchor="end" fontSize={11} fill="#6b7280">
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

// ------------------------------------------------------------- PieChart ----

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

  const pies = pick<{ data: ChartDatum[]; dataKey: DataKey; nameKey?: DataKey; outerRadius?: number; label?: SeriesConfig['label']; children?: ReactNode }>(children, Pie);
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
  const cx = width / 2;
  const cy = (height - (hasLegend ? 24 : 0)) / 2;
  const arc = (r: number, a: number) => ({ x: cx + r * Math.sin(a), y: cy - r * Math.cos(a) });
  const sectorPath = (s: { start: number; end: number }) => {
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
                stroke="#fff"
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
                  fill="#374151"
                  stroke="#fff"
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
