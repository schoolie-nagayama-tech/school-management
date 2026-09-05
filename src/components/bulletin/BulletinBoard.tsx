'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { BulletinPostCard } from './BulletinPostCard';
import { BulletinPostModal } from './BulletinPostModal';
import { BulletinReadersModal } from './BulletinReadersModal';
import { BulletinTaskBoard } from './BulletinTaskBoard';
import {
  getBulletinPostsBatch,
  getBulletinLabelsBatch,
  markAsRead,
  deleteBulletinPost,
  unarchiveBulletinPost,
  hardDeleteBulletinPost,
} from '@/lib/api/bulletin';
import { getSchools } from '@/lib/api/schools';
import { fetchWithAuth } from '@/lib/api/auth';
import type { BulletinPost, BulletinLabel } from '@/types/bulletin';
import { isPostPublished } from '@/types/bulletin';
import type { School } from '@/types/database';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/useToast';
import { useConfirm } from '@/hooks/useConfirm';
import { Button, InlineLoading } from '@/components/ui';
import { ChevronDown, ChevronUp, Plus, Megaphone, Archive } from 'lucide-react';

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

/**
 * 同一内容の投稿（＝複数教室への同報）を1枚にまとめる。
 * group_id を持たないため内容（投稿者＋タイトル＋本文＋リンク）で同一判定する。
 * 通常一覧・アーカイブ一覧の両方で使う。
 */
