'use client';

import type { BulletinPost } from '@/types/bulletin';
import { getPublishStatus } from '@/types/bulletin';
import { Button } from '@/components/ui';
import {
  Edit2,
  Trash2,
  Users,
  Check,
  Pin,
  ExternalLink,
  Archive,
  RotateCcw,
  CalendarClock,
} from 'lucide-react';
import { isHtmlContent, sanitizeBulletinHtml } from '@/lib/utils/bulletinHtml';

interface BulletinPostCardProps {
  post: BulletinPost;
  /** 投稿先の教室名（複数教室表示時に表示） */
  schoolName?: string | null;
  canEdit: boolean;
  canRead: boolean; // 講師のみが既読機能を使える
  onRead: () => void;
  onEdit: () => void;
  /** 通常一覧: アーカイブする（削除せず残す） */
  onDelete: () => void;
  onShowReaders: () => void;
  /** アーカイブ閲覧モード（true のとき復元・完全削除の操作を出す） */
  archived?: boolean;
  /** アーカイブから通常一覧へ戻す */
  onRestore?: () => void;
  /** アーカイブから完全に削除する（元に戻せない） */
  onHardDelete?: () => void;
}

/** 公開期間チップの日付表記（M/D） */
function formatPeriodDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' });
}

export function BulletinPostCard({
  post,
  schoolName,
  canEdit,
  canRead,
  onRead,
  onEdit,
  onDelete,
  onShowReaders,
  archived = false,
  onRestore,
  onHardDelete,
}: BulletinPostCardProps) {
  const createdDate = new Date(post.created_at).toLocaleDateString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
  });

  const creatorName = post.creator?.display_name || post.creator?.email || '不明';

  // 公開期間の状態（管理者向けバッジ）。期間設定がある投稿だけチップを出す。
  const publishStatus = getPublishStatus(post);
  const hasPeriod = !!(post.publish_start_at || post.publish_end_at);
  const periodText = hasPeriod
    ? `${formatPeriodDate(post.publish_start_at)}〜${formatPeriodDate(post.publish_end_at)}`
    : '';

  return (
    <div
      className={`p-3 rounded-lg border transition-colors duration-200 ${
        archived
          ? 'bg-gray-50 border-gray-200'
          : canRead && !post.is_read
            ? 'bg-primary-subtle border-gray-300 shadow-sm'
            : 'bg-white border-gray-200'
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {post.is_pinned && <Pin className="w-4 h-4 shrink-0 text-[#d32f2f]" />}
          {canRead && !post.is_read && <span className="text-sm shrink-0">●</span>}
          {post.label && (
            <span
              className="shrink-0 px-2 py-0.5 rounded text-xs font-medium text-white"
              style={{ backgroundColor: post.label.color }}
            >
              {post.label.name}
            </span>
          )}
          <span className="font-semibold text-[#1a1a1a] truncate">{post.title}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2 ml-2">
          {/* 公開期間チップ: 期間設定あり or 公開前/終了のときに表示（アーカイブ表示中は出さない） */}
          {!archived && (hasPeriod || publishStatus !== 'active') && (
            <span
              className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] font-medium whitespace-nowrap ${
                publishStatus === 'scheduled'
                  ? 'bg-amber-100 text-amber-800'
                  : publishStatus === 'expired'
                    ? 'bg-gray-200 text-gray-500'
                    : 'bg-blue-50 text-blue-700'
              }`}
              title={periodText ? `公開期間: ${periodText}` : undefined}
            >
              <CalendarClock className="w-3 h-3" />
              {publishStatus === 'scheduled'
                ? `公開予定 ${periodText}`
                : publishStatus === 'expired'
                  ? '公開終了'
                  : periodText}
            </span>
          )}
          {schoolName && <span className="text-xs text-gray-400">{schoolName}</span>}
        </div>
      </div>

      {/* 本文を表示（リッチテキスト HTML または従来のプレーンテキスト） */}
      {post.content && (
        <div
          className="bulletin-post-content text-sm text-[var(--text)] break-words mb-2 pl-0"
          {...(isHtmlContent(post.content)
            ? { dangerouslySetInnerHTML: { __html: sanitizeBulletinHtml(post.content) } }
            : { style: { whiteSpace: 'pre-wrap' }, children: post.content })}
        />
      )}

      {/* 添付リンク */}
      {post.link_url && (
        <a
          href={post.link_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 mb-2 px-3 py-2 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg text-sm text-blue-700 transition-colors duration-150 group"
        >
          <ExternalLink className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate group-hover:underline">{post.link_url}</span>
        </a>
      )}

      <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
        <span>
          {createdDate} {creatorName}
        </span>
        {canEdit && (
          <button
            onClick={onShowReaders}
            className="flex items-center gap-1 text-gray-500 hover:text-gray-700 transition-colors duration-150"
          >
            <Users className="w-3 h-3" />
            <span>既読: {post.read_count}人</span>
          </button>
        )}
      </div>

      <div className="flex items-center gap-2">
        {/* アーカイブ閲覧モード: 復元 / 完全削除 のみ */}
        {archived ? (
          canEdit && (
            <>
              <Button
                onClick={onRestore}
                variant="secondary"
                size="sm"
                className="text-xs px-2 py-1"
              >
                <RotateCcw className="w-3 h-3 mr-1" />
                元に戻す
              </Button>
              <Button
                onClick={onHardDelete}
                variant="danger"
                size="sm"
                className="text-xs px-2 py-1"
              >
                <Trash2 className="w-3 h-3 mr-1" />
                完全に削除
              </Button>
            </>
          )
        ) : (
          <>
            {canRead && !post.is_read && (
              <Button onClick={onRead} variant="secondary" size="sm" className="text-xs px-2 py-1">
                <Check className="w-3 h-3 mr-1" />
                見ました
              </Button>
            )}
            {canRead && post.is_read && <span className="text-xs text-gray-400">✓既読</span>}
            {canEdit && (
              <>
                <Button onClick={onEdit} variant="ghost" size="sm" className="text-xs px-2 py-1">
                  <Edit2 className="w-3 h-3 mr-1" />
                  編集
                </Button>
                {/* 削除せずアーカイブへ（過去の連絡は残す） */}
                <Button onClick={onDelete} variant="ghost" size="sm" className="text-xs px-2 py-1">
                  <Archive className="w-3 h-3 mr-1" />
                  アーカイブ
                </Button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
