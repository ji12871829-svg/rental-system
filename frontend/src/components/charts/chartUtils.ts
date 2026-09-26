// Chart-kit utilities: child pickers, scale math, and the Fritsch–Carlson
// monotone path builder. Moved verbatim from the former single-file charts.tsx.
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import type { ChartDatum, DataKey } from './types';

/** All JSX children of the given declarative chart type, with typed props. */
export function pick<P>(children: ReactNode, type: unknown): ReactElement<P>[] {
  return Children.toArray(children).filter(
    (c): c is ReactElement<P> => isValidElement(c) && c.type === type,
  );
}

export const getVal = (d: ChartDatum, key: DataKey | undefined) =>
  key === undefined ? undefined : typeof key === 'function' ? key(d) : d?.[key];

/** Nice round tick values covering [min, max] (Fritsch-style 1/2/5 steps). */
export function niceTicks(min: number, max: number, count = 5): number[] {
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
export function monotonePath(pts: { x: number; y: number }[]): string {
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

export const fmtTick = (v: number): string => (Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100));
