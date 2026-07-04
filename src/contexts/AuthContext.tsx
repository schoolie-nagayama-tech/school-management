'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  ReactNode,
} from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase';
import { User } from '@supabase/supabase-js';
import type { UserProfile, Permission } from '@/types/database';
import { getPermissions } from '@/types/database';
import { getUserProfile, updateLastLogin, getUserSchools } from '@/lib/api/auth';
import { getSchools } from '@/lib/api/schools';
import { Loading } from '@/components/ui';
import { clearAllFetchCache } from '@/lib/utils/fetchCache';
import { resolveSelectedSchoolId } from '@/lib/auth/selectedSchool';
import { useInactivityLogout } from '@/hooks/useInactivityLogout';
import {
  isStaleSessionAfterBrowserClose,
  setBrowserSessionMarker,
} from '@/lib/utils/browserSessionGuard';
// 型のみの import。resolveServerAuth は 'server-only' だが import type は
// コンパイル時に消えるためクライアントバンドルには入らない（実行時 import なし）。
import type { InitialAuth } from '@/lib/auth/resolveServerAuth';

function isAbortError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.name === 'AbortError' ||
    err.message?.includes('aborted') ||
    err.message?.includes('signal is aborted')
  );
}

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  permissions: Permission | null;
  schoolIds: string[];
  demoSchoolIds: string[]; // is_demo=true の教室IDセット
  selectedSchoolId: string | 'all' | null; // 選択中の教室ID、'all'はすべての教室、nullは未選択
  isLoading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  setSelectedSchoolId: (schoolId: string | 'all') => void;
  getSelectedSchoolIds: () => string[]; // 選択された教室IDの配列を返す（'all'の場合はデモ除外したschoolIds）
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// 認証不要のパス（講師シフト提出フォーム・修正フォーム含む）
const PUBLIC_PATHS = [
  '/login',
  '/forgot-password',
  '/auth/callback',
  '/auth/reset-password',
  '/portal',
  '/seasonal-shift',
  '/regular-shift',
  '/test-prep',
  // 公開問合せフォーム（チラシ・看板のQRから保護者が直接送信）と
  // 面談セルフ予約ページ（保護者がトークンURLから予約）。いずれもログイン不要。
  '/inquiry',
  '/booking',
];

// 招待からの登録パス
const INVITE_PATH = '/invite';

interface AuthProviderProps {
  children: ReactNode;
  /**
   * サーバー(layout)で先に解決した認証情報（Phase3 Pillar A）。
   * 渡された場合は初期 state にそのまま採用し、isLoading=false で開始する。
   * これにより初回描画から profile/権限/対象校が使え、認証待ちギャップと
   * 「auth 確定後の再 fetch」が無くなる。未指定なら従来どおりクライアントで解決する。
   */
  initialAuth?: InitialAuth | null;
}

