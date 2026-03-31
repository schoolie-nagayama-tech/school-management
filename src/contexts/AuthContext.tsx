'use client';

import { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase';
import { User } from '@supabase/supabase-js';
import type { UserProfile, Permission, UserRole } from '@/types/database';
import { getPermissions } from '@/types/database';
import { getUserProfile, createUserProfile, updateLastLogin, getUserSchools, addUserToSchool } from '@/lib/api/auth';
import { getSchools } from '@/lib/api/schools';

function isAbortError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.name === 'AbortError' || err.message?.includes('aborted') || err.message?.includes('signal is aborted');
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
const PUBLIC_PATHS = ['/login', '/forgot-password', '/auth/callback', '/auth/reset-password', '/portal', '/seasonal-shift', '/regular-shift'];

// 招待からの登録パス
const INVITE_PATH = '/invite';

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const router = useRouter();
  const pathname = usePathname();

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [permissions, setPermissions] = useState<Permission | null>(null);
  const [schoolIds, setSchoolIds] = useState<string[]>([]);
  const [demoSchoolIds, setDemoSchoolIds] = useState<string[]>([]);
  const [selectedSchoolId, setSelectedSchoolIdState] = useState<string | 'all' | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const lastUserIdRef = useRef<string | null>(null);

  // 選択された教室IDを設定（localStorageにも保存）
  const setSelectedSchoolId = useCallback((schoolId: string | 'all') => {
    setSelectedSchoolIdState(schoolId);
    if (typeof window !== 'undefined') {
      localStorage.setItem('selectedSchoolId', schoolId);
    }
  }, []);

  // 選択された教室IDの配列を返す（'all'の場合はデモ教室を除外）
  const getSelectedSchoolIds = useCallback((): string[] => {
    if (selectedSchoolId === 'all') {
      const demoSet = new Set(demoSchoolIds);
      return schoolIds.filter(id => !demoSet.has(id));
    }
    if (selectedSchoolId) {
      return [selectedSchoolId];
    }
    return [];
  }, [selectedSchoolId, schoolIds, demoSchoolIds]);

  // プロファイルを取得
  const fetchProfile = useCallback(async (userId: string, authUser?: User | null, isMounted?: () => boolean) => {
    try {
      let userProfile = await getUserProfile(userId);
      
      // プロファイルが存在しない場合は作成（初回ログイン時）
      if (!userProfile && authUser) {
        if (isMounted && !isMounted()) return null;
        
        const supabase = createSupabaseBrowserClient();
        // 既存のユーザーが0人の場合は管理者として作成
        let count: number | null = null;
        try {
          const result = await supabase
            .from('user_profiles')
            .select('*', { count: 'exact', head: true });
          count = result.count;
        } catch (countErr: unknown) {
          // AbortErrorは無視
          if (isAbortError(countErr)) {
            return null;
          }
          throw countErr;
        }
        
        if (isMounted && !isMounted()) return null;
        
        const role: UserRole = count === 0 ? 'admin' : 'teacher';
        
        try {
          userProfile = await createUserProfile(
            userId,
            authUser.email!,
            role,
            authUser.user_metadata?.full_name
          );
        } catch (createErr: unknown) {
          // AbortErrorは無視
          if (isAbortError(createErr)) {
            return null;
          }
          throw createErr;
        }
        
        // デフォルト教室に紐付け（teacherの場合）
        if (role === 'teacher' && process.env.NEXT_PUBLIC_DEFAULT_SCHOOL_ID) {
          try {
            await addUserToSchool(userId, process.env.NEXT_PUBLIC_DEFAULT_SCHOOL_ID);
          } catch (schoolErr: unknown) {
            // AbortErrorは無視
            if (isAbortError(schoolErr)) {
              return null;
            }
            // 教室紐付けのエラーは致命的ではないので、ログに記録するだけ
            console.error('Error adding user to school:', schoolErr);
          }
        }
      }
      
      if (isMounted && !isMounted()) return null;
      
      if (userProfile) {
        if (isMounted && !isMounted()) return null;
        setProfile(userProfile);
        setPermissions(getPermissions(userProfile.role));
        
        // 教室IDを取得
        let fetchedSchoolIds: string[] = [];
        try {
          // システム管理者とオーナーはすべての教室にアクセス可能
          if (userProfile.role === 'admin' || userProfile.role === 'owner') {
            const allSchools = await getSchools();
            fetchedSchoolIds = allSchools.map(school => school.id);
            // デモ教室IDを記録（'all'選択時に除外するため）
            setDemoSchoolIds(allSchools.filter(s => s.is_demo).map(s => s.id));
          } else {
            // その他のロールは紐付けられた教室のみ
            const userSchools = await getUserSchools(userId);
            fetchedSchoolIds = userSchools.map(us => us.school_id);
          }
        } catch (schoolsErr: unknown) {
          // AbortErrorは無視
          if (isAbortError(schoolsErr)) {
            return null;
          }
          throw schoolsErr;
        }
        
        if (isMounted && !isMounted()) return null;
        setSchoolIds(fetchedSchoolIds);

        // 教室選択の初期化（複数教室のときは default_school_id を優先）
        if (typeof window !== 'undefined' && fetchedSchoolIds.length > 0) {
          const savedSchoolId = localStorage.getItem('selectedSchoolId');
          const defaultSchoolId = userProfile.default_school_id ?? null;
          const hasValidDefault = defaultSchoolId && fetchedSchoolIds.includes(defaultSchoolId);

          if (fetchedSchoolIds.length === 1) {
            setSelectedSchoolIdState(fetchedSchoolIds[0]);
            localStorage.setItem('selectedSchoolId', fetchedSchoolIds[0]);
          } else {
            // 複数教室：選択画面を出さず、デフォルト教室（または保存値・先頭）に直接設定
            if (hasValidDefault) {
              setSelectedSchoolIdState(defaultSchoolId!);
              localStorage.setItem('selectedSchoolId', defaultSchoolId!);
            } else if (savedSchoolId && (savedSchoolId === 'all' || fetchedSchoolIds.includes(savedSchoolId))) {
              setSelectedSchoolIdState(savedSchoolId as string | 'all');
            } else {
              setSelectedSchoolIdState(fetchedSchoolIds[0]);
              localStorage.setItem('selectedSchoolId', fetchedSchoolIds[0]);
            }
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
  }, []);

  // プロファイルを再取得
  const refreshProfile = useCallback(async () => {
    if (user) {
      await fetchProfile(user.id, user);
    }
  }, [user, fetchProfile]);

  // ログアウト
  const handleSignOut = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch (_error) {
      // ログアウトエラーは無視
    }
    // 即時リダイレクトで、状態クリア後の「権限がありません」画面を経由せずログインへ
    if (typeof window !== 'undefined') {
      window.location.href = '/login';
      return;
    }
    setUser(null);
    setProfile(null);
    setPermissions(null);
    setSchoolIds([]);
    setDemoSchoolIds([]);
    setSelectedSchoolIdState(null);
    router.replace('/login');
  }, [router]);

  // 認証状態の監視
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let mounted = true;
    let subscription: { unsubscribe: () => void } | null = null;

    // 初期セッション取得
    const initializeAuth = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (!mounted) return;
        
        if (error) {
          console.error('Error getting session:', error);
          if (mounted) {
            setIsLoading(false);
          }
          return;
        }
        
        if (session?.user) {
          if (mounted) {
            setUser(session.user);
            lastUserIdRef.current = session.user.id;
          }
          await fetchProfile(session.user.id, session.user, () => mounted);
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
      const { data: { subscription: authSubscription } } = supabase.auth.onAuthStateChange(
        (event, session) => {
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
        }
      );
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
  }, [fetchProfile]);

  // 認証チェック & リダイレクト
  useEffect(() => {
    if (isLoading) return;

    const isPublicPath = PUBLIC_PATHS.some(path => pathname?.startsWith(path));
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
  const isPublicPath = PUBLIC_PATHS.some(path => pathname?.startsWith(path));
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
          <div className="w-10 h-10 border-4 border-[#1e3a5f] border-t-transparent rounded-full animate-spin" />
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
