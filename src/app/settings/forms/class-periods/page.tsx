'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { AdminLayout } from '@/components/layouts';
import { Button, ToastContainer, Loading } from '@/components/ui';
import {
  getClassPeriodsAsync,
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
    if (schoolId) {
      getClassPeriodsAsync(schoolId).then((periods) => {
        setPeriodsText(formatPeriodsToText(periods));
        setIsDirty(false);
      });
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

  const handleResetToDefault = async () => {
    // localStorage キャッシュを消してマスタから再取得
    if (schoolId && typeof window !== 'undefined') {
      window.localStorage.removeItem(`class_periods_${schoolId}`);
    }
    const periods = await getClassPeriodsAsync(schoolId);
    setPeriodsText(formatPeriodsToText(periods));
    setIsDirty(true);
  };

  if (permissionLoading) {
    return (
      <AdminLayout>
        <Loading size="md" />
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
              className="text-sm text-info hover:underline"
            >
              ← フォーム設定に戻る
            </Link>
          </div>

          <div className="bg-surface-raised rounded-xl border border-border p-6">
            <h2 className="text-lg font-bold text-text-heading mb-2">
              授業の時間帯（共通設定）
            </h2>
            <p className="text-sm text-text-body mb-4">
              週回数変更・曜日変更などのフォームで利用する時限の一覧です。ここで設定した内容が、各フォームの期間設定で「時限」の初期値として使われます。1行に「コード,ラベル」の形式で入力してください。
            </p>

            <div className="mb-4">
              <label className="block text-sm font-medium text-text-heading mb-2">
                時限一覧 <span className="text-red-500">*</span>
              </label>
              <textarea
                value={periodsText}
                onChange={(e) => handleChange(e.target.value)}
                placeholder="4,4限(14:25-15:55)&#10;5,5限(16:20-17:50)&#10;6,6限(18:00-19:30)&#10;7,7限(19:40-21:10)"
                rows={8}
                className="w-full px-3 py-2 border border-border rounded-lg text-sm font-mono resize-y focus:outline-none focus:ring-primary focus:ring-primary"
              />
              <p className="text-xs text-text-body/60 mt-1">
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
