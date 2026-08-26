'use client';

/**
 * 「授業の設定」ページの定員セクション。
 *
 * 旧「授業生徒数設定」ページ（/settings/class-capacity）を形態タブごとに分解して移植した。
 * 定員のデータ構造は2本立てのまま（統合しない）:
 *  - 個別・小集団（is_system）… school_class_capacity の専用列
 *  - ユーザー定義形態        … school_formation_capacity（形態ごと1行）
 *
 * ここで設定するのは「形態の既定値」。講座に定員（special_courses.capacity）があれば
 * そちらが優先される（resolveClassCapacity）。
 */

import { useCallback, useEffect, useState } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle, Loading } from '@/components/ui';
import {
  getOrCreateClassCapacity,
  upsertClassCapacity,
  DEFAULT_CLASS_CAPACITY,
} from '@/lib/api/school-class-capacity';
import { getFormationCapacities, upsertFormationCapacity } from '@/lib/api/schedule-formations';
import type { SchoolClassCapacityFormData } from '@/types/schedule';
import { INDIVIDUAL_FORMATION, GROUP_FORMATION } from '@/types/schedule';
import { RotateCcw, Save } from 'lucide-react';

/** 形態別定員のデフォルト（school_formation_capacity の DB デフォルトと揃える） */
const DEFAULT_FORMATION_CAPACITY = { max_students_per_group: 8, max_concurrent_groups: 1 };

interface Props {
  schoolId: string;
  /** 選択中の指導形態 key */
  formationKey: string;
  formationLabel: string;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}

export function CapacitySection({
  schoolId,
  formationKey,
  formationLabel,
  onSuccess,
  onError,
}: Props) {
  const isIndividual = formationKey === INDIVIDUAL_FORMATION;
  const isGroup = formationKey === GROUP_FORMATION;
  const isSystem = isIndividual || isGroup;

  // 個別・小集団（school_class_capacity）
  const [form, setForm] = useState<SchoolClassCapacityFormData>(DEFAULT_CLASS_CAPACITY);
  // ユーザー定義形態（school_formation_capacity）
  const [formationCap, setFormationCap] = useState(DEFAULT_FORMATION_CAPACITY);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(async () => {
    if (!schoolId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      if (isSystem) {
        const data = await getOrCreateClassCapacity(schoolId);
        setForm({
          max_students_per_teacher_individual: data.max_students_per_teacher_individual,
          total_individual_seats: data.total_individual_seats,
          max_students_per_group: data.max_students_per_group,
          max_concurrent_groups: data.max_concurrent_groups,
        });
      } else {
        const caps = await getFormationCapacities(schoolId);
        const existing = caps.find((c) => c.formation === formationKey);
        setFormationCap(
          existing
            ? {
                max_students_per_group: existing.max_students_per_group,
                max_concurrent_groups: existing.max_concurrent_groups,
              }
            : { ...DEFAULT_FORMATION_CAPACITY }
        );
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : '読み込みに失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [schoolId, formationKey, isSystem, onError]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async () => {
    if (!schoolId) return;
    setIsSaving(true);
    try {
      if (isSystem) {
        // school_class_capacity は個別・小集団を1行で持つため、
        // 表示していない側の値も現行値のまま送る（タブを跨いで消さない）。
        await upsertClassCapacity(schoolId, form);
      } else {
        await upsertFormationCapacity(schoolId, formationKey, formationCap);
      }
      onSuccess('定員を保存しました');
    } catch (e) {
      onError(e instanceof Error ? e.message : '保存に失敗しました');
    } finally {
      setIsSaving(false);
    }
  };

  // デフォルトに戻す（保存はせず、フォーム値だけ書き換え）
  const handleResetToDefault = () => {
    if (isSystem) {
      setForm(DEFAULT_CLASS_CAPACITY);
    } else {
      setFormationCap({ ...DEFAULT_FORMATION_CAPACITY });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">定員</CardTitle>
        <p className="mt-1 text-xs text-[var(--paragraph)]">
          {isIndividual
            ? '個別指導の1講師あたりの生徒数と、教室全体の同時席数です。'
            : `${formationLabel}の1枠（講師1人）あたりの既定の生徒数と、同時に開ける枠数です。`}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Loading size="sm" />
        ) : (
          <>
            {isIndividual && (
              <>
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
              </>
            )}

            {isGroup && (
              <>
                <NumberField
                  label="1コマあたりの生徒数 (1〜100)"
                  hint="小集団の授業1コマに参加できる生徒数の上限。"
                  value={form.max_students_per_group}
                  min={1}
                  max={100}
                  onChange={(v) => setForm((f) => ({ ...f, max_students_per_group: v }))}
                />
                <NumberField
                  label="同時開催コマ数 (1〜20)"
                  hint="同じ時間帯に並行で開催できる小集団のコマ数。教室が1室なら 1。"
                  value={form.max_concurrent_groups}
                  min={1}
                  max={20}
                  onChange={(v) => setForm((f) => ({ ...f, max_concurrent_groups: v }))}
                />
              </>
            )}

            {!isSystem && (
              <>
                <NumberField
                  label="1枠あたりの生徒数 (1〜100)"
                  hint="この形態の1枠（1講師）に参加できる生徒数の上限。"
                  value={formationCap.max_students_per_group}
                  min={1}
                  max={100}
                  onChange={(v) => setFormationCap((c) => ({ ...c, max_students_per_group: v }))}
                />
                <NumberField
                  label="同時開催枠数 (1〜20)"
                  hint="同じ時間帯に並行で開催できる枠数。"
                  value={formationCap.max_concurrent_groups}
                  min={1}
                  max={20}
                  onChange={(v) => setFormationCap((c) => ({ ...c, max_concurrent_groups: v }))}
                />
              </>
            )}

            {!isIndividual && (
              <p className="text-xs text-[var(--paragraph)] bg-[var(--surface)] rounded-md px-3 py-2">
                講座に定員を設定した枠は講座の定員が優先されます。ここの値は定員を設定していない講座の既定値です。
              </p>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button variant="outline" onClick={handleResetToDefault} disabled={isSaving}>
                <RotateCcw className="w-4 h-4 mr-1" />
                デフォルトに戻す
              </Button>
              <Button onClick={handleSave} disabled={isSaving}>
                <Save className="w-4 h-4 mr-1" />
                {isSaving ? '保存中...' : '保存'}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** ラベル + 数値入力 + ヒント文 のセット */
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
