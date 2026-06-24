'use client';

import { useEffect, useRef, useState } from 'react';

// ─────────────────────────────────────────────
// ダブルハンドルのレンジスライダー
// ─────────────────────────────────────────────
export function RangeSlider({
  min,
  max,
  start,
  end,
  onChange,
}: {
  min: number;
  max: number;
  start: number;
  end: number;
  onChange: (s: number, e: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<'start' | 'end' | null>(null);

  // onChange を ref で保持し、useEffect の依存配列から外す
  // （インライン関数が毎レンダーで再生成されてもドラッグが途切れない）
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const startRef = useRef(start);
  startRef.current = start;
  const endRef = useRef(end);
  endRef.current = end;

  const pct = (v: number) => ((v - min) / Math.max(1, max - min)) * 100;

  useEffect(() => {
    if (!dragging) return;
    const onPointerMove = (ev: PointerEvent) => {
      if (!trackRef.current) return;
      const rect = trackRef.current.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      const val = Math.round(min + ratio * (max - min));
      if (dragging === 'start') onChangeRef.current(Math.min(val, endRef.current), endRef.current);
      else onChangeRef.current(startRef.current, Math.max(val, startRef.current));
    };
    const up = () => setDragging(null);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', up);
    };
  }, [dragging, min, max]);

  return (
    <div className="relative h-10 select-none touch-none" ref={trackRef}>
      <div className="absolute top-1/2 -translate-y-1/2 w-full h-1.5 bg-[#e5e7eb] rounded-full" />
      <div
        className="absolute top-1/2 -translate-y-1/2 h-1.5 bg-[#1e3a5f] rounded-full"
        style={{ left: `${pct(start)}%`, width: `${pct(end) - pct(start)}%` }}
      />
      <button
        type="button"
        onPointerDown={(e) => {
          e.preventDefault();
          setDragging('start');
        }}
        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-6 h-6 bg-white border-2 border-[#1e3a5f] rounded-full cursor-grab active:cursor-grabbing shadow-md hover:scale-110 transition-transform z-10"
        style={{ left: `${pct(start)}%` }}
        title={`開始: 項目${start}`}
      />
      <button
        type="button"
        onPointerDown={(e) => {
          e.preventDefault();
          setDragging('end');
        }}
        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-6 h-6 bg-white border-2 border-[#1e3a5f] rounded-full cursor-grab active:cursor-grabbing shadow-md hover:scale-110 transition-transform z-10"
        style={{ left: `${pct(end)}%` }}
        title={`終了: 項目${end}`}
      />
    </div>
  );
}
