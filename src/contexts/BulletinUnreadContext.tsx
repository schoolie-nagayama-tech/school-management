'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  ReactNode,
} from 'react';
import { useAuth } from './AuthContext';
import { getUnreadCount, getUnreadPosts, markAsRead } from '@/lib/api/bulletin';
import type { BulletinPost } from '@/types/bulletin';

/**
 * 連絡掲示板の「未読」を一元管理するコンテキスト。
 *
 * 以前は AppHeader が自前で未読件数をポーリング取得していたが、既読ゲート
 * （UnreadBulletinGate）も同じ未読情報を必要とするため、ここに持ち上げて
 * 両者で共有する。これにより件数取得の二重fetchを避けられる。
 *
 * 取得は2段階（軽い→重い）:
 *   1. 未読「件数」だけ取得（従来のヘッダーバッジと同コスト）
 *   2. 件数が 1 件以上のときだけ未読「本文」を取得（ゲート表示に使う）
 * これにより、全員が既読の通常状態では本文取得クエリを走らせない。
 *
 * 対象は講師ロールのみ（既読モデルが講師専用）。なりすまし中は本人業務では
 * ないためスキップする。
 */
interface BulletinUnreadContextType {
  /** 選択中教室の未読件数の合計 */
  unreadCount: number;
  /** 未読投稿の本文（新しい順）。ゲート表示に使う */
  unreadPosts: BulletinPost[];
  loading: boolean;
  /** 手動で未読状態を取り直す */
  refresh: () => void;
  /** 1件を既読にして未読状態から取り除く（楽観更新） */
  markPostRead: (postId: string) => Promise<void>;
}

const BulletinUnreadContext = createContext<BulletinUnreadContextType | undefined>(undefined);

export function BulletinUnreadProvider({ children }: { children: ReactNode }) {
  const { profile, selectedSchoolId, schoolIds, getSelectedSchoolIds } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadPosts, setUnreadPosts] = useState<BulletinPost[]>([]);
  const [loading, setLoading] = useState(false);
  // 教室切替の連打などで古いレスポンスが新しい state を上書きしないよう採番する
  const reqIdRef = useRef(0);

  const fetchUnread = useCallback(async () => {
    const schoolIdsList = getSelectedSchoolIds();

    // 講師以外・未ログイン・教室未選択は未読ゲートの対象外。
    // なりすまし（アカウントスイッチ）中は「その講師として振る舞う」状態なので、
    // 講師本人と同様にゲートを出す（教室長が講師体験を確認するときもここを通る）。
    if (profile?.role !== 'teacher' || !profile?.id || schoolIdsList.length === 0) {
      setUnreadCount(0);
      setUnreadPosts([]);
      return;
    }

    const myReqId = ++reqIdRef.current;
    setLoading(true);
    try {
      // まず件数だけ（軽い）
      const counts = await Promise.all(
        schoolIdsList.map((schoolId) => getUnreadCount(schoolId, profile.id))
      );
      const total = counts.reduce((a, b) => a + b, 0);
      if (myReqId !== reqIdRef.current) return; // 競合した古い結果は破棄

      setUnreadCount(total);

      // 未読があるときだけ本文を取得する
      if (total > 0) {
        const posts = await getUnreadPosts(schoolIdsList, profile.id);
        if (myReqId !== reqIdRef.current) return;
        setUnreadPosts(posts);
      } else {
        setUnreadPosts([]);
      }
    } catch {
      if (myReqId !== reqIdRef.current) return;
      setUnreadCount(0);
      setUnreadPosts([]);
    } finally {
      if (myReqId === reqIdRef.current) setLoading(false);
    }
    // getSelectedSchoolIds は選択教室/担当教室が変わると新しい関数になるため、
    // それを依存に入れておけば教室切替で自動的に取り直される。
    // selectedSchoolId / schoolIds も念のため直接依存に加える（取りこぼし防止）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getSelectedSchoolIds, profile?.id, profile?.role, selectedSchoolId, schoolIds]);

  useEffect(() => {
    fetchUnread();
  }, [fetchUnread]);

  // 既存UI（生徒ページの BulletinBoard 等）が既読操作時に発火するイベントで再取得する
  useEffect(() => {
    const handler = () => fetchUnread();
    window.addEventListener('bulletin-unread-changed', handler);
    return () => window.removeEventListener('bulletin-unread-changed', handler);
  }, [fetchUnread]);

  const markPostRead = useCallback(
    async (postId: string) => {
      if (!profile?.id) return;
      await markAsRead(postId, profile.id);
      // 楽観更新: 対象を未読リストから外し件数を減らす（全部消えるとゲートが閉じる）
      setUnreadPosts((prev) => prev.filter((p) => p.id !== postId));
      setUnreadCount((c) => Math.max(0, c - 1));
    },
    [profile?.id]
  );

  return (
    <BulletinUnreadContext.Provider
      value={{ unreadCount, unreadPosts, loading, refresh: fetchUnread, markPostRead }}
    >
      {children}
    </BulletinUnreadContext.Provider>
  );
}

export function useBulletinUnread(): BulletinUnreadContextType {
  const ctx = useContext(BulletinUnreadContext);
  if (ctx === undefined) {
    throw new Error('useBulletinUnread must be used within a BulletinUnreadProvider');
  }
  return ctx;
}
