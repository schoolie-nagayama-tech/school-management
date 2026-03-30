import { supabase } from '../supabase';

/**
 * 講習準備サーバーAPI呼び出しヘルパー
 * service role でRLSをバイパスして書き込み操作を実行する
 */
export async function callCoursePrepApi(
  action: string,
  schoolId: string,
  params: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    throw new Error('認証が必要です。ログインし直してください。');
  }

  const res = await fetch('/api/courses/prep', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action, schoolId, ...params }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || '操作に失敗しました');
  }
  return data;
}
