'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase';
import { Loading } from '@/components/ui';

const GOOGLE_AUTH_ALLOWED_ROLES = ['admin', 'owner', 'manager'];

export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    const run = async () => {
      const supabase = createSupabaseBrowserClient();
      const {
        data: { session },
        error,
      } = await supabase.auth.getSession();
      if (error || !session) {
        router.replace('/login?error=auth_failed');
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from('user_profiles')
        .select('id, role')
        .eq('id', session.user.id)
        .maybeSingle();

      if (profileError || !profile) {
        // ★未登録者は scope:'global' でサーバー側のセッション（リフレッシュトークン）ごと失効させる。
        //   'local' だとこの端末の保存を消すだけで、URL から取り出したトークンや別タブのセッションは
        //   有効なまま残り、プロフィールの無い authenticated として PostgREST を叩き続けられる。
        //   プロフィールが無い＝正規の利用者ではないので、他端末のセッションを切っても困る人はいない。
        //   （Supabase の「新規登録を許可」を OFF にすると、未登録の Google アカウントは
        //    そもそも Auth 側で作成を拒否されここまで来ないが、既に作られてしまった分の保険として残す）
        //   読み込みエラー（profileError）でも同じ扱いにするのは、判定できないまま通さないため。
        await supabase.auth.signOut({ scope: 'global' }).catch(() => undefined);
        await supabase.auth.signOut({ scope: 'local' });
        router.replace('/login?error=not_registered');
        return;
      }

      if (!GOOGLE_AUTH_ALLOWED_ROLES.includes(profile.role)) {
        // こちらは 'local' のまま。講師などは正規の利用者で、パスワードでログインしている
        // 他の端末まで巻き添えでログアウトさせないため（Google ログインを許可しないのは運用上の制限で、
        // このセッションで本人の権限以上のことはできない）。
        await supabase.auth.signOut({ scope: 'local' });
        router.replace('/login?error=not_allowed');
        return;
      }

      router.replace('/students');
    };

    run();
  }, [router]);

  return (
    <div className="min-h-screen bg-surface-hover flex items-center justify-center">
      <Loading label="認証中..." />
    </div>
  );
}
