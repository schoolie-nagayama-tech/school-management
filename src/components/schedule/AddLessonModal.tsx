'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui';
import { Button } from '@/components/ui';
import { StudentSearchInput, type StudentWithSubjects } from './StudentSearchInput';
import { InquirySearchInput } from './InquirySearchInput';
import { createScheduleEntry, checkStudentTimeConflict } from '@/lib/api/schedule';
import { markInquiryTrialScheduled } from '@/lib/api/inquiries';
import { getStudentContractRatioMap } from '@/lib/api/student-subject-contracts';
import type { ScheduleTimeSlot, HalfPosition, ScheduleEntryFormData } from '@/types/schedule';
import { INDIVIDUAL_FORMATION } from '@/types/schedule';
import type { Subject } from '@/types/database';
import type { Inquiry } from '@/types/database';
import { getInquiryDisplayName } from '@/app/admin/inquiries/inquiryConstants';

/** モーダルに渡す講師（座席表 page の teachers を最小限に絞った形）。 */
export interface AddLessonTeacher {
  id: string;
  display_name: string | null;
  email: string | null;
}

export interface AddLessonModalProps {
  isOpen: boolean;
  onClose: () => void;
  schoolId: string;
  /** 個別のコマ時間（formation='individual'）。追加授業・体験はいずれも個別枠に置く。 */
  timeSlots: ScheduleTimeSlot[];
  teachers: AddLessonTeacher[];
  subjects: Subject[];
  /** 表示中の週の月曜日。既定日付の算出に使う（週内の今日、無ければ週頭）。 */
  weekStart: Date;
  onSuccess: () => void;
}

/** 種別タブ。追加授業（additional）/ 体験授業（trial）。 */
type LessonKind = 'additional' | 'trial';
/** 体験の対象者切替。既存生徒 / 問合せ名簿の見込み客。 */
type TrialTarget = 'student' | 'inquiry';

function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 表示中の週（月曜 weekStart 〜 +6日）に今日が含まれれば今日、無ければ週頭を既定日にする。 */
function defaultDateForWeek(weekStart: Date): string {
  const todayStr = toLocalDateStr(new Date());
  const start = toLocalDateStr(weekStart);
  const endD = new Date(weekStart);
  endD.setDate(endD.getDate() + 6);
  const end = toLocalDateStr(endD);
  if (todayStr >= start && todayStr <= end) return todayStr;
  return start;
}

/**
 * ツールバー起点の「授業を追加」モーダル（Phase T）。
 * 空きセル起点の AddStudentToSlotModal と違い、講師・日付・コマも選ぶ独立モーダル。
 * 追加授業（既存生徒のみ）と体験授業（既存生徒 or 問合せ名簿の見込み客）を単発コマとして登録する。
 */
