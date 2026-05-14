'use client';

import { useEffect, useState, useCallback } from 'react';
import { AdminLayout } from '@/components/layouts';
import { Button, Card, CardHeader, CardTitle, CardContent, Input, ToastContainer, Loading } from '@/components/ui';
import Link from 'next/link';
import { useToast } from '@/hooks/useToast';
import { useConfirm } from '@/hooks/useConfirm';
import { useRequirePermission } from '@/hooks/usePermissions';
import AccessDenied from '@/components/AccessDenied';
import { useLocalSchoolId } from '@/hooks/useLocalSchoolId';
import { SchoolSwitcher } from '@/components/SchoolSwitcher';
import {
  ALERT_TYPE_LABELS,
  type AlertSetting,
  type AlertThresholds,
  type AlertType,
  DEFAULT_ALERT_THRESHOLDS,
} from '@/types/alerts';
import { getAlertSettings, upsertAlertSetting, resetAlertSettings } from '@/lib/api/alertSettings';
import { ChevronLeft, RotateCcw, Save } from 'lucide-react';

interface FieldDef {
  key: keyof AlertThresholds;
  label: string;
  unit: string;
  min?: number;
  max?: number;
}

const FIELDS_BY_TYPE: Partial<Record<AlertType, FieldDef[]>> = {
  score_drop: [
    { key: 'score_drop_regular', label: '定期テスト：何点下落で発火', unit: '点', min: 1, max: 100 },
    { key: 'score_drop_mock', label: '模試：偏差値何ポイント下落で発火', unit: 'pt', min: 1, max: 30 },
    { key: 'score_drop_report', label: '通知表：何段階下落で発火', unit: '段階', min: 1, max: 5 },
    { key: 'trend_window_months', label: '長期トレンド判定期間', unit: '月', min: 1, max: 24 },
  ],
  score_missing: [],
  interview_overdue: [
    { key: 'interview_overdue_days', label: '最終面談から何日経過で発火', unit: '日', min: 1, max: 365 },
  ],
  application_overdue: [
    { key: 'application_warn_days', label: '何日前から表示', unit: '日', min: 0, max: 60 },
    { key: 'application_alert_days', label: '何日前から警告', unit: '日', min: 0, max: 30 },
  ],
  interview_task: [],
  exam_overdue: [
    { key: 'exam_overdue_days', label: 'テスト日から何日経過で発火', unit: '日', min: 0, max: 30 },
  ],
  homework_not_done: [
    { key: 'homework_warn_count', label: '黄色（注意）になる回数', unit: '回', min: 1, max: 10 },
    { key: 'homework_danger_count', label: '赤色（警告）になる回数', unit: '回', min: 1, max: 30 },
  ],
  tardy: [
    { key: 'tardy_warn_count', label: '黄色（注意）になる回数', unit: '回', min: 1, max: 10 },
    { key: 'tardy_danger_count', label: '赤色（警告）になる回数', unit: '回', min: 1, max: 30 },
  ],
};

const ALERT_DESCRIPTIONS: Record<AlertType, string> = {
  score_drop: '前回比でスコアが下落した教科を検出。連続下降や長期下落は強調表示します。',
  score_missing: '最新の評価で空欄の教科を検出。小学生は対象外。入力すると自動で消えます。',
  interview_overdue: '最後の面談から指定日数を超えている生徒を検出。',
  application_overdue: '提出が必要な申込項目で「空欄」のものだけを段階表示。提出すると自動で消えます。',
  interview_task: '面談で起票された未完了タスクを表示。達成すると自動で消えます。',
  exam_overdue: '教材のテスト日が過ぎているのに記録未更新の項目を検出。',
  homework_not_done: '進行表で「宿題未実施」にチェックした回数で段階表示。',
  tardy: '進行表で「遅刻」にチェックした回数で段階表示。',
};

