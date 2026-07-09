import { fetchWithAuth } from '@/lib/api/auth';

/** ログイン画面に表示する業務用サイトへのリンク */
export interface LoginLink {
  id: string;
  label: string;
  url: string;
}

/**
 * ログインリンク一覧を取得（全教室共通・未認証で取得可）。
 * ログイン画面は未認証状態から表示するため、認証ヘッダー無しの通常 fetch を使う。
 * 取得失敗時は空配列を返してログイン画面を壊さないようにする。
 */
export async function getLoginLinks(): Promise<LoginLink[]> {
  try {
    const res = await fetch('/api/login-links', { cache: 'no-store' });
    if (!res.ok) {
      console.warn('getLoginLinks: HTTP', res.status);
      return [];
    }
    const json = (await res.json()) as { links?: LoginLink[] };
    return Array.isArray(json.links) ? json.links : [];
  } catch (e) {
    console.warn('getLoginLinks failed:', e);
    return [];
  }
}

/**
 * ログインリンクを上書き保存（教室長以上のみ）。
 */
export async function saveLoginLinks(links: LoginLink[]): Promise<LoginLink[]> {
  const res = await fetchWithAuth('/api/login-links', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ links }),
  });
  const json = (await res.json()) as { links?: LoginLink[]; error?: string };
  if (!res.ok) {
    throw new Error(json.error || '保存に失敗しました');
  }
  return json.links ?? [];
}
