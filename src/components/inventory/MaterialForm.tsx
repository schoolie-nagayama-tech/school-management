'use client';

import { useState } from 'react';
import { Modal, Button, Input } from '@/components/ui';
import type { Material } from '@/types/database';

interface MaterialFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: MaterialFormData) => Promise<void>;
  material?: Material | null;
}

export interface MaterialFormData {
  name: string;
  description: string;
  category: string;
  unit: string;
  low_stock_threshold: number;
}

const CATEGORY_SUGGESTIONS = [
  'テキスト',
  'プリント',
  '文房具',
  'ノート',
  '参考書',
  '問題集',
  'その他',
];

export function MaterialForm({
  isOpen,
  onClose,
  onSubmit,
  material,
}: MaterialFormProps) {
  const [name, setName] = useState(material?.name || '');
  const [description, setDescription] = useState(material?.description || '');
  const [category, setCategory] = useState(material?.category || '');
  const [unit, setUnit] = useState(material?.unit || '冊');
  const [lowStockThreshold, setLowStockThreshold] = useState(
    material?.low_stock_threshold ?? 5
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);

  const isEditing = !!material;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('名前は必須です');
      return;
    }

    setIsSubmitting(true);
    setError('');
    try {
      await onSubmit({
        name: name.trim(),
        description: description.trim(),
        category: category.trim(),
        unit: unit.trim() || '冊',
        low_stock_threshold: lowStockThreshold,
      });
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : '保存に失敗しました'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredSuggestions = CATEGORY_SUGGESTIONS.filter(
    (s) => s.includes(category) && s !== category
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? '教材を編集' : '教材を追加'}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="bg-[#ef4444]/20 text-[#ef4444] px-4 py-2 rounded border border-[#ef4444] text-sm">
            {error}
          </div>
        )}

        <Input
          label="名前"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="教材名を入力"
        />

        <div className="w-full">
          <label className="block text-sm font-medium text-[#1f2937] mb-1">
            説明
          </label>
          <textarea
            className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg bg-white text-[#4b5563] placeholder-[#4b5563]/40 transition-colors duration-150 focus:ring-2 focus:ring-[#3b82f6] focus:border-[#3b82f6]"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="説明（任意）"
          />
        </div>

        <div className="relative">
          <Input
            label="カテゴリ"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => {
              // 少し遅延させてクリックイベントを先に処理する
              setTimeout(() => setShowSuggestions(false), 200);
            }}
            placeholder="カテゴリを入力"
          />
          {showSuggestions && filteredSuggestions.length > 0 && (
            <div className="absolute z-10 w-full mt-1 bg-white border border-[#e5e7eb] rounded-lg shadow-lg max-h-40 overflow-y-auto">
              {filteredSuggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  className="w-full text-left px-3 py-2 text-sm text-[#4b5563] hover:bg-[#f3f4f6] transition-colors duration-150"
                  onClick={() => {
                    setCategory(suggestion);
                    setShowSuggestions(false);
                  }}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}
        </div>

        <Input
          label="単位"
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          placeholder="冊"
        />

        <Input
          label="在庫不足閾値"
          type="number"
          min={0}
          value={String(lowStockThreshold)}
          onChange={(e) => setLowStockThreshold(Number(e.target.value) || 0)}
        />

        <div className="flex justify-end gap-3 pt-4 border-t border-[#e5e7eb]">
          <Button variant="secondary" type="button" onClick={onClose}>
            キャンセル
          </Button>
          <Button type="submit" isLoading={isSubmitting}>
            {isEditing ? '更新' : '追加'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
