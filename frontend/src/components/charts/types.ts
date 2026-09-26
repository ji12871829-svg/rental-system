// Shared types for the minimal chart kit (see ../charts.tsx for the overview).
// Moved verbatim from the former single-file charts.tsx.
import type { ReactNode } from 'react';

export type ChartDatum = Record<string, any>;
export type DataKey = string | ((datum: ChartDatum) => any);
export type TickFormatter = (value: any, index: number) => string;
export type TooltipFormatter = (value: any, name?: string, datum?: ChartDatum) => ReactNode;

export interface AxisConfig {
  dataKey?: DataKey;
  type?: 'number' | 'category';
  width?: number;
  tickFormatter?: TickFormatter;
}

export interface SeriesConfig {
  dataKey: DataKey;
  name?: string;
  fill?: string;
  stroke?: string;
  label?: boolean | ((datum: ChartDatum) => ReactNode);
  outerRadius?: number;
  nameKey?: DataKey;
  type?: string;
}

export interface CellConfig {
  fill?: string;
}
