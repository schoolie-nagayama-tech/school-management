'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { BulletinPostCard } from './BulletinPostCard';
import { BulletinPostModal } from './BulletinPostModal';
import { BulletinReadersModal } from './BulletinReadersModal';
import {
  getBulletinPostsBatch,
  getBulletinLabelsBatch,
  markAsRead,
  deleteBulletinPost,
} from '@/lib/api/bulletin';
import { getSchools } from '@/lib/api/schools';
import type { BulletinPost, BulletinLabel } from '@/types/bulletin';
import type { School } from '@/types/database';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/useToast';
import { useConfirm } from '@/hooks/useConfirm';
import { Button, InlineLoading } from '@/components/ui';
import { ChevronDown, ChevronUp, Plus, Megaphone } from 'lucide-react';

interface BulletinBoardProps {
  className?: string;
  /**
   * サーバーコンポーネントで事前取得した初期データ（Phase3: SSRストリーミング）。
   * 渡された場合は初回のクライアント fetch をスキップし、ハイドレーション後の
   * 「fetchが始まるまでの空白」を無くす。教室切替・既読操作などの再取得は従来通り。
   * 未指定なら従来どおりマウント時にクライアントで取得する（既存呼び出しと完全互換）。
   */
  initialData?: {
    posts: BulletinPost[];
    labelsBySchool: Record<string, BulletinLabel[]>;
    schools: School[];
    unreadCount: number;
  };
}

/**
 * 複数教室に同一内容で投稿されたものを1枚のカードにまとめた単位。
 * 掲示板は投稿時に教室ごとの別レコードを作るため（group_id を持たない）、
 * 投稿者＋タイトル＋本文＋リンクが一致するものを「同じ連絡」とみなして束ねる。
 */
interface GroupedBulletinPost {
  /** 代表レコード（編集モーダル・既読モーダルの基準に使う） */
  rep: BulletinPost;
  /** このグループに属する全投稿のID（編集・削除・既読を全教室へ適用するため） */
  memberIds: string[];
  /** このグループがカバーする教室ID一覧（既読モーダルの未読集計に使う） */
  schoolIds: string[];
  /** 表示用の教室名一覧 */
  schoolNames: string[];
  /** 既読数の合計（全教室分） */
  readCount: number;
  /** 全教室分が既読か（講師の既読表示用） */
  isReadAll: boolean;
}

