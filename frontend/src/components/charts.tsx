// Minimal chart kit — API-compatible with the subset of recharts RPMS uses
// (BarChart / LineChart / PieChart + CartesianGrid, XAxis, YAxis, Tooltip,
// Legend, Bar, Line, Pie, Cell, ResponsiveContainer), rendered as plain SVG
// with zero dependencies. Replaces recharts (~375 kB min / ~104 kB gzip in a
// shared chunk) with ~15 kB of in-repo code.
//
// The declarative children (XAxis, Tooltip, Bar, ...) render nothing
// themselves — each chart inspects its children and uses their props as
// configuration, exactly like recharts does. Page code therefore swaps only
// its import source.
//
// Layout: one module per renderer under charts/, with the shims, scale
// helpers, chrome, and the measured-width container as siblings.
export { CartesianGrid, XAxis, YAxis, Tooltip, Legend, Bar, Line, Pie, Cell } from './charts/elements';
export { ResponsiveContainer } from './charts/ResponsiveContainer';
export { BarChart } from './charts/BarChart';
export { LineChart } from './charts/LineChart';
export { PieChart } from './charts/PieChart';
export type { ChartDatum } from './charts/types';