function groupBulletinPosts(posts: BulletinPost[]): GroupedBulletinPost[] {
  const groups = new Map<string, GroupedBulletinPost>();
  const order: string[] = [];
  for (const post of posts) {
    const key = [post.created_by ?? '', post.title, post.content, post.link_url ?? ''].join(' ');
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
}

export function BulletinBoard({ className = '', initialData }: BulletinBoardProps) {
  const { getSelectedSchoolIds, profile } = useAuth();
  const { success, error: toastError } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  // SSRシード（初回 fetch をスキップする場合）でも、講師には公開中の投稿だけを見せる
  const [posts, setPosts] = useState<BulletinPost[]>(() => {
    const seed = initialData?.posts ?? [];
    return profile?.role === 'teacher' ? seed.filter((p) => isPostPublished(p)) : seed;
  });
  /** 教室IDごとのラベル一覧（複数教室対応） */
  const [labelsBySchool, setLabelsBySchool] = useState<Record<string, BulletinLabel[]>>(
    initialData?.labelsBySchool ?? {}
  );
  const [schools, setSchools] = useState<School[]>(initialData?.schools ?? []);
  // 初期データがあれば最初からローディング非表示（即時に内容を出す）
  const [isLoading, setIsLoading] = useState(!initialData);
  const [isExpanded, setIsExpanded] = useState(true);
  const [isPostModalOpen, setIsPostModalOpen] = useState(false);
  /** 投稿から依頼を読み取っている最中か（下の「残っている人」に出す） */
  const [isExtracting, setIsExtracting] = useState(false);
  /** 読み取りが終わったら「残っている人」を数え直させる */
  const [taskReloadKey, setTaskReloadKey] = useState(0);
  const [editingPost, setEditingPost] = useState<BulletinPost | null>(null);
  /** 編集対象がまとめカードの場合、同一内容の全教室分の投稿ID。編集を全教室へ反映するために使う。 */
  const [editingGroupIds, setEditingGroupIds] = useState<string[] | undefined>(undefined);
  /** 既読状況モーダル（まとめ対応：複数の投稿ID・教室IDを渡す） */
  const [readersModal, setReadersModal] = useState<{
    postIds: string[];
    schoolIds: string[];
    title: string;
  } | null>(null);
  const [unreadCount, setUnreadCount] = useState<number>(() => {
    if (profile?.role !== 'teacher') return 0;
    // 公開中の未読だけを数える（SSRシード時の一貫性のため）
    return (initialData?.posts ?? []).filter((p) => isPostPublished(p) && !p.is_read).length;
  });
  /** 新規投稿で選択中の教室ID（複数選択可） */
  const [postingSchoolIds, setPostingSchoolIds] = useState<string[]>([]);
  /** アーカイブ閲覧の開閉と取得済みアーカイブ投稿 */
  const [showArchived, setShowArchived] = useState(false);
  const [archivedPosts, setArchivedPosts] = useState<BulletinPost[]>([]);
  const [archivedLoading, setArchivedLoading] = useState(false);
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

        // 講師には公開中の投稿だけを見せる（公開前・公開終了は非表示）。
        // 管理者は全件見えてカード側のバッジで公開状態が分かる。
        const now = Date.now();
        const visiblePosts = canRead ? allPosts.filter((p) => isPostPublished(p, now)) : allPosts;

        setLabelsBySchool(labelsBySchoolMap);
        setPosts(visiblePosts);

        // 未読数は取得済みの is_read から算出（getUnreadCount の追加クエリを撤去）
        if (userId && canRead) {
          setUnreadCount(visiblePosts.filter((p) => !p.is_read).length);
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
  const groupedPosts = useMemo<GroupedBulletinPost[]>(() => groupBulletinPosts(posts), [posts]);
  const groupedArchived = useMemo<GroupedBulletinPost[]>(
    () => groupBulletinPosts(archivedPosts),
    [archivedPosts]
  );

  // アーカイブ済み投稿を取得する（アーカイブ閲覧を開いたときに呼ぶ）。
  const loadArchived = useCallback(async () => {
    const schoolIds = getSelectedSchoolIds();
    if (schoolIds.length === 0) {
      setArchivedPosts([]);
      return;
    }
    setArchivedLoading(true);
    try {
      const bySchool = await getBulletinPostsBatch(schoolIds, { archivedOnly: true, userId });
      const schoolNameById = Object.fromEntries(schools.map((s) => [s.id, s.name]));
      const all: BulletinPost[] = [];
      for (const schoolId of schoolIds) {
        for (const post of bySchool[schoolId] || []) {
          all.push({ ...post, school_name: schoolNameById[schoolId] ?? null });
        }
      }
      // アーカイブは新しくアーカイブした順に並べる
      all.sort(
        (a, b) =>
          new Date(b.archived_at ?? b.created_at).getTime() -
          new Date(a.archived_at ?? a.created_at).getTime()
      );
      setArchivedPosts(all);
    } catch (error) {
      console.error('Error fetching archived posts:', error);
      toastError('アーカイブの取得に失敗しました');
    } finally {
      setArchivedLoading(false);
    }
  }, [getSelectedSchoolIds, userId, schools, toastError]);

  // アーカイブ閲覧を開いたとき / 開いている状態で教室が変わったときに取得する
  useEffect(() => {
    if (showArchived) loadArchived();
  }, [showArchived, loadArchived]);

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

  // アーカイブ（削除せず過去の連絡として残す）。deleteBulletinPost は論理削除（is_archived=true）。
  const handleArchiveGroup = useCallback(
    async (group: GroupedBulletinPost) => {
      const multi = group.memberIds.length > 1;
      if (
        !(await confirm({
          title: 'アーカイブ確認',
          description: multi
            ? `この連絡を${group.memberIds.length}教室分アーカイブしますか？（削除せず過去の連絡として残ります）`
            : 'この連絡をアーカイブしますか？（削除せず過去の連絡として残ります）',
          confirmLabel: 'アーカイブ',
        }))
      ) {
        return;
      }

      try {
        await Promise.all(group.memberIds.map((id) => deleteBulletinPost(id)));
        success('アーカイブしました');
        await fetchData();
        if (showArchived) await loadArchived();
      } catch (error) {
        console.error('Error archiving post:', error);
        toastError('アーカイブに失敗しました');
      }
    },
    [confirm, success, toastError, fetchData, showArchived, loadArchived]
  );

  // アーカイブから通常一覧へ戻す
  const handleRestoreGroup = useCallback(
    async (group: GroupedBulletinPost) => {
      try {
        await Promise.all(group.memberIds.map((id) => unarchiveBulletinPost(id)));
        success('元に戻しました');
        await loadArchived();
        await fetchData();
      } catch (error) {
        console.error('Error restoring post:', error);
        toastError('復元に失敗しました');
      }
    },
    [success, toastError, loadArchived, fetchData]
  );

  // アーカイブから完全に削除する（取り消し不可）
  const handleHardDeleteGroup = useCallback(
    async (group: GroupedBulletinPost) => {
      const multi = group.memberIds.length > 1;
      if (
        !(await confirm({
          title: '完全に削除',
          description: multi
            ? `この連絡を${group.memberIds.length}教室分、完全に削除しますか？この操作は取り消せません。`
            : 'この連絡を完全に削除しますか？この操作は取り消せません。',
          confirmLabel: '完全に削除',
          variant: 'danger',
        }))
      ) {
        return;
      }

      try {
        await Promise.all(group.memberIds.map((id) => hardDeleteBulletinPost(id)));
        success('完全に削除しました');
        await loadArchived();
      } catch (error) {
        console.error('Error hard-deleting post:', error);
        toastError('削除に失敗しました');
      }
    },
    [confirm, success, toastError, loadArchived]
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

  /**
   * 投稿の保存後。
   *
   * ★投稿したらそのまま依頼の読み取りを走らせる。承認は挟まない
   *   （承認待ちにすると「押し忘れたら何も起きない」で、いまの督促と同じ問題が形を変えて残る）。
   *   読み取った結果は下の「残っている人」に「いま追加」付きで並び、違えば「×」で消せる。
   *
   * ★失敗しても投稿は成功のまま。読み取りは投稿の付属品で、
   *   これがこけたからといって連絡が出ていないことにはならない。
   */
  const handlePostSaved = useCallback(
    (createdPostIds: string[]) => {
      fetchData();
      if (createdPostIds.length === 0) return;

      setIsExtracting(true);
      // 教室ごとに別レコードなので投稿の数だけ呼ぶ（タスクは教室単位で持つため）
      void Promise.all(
        createdPostIds.map((postId) =>
          fetchWithAuth('/api/ai/bulletin/extract', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ postId }),
          }).catch(() => null)
        )
      ).finally(() => {
        setIsExtracting(false);
        setTaskReloadKey((k) => k + 1);
      });
    },
    [fetchData]
  );

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
                      onDelete={() => handleArchiveGroup(group)}
                      onShowReaders={() => handleShowReadersGroup(group)}
                    />
                  </div>
                );
              })
            )}

            {/* 掲示板AIアシスト: 投稿から読み取った依頼の「残っている人」（教室長以上）。
                ★連絡の下に置く。依頼と、その結果は同じ場所で見るもので、別画面にすると見に行かれない。 */}
            <BulletinTaskBoard
              schools={schools}
              reloadKey={taskReloadKey}
              isExtracting={isExtracting}
            />

            {/* アーカイブ（過去の連絡）: 教室長以上のみ。開くと取得して表示する。 */}
            {canEdit && (
              <div className="pt-2 border-t border-gray-200">
                <button
                  onClick={() => setShowArchived((v) => !v)}
                  aria-expanded={showArchived}
                  className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors duration-150 py-1"
                >
                  <Archive className="w-3.5 h-3.5" />
                  アーカイブ（過去の連絡）
                  <ChevronDown
                    className={`w-3.5 h-3.5 transition-transform duration-150 ease-out ${
                      showArchived ? 'rotate-180' : ''
                    }`}
                  />
                </button>

                {showArchived && (
                  <div className="mt-2 space-y-3">
                    {archivedLoading ? (
                      <InlineLoading label="アーカイブを読み込み中..." />
                    ) : groupedArchived.length === 0 ? (
                      <div className="text-center text-xs text-gray-400 py-4">
                        アーカイブされた連絡はありません。
                      </div>
                    ) : (
                      groupedArchived.map((group) => {
                        const displayPost: BulletinPost = {
                          ...group.rep,
                          read_count: group.readCount,
                          is_read: group.isReadAll,
                        };
                        const combinedSchoolName =
                          group.schoolNames.length > 0
                            ? group.schoolNames.join('・')
                            : group.rep.school_name;
                        return (
                          <BulletinPostCard
                            key={group.rep.id}
                            post={displayPost}
                            schoolName={combinedSchoolName}
                            canEdit={canEdit}
                            canRead={false}
                            archived
                            onRead={() => {}}
                            onEdit={() => {}}
                            onDelete={() => {}}
                            onShowReaders={() => {}}
                            onRestore={() => handleRestoreGroup(group)}
                            onHardDelete={() => handleHardDeleteGroup(group)}
                          />
                        );
                      })
                    )}
                  </div>
                )}
              </div>
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
