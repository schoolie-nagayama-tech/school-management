'use client';

import { useState, useEffect } from 'react';
import { Modal, Input, Button, Select } from '@/components/ui';
import { createSoudanPeriod, updateSoudanPeriod } from '@/lib/api/soudan';
import { createFormPeriodForSchools, updateFormPeriodForSchools } from '@/lib/api/form-periods';
import { getApplicationItems } from '@/lib/api/applications';
import type { SoudanPeriod, SoudanSettings } from '@/types/forms/soudan';
import type { ApplicationItem } from '@/types/database';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';

interface SoudanPeriodEditorProps {
  isOpen: boolean;
  period: SoudanPeriod | null;
  schoolId?: string;
  /** 複数教室に一括作成・更新する場合 */
  schoolIds?: string[];
  /** 編集時に更新対象を選ぶための教室一覧（id, name） */
  allowedSchools?: { id: string; name: string }[];
  onClose: () => void;
  onSuccess: () => void;
}

const DEFAULT_DESCRIPTION = `日頃より当塾をご利用いただき、誠にありがとうございます。

お気づきの点やご要望、ご不明な点などがございましたら、お気軽にお申し付けください。
いただいたご意見は、サービス向上のため真摯に受け止め、改善に努めてまいります。

※回答までに数日いただく場合がございます。`;

const DEFAULT_CATEGORIES = `料金について
講師について
教室長について
授業について
その他`;

export function SoudanPeriodEditor({
  isOpen,
  period,
  schoolId,
  schoolIds,
  allowedSchools,
  onClose,
  onSuccess,
}: SoudanPeriodEditorProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [applyToAllSchools, setApplyToAllSchools] = useState(true);
  const [selectedSchoolIdsForUpdate, setSelectedSchoolIdsForUpdate] = useState<string[]>([]);
  const [selectedSchoolIdsForCreate, setSelectedSchoolIdsForCreate] = useState<string[]>([]);

  // フォームデータ
  const [periodKey, setPeriodKey] = useState('');
  const [title, setTitle] = useState('お客様相談');
  const [description, setDescription] = useState(DEFAULT_DESCRIPTION);
  const [categoriesText, setCategoriesText] = useState(DEFAULT_CATEGORIES);
  const [publishStart, setPublishStart] = useState('');
  const [publishEnd, setPublishEnd] = useState('');
  const [completionMessage, setCompletionMessage] = useState(
    'ご相談を受け付けました。\n内容を確認の上、担当者よりご連絡させていただきます。'
  );
  const [linkedApplicationItemId, setLinkedApplicationItemId] = useState<string>('');
  const [applicationItems, setApplicationItems] = useState<ApplicationItem[]>([]);

  // 期間キーの自動生成（YYYY-MM形式）
  const generatePeriodKey = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  };

  // 公開開始日のデフォルト（今の日時・YYYY-MM-DDTHH:mm）
  const getDefaultPublishStart = () => {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return now.toISOString().slice(0, 16);
  };

  // 相談区分をパース
  const parseCategories = (text: string): string[] => {
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
      if (period) {
        // 編集モード
        const settings = period.settings;
        setPeriodKey(period.period_key);
        setTitle(period.title);
        setDescription(settings.description || DEFAULT_DESCRIPTION);
        setCategoriesText(settings.categories?.join('\n') || DEFAULT_CATEGORIES);
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
        setCompletionMessage(settings.completion_message || 'ご相談を受け付けました。\n内容を確認の上、担当者よりご連絡させていただきます。');
        setLinkedApplicationItemId(period.linked_application_item_id || '');
      } else {
        // 新規作成モード（公開開始日はデフォルトで「今」＝保存後すぐ公開）
        setPeriodKey(generatePeriodKey());
        setTitle('お客様相談');
        setDescription(DEFAULT_DESCRIPTION);
        setCategoriesText(DEFAULT_CATEGORIES);
        setPublishStart(getDefaultPublishStart());
        setPublishEnd('');
        setCompletionMessage('ご相談を受け付けました。\n内容を確認の上、担当者よりご連絡させていただきます。');
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
    const categories = parseCategories(categoriesText);
    if (categories.length === 0) {
      setError('相談区分を1つ以上入力してください');
      return false;
    }
    setError('');
    return true;
  };

  // 保存処理
  const handleSave = async () => {
    if (!validate()) return;
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
    setError('');

    try {
      const settings: SoudanSettings = {
        description: description.trim(),
        categories: parseCategories(categoriesText),
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
            'soudan',
            period.period_key,
            baseData
          );
        } else {
          await updateSoudanPeriod(period.id, baseData);
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
            form_type: 'soudan',
          });
        } else if (idsToCreate && idsToCreate.length === 1) {
          await createSoudanPeriod(createData, idsToCreate[0]);
        } else {
          await createSoudanPeriod(createData, schoolId);
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
      title={period ? 'お客様相談 期間編集' : 'お客様相談 期間作成'}
      size="lg"
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
                期間キー <span className="text-red-500">*</span>
              </label>
              <Input
                type="text"
                value={periodKey}
                onChange={(e) => setPeriodKey(e.target.value)}
                placeholder="例: 2026-01"
                disabled={!!period}
                className="disabled:bg-gray-100"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 text-[#1f2937]">
                タイトル <span className="text-red-500">*</span>
              </label>
              <Input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例: お客様相談"
              />
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-1 text-[#1f2937]">説明文</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="フォーム上部に表示される説明文"
              rows={5}
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

        {/* 相談区分 */}
        <section>
          <h3 className="text-sm font-semibold text-[#1f2937] mb-3 border-b border-[#e5e7eb] pb-1">
            相談区分
          </h3>

          <div>
            <label className="block text-sm font-medium mb-1 text-[#1f2937]">
              相談区分（改行区切り） <span className="text-red-500">*</span>
            </label>
            <textarea
              value={categoriesText}
              onChange={(e) => setCategoriesText(e.target.value)}
              placeholder="料金について&#10;講師について&#10;..."
              rows={5}
              className="w-full border border-[#e5e7eb] rounded-lg px-3 py-2 resize-y font-mono text-sm"
            />
            <p className="text-xs text-[#4b5563]/60 mt-1">1行に1項目ずつ入力してください</p>
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
              rows={3}
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
