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
import type { ScheduleFormation, ScheduleTimeSlot } from '@/types/schedule';
import type { SpecialCourse, SpecialCourseFormValues } from '@/lib/api/specialCourses';
import { getActiveTimeSlots } from '@/lib/api/schedule';
import {
  totalCourseFee,
  COURSE_BILLING_UNIT_LABELS,
  DOW_LABELS,
  SPECIAL_COURSE_SCOPE_LABELS,
  type CourseBillingUnit,
  type SpecialCourseScope,
} from '@/lib/utils/specialCourses';

/** 学年トグルの選択肢（1=小1 〜 13=既卒）。GRADE_LABELS の定義順そのまま使う。 */
const GRADE_OPTIONS = Object.keys(GRADE_LABELS).map(Number);

export type { SpecialCourseFormValues };

interface SpecialCourseFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** コマ時間マスタ（schedule_time_slots）を引く対象教室。通年講座のコマ選択に使う。 */
  schoolId: string;
  /** 'year_round'=通年講座（開催予定は持たない） / 'koushu'=講習講座（日付指定） */
  scope: SpecialCourseScope;
  /** 個別以外の指導形態（小集団・プログラミング等）。呼び出し側で絞り込み済み。 */
  formations: ScheduleFormation[];
  /** 科目マスタ（学年×科目の「科目」側）。未選択も可。 */
  subjects: Subject[];
  /** 編集対象。null なら新規作成 */
  editing: SpecialCourse | null;
  /**
   * 新規作成時に初期選択する指導形態。
   * 「授業の設定」ページは形態タブの中から講座を追加するので、タブの形態を初期値にする。
   * 未指定なら formations の先頭。
   */
  defaultFormation?: string;
  onSubmit: (values: SpecialCourseFormValues) => Promise<void>;
}

const emptyValues = (
  formations: ScheduleFormation[],
  defaultFormation?: string
): SpecialCourseFormValues => ({
  name: '',
  formation:
    defaultFormation && formations.some((f) => f.key === defaultFormation)
      ? defaultFormation
      : (formations[0]?.key ?? ''),
  target_grades: [],
  subject_id: null,
  unit_price: null,
  // 既定は1回ごと。月謝制（HALなど）だけ画面で monthly に切り替える
  billing_unit: 'per_session',
  capacity: null,
  session_dates: [],
  day_of_week: null,
  time_slot_id: null,
  is_active: true,
});

/**
 * 特別講座（通年講座 / 講習講座）の追加・編集モーダル。
 *
 * 項目は 名前・指導形態（個別以外から）・対象学年・科目・単価・定員 が共通で、
 * 通年講座は定例の開催曜日・コマ、講習講座は開催予定表（一括生成つき）を出す。
 * 通年講座の生徒ごとの枠は座席表の形態ボードで作るが、その候補に出るためには
 * ここで曜日・コマを設定しておく必要がある（正典 docs/special-courses-plan.md フェーズ3）。
 */
