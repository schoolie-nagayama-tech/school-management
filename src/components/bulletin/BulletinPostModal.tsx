'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import type { BulletinPost, BulletinLabel } from '@/types/bulletin';
import type { School } from '@/types/database';
import { Modal, Button, Input } from '@/components/ui';

const RichTextEditor = dynamic(
  () => import('@/components/ui/RichTextEditor').then((m) => m.RichTextEditor),
  {
    loading: () => (
      <div className="min-h-[200px] flex items-center justify-center text-sm text-gray-500 border rounded-lg">
        エディタを読み込み中...
      </div>
    ),
  }
);

/** date input(YYYY-MM-DD, ローカル) → ISO timestamp。開始は 00:00:00、終了は 23:59:59。 */
function dateToTimestamp(dateStr: string, boundary: 'start' | 'end'): string | null {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T${boundary === 'start' ? '00:00:00' : '23:59:59'}`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** ISO timestamp → date input(YYYY-MM-DD, ローカル) */
function timestampToDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface BulletinPostModalProps {
  isOpen: boolean;
  onClose: () => void;
  post?: BulletinPost | null;
  /**
   * 編集対象がまとめカード（複数教室への同報）の場合の、全教室分の投稿ID。
   * 指定時は編集内容（タイトル・本文・リンク・ピン留め）を全教室分へ反映する。
   * ラベルは教室ごとに異なるため代表（post.id）の教室のみ更新する。
   */
  groupPostIds?: string[];
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
  groupPostIds,
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
  const [linkUrl, setLinkUrl] = useState('');
  const [labelId, setLabelId] = useState<string | null>(null);
  const [isPinned, setIsPinned] = useState(false);
  // 公開期間（任意）。空欄なら開始=即時 / 終了=無期限。
  const [publishStartDate, setPublishStartDate] = useState('');
  const [publishEndDate, setPublishEndDate] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const availableSchools = schools.filter((s) => schoolIds?.includes(s.id)) ?? [];
  const allSelected =
    availableSchools.length > 0 && selectedSchoolIds.length >= availableSchools.length;

  useEffect(() => {
    if (post) {
      setTitle(post.title);
      setContent(post.content);
      setLinkUrl(post.link_url ?? '');
      setLabelId(post.label_id);
      setIsPinned(post.is_pinned);
      setPublishStartDate(timestampToDate(post.publish_start_at));
      setPublishEndDate(timestampToDate(post.publish_end_at));
    } else {
      setTitle('');
      setContent('');
      setLinkUrl('');
      setLabelId(null);
      setIsPinned(false);
      setPublishStartDate('');
      setPublishEndDate('');
    }
  }, [post, isOpen]);

  const isContentEmpty = (html: string) => {
    const text = html.replace(/<[^>]*>/g, '').trim();
    return text.length === 0;
  };

  const normalizeLinkUrl = (raw: string): string | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return `https://${trimmed}`;
  };

  const isInvalidLinkUrl = (() => {
    const trimmed = linkUrl.trim();
    if (!trimmed) return false;
    try {
      const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
      return !(url.hostname && url.hostname.includes('.'));
    } catch {
      return true;
    }
  })();

  // 公開終了日が開始日より前は不正
  const isInvalidPeriod = !!(
    publishStartDate &&
    publishEndDate &&
    publishEndDate < publishStartDate
  );

  const handleSubmit = async () => {
    if (!title.trim() || isContentEmpty(content) || isInvalidPeriod) {
      return;
    }

    const targetSchoolIds = post
      ? [post.school_id]
      : selectedSchoolIds.length > 0
        ? selectedSchoolIds
        : [schoolId];
    if (targetSchoolIds.length === 0) {
      setErrorMessage('投稿先の教室を1つ以上選択してください');
      return;
    }

    setIsSubmitting(true);
    try {
      const { createBulletinPost, updateBulletinPost } = await import('@/lib/api/bulletin');
      const { supabase } = await import('@/lib/supabase');

      const {
        data: { user },
      } = await supabase.auth.getUser();
      const userId = user?.id;

      const normalizedLink = normalizeLinkUrl(linkUrl);
      const publishStartAt = dateToTimestamp(publishStartDate, 'start');
      const publishEndAt = dateToTimestamp(publishEndDate, 'end');
      if (post) {
        // 代表の教室はラベルも含めて更新する
        await updateBulletinPost(
          post.id,
          {
            title: title.trim(),
            content: content,
            link_url: normalizedLink,
            label_id: labelId,
            is_pinned: isPinned,
            publish_start_at: publishStartAt,
            publish_end_at: publishEndAt,
          },
          userId
        );
        // まとめカードの編集は、他教室分にも内容を反映する（ラベルは各教室のを維持）
        const siblingIds = (groupPostIds ?? []).filter((id) => id !== post.id);
        for (const sid of siblingIds) {
          await updateBulletinPost(
            sid,
            {
              title: title.trim(),
              content: content,
              link_url: normalizedLink,
              is_pinned: isPinned,
              publish_start_at: publishStartAt,
              publish_end_at: publishEndAt,
            },
            userId
          );
        }
      } else {
        const payload = {
          title: title.trim(),
          content,
          link_url: normalizedLink,
          label_id: targetSchoolIds.length === 1 ? labelId : null,
          is_pinned: isPinned,
          publish_start_at: publishStartAt,
          publish_end_at: publishEndAt,
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

  const showSchoolSelector =
    !post && schoolIds && schoolIds.length > 1 && availableSchools.length > 0;

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
    // 連絡は長文になりがちなので、入力欄を広く取れるよう横幅を lg に広げる
    // （本文エディタ自体も右下ハンドルで縦に伸ばせる）。
    <Modal isOpen={isOpen} onClose={onClose} title={post ? '投稿を編集' : '新規投稿'} size="lg">
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
            <label className="block text-sm font-medium text-[#1f2937] mb-1">ラベル</label>
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
            minHeight="280px"
            resizable
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-[#1f2937] mb-1">
            リンク URL（任意）
          </label>
          <Input
            type="url"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="https://example.com"
            className="w-full"
          />
          {isInvalidLinkUrl && (
            <p className="mt-1 text-xs text-[#ef4444]">URL の形式が正しくありません</p>
          )}
        </div>

        {/* 公開期間（任意）。期間外は講師に表示されず未読にも数えない（データは残る）。 */}
        <div>
          <label className="block text-sm font-medium text-[#1f2937] mb-1">公開期間（任意）</label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={publishStartDate}
              onChange={(e) => setPublishStartDate(e.target.value)}
              aria-label="公開開始日"
              className="px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm bg-white text-[#1f2937] focus:ring-2 focus:ring-[#3b82f6] focus:border-[#3b82f6]"
            />
            <span className="text-sm text-gray-400">〜</span>
            <input
              type="date"
              value={publishEndDate}
              min={publishStartDate || undefined}
              onChange={(e) => setPublishEndDate(e.target.value)}
              aria-label="公開終了日"
              className="px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm bg-white text-[#1f2937] focus:ring-2 focus:ring-[#3b82f6] focus:border-[#3b82f6]"
            />
            {(publishStartDate || publishEndDate) && (
              <button
                type="button"
                onClick={() => {
                  setPublishStartDate('');
                  setPublishEndDate('');
                }}
                className="text-xs text-gray-500 hover:text-gray-700 underline"
              >
                クリア
              </button>
            )}
          </div>
          <p className="mt-1 text-xs text-gray-500">
            未入力なら常時公開。期間を過ぎた連絡は講師には表示されなくなります（データは残るので管理者は引き続き確認できます）。
          </p>
          {isInvalidPeriod && (
            <p className="mt-1 text-xs text-[#ef4444]">終了日は開始日以降にしてください</p>
          )}
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
              isInvalidLinkUrl ||
              isInvalidPeriod ||
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