export default function AlertsSettingsPage() {
  const { hasPermission, isLoading: permissionLoading } = useRequirePermission(
    (p) => p.canAccessSettings
  );
  const { localSchoolId, setLocalSchoolId, isAllSelected, availableSchools } = useLocalSchoolId();
  const { toasts, removeToast, success, error: toastError } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const [settings, setSettings] = useState<Record<AlertType, AlertSetting> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const fetchSettings = useCallback(async () => {
    if (!localSchoolId) return;
    setIsLoading(true);
    try {
      const data = await getAlertSettings(localSchoolId);
      const map = {} as Record<AlertType, AlertSetting>;
      for (const s of data) map[s.alert_type] = s;
      setSettings(map);
    } catch (e) {
      console.error(e);
      toastError('アラート設定の取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [localSchoolId, toastError]);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  const updateOne = (type: AlertType, patch: Partial<AlertSetting>) => {
    setSettings((prev) => {
      if (!prev) return prev;
      const cur = prev[type];
      return {
        ...prev,
        [type]: {
          ...cur,
          ...patch,
          thresholds: { ...cur.thresholds, ...(patch.thresholds ?? {}) },
        },
      };
    });
  };

  const saveAll = async () => {
    if (!localSchoolId || !settings) return;
    setIsSaving(true);
    try {
      const types = Object.keys(settings) as AlertType[];
      await Promise.all(
        types.map((t) => upsertAlertSetting(localSchoolId, t, settings[t].enabled, settings[t].thresholds))
      );
      success('保存しました');
    } catch (e) {
      console.error(e);
      toastError('保存に失敗しました');
    } finally {
      setIsSaving(false);
    }
  };

  const resetAll = async () => {
    if (!localSchoolId) return;
    const ok = await confirm({
      title: 'デフォルトに戻す',
      description: 'この教室のすべてのアラート設定をデフォルトに戻します。よろしいですか？',
      confirmLabel: 'デフォルトに戻す',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await resetAlertSettings(localSchoolId);
      success('デフォルトに戻しました');
      await fetchSettings();
    } catch (e) {
      console.error(e);
      toastError('リセットに失敗しました');
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
    return <AdminLayout><AccessDenied /></AdminLayout>;
  }

  return (
    <AdminLayout headerTitle="アラート設定">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <Link href="/settings" className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 transition-colors duration-150">
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
            <CardTitle>アラート設定</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-gray-600">
              アラート種別ごとに ON/OFF としきい値を教室単位で設定できます。空欄のフィールドはデフォルト値が使われます。
            </p>

            <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
              <Button onClick={saveAll} disabled={isSaving || isLoading || !settings}>
                <Save className="w-4 h-4 mr-1" />
                {isSaving ? '保存中...' : '保存'}
              </Button>
              <Button variant="ghost" onClick={resetAll} disabled={isSaving || isLoading}>
                <RotateCcw className="w-4 h-4 mr-1" />
                デフォルトに戻す
              </Button>
            </div>
          </CardContent>
        </Card>

        {isLoading || !settings ? (
          <Loading size="md" />
        ) : (
          (Object.keys(ALERT_TYPE_LABELS) as AlertType[]).map((type) => {
            const s = settings[type];
            const fields = FIELDS_BY_TYPE[type] ?? [];
            return (
              <Card key={type}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{ALERT_TYPE_LABELS[type]}</CardTitle>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={s.enabled}
                        onChange={(e) => updateOne(type, { enabled: e.target.checked })}
                        className="w-4 h-4"
                      />
                      <span className={s.enabled ? 'text-gray-900' : 'text-gray-400'}>
                        {s.enabled ? '有効' : '無効'}
                      </span>
                    </label>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-xs text-gray-500">{ALERT_DESCRIPTIONS[type]}</p>
                  {fields.length === 0 ? (
                    <p className="text-xs text-gray-400">このアラートにはしきい値の設定はありません。</p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {fields.map((f) => {
                        const stored = s.thresholds[f.key];
                        const fallback = DEFAULT_ALERT_THRESHOLDS[f.key];
                        return (
                          <div key={f.key}>
                            <label className="block text-xs font-medium text-gray-700 mb-1">
                              {f.label}
                              <span className="ml-1 text-gray-400">（デフォルト: {fallback}{f.unit}）</span>
                            </label>
                            <div className="flex items-center gap-2">
                              <Input
                                type="number"
                                min={f.min}
                                max={f.max}
                                value={stored ?? ''}
                                placeholder={String(fallback)}
                                disabled={!s.enabled}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  const next = v === '' ? undefined : Number(v);
                                  updateOne(type, { thresholds: { [f.key]: next } });
                                }}
                                className="w-32"
                              />
                              <span className="text-sm text-gray-500">{f.unit}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      {ConfirmDialog}
    </AdminLayout>
  );
}
