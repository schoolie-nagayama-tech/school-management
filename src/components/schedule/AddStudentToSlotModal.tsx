'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui';
import { Button } from '@/components/ui';
import { StudentSearchInput, type StudentWithSubjects } from './StudentSearchInput';
import {
  createRegularPattern,
  createScheduleEntry,
  checkStudentTimeConflict,
  regenerateWeekForDate,
} from '@/lib/api/schedule';
import {
  getStudentContractRatioMap,
  upsertStudentContract,
} from '@/lib/api/student-subject-contracts';
import type { ScheduleTimeSlot, HalfPosition } from '@/types/schedule';
import type { ScheduleEntryFormData, ScheduleEntryKind } from '@/types/schedule';
import type { Subject } from '@/types/database';
import { DAY_OF_WEEK_LABELS } from '@/types/schedule';
import { groupSubjectsForSelect, subjectOptionLabel } from '@/lib/utils/subjectOptions';

/**
 * 「この日のみ追加」で選べる授業種別。
 * regular=臨時/振替の単発、それ以外は追加授業（テスト対策/追加授業/体験）。
 * いずれも通塾日程を持たない単発コマ（regular_pattern_id=NULL）として登録する。
 */
// テスト対策は「テスト対策モード（増コマ申込の落とし込み）」に一本化したため、
// ここ（空きセルからの単発追加）には出さない（二重経路の解消）。
const SINGLE_KIND_OPTIONS: { value: ScheduleEntryKind; label: string }[] = [
  { value: 'additional', label: '追加授業' },
  { value: 'trial', label: '体験授業' },
  { value: 'regular', label: '通常（臨時・振替）' },
];

export interface AddStudentToSlotModalProps {
  isOpen: boolean;
  onClose: () => void;
  date: string;
  dayOfWeek: number;
  timeSlot: ScheduleTimeSlot;
  teacherId: string;
  teacherName: string;
  schoolId: string;
  subjects: Subject[];
  /** 講師の指導可能科目ID。空 or null = 指導可能科目なし */
  teacherTeachableSubjectIds?: string[] | null;
  onSuccess: () => void;
}

type RegisterType = 'regular' | 'single';

