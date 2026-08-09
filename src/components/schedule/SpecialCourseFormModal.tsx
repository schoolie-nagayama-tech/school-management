'use client';

import { useEffect, useState } from 'react';
import { Plus, Trash2, Sparkles } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui';
import { GRADE_LABELS } from '@/types/database';
import type { ScheduleFormation } from '@/types/schedule';
import type { KoushuSpecialCourse, SpecialCourseSession } from '@/lib/api/koushuSpecialCourses';

const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

/** 学年トグルの選択肢（1=小1 〜 13=既卒）。GRADE_LABELS の定義順そのまま使う。 */
const GRADE_OPTIONS = Object.keys(GRADE_LABELS).map(Number);

export interface SpecialCourseFormValues {
  name: string;
  formation: string;
  target_grades: number[];
  unit_price: number | null;
  capacity: number | null;
  session_dates: SpecialCourseSession[];
  is_active: boolean;
}

interface SpecialCourseFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** !is_system && is_active の形態のみ（小集団・HAL 等）。呼び出し側で絞り込み済み。 */
  formations: ScheduleFormation[];
  /** 編集対象。null なら新規作成 */
  editing: KoushuSpecialCourse | null;
  onSubmit: (values: SpecialCourseFormValues) => Promise<void>;
}

const emptyValues = (formations: ScheduleFormation[]): SpecialCourseFormValues => ({
  name: '',
  formation: formations[0]?.key ?? '',
  target_grades: [],
  unit_price: null,
  capacity: null,
  session_dates: [],
  is_active: true,
});

/** Date を "YYYY-MM-DD" にする。toISOString はUTC変換で日付がズレるため使わず、ローカル値から組み立てる。 */
function toYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 開始日から指定曜日・回数分の開催日を機械的に並べる（一括生成）。
 * 例: 開始日=8/1・曜日=火木・回数=8 → 8月中の火曜木曜を8回分、日付順に並べる。
 * 3650日（約10年）回しても埋まらない場合は打ち切る（曜日未選択などの入力ミス対策）。
 */
function generateSessionDates(
  startDate: string,
  dows: number[],
  startTime: string,
  endTime: string,
  count: number
): SpecialCourseSession[] {
  if (!startDate || dows.length === 0 || count <= 0) return [];
  const dowSet = new Set(dows);
  const result: SpecialCourseSession[] = [];
  const cur = new Date(startDate + 'T00:00:00');
  for (let guard = 0; guard < 3650 && result.length < count; guard++) {
    if (dowSet.has(cur.getDay())) {
      result.push({ date: toYMD(cur), start_time: startTime, end_time: endTime });
    }
    cur.setDate(cur.getDate() + 1);
  }
  return result;
}

/** 開催予定表の重複判定キー（同一日時の二重登録を弾く） */
const sessionKey = (s: SpecialCourseSession) => `${s.date}_${s.start_time}_${s.end_time}`;

/**
 * 特別講座（小集団・HAL 等）の追加・編集モーダル。
 * 肝は開催予定表の入力: 1行ずつの手入力に加え、開始日・曜日・時刻・回数を指定した一括生成を用意する。
 * 決定37: 開催日時は保護者に配布済み扱いになるため、生成後も個別編集はできるが「変更・振替不可」を明示する。
 */
