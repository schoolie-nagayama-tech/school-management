'use client';

import { useState, useEffect } from 'react';
import { Modal, Input, Button, Select } from '@/components/ui';
import { createYoubiPeriod, updateYoubiPeriod } from '@/lib/api/youbi';
import { createFormPeriodForSchools, updateFormPeriodForSchools, generateUniquePeriodKey, getNextPeriodKey } from '@/lib/api/form-periods';
import { getApplicationItems } from '@/lib/api/applications';
import { getClassPeriodsAsync, type ClassPeriodItem } from '@/lib/api/class-periods';
import type { YoubiPeriod, YoubiSettings } from '@/types/forms/youbi';
import type { ApplicationItem } from '@/types/database';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';

interface YoubiPeriodEditorProps {
  isOpen: boolean;
  period: YoubiPeriod | null;
  schoolId?: string;
  /** 複数教室に一括作成・更新する場合 */
  schoolIds?: string[];
  /** 編集時に更新対象を選ぶための教室一覧（id, name） */
  allowedSchools?: { id: string; name: string }[];
  onClose: () => void;
  onSuccess: () => void;
}

const DEFAULT_DESCRIPTION = `曜日・時間・科目の変更をご希望の方は、以下のフォームよりお申し込みください。
第2希望までご入力ください。

※変更が決まりましたら、Growにてご連絡いたします。`;

