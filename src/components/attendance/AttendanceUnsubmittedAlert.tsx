'use client';

import { useState, useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui';
import { useAuth } from '@/contexts/AuthContext';
import { useMasterData } from '@/contexts/MasterDataContext';
import { findAttendanceSheet } from '@/lib/api/attendance';
import { getCurrentYearMonth, getPrevMonth, formatYearMonth } from '@/lib/utils/date';

export function AttendanceUnsubmittedAlert() {
  const { profile, schoolIds } = useAuth();
  const { schools } = useMasterData();
  const [unsubmittedMonth, setUnsubmittedMonth] = useState<string | null>(null);
  const [attendanceLink, setAttendanceLink] = useState<string | null>(null);

  useEffect(() => {
    if (profile?.role !== 'teacher' || schoolIds.length === 0) return;

    const checkUnsubmitted = async () => {
      const prevMonth = getPrevMonth(getCurrentYearMonth());
      const schoolId = schoolIds[0];

      const sheet = await findAttendanceSheet(profile.id, schoolId, prevMonth);
      if (!sheet || sheet.status === 'draft' || sheet.status === 'rejected') {
        setUnsubmittedMonth(prevMonth);
        const school = schools.find((s) => s.id === schoolId);
        if (school?.code) {
          setAttendanceLink(`/attendance/${school.code}/${profile.id}?ym=${prevMonth}`);
        }
        // school.code が未設定の場合は attendanceLink を null のままにする。
        // バナーは表示するがリンクの代わりに案内文を出す（下記参照）。
      }
    };

    checkUnsubmitted();
  }, [profile, schoolIds, schools]);

  if (!unsubmittedMonth) return null;

  return (
    <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 mb-4">
      <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
      <div className="flex-1">
        <p className="text-sm font-semibold text-amber-900">
          {formatYearMonth(unsubmittedMonth)}の出勤簿が未提出です
        </p>
        <p className="text-xs text-amber-800 mt-1">
          月末を過ぎています。確認して提出してください。
        </p>
        {attendanceLink ? (
          <div className="mt-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => window.location.href = attendanceLink}
            >
              出勤簿を開く
            </Button>
          </div>
        ) : (
          /* school.code が未設定の場合はリンクURLを生成できないため、操作案内の代わりに管理者への連絡を促す */
          <p className="text-xs text-amber-700 mt-2">
            教室コードが未設定のため出勤簿を開けません。教室長にご連絡ください。
          </p>
        )}
      </div>
    </div>
  );
}
