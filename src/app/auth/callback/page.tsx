'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase';

// Google認証を許可するロール
const GOOGLE_AUTH_ALLOWED_ROLES = ['admin', 'owner', 'manager'];

export default function AuthCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const handleCallback = async () => {
      const supabase = createSupabaseBrowserClient();
      
      // URLからcodeを取得
      const code = searchParams.get('code');
      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          console.error('Auth callback error:', exchangeError);
          router.push('/login?error=auth_failed');
          return;
        }
      }

      // セッションを取得
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      
      if (sessionError) {
        console.error('Auth callback error:', sessionError);
        router.push('/login?error=auth_failed');
        return;
      }

      if (!session) {
        router.push('/login');
        return;
      }

      // user_profilesでプロファイルと権限をチェック
      const { data: profile, error: profileError } = await supabase
        .from('user_profiles')
        .select('id, role')
        .eq('id', session.user.id)
        .maybeSingle();

      if (profileError) {
        console.error('Profile fetch error:', profileError);
        await supabase.auth.signOut();
        router.push('/login?error=auth_failed');
        return;
      }

      if (!profile) {
        // プロファイルがない = 管理者が作成していないアカウント
        await supabase.auth.signOut();
        router.push('/login?error=not_registered');
        return;
      }

      // 権限チェック（manager以上のみGoogleログイン可能）
      if (!GOOGLE_AUTH_ALLOWED_ROLES.includes(profile.role)) {
        await supabase.auth.signOut();
        router.push('/login?error=not_allowed');
        return;
      }

      // 認証成功 - ダッシュボードにリダイレクト
      router.push('/students');
    };

    handleCallback();
  }, [router, searchParams]);

  return (
    <div className="min-h-screen bg-[#eff0f3] flex items-center justify-center">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-[#ff8e3c] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
        <p className="text-[#2a2a2a]">認証中...</p>
      </div>
    </div>
  );
}
