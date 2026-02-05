'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { AdminLayout } from '@/components/layouts';
import { Button, ToastContainer } from '@/components/ui';
import {
  getClassPeriods,
  setClassPeriods,
  formatPeriodsToText,
  parsePeriodsText,
} from '@/lib/api/class-periods';
import { useToast } from '@/hooks/useToast';
import { useAuth } from '@/contexts/AuthContext';
import { useRequirePermission } from '@/hooks/usePermissions';
import AccessDenied from '@/components/AccessDenied';

export default function ClassPeriodsSettingsPage() {
  const { getSelectedSchoolIds } = useAuth();
  const { hasPermission, isLoading: permissionLoading } = useRequirePermission(
    (p) => p.canAccessSettings
  );
  const { toasts, removeToast, success, error } = useToast();

  const schoolId = getSelectedSchoolIds()[0] ?? '';
  const [periodsText, setPeriodsText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    if (schoolId && typeof window !== 'undefined') {
      const periods = getClassPeriods(schoolId);
      setPeriodsText(formatPeriodsToText(periods));
      setIsDirty(false);
    }
  }, [schoolId]);

  const handleChange = (value: string) => {
    setPeriodsText(value);
    setIsDirty(true);
  };

  const handleSave = () => {
    if (!schoolId) {
      error('教室を選択してください');
      return;
    }
    const periods = parsePeriodsText(periodsText);
    if (periods.length === 0) {
      error('1件以上の時限を入力してください（1行に「コード,ラベル」形式）');
      return;
    }
    setIsSubmitting(true);
    try {
      setClassPeriods(schoolId, periods);
      setIsDirty(false);
      success('授業の時間帯を保存しました');
    } catch (err) {
      console.error('Failed to save class periods:', err);
      error('保存に失敗しました');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetToDefault = () => {
    const defaultPeriods = getClassPeriods(undefined);
    setPeriodsText(formatPeriodsToText(defaultPeriods));
    setIsDirty(true);
  };

  if (permissionLoading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <p className="text-[#4b5563]">読み込み中...</p>
        </div>
      </AdminLayout>
    );
  }

  if (!hasPermission) {
    return (
      <AdminLayout>
        <AccessDenied message="設定ページは教室長以上のみアクセス可能です" />
      </AdminLayout>
    );
  }

  return (
    <div>
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <AdminLayout headerTitle="授業の時間帯">
        <div className="max-w-2xl">
          <div className="mb-4">
            <Link
              href="/settings/portal"
              className="text-sm text-[#3b82f6] hover:underline"
            >
              ← フォーム設定に戻る
            </Link>
          </div>

          <div className="bg-white rounded-xl border border-[#e5e7eb] p-6">
            <h2 className="text-lg font-bold text-[#1f2937] mb-2">
              授業の時間帯（共通設定）
            </h2>
            <p className="text-sm text-[#4b5563] mb-4">
              週回数変更・曜日変更などのフォームで利用する時限の一覧です。ここで設定した内容が、各フォームの期間設定で「時限」の初期値として使われます。1行に「コード,ラベル」の形式で入力してください。
            </p>

            <div className="mb-4">
              <label className="block text-sm font-medium text-[#1f2937] mb-2">
                時限一覧 <span className="text-red-500">*</span>
              </label>
              <textarea
                value={periodsText}
                onChange={(e) => handleChange(e.target.value)}
                placeholder="4,4限(14:25-15:55)&#10;5,5限(16:20-17:50)&#10;6,6限(18:00-19:30)&#10;7,7限(19:40-21:10)"
                rows={8}
                className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-[#3b82f6]"
              />
              <p className="text-xs text-[#4b5563]/60 mt-1">
                例: 4,4限(14:25-15:55) のように「コード,ラベル」の形式で1行に1時限ずつ
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button
                onClick={handleSave}
                disabled={isSubmitting || !isDirty}
              >
                {isSubmitting ? '保存中...' : '保存する'}
              </Button>
              <Button
                variant="secondary"
                onClick={handleResetToDefault}
                disabled={isSubmitting}
              >
                デフォルトに戻す
              </Button>
            </div>
          </div>
        </div>
      </AdminLayout>
    </div>
  );
}
