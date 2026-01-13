'use client';

import { useState, useEffect } from 'react';
import { Modal, Input, Button, Select } from '@/components/ui';
import { createMoshiPeriod, updateMoshiPeriod } from '@/lib/api/moshi';
import { getApplicationItems } from '@/lib/api/applications';
import { getDefaultSchoolId } from '@/lib/api/schools';
import type { MoshiPeriod, MoshiSettings } from '@/types/forms/moshi';
import type { ApplicationItem } from '@/types/database';

interface MoshiPeriodEditorProps {
  isOpen: boolean;
  period: MoshiPeriod | null;
  onClose: () => void;
  onSuccess: () => void;
}

const ALL_GRADES = ['小4', '小5', '小6', '中1', '中2', '中3'];

export function MoshiPeriodEditor({
  isOpen,
  period,
  onClose,
  onSuccess,
}: MoshiPeriodEditorProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  // フォームデータ
  const [periodKey, setPeriodKey] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [publishStart, setPublishStart] = useState('');
  const [publishEnd, setPublishEnd] = useState('');
  const [selectedGrades, setSelectedGrades] = useState<string[]>(ALL_GRADES);
  const [examDate, setExamDate] = useState('');
  const [examTime, setExamTime] = useState('');
  const [furikaeEnabled, setFurikaeEnabled] = useState(true);
  const [furikaeNote, setFurikaeNote] = useState('振替受験は平日のみとなります。');
  const [elementaryTime, setElementaryTime] = useState('約2時間');
  const [middleTime, setMiddleTime] = useState('約3時間');
  const [completionMessage, setCompletionMessage] = useState('お申し込みありがとうございます。');
  const [linkedApplicationItemId, setLinkedApplicationItemId] = useState<string>('');
  const [applicationItems, setApplicationItems] = useState<ApplicationItem[]>([]);

  // 期間キーの自動生成（YYYY-MM形式）
  const generatePeriodKey = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  };

  // 日付ラベルを生成
  const formatDateLabel = (dateStr: string): string => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const dayOfWeek = ['日', '月', '火', '水', '木', '金', '土'][date.getDay()];
    return `${month}月${day}日（${dayOfWeek}）`;
  };

  // 初期値の設定
  useEffect(() => {
    if (isOpen) {
      const schoolId = getDefaultSchoolId();
      // 申込項目を取得
      getApplicationItems(schoolId, true).then(setApplicationItems).catch(console.error);

      if (period) {
        // 編集モード
        const settings = period.settings;
        setPeriodKey(period.period_key);
        setTitle(period.title);
        setDescription(settings.description || '');
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
        setSelectedGrades(settings.grades || ALL_GRADES);
        setExamDate(settings.exam_date || '');
        setExamTime(settings.exam_time || '');
        setFurikaeEnabled(settings.furikae?.enabled ?? true);
        setFurikaeNote(settings.furikae?.note || '振替受験は平日のみとなります。');
        setElementaryTime(settings.furikae?.time_guide?.elementary || '約2時間');
        setMiddleTime(settings.furikae?.time_guide?.middle || '約3時間');
        setCompletionMessage(settings.completion_message || 'お申し込みありがとうございます。');
        setLinkedApplicationItemId(period.linked_application_item_id || '');
      } else {
        // 新規作成モード
        setPeriodKey(generatePeriodKey());
        setTitle('');
        setDescription('');
        setPublishStart('');
        setPublishEnd('');
        setSelectedGrades(ALL_GRADES);
        setExamDate('');
        setExamTime('');
        setFurikaeEnabled(true);
        setFurikaeNote('振替受験は平日のみとなります。');
        setElementaryTime('約2時間');
        setMiddleTime('約3時間');
        setCompletionMessage('お申し込みありがとうございます。');
        setLinkedApplicationItemId('');
      }
      setError('');
    }
  }, [isOpen, period]);

  // 学年の選択切り替え
  const toggleGrade = (grade: string) => {
    setSelectedGrades((prev) =>
      prev.includes(grade)
        ? prev.filter((g) => g !== grade)
        : [...prev, grade]
    );
  };

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
    if (!examDate) {
      setError('受験日を入力してください');
      return false;
    }
    if (!examTime.trim()) {
      setError('受験時間を入力してください');
      return false;
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

    setIsSubmitting(true);
    setError('');

    try {
      const settings: MoshiSettings = {
        description: description.trim(),
        grades: selectedGrades,
        exam_date: examDate,
        exam_date_label: formatDateLabel(examDate),
        exam_time: examTime.trim(),
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

      const data = {
        period_key: periodKey.trim(),
        title: title.trim(),
        settings,
        publish_start: publishStart || null,
        publish_end: publishEnd || null,
        linked_application_item_id: linkedApplicationItemId || null,
      };

      if (period) {
        await updateMoshiPeriod(period.id, data);
      } else {
        await createMoshiPeriod(data);
      }

      onSuccess();
      onClose();
    } catch (error) {
      console.error('Failed to save:', error);
      setError(
        error instanceof Error ? error.message : '保存に失敗しました'
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
      title={period ? '模試申込 期間編集' : '模試申込 期間作成'}
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
          <h3 className="text-sm font-semibold text-[#0d0d0d] mb-3 border-b border-[#0d0d0d] pb-1">
            基本情報
          </h3>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium mb-1 text-[#0d0d0d]">
                期間キー <span className="text-red-500">*</span>
              </label>
              <Input
                type="text"
                value={periodKey}
                onChange={(e) => setPeriodKey(e.target.value)}
                placeholder="例: 2026-02"
                disabled={!!period}
                className="disabled:bg-gray-100"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 text-[#0d0d0d]">
                タイトル <span className="text-red-500">*</span>
              </label>
              <Input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例: 2月度 模試申込"
              />
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-1 text-[#0d0d0d]">説明文</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="フォーム上部に表示される説明文"
              rows={3}
              className="w-full border border-[#0d0d0d] rounded-lg px-3 py-2 resize-y text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1 text-[#0d0d0d]">公開開始</label>
              <Input
                type="datetime-local"
                value={publishStart}
                onChange={(e) => setPublishStart(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 text-[#0d0d0d]">公開終了</label>
              <Input
                type="datetime-local"
                value={publishEnd}
                onChange={(e) => setPublishEnd(e.target.value)}
              />
              <p className="text-xs text-[#2a2a2a]/60 mt-1">
                ※空欄にすると永続的に公開されます
              </p>
            </div>
          </div>
        </section>

        {/* 受験日時 */}
        <section>
          <h3 className="text-sm font-semibold text-[#0d0d0d] mb-3 border-b border-[#0d0d0d] pb-1">
            受験日時
          </h3>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1 text-[#0d0d0d]">
                受験日 <span className="text-red-500">*</span>
              </label>
              <Input
                type="date"
                value={examDate}
                onChange={(e) => setExamDate(e.target.value)}
              />
              {examDate && (
                <p className="text-sm text-[#2a2a2a] mt-1">
                  → {formatDateLabel(examDate)}
                </p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 text-[#0d0d0d]">
                受験時間 <span className="text-red-500">*</span>
              </label>
              <Input
                type="text"
                value={examTime}
                onChange={(e) => setExamTime(e.target.value)}
                placeholder="例: 10:00〜13:00"
              />
            </div>
          </div>
        </section>

        {/* 対象学年 */}
        <section>
          <h3 className="text-sm font-semibold text-[#0d0d0d] mb-3 border-b border-[#0d0d0d] pb-1">
            対象学年
          </h3>

          <div className="flex flex-wrap gap-2">
            {ALL_GRADES.map((grade) => (
              <label
                key={grade}
                className={`px-4 py-2 rounded-lg border cursor-pointer transition-colors ${
                  selectedGrades.includes(grade)
                    ? 'bg-[#ff8e3c] text-white border-[#ff8e3c]'
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
          <h3 className="text-sm font-semibold text-[#0d0d0d] mb-3 border-b border-[#0d0d0d] pb-1">
            振替受験設定
          </h3>

          <label className="flex items-center gap-2 mb-4 cursor-pointer">
            <input
              type="checkbox"
              checked={furikaeEnabled}
              onChange={(e) => setFurikaeEnabled(e.target.checked)}
              className="rounded border-gray-300"
            />
            <span className="text-sm text-[#0d0d0d]">振替受験を許可する</span>
          </label>

          {furikaeEnabled && (
            <div className="pl-6 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1 text-[#0d0d0d]">注意事項</label>
                <Input
                  type="text"
                  value={furikaeNote}
                  onChange={(e) => setFurikaeNote(e.target.value)}
                  placeholder="振替受験は平日のみとなります。"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1 text-[#0d0d0d]">
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
                  <label className="block text-sm font-medium mb-1 text-[#0d0d0d]">
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
          <h3 className="text-sm font-semibold text-[#0d0d0d] mb-3 border-b border-[#0d0d0d] pb-1">
            その他
          </h3>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-1 text-[#0d0d0d]">完了メッセージ</label>
            <textarea
              value={completionMessage}
              onChange={(e) => setCompletionMessage(e.target.value)}
              rows={2}
              className="w-full border border-[#0d0d0d] rounded-lg px-3 py-2 resize-y text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 text-[#0d0d0d]">
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

        {/* フッター */}
        <div className="flex justify-end gap-3 pt-4 border-t border-[#0d0d0d]">
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
