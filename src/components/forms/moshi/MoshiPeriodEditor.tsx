'use client';

import { useState, useEffect } from 'react';
import { Modal, Input, Button, Select } from '@/components/ui';
import { createMoshiPeriod, updateMoshiPeriod } from '@/lib/api/moshi';
import {
  createFormPeriodForSchools,
  updateFormPeriodForSchools,
  generateUniquePeriodKey,
  getNextPeriodKey,
} from '@/lib/api/form-periods';
import { getApplicationItems } from '@/lib/api/applications';
import type { MoshiExamDate, MoshiPeriod, MoshiSettings } from '@/types/forms/moshi';
import type { ApplicationItem } from '@/types/database';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';
import { formatMoshiDateLabel, getMoshiExamDates } from '@/lib/utils/moshiExamDates';
import { Plus, Trash2 } from 'lucide-react';

interface MoshiPeriodEditorProps {
  isOpen: boolean;
  period: MoshiPeriod | null;
  schoolId?: string;
  /** 複数教室に一括作成・更新する場合 */
  schoolIds?: string[];
  /** 編集時に更新対象を選ぶための教室一覧（id, name） */
  allowedSchools?: { id: string; name: string }[];
  onClose: () => void;
  onSuccess: () => void;
}

const ALL_GRADES = ['小4', '小5', '小6', '中1', '中2', '中3'];

// 編集中の試験日程1行。label は保存時に日付から作るのでここでは持たない
type ExamDateRow = { id: string; date: string; time: string };

const newExamDateRow = (): ExamDateRow => ({ id: crypto.randomUUID(), date: '', time: '' });

