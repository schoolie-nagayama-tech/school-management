'use client';

import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { fetchWithAuth } from '@/lib/api/auth';
import { isTeacher } from '@/lib/utils/roles';
import { isOutsideClassroom } from '@/lib/classroomDevice';

/**
 * 「この端末は教室端末か」を一元管理するコンテキスト。
 *
 * 正典: docs/classroom-device-plan.md §2
 *
 * 判定はサーバーだけが持つ（クッキーが httpOnly なのでブラウザからは読めない）。
 * ここでは /api/device-trust/status を **セッション中1回だけ** 叩き、結果を
 * モジュールスコープに保持してページ遷移のたびの再問い合わせを避ける
 * （BulletinUnreadProvider と同じく、複数の利用側＝ゲートとナビで共有する）。
 *
 * ★ 問い合わせるのは講師のときだけ:
 *   manager 以上は教室外でもフル（§1-3）なので判定自体が不要。無駄なリクエストを出さない。
 *
 * ★ 判定確定前は制限をかけない:
 *   未確定（null）のうちに教室外モード扱いすると、教室PCの講師にも一瞬ブロック画面が
 *   出てしまう。outsideClassroom は確定後にだけ true になる。
 */

/**
 * セッション中の判定キャッシュ。
 * 端末に紐づく情報（ユーザー単位ではない）ので、ログインユーザーが変わっても
 * 同じ値を使い回してよい。端末登録の直後だけ refresh() で取り直す。
 */
let cachedTrusted: boolean | null = null;

interface ClassroomDeviceContextType {
  /** この端末が教室端末として登録済みか（未確定のうちは false） */
  isTrustedDevice: boolean;
  /** 判定がまだ確定していない（講師のみ true になりうる） */
  loading: boolean;
  /** 教室外モードか。isOutsideClassroom の結果を確定後にだけ返す */
  outsideClassroom: boolean;
  /** 端末登録・失効の直後に判定を取り直す */
  refresh: () => Promise<void>;
}

const ClassroomDeviceContext = createContext<ClassroomDeviceContextType | undefined>(undefined);

export function ClassroomDeviceProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const teacher = isTeacher(profile?.role);
  const [trusted, setTrusted] = useState<boolean | null>(cachedTrusted);

  const load = useCallback(
    async (force: boolean) => {
      // 判定が要るのは講師だけ。未ログイン時も何もしない。
      if (!profile?.id || !teacher) return;
      if (!force && cachedTrusted !== null) {
        setTrusted(cachedTrusted);
        return;
      }
      try {
        const res = await fetchWithAuth('/api/device-trust/status');
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = (await res.json()) as { trusted?: boolean };
        cachedTrusted = data.trusted === true;
      } catch {
        // 判定不能は「信頼しない」側に倒す（= 教室端末）。サーバー側と同じ方針。
        cachedTrusted = false;
      }
      setTrusted(cachedTrusted);
    },
    [profile?.id, teacher]
  );

  useEffect(() => {
    load(false);
  }, [load]);

  const refresh = useCallback(async () => {
    await load(true);
  }, [load]);

  return (
    <ClassroomDeviceContext.Provider
      value={{
        isTrustedDevice: trusted === true,
        loading: teacher && trusted === null,
        outsideClassroom: trusted !== null && isOutsideClassroom(profile?.role, trusted),
        refresh,
      }}
    >
      {children}
    </ClassroomDeviceContext.Provider>
  );
}

export function useClassroomDevice(): ClassroomDeviceContextType {
  const ctx = useContext(ClassroomDeviceContext);
  if (ctx === undefined) {
    throw new Error('useClassroomDevice must be used within a ClassroomDeviceProvider');
  }
  return ctx;
}

/** 端末登録/失効の直後に、次回の判定でサーバーへ問い合わせ直させる。 */
export function resetDeviceTrustCache(): void {
  cachedTrusted = null;
}