export function YoubiPeriodEditor({
  isOpen,
  period,
  schoolId,
  schoolIds,
  allowedSchools,
  onClose,
  onSuccess,
}: YoubiPeriodEditorProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [applyToAllSchools, setApplyToAllSchools] = useState(true);
  const [selectedSchoolIdsForUpdate, setSelectedSchoolIdsForUpdate] = useState<string[]>([]);
  const [selectedSchoolIdsForCreate, setSelectedSchoolIdsForCreate] = useState<string[]>([]);

  // コマ時間マスタから取得した時限リスト
  const [classPeriods, setClassPeriods] = useState<ClassPeriodItem[]>([]);

  // フォームデータ
  const [periodKey, setPeriodKey] = useState('');
  const [title, setTitle] = useState('曜日変更');
  const [description, setDescription] = useState(DEFAULT_DESCRIPTION);
  const [daysText, setDaysText] = useState('月\n火\n水\n木\n金\n土');
  const [publishStart, setPublishStart] = useState('');
  const [publishEnd, setPublishEnd] = useState('');
  const [completionMessage, setCompletionMessage] = useState(
    '変更申請を受け付けました。\n内容を確認の上、Growにてご連絡いたします。'
  );
  const [linkedApplicationItemId, setLinkedApplicationItemId] = useState<string>('');
  const [applicationItems, setApplicationItems] = useState<ApplicationItem[]>([]);


  // テキストをパース
  const parseLines = (text: string): string[] => {
    return text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  };

  // 初期値の設定
  useEffect(() => {
    if (isOpen) {
      const targetIds = schoolIds && schoolIds.length > 0 ? schoolIds : schoolId ? [schoolId] : undefined;
      getApplicationItems(targetIds, true).then(setApplicationItems).catch(console.error);
      if (schoolId) {
        getClassPeriodsAsync(schoolId).then(setClassPeriods).catch(() => {});
      }
      if (period) {
        // 編集モード
        const settings = period.settings;
        setPeriodKey(period.period_key);
        setTitle(period.title);
        setDescription(settings.description || DEFAULT_DESCRIPTION);
        setDaysText(settings.available_days?.join('\n') || '月\n火\n水\n木\n金\n土');
        setPublishStart(
          period.publish_start
            ? new Date(period.publish_start).toISOString().slice(0, 16)
            : ''
        );
        setPublishEnd(
          period.publish_end
            ? new Date(period.publish_end).toISOString().slice(0, 16)
            : ''
        );
        setCompletionMessage(
          settings.completion_message ||
            '変更申請を受け付けました。\n内容を確認の上、Growにてご連絡いたします。'
        );
        setLinkedApplicationItemId(period.linked_application_item_id || '');
      } else {
        // 新規作成モード — 期間キーは自動生成（YYYY-MM、衝突時は連番）
        setPeriodKey(generateUniquePeriodKey([]));
        getNextPeriodKey('youbi', targetIds ?? []).then(setPeriodKey).catch(() => {});
        setTitle('曜日変更');
        setDescription(DEFAULT_DESCRIPTION);
        setDaysText('月\n火\n水\n木\n金\n土');
        setPublishStart('');
        setPublishEnd('');
        setCompletionMessage('変更申請を受け付けました。\n内容を確認の上、Growにてご連絡いたします。');
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

  // バリデーション
  const validate = (): boolean => {
    if (!periodKey.trim()) {
      setError('期間キーを入力してください');
      return false;
    }
    if (!title.trim()) {
      setError('タイトルを入力してください');
      return false;
    }
    if (parseLines(daysText).length === 0) {
      setError('曜日を入力してください');
      return false;
    }
    if (classPeriods.length === 0) {
      setError('共通設定で時限を登録してください');
      return false;
    }
    setError('');
    return true;
  };

  // 保存処理
  const handleSave = async () => {
    if (!validate()) return;

    setIsSubmitting(true);
    setError('');

    try {
      const settings: YoubiSettings = {
        description: description.trim(),
        available_days: parseLines(daysText),
        available_periods: classPeriods,
        available_subjects: [], // 科目はフォームで科目テーブルを学年別に自動参照
        completion_message: completionMessage.trim(),
      };

      const settingsForApi = settings as unknown as Record<string, unknown>;
      const baseData = {
        title: title.trim(),
        settings: settingsForApi,
        publish_start: publishStart ? new Date(publishStart).toISOString() : null,
        publish_end: publishEnd ? new Date(publishEnd).toISOString() : null,
        is_active: true,
        linked_application_item_id: linkedApplicationItemId || null,
      };

      if (period) {
        const idsToUpdate =
          allowedSchools && allowedSchools.length > 1
            ? selectedSchoolIdsForUpdate
            : schoolIds && schoolIds.length > 1 && applyToAllSchools
              ? schoolIds
              : null;
        if (idsToUpdate && idsToUpdate.length > 1) {
          await updateFormPeriodForSchools(
            idsToUpdate,
            'youbi',
            period.period_key,
            baseData
          );
        } else {
          await updateYoubiPeriod(period.id, baseData);
        }
      } else {
        const createData = { ...baseData, period_key: periodKey.trim() };
        const idsToCreate =
          allowedSchools && allowedSchools.length > 1
            ? selectedSchoolIdsForCreate
            : schoolIds && schoolIds.length > 1
              ? schoolIds
              : null;
        if (idsToCreate && idsToCreate.length > 1) {
          await createFormPeriodForSchools(idsToCreate, {
            ...createData,
            form_type: 'youbi',
          });
        } else if (idsToCreate && idsToCreate.length === 1) {
          await createYoubiPeriod(createData, idsToCreate[0]);
        } else {
          await createYoubiPeriod(createData, schoolId);
        }
      }

      onSuccess();
      onClose();
    } catch (error) {
      console.error('Failed to save:', error);
      setError(
        getUserErrorMessage(error, '保存に失敗しました')
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={period ? '曜日変更 期間編集' : '曜日変更 期間作成'}
      size="2xl"
      minHeight="80vh"
    >
      <div className="space-y-6">
        {/* エラーメッセージ */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-red-800 text-sm">{error}</p>
          </div>
        )}

        {/* 基本情報 */}
        <section>
          <h3 className="text-sm font-semibold text-[#1f2937] mb-3 border-b border-[#e5e7eb] pb-1">
            基本情報
          </h3>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium mb-1 text-[#1f2937]">
                期間キー
              </label>
              <Input
                type="text"
                value={periodKey}
                readOnly
                disabled // 自動生成のため常に編集不可
                className="disabled:bg-gray-100"
              />
              <p className="text-xs text-[#4b5563]/60 mt-1">
                ※ 自動で割り当てられます（変更不可）
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 text-[#1f2937]">
                タイトル <span className="text-red-500">*</span>
              </label>
              <Input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例: 曜日変更"
              />
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-1 text-[#1f2937]">説明文</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="フォーム上部に表示される説明文"
              rows={4}
              className="w-full border border-[#e5e7eb] rounded-lg px-3 py-2 resize-y text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1 text-[#1f2937]">公開開始</label>
              <Input
                type="datetime-local"
                value={publishStart}
                onChange={(e) => setPublishStart(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 text-[#1f2937]">公開終了</label>
              <Input
                type="datetime-local"
                value={publishEnd}
                onChange={(e) => setPublishEnd(e.target.value)}
              />
              <p className="text-xs text-[#4b5563]/60 mt-1">
                ※空欄にすると永続的に公開されます
              </p>
            </div>
          </div>
        </section>

        {/* 選択肢設定 */}
        <section>
          <h3 className="text-sm font-semibold text-[#1f2937] mb-3 border-b border-[#e5e7eb] pb-1">
            選択肢設定
          </h3>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium mb-1 text-[#1f2937]">
                曜日（改行区切り） <span className="text-red-500">*</span>
              </label>
              <textarea
                value={daysText}
                onChange={(e) => setDaysText(e.target.value)}
                rows={6}
                className="w-full border border-[#e5e7eb] rounded-lg px-3 py-2 font-mono text-sm resize-y"
              />
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-1 text-[#1f2937]">
              時限（共通設定を使用）
            </label>
            <div className="border border-[#e5e7eb] rounded-lg bg-[#f9fafb] px-3 py-2 text-sm font-mono space-y-0.5">
              {classPeriods.map((p) => (
                <div key={p.code} className="text-[#1f2937]">
                  {p.code} : {p.label}
                </div>
              ))}
            </div>
            <p className="text-xs text-[#4b5563]/70 mt-1">
              時限は<a href="/settings/forms/class-periods" target="_blank" rel="noopener noreferrer" className="text-[#1e40af] underline">共通設定（授業の時間帯）</a>で管理します。保存時に最新の共通設定が適用されます。
            </p>
          </div>
        </section>

        {/* 完了メッセージ */}
        <section>
          <h3 className="text-sm font-semibold text-[#1f2937] mb-3 border-b border-[#e5e7eb] pb-1">
            完了メッセージ
          </h3>

          <div>
            <label className="block text-sm font-medium mb-1 text-[#1f2937]">完了メッセージ</label>
            <textarea
              value={completionMessage}
              onChange={(e) => setCompletionMessage(e.target.value)}
              rows={2}
              className="w-full border border-[#e5e7eb] rounded-lg px-3 py-2 resize-y text-sm"
            />
          </div>
        </section>

        {/* 申込状況との紐付け */}
        <section>
          <h3 className="text-sm font-semibold text-[#1f2937] mb-3 border-b border-[#e5e7eb] pb-1">
            申込状況との紐付け
          </h3>
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
        </section>

        {!period && allowedSchools && allowedSchools.length > 1 && (
          <div className="p-3 bg-[#eff6ff] rounded-lg border border-[#bfdbfe]">
            <p className="text-sm font-medium text-[#1f2937] mb-2">
              作成する教室を選択
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {allowedSchools.map((school) => (
                <label
                  key={school.id}
                  className="flex items-center gap-2 cursor-pointer"
                >
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
            <p className="text-sm font-medium text-[#1f2937] mb-2">
              同じ内容で更新する教室を選択
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {allowedSchools.map((school) => (
                <label
                  key={school.id}
                  className="flex items-center gap-2 cursor-pointer"
                >
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

        {/* フッター */}
        <div className="flex justify-end gap-3 pt-4 border-t border-[#e5e7eb]">
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            キャンセル
          </Button>
          <Button onClick={handleSave} disabled={isSubmitting}>
            {isSubmitting ? '保存中...' : '保存'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
