'use client';

import { useState, useEffect } from 'react';
import { AdminLayout } from '@/components/layouts';
import { useAuth } from '@/contexts/AuthContext';
import { createSupabaseBrowserClient } from '@/lib/supabase';
import Link from 'next/link';
import { ChevronLeft, Calendar, CheckCircle, XCircle, RefreshCw } from 'lucide-react';

interface CalendarConnection {
  userId: string;
  displayName: string;
  role: string;
  calendarEmail: string | null;
  connectedAt: string;
  tokenExpiry: string;
  schools: Array<{ id: string; name: string }>;
}

export default function IntegrationsPage() {
  const { profile } = useAuth();
  const [connections, setConnections] = useState<CalendarConnection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const isAdminOrOwner = profile?.role === 'admin' || profile?.role === 'owner';

  useEffect(() => {
    if (!isAdminOrOwner) return;
    fetchConnections();
  }, [isAdminOrOwner]);

  const fetchConnections = async () => {
    setIsLoading(true);
    setError('');
    try {
      const supabase = createSupabaseBrowserClient();
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/integrations/google/connections', {
        headers: {
          Authorization: `Bearer ${session?.access_token || ''}`,
        },
      });
      if (!res.ok) throw new Error('取得に失敗しました');
      const data = await res.json();
      setConnections(data.connections || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isAdminOrOwner) {
    return (
      <AdminLayout headerTitle="外部サービス連携">
        <div className="text-center py-12 text-gray-500">この画面はシステム管理者のみ利用できます</div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout headerTitle="外部サービス連携">
      <div className="max-w-4xl mx-auto">
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4 transition-colors duration-150"
        >
          <ChevronLeft className="w-4 h-4" />
          設定に戻る
        </Link>

        {/* Google Calendar Section */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Calendar className="w-5 h-5 text-blue-600" />
              <div>
                <h2 className="text-base font-bold text-gray-900">Googleカレンダー連携状況</h2>
                <p className="text-xs text-gray-500 mt-0.5">模試の振替予定が各ユーザーのカレンダーに自動登録されます</p>
              </div>
            </div>
            <button
              onClick={fetchConnections}
              className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors duration-150"
              title="更新"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          {isLoading ? (
            <div className="px-6 py-8 text-center text-gray-400">
              <div className="w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
              読み込み中...
            </div>
          ) : error ? (
            <div className="px-6 py-8 text-center text-red-500 text-sm">{error}</div>
          ) : connections.length === 0 ? (
            <div className="px-6 py-8 text-center text-gray-400">
              <XCircle className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">まだ誰もカレンダー連携していません</p>
              <p className="text-xs mt-1">各ユーザーが「設定 → アカウント → 外部サービス連携」から連携できます</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {connections.map((conn) => {
                const isExpired = new Date(conn.tokenExpiry) < new Date();
                return (
                  <div key={conn.userId} className="px-6 py-4 flex items-center gap-4">
                    {/* Status Icon */}
                    <div className="flex-shrink-0">
                      {isExpired ? (
                        <XCircle className="w-5 h-5 text-orange-400" />
                      ) : (
                        <CheckCircle className="w-5 h-5 text-green-500" />
                      )}
                    </div>

                    {/* User Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900">{conn.displayName}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{conn.role}</span>
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {conn.calendarEmail || 'メール不明'}
                      </div>
                    </div>

                    {/* Schools */}
                    <div className="flex-shrink-0 text-right">
                      <div className="flex flex-wrap gap-1 justify-end">
                        {conn.schools.map((s) => (
                          <span
                            key={s.id}
                            className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700"
                          >
                            {s.name}
                          </span>
                        ))}
                      </div>
                      <div className="text-[10px] text-gray-400 mt-1">
                        {isExpired ? (
                          <span className="text-orange-500">トークン期限切れ（自動更新されます）</span>
                        ) : (
                          <>連携日: {new Date(conn.connectedAt).toLocaleDateString('ja-JP')}</>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Info */}
        <div className="mt-4 bg-blue-50 rounded-lg p-4 text-xs text-blue-700">
          <p className="font-medium mb-1">連携の仕組み</p>
          <ul className="list-disc list-inside space-y-0.5 text-blue-600">
            <li>各教室長が自分のアカウント設定からGoogleカレンダーを連携します</li>
            <li>模試フォームで「振替受験」が送信されると、該当教室のメールアドレスと一致するユーザーのカレンダーに予定が追加されます</li>
            <li>トークンは自動更新されますが、Google側で権限を取り消した場合は再連携が必要です</li>
          </ul>
        </div>
      </div>
    </AdminLayout>
  );
}
