'use client';

/**
 * コース（PS1 / PS2 / キッズ）を変更するダイアログ。教室長以上だけが開ける。
 *
 * コースを動かせる唯一の入口。授業の登録フォームからは変えられないようにしたので、
 * 変えたい人は必ずここを通る。理由を必須にしているのは、
 * 「片手間に変えられなくする」ことそのものが目的だから（入力の手間が抑止になる）。
 *
 * ★すでに入っている授業は書き換えない。
 *   保護者に見せているのはコースではなく実登録(schedule_entries.ratio)なので、
 *   コースを直したついでに過去の登録まで書き換えると、実際には1対2で受けた授業が
 *   画面上だけ1対1に見える。表示が誤りを覆い隠す装置になってしまう。
 *   食い違いは消さずに、教室長ダッシュボードで見えるようにする。
 */

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui';
import { Button } from '@/components/ui';
import { setStudentCourse } from '@/lib/api/student-subject-contracts';
import {
  courseFullLabel,
  courseOptionsForGrade,
  COURSE_CHANGE_REASONS,
  COURSE_REASON_LABELS,
  type CourseDuration,
  type CourseRatio,
  type CourseReasonCode,
  type StudentCourse,
} from '@/lib/utils/studentCourse';

export interface CourseChangeDialogProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  schoolId: string;
  studentId: string;
  studentName: string;
  subjectId: string;
  subjectName: string;
  /** 現在のコース。null = 未設定（初回登録）。 */
  current: StudentCourse | null;
  grade?: number | null;
  actorId: string | null | undefined;
  actorRole: string | null | undefined;
}

export function CourseChangeDialog({
  open,
  onClose,
  onSaved,
  schoolId,
  studentId,
  studentName,
  subjectId,
  subjectName,
  current,
  grade,
  actorId,
  actorRole,
}: CourseChangeDialogProps) {
  const [ratio, setRatio] = useState<CourseRatio | null>(current?.ratio ?? null);
  const [duration, setDuration] = useState<CourseDuration>(current?.durationMinutes ?? null);
  const [reasonCode, setReasonCode] = useState<CourseReasonCode>('correction');
  const [reasonNote, setReasonNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isInitial = current === null;
  // 既存データに名前の無い組み合わせ（1対1・45分）が入っていることがあるので、
  // 変更ダイアログではそれも選べるようにしておく（選べないと現状維持すらできなくなる）。
  const options = courseOptionsForGrade(grade, current?.durationMinutes === 45);
  const changed =
    ratio !== null && (ratio !== current?.ratio || duration !== current?.durationMinutes);
  const canSubmit =
    ratio !== null && changed && (isInitial || reasonCode !== 'other' || !!reasonNote.trim());

  const handleSubmit = async () => {
    if (!canSubmit || ratio === null) return;
    setSaving(true);
    setError(null);
    try {
      await setStudentCourse({
        schoolId,
        studentId,
        subjectId,
        ratio,
        durationMinutes: duration,
        reasonCode: isInitial ? 'initial' : reasonCode,
        reasonNote,
        actorId,
        actorRole,
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'コースの保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-baseline gap-2">
            {isInitial ? 'コースの設定' : 'コースの変更'}
            <span className="text-xs font-normal text-[var(--paragraph-light)]">
              {studentName} ／ {subjectName}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {!isInitial && current && (
            <div>
              <div className="text-xs font-medium text-[var(--paragraph)] mb-1">現在</div>
              <div className="px-3 py-2 border border-[var(--stroke)] rounded-md bg-[var(--surface)] text-sm font-semibold text-[var(--headline)]">
                {courseFullLabel(current.ratio, current.durationMinutes)}
              </div>
            </div>
          )}

          <div>
            <div className="text-xs font-medium text-[var(--paragraph)] mb-1">
              {isInitial ? 'コース' : '変更後'}
            </div>
            <div className="flex gap-2 flex-wrap">
              {options.map((o) => {
                const on = ratio === o.ratio && duration === o.duration;
                return (
                  <button
                    key={`${o.ratio}-${o.duration}`}
                    type="button"
                    onClick={() => {
                      setRatio(o.ratio);
                      setDuration(o.duration);
                    }}
                    className={`flex-1 min-w-[104px] px-3 py-2 rounded border text-sm transition-colors duration-150 ${
                      on
                        ? 'bg-[#1e3a5f] text-white border-[#1e3a5f]'
                        : 'bg-white border-[var(--stroke)] text-[var(--paragraph)] hover:bg-[var(--surface)]'
                    }`}
                  >
                    <span className="block font-semibold">{o.label}</span>
                    <span
                      className={`block text-[10px] ${on ? 'text-[#c7d5e6]' : 'text-[var(--paragraph-light)]'}`}
                    >
                      {o.detail}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {!isInitial && (
            <>
              <div>
                <div className="text-xs font-medium text-[var(--paragraph)] mb-1">
                  変更理由 <span className="text-red-600">必須</span>
                </div>
                <select
                  value={reasonCode}
                  onChange={(e) => setReasonCode(e.target.value as CourseReasonCode)}
                  className="w-full px-3 py-2 border border-[var(--stroke)] rounded-md text-sm bg-white"
                >
                  {COURSE_CHANGE_REASONS.map((c) => (
                    <option key={c} value={c}>
                      {COURSE_REASON_LABELS[c]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div className="text-xs font-medium text-[var(--paragraph)] mb-1">
                  補足{reasonCode === 'other' && <span className="text-red-600"> 必須</span>}
                </div>
                <input
                  value={reasonNote}
                  onChange={(e) => setReasonNote(e.target.value)}
                  placeholder="例：入会時からPS1。1対2で登録されていたのを訂正"
                  className="w-full px-3 py-2 border border-[var(--stroke)] rounded-md text-sm bg-white"
                />
              </div>
              <div className="flex gap-2 text-[11px] leading-relaxed text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                <AlertTriangle className="w-3.5 h-3.5 flex-none mt-0.5" />
                <span>
                  すでに入っている授業は変わりません。直すべき授業は教室長ダッシュボードの
                  「コースと登録の食い違い」に出ます。
                </span>
              </div>
            </>
          )}

          {error && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            キャンセル
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={!canSubmit || saving}>
            {saving ? '保存中…' : isInitial ? '設定する' : '変更する'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
