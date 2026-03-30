import { supabase } from '../supabase';

async function getAccessToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    throw new Error('認証が必要です。ログインし直してください。');
  }
  return session.access_token;
}

/**
 * 講習準備サーバーAPI: 書き込み操作（POST）
 */
export async function callCoursePrepApi(
  action: string,
  schoolId: string,
  params: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  const token = await getAccessToken();

  const res = await fetch('/api/courses/prep', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ action, schoolId, ...params }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || '操作に失敗しました');
  }
  return data;
}

/**
 * 講習準備サーバーAPI: 読み取り操作（GET）
 */
export async function fetchCoursePrepApi(
  action: string,
  params: Record<string, string>
): Promise<Record<string, unknown>> {
  const token = await getAccessToken();

  const searchParams = new URLSearchParams({ action, ...params });
  const res = await fetch(`/api/courses/prep?${searchParams.toString()}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || '取得に失敗しました');
  }
  return data;
}
