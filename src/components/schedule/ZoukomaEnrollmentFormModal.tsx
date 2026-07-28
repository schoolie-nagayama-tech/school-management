'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Button,
} from '@/components/ui';
import { StudentSearchInput, type StudentWithSubjects } from './StudentSearchInput';
import { SubjectInput } from '@/components/forms/zoukoma/SubjectInput';
import { SlotTable, generateAllSlots } from '@/components/forms/zoukoma/SlotTable';
import {
  createFormResponse,
  updateFormResponse,
  linkResponseToStudent,
} from '@/lib/api/form-responses';
import type { FormResponseInsert } from '@/types/database';
import type { ZoukomaPeriod, ZoukomaResponse, ZoukomaResponseData } from '@/types/forms/zoukoma';
import { formatGradeLabel } from '@/lib/utils/gradeLabel';

interface Props {
  open: boolean;
  onClose: () => void;
  schoolId: string;
  period: ZoukomaPeriod;
  /** 新規追加時、既に申込済みの生徒ID（重複防止） */
  existingStudentIds: string[];
  /** 編集対象（指定時は生徒固定＋既存値を事前入力） */
  editing?: ZoukomaResponse | null;
  onSaved: () => void;
}

/**
 * 管理者が生徒ごとに増コマ（テスト対策）申込を手動登録/編集するモーダル。
 * 入力＝科目×コマ数（SubjectInput）＋通塾できる枠（SlotTable, available モード）。
 * 保存＝linked_student_id 付きの form_response（form_type='zoukoma'）を作成/更新する
 * （= フォーム回答の手動代行。座席表の配置パネルはこの回答を読む）。
 */
export function ZoukomaEnrollmentFormModal({
  open,
  onClose,
  schoolId,
  period,
  existingStudentIds,
  editing,
  onSaved,
}: Props) {
  const isEdit = !!editing;
  const settings = useMemo(() => period.settings ?? {}, [period.settings]);
  const subjectList = useMemo(
    () => settings.subjects ?? ['英語', '数学', '国語', '理科', '社会'],
    [settings]
  );

  const [selectedStudent, setSelectedStudent] = useState<StudentWithSubjects | null>(null);
  const [subjectValues, setSubjectValues] = useState<Record<string, number>>({});
  const [selectedSlots, setSelectedSlots] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSelectedStudent(null);
    if (editing) {
      setSubjectValues(editing.response_data?.subjects ?? {});
      setSelectedSlots((editing.response_data?.selected_slots ?? []).map((s) => s.id));
      setNote(editing.response_data?.note ?? '');
    } else {
      setSubjectValues({});
      setSelectedSlots([]);
      setNote('');
    }
  }, [open, editing]);

  // 編集時の表示名/学年（編集は生徒固定）
  const lockedLabel = editing
    ? `${editing.student_name}（${formatGradeLabel(editing.grade)}）`
    : null;

  const totalKoma = Object.values(subjectValues).reduce((s, n) => s + (Number(n) || 0), 0);

  const handleSubmit = async () => {
    const studentId = editing?.linked_student_id ?? selectedStudent?.id;
    const studentName = editing
      ? editing.student_name
      : selectedStudent
        ? `${selectedStudent.last_name} ${selectedStudent.first_name}`
        : '';
    const grade = editing ? editing.grade : (selectedStudent?.grade ?? 0);

    if (!studentId) {
      setError('生徒を選択してください');
      return;
    }
    if (totalKoma <= 0) {
      setError('いずれかの科目に1コマ以上を入力してください');
      return;
    }

    // 単価：price_table を学年ラベル（中1 等）で引く。無ければ0（請求は別途）。
    const unitPrice = settings.price_table?.[formatGradeLabel(grade)] ?? 0;
    // 通塾できる枠：選択した slotId を generateAllSlots のラベル付きに変換
    const allSlots = generateAllSlots(settings);
    const slotById = new Map(allSlots.map((s) => [s.id, s.label]));
    const selected_slots = selectedSlots.map((id) => ({ id, label: slotById.get(id) ?? id }));
    // コマ数0の科目は落とす
    const subjects: Record<string, number> = {};
    for (const [name, n] of Object.entries(subjectValues)) {
      if (Number(n) > 0) subjects[name] = Number(n);
    }

    const response_data: ZoukomaResponseData = {
      subjects,
      total_koma: totalKoma,
      unit_price: unitPrice,
      total_fee: unitPrice * totalKoma,
      selected_slots,
      slot_count: selected_slots.length,
      note: note.trim() || undefined,
    };

    setSaving(true);
    setError(null);
    try {
      if (editing) {
        await updateFormResponse(editing.id, {
          student_name: studentName,
          grade,
          response_data: response_data as unknown as Record<string, unknown>,
        });
      } else {
        const insert: FormResponseInsert = {
          school_id: schoolId,
          form_type: 'zoukoma',
          form_period: period.period_key,
          student_name: studentName,
          grade,
          email: '',
          response_data: response_data as unknown as Record<string, unknown>,
          status_checks: { charged: false, seated: false },
        };
        // 作成後に生徒へ紐付ける（管理者登録は最初から linked_student_id を持たせ、
        // 座席表の落とし込みパネルに即出るようにする）
        const created = await createFormResponse(insert);
        await linkResponseToStudent(created.id, studentId);
      }
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? '増コマ申込を編集' : '増コマ申込を追加'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* 生徒 */}
          {isEdit ? (
            <div>
              <label className="block text-sm font-medium text-[var(--headline)] mb-1">生徒</label>
              <div className="px-3 py-2 bg-gray-50 rounded-md text-sm">{lockedLabel}</div>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-[var(--headline)] mb-1">
                生徒を選択 <span className="text-red-500">*</span>
              </label>
              <StudentSearchInput
                schoolId={schoolId}
                excludeStudentIds={existingStudentIds}
                onSelect={setSelectedStudent}
                placeholder="氏名・かなで検索..."
              />
              {selectedStudent && (
                <div className="mt-2 text-sm text-[var(--headline)] bg-blue-50 px-3 py-2 rounded-md">
                  選択: {selectedStudent.last_name} {selectedStudent.first_name}（
                  {formatGradeLabel(selectedStudent.grade)}）
                </div>
              )}
            </div>
          )}

          {/* 科目×コマ数 */}
          <div>
            <div className="flex items-baseline justify-between mb-1">
              <label className="text-sm font-medium text-[var(--headline)]">科目別コマ数</label>
              <span className="text-xs text-[var(--paragraph)]">合計 {totalKoma} コマ</span>
            </div>
            <SubjectInput
              subjects={subjectList}
              values={subjectValues}
              onChange={(subject, value) =>
                setSubjectValues((prev) => ({ ...prev, [subject]: value }))
              }
            />
          </div>

          {/* 通塾できる枠（増コマフォームの selected_slots）。available モードで直接選ぶ */}
          <div>
            <label className="block text-sm font-medium text-[var(--headline)] mb-1">
              通塾できる枠（座席表の落とし込みに使います）
            </label>
            <SlotTable
              settings={settings}
              selectedSlots={selectedSlots}
              onChange={setSelectedSlots}
              mode="available"
            />
            <p className="text-xs text-[var(--paragraph)] mt-1">選択 {selectedSlots.length} 枠</p>
          </div>

          {/* 備考 */}
          <div>
            <label className="block text-sm font-medium text-[var(--headline)] mb-1">
              備考（任意）
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-[var(--stroke)] rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
            />
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 rounded px-3 py-2">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            キャンセル
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
