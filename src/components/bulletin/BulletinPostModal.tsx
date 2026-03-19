'use client';

import { useState, useEffect } from 'react';
import type { BulletinPost, BulletinLabel } from '@/types/bulletin';
import type { School } from '@/types/database';
import { Modal, Button, Input, RichTextEditor } from '@/components/ui';

interface BulletinPostModalProps {
  isOpen: boolean;
  onClose: () => void;
  post?: BulletinPost | null;
  labels: BulletinLabel[];
  schoolId: string;
  /** 複数教室時に投稿先を選択するための教室一覧 */
  schoolIds?: string[];
  schools?: School[];
  /** 新規投稿時の投稿先（複数選択可） */
  selectedSchoolIds?: string[];
  onSelectedSchoolIdsChange?: (ids: string[]) => void;
  onSaved: () => void;
}

export function BulletinPostModal({
  isOpen,
  onClose,
  post,
  labels,
  schoolId,
  schoolIds,
  schools = [],
  selectedSchoolIds = [],
  onSelectedSchoolIdsChange,
  onSaved,
}: BulletinPostModalProps) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [labelId, setLabelId] = useState<string | null>(null);
  const [isPinned, setIsPinned] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const availableSchools = schools.filter((s) => schoolIds?.includes(s.id)) ?? [];
  const allSelected = availableSchools.length > 0 && selectedSchoolIds.length >= availableSchools.length;

  useEffect(() => {
    if (post) {
      setTitle(post.title);
      setContent(post.content);
      setLabelId(post.label_id);
      setIsPinned(post.is_pinned);
    } else {
      setTitle('');
      setContent('');
      setLabelId(null);
      setIsPinned(false);
    }
  }, [post, isOpen]);

  const isContentEmpty = (html: string) => {
    const text = html.replace(/<[^>]*>/g, '').trim();
    return text.length === 0;
  };

  const handleSubmit = async () => {
    if (!title.trim() || isContentEmpty(content)) {
      return;
    }

    const targetSchoolIds = post ? [post.school_id] : (selectedSchoolIds.length > 0 ? selectedSchoolIds : [schoolId]);
    if (targetSchoolIds.length === 0) {
      setErrorMessage('投稿先の教室を1つ以上選択してください');
      return;
    }

    setIsSubmitting(true);
    try {
      const { createBulletinPost, updateBulletinPost } = await import('@/lib/api/bulletin');
      const { supabase } = await import('@/lib/supabase');

      const { data: { user } } = await supabase.auth.getUser();
      const userId = user?.id;

        if (post) {
        await updateBulletinPost(post.id, {
          title: title.trim(),
          content: content,
          label_id: labelId,
          is_pinned: isPinned,
        }, userId);
      } else {
        const payload = {
          title: title.trim(),
          content,
          label_id: targetSchoolIds.length === 1 ? labelId : null,
          is_pinned: isPinned,
        };
        for (const sid of targetSchoolIds) {
          await createBulletinPost(sid, payload, userId);
        }
      }

      onSaved();
      onClose();
    } catch (error) {
      console.error('Error saving post:', error);
      setErrorMessage('保存に失敗しました');
    } finally {
      setIsSubmitting(false);
    }
  };

  const showSchoolSelector = !post && schoolIds && schoolIds.length > 1 && availableSchools.length > 0;

  const toggleSchool = (id: string) => {
    if (selectedSchoolIds.includes(id)) {
      onSelectedSchoolIdsChange?.(selectedSchoolIds.filter((s) => s !== id));
    } else {
      onSelectedSchoolIdsChange?.([...selectedSchoolIds, id]);
    }
  };

  const toggleSelectAll = () => {
    if (allSelected) {
      onSelectedSchoolIdsChange?.([]);
    } else {
      onSelectedSchoolIdsChange?.(availableSchools.map((s) => s.id));
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={post ? '投稿を編集' : '新規投稿'}>
      <div className="space-y-4">
        {errorMessage && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {errorMessage}
          </div>
        )}
        {showSchoolSelector && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-[#1f2937]">投稿先の教室</label>
              <button
                type="button"
                onClick={toggleSelectAll}
                className="text-xs text-[#1e3a5f] hover:underline"
              >
                {allSelected ? 'すべて解除' : 'すべて選択'}
              </button>
            </div>
            <div className="space-y-1.5 max-h-40 overflow-y-auto border border-gray-200 rounded-lg p-2 bg-white">
              {availableSchools.map((s) => (
                <label
                  key={s.id}
                  className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 rounded px-2 py-1.5"
                >
                  <input
                    type="checkbox"
                    checked={selectedSchoolIds.includes(s.id)}
                    onChange={() => toggleSchool(s.id)}
                    className="w-4 h-4 rounded border-gray-300 text-[#1e3a5f] focus:ring-[#1e3a5f]"
                  />
                  <span className="text-sm text-[#1f2937]">
                    {s.code === 'DEFAULT' ? 'デフォルト' : s.name}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}
        <div>
          <label className="block text-sm font-medium text-[#1f2937] mb-1">
            タイトル <span className="text-[#ef4444]">*</span>
          </label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="タイトルを入力"
            className="w-full"
          />
        </div>

        {(!showSchoolSelector || selectedSchoolIds.length <= 1) && (
          <div>
            <label className="block text-sm font-medium text-[#1f2937] mb-1">
              ラベル
            </label>
            <select
              value={labelId || ''}
              onChange={(e) => setLabelId(e.target.value || null)}
              className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm bg-white text-[#4b5563] focus:ring-2 focus:ring-[#3b82f6] focus:border-[#3b82f6]"
            >
              <option value="">ラベルなし</option>
              {labels.map((label) => (
                <option key={label.id} value={label.id}>
                  {label.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {showSchoolSelector && selectedSchoolIds.length > 1 && (
          <p className="text-xs text-gray-500">複数教室への投稿のため、ラベルは付きません。</p>
        )}

        <div>
          <label className="block text-sm font-medium text-[#1f2937] mb-1">
            本文 <span className="text-[#ef4444]">*</span>
          </label>
          <RichTextEditor
            key={post?.id ?? 'new'}
            value={content}
            onChange={setContent}
            placeholder="本文を入力（太字・見出しなどが使えます）"
            minHeight="200px"
          />
        </div>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="isPinned"
            checked={isPinned}
            onChange={(e) => setIsPinned(e.target.checked)}
            className="w-4 h-4"
          />
          <label htmlFor="isPinned" className="text-sm text-[#1f2937]">
            ピン留めする
          </label>
        </div>

        <div className="flex justify-end gap-2">
          <Button onClick={onClose} variant="ghost">
            キャンセル
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={
              !title.trim() ||
              isContentEmpty(content) ||
              isSubmitting ||
              (!post && showSchoolSelector && selectedSchoolIds.length === 0)
            }
          >
            {isSubmitting ? '保存中...' : '保存'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