export function AuthProvider({ children, initialAuth }: AuthProviderProps) {
  const router = useRouter();
  const pathname = usePathname();

  // initialAuth はクライアントのライフタイム中は不変（layout のサーバー描画で1度だけ確定）。
  // 認証監視 useEffect の再購読を避けるため ref に固定して参照する。
  const initialAuthRef = useRef<InitialAuth | null>(initialAuth ?? null);

  // サーバー解決済みの initialAuth があれば初期 state に採用（無ければ従来どおり空で開始）。
  const [user, setUser] = useState<User | null>(initialAuth?.user ?? null);
  const [profile, setProfile] = useState<UserProfile | null>(initialAuth?.profile ?? null);
  const [permissions, setPermissions] = useState<Permission | null>(
    initialAuth?.permissions ?? null
  );
  const [schoolIds, setSchoolIds] = useState<string[]>(initialAuth?.schoolIds ?? []);
  const [demoSchoolIds, setDemoSchoolIds] = useState<string[]>(initialAuth?.demoSchoolIds ?? []);
  const [selectedSchoolId, setSelectedSchoolIdState] = useState<string | 'all' | null>(
    initialAuth?.selectedSchoolId ?? null
  );
  // initialAuth があれば最初からローディング非表示（認証待ちギャップを消す）
  const [isLoading, setIsLoading] = useState(!initialAuth);
  const lastUserIdRef = useRef<string | null>(initialAuth?.user.id ?? null);

  // 選択された教室IDを設定（localStorage + cookie に即時保存）
  // cookie は useEffect でもミラーされるが、handleSchoolChange → router.refresh() の流れでは
  // useEffect がレンダー後に実行されるため router.refresh() にクッキーが間に合わない。
  // setSelectedSchoolId 呼び出し時に同期でクッキーを書いておくことで、
  // サーバー側の prefetch が常に最新の教室選択を読めるようにする。
  const setSelectedSchoolId = useCallback((schoolId: string | 'all') => {
    setSelectedSchoolIdState(schoolId);
    if (typeof window !== 'undefined') {
      localStorage.setItem('selectedSchoolId', schoolId);
      document.cookie = `selectedSchoolId=${encodeURIComponent(schoolId)}; path=/; max-age=31536000; SameSite=Lax`;
    }
  }, []);

  // 選択された教室IDの配列を返す（'all'の場合はデモ教室を除外）
  const getSelectedSchoolIds = useCallback((): string[] => {
    if (selectedSchoolId === 'all') {
      const demoSet = new Set(demoSchoolIds);
      return schoolIds.filter((id) => !demoSet.has(id));
    }
    if (selectedSchoolId) {
      return [selectedSchoolId];
    }
    return [];
  }, [selectedSchoolId, schoolIds, demoSchoolIds]);

  // 教室選択を cookie にミラーする（Server Component が初期描画時に現在の選択を読めるようにするための土台）。
  // localStorage は引き続きクライアントの正典。selectedSchoolId(state) を唯一の監視点にすることで、
  // setter・初期化のどの経路で変わっても確実に同期される。
  // 注: cookie 値は信頼の根拠にしない。サーバー側の利用者は必ずユーザーの実アクセス権（schoolIds）で
  // 検証すること（教室選択はUI設定で機微情報ではないが、ブラウザ共有時の陳腐化に備える）。
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!selectedSchoolId) return; // 未選択(null)のときは書かない（初期化中の一時的な null を避ける）
    document.cookie = `selectedSchoolId=${encodeURIComponent(selectedSchoolId)}; path=/; max-age=31536000; SameSite=Lax`;
  }, [selectedSchoolId]);

  // プロファイルを取得
  const fetchProfile = useCallback(
    async (userId: string, authUser?: User | null, isMounted?: () => boolean) => {
      try {
        const userProfile = await getUserProfile(userId);

        // 未登録ユーザー（プロフィール無し）は自動作成しない。
        // 以前はここでログインしただけのユーザーに teacher/admin プロフィールを
        // 自動生成していたが、関係ない Google アカウントでもログインするだけで
        // アカウントが作られてしまう穴（さらにパスワード設定で講師として侵入できる）
        // があったため廃止。未登録ユーザーはサインアウトしてログイン画面へ戻す。
        // アカウントは管理者が事前に作成する運用とする。
        if (!userProfile && authUser) {
          if (isMounted && !isMounted()) return null;
          try {
            const supabase = createSupabaseBrowserClient();
            await supabase.auth.signOut({ scope: 'local' });
          } catch {
            // サインアウト失敗は無視（この後どのみちログイン画面へ送る）
          }
          if (typeof window !== 'undefined') {
            window.location.href = '/login?error=not_registered';
          }
          return null;
        }

        if (isMounted && !isMounted()) return null;

        if (userProfile) {
          if (isMounted && !isMounted()) return null;
          setProfile(userProfile);
          setPermissions(getPermissions(userProfile.role));

          // 教室IDを取得
          let fetchedSchoolIds: string[] = [];
          // デモ教室ID（'all'選択時の除外 / デフォルト教室の判定に使う）
          let demoIds: string[] = [];
          try {
            // システム管理者とオーナーはすべての教室にアクセス可能
            if (userProfile.role === 'admin' || userProfile.role === 'owner') {
              const allSchools = await getSchools();
              fetchedSchoolIds = allSchools.map((school) => school.id);
              demoIds = allSchools.filter((s) => s.is_demo).map((s) => s.id);
            } else {
              // その他のロールは紐付けられた教室のみ
              const userSchools = await getUserSchools(userId);
              fetchedSchoolIds = userSchools.map((us) => us.school_id);
              // manager 等でもデモ教室を判定できるよう join 済みの school.is_demo を見る
              demoIds = userSchools
                .filter((us) => (us.school as { is_demo?: boolean } | null)?.is_demo)
                .map((us) => us.school_id);
            }
            // デモ教室IDを記録（'all'選択時に除外するため）
            setDemoSchoolIds(demoIds);
          } catch (schoolsErr: unknown) {
            // AbortErrorは無視
            if (isAbortError(schoolsErr)) {
              return null;
            }
            throw schoolsErr;
          }

          if (isMounted && !isMounted()) return null;
          setSchoolIds(fetchedSchoolIds);

          // 教室選択の初期化。決定ロジックは resolveSelectedSchoolId に集約し、
          // サーバー(resolveServerAuth)と共有して挙動ズレを防ぐ。
          // 保存済みの選択はクライアントでは localStorage を出所にする。
          if (typeof window !== 'undefined' && fetchedSchoolIds.length > 0) {
            const savedSchoolId = localStorage.getItem('selectedSchoolId');
            const resolved = resolveSelectedSchoolId(
              fetchedSchoolIds,
              demoIds,
              savedSchoolId,
              userProfile.default_school_id ?? null
            );
            if (resolved) {
              setSelectedSchoolIdState(resolved);
              // 解決した選択を localStorage に永続化（次回以降の初期選択に使う）
              localStorage.setItem('selectedSchoolId', resolved);
            }
          }

          // 最終ログイン更新（エラーが発生しても続行）
          try {
            await updateLastLogin(userId);
          } catch (loginErr: unknown) {
            // AbortErrorは無視
            if (isAbortError(loginErr)) {
              return userProfile;
            }
            // 最終ログイン更新のエラーは致命的ではないので、ログに記録するだけ
            console.error('Error updating last login:', loginErr);
          }
        }
        return userProfile;
      } catch (err: unknown) {
        // AbortErrorは無視（コンポーネントがアンマウントされた場合）
        if (isAbortError(err)) {
          return null;
        }
        console.error('Error fetching profile:', err);
        return null;
      }
    },
    []
  );

  // プロファイルを再取得
  const refreshProfile = useCallback(async () => {
    if (user) {
      await fetchProfile(user.id, user);
    }
  }, [user, fetchProfile]);

  // ログアウト本体。リダイレクト先を差し替えられるようにして、通常ログアウトと
  // 無操作ログアウト（理由付きでログイン画面に通知表示）で使い回す。
  const performSignOut = useCallback(
    async (redirectTo: string = '/login') => {
      clearAllFetchCache();
      const supabase = createSupabaseBrowserClient();
      try {
        await supabase.auth.signOut({ scope: 'local' });
      } catch (_error) {
        // ログアウトエラーは無視
      }
      // 即時リダイレクトで、状態クリア後の「権限がありません」画面を経由せずログインへ
      if (typeof window !== 'undefined') {
        window.location.href = redirectTo;
        return;
      }
      setUser(null);
      setProfile(null);
      setPermissions(null);
      setSchoolIds([]);
      setDemoSchoolIds([]);
      setSelectedSchoolIdState(null);
      router.replace('/login');
    },
    [router]
  );

  // 通常のサインアウト（コンテキスト経由で各画面に公開）。
  const handleSignOut = useCallback(() => performSignOut('/login'), [performSignOut]);

  // 無操作（アイドル）ログアウト。ログイン済みのときだけ作動し、ロール別の
  // タイムアウト（講師60分 / 教室長以上2時間）で自動サインアウトする。
  // ログイン画面では「自動ログアウトした」旨を通知するため reason を付ける。
  useInactivityLogout({
    enabled: !!user && !!profile,
    role: profile?.role ?? null,
    onTimeout: () => {
      void performSignOut('/login?reason=inactivity');
    },
  });

  // 認証状態の監視
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let mounted = true;
    let subscription: { unsubscribe: () => void } | null = null;

    // 初期セッション取得
    const initializeAuth = async () => {
      try {
        const {
          data: { session },
          error,
        } = await supabase.auth.getSession();
        if (!mounted) return;

        if (error) {
          console.error('Error getting session:', error);
          if (mounted) {
            setIsLoading(false);
          }
          return;
        }

        // ブラウザ完全終了検知: マーカー cookie（セッション限定）が無いのに
        // Supabase セッション（永続 cookie）が残っている＝前回ブラウザを閉じた後の
        // 再訪問とみなし、明示的にサインアウトしてログイン状態を持ち越さない。
        // マーカーはこのチェックの後（分岐に関わらず）必ず立て直す。
        if (session?.user && isStaleSessionAfterBrowserClose()) {
          setBrowserSessionMarker();
          await performSignOut('/login');
          return;
        }
        setBrowserSessionMarker();

        if (session?.user) {
          if (mounted) {
            setUser(session.user);
            lastUserIdRef.current = session.user.id;
          }
          // サーバーで initialAuth をシード済みで同一ユーザーなら、profile/権限/対象校は
          // 既に初期 state に入っている。ここで再 fetch すると新しい配列 identity になり
          // getSelectedSchoolIds の参照が変わって各ボードが再取得してしまうため、スキップする
          // （Pillar A の肝。セッション監視 onAuthStateChange は維持され、ユーザー変更・
          //   サインアウトは引き続き検知する）。
          const seeded = initialAuthRef.current;
          if (seeded && seeded.user.id === session.user.id) {
            // 再取得はしないが、最終ログインだけは従来同様に更新する
            // （DB 書き込みのみで setState を伴わないため、ボードの再取得は誘発しない）。
            void updateLastLogin(session.user.id).catch(() => {});
          } else {
            await fetchProfile(session.user.id, session.user, () => mounted);
          }
        } else {
          if (mounted) {
            lastUserIdRef.current = null;
            setUser(null);
            setProfile(null);
            setPermissions(null);
            setSchoolIds([]);
          }
        }
      } catch (err: unknown) {
        // AbortErrorは無視（コンポーネントがアンマウントされた場合）
        if (isAbortError(err)) {
          return;
        }
        console.error('Error initializing auth:', err);
        if (mounted) {
          lastUserIdRef.current = null;
          setUser(null);
          setProfile(null);
          setPermissions(null);
          setSchoolIds([]);
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    initializeAuth();

    // 認証状態変更の監視
    try {
      const {
        data: { subscription: authSubscription },
      } = supabase.auth.onAuthStateChange((event, session) => {
        // コールバックを同期的に処理し、非同期処理は別途実行
        if (!mounted) return;

        // TOKEN_REFRESHED（タブ切替時のトークン更新）では読み込み表示を出さない
        const isTokenRefresh = event === 'TOKEN_REFRESHED';

        if (session?.user) {
          if (mounted) {
            setUser(session.user);
            // タブ切替時: TOKEN_REFRESHED または同一ユーザーの再検知では読み込みを出さない
            const isSameUserRecovery = lastUserIdRef.current === session.user.id;
            if (!isTokenRefresh && !isSameUserRecovery) {
              setIsLoading(true);
            }
          }
          // トークン更新または同一ユーザー復帰の場合は既存プロファイルで十分、fetchProfileはスキップ
          if (isTokenRefresh || lastUserIdRef.current === session.user.id) return;

          // 非同期処理はsetTimeoutで遅延実行して、コールバックを同期的に終了させる
          setTimeout(async () => {
            if (!mounted) return;
            try {
              await fetchProfile(session.user!.id, session.user, () => mounted);
            } catch (profileErr: unknown) {
              // AbortErrorは無視
              if (isAbortError(profileErr)) {
                return;
              }
              // その他のエラーはログに記録するが、処理は続行
              console.error('Error fetching profile in auth state change:', profileErr);
            } finally {
              if (mounted) {
                lastUserIdRef.current = session.user!.id;
                setIsLoading(false);
              }
            }
          }, 0);
        } else {
          if (mounted) {
            lastUserIdRef.current = null;
            setUser(null);
            setProfile(null);
            setPermissions(null);
            setSchoolIds([]);
            setSelectedSchoolIdState(null);
            setIsLoading(false);
          }
        }
      });
      subscription = authSubscription;
    } catch (err) {
      console.error('Error setting up auth state change listener:', err);
    }

    return () => {
      mounted = false;
      if (subscription) {
        subscription.unsubscribe();
      }
    };
    // performSignOut は useCallback([router]) で安定しているため、追加しても
    // 実質的な再購読は発生しない（router 自体は不変参照）。
  }, [fetchProfile, performSignOut]);

  // 認証チェック & リダイレクト
  useEffect(() => {
    if (isLoading) return;

    const isPublicPath = PUBLIC_PATHS.some((path) => pathname?.startsWith(path));
    const isInvitePath = pathname?.startsWith(INVITE_PATH);

    if (!user && !isPublicPath && !isInvitePath) {
      // 未ログインで保護されたページにアクセス → ログインへ
      router.push(`/login?redirect=${encodeURIComponent(pathname || '/')}`);
    } else if (user && pathname === '/login') {
      // ログイン済みでログインページにアクセス → ダッシュボードへ
      router.push('/students');
    }
  }, [user, isLoading, pathname, router]);

  // 未ログインで保護ページにいる間は子を描画しない（権限画面の一瞬表示を防ぐ）
  const isPublicPath = PUBLIC_PATHS.some((path) => pathname?.startsWith(path));
  const isInvitePath = pathname?.startsWith(INVITE_PATH);
  const shouldShowLoadingInsteadOfChildren = !isLoading && !user && !isPublicPath && !isInvitePath;

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        permissions,
        schoolIds,
        demoSchoolIds,
        selectedSchoolId,
        isLoading,
        signOut: handleSignOut,
        refreshProfile,
        setSelectedSchoolId,
        getSelectedSchoolIds,
      }}
    >
      {shouldShowLoadingInsteadOfChildren ? (
        <div className="min-h-screen flex items-center justify-center bg-[#f3f4f6]">
          <Loading />
        </div>
      ) : (
        children
      )}
    </AuthContext.Provider>
  );
}

// カスタムフック
export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