export function SpecialCourseFormModal({
  open,
  onOpenChange,
  formations,
  editing,
  onSubmit,
}: SpecialCourseFormModalProps) {
  const [values, setValues] = useState<SpecialCourseFormValues>(emptyValues(formations));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 一括生成の入力（保存対象ではなく、生成ボタンを押すまでの作業用ステート）
  const [genStartDate, setGenStartDate] = useState('');
  const [genDows, setGenDows] = useState<number[]>([]);
  const [genStartTime, setGenStartTime] = useState('19:30');
  const [genEndTime, setGenEndTime] = useState('21:00');
  const [genCount, setGenCount] = useState(8);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (editing) {
      setValues({
        name: editing.name,
        formation: editing.formation,
        target_grades: editing.target_grades,
        unit_price: editing.unit_price,
        capacity: editing.capacity,
        session_dates: editing.session_dates,
        is_active: editing.is_active,
      });
    } else {
      setValues(emptyValues(formations));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  const toggleGrade = (grade: number) => {
    setValues((v) => ({
      ...v,
      target_grades: v.target_grades.includes(grade)
        ? v.target_grades.filter((g) => g !== grade)
        : [...v.target_grades, grade].sort((a, b) => a - b),
    }));
  };

  const toggleGenDow = (dow: number) => {
    setGenDows((cur) => (cur.includes(dow) ? cur.filter((d) => d !== dow) : [...cur, dow].sort()));
  };

  const addEmptySession = () => {
    setValues((v) => ({
      ...v,
      session_dates: [...v.session_dates, { date: '', start_time: '19:30', end_time: '21:00' }],
    }));
  };

  const updateSession = (index: number, patch: Partial<SpecialCourseSession>) => {
    setValues((v) => ({
      ...v,
      session_dates: v.session_dates.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    }));
  };

  const removeSession = (index: number) => {
    setValues((v) => ({ ...v, session_dates: v.session_dates.filter((_, i) => i !== index) }));
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
    setValues((v) => {
      // 既存行と完全一致（同一日時）する生成結果は重複登録しない。日付順に並べ直す。
      const existingKeys = new Set(v.session_dates.map(sessionKey));
      const merged = [
        ...v.session_dates,
        ...generated.filter((s) => !existingKeys.has(sessionKey(s))),
      ];
      merged.sort((a, b) => (a.date + a.start_time).localeCompare(b.date + b.start_time));
      return { ...v, session_dates: merged };
    });
  };

  const totalAmount =
    values.unit_price != null ? values.unit_price * values.session_dates.length : null;

  const handleSubmit = async () => {
    setError(null);
    if (!values.name.trim()) {
      setError('講座名を入力してください');
      return;
    }
    if (!values.formation) {
      setError('形態を選択してください');
      return;
    }
    if (values.session_dates.some((s) => !s.date || !s.start_time || !s.end_time)) {
      setError('開催予定に未入力の行があります');
      return;
    }
    setSaving(true);
    try {
      await onSubmit(values);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg">
      <DialogHeader>
        <DialogTitle>{editing ? '講座を編集' : '講座を追加'}</DialogTitle>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-5">
          {/* 基本情報 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--headline)] mb-1">
                講座名 <span className="text-danger">*</span>
              </label>
              <input
                type="text"
                value={values.name}
                onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
                placeholder="例: 小集団プログラミング（HAL）"
                className="w-full px-3 py-2 border border-[var(--stroke)] rounded-lg bg-white text-sm focus:ring-2 focus:ring-primary focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--headline)] mb-1">
                形態 <span className="text-danger">*</span>
              </label>
              <select
                value={values.formation}
                onChange={(e) => setValues((v) => ({ ...v, formation: e.target.value }))}
                className="w-full px-3 py-2 border border-[var(--stroke)] rounded-lg bg-white text-sm focus:ring-2 focus:ring-primary focus:border-primary"
              >
                {formations.length === 0 && <option value="">形態が未登録です</option>}
                {formations.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* 対象学年 */}
          <div>
            <label className="block text-sm font-medium text-[var(--headline)] mb-1">
              対象学年
            </label>
            <div className="flex flex-wrap gap-1">
              {GRADE_OPTIONS.map((grade) => (
                <button
                  key={grade}
                  type="button"
                  onClick={() => toggleGrade(grade)}
                  className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors active:scale-[0.97] ${
                    values.target_grades.includes(grade)
                      ? 'bg-[var(--headline)] text-white'
                      : 'bg-gray-100 text-[var(--paragraph)] hover:bg-gray-200'
                  }`}
                >
                  {GRADE_LABELS[grade]}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-[var(--paragraph)]">
              未選択の場合は全学年が対象になります
            </p>
          </div>

          {/* 単価・定員 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--headline)] mb-1">
                単価（1回・円）
              </label>
              <input
                type="number"
                min={0}
                value={values.unit_price ?? ''}
                onChange={(e) =>
                  setValues((v) => ({
                    ...v,
                    unit_price: e.target.value === '' ? null : Number(e.target.value),
                  }))
                }
                placeholder="例: 3000"
                className="w-full px-3 py-2 border border-[var(--stroke)] rounded-lg bg-white text-sm focus:ring-2 focus:ring-primary focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--headline)] mb-1">
                定員（任意）
              </label>
              <input
                type="number"
                min={0}
                value={values.capacity ?? ''}
                onChange={(e) =>
                  setValues((v) => ({
                    ...v,
                    capacity: e.target.value === '' ? null : Number(e.target.value),
                  }))
                }
                placeholder="未指定=制限なし"
                className="w-full px-3 py-2 border border-[var(--stroke)] rounded-lg bg-white text-sm focus:ring-2 focus:ring-primary focus:border-primary"
              />
            </div>
          </div>

          {/* 開催予定 */}
          <div className="border border-[var(--stroke)] rounded-xl p-4 bg-gray-50/50 space-y-4">
            <div>
              <p className="text-sm font-medium text-[var(--headline)] mb-1">開催予定</p>
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                開催日時は保護者に配布され、
                <span className="font-bold">変更・振替はできません</span>
                。登録前によく確認してください。
              </p>
            </div>

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
              {values.session_dates.length === 0 && (
                <p className="text-xs text-[var(--paragraph)] py-2">
                  開催予定がまだありません。一括生成するか、「行を追加」から入力してください。
                </p>
              )}
              {values.session_dates.map((s, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-6 text-xs text-[var(--paragraph)] text-right shrink-0">
                    {i + 1}
                  </span>
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
                    onClick={() => removeSession(i)}
                    className="p-1.5 text-gray-400 hover:text-danger hover:bg-danger/10 rounded-md transition-colors active:scale-[0.97]"
                    aria-label="この行を削除"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              <Button type="button" variant="ghost" size="sm" onClick={addEmptySession}>
                <Plus className="w-3.5 h-3.5 mr-1" />
                行を追加
              </Button>
            </div>
          </div>

          {/* 合計金額プレビュー */}
          <div className="flex items-center justify-between px-4 py-3 bg-success-subtle rounded-lg">
            <span className="text-sm text-[var(--paragraph)]">
              合計金額（単価 × {values.session_dates.length}回）
            </span>
            <span className="text-lg font-bold text-[var(--headline)]">
              {totalAmount != null ? `${totalAmount.toLocaleString()} 円` : '—'}
            </span>
          </div>

          {/* 有効/無効 */}
          <label className="flex items-center gap-2 text-sm text-[var(--paragraph)] cursor-pointer w-fit">
            <input
              type="checkbox"
              checked={values.is_active}
              onChange={(e) => setValues((v) => ({ ...v, is_active: e.target.checked }))}
              className="w-4 h-4 rounded border-[var(--stroke)]"
            />
            有効（無効にすると申込対象から外れます）
          </label>

          {error && <p className="text-sm text-danger">{error}</p>}
        </div>
      </DialogContent>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
          キャンセル
        </Button>
        <Button onClick={handleSubmit} isLoading={saving}>
          保存
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
