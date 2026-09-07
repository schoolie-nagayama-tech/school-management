'use client';

import { useState, useEffect } from 'react';
import { Modal, Input, Button, Select } from '@/components/ui';
import { createZoukomaPeriod, updateZoukomaPeriod } from '@/lib/api/zoukoma';
import {
  createFormPeriodForSchools,
  updateFormPeriodForSchools,
  generateUniquePeriodKey,
  getNextPeriodKey,
} from '@/lib/api/form-periods';
import { getApplicationItems } from '@/lib/api/applications';
import type { ZoukomaPeriod, ZoukomaSettings } from '@/types/forms/zoukoma';
import { DEFAULT_GRADE_PRICES } from '@/lib/forms/pricing';
import type { ApplicationItem } from '@/types/database';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';
import { resolveUpdateSchoolIds, resolveCreateSchoolIds } from '@/hooks/usePeriodEditor';

interface ZoukomaPeriodEditorProps {
  isOpen: boolean;
  period: ZoukomaPeriod | null;
  schoolId?: string;
  /** 複数教室に一括作成・更新する場合 */
  schoolIds?: string[];
  /** 編集時に更新対象を選ぶための教室一覧（id, name） */
  allowedSchools?: { id: string; name: string }[];
  onClose: () => void;
  onSuccess: () => void;
}

