import { supabase } from '@/lib/supabase';

/** 生徒管理ページ上部に表示する外部ツールへのクイックリンク */
export interface QuickLink {
  id: string;
  label: string;
  url: string;
}

async function getAccessToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

/**
 * クイックリンク一覧を取得（全教室共通）。
 * 取得失敗時は空配列を返してUIを壊さないようにする。
 */
export async function getQuickLinks(): Promise<QuickLink[]> {
  try {
    const token = await getAccessToken();
    if (!token) return [];
    const res = await fetch('/api/quick-links', {
      headers: { Authorization: `Bearer ${token}` },
      // 設定画面で更新したらすぐ反映したいのでキャッシュなし
      cache: 'no-store',
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { links?: QuickLink[] };
    return Array.isArray(json.links) ? json.links : [];
  } catch (e) {
    console.warn('getQuickLinks failed:', e);
    return [];
  }
}

/**
 * クイックリンクを上書き保存（教室長以上のみ）。
 */
export async function saveQuickLinks(links: QuickLink[]): Promise<QuickLink[]> {
  const token = await getAccessToken();
  if (!token) throw new Error('認証が必要です');
  const res = await fetch('/api/quick-links', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ links }),
  });
  const json = (await res.json()) as { links?: QuickLink[]; error?: string };
  if (!res.ok) {
    throw new Error(json.error || '保存に失敗しました');
  }
  return json.links ?? [];
}
