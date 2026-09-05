"use client";

// The ONLY file that imports recharts. Every chart in the dashboard (stats,
// admin observability) goes through these three wrappers so the axes, grid,
// tooltip and palette stay identical everywhere.

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export const CHART_COLORS = {
  grid: "#2f3136",
  tooltipBg: "#1d1e22",
  tick: "#898989",
  label: "#ebebeb",
  primary: "#6256a9",
  accent: "#04aec6",
  series: ["#6256a9", "#04aec6", "#f09238", "#89e07d", "#ff2d78", "#c9c9c9"],
} as const;

export interface ChartSeries {
  key: string;
  name: string;
  color?: string | undefined;
}

export type ChartDatum = Record<string, string | number | null | undefined>;

const TICK_STYLE = { fill: CHART_COLORS.tick, fontSize: 12 };
const TOOLTIP_CONTENT_STYLE = {
  background: CHART_COLORS.tooltipBg,
  border: `1px solid ${CHART_COLORS.grid}`,
  borderRadius: 8,
  fontSize: 12,
};
const TOOLTIP_LABEL_STYLE = { color: CHART_COLORS.label };
const LEGEND_STYLE = { fontSize: 12, color: CHART_COLORS.tick };
const CURSOR_STYLE = { fill: "rgba(255,255,255,0.04)" };
const MAX_BAR_SIZE = 40;

function seriesColor(series: ChartSeries, index: number): string {
  return series.color ?? CHART_COLORS.series[index % CHART_COLORS.series.length] ?? CHART_COLORS.primary;
}

export function StackedBarChart({
  data,
  series,
  height = 240,
}: {
  data: ChartDatum[];
  series: ChartSeries[];
  height?: number | undefined;
}) {
  const lastIndex = series.length - 1;
  return (
    <ResponsiveContainer width="100%" height={height} initialDimension={{ width: 640, height }}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
        <XAxis dataKey="label" tick={TICK_STYLE} axisLine={{ stroke: CHART_COLORS.grid }} tickLine={false} />
        <YAxis allowDecimals={false} tick={TICK_STYLE} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} cursor={CURSOR_STYLE} />
        {series.length > 1 && <Legend wrapperStyle={LEGEND_STYLE} iconType="circle" iconSize={8} />}
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.name}
            stackId="stack"
            fill={seriesColor(s, i)}
            maxBarSize={MAX_BAR_SIZE}
            radius={i === lastIndex ? [4, 4, 0, 0] : [0, 0, 0, 0]}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function LineSeriesChart({
  data,
  series,
  height = 240,
}: {
  data: ChartDatum[];
  series: ChartSeries[];
  height?: number | undefined;
}) {
  return (
    <ResponsiveContainer width="100%" height={height} initialDimension={{ width: 640, height }}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
        <XAxis dataKey="label" tick={TICK_STYLE} axisLine={{ stroke: CHART_COLORS.grid }} tickLine={false} />
        <YAxis allowDecimals={false} tick={TICK_STYLE} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} />
        {series.length > 1 && <Legend wrapperStyle={LEGEND_STYLE} iconType="circle" iconSize={8} />}
        {series.map((s, i) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.name}
            stroke={seriesColor(s, i)}
            strokeWidth={2}
            dot={{ r: 3, strokeWidth: 0, fill: seriesColor(s, i) }}
            activeDot={{ r: 5 }}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export interface HorizontalBarDatum {
  label: string;
  value: number;
  color?: string | undefined;
}

export function HorizontalBarChart({
  data,
  height,
  valueName = "Cantidad",
}: {
  data: HorizontalBarDatum[];
  height?: number | undefined;
  valueName?: string | undefined;
}) {
  // Rows scale with the number of categories so 3 bars don't float in 240px.
  const resolvedHeight = height ?? Math.max(120, data.length * 36 + 24);
  const longestLabel = data.reduce((max, d) => Math.max(max, d.label.length), 0);
  const yAxisWidth = Math.min(160, Math.max(72, longestLabel * 7));
  return (
    <ResponsiveContainer width="100%" height={resolvedHeight} initialDimension={{ width: 640, height: resolvedHeight }}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid horizontal={false} vertical={false} stroke={CHART_COLORS.grid} />
        <XAxis type="number" allowDecimals={false} tick={TICK_STYLE} axisLine={false} tickLine={false} />
        <YAxis
          type="category"
          dataKey="label"
          width={yAxisWidth}
          tick={TICK_STYLE}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
        />
        <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} cursor={CURSOR_STYLE} />
        <Bar dataKey="value" name={valueName} maxBarSize={MAX_BAR_SIZE} radius={[0, 4, 4, 0]} isAnimationActive={false}>
          {data.map((d, i) => (
            <Cell
              key={d.label}
              fill={d.color ?? CHART_COLORS.series[i % CHART_COLORS.series.length] ?? CHART_COLORS.primary}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