export function BulletinBoard({ className = '', initialData }: BulletinBoardProps) {
  const { getSelectedSchoolIds, profile } = useAuth();
  const { success, error: toastError } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const [posts, setPosts] = useState<BulletinPost[]>(initialData?.posts ?? []);
  /** 教室IDごとのラベル一覧（複数教室対応） */
  const [labelsBySchool, setLabelsBySchool] = useState<Record<string, BulletinLabel[]>>(
    initialData?.labelsBySchool ?? {}
  );
  const [schools, setSchools] = useState<School[]>(initialData?.schools ?? []);
  // 初期データがあれば最初からローディング非表示（即時に内容を出す）
  const [isLoading, setIsLoading] = useState(!initialData);
  const [isExpanded, setIsExpanded] = useState(true);
  const [isPostModalOpen, setIsPostModalOpen] = useState(false);
  const [editingPost, setEditingPost] = useState<BulletinPost | null>(null);
  /** 編集対象がまとめカードの場合、同一内容の全教室分の投稿ID。編集を全教室へ反映するために使う。 */
  const [editingGroupIds, setEditingGroupIds] = useState<string[] | undefined>(undefined);
  /** 既読状況モーダル（まとめ対応：複数の投稿ID・教室IDを渡す） */
  const [readersModal, setReadersModal] = useState<{
    postIds: string[];
    schoolIds: string[];
    title: string;
  } | null>(null);
  const [unreadCount, setUnreadCount] = useState(initialData?.unreadCount ?? 0);
  /** 新規投稿で選択中の教室ID（複数選択可） */
  const [postingSchoolIds, setPostingSchoolIds] = useState<string[]>([]);
  // 初期データ（SSR事前取得）を消費したかどうか。マウント直後の1回だけ fetch をスキップするためのフラグ。
  const skipInitialFetchRef = useRef<boolean>(!!initialData);

  // 編集権限はmanager以上のみ
  const canEdit =
    profile?.role === 'admin' || profile?.role === 'owner' || profile?.role === 'manager';
  // 既読機能は講師のみ
  const canRead = profile?.role === 'teacher';
  const userId = profile?.id;

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const schoolIds = getSelectedSchoolIds();
      if (schoolIds.length === 0) {
        setPosts([]);
        setLabelsBySchool({});
        setSchools([]);
        return;
      }

      const schoolIdSet = new Set(schoolIds);

      try {
        // 投稿・ラベルとも全教室まとめてバッチ取得（教室数に依らず固定本数のクエリ）。
        const [allSchoolsData, postsBySchool, labelsBySchoolMap] = await Promise.all([
          getSchools(),
          getBulletinPostsBatch(schoolIds, { includeArchived: false, userId }),
          getBulletinLabelsBatch(schoolIds),
        ]);

        const schoolsList = (allSchoolsData || []).filter((s) => schoolIdSet.has(s.id));
        setSchools(schoolsList);

        const schoolNameById = Object.fromEntries(schoolsList.map((s) => [s.id, s.name]));
        const allPosts: BulletinPost[] = [];

        for (const schoolId of schoolIds) {
          const name = schoolNameById[schoolId] ?? null;
          for (const post of postsBySchool[schoolId] || []) {
            allPosts.push({ ...post, school_name: name });
          }
        }

        allPosts.sort((a, b) => {
          if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        });

        setLabelsBySchool(labelsBySchoolMap);
        setPosts(allPosts);

        // 未読数は取得済みの is_read から算出（getUnreadCount の追加クエリを撤去）
        if (userId && canRead) {
          setUnreadCount(allPosts.filter((p) => !p.is_read).length);
        } else {
          setUnreadCount(0);
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : '';
        if (message.includes('schema cache') || message.includes('not found')) {
          console.warn(
            '掲示板テーブルが見つかりません。マイグレーションを実行してください:',
            error
          );
          setPosts([]);
          setLabelsBySchool({});
          return;
        }
        throw error;
      }

      setPostingSchoolIds((prev) => {
        const valid = prev.filter((id) => schoolIdSet.has(id));
        if (valid.length === prev.length && prev.length > 0) return prev;
        return [...schoolIds];
      });
    } catch (error) {
      console.error('Error fetching bulletin data:', error);
      toastError('掲示板の取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [getSelectedSchoolIds, userId, toastError, canRead]);

  useEffect(() => {
    // SSR で初期データを受け取っている場合、マウント直後の1回だけ取得をスキップする
    // （サーバー事前取得分をそのまま表示）。教室切替などで fetchData が変わった2回目以降は通常取得する。
    if (skipInitialFetchRef.current) {
      skipInitialFetchRef.current = false;
      return;
    }
    fetchData();
  }, [fetchData]);

  // 同一内容の投稿（＝複数教室への同報）を1枚にまとめる。
  // posts は既に「ピン留め→新しい順」でソート済みなので、代表は各グループの先頭になる。
  const groupedPosts = useMemo<GroupedBulletinPost[]>(() => {
    const groups = new Map<string, GroupedBulletinPost>();
    const order: string[] = [];
    for (const post of posts) {
      // group_id が無いため内容で同一判定する（投稿者＋タイトル＋本文＋リンク）
      const key = [post.created_by ?? '', post.title, post.content, post.link_url ?? ''].join(' ');
      let group = groups.get(key);
      if (!group) {
        group = {
          rep: post,
          memberIds: [],
          schoolIds: [],
          schoolNames: [],
          readCount: 0,
          isReadAll: true,
        };
        groups.set(key, group);
        order.push(key);
      }
      group.memberIds.push(post.id);
      if (post.school_id) group.schoolIds.push(post.school_id);
      if (post.school_name) group.schoolNames.push(post.school_name);
      group.readCount += post.read_count ?? 0;
      group.isReadAll = group.isReadAll && !!post.is_read;
    }
    return order.map((k) => groups.get(k)!);
  }, [posts]);

  const handleReadGroup = useCallback(
    async (group: GroupedBulletinPost) => {
      if (!userId) return;
      try {
        // 全教室分の投稿を既読にする（講師は通常1教室なのでほぼ1件）
        await Promise.all(group.memberIds.map((id) => markAsRead(id, userId)));
        success('既読にしました');
        await fetchData();
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('bulletin-unread-changed'));
        }
      } catch (error) {
        console.error('Error marking as read:', error);
        toastError('既読の記録に失敗しました');
      }
    },
    [userId, success, toastError, fetchData]
  );

  const handleEditGroup = useCallback((group: GroupedBulletinPost) => {
    setEditingPost(group.rep);
    // まとめカードの編集は全教室分へ反映するため、メンバーIDを渡す
    setEditingGroupIds(group.memberIds.length > 1 ? group.memberIds : undefined);
    setIsPostModalOpen(true);
  }, []);

  const handleDeleteGroup = useCallback(
    async (group: GroupedBulletinPost) => {
      const multi = group.memberIds.length > 1;
      if (
        !(await confirm({
          title: '削除確認',
          description: multi
            ? `この連絡を${group.memberIds.length}教室分すべて削除しますか？`
            : 'この投稿を削除しますか？',
          confirmLabel: '削除',
          variant: 'danger',
        }))
      ) {
        return;
      }

      try {
        // 全教室分をまとめて削除する
        await Promise.all(group.memberIds.map((id) => deleteBulletinPost(id)));
        success('削除しました');
        await fetchData();
      } catch (error) {
        console.error('Error deleting post:', error);
        toastError('削除に失敗しました');
      }
    },
    [confirm, success, toastError, fetchData]
  );

  const handleShowReadersGroup = useCallback((group: GroupedBulletinPost) => {
    setReadersModal({
      postIds: group.memberIds,
      schoolIds: group.schoolIds,
      title: group.rep.title,
    });
  }, []);

  const handleNewPost = useCallback(() => {
    setEditingPost(null);
    setEditingGroupIds(undefined);
    setPostingSchoolIds(getSelectedSchoolIds());
    setIsPostModalOpen(true);
  }, [getSelectedSchoolIds]);

  const handlePostSaved = useCallback(() => {
    fetchData();
  }, [fetchData]);

  if (isLoading) {
    return (
      <div className={`bg-[#f8f8f8] rounded-xl border border-gray-200 p-4 ${className}`}>
        <InlineLoading label="掲示板を読み込み中..." />
      </div>
    );
  }

  return (
    <>
      <div
        className={`bg-[#f8f8f8] rounded-xl border border-gray-200 overflow-hidden ${className}`}
      >
        {/* ヘッダー */}
        <div
          className="flex items-center justify-between p-4 bg-[#ffebee] border-b border-[#ffcdd2] cursor-pointer hover:bg-[#ffcdd2]/40 transition-colors duration-150"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className="flex items-center gap-2">
            <Megaphone className="w-5 h-5 text-[#1a1a1a]" />
            <span className="font-bold text-[#1a1a1a]">
              連絡掲示板
              {canRead && unreadCount > 0 && (
                <span className="ml-2 text-sm text-[#d32f2f] font-semibold">
                  （未読{unreadCount}件）
                </span>
              )}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {canEdit && (
              <Button
                onClick={(e) => {
                  e.stopPropagation();
                  handleNewPost();
                }}
                size="sm"
                className="text-xs px-2 py-1"
              >
                <Plus className="w-3 h-3 mr-1" />
                新規投稿
              </Button>
            )}
            <button className="text-gray-500 hover:text-gray-700 transition-colors duration-150">
              {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* 投稿一覧 */}
        {isExpanded && (
          <div className="p-4 space-y-3">
            {groupedPosts.length === 0 ? (
              <div className="text-center text-sm text-gray-400 py-8">
                投稿はありません。{canEdit ? '「新規投稿」ボタンから投稿を作成できます。' : ''}
              </div>
            ) : (
              groupedPosts.map((group, idx) => {
                // 既読数は全教室分の合計、is_read は全教室既読かで上書きしたカードを表示する
                const displayPost: BulletinPost = {
                  ...group.rep,
                  read_count: group.readCount,
                  is_read: group.isReadAll,
                };
                // まとめ表示のときは教室名を連結（例: 清瀬校・緑園都市校・…）
                const combinedSchoolName =
                  group.schoolNames.length > 0
                    ? group.schoolNames.join('・')
                    : group.rep.school_name;
                return (
                  // stagger-item で 40ms 刻みのフェードイン（8件超はindex頭打ち）
                  <div
                    key={group.rep.id}
                    className="stagger-item"
                    style={{ '--stagger-index': Math.min(idx, 8) } as React.CSSProperties}
                  >
                    <BulletinPostCard
                      post={displayPost}
                      schoolName={combinedSchoolName}
                      canEdit={canEdit}
                      canRead={canRead}
                      onRead={() => handleReadGroup(group)}
                      onEdit={() => handleEditGroup(group)}
                      onDelete={() => handleDeleteGroup(group)}
                      onShowReaders={() => handleShowReadersGroup(group)}
                    />
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* 投稿作成・編集モーダル */}
      {getSelectedSchoolIds().length > 0 && (
        <BulletinPostModal
          isOpen={isPostModalOpen}
          onClose={() => {
            setIsPostModalOpen(false);
            setEditingPost(null);
            setEditingGroupIds(undefined);
          }}
          post={editingPost}
          groupPostIds={editingGroupIds}
          labels={
            editingPost
              ? (labelsBySchool[editingPost.school_id] ?? [])
              : (labelsBySchool[postingSchoolIds[0] ?? getSelectedSchoolIds()[0]] ?? [])
          }
          schoolId={
            editingPost ? editingPost.school_id : (postingSchoolIds[0] ?? getSelectedSchoolIds()[0])
          }
          schoolIds={getSelectedSchoolIds().length > 1 ? getSelectedSchoolIds() : undefined}
          schools={schools}
          selectedSchoolIds={editingPost ? [editingPost.school_id] : postingSchoolIds}
          onSelectedSchoolIdsChange={setPostingSchoolIds}
          onSaved={handlePostSaved}
        />
      )}

      {ConfirmDialog}

      {/* 既読者一覧モーダル（まとめカードは全教室分を集計して表示） */}
      {readersModal && (
        <BulletinReadersModal
          isOpen={!!readersModal}
          onClose={() => setReadersModal(null)}
          postIds={readersModal.postIds}
          postTitle={readersModal.title}
          schoolIds={readersModal.schoolIds}
        />
      )}
    </>
  );
}
