'use client';

import { useState, useEffect, useCallback } from 'react';
import { Modal, InlineLoading } from '@/components/ui';
import { YoubiForm } from './YoubiForm';
import type { YoubiProxyStudent } from './YoubiForm';
import { getYoubiPeriodByKey } from '@/lib/api/youbi';
import { getSchool } from '@/lib/api/schools';
import { getStudents } from '@/lib/api/students';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';
import type { School } from '@/types/database';
import type { YoubiPeriod } from '@/types/forms/youbi';

interface YoubiProxyApplyModalProps {
  isOpen: boolean;
  schoolId: string;
  periodKey: string;
  /** バナーに出す申込者の表示名（ログイン中の教室長） */
  submitterLabel: string;
  onClose: () => void;
  /** 送信できたとき（一覧を取り直す） */
  onSubmitted: () => void;
}

/**
 * 教室長が保護者の代わりに曜日変更を申し込むモーダル。
 *
 * ★ フォームの中身は保護者用の YoubiForm をそのまま使う。別フォームを作ると、
 *   時限マスタ・科目設定を変えたときに片方だけ古くなる。
 *   変えるのは入口（回答一覧から開く）と記録（誰が出したか）だけ。
 */
export function YoubiProxyApplyModal({
  isOpen,
  schoolId,
  periodKey,
  submitterLabel,
  onClose,
  onSubmitted,
}: YoubiProxyApplyModalProps) {
  const [school, setSchool] = useState<School | null>(null);
  const [period, setPeriod] = useState<YoubiPeriod | null>(null);
  const [students, setStudents] = useState<YoubiProxyStudent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage('');
    try {
      const [schoolData, periodData, studentsData] = await Promise.all([
        getSchool(schoolId),
        getYoubiPeriodByKey(schoolId, periodKey),
        getStudents(undefined, [schoolId]),
      ]);
      if (!schoolData) {
        setErrorMessage('教室が見つかりません');
        return;
      }
      if (!periodData) {
        setErrorMessage('この受付期間が見つかりません');
        return;
      }
      setSchool(schoolData);
      setPeriod(periodData);
      setStudents(
        studentsData
          .filter((s) => s.status === 'active')
          .map((s) => ({
            id: s.id,
            last_name: s.last_name,
            first_name: s.first_name,
            grade: s.grade,
          }))
      );
    } catch (err) {
      console.error('Error loading proxy apply data:', err);
      setErrorMessage(getUserErrorMessage(err, 'フォームの読み込みに失敗しました'));
    } finally {
      setIsLoading(false);
    }
  }, [schoolId, periodKey]);

  useEffect(() => {
    if (isOpen) {
      fetchData();
    } else {
      // 閉じたら状態を捨てる。開き直したときに前回の入力が残っていると、
      // 別の生徒の申込に前の内容が混ざる。
      setSchool(null);
      setPeriod(null);
      setStudents([]);
      setErrorMessage('');
    }
  }, [isOpen, fetchData]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="代理で申し込む — 曜日変更">
      {isLoading ? (
        <div className="py-8">
          <InlineLoading />
        </div>
      ) : errorMessage ? (
        <div className="bg-[#ef4444]/20 text-[#ef4444] px-4 py-2 rounded border border-[#ef4444] text-sm">
          {errorMessage}
        </div>
      ) : school && period ? (
        <YoubiForm
          school={school}
          period={period}
          proxy={{
            students,
            submitterLabel,
            onSubmitted,
            onCancel: onClose,
          }}
        />
      ) : null}
    </Modal>
  );
}