export function ZoukomaPeriodEditor({
  isOpen,
  period,
  schoolId,
  schoolIds,
  allowedSchools,
  onClose,
  onSuccess,
}: ZoukomaPeriodEditorProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [applyToAllSchools, setApplyToAllSchools] = useState(true);
  const [selectedSchoolIdsForUpdate, setSelectedSchoolIdsForUpdate] = useState<string[]>([]);
  const [selectedSchoolIdsForCreate, setSelectedSchoolIdsForCreate] = useState<string[]>([]);

  // フォームデータ
  const [periodKey, setPeriodKey] = useState('');
  const [title, setTitle] = useState('');
  const [publishStart, setPublishStart] = useState('');
  const [publishEnd, setPublishEnd] = useState('');
  const [isActive, setIsActive] = useState(false);
  const [linkedApplicationItemId, setLinkedApplicationItemId] = useState<string>('');
  const [applicationItems, setApplicationItems] = useState<ApplicationItem[]>([]);

  // 初期値の設定
  useEffect(() => {
    if (isOpen) {
      const targetIds =
        schoolIds && schoolIds.length > 0 ? schoolIds : schoolId ? [schoolId] : undefined;
      getApplicationItems(targetIds, true).then(setApplicationItems).catch(console.error);
      if (period) {
        // 編集モード
        setPeriodKey(period.period_key);
        setTitle(period.title);
        setPublishStart(
          period.publish_start ? new Date(period.publish_start).toISOString().slice(0, 16) : ''
        );
        setPublishEnd(
          period.publish_end ? new Date(period.publish_end).toISOString().slice(0, 16) : ''
        );
        setIsActive(period.is_active);
        setLinkedApplicationItemId(period.linked_application_item_id || '');
      } else {
        // 新規作成モード — 期間キーは自動生成（YYYY-MM、衝突時は連番）
        setPeriodKey(generateUniquePeriodKey([]));
        getNextPeriodKey('zoukoma', targetIds ?? [])
          .then(setPeriodKey)
          .catch(() => {});
        setTitle('');
        setPublishStart('');
        setPublishEnd('');
        setIsActive(false);
        setLinkedApplicationItemId('');
      }
      setError('');
    }
    if (isOpen && period && allowedSchools && allowedSchools.length > 0) {
      setSelectedSchoolIdsForUpdate(allowedSchools.map((s) => s.id));
    }
    if (isOpen && !period && allowedSchools && allowedSchools.length > 0) {
      setSelectedSchoolIdsForCreate(allowedSchools.map((s) => s.id));
    }
  }, [isOpen, period, schoolId, allowedSchools]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // バリデーション
    if (!periodKey.trim()) {
      setError('期間キーを入力してください');
      return;
    }
    if (!title.trim()) {
      setError('タイトルを入力してください');
      return;
    }
    if (
      !period &&
      allowedSchools &&
      allowedSchools.length > 1 &&
      selectedSchoolIdsForCreate.length === 0
    ) {
      setError('作成する教室を1つ以上選択してください');
      return;
    }

    setIsSubmitting(true);
    try {
      const settings: ZoukomaSettings = period?.settings || {
        grades: ['中1', '中2', '中3', '高1', '高2', '高3'],
        // この画面には単価の入力欄が無い。改定のたびに直し忘れて旧価格のまま公開され、
        // 清瀬の2学期中間で実際に旧単価の申込が出た。値を直書きせず既定単価を参照する。
        price_table: { ...DEFAULT_GRADE_PRICES },
        subjects: ['英語', '数学', '国語', '理科', '社会'],
      };

      const settingsForApi = settings as unknown as Record<string, unknown>;
      const updates = {
        title: title.trim(),
        publish_start: publishStart ? new Date(publishStart).toISOString() : null,
        publish_end: publishEnd ? new Date(publishEnd).toISOString() : null,
        is_active: isActive,
        settings: settingsForApi,
        linked_application_item_id: linkedApplicationItemId || null,
      };

      if (period) {
        const idsToUpdate = resolveUpdateSchoolIds({
          allowedSchools,
          selectedSchoolIdsForUpdate,
          schoolIds,
          applyToAllSchools,
        });
        if (idsToUpdate && idsToUpdate.length > 1) {
          await updateFormPeriodForSchools(idsToUpdate, 'zoukoma', period.period_key, updates);
        } else {
          await updateZoukomaPeriod(period.id, updates);
        }
      } else {
        const createData = {
          period_key: periodKey.trim(),
          title: title.trim(),
          settings: settingsForApi,
          publish_start: publishStart ? new Date(publishStart).toISOString() : null,
          publish_end: publishEnd ? new Date(publishEnd).toISOString() : null,
          is_active: isActive,
          linked_application_item_id: linkedApplicationItemId || null,
        };
        const idsToCreate = resolveCreateSchoolIds({
          allowedSchools,
          selectedSchoolIdsForCreate,
          schoolIds,
        });
        if (idsToCreate && idsToCreate.length > 1) {
          await createFormPeriodForSchools(idsToCreate, {
            ...createData,
            form_type: 'zoukoma',
          });
        } else if (idsToCreate && idsToCreate.length === 1) {
          await createZoukomaPeriod(createData, idsToCreate[0]);
        } else {
          await createZoukomaPeriod(createData, schoolId);
        }
      }
      onSuccess();
      onClose();
    } catch (error) {
      console.error('Error saving period:', error);
      setError(getUserErrorMessage(error, '期間の保存に失敗しました'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={period ? '期間の編集' : '期間の新規作成'}
      size="2xl"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-[#ef4444]/10 border border-[#ef4444] rounded-lg">
            <p className="text-sm text-[#ef4444]">{error}</p>
          </div>
        )}

        <div>
          <Input
            label="期間キー"
            type="text"
            value={periodKey}
            readOnly
            disabled
            className="bg-[#f3f4f6] cursor-not-allowed"
          />
          <p className="text-xs text-[#4b5563]/60 mt-1">
            ※
            期間キーは自動で割り当てられます（変更不可）。表示名は下の「タイトル」で設定してください。
          </p>
        </div>

        <Input
          label="タイトル"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例: 10月度 テスト対策増コマ申し込み"
          required
          disabled={isSubmitting}
        />

        <Input
          label="公開開始日時"
          type="datetime-local"
          value={publishStart}
          onChange={(e) => setPublishStart(e.target.value)}
          disabled={isSubmitting}
        />

        <Input
          label="公開終了日時"
          type="datetime-local"
          value={publishEnd}
          onChange={(e) => setPublishEnd(e.target.value)}
          disabled={isSubmitting}
        />
        <p className="text-xs text-[#4b5563]/60 mt-1">※空欄にすると永続的に公開されます</p>

        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            id="isActive"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            disabled={isSubmitting}
            className="w-4 h-4 text-[#3b82f6] border-[#e5e7eb] rounded focus:ring-[#3b82f6]"
          />
          <label htmlFor="isActive" className="text-sm text-[#1f2937]">
            公開中にする
          </label>
        </div>

        <Select
          label="申込状況項目との紐付け"
          value={linkedApplicationItemId}
          onChange={(e) => setLinkedApplicationItemId(e.target.value)}
          options={[
            { value: '', label: '選択してください' },
            ...applicationItems.map((item) => ({
              value: item.id,
              label: item.name,
            })),
          ]}
          disabled={isSubmitting}
        />

        {!period && allowedSchools && allowedSchools.length > 1 && (
          <div className="p-3 bg-[#eff6ff] rounded-lg border border-[#bfdbfe]">
            <p className="text-sm font-medium text-[#1f2937] mb-2">作成する教室を選択</p>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {allowedSchools.map((school) => (
                <label key={school.id} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedSchoolIdsForCreate.includes(school.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedSchoolIdsForCreate((prev) =>
                          prev.includes(school.id) ? prev : [...prev, school.id]
                        );
                      } else {
                        setSelectedSchoolIdsForCreate((prev) =>
                          prev.filter((id) => id !== school.id)
                        );
                      }
                    }}
                    disabled={isSubmitting}
                    className="w-4 h-4 text-[#3b82f6] border-[#e5e7eb] rounded focus:ring-[#3b82f6]"
                  />
                  <span className="text-sm text-[#1f2937]">{school.name}</span>
                </label>
              ))}
            </div>
          </div>
        )}
        {period && allowedSchools && allowedSchools.length > 1 && (
          <div className="p-3 bg-[#eff6ff] rounded-lg border border-[#bfdbfe]">
            <p className="text-sm font-medium text-[#1f2937] mb-2">同じ内容で更新する教室を選択</p>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {allowedSchools.map((school) => (
                <label key={school.id} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedSchoolIdsForUpdate.includes(school.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedSchoolIdsForUpdate((prev) =>
                          prev.includes(school.id) ? prev : [...prev, school.id]
                        );
                      } else {
                        setSelectedSchoolIdsForUpdate((prev) =>
                          prev.filter((id) => id !== school.id)
                        );
                      }
                    }}
                    disabled={isSubmitting}
                    className="w-4 h-4 text-[#3b82f6] border-[#e5e7eb] rounded focus:ring-[#3b82f6]"
                  />
                  <span className="text-sm text-[#1f2937]">{school.name}</span>
                </label>
              ))}
            </div>
          </div>
        )}
        {period && schoolIds && schoolIds.length > 1 && !allowedSchools?.length && (
          <label className="flex items-center gap-2 p-3 bg-[#eff6ff] rounded-lg border border-[#bfdbfe] cursor-pointer">
            <input
              type="checkbox"
              checked={applyToAllSchools}
              onChange={(e) => setApplyToAllSchools(e.target.checked)}
              disabled={isSubmitting}
              className="w-4 h-4 text-[#3b82f6] border-[#e5e7eb] rounded focus:ring-[#3b82f6]"
            />
            <span className="text-sm text-[#1f2937]">
              選択中の他教室の同じ期間も同じ内容で更新する
            </span>
          </label>
        )}

        <div className="flex justify-end gap-3 pt-4 border-t border-[#e5e7eb]">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            キャンセル
          </Button>
          <Button type="submit" isLoading={isSubmitting}>
            {period ? '更新する' : '作成する'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
