"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function TokenUsageChart({ data }: { data: { date: string; tokens: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
        <XAxis dataKey="date" tick={{ fill: "#a3a3a3", fontSize: 12 }} />
        <YAxis tick={{ fill: "#a3a3a3", fontSize: 12 }} />
        <Tooltip
          contentStyle={{ background: "#171717", border: "1px solid #404040", fontSize: 12 }}
          labelStyle={{ color: "#e5e5e5" }}
        />
        <Bar dataKey="tokens" fill="#6366f1" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