export function SpecialCourseFormModal({
  open,
  onOpenChange,
  schoolId,
  scope,
  formations,
  subjects,
  editing,
  defaultFormation,
  onSubmit,
}: SpecialCourseFormModalProps) {
  const [values, setValues] = useState<SpecialCourseFormValues>(
    emptyValues(formations, defaultFormation)
  );
  const [timeSlots, setTimeSlots] = useState<ScheduleTimeSlot[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isKoushu = scope === 'koushu';
  // 月額の講座は合計金額プレビュー（単価×回数）を出さない
  const isMonthly = !isKoushu && values.billing_unit === 'monthly';

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
        billing_unit: editing.billing_unit ?? 'per_session',
        capacity: editing.capacity,
        session_dates: editing.session_dates,
        day_of_week: editing.day_of_week,
        time_slot_id: editing.time_slot_id,
        is_active: editing.is_active,
      });
    } else {
      setValues(emptyValues(formations, defaultFormation));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing, defaultFormation]);

  /**
   * コマの選択肢は「その講座の指導形態の有効なコマ時間」。
   * 形態ごとにコマ時間が独立採番されているため、形態を変えたら選び直しになる。
   * 講習講座は日付指定なのでコマを使わず、取得もしない。
   */
  useEffect(() => {
    if (!open || isKoushu || !schoolId || !values.formation) {
      setTimeSlots([]);
      return;
    }
    let cancelled = false;
    getActiveTimeSlots(schoolId, values.formation)
      .then((slots) => {
        if (!cancelled) setTimeSlots(slots);
      })
      .catch(() => {
        if (!cancelled) setTimeSlots([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, isKoushu, schoolId, values.formation]);

  /** 指導形態を変えるとコマ時間の並びが変わるので、選択済みのコマは捨てる（別形態のコマが残る事故を防ぐ）。 */
  const handleFormationChange = (formation: string) => {
    setValues((v) => ({
      ...v,
      formation,
      time_slot_id: v.formation === formation ? v.time_slot_id : null,
    }));
  };

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
      // 種別ごとに使わない項目は保存前に落とす。
      //  - 通年講座: 開催予定（日付指定は講習講座のもの）
      //  - 講習講座: 定例の曜日・コマ（scope 切替で残った値をそのまま書かない）
      await onSubmit(
        isKoushu
          ? { ...values, day_of_week: null, time_slot_id: null }
          : { ...values, session_dates: [] }
      );
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
                onChange={(e) => handleFormationChange(e.target.value)}
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

          {/* 受講料・定員。通年講座は「1回ごと」か「月額」かを講座ごとに選ぶ（HALは月額） */}
          {!isKoushu && (
            <div>
              <label className="block text-sm font-medium text-[var(--headline)] mb-1">
                受講料の数え方
              </label>
              <select
                value={values.billing_unit}
                onChange={(e) =>
                  setValues((v) => ({ ...v, billing_unit: e.target.value as CourseBillingUnit }))
                }
                className="w-full px-3 py-2 border border-[var(--stroke)] rounded-lg bg-white text-sm focus:ring-2 focus:ring-primary focus:border-primary"
              >
                {(Object.keys(COURSE_BILLING_UNIT_LABELS) as CourseBillingUnit[]).map((u) => (
                  <option key={u} value={u}>
                    {COURSE_BILLING_UNIT_LABELS[u]}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-[var(--paragraph-light)]">
                月謝制の講座（HALなど）は「月額」にしてください。「1回ごと」のまま月額を入れると、
                その月の実施回数ぶん掛かって数倍の請求になります。
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--headline)] mb-1">
                {isMonthly ? '月額（円）' : '単価（1回・円）'}
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
                placeholder={isMonthly ? '例: 10890' : '例: 3000'}
                className="w-full px-3 py-2 border border-[var(--stroke)] rounded-lg bg-white text-sm focus:ring-2 focus:ring-primary focus:border-primary"
              />
              {isMonthly && (
                <p className="mt-1 text-[11px] text-[var(--paragraph-light)]">
                  その月に4回でも5回でも、この金額を1回だけ請求します。
                </p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--headline)] mb-1">
                定員（1枠あたり）
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
                placeholder="未入力=形態の既定値"
                className="w-full px-3 py-2 border border-[var(--stroke)] rounded-lg bg-white text-sm focus:ring-2 focus:ring-primary focus:border-primary"
              />
              {/* 個別・小集団・プログラミングの実質的な違いはこの数字だけ、という整理（定員の講座一本化）。 */}
              <p className="mt-1 text-xs text-[var(--paragraph)]">
                1枠（講師1人）あたりの生徒数の上限。未入力ならこの形態の既定値を使います。例:
                HAL50分=3 / HAL80分=5 / 国理社=10
              </p>
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
            /* 定例の開催枠（通年講座のみ）。座席表の枠はこの曜日×コマのセルからしか作れない。 */
            <div className="border border-[var(--stroke)] rounded-xl p-4 bg-gray-50/50 space-y-3">
              <p className="text-sm font-medium text-[var(--headline)]">定例の開催枠（任意）</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--headline)] mb-1">
                    曜日
                  </label>
                  <select
                    value={values.day_of_week ?? ''}
                    onChange={(e) =>
                      setValues((v) => ({
                        ...v,
                        day_of_week: e.target.value === '' ? null : Number(e.target.value),
                      }))
                    }
                    className="w-full px-3 py-2 border border-[var(--stroke)] rounded-lg bg-white text-sm focus:ring-2 focus:ring-primary focus:border-primary"
                  >
                    <option value="">未設定</option>
                    {DOW_LABELS.map((label, dow) => (
                      <option key={dow} value={dow}>
                        {label}曜
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--headline)] mb-1">
                    コマ
                  </label>
                  <select
                    value={values.time_slot_id ?? ''}
                    onChange={(e) =>
                      setValues((v) => ({ ...v, time_slot_id: e.target.value || null }))
                    }
                    className="w-full px-3 py-2 border border-[var(--stroke)] rounded-lg bg-white text-sm focus:ring-2 focus:ring-primary focus:border-primary"
                  >
                    <option value="">未設定</option>
                    {timeSlots.map((s) => (
                      <option key={s.id} value={s.id}>
                        {`#${s.slot_number} ${s.start_time.slice(0, 5)}-${s.end_time.slice(0, 5)}`}
                      </option>
                    ))}
                  </select>
                  {timeSlots.length === 0 && (
                    <p className="mt-1 text-xs text-amber-700">
                      この指導形態のコマ時間が未登録です（設定 → コマ時間設定で追加してください）
                    </p>
                  )}
                </div>
              </div>
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                設定すると、座席表の形態ボードでは その曜日×コマのセルにだけ
                この講座が候補として出ます。生徒ごとに曜日や時刻が違う講座（HAL
                など）は未設定のままにしてください。どのコマの枠からでも選べます。
              </p>
              <p className="text-xs text-[var(--paragraph)]">
                生徒ごとの枠（名簿）は座席表の形態ボードで作ります。講習期だけ日時を変える場合は、保存後に一覧の「講習期の上書き」から登録してください。
              </p>
            </div>
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
