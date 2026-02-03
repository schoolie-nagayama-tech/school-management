'use client';

import { useState, useEffect } from 'react';
import { Modal, Input, Button } from '@/components/ui';
import { createSoudanPeriod, updateSoudanPeriod } from '@/lib/api/soudan';
import type { SoudanPeriod, SoudanSettings } from '@/types/forms/soudan';

interface SoudanPeriodEditorProps {
  isOpen: boolean;
  period: SoudanPeriod | null;
  schoolId?: string;
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
  onClose,
  onSuccess,
}: SoudanPeriodEditorProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

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
      } else {
        // 新規作成モード（公開開始日はデフォルトで「今」＝保存後すぐ公開）
        setPeriodKey(generatePeriodKey());
        setTitle('お客様相談');
        setDescription(DEFAULT_DESCRIPTION);
        setCategoriesText(DEFAULT_CATEGORIES);
        setPublishStart(getDefaultPublishStart());
        setPublishEnd('');
        setCompletionMessage('ご相談を受け付けました。\n内容を確認の上、担当者よりご連絡させていただきます。');
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

    setIsSubmitting(true);
    setError('');

    try {
      const settings: SoudanSettings = {
        description: description.trim(),
        categories: parseCategories(categoriesText),
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
        await updateSoudanPeriod(period.id, data);
      } else {
        await createSoudanPeriod(data, schoolId);
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
