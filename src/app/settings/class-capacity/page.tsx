'use client';

/**
 * 授業生徒数設定ページ
 *
 * 学校ごとに以下を可変設定する：
 *  - 個別: 1講師あたりの生徒上限（デフォルト2 = 1対2まで）
 *  - 個別: 教室全体の同時席数（デフォルト12）
 *  - 集団: 1コマあたりの生徒上限（デフォルト8）
 *  - 集団: 同時開催コマ数（デフォルト1 = 1室のみ）
 *
 * これらは座席表配置時のバリデーションや、将来のマッチング機能の容量制約として使われる。
 */

import { useState, useEffect, useCallback } from 'react';
import { AdminLayout } from '@/components/layouts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { SelectShadcn as Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui';
import { Button } from '@/components/ui';
import { ToastContainer, Loading } from '@/components/ui';
import { useToast } from '@/hooks/useToast';
import { useMasterData } from '@/contexts/MasterDataContext';
import {
  getOrCreateClassCapacity,
  upsertClassCapacity,
  DEFAULT_CLASS_CAPACITY,
} from '@/lib/api/school-class-capacity';
import type { SchoolClassCapacityFormData } from '@/types/schedule';
import type { School } from '@/types/database';
import AccessDenied from '@/components/AccessDenied';
import { useAuth } from '@/contexts/AuthContext';
import { Users, RotateCcw, Save } from 'lucide-react';

export default function ClassCapacitySettingsPage() {
  const { profile, selectedSchoolId: headerSelectedSchoolId, getSelectedSchoolIds } = useAuth();
  const { toasts, removeToast, success, error: toastError } = useToast();
  const { schools: masterSchools } = useMasterData();

  const [schools, setSchools] = useState<School[]>([]);
  const [selectedSchoolId, setSelectedSchoolId] = useState<string>('');
  const [form, setForm] = useState<SchoolClassCapacityFormData>(DEFAULT_CLASS_CAPACITY);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // 教室選択を初期化（ヘッダー選択を優先、無ければ先頭）
  useEffect(() => {
    if (masterSchools.length > 0) {
      setSchools(masterSchools);
      if (!selectedSchoolId) {
        const headerIds = getSelectedSchoolIds();
        const preferred =
          headerSelectedSchoolId && headerSelectedSchoolId !== 'all'
            ? headerSelectedSchoolId
            : headerIds.length > 0
              ? headerIds[0]
              : masterSchools[0].id;
        setSelectedSchoolId(preferred);
      }
    }
  }, [masterSchools, selectedSchoolId, headerSelectedSchoolId, getSelectedSchoolIds]);

  // 教室変更時に現行値を読み込み（無ければデフォルトで作成）
  const load = useCallback(async (schoolId: string) => {
    setIsLoading(true);
    try {
      const data = await getOrCreateClassCapacity(schoolId);
      setForm({
        max_students_per_teacher_individual: data.max_students_per_teacher_individual,
        total_individual_seats: data.total_individual_seats,
        max_students_per_group: data.max_students_per_group,
        max_concurrent_groups: data.max_concurrent_groups,
      });
    } catch (e) {
      toastError(e instanceof Error ? e.message : '読み込みに失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [toastError]);

  useEffect(() => {
    if (selectedSchoolId) load(selectedSchoolId);
  }, [selectedSchoolId, load]);

  // 保存
  const onSave = async () => {
    if (!selectedSchoolId) return;
    setIsSaving(true);
    try {
      await upsertClassCapacity(selectedSchoolId, form);
      success('授業生徒数設定を保存しました');
    } catch (e) {
      toastError(e instanceof Error ? e.message : '保存に失敗しました');
    } finally {
      setIsSaving(false);
    }
  };

  // デフォルトに戻す（保存はせず、フォーム値だけ書き換え）
  const onResetToDefault = () => {
    setForm(DEFAULT_CLASS_CAPACITY);
  };

  // manager 以上のみ
  if (profile && profile.role !== 'admin' && profile.role !== 'manager' && profile.role !== 'owner') {
    return <AccessDenied />;
  }

  return (
    <AdminLayout>
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Users className="w-6 h-6 text-info" />
          <h1 className="text-2xl font-bold">授業生徒数設定</h1>
        </div>

        <p className="text-sm text-text-muted">
          学校ごとに個別指導・集団指導の生徒数上限を設定します。座席表配置時のバリデーションや、将来のマッチング機能の容量制約として使用されます。
        </p>

        {/* 教室選択 */}
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-text-body">教室:</label>
          <Select value={selectedSchoolId} onValueChange={setSelectedSchoolId}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder="教室を選択" />
            </SelectTrigger>
            <SelectContent>
              {schools.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <Loading />
        ) : (
          <>
            {/* 個別指導 */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">個別指導</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <NumberField
                  label="1講師あたりの生徒数 (1〜10)"
                  hint="例：2 にすると 1対2 まで配置可。3 以上を入れる場合は座席表で容量超過警告が出る基準も変わります。"
                  value={form.max_students_per_teacher_individual}
                  min={1}
                  max={10}
                  onChange={(v) =>
                    setForm((f) => ({ ...f, max_students_per_teacher_individual: v }))
                  }
                />
                <NumberField
                  label="教室全体の同時席数 (1〜100)"
                  hint="個別ブースの席数。同じコマで配置できる生徒の合計上限になります。"
                  value={form.total_individual_seats}
                  min={1}
                  max={100}
                  onChange={(v) => setForm((f) => ({ ...f, total_individual_seats: v }))}
                />
              </CardContent>
            </Card>

            {/* 集団指導 */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">集団指導</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <NumberField
                  label="1コマあたりの生徒数 (1〜100)"
                  hint="集団授業1コマに参加できる生徒数の上限。"
                  value={form.max_students_per_group}
                  min={1}
                  max={100}
                  onChange={(v) => setForm((f) => ({ ...f, max_students_per_group: v }))}
                />
                <NumberField
                  label="同時開催コマ数 (1〜20)"
                  hint="同じ時間帯に並行で開催できる集団コマ数。教室が1室なら 1。"
                  value={form.max_concurrent_groups}
                  min={1}
                  max={20}
                  onChange={(v) => setForm((f) => ({ ...f, max_concurrent_groups: v }))}
                />
              </CardContent>
            </Card>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button variant="outline" onClick={onResetToDefault} disabled={isSaving}>
                <RotateCcw className="w-4 h-4 mr-1" />
                デフォルトに戻す
              </Button>
              <Button onClick={onSave} disabled={isSaving}>
                <Save className="w-4 h-4 mr-1" />
                {isSaving ? '保存中...' : '保存'}
              </Button>
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  );
}

/** ラベル + 数値入力 + ヒント文 のセット（このページ専用なので外出ししない） */
function NumberField({
  label,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-text-body mb-1">{label}</label>
      <input
        type="number"
        className="w-32 px-3 py-2 border border-border-default rounded-md"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const v = parseInt(e.target.value, 10);
          if (!Number.isNaN(v)) onChange(v);
        }}
      />
      <p className="mt-1 text-xs text-text-muted">{hint}</p>
    </div>
  );
}