export function AddLessonModal({
  isOpen,
  onClose,
  schoolId,
  timeSlots,
  teachers,
  subjects,
  weekStart,
  onSuccess,
}: AddLessonModalProps) {
  const { profile } = useAuth();
  void profile; // 予約：将来 created_by 等で使う可能性。現状は createScheduleEntry 側で解決。

  const [kind, setKind] = useState<LessonKind>('additional');
  const [trialTarget, setTrialTarget] = useState<TrialTarget>('inquiry');
  const [selectedStudent, setSelectedStudent] = useState<StudentWithSubjects | null>(null);
  const [selectedInquiry, setSelectedInquiry] = useState<Inquiry | null>(null);
  const [subjectId, setSubjectId] = useState<string>('');
  const [teacherId, setTeacherId] = useState<string>('');
  const [date, setDate] = useState<string>('');
  const [slotId, setSlotId] = useState<string>('');
  // Phase R: 追加授業（既存生徒）のみ 指導比率・45分前後半を出す。体験は ratio=2 固定・半コマなし。
  const [ratio, setRatio] = useState<1 | 2>(2);
  const [halfPosition, setHalfPosition] = useState<HalfPosition>(null);
  const [contractRatioMap, setContractRatioMap] = useState<Map<string, 1 | 2>>(new Map());
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const selectedSubject = subjects.find((s) => s.id === subjectId);
  const is45 = selectedSubject?.duration_minutes === 45;
  const selectedSlot = timeSlots.find((s) => s.id === slotId) ?? null;

  // 体験×問合せ（見込み客）のときは既存生徒の入力・比率UIを出さない。
  const isInquiryTrial = kind === 'trial' && trialTarget === 'inquiry';
  // 比率・45分UIを出すのは「追加授業（＝既存生徒）」のときだけ（体験はシンプルに）。
  const showRatioUi = kind === 'additional';

  // 開くたびに初期化。既定日付・先頭コマ・先頭講師をセット。
  useEffect(() => {
    if (!isOpen) return;
    setKind('additional');
    setTrialTarget('inquiry');
    setSelectedStudent(null);
    setSelectedInquiry(null);
    setSubjectId(subjects[0]?.id ?? '');
    setTeacherId(teachers[0]?.id ?? '');
    setDate(defaultDateForWeek(weekStart));
    setSlotId(timeSlots[0]?.id ?? '');
    setRatio(2);
    setHalfPosition(null);
    setContractRatioMap(new Map());
    setErrorMsg(null);
    // weekStart は Date（参照が毎回変わりうる）ため文字列化して依存に使う。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, subjects, teachers, timeSlots, toLocalDateStr(weekStart)]);

  // 追加授業の既存生徒選択時：契約比率マップを読み込む（科目選択時の ratio 初期値に使う）。
  useEffect(() => {
    if (!selectedStudent) {
      setContractRatioMap(new Map());
      return;
    }
    let cancelled = false;
    getStudentContractRatioMap(selectedStudent.id).then((m) => {
      if (!cancelled) setContractRatioMap(m);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedStudent]);

  // 科目変更時：ratio は契約から初期化、half は45分科目なら前半を既定に。
  useEffect(() => {
    if (!showRatioUi) return;
    setRatio(contractRatioMap.get(subjectId) ?? 2);
    setHalfPosition(selectedSubject?.duration_minutes === 45 ? 'first' : null);
  }, [subjectId, contractRatioMap, selectedSubject?.duration_minutes, showRatioUi]);

  const handleSubmit = async () => {
    if (!schoolId || !subjectId || !teacherId || !date || !selectedSlot) return;
    setErrorMsg(null);
    setSaving(true);
    try {
      const startTime = selectedSlot.start_time ?? '00:00:00';
      const endTime = selectedSlot.end_time ?? '23:59:59';

      if (isInquiryTrial) {
        // ---- 体験 × 問合せ（見込み客）: student_id 無し・inquiry_id 参照 ----
        if (!selectedInquiry) {
          setErrorMsg('問合せを選択してください');
          setSaving(false);
          return;
        }
        const form: ScheduleEntryFormData = {
          teacher_id: teacherId,
          inquiry_id: selectedInquiry.id,
          subject_ids: [subjectId],
          seat_label: '',
          note: '',
          ratio: 2,
          duration_minutes: null,
          half_position: null,
          kind: 'trial',
          formation: INDIVIDUAL_FORMATION,
        };
        await createScheduleEntry(schoolId, date, selectedSlot.id, form, {
          regular_pattern_id: null,
          status: 'scheduled',
        });
        // 体験コマ日時を trial_at にセットし、status を体験待ちへ引き上げる（in_progress のときのみ）。
        // 失敗しても体験コマ自体は登録済みなので、連動更新のエラーは致命扱いにしない。
        try {
          await markInquiryTrialScheduled(selectedInquiry.id, `${date}T${startTime}+09:00`);
        } catch (e) {
          console.warn('問合せの体験予約連動に失敗しました（体験コマは登録済み）:', e);
        }
        onSuccess();
        onClose();
        return;
      }

      // ---- 既存生徒（追加授業 / 体験×既存生徒） ----
      if (!selectedStudent) {
        setErrorMsg('生徒を選択してください');
        setSaving(false);
        return;
      }
      // 体験×既存生徒はシンプルに ratio=2・全コマ。追加授業は選んだ比率・半コマ。
      const effRatio: 1 | 2 = showRatioUi ? ratio : 2;
      const effHalf: HalfPosition = showRatioUi && is45 ? halfPosition : null;
      const effDuration = showRatioUi ? (selectedSubject?.duration_minutes ?? null) : null;

      // 既存生徒は時間重複チェック（見込み客はスキップ）。specificDate で単発コマとして判定。
      const conflict = await checkStudentTimeConflict(
        selectedStudent.id,
        new Date(date + 'T12:00:00').getDay(),
        startTime,
        endTime,
        { specificDate: date, durationMinutes: effDuration, halfPosition: effHalf }
      );
      if (conflict) {
        setErrorMsg(conflict.message);
        setSaving(false);
        return;
      }

      const form: ScheduleEntryFormData = {
        teacher_id: teacherId,
        student_id: selectedStudent.id,
        subject_ids: [subjectId],
        seat_label: '',
        note: '',
        ratio: effRatio,
        duration_minutes: effDuration,
        half_position: effHalf,
        kind,
        formation: INDIVIDUAL_FORMATION,
      };
      await createScheduleEntry(schoolId, date, selectedSlot.id, form, {
        regular_pattern_id: null,
        status: 'scheduled',
      });
      onSuccess();
      onClose();
    } catch (e) {
      setErrorMsg((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const canSubmit = useMemo(() => {
    if (!schoolId || !subjectId || !teacherId || !date || !slotId) return false;
    if (isInquiryTrial) return !!selectedInquiry;
    return !!selectedStudent;
  }, [
    schoolId,
    subjectId,
    teacherId,
    date,
    slotId,
    isInquiryTrial,
    selectedInquiry,
    selectedStudent,
  ]);

  const selectClass =
    'w-full px-3 py-2 border border-[var(--stroke)] rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)]';

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md bg-white border border-gray-200">
        <DialogHeader>
          <DialogTitle>授業を追加</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* 種別タブ：追加授業 / 体験授業 */}
          <div className="inline-flex rounded-lg bg-[var(--surface)] p-0.5 w-full">
            {[
              { v: 'additional' as const, label: '追加授業' },
              { v: 'trial' as const, label: '体験授業' },
            ].map((t) => (
              <button
                key={t.v}
                type="button"
                onClick={() => setKind(t.v)}
                className={`flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  kind === t.v
                    ? 'bg-white text-[var(--headline)] shadow-sm'
                    : 'text-[var(--paragraph-light)] hover:text-[var(--headline)]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* 対象者 */}
          <div>
            <label className="block text-xs font-medium text-[var(--paragraph)] mb-1">対象者</label>
            {kind === 'trial' && (
              // 体験のみ「既存生徒 / 問合せ名簿」のサブトグルを出す。
              <div className="inline-flex rounded-lg bg-[var(--surface)] p-0.5 mb-2">
                {[
                  { v: 'inquiry' as const, label: '問合せ名簿' },
                  { v: 'student' as const, label: '既存生徒' },
                ].map((t) => (
                  <button
                    key={t.v}
                    type="button"
                    onClick={() => setTrialTarget(t.v)}
                    className={`px-3 py-0.5 rounded-md text-xs font-medium transition-colors ${
                      trialTarget === t.v
                        ? 'bg-white text-[var(--headline)] shadow-sm'
                        : 'text-[var(--paragraph-light)] hover:text-[var(--headline)]'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}

            {isInquiryTrial ? (
              <>
                <InquirySearchInput schoolId={schoolId} onSelect={setSelectedInquiry} />
                {selectedInquiry && (
                  <div className="mt-2 text-sm text-[var(--headline)]">
                    選択: {getInquiryDisplayName(selectedInquiry).name}
                    <span className="ml-1 text-xs text-[var(--paragraph-light)]">（見込み客）</span>
                  </div>
                )}
              </>
            ) : (
              <>
                <StudentSearchInput
                  schoolId={schoolId}
                  onSelect={setSelectedStudent}
                  placeholder="生徒を検索..."
                />
                {selectedStudent && (
                  <div className="mt-2 text-sm text-[var(--headline)]">
                    選択: {selectedStudent.last_name} {selectedStudent.first_name}
                  </div>
                )}
              </>
            )}
          </div>

          {/* 科目 */}
          <div>
            <label className="block text-xs font-medium text-[var(--paragraph)] mb-1">科目</label>
            <select
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
              className={selectClass}
            >
              {subjects.length === 0 ? (
                <option value="">科目が登録されていません</option>
              ) : (
                subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))
              )}
            </select>
          </div>

          {/* 講師・日付・コマ */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[var(--paragraph)] mb-1">講師</label>
              <select
                value={teacherId}
                onChange={(e) => setTeacherId(e.target.value)}
                className={selectClass}
              >
                {teachers.length === 0 ? (
                  <option value="">講師がいません</option>
                ) : (
                  teachers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.display_name || t.email || '—'}
                    </option>
                  ))
                )}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--paragraph)] mb-1">コマ</label>
              <select
                value={slotId}
                onChange={(e) => setSlotId(e.target.value)}
                className={selectClass}
              >
                {timeSlots.length === 0 ? (
                  <option value="">コマ時間が未設定です</option>
                ) : (
                  timeSlots.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.slot_number}限 {s.start_time?.slice(0, 5)}-{s.end_time?.slice(0, 5)}
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--paragraph)] mb-1">日付</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={selectClass}
            />
          </div>

          {/* Phase R: 追加授業（既存生徒）のみ 指導比率＋45分前後半 */}
          {showRatioUi && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[var(--paragraph)] mb-1">
                  指導比率
                </label>
                <select
                  value={String(ratio)}
                  onChange={(e) => setRatio(e.target.value === '1' ? 1 : 2)}
                  className={selectClass}
                >
                  <option value="2">1対2</option>
                  <option value="1">1対1（1名で満席）</option>
                </select>
              </div>
              {is45 && (
                <div>
                  <label className="block text-xs font-medium text-[var(--paragraph)] mb-1">
                    45分の前後半
                  </label>
                  <select
                    value={halfPosition ?? 'first'}
                    onChange={(e) => setHalfPosition(e.target.value as HalfPosition)}
                    className={selectClass}
                  >
                    <option value="first">前半（コマ開始〜+45分）</option>
                    <option value="second">後半（コマ終了−45分〜終了）</option>
                  </select>
                </div>
              )}
            </div>
          )}

          {errorMsg && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
              <div className="font-medium">登録できません</div>
              <div className="mt-1">{errorMsg}</div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            キャンセル
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit || saving}
            className="bg-[#1e3a5f] hover:bg-[#2a4a6f]"
          >
            {saving ? '追加中...' : '追加する'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
