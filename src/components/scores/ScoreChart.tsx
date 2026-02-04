'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

const SUBJECT_COLORS: Record<string, string> = {
  english: '#ef4444',
  math: '#3b82f6',
  japanese: '#22c55e',
  science: '#a855f7',
  social: '#f97316',
};

const SUBJECT_LABELS: Record<string, string> = {
  english: '英語',
  math: '数学',
  japanese: '国語',
  science: '理科',
  social: '社会',
};

export interface ChartDataPoint {
  label: string;
  english: number | null;
  math: number | null;
  japanese: number | null;
  science: number | null;
  social: number | null;
}

interface ScoreChartProps {
  data: ChartDataPoint[];
  category: 'regular_test' | 'report_card' | 'mock';
}

/** 偏差値グラフ用：データからY軸のdomainを算出（25～75を基準にデータに合わせて変動） */
function getMockYDomain(data: ChartDataPoint[]): [number, number] {
  const values: number[] = [];
  data.forEach((d) => {
    [d.english, d.math, d.japanese, d.science, d.social].forEach((v) => {
      if (v != null && !Number.isNaN(v)) values.push(v);
    });
  });
  if (values.length === 0) return [25, 75];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const padding = Math.max(5, (max - min) * 0.1 || 5);
  const domainMin = Math.max(20, Math.floor(min - padding));
  const domainMax = Math.min(80, Math.ceil(max + padding));
  return [domainMin, domainMax];
}

export function ScoreChart({ data, category }: ScoreChartProps) {
  const yDomain: [number, number] =
    category === 'report_card'
      ? [1, 5]
      : category === 'mock'
        ? getMockYDomain(data)
        : [0, 100];

  return (
    <div className="w-full h-[320px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 8, right: 16, left: 0, bottom: 8 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: '#4b5563' }}
            tickLine={false}
            interval={0}
            angle={-25}
            textAnchor="end"
            height={60}
          />
          <YAxis
            domain={yDomain}
            tick={{ fontSize: 11, fill: '#4b5563' }}
            tickLine={false}
            axisLine={false}
            width={32}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#fff',
              border: '1px solid #e5e7eb',
              borderRadius: '8px',
              fontSize: '12px',
            }}
            labelStyle={{ color: '#1f2937', fontWeight: 600 }}
          />
          <Legend
            wrapperStyle={{ fontSize: '12px' }}
            iconType="circle"
            iconSize={8}
            formatter={(value) => SUBJECT_LABELS[value] || value}
          />
          <Line
            type="monotone"
            dataKey="english"
            name="english"
            stroke={SUBJECT_COLORS.english}
            strokeWidth={2}
            dot={{ r: 3 }}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="math"
            name="math"
            stroke={SUBJECT_COLORS.math}
            strokeWidth={2}
            dot={{ r: 3 }}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="japanese"
            name="japanese"
            stroke={SUBJECT_COLORS.japanese}
            strokeWidth={2}
            dot={{ r: 3 }}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="science"
            name="science"
            stroke={SUBJECT_COLORS.science}
            strokeWidth={2}
            dot={{ r: 3 }}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="social"
            name="social"
            stroke={SUBJECT_COLORS.social}
            strokeWidth={2}
            dot={{ r: 3 }}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
