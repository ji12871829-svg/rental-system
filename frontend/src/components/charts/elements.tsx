// The declarative config elements (XAxis, Bar, ...) — recharts-compatible
// shims that render nothing themselves; each chart inspects its children and
// uses these props as configuration, exactly like recharts does. Page code
// swaps only its import source. Moved verbatim from the former single-file
// charts.tsx.
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import type { AxisConfig, ChartDatum, DataKey, TickFormatter, TooltipFormatter } from './types';

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
  innerRadius?: number;
  outerRadius?: number;
  label?: boolean | ((datum: ChartDatum) => ReactNode);
  children?: ReactNode;
}) {
  return null;
}

export function Cell(_props: { fill?: string }) {
  return null;
}

export const isAxis = (el: unknown): el is ReactElement<AxisConfig> =>
  isValidElement(el) && (el.type === XAxis || el.type === YAxis);
