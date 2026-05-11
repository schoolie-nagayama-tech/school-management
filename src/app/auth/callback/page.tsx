'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase';

const GOOGLE_AUTH_ALLOWED_ROLES = ['admin', 'owner', 'manager'];

export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    const run = async () => {
      const supabase = createSupabaseBrowserClient();
      const { data: { session }, error } = await supabase.auth.getSession();
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
        await supabase.auth.signOut({ scope: 'local' });
        router.replace('/login?error=not_registered');
        return;
      }

      if (!GOOGLE_AUTH_ALLOWED_ROLES.includes(profile.role)) {
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
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-ink border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
        <p className="text-text-body">認証中...</p>
      </div>
    </div>
  );
}
