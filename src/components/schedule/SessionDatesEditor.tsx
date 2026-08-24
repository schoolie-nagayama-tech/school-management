'use client';

import { useState } from 'react';
import { Plus, Trash2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui';
import {
  generateSessionDates,
  mergeSessionDates,
  type SpecialCourseSession,
} from '@/lib/utils/specialCourses';

const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

interface SessionDatesEditorProps {
  value: SpecialCourseSession[];
  onChange: (next: SpecialCourseSession[]) => void;
}

/**
 * 開催予定表（日付×時刻の行リスト）のエディタ。
 *
 * 講習講座の開催予定と、通年講座の「講習期の上書き」の両方で同じ入力を使うため
 * コンポーネントとして切り出している。肝は一括生成: 1行ずつ手入力させると
 * 8回・12回の講座で必ず入力ミスが出るので、開始日・曜日・時刻・回数から機械的に並べる。
 */
export function SessionDatesEditor({ value, onChange }: SessionDatesEditorProps) {
  // 一括生成の入力（保存対象ではなく、生成ボタンを押すまでの作業用ステート）
  const [genStartDate, setGenStartDate] = useState('');
  const [genDows, setGenDows] = useState<number[]>([]);
  const [genStartTime, setGenStartTime] = useState('19:30');
  const [genEndTime, setGenEndTime] = useState('21:00');
  const [genCount, setGenCount] = useState(8);

  const toggleGenDow = (dow: number) => {
    setGenDows((cur) => (cur.includes(dow) ? cur.filter((d) => d !== dow) : [...cur, dow].sort()));
  };

  const handleGenerate = () => {
    const generated = generateSessionDates(
      genStartDate,
      genDows,
      genStartTime,
      genEndTime,
      genCount
    );
    if (generated.length === 0) return;
    onChange(mergeSessionDates(value, generated));
  };

  const updateSession = (index: number, patch: Partial<SpecialCourseSession>) => {
    onChange(value.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };

  return (
    <div className="space-y-4">
      {/* 一括生成 */}
      <div className="bg-white border border-[var(--stroke)] rounded-lg p-3 space-y-3">
        <p className="text-xs font-bold text-[var(--paragraph)] flex items-center gap-1">
          <Sparkles className="w-3.5 h-3.5" />
          一括生成
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[11px] text-[var(--paragraph)] mb-1">開始日</label>
            <input
              type="date"
              value={genStartDate}
              onChange={(e) => setGenStartDate(e.target.value)}
              className="px-2 py-1.5 border border-[var(--stroke)] rounded-md text-xs"
            />
          </div>
          <div>
            <label className="block text-[11px] text-[var(--paragraph)] mb-1">開始時刻</label>
            <input
              type="time"
              value={genStartTime}
              onChange={(e) => setGenStartTime(e.target.value)}
              className="px-2 py-1.5 border border-[var(--stroke)] rounded-md text-xs"
            />
          </div>
          <div>
            <label className="block text-[11px] text-[var(--paragraph)] mb-1">終了時刻</label>
            <input
              type="time"
              value={genEndTime}
              onChange={(e) => setGenEndTime(e.target.value)}
              className="px-2 py-1.5 border border-[var(--stroke)] rounded-md text-xs"
            />
          </div>
          <div>
            <label className="block text-[11px] text-[var(--paragraph)] mb-1">回数</label>
            <input
              type="number"
              min={1}
              max={50}
              value={genCount}
              onChange={(e) => setGenCount(Number(e.target.value) || 1)}
              className="w-16 px-2 py-1.5 border border-[var(--stroke)] rounded-md text-xs"
            />
          </div>
        </div>
        <div>
          <label className="block text-[11px] text-[var(--paragraph)] mb-1">
            曜日（複数選択可）
          </label>
          <div className="flex gap-1">
            {DOW_LABELS.map((label, dow) => (
              <button
                key={dow}
                type="button"
                onClick={() => toggleGenDow(dow)}
                className={`w-8 h-8 text-xs rounded-md font-medium transition-colors active:scale-[0.97] ${
                  genDows.includes(dow)
                    ? 'bg-[var(--headline)] text-white'
                    : 'bg-gray-100 text-[var(--paragraph)] hover:bg-gray-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleGenerate}
          disabled={!genStartDate || genDows.length === 0}
        >
          <Sparkles className="w-3.5 h-3.5 mr-1" />
          生成してリストに追加
        </Button>
        <p className="text-[11px] text-[var(--paragraph)]">
          例: 開始日=8/1・曜日=火木・回数=8 →
          8月から毎週火・木を8回分並べます。生成後も下の一覧で個別に削除・修正できます。
        </p>
      </div>

      {/* 個別行の一覧 */}
      <div className="space-y-2">
        {value.length === 0 && (
          <p className="text-xs text-[var(--paragraph)] py-2">
            開催予定がまだありません。一括生成するか、「行を追加」から入力してください。
          </p>
        )}
        {value.map((s, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-6 text-xs text-[var(--paragraph)] text-right shrink-0">{i + 1}</span>
            <input
              type="date"
              value={s.date}
              onChange={(e) => updateSession(i, { date: e.target.value })}
              className="px-2 py-1.5 border border-[var(--stroke)] rounded-md text-xs flex-1 min-w-0"
            />
            <input
              type="time"
              value={s.start_time}
              onChange={(e) => updateSession(i, { start_time: e.target.value })}
              className="px-2 py-1.5 border border-[var(--stroke)] rounded-md text-xs w-24"
            />
            <span className="text-xs text-[var(--paragraph)]">〜</span>
            <input
              type="time"
              value={s.end_time}
              onChange={(e) => updateSession(i, { end_time: e.target.value })}
              className="px-2 py-1.5 border border-[var(--stroke)] rounded-md text-xs w-24"
            />
            <button
              type="button"
              onClick={() => onChange(value.filter((_, idx) => idx !== i))}
              className="p-1.5 text-gray-400 hover:text-danger hover:bg-danger/10 rounded-md transition-colors active:scale-[0.97]"
              aria-label="この行を削除"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onChange([...value, { date: '', start_time: '19:30', end_time: '21:00' }])}
        >
          <Plus className="w-3.5 h-3.5 mr-1" />
          行を追加
        </Button>
      </div>
    </div>
  );
}
