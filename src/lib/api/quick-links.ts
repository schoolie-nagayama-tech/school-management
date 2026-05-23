import { fetchWithAuth } from '@/lib/api/auth';

/** 生徒管理ページ上部に表示する外部ツールへのクイックリンク */
export interface QuickLink {
  id: string;
  label: string;
  url: string;
}

/**
 * クイックリンク一覧を取得（全教室共通）。
 * 取得失敗時は空配列を返してUIを壊さないようにする。
 * fetchWithAuth は無効化されたセッションも自動で処理してくれる。
 */
export async function getQuickLinks(): Promise<QuickLink[]> {
  try {
    const res = await fetchWithAuth('/api/quick-links');
    if (!res.ok) {
      // 401 等は単に空配列として扱う（未ログイン時にUIを壊さない）
      console.warn('getQuickLinks: HTTP', res.status);
      return [];
    }
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
  const res = await fetchWithAuth('/api/quick-links', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ links }),
  });
  const json = (await res.json()) as { links?: QuickLink[]; error?: string };
  if (!res.ok) {
    throw new Error(json.error || '保存に失敗しました');
  }
  return json.links ?? [];
}
