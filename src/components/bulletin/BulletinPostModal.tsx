'use client';

import { useState, useEffect } from 'react';
import type { BulletinPost, BulletinLabel } from '@/types/bulletin';
import { Modal } from '@/components/ui';
import { Button, Input } from '@/components/ui';

interface BulletinPostModalProps {
  isOpen: boolean;
  onClose: () => void;
  post?: BulletinPost | null;
  labels: BulletinLabel[];
  onSaved: () => void;
}

export function BulletinPostModal({
  isOpen,
  onClose,
  post,
  labels,
  schoolId,
  onSaved,
}: BulletinPostModalProps) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [labelId, setLabelId] = useState<string | null>(null);
  const [isPinned, setIsPinned] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  const handleSubmit = async () => {
    if (!title.trim() || !content.trim()) {
      return;
    }

    setIsSubmitting(true);
    try {
      const { createBulletinPost, updateBulletinPost } = await import('@/lib/api/bulletin');
      const { supabase } = await import('@/lib/supabase');

      // 現在のユーザーIDを取得
      const { data: { user } } = await supabase.auth.getUser();
      const userId = user?.id;

      if (post) {
        // 更新
        await updateBulletinPost(post.id, {
          title: title.trim(),
          content: content.trim(),
          label_id: labelId,
          is_pinned: isPinned,
        }, userId);
      } else {
        // 作成
        await createBulletinPost(
          schoolId,
          {
            title: title.trim(),
            content: content.trim(),
            label_id: labelId,
            is_pinned: isPinned,
          },
          userId
        );
      }

      onSaved();
      onClose();
    } catch (error) {
      console.error('Error saving post:', error);
      alert('保存に失敗しました');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={post ? '投稿を編集' : '新規投稿'}>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-[#0d0d0d] mb-1">
            タイトル <span className="text-[#d9376e]">*</span>
          </label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="タイトルを入力"
            className="w-full"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-[#0d0d0d] mb-1">
            ラベル
          </label>
          <select
            value={labelId || ''}
            onChange={(e) => setLabelId(e.target.value || null)}
            className="w-full px-3 py-2 border border-[#0d0d0d] rounded-lg text-sm bg-[#fffffe] text-[#2a2a2a] focus:ring-2 focus:ring-[#ff8e3c] focus:border-[#ff8e3c]"
          >
            <option value="">ラベルなし</option>
            {labels.map((label) => (
              <option key={label.id} value={label.id}>
                {label.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-[#0d0d0d] mb-1">
            本文 <span className="text-[#d9376e]">*</span>
          </label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="本文を入力"
            rows={8}
            className="w-full px-3 py-2 border border-[#0d0d0d] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#ff8e3c] resize-none"
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
          <label htmlFor="isPinned" className="text-sm text-[#0d0d0d]">
            ピン留めする
          </label>
        </div>

        <div className="flex justify-end gap-2">
          <Button onClick={onClose} variant="ghost">
            キャンセル
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!title.trim() || !content.trim() || isSubmitting}
          >
            {isSubmitting ? '保存中...' : '保存'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
