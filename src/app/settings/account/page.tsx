'use client';

import { useState, useEffect, useCallback } from 'react';
import { AdminLayout } from '@/components/layouts';
import { Button, Card, CardHeader, CardTitle, CardContent } from '@/components/ui';
import Link from 'next/link';
import { createSupabaseBrowserClient } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/useToast';
import { useConfirm } from '@/hooks/useConfirm';
import { ToastContainer } from '@/components/ui';

// Google認証を許可するロール
const GOOGLE_AUTH_ALLOWED_ROLES = ['admin', 'owner', 'manager'];

export default function AccountSettingsPage() {
  const { user, profile } = useAuth();
  const { toasts, removeToast, success, error: toastError } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const [linkedProviders, setLinkedProviders] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Google Calendar連携状態
  const [calendarStatus, setCalendarStatus] = useState<{
    connected: boolean;
    email?: string;
  }>({ connected: false });
  const [calendarLoading, setCalendarLoading] = useState(false);

  // Google認証が許可されているか
  const canUseGoogleAuth = profile && GOOGLE_AUTH_ALLOWED_ROLES.includes(profile.role);

  // Calendar連携状態を取得
  const fetchCalendarStatus = useCallback(async () => {
    try {
      const supabase = createSupabaseBrowserClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch('/api/integrations/google/calendar/status', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        const { data } = await res.json();
        setCalendarStatus(data);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const fetchIdentities = async () => {
      const supabase = createSupabaseBrowserClient();
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (currentUser?.identities) {
        setLinkedProviders(currentUser.identities.map(i => i.provider));
      }
      setIsLoading(false);
    };
    fetchIdentities();
    if (canUseGoogleAuth) {
      fetchCalendarStatus();
    }
  }, [canUseGoogleAuth, fetchCalendarStatus]);

  const handleLinkGoogle = async () => {
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.linkIdentity({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/settings/account?linked=google`,
      },
    });

    if (error) {
      toastError('Googleアカウントの紐付けに失敗しました');
    }
  };

  const handleUnlinkGoogle = async () => {
    if (!(await confirm({ description: 'Googleアカウントの紐付けを解除しますか？' }))) {
      return;
    }

    const supabase = createSupabaseBrowserClient();
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    const googleIdentity = currentUser?.identities?.find(i => i.provider === 'google');

    if (googleIdentity) {
      const { error } = await supabase.auth.unlinkIdentity(googleIdentity);
      if (error) {
        toastError('紐付け解除に失敗しました');
      } else {
        success('Googleアカウントの紐付けを解除しました');
        setLinkedProviders(prev => prev.filter(p => p !== 'google'));
      }
    }
  };

  // Google Calendar 連携開始
  const handleConnectCalendar = async () => {
    const supabase = createSupabaseBrowserClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      toastError('セッションが取得できません。再ログインしてください。');
      return;
    }
    // トークンをクエリパラメータで渡してリダイレクト
    window.location.href = `/api/integrations/google/authorize?token=${session.access_token}`;
  };

  // Google Calendar 連携解除
  const handleDisconnectCalendar = async () => {
    if (!(await confirm({ description: 'Googleカレンダー連携を解除しますか？\n模試の振替予定がカレンダーに自動追加されなくなります。' }))) {
      return;
    }

    setCalendarLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch('/api/integrations/google/calendar/disconnect', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (res.ok) {
        success('Googleカレンダー連携を解除しました');
        setCalendarStatus({ connected: false });
      } else {
        toastError('連携解除に失敗しました');
      }
    } catch {
      toastError('連携解除に失敗しました');
    } finally {
      setCalendarLoading(false);
    }
  };

  // URLパラメータからカレンダー連携結果を確認
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    // Google SSO紐付け成功
    if (params.get('linked') === 'google') {
      success('Googleアカウントの紐付けが完了しました');
      window.history.replaceState({}, '', '/settings/account');
      const fetchIdentities = async () => {
        const supabase = createSupabaseBrowserClient();
        const { data: { user: currentUser } } = await supabase.auth.getUser();
        if (currentUser?.identities) {
          setLinkedProviders(currentUser.identities.map(i => i.provider));
        }
      };
      fetchIdentities();
    }

    // カレンダー連携成功
    if (params.get('calendar_connected') === 'true') {
      const email = params.get('calendar_email') || '';
      success(`Googleカレンダーを連携しました${email ? `（${email}）` : ''}`);
      window.history.replaceState({}, '', '/settings/account');
      setCalendarStatus({ connected: true, email: email || undefined });
    }

    // カレンダー連携エラー
    const calendarError = params.get('calendar_error');
    if (calendarError) {
      toastError(calendarError);
      window.history.replaceState({}, '', '/settings/account');
    }
  }, [success, toastError]);

  const isGoogleLinked = linkedProviders.includes('google');

  if (isLoading) {
    return (
      <AdminLayout headerTitle="アカウント設定">
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-4 border-[#1e3a5f] border-t-transparent rounded-full animate-spin"></div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout headerTitle="アカウント設定">
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="mb-4">
          <Link href="/settings" className="inline-flex items-center gap-1 text-sm text-[#6b7280] hover:text-[#1f2937] transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            設定に戻る
          </Link>
        </div>

        {/* ログイン方法 */}
        <Card>
          <CardHeader>
            <CardTitle>ログイン方法</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* メール/パスワード */}
              <div className="flex items-center justify-between p-4 bg-[#f3f4f6] rounded-lg">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">📧</span>
                  <div>
                    <p className="font-medium text-[#1f2937]">メール/パスワード</p>
                    <p className="text-sm text-[#4b5563]">{user?.email || '未設定'}</p>
                  </div>
                </div>
                <span className="text-green-600 text-sm font-medium">有効</span>
              </div>

              {/* Google（教室長以上のみ表示） */}
              {canUseGoogleAuth && (
                <div className="flex items-center justify-between p-4 bg-[#f3f4f6] rounded-lg">
                  <div className="flex items-center gap-3">
                    <svg className="w-6 h-6" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                    <div>
                      <p className="font-medium text-[#1f2937]">Googleアカウント</p>
                      <p className="text-sm text-[#4b5563]">
                        {isGoogleLinked ? '紐付け済み' : '未紐付け'}
                      </p>
                    </div>
                  </div>
                  {isGoogleLinked ? (
                    <Button variant="secondary" size="sm" onClick={handleUnlinkGoogle}>
                      解除
                    </Button>
                  ) : (
                    <Button size="sm" onClick={handleLinkGoogle}>
                      紐付ける
                    </Button>
                  )}
                </div>
              )}

              {!canUseGoogleAuth && (
                <div className="p-4 bg-[#f3f4f6] rounded-lg">
                  <p className="text-sm text-[#4b5563]">
                    Googleログインは教室長以上のアカウントのみ利用可能です。
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* 外部サービス連携（教室長以上のみ） */}
        {canUseGoogleAuth && (
          <Card>
            <CardHeader>
              <CardTitle>外部サービス連携</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {/* Google Calendar */}
                <div className="flex items-center justify-between p-4 bg-[#f3f4f6] rounded-lg">
                  <div className="flex items-center gap-3">
                    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
                      <rect x="3" y="4" width="18" height="18" rx="2" stroke="#4285F4" strokeWidth="2"/>
                      <path d="M3 9h18" stroke="#4285F4" strokeWidth="2"/>
                      <path d="M9 4V2" stroke="#4285F4" strokeWidth="2" strokeLinecap="round"/>
                      <path d="M15 4V2" stroke="#4285F4" strokeWidth="2" strokeLinecap="round"/>
                      <rect x="7" y="12" width="3" height="3" rx="0.5" fill="#34A853"/>
                      <rect x="7" y="16" width="3" height="3" rx="0.5" fill="#FBBC05"/>
                      <rect x="11" y="12" width="3" height="3" rx="0.5" fill="#EA4335"/>
                    </svg>
                    <div>
                      <p className="font-medium text-[#1f2937]">Googleカレンダー</p>
                      {calendarStatus.connected ? (
                        <p className="text-sm text-[#4b5563]">
                          連携中: {calendarStatus.email || '(メール不明)'}
                        </p>
                      ) : (
                        <p className="text-sm text-[#4b5563]">
                          模試の振替予定を自動でカレンダーに追加します
                        </p>
                      )}
                    </div>
                  </div>
                  {calendarStatus.connected ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={handleDisconnectCalendar}
                      disabled={calendarLoading}
                    >
                      {calendarLoading ? '解除中...' : '解除'}
                    </Button>
                  ) : (
                    <Button size="sm" onClick={handleConnectCalendar}>
                      連携する
                    </Button>
                  )}
                </div>

                {calendarStatus.connected && (
                  <div className="px-4 py-2 bg-blue-50 rounded-lg">
                    <p className="text-xs text-blue-700">
                      模試フォームで「振替受験」が選択された際、あなたのGoogleカレンダーに振替予定が自動追加されます。
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
      {ConfirmDialog}
    </AdminLayout>
  );
}
