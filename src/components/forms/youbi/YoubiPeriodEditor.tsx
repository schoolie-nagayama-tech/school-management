'use client';

import { useState, useEffect } from 'react';
import { Modal, Input, Button } from '@/components/ui';
import { createYoubiPeriod, updateYoubiPeriod } from '@/lib/api/youbi';
import { getDefaultSchoolId } from '@/lib/api/schools';
import type { YoubiPeriod, YoubiSettings } from '@/types/forms/youbi';

interface YoubiPeriodEditorProps {
  isOpen: boolean;
  period: YoubiPeriod | null;
  onClose: () => void;
  onSuccess: () => void;
}

const DEFAULT_DESCRIPTION = `曜日・時間・科目の変更をご希望の方は、以下のフォームよりお申し込みください。
第2希望までご入力ください。

※変更が決まりましたら、Growにてご連絡いたします。`;

const DEFAULT_PERIODS = [
  { code: '4', label: '4限(14:25-15:55)' },
  { code: '5', label: '5限(16:20-17:50)' },
  { code: '6', label: '6限(18:00-19:30)' },
  { code: '7', label: '7限(19:40-21:10)' },
];

export function YoubiPeriodEditor({
  isOpen,
  period,
  onClose,
  onSuccess,
}: YoubiPeriodEditorProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  // フォームデータ
  const [periodKey, setPeriodKey] = useState('');
  const [title, setTitle] = useState('曜日変更');
  const [description, setDescription] = useState(DEFAULT_DESCRIPTION);
  const [daysText, setDaysText] = useState('月\n火\n水\n木\n金\n土');
  const [periodsText, setPeriodsText] = useState(
    DEFAULT_PERIODS.map((p) => `${p.code},${p.label}`).join('\n')
  );
  const [subjectsText, setSubjectsText] = useState('英語\n数学\n国語\n理科\n社会');
  const [publishStart, setPublishStart] = useState('');
  const [publishEnd, setPublishEnd] = useState('');
  const [completionMessage, setCompletionMessage] = useState(
    '変更申請を受け付けました。\n内容を確認の上、Growにてご連絡いたします。'
  );

  // 期間キーの自動生成（YYYY-MM形式）
  const generatePeriodKey = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  };

  // テキストをパース
  const parseLines = (text: string): string[] => {
    return text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  };

  const parsePeriods = (text: string): Array<{ code: string; label: string }> => {
    return parseLines(text).map((line) => {
      const [code, ...rest] = line.split(',');
      return { code: code.trim(), label: rest.join(',').trim() || code.trim() };
    });
  };

  // 初期値の設定
  useEffect(() => {
    if (isOpen) {
      if (period) {
        // 編集モード
        const settings = period.settings;
        setPeriodKey(period.period_key);
        setTitle(period.title);
        setDescription(settings.description || DEFAULT_DESCRIPTION);
        setDaysText(settings.available_days?.join('\n') || '月\n火\n水\n木\n金\n土');
        setPeriodsText(
          settings.available_periods?.map((p) => `${p.code},${p.label}`).join('\n') ||
          DEFAULT_PERIODS.map((p) => `${p.code},${p.label}`).join('\n')
        );
        setSubjectsText(settings.available_subjects?.join('\n') || '英語\n数学\n国語\n理科\n社会');
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
      } else {
        // 新規作成モード
        setPeriodKey(generatePeriodKey());
        setTitle('曜日変更');
        setDescription(DEFAULT_DESCRIPTION);
        setDaysText('月\n火\n水\n木\n金\n土');
        setPeriodsText(DEFAULT_PERIODS.map((p) => `${p.code},${p.label}`).join('\n'));
        setSubjectsText('英語\n数学\n国語\n理科\n社会');
        setPublishStart('');
        setPublishEnd('');
        setCompletionMessage('変更申請を受け付けました。\n内容を確認の上、Growにてご連絡いたします。');
      }
      setError('');
    }
  }, [isOpen, period]);

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
    if (parsePeriods(periodsText).length === 0) {
      setError('時限を入力してください');
      return false;
    }
    if (parseLines(subjectsText).length === 0) {
      setError('科目を入力してください');
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
        available_periods: parsePeriods(periodsText),
        available_subjects: parseLines(subjectsText),
        completion_message: completionMessage.trim(),
      };

      const data = {
        period_key: periodKey.trim(),
        title: title.trim(),
        settings,
        publish_start: publishStart || null,
        publish_end: publishEnd || null,
      };

      if (period) {
        await updateYoubiPeriod(period.id, data);
      } else {
        await createYoubiPeriod(data);
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
      title={period ? '曜日変更 期間編集' : '曜日変更 期間作成'}
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
                placeholder="例: 曜日変更"
              />
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-1 text-[#0d0d0d]">説明文</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="フォーム上部に表示される説明文"
              rows={4}
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

        {/* 選択肢設定 */}
        <section>
          <h3 className="text-sm font-semibold text-[#0d0d0d] mb-3 border-b border-[#0d0d0d] pb-1">
            選択肢設定
          </h3>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium mb-1 text-[#0d0d0d]">
                曜日（改行区切り） <span className="text-red-500">*</span>
              </label>
              <textarea
                value={daysText}
                onChange={(e) => setDaysText(e.target.value)}
                rows={6}
                className="w-full border border-[#0d0d0d] rounded-lg px-3 py-2 font-mono text-sm resize-y"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 text-[#0d0d0d]">
                科目（改行区切り） <span className="text-red-500">*</span>
              </label>
              <textarea
                value={subjectsText}
                onChange={(e) => setSubjectsText(e.target.value)}
                rows={6}
                className="w-full border border-[#0d0d0d] rounded-lg px-3 py-2 font-mono text-sm resize-y"
              />
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-1 text-[#0d0d0d]">
              時限（1行1時限: コード,ラベル） <span className="text-red-500">*</span>
            </label>
            <textarea
              value={periodsText}
              onChange={(e) => setPeriodsText(e.target.value)}
              placeholder="4,4限(14:25-15:55)&#10;5,5限(16:20-17:50)"
              rows={4}
              className="w-full border border-[#0d0d0d] rounded-lg px-3 py-2 font-mono text-sm resize-y"
            />
            <p className="text-xs text-[#2a2a2a]/60 mt-1">
              例: 4,4限(14:25-15:55) のように「コード,ラベル」の形式で1行に1時限ずつ入力
            </p>
          </div>
        </section>

        {/* 完了メッセージ */}
        <section>
          <h3 className="text-sm font-semibold text-[#0d0d0d] mb-3 border-b border-[#0d0d0d] pb-1">
            完了メッセージ
          </h3>

          <div>
            <label className="block text-sm font-medium mb-1 text-[#0d0d0d]">完了メッセージ</label>
            <textarea
              value={completionMessage}
              onChange={(e) => setCompletionMessage(e.target.value)}
              rows={2}
              className="w-full border border-[#0d0d0d] rounded-lg px-3 py-2 resize-y text-sm"
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