export function MoshiPeriodEditor({
  isOpen,
  period,
  schoolId,
  schoolIds,
  allowedSchools,
  onClose,
  onSuccess,
}: MoshiPeriodEditorProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [applyToAllSchools, setApplyToAllSchools] = useState(true);
  const [selectedSchoolIdsForUpdate, setSelectedSchoolIdsForUpdate] = useState<string[]>([]);
  const [selectedSchoolIdsForCreate, setSelectedSchoolIdsForCreate] = useState<string[]>([]);

  // フォームデータ
  const [periodKey, setPeriodKey] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [publishStart, setPublishStart] = useState('');
  const [publishEnd, setPublishEnd] = useState('');
  const [selectedGrades, setSelectedGrades] = useState<string[]>(ALL_GRADES);
  const [examDates, setExamDates] = useState<ExamDateRow[]>([newExamDateRow()]);
  const [furikaeEnabled, setFurikaeEnabled] = useState(true);
  const [furikaeNote, setFurikaeNote] = useState('振替受験は平日のみとなります。');
  const [elementaryTime, setElementaryTime] = useState('約2時間');
  const [middleTime, setMiddleTime] = useState('約3時間');
  const [completionMessage, setCompletionMessage] = useState('お申し込みありがとうございます。');
  const [linkedApplicationItemId, setLinkedApplicationItemId] = useState<string>('');
  const [applicationItems, setApplicationItems] = useState<ApplicationItem[]>([]);

  // 初期値の設定
  useEffect(() => {
    if (isOpen) {
      // 申込項目を取得（選択中の教室のものを取得）
      const targetIds =
        schoolIds && schoolIds.length > 0 ? schoolIds : schoolId ? [schoolId] : undefined;
      getApplicationItems(targetIds, true).then(setApplicationItems).catch(console.error);

      if (period) {
        // 編集モード
        const settings = period.settings;
        setPeriodKey(period.period_key);
        setTitle(period.title);
        setDescription(settings.description || '');
        setPublishStart(
          period.publish_start ? new Date(period.publish_start).toISOString().slice(0, 16) : ''
        );
        setPublishEnd(
          period.publish_end ? new Date(period.publish_end).toISOString().slice(0, 16) : ''
        );
        setSelectedGrades(settings.grades || ALL_GRADES);
        // 旧データ（単一日程）も getMoshiExamDates が1件の配列にしてくれる
        const loaded = getMoshiExamDates(settings).map((d) => ({
          id: d.id,
          date: d.date,
          time: d.time || '',
        }));
        setExamDates(loaded.length > 0 ? loaded : [newExamDateRow()]);
        setFurikaeEnabled(settings.furikae?.enabled ?? true);
        setFurikaeNote(settings.furikae?.note || '振替受験は平日のみとなります。');
        setElementaryTime(settings.furikae?.time_guide?.elementary || '約2時間');
        setMiddleTime(settings.furikae?.time_guide?.middle || '約3時間');
        setCompletionMessage(settings.completion_message || 'お申し込みありがとうございます。');
        setLinkedApplicationItemId(period.linked_application_item_id || '');
      } else {
        // 新規作成モード — 期間キーは自動生成（YYYY-MM、衝突時は連番）
        setPeriodKey(generateUniquePeriodKey([]));
        getNextPeriodKey('moshi', targetIds ?? [])
          .then(setPeriodKey)
          .catch(() => {});
        setTitle('');
        setDescription('');
        setPublishStart('');
        setPublishEnd('');
        setSelectedGrades(ALL_GRADES);
        setExamDates([newExamDateRow()]);
        setFurikaeEnabled(true);
        setFurikaeNote('振替受験は平日のみとなります。');
        setElementaryTime('約2時間');
        setMiddleTime('約3時間');
        setCompletionMessage('お申し込みありがとうございます。');
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
  }, [isOpen, period, allowedSchools]);

  // 学年の選択切り替え
  const toggleGrade = (grade: string) => {
    setSelectedGrades((prev) =>
      prev.includes(grade) ? prev.filter((g) => g !== grade) : [...prev, grade]
    );
  };

  // 試験日程の行操作
  const updateExamDate = (id: string, patch: Partial<ExamDateRow>) => {
    setExamDates((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const addExamDate = () => {
    setExamDates((prev) => [...prev, newExamDateRow()]);
  };

  const removeExamDate = (id: string) => {
    // 最低1行は残す（0行だと保存できないため）
    setExamDates((prev) => (prev.length <= 1 ? prev : prev.filter((row) => row.id !== id)));
  };

  // 日付が入っている行だけを保存対象にする（空行は捨てる）
  const filledExamDates = examDates.filter((row) => row.date);

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
    if (filledExamDates.length === 0) {
      setError('受験日を1つ以上入力してください');
      return false;
    }
    // 同じ日付＋同じ時間の行が並ぶと生徒側の選択肢が区別できなくなる
    const seen = new Set<string>();
    for (const row of filledExamDates) {
      const key = `${row.date}|${row.time.trim()}`;
      if (seen.has(key)) {
        setError(`受験日時が重複しています（${formatMoshiDateLabel(row.date)}）`);
        return false;
      }
      seen.add(key);
    }
    if (selectedGrades.length === 0) {
      setError('対象学年を1つ以上選択してください');
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
      // 日付昇順で正規化。ラベルは日付から作り直す
      const cleanedExamDates: MoshiExamDate[] = [...filledExamDates]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((row) => ({
          id: row.id,
          date: row.date,
          label: formatMoshiDateLabel(row.date),
          ...(row.time.trim() ? { time: row.time.trim() } : {}),
        }));

      // 旧フィールドには先頭日程を書く。
      // 通知メールの Edge Function など exam_date を直接読む箇所が残っているため、
      // 複数日程でも「最初の1件」は必ず有効な値が入っている状態を保つ。
      const primary = cleanedExamDates[0];

      const settings: MoshiSettings = {
        description: description.trim(),
        grades: selectedGrades,
        exam_dates: cleanedExamDates,
        exam_date: primary.date,
        exam_date_label: primary.label,
        exam_time: primary.time ?? '',
        furikae: {
          enabled: furikaeEnabled,
          note: furikaeNote.trim(),
          time_guide: {
            elementary: elementaryTime.trim(),
            middle: middleTime.trim(),
          },
          available_days: ['月', '火', '水', '木', '金'],
        },
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
          await updateFormPeriodForSchools(idsToUpdate, 'moshi', period.period_key, baseData);
        } else {
          await updateMoshiPeriod(period.id, baseData);
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
            form_type: 'moshi',
          });
        } else if (idsToCreate && idsToCreate.length === 1) {
          await createMoshiPeriod(createData, idsToCreate[0]);
        } else {
          await createMoshiPeriod(createData, schoolId);
        }
      }

      onSuccess();
      onClose();
    } catch (error) {
      console.error('Failed to save:', error);
      setError(getUserErrorMessage(error, '保存に失敗しました'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={period ? 'オープン模試申し込み 期間編集' : 'オープン模試申し込み 期間作成'}
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
              <label className="block text-sm font-medium mb-1 text-[#1f2937]">期間キー</label>
              <Input
                type="text"
                value={periodKey}
                readOnly
                disabled // 自動生成のため常に編集不可
                className="disabled:bg-gray-100"
              />
              <p className="text-xs text-[#4b5563]/60 mt-1">※ 自動で割り当てられます（変更不可）</p>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 text-[#1f2937]">
                タイトル <span className="text-red-500">*</span>
              </label>
              <Input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例: 2月度 オープン模試申し込み"
              />
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-1 text-[#1f2937]">説明文</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="フォーム上部に表示される説明文"
              rows={3}
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
              <p className="text-xs text-[#4b5563]/60 mt-1">※空欄にすると永続的に公開されます</p>
            </div>
          </div>
        </section>

        {/* 受験日時 */}
        <section>
          <h3 className="text-sm font-semibold text-[#1f2937] mb-3 border-b border-[#e5e7eb] pb-1">
            受験日時
          </h3>

          <p className="text-xs text-[#4b5563]/80 mb-3">
            複数登録すると、申込フォームで生徒がどの日程で受験するかを1つ選びます。
          </p>

          <div className="space-y-3">
            {examDates.map((row, index) => (
              <div key={row.id} className="flex items-start gap-3">
                <div className="flex-1">
                  {index === 0 && (
                    <label className="block text-sm font-medium mb-1 text-[#1f2937]">
                      受験日 <span className="text-red-500">*</span>
                    </label>
                  )}
                  <Input
                    type="date"
                    value={row.date}
                    onChange={(e) => updateExamDate(row.id, { date: e.target.value })}
                  />
                  {row.date && (
                    <p className="text-sm text-[#4b5563] mt-1">
                      → {formatMoshiDateLabel(row.date)}
                    </p>
                  )}
                </div>
                <div className="flex-1">
                  {index === 0 && (
                    <label className="block text-sm font-medium mb-1 text-[#1f2937]">時間</label>
                  )}
                  <Input
                    type="text"
                    value={row.time}
                    onChange={(e) => updateExamDate(row.id, { time: e.target.value })}
                    placeholder="例: 10:00〜13:00"
                  />
                </div>
                <div className={index === 0 ? 'pt-7' : ''}>
                  <button
                    type="button"
                    onClick={() => removeExamDate(row.id)}
                    disabled={examDates.length <= 1}
                    aria-label="この受験日時を削除"
                    className="p-2 text-[#6b7280] hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[#6b7280] disabled:cursor-not-allowed"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={addExamDate}
            className="mt-3 inline-flex items-center gap-1.5 text-sm text-[#3b82f6] hover:text-[#2563eb] font-medium"
          >
            <Plus className="w-4 h-4" />
            受験日時を追加
          </button>
        </section>

        {/* 対象学年 */}
        <section>
          <h3 className="text-sm font-semibold text-[#1f2937] mb-3 border-b border-[#e5e7eb] pb-1">
            対象学年
          </h3>

          <div className="flex flex-wrap gap-2">
            {ALL_GRADES.map((grade) => (
              <label
                key={grade}
                className={`px-4 py-2 rounded-lg border cursor-pointer transition-colors duration-150 ${
                  selectedGrades.includes(grade)
                    ? 'bg-[#3b82f6] text-white border-[#3b82f6]'
                    : 'bg-white hover:bg-gray-50 border-gray-300'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedGrades.includes(grade)}
                  onChange={() => toggleGrade(grade)}
                  className="sr-only"
                />
                {grade}
              </label>
            ))}
          </div>
        </section>

        {/* 振替設定 */}
        <section>
          <h3 className="text-sm font-semibold text-[#1f2937] mb-3 border-b border-[#e5e7eb] pb-1">
            振替受験設定
          </h3>

          <label className="flex items-center gap-2 mb-4 cursor-pointer">
            <input
              type="checkbox"
              checked={furikaeEnabled}
              onChange={(e) => setFurikaeEnabled(e.target.checked)}
              className="rounded border-gray-300"
            />
            <span className="text-sm text-[#1f2937]">振替受験を許可する</span>
          </label>

          {furikaeEnabled && (
            <div className="pl-6 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1 text-[#1f2937]">注意事項</label>
                <Input
                  type="text"
                  value={furikaeNote}
                  onChange={(e) => setFurikaeNote(e.target.value)}
                  placeholder="振替受験は平日のみとなります。"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1 text-[#1f2937]">
                    小学生の目安時間
                  </label>
                  <Input
                    type="text"
                    value={elementaryTime}
                    onChange={(e) => setElementaryTime(e.target.value)}
                    placeholder="例: 約2時間"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 text-[#1f2937]">
                    中学生の目安時間
                  </label>
                  <Input
                    type="text"
                    value={middleTime}
                    onChange={(e) => setMiddleTime(e.target.value)}
                    placeholder="例: 約3時間"
                  />
                </div>
              </div>
            </div>
          )}
        </section>

        {/* 完了メッセージ・紐付け */}
        <section>
          <h3 className="text-sm font-semibold text-[#1f2937] mb-3 border-b border-[#e5e7eb] pb-1">
            その他
          </h3>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-1 text-[#1f2937]">完了メッセージ</label>
            <textarea
              value={completionMessage}
              onChange={(e) => setCompletionMessage(e.target.value)}
              rows={2}
              className="w-full border border-[#e5e7eb] rounded-lg px-3 py-2 resize-y text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 text-[#1f2937]">
              申込状況項目との紐付け
            </label>
            <Select
              value={linkedApplicationItemId}
              onChange={(e) => setLinkedApplicationItemId(e.target.value)}
              options={[
                { value: '', label: '紐付けなし' },
                ...applicationItems.map((item) => ({
                  value: item.id,
                  label: item.name,
                })),
              ]}
            />
          </div>
        </section>

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
