"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function TokenUsageChart({ data }: { data: { date: string; tokens: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#2f3136" />
        <XAxis dataKey="date" tick={{ fill: "#898989", fontSize: 12 }} />
        <YAxis tick={{ fill: "#898989", fontSize: 12 }} />
        <Tooltip
          contentStyle={{ background: "#1d1e22", border: "1px solid #2f3136", fontSize: 12 }}
          labelStyle={{ color: "#ebebeb" }}
        />
        <Bar dataKey="tokens" fill="#6256a9" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
