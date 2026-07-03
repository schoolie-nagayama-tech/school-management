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
 *
 * 認証直後はセッショントークンがまだ復元されておらず、Authorization ヘッダーも
 * Cookie も無い一瞬がある。その間に叩くと 401 が確定し、上部バーの useEffect は
 * profile 確定後に1回しか取得しないため「恒久データがあるのに空表示（＝未設定に見える）」
 * のまま固定されてしまう。そこで 401 のときだけ短い間隔で数回リトライし、
 * セッション確定後に本来のリンクを取得できるようにする。
 */
export async function getQuickLinks(): Promise<QuickLink[]> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetchWithAuth('/api/quick-links');
      if (res.ok) {
        const json = (await res.json()) as { links?: QuickLink[] };
        return Array.isArray(json.links) ? json.links : [];
      }
      // 401 はセッション未確定の可能性が高いので待って再試行。それ以外はUIを壊さず空で返す。
      if (res.status === 401 && attempt < 3) {
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
        continue;
      }
      console.warn('getQuickLinks: HTTP', res.status);
      return [];
    } catch (e) {
      console.warn('getQuickLinks failed:', e);
      return [];
    }
  }
  return [];
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
