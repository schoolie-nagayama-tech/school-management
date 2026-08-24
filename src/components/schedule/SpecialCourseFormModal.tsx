'use client';

import { useEffect, useState } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui';
import { SessionDatesEditor } from './SessionDatesEditor';
import { GRADE_LABELS, type Subject } from '@/types/database';
import type { ScheduleFormation } from '@/types/schedule';
import type { SpecialCourse, SpecialCourseFormValues } from '@/lib/api/specialCourses';
import {
  totalCourseFee,
  SPECIAL_COURSE_SCOPE_LABELS,
  type SpecialCourseScope,
} from '@/lib/utils/specialCourses';

/** 学年トグルの選択肢（1=小1 〜 13=既卒）。GRADE_LABELS の定義順そのまま使う。 */
const GRADE_OPTIONS = Object.keys(GRADE_LABELS).map(Number);

export type { SpecialCourseFormValues };

interface SpecialCourseFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 'year_round'=通年講座（開催予定は持たない） / 'koushu'=講習講座（日付指定） */
  scope: SpecialCourseScope;
  /** 個別以外の指導形態（小集団・プログラミング等）。呼び出し側で絞り込み済み。 */
  formations: ScheduleFormation[];
  /** 科目マスタ（学年×科目の「科目」側）。未選択も可。 */
  subjects: Subject[];
  /** 編集対象。null なら新規作成 */
  editing: SpecialCourse | null;
  onSubmit: (values: SpecialCourseFormValues) => Promise<void>;
}

const emptyValues = (formations: ScheduleFormation[]): SpecialCourseFormValues => ({
  name: '',
  formation: formations[0]?.key ?? '',
  target_grades: [],
  subject_id: null,
  unit_price: null,
  capacity: null,
  session_dates: [],
  is_active: true,
});

/**
 * 特別講座（通年講座 / 講習講座）の追加・編集モーダル。
 *
 * 項目は 名前・指導形態（個別以外から）・対象学年・科目・単価・定員 が共通で、
 * 講習講座のときだけ開催予定表（一括生成つき）を出す。通年講座の時間割は
 * 座席表の形態ボードで「講座の枠」を作ると決まるので、ここでは入力しない。
 */
export function SpecialCourseFormModal({
  open,
  onOpenChange,
  scope,
  formations,
  subjects,
  editing,
  onSubmit,
}: SpecialCourseFormModalProps) {
  const [values, setValues] = useState<SpecialCourseFormValues>(emptyValues(formations));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isKoushu = scope === 'koushu';

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (editing) {
      setValues({
        name: editing.name,
        formation: editing.formation,
        target_grades: editing.target_grades,
        subject_id: editing.subject_id,
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

  const totalAmount = totalCourseFee(values.unit_price, values.session_dates.length);

  const handleSubmit = async () => {
    setError(null);
    if (!values.name.trim()) {
      setError('講座名を入力してください');
      return;
    }
    if (!values.formation) {
      setError('指導形態を選択してください');
      return;
    }
    if (isKoushu && values.session_dates.some((s) => !s.date || !s.start_time || !s.end_time)) {
      setError('開催予定に未入力の行があります');
      return;
    }
    setSaving(true);
    try {
      // 通年講座は開催予定を持たない（時間割は講座の枠側）。誤って残った行は捨てる。
      await onSubmit(isKoushu ? values : { ...values, session_dates: [] });
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const scopeLabel = SPECIAL_COURSE_SCOPE_LABELS[scope];

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg">
      <DialogHeader>
        <DialogTitle>{editing ? `${scopeLabel}を編集` : `${scopeLabel}を追加`}</DialogTitle>
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
                placeholder={isKoushu ? '例: 英単語特訓' : '例: 国理社オンラインライブ'}
                className="w-full px-3 py-2 border border-[var(--stroke)] rounded-lg bg-white text-sm focus:ring-2 focus:ring-primary focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--headline)] mb-1">
                指導形態 <span className="text-danger">*</span>
              </label>
              <select
                value={values.formation}
                onChange={(e) => setValues((v) => ({ ...v, formation: e.target.value }))}
                className="w-full px-3 py-2 border border-[var(--stroke)] rounded-lg bg-white text-sm focus:ring-2 focus:ring-primary focus:border-primary"
              >
                {formations.length === 0 && <option value="">指導形態が未登録です</option>}
                {formations.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* 対象学年・科目（講座は「学年×科目」の開講単位） */}
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

          <div>
            <label className="block text-sm font-medium text-[var(--headline)] mb-1">科目</label>
            <select
              value={values.subject_id ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, subject_id: e.target.value || null }))}
              className="w-full sm:w-1/2 px-3 py-2 border border-[var(--stroke)] rounded-lg bg-white text-sm focus:ring-2 focus:ring-primary focus:border-primary"
            >
              <option value="">指定なし（総合・プログラミング等）</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
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

          {/* 開催予定（講習講座のみ）。通年講座の時間割は座席表の形態ボードで作る。 */}
          {isKoushu ? (
            <div className="border border-[var(--stroke)] rounded-xl p-4 bg-gray-50/50 space-y-4">
              <div>
                <p className="text-sm font-medium text-[var(--headline)] mb-1">開催予定</p>
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                  開催日時は保護者に配布され、
                  <span className="font-bold">変更・振替はできません</span>
                  。登録前によく確認してください。
                </p>
              </div>
              <SessionDatesEditor
                value={values.session_dates}
                onChange={(next) => setValues((v) => ({ ...v, session_dates: next }))}
              />
            </div>
          ) : (
            <p className="text-xs text-[var(--paragraph)] bg-gray-50 border border-[var(--stroke)] rounded-md px-3 py-2">
              通年講座の時間割（曜日×コマ）は、座席表の形態ボードで「講座の枠」を作ると決まります。
              講習期だけ日時を変える場合は、保存後に一覧の「講習期の上書き」から登録してください。
            </p>
          )}

          {/* 合計金額プレビュー（講習講座は回数が決まっているので出す） */}
          {isKoushu && (
            <div className="flex items-center justify-between px-4 py-3 bg-success-subtle rounded-lg">
              <span className="text-sm text-[var(--paragraph)]">
                合計金額（単価 × {values.session_dates.length}回）
              </span>
              <span className="text-lg font-bold text-[var(--headline)]">
                {totalAmount != null ? `${totalAmount.toLocaleString()} 円` : '—'}
              </span>
            </div>
          )}

          {/* 有効/無効 */}
          <label className="flex items-center gap-2 text-sm text-[var(--paragraph)] cursor-pointer w-fit">
            <input
              type="checkbox"
              checked={values.is_active}
              onChange={(e) => setValues((v) => ({ ...v, is_active: e.target.checked }))}
              className="w-4 h-4 rounded border-[var(--stroke)]"
            />
            有効（無効にすると申込・枠の作成対象から外れます）
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
