'use client';

import { useEffect, useMemo, useState } from 'react';
import { Modal, Button, Textarea } from '@/components/ui';
import { getSchools } from '@/lib/api/schools';
import { bulkMoveStudentsToSchool } from '@/lib/api/students';
import { useAuth } from '@/contexts/AuthContext';
import type { School } from '@/types/database';
import { getDefaultSchoolId } from '@/lib/api/schools';

type Step = 'form' | 'moving' | 'done';

export function BulkMoveStudentsModal({
  isOpen,
  onClose,
  defaultToSchoolId,
  onMoved,
}: {
  isOpen: boolean;
  onClose: () => void;
  /** 移動先の初期値（例: 現在選択中の教室） */
  defaultToSchoolId?: string;
  /** 移動完了後に一覧を再取得する等 */
  onMoved?: () => void;
}) {
  const { schoolIds } = useAuth();
  const [schools, setSchools] = useState<School[]>([]);
  const [isLoadingSchools, setIsLoadingSchools] = useState(false);
  const [step, setStep] = useState<Step>('form');

  const [fromSchoolId, setFromSchoolId] = useState<string>('');
  const [toSchoolId, setToSchoolId] = useState<string>('');
  const [studentCodesText, setStudentCodesText] = useState('');
  const [confirmMoveAll, setConfirmMoveAll] = useState(false);

  const [error, setError] = useState<string>('');
  const [result, setResult] = useState<{
    movedStudents: number;
    updatedStudentLogs: number;
    updatedInterviews: number;
    updatedAssessments: number;
    updatedSchedulePatterns: number;
    updatedScheduleEntries: number;
  } | null>(null);

  // 初期化
  useEffect(() => {
    if (!isOpen) return;
    setStep('form');
    setError('');
    setResult(null);
    setStudentCodesText('');
    setConfirmMoveAll(false);

    // 既存不具合の救済として、移動元はデフォルト教室を初期値に
    let defaultFrom = '';
    try {
      defaultFrom = getDefaultSchoolId();
    } catch {
      defaultFrom = '';
    }
    setFromSchoolId(defaultFrom);
    setToSchoolId(defaultToSchoolId ?? '');
  }, [isOpen, defaultToSchoolId]);

  // 教室一覧ロード（担当教室のみ）
  useEffect(() => {
    if (!isOpen) return;
    let mounted = true;
    const load = async () => {
      setIsLoadingSchools(true);
      try {
        const all = await getSchools();
        const filtered = all.filter((s) => schoolIds.includes(s.id));
        if (mounted) setSchools(filtered);
      } catch (e) {
        console.error('Error loading schools:', e);
        if (mounted) setSchools([]);
      } finally {
        if (mounted) setIsLoadingSchools(false);
      }
    };
    if (schoolIds.length > 0) load();
    return () => {
      mounted = false;
    };
  }, [isOpen, schoolIds]);

  const studentCodes = useMemo(() => {
    const raw = studentCodesText
      .split(/[\n,、\t ]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    return Array.from(new Set(raw));
  }, [studentCodesText]);

  const canSubmit =
    step === 'form' &&
    !isLoadingSchools &&
    !!fromSchoolId &&
    !!toSchoolId &&
    fromSchoolId !== toSchoolId &&
    (studentCodes.length > 0 || confirmMoveAll);

  const handleMove = async () => {
    if (!canSubmit) return;
    setStep('moving');
    setError('');
    setResult(null);
    try {
      const res = await bulkMoveStudentsToSchool({
        fromSchoolId,
        toSchoolId,
        studentCodes: studentCodes.length > 0 ? studentCodes : undefined,
      });
      setResult(res);
      setStep('done');
      onMoved?.();
    } catch (e) {
      console.error('Error moving students:', e);
      setError(e instanceof Error ? e.message : '移動に失敗しました');
      setStep('form');
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="生徒の教室移動（一括）" size="lg">
      <div className="space-y-4">
        <p className="text-sm text-[#4b5563]">
          生徒の <span className="font-medium text-[#1f2937]">所属教室（school_id）</span>{' '}
          をまとめて変更します。 既に誤った教室（例:
          デフォルト）に登録されてしまった生徒を、正しい教室へ移す用途を想定しています。
        </p>

        {/* 教室選択 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-[#1f2937] mb-1">移動元の教室</label>
            <select
              value={fromSchoolId}
              onChange={(e) => setFromSchoolId(e.target.value)}
              disabled={isLoadingSchools || step !== 'form'}
              className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm bg-white text-[#4b5563] focus:ring-2 focus:ring-[#3b82f6] focus:border-[#3b82f6]"
            >
              <option value="">選択してください</option>
              {schools.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code === 'DEFAULT' ? `デフォルト` : s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-[#1f2937] mb-1">移動先の教室</label>
            <select
              value={toSchoolId}
              onChange={(e) => setToSchoolId(e.target.value)}
              disabled={isLoadingSchools || step !== 'form'}
              className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm bg-white text-[#4b5563] focus:ring-2 focus:ring-[#3b82f6] focus:border-[#3b82f6]"
            >
              <option value="">選択してください</option>
              {schools.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code === 'DEFAULT' ? `デフォルト` : s.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* 対象生徒 */}
        <div>
          <label className="block text-sm font-medium text-[#1f2937] mb-1">
            対象の生徒コード（任意）
          </label>
          <Textarea
            value={studentCodesText}
            onChange={(e) => setStudentCodesText(e.target.value)}
            placeholder={'生徒コードを貼り付け（改行/カンマ区切り）\n例)\nA001\nA002\nA003'}
            rows={6}
            disabled={step !== 'form'}
            className="w-full"
          />
          <div className="mt-2 flex items-start gap-2">
            <input
              id="moveAll"
              type="checkbox"
              checked={confirmMoveAll}
              onChange={(e) => setConfirmMoveAll(e.target.checked)}
              disabled={step !== 'form' || studentCodes.length > 0}
              className="w-4 h-4 mt-0.5"
            />
            <label htmlFor="moveAll" className="text-sm text-[#4b5563]">
              生徒コードを空にした場合、移動元教室の生徒を{' '}
              <span className="font-medium text-[#1f2937]">全員移動</span> することに同意します
              （コード入力時はこのチェックは不要です）
            </label>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            入力した場合は、その生徒コードに一致する生徒だけを移動します（移動元教室に存在するもののみ対象）。
          </p>
        </div>

        {fromSchoolId && toSchoolId && fromSchoolId === toSchoolId && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <p className="text-sm text-amber-800">移動元と移動先が同じです。</p>
          </div>
        )}

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-[#c62828]">{error}</p>
          </div>
        )}

        {step === 'done' && result && (
          <div className="p-3 bg-green-50 border border-green-200 rounded-lg space-y-1">
            <p className="text-sm font-medium text-green-800">移動が完了しました。</p>
            <p className="text-xs text-green-800">students: {result.movedStudents} 件</p>
            <p className="text-xs text-green-800">student_logs: {result.updatedStudentLogs} 件</p>
            <p className="text-xs text-green-800">
              student_interviews: {result.updatedInterviews} 件
            </p>
            <p className="text-xs text-green-800">assessments: {result.updatedAssessments} 件</p>
            <p className="text-xs text-green-800">
              schedule_regular_patterns: {result.updatedSchedulePatterns} 件
            </p>
            <p className="text-xs text-green-800">
              schedule_entries: {result.updatedScheduleEntries} 件
            </p>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={step === 'moving'}>
            閉じる
          </Button>
          {step !== 'done' && (
            <Button onClick={handleMove} disabled={!canSubmit}>
              {step === 'moving' ? '移動中...' : '移動する'}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
