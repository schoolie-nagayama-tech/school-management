'use client';

import { Minus, Plus } from 'lucide-react';

const MAX_KOMA = 60;

interface SubjectInputProps {
  subjects: string[];
  values: Record<string, number>;
  onChange: (subject: string, value: number) => void;
  disabled?: boolean;
}

/**
 * 科目ごとのコマ数入力。
 *
 * 以前は `type="number"` の入力欄＋固定幅ラベル(w-24)＋「コマ」の3カラムで、
 * スマホ幅では「コ／マ」が縦に割れ、数字キーボードを出して打つ必要があった。
 * 講習申込の StepSubjects と同じ ± ステッパーに揃えて、タップだけで完結させる
 * （講師UI・保護者UIともタイピングを最小化する方針）。
 */
export function SubjectInput({ subjects, values, onChange, disabled = false }: SubjectInputProps) {
  const bump = (subject: string, delta: number) => {
    const current = values[subject] || 0;
    const next = Math.min(MAX_KOMA, Math.max(0, current + delta));
    if (next !== current) onChange(subject, next);
  };

  return (
    <div className="space-y-1.5">
      {subjects.map((subject) => {
        const n = values[subject] || 0;
        return (
          <div
            key={subject}
            className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 ${
              n > 0
                ? 'border-[color:var(--primary)]/40 bg-[color:var(--primary-subtle)]'
                : 'border-[#e5e7eb] bg-white'
            }`}
          >
            <span className="text-sm font-medium text-[#1f2937] min-w-0 truncate">{subject}</span>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => bump(subject, -1)}
                disabled={disabled || n <= 0}
                aria-label={`${subject}を1コマ減らす`}
                className="w-9 h-9 rounded-full border border-[#e5e7eb] bg-white flex items-center justify-center text-[#4b5563] active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Minus className="w-4 h-4" />
              </button>
              <span className="w-12 text-center tabular-nums">
                <span className="text-lg font-semibold text-[#1f2937]">{n}</span>
                <span className="text-[11px] text-[#6b7280] ml-0.5">コマ</span>
              </span>
              <button
                type="button"
                onClick={() => bump(subject, 1)}
                disabled={disabled || n >= MAX_KOMA}
                aria-label={`${subject}を1コマ増やす`}
                className="w-9 h-9 rounded-full border border-[#e5e7eb] bg-white flex items-center justify-center text-[#4b5563] active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
