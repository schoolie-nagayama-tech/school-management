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
import {
  SelectShadcn as Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui';
import { Button } from '@/components/ui';
import { ToastContainer, Loading } from '@/components/ui';
import { useToast } from '@/hooks/useToast';
import { useMasterData } from '@/contexts/MasterDataContext';
import {
  getOrCreateClassCapacity,
  upsertClassCapacity,
  DEFAULT_CLASS_CAPACITY,
} from '@/lib/api/school-class-capacity';
import {
  getFormations,
  getFormationCapacities,
  upsertFormationCapacity,
} from '@/lib/api/schedule-formations';
import type { SchoolClassCapacityFormData, ScheduleFormation } from '@/types/schedule';
import type { School } from '@/types/database';
import AccessDenied from '@/components/AccessDenied';
import { useAuth } from '@/contexts/AuthContext';
import { Users, RotateCcw, Save } from 'lucide-react';

/** 形態別定員のデフォルト（school_formation_capacity の DB デフォルトと揃える） */
const DEFAULT_FORMATION_CAPACITY = { max_students_per_group: 8, max_concurrent_groups: 1 };

export default function ClassCapacitySettingsPage() {
  const { profile, selectedSchoolId: headerSelectedSchoolId, getSelectedSchoolIds } = useAuth();
  const { toasts, removeToast, success, error: toastError } = useToast();
  const { schools: masterSchools } = useMasterData();

  const [schools, setSchools] = useState<School[]>([]);
  const [selectedSchoolId, setSelectedSchoolId] = useState<string>('');
  const [form, setForm] = useState<SchoolClassCapacityFormData>(DEFAULT_CLASS_CAPACITY);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // ユーザー定義形態（is_system=false・is_active）の定員設定（school_formation_capacity）
  const [userFormations, setUserFormations] = useState<ScheduleFormation[]>([]);
  // key -> 定員フォーム値
  const [formationCaps, setFormationCaps] = useState<
    Record<string, { max_students_per_group: number; max_concurrent_groups: number }>
  >({});
  const [savingFormationKey, setSavingFormationKey] = useState<string | null>(null);

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
  const load = useCallback(
    async (schoolId: string) => {
      setIsLoading(true);
      try {
        // 既存の individual/group 定員（school_class_capacity）と
        // ユーザー定義形態の一覧＋定員（schedule_formations / school_formation_capacity）を並行取得
        const [data, formations, caps] = await Promise.all([
          getOrCreateClassCapacity(schoolId),
          getFormations(false),
          getFormationCapacities(schoolId),
        ]);
        setForm({
          max_students_per_teacher_individual: data.max_students_per_teacher_individual,
          total_individual_seats: data.total_individual_seats,
          max_students_per_group: data.max_students_per_group,
          max_concurrent_groups: data.max_concurrent_groups,
        });
        // ユーザー定義形態（is_system=false）のみ対象。individual/group は上の専用UIで管理。
        const userDefined = formations.filter((f) => !f.is_system);
        setUserFormations(userDefined);
        // 各形態の現行定員をフォーム値へ。未設定形態はデフォルトで埋める。
        const capByKey: Record<
          string,
          { max_students_per_group: number; max_concurrent_groups: number }
        > = {};
        for (const f of userDefined) {
          const existing = caps.find((c) => c.formation === f.key);
          capByKey[f.key] = existing
            ? {
                max_students_per_group: existing.max_students_per_group,
                max_concurrent_groups: existing.max_concurrent_groups,
              }
            : { ...DEFAULT_FORMATION_CAPACITY };
        }
        setFormationCaps(capByKey);
      } catch (e) {
        toastError(e instanceof Error ? e.message : '読み込みに失敗しました');
      } finally {
        setIsLoading(false);
      }
    },
    [toastError]
  );

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

  // ユーザー定義形態の定員フォーム値を更新
  const onFormationCapChange = (
    key: string,
    field: 'max_students_per_group' | 'max_concurrent_groups',
    value: number
  ) => {
    setFormationCaps((prev) => ({
      ...prev,
      [key]: { ...prev[key], [field]: value },
    }));
  };

  // ユーザー定義形態の定員を保存（school_formation_capacity へ upsert）
  const onSaveFormationCap = async (key: string) => {
    if (!selectedSchoolId) return;
    const values = formationCaps[key];
    if (!values) return;
    setSavingFormationKey(key);
    try {
      await upsertFormationCapacity(selectedSchoolId, key, values);
      success('形態別定員を保存しました');
    } catch (e) {
      toastError(e instanceof Error ? e.message : '保存に失敗しました');
    } finally {
      setSavingFormationKey(null);
    }
  };

  // manager 以上のみ
  if (
    profile &&
    profile.role !== 'admin' &&
    profile.role !== 'manager' &&
    profile.role !== 'owner'
  ) {
    return <AccessDenied />;
  }

  return (
    <AdminLayout documentTitle="授業生徒数設定">
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

            {/*
              ユーザー定義形態の定員（school_formation_capacity）。
              個別/集団（is_system）は上の専用UIで管理するため、ここには出さない。
              形態が1つも無ければセクションごと非表示。
            */}
            {userFormations.length > 0 && (
              <div className="space-y-4 pt-4">
                <div className="border-t border-border-default pt-6">
                  <h2 className="text-lg font-bold text-[var(--headline)]">指導形態別の定員</h2>
                  <p className="mt-1 text-sm text-text-muted">
                    「コマ時間設定」で追加した指導形態ごとの定員です。1枠あたりの生徒数と、同時刻に開催できる枠数を設定します。
                  </p>
                </div>
                {userFormations.map((f) => {
                  const cap = formationCaps[f.key] ?? DEFAULT_FORMATION_CAPACITY;
                  return (
                    <Card key={f.key}>
                      <CardHeader>
                        <CardTitle className="text-base">{f.label}</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <NumberField
                          label="1枠あたりの生徒数 (1〜100)"
                          hint="この形態の1枠（1講師）に参加できる生徒数の上限。"
                          value={cap.max_students_per_group}
                          min={1}
                          max={100}
                          onChange={(v) => onFormationCapChange(f.key, 'max_students_per_group', v)}
                        />
                        <NumberField
                          label="同時開催枠数 (1〜20)"
                          hint="同じ時間帯に並行で開催できる枠数。"
                          value={cap.max_concurrent_groups}
                          min={1}
                          max={20}
                          onChange={(v) => onFormationCapChange(f.key, 'max_concurrent_groups', v)}
                        />
                        <div className="flex items-center justify-end pt-2">
                          <Button
                            onClick={() => onSaveFormationCap(f.key)}
                            disabled={savingFormationKey === f.key}
                          >
                            <Save className="w-4 h-4 mr-1" />
                            {savingFormationKey === f.key ? '保存中...' : '保存'}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
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