export function AddStudentToSlotModal({
  isOpen,
  onClose,
  date,
  dayOfWeek,
  timeSlot,
  teacherId,
  teacherName,
  schoolId,
  subjects,
  teacherTeachableSubjectIds,
  onSuccess,
}: AddStudentToSlotModalProps) {
  const { profile } = useAuth();
  const [selectedStudent, setSelectedStudent] = useState<StudentWithSubjects | null>(null);
  const [subjectId, setSubjectId] = useState<string>('');
  const [registerType, setRegisterType] = useState<RegisterType>('regular');
  // 「この日のみ追加」のときの授業種別（追加授業/テスト対策/体験/臨時）
  const [singleKind, setSingleKind] = useState<ScheduleEntryKind>('additional');
  const [saving, setSaving] = useState(false);
  const [conflictError, setConflictError] = useState<string | null>(null);
  // Phase R: 指導比率（1対1/1対2）と45分の前後半。
  const [ratio, setRatio] = useState<1 | 2>(2);
  const [halfPosition, setHalfPosition] = useState<HalfPosition>(null);
  // 生徒×科目の契約比率マップ（科目選択時の ratio 初期値）。
  const [contractRatioMap, setContractRatioMap] = useState<Map<string, 1 | 2>>(new Map());

  // 選択科目の授業時間（45分なら前後半セレクトを出す）。
  const selectedSubject = subjects.find((s) => s.id === subjectId);
  const is45 = selectedSubject?.duration_minutes === 45;

  const availableSubjects = useMemo(() => {
    if (!teacherTeachableSubjectIds || teacherTeachableSubjectIds.length === 0) {
      return []; // 空 or null = 指導可能科目なし（すべてなし）
    }
    return subjects.filter((s) => teacherTeachableSubjectIds.includes(s.id));
  }, [subjects, teacherTeachableSubjectIds]);

  useEffect(() => {
    if (isOpen) {
      setSelectedStudent(null);
      setSubjectId(availableSubjects[0]?.id ?? '');
      setRegisterType('regular');
      setSingleKind('additional');
      setConflictError(null);
      setRatio(2);
      setHalfPosition(null);
      setContractRatioMap(new Map());
    }
  }, [isOpen, availableSubjects]);

  // Phase R: 生徒選択時に契約比率マップを読み込む（科目選択時の ratio 初期値に使う）。
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

  // Phase R: 科目が変わったら ratio は契約から初期化、half は45分科目なら前半を既定に。
  useEffect(() => {
    setRatio(contractRatioMap.get(subjectId) ?? 2);
    setHalfPosition(selectedSubject?.duration_minutes === 45 ? 'first' : null);
  }, [subjectId, contractRatioMap, selectedSubject?.duration_minutes]);

  const slotLabel = `${DAY_OF_WEEK_LABELS[dayOfWeek] ?? ''}曜日 ${timeSlot.slot_number}限 ${timeSlot.start_time?.slice(0, 5) ?? ''}-${timeSlot.end_time?.slice(0, 5) ?? ''}`;

  const handleSubmit = async () => {
    if (!selectedStudent || !subjectId || !schoolId) return;
    setConflictError(null);
    setSaving(true);
    try {
      const startTime = timeSlot.start_time ?? '00:00:00';
      const endTime = timeSlot.end_time ?? '23:59:59';
      // Phase R: 45分科目のみ半コマ、それ以外は全コマ(null)。duration は科目からスナップショット。
      const effHalf: HalfPosition = is45 ? halfPosition : null;
      const effDuration = selectedSubject?.duration_minutes ?? null;
      const form: ScheduleEntryFormData = {
        teacher_id: teacherId,
        student_id: selectedStudent.id,
        subject_ids: [subjectId],
        seat_label: '',
        note: '',
        ratio,
        duration_minutes: effDuration,
        half_position: effHalf,
      };

      if (registerType === 'regular') {
        const conflict = await checkStudentTimeConflict(
          selectedStudent.id,
          dayOfWeek,
          startTime,
          endTime,
          { durationMinutes: effDuration, halfPosition: effHalf }
        );
        if (conflict) {
          setConflictError(conflict.message);
          setSaving(false);
          return;
        }
        // 契約=正の設計。通常授業として登録するときは選んだ比率を契約にも反映（upsert）。
        await upsertStudentContract(schoolId, selectedStudent.id, subjectId, ratio);
        const pattern = await createRegularPattern(schoolId, {
          student_id: selectedStudent.id,
          day_of_week: dayOfWeek,
          time_slot_id: timeSlot.id,
          teacher_id: teacherId,
          subject_ids: [subjectId],
          seat_label: '',
          period_type: 'regular',
          ratio,
          duration_minutes: effDuration,
          half_position: effHalf,
        });
        await createScheduleEntry(schoolId, date, timeSlot.id, form, {
          regular_pattern_id: pattern.id,
          status: 'scheduled',
        });
        await regenerateWeekForDate(schoolId, date, profile?.id);
      } else {
        const conflict = await checkStudentTimeConflict(
          selectedStudent.id,
          dayOfWeek,
          startTime,
          endTime,
          { specificDate: date, durationMinutes: effDuration, halfPosition: effHalf }
        );
        if (conflict) {
          setConflictError(conflict.message);
          setSaving(false);
          return;
        }
        // 単発コマは選んだ種別（追加授業/テスト対策/体験/臨時）で登録する。
        // regular 以外は週次再生成で削除されない（追加授業として保護される）。
        await createScheduleEntry(
          schoolId,
          date,
          timeSlot.id,
          { ...form, kind: singleKind },
          { regular_pattern_id: null, status: 'scheduled' }
        );
      }
      onSuccess();
      onClose();
    } catch (e) {
      setConflictError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const canSubmit = selectedStudent && subjectId && schoolId;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md bg-white border border-gray-200">
        <DialogHeader>
          <DialogTitle>生徒を追加</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="text-sm text-[var(--paragraph)]">
            <div>追加先: {slotLabel}</div>
            <div>講師: {teacherName}</div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--paragraph)] mb-1">
              生徒を検索
            </label>
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
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--paragraph)] mb-1">科目</label>
            <select
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
              className="w-full px-3 py-2 border border-[var(--stroke)] rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
            >
              {availableSubjects.length === 0 ? (
                <option value="">この講師の指導可能科目が設定されていません</option>
              ) : (
                groupSubjectsForSelect(availableSubjects).map((g) => (
                  <optgroup key={g.label} label={g.label}>
                    {g.subjects.map((s) => (
                      <option key={s.id} value={s.id}>
                        {subjectOptionLabel(s)}
                      </option>
                    ))}
                  </optgroup>
                ))
              )}
            </select>
          </div>

          {/* Phase R: 指導比率（契約から初期化・変更可）＋45分科目の前後半 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[var(--paragraph)] mb-1">
                指導比率
              </label>
              <select
                value={String(ratio)}
                onChange={(e) => setRatio(e.target.value === '1' ? 1 : 2)}
                className="w-full px-3 py-2 border border-[var(--stroke)] rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
              >
                <option value="2">1対2</option>
                <option value="1">1対1（1名で満席）</option>
              </select>
              <p className="mt-1 text-[10px] text-[var(--paragraph-light)]">
                契約（生徒×科目）の比率。変更すると契約も更新されます
              </p>
            </div>
            {is45 && (
              <div>
                <label className="block text-xs font-medium text-[var(--paragraph)] mb-1">
                  45分の前後半
                </label>
                <select
                  value={halfPosition ?? 'first'}
                  onChange={(e) => setHalfPosition(e.target.value as HalfPosition)}
                  className="w-full px-3 py-2 border border-[var(--stroke)] rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                >
                  <option value="first">前半（コマ開始〜+45分）</option>
                  <option value="second">後半（コマ終了−45分〜終了）</option>
                </select>
                <p className="mt-1 text-[10px] text-[var(--paragraph-light)]">
                  45分授業。同じ席の反対側にもう1人入れられます
                </p>
              </div>
            )}
          </div>

          <div>
            <div className="text-xs font-medium text-[var(--paragraph)] mb-2">登録タイプ</div>
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="registerType"
                  checked={registerType === 'regular'}
                  onChange={() => setRegisterType('regular')}
                  className="text-[#1e3a5f]"
                />
                <span className="text-sm">通常授業として登録（毎週この曜日・コマに入る）</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="registerType"
                  checked={registerType === 'single'}
                  onChange={() => setRegisterType('single')}
                  className="text-[#1e3a5f]"
                />
                <span className="text-sm">この日のみ追加（追加授業・テスト対策・体験など）</span>
              </label>
            </div>

            {/* この日のみ追加のとき、授業種別を選ぶ。座席表では種別バッジで区別表示される */}
            {registerType === 'single' && (
              <div className="mt-2 pl-6">
                <label className="block text-xs font-medium text-[var(--paragraph)] mb-1">
                  種別
                </label>
                <select
                  value={singleKind}
                  onChange={(e) => setSingleKind(e.target.value as ScheduleEntryKind)}
                  className="w-full px-3 py-2 border border-[var(--stroke)] rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                >
                  {SINGLE_KIND_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {conflictError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
              <div className="font-medium">時間が重複しています</div>
              <div className="mt-1">{conflictError}</div>
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
