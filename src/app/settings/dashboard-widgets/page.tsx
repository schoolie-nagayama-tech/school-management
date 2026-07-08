'use client';

import { useEffect, useState, useCallback } from 'react';
import { AdminLayout } from '@/components/layouts';
import { Button, Card, CardHeader, CardTitle, CardContent, ToastContainer, Loading } from '@/components/ui';
import Link from 'next/link';
import { useToast } from '@/hooks/useToast';
import { useRequirePermission } from '@/hooks/usePermissions';
import AccessDenied from '@/components/AccessDenied';
import { useLocalSchoolId } from '@/hooks/useLocalSchoolId';
import { SchoolSwitcher } from '@/components/SchoolSwitcher';
import {
  WIDGET_KEY_LABELS,
  WIDGET_KEY_DESCRIPTIONS,
  type WidgetKey,
  getWidgetSettings,
  upsertWidgetSetting,
} from '@/lib/api/widgetSettings';
import { ChevronLeft, Save } from 'lucide-react';

const WIDGET_KEYS: WidgetKey[] = ['course_progress_summary'];

export default function DashboardWidgetsSettingsPage() {
  const { hasPermission, isLoading: permissionLoading } = useRequirePermission(
    (p) => p.canAccessSettings
  );
  const { localSchoolId, setLocalSchoolId, isAllSelected, availableSchools } = useLocalSchoolId();
  const { toasts, removeToast, success, error: toastError } = useToast();
  const [settings, setSettings] = useState<Record<WidgetKey, boolean> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const fetchSettings = useCallback(async () => {
    if (!localSchoolId) return;
    setIsLoading(true);
    try {
      const data = await getWidgetSettings(localSchoolId);
      setSettings(data);
    } catch (e) {
      console.error(e);
      toastError('表示設定の取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [localSchoolId, toastError]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const saveAll = async () => {
    if (!localSchoolId || !settings) return;
    setIsSaving(true);
    try {
      await Promise.all(
        WIDGET_KEYS.map((key) => upsertWidgetSetting(localSchoolId, key, settings[key]))
      );
      success('保存しました');
    } catch (e) {
      console.error(e);
      toastError('保存に失敗しました');
    } finally {
      setIsSaving(false);
    }
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
        <AccessDenied />
      </AdminLayout>
    );
  }

  return (
    <AdminLayout headerTitle="ダッシュボード表示設定">
      <div className="space-y-6">
        <Link
          href="/settings"
          className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 transition-colors duration-150"
        >
          <ChevronLeft className="w-4 h-4 mr-1" />
          設定一覧に戻る
        </Link>

        {isAllSelected && (
          <SchoolSwitcher
            schools={availableSchools}
            selectedSchoolId={localSchoolId}
            onChange={setLocalSchoolId}
          />
        )}

        <Card>
          <CardHeader>
            <CardTitle>ダッシュボード表示設定</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-gray-600">
              生徒管理ページなどに表示するウィジェットの表示/非表示を教室単位で設定できます。
            </p>
            <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
              <Button onClick={saveAll} disabled={isSaving || isLoading || !settings}>
                <Save className="w-4 h-4 mr-1" />
                {isSaving ? '保存中...' : '保存'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {isLoading || !settings ? (
          <Loading size="md" />
        ) : (
          WIDGET_KEYS.map((key) => (
            <Card key={key}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{WIDGET_KEY_LABELS[key]}</CardTitle>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={settings[key]}
                      onChange={(e) =>
                        setSettings((prev) => (prev ? { ...prev, [key]: e.target.checked } : prev))
                      }
                      className="w-4 h-4"
                    />
                    <span className={settings[key] ? 'text-gray-900' : 'text-gray-400'}>
                      {settings[key] ? '表示' : '非表示'}
                    </span>
                  </label>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-gray-500">{WIDGET_KEY_DESCRIPTIONS[key]}</p>
              </CardContent>
            </Card>
          ))
        )}
      </div>
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </AdminLayout>
  );
}
