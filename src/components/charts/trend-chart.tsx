"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

// Validated categorical pair (light surface): passes lightness, chroma, CVD and contrast checks.
const SERIES = [
  { key: "submitted", label: "Requests submitted", color: "#2f62b8" },
  { key: "completed", label: "Projects completed", color: "#128052" },
];

export function TrendChart({ data }: { data: { month: string; submitted: number; completed: number }[] }) {
  const fmt = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
  return (
    <figure>
      <div className="h-64 w-full" role="img" aria-label="Monthly requests submitted and projects completed">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }} barGap={2}>
            <CartesianGrid stroke="#e7ebf2" vertical={false} />
            <XAxis dataKey="month" tickFormatter={fmt} tick={{ fontSize: 11, fill: "#55657f" }} axisLine={{ stroke: "#dde3ee" }} tickLine={false} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#55657f" }} axisLine={false} tickLine={false} />
            <Tooltip labelFormatter={(m) => fmt(String(m))} cursor={{ fill: "rgba(29,75,148,0.06)" }} contentStyle={{ borderRadius: 6, borderColor: "#dde3ee", fontSize: 12 }} />
            <Legend iconType="circle" wrapperStyle={{ fontSize: 12, color: "#0f1d3a" }} />
            {SERIES.map((s) => (
              <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={18} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-muted">View as table</summary>
        <table className="mt-2 w-full text-left">
          <thead><tr><th className="py-1">Month</th>{SERIES.map((s) => <th key={s.key} className="py-1">{s.label}</th>)}</tr></thead>
          <tbody>{data.map((d) => <tr key={d.month} className="border-t border-line"><td className="py-1">{fmt(d.month)}</td><td>{d.submitted}</td><td>{d.completed}</td></tr>)}</tbody>
        </table>
      </details>
    </figure>
  );
}
