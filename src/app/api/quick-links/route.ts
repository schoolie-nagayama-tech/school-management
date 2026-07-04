import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getApiAuth, requireManager } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';
// Next.js の Data Cache に載せない（このルート内の fetch を常に no-store 扱いにする）。
// これが無いと supabase-js の GET(select) が Data Cache にキャッシュされ、
// PUT で保存しても GET が古い値を返し続ける（＝「保存されるが読み込まれない」）不具合になる。
export const fetchCache = 'force-no-store';

// Service Role クライアント（RLS をバイパスして system_settings を読み書きする）
function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase env not set');
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    // 保険: supabase-js の内部 fetch を明示的に no-store にして、
    // Next.js の Data Cache による GET のキャッシュ（保存が読み込みに反映されない問題）を確実に防ぐ。
    global: {
      fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, { ...init, cache: 'no-store' })) as typeof fetch,
    },
  });
}

const SETTING_KEY = 'quick_links';

/**
 * GET /api/quick-links
 * 認証済みであれば誰でも取得可（講師含む全ロールで上部バーに表示するため）
 */
export async function GET(request: NextRequest) {
  const { auth } = await getApiAuth(request);
  if (!auth) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { data, error } = await supabaseAdmin
      .from('system_settings')
      .select('value')
      .eq('key', SETTING_KEY)
      .maybeSingle();

    if (error) {
      console.error('quick-links GET error:', error);
      return NextResponse.json({ links: [] });
    }

    // 未設定時は空配列を返す（マイグレーション未適用環境の保険）
    const raw = data?.value ?? '[]';
    let links: unknown = [];
    try {
      links = JSON.parse(raw);
    } catch {
      links = [];
    }
    return NextResponse.json({ links: Array.isArray(links) ? links : [] });
  } catch (err) {
    console.error('quick-links GET fatal:', err);
    return NextResponse.json({ links: [] });
  }
}

/**
 * PUT /api/quick-links
 * 教室長以上のみ。リンク配列全体を上書き保存する。
 * body: { links: { id: string, label: string, url: string }[] }
 */
export async function PUT(request: NextRequest) {
  const denied = await requireManager(request);
  if (denied) return denied;

  let body: { links?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON が不正です' }, { status: 400 });
  }

  const links = body.links;
  if (!Array.isArray(links)) {
    return NextResponse.json({ error: 'links は配列で指定してください' }, { status: 400 });
  }

  // 各要素を検証：label/url は空でない文字列、url は http(s) スキームのみ許可（XSS/javascript: 対策）
  const sanitized: { id: string; label: string; url: string }[] = [];
  for (const item of links) {
    if (!item || typeof item !== 'object') {
      return NextResponse.json({ error: 'リンクの形式が不正です' }, { status: 400 });
    }
    const obj = item as Record<string, unknown>;
    const label = typeof obj.label === 'string' ? obj.label.trim() : '';
    const url = typeof obj.url === 'string' ? obj.url.trim() : '';
    const id = typeof obj.id === 'string' && obj.id ? obj.id : crypto.randomUUID();
    if (!label) {
      return NextResponse.json({ error: 'ラベルを入力してください' }, { status: 400 });
    }
    if (!url) {
      return NextResponse.json({ error: 'URL を入力してください' }, { status: 400 });
    }
    if (!/^https?:\/\//i.test(url)) {
      return NextResponse.json(
        { error: 'URL は http:// または https:// で始めてください' },
        { status: 400 }
      );
    }
    if (label.length > 40) {
      return NextResponse.json({ error: 'ラベルは40文字以内で入力してください' }, { status: 400 });
    }
    if (url.length > 2000) {
      return NextResponse.json({ error: 'URL が長すぎます' }, { status: 400 });
    }
    sanitized.push({ id, label, url });
  }

  // 上限: 想定外の大量登録を防ぐ
  if (sanitized.length > 30) {
    return NextResponse.json({ error: 'リンクは30件まで登録できます' }, { status: 400 });
  }

  try {
    const supabaseAdmin = getSupabaseAdmin();
    const now = new Date().toISOString();
    const { error } = await supabaseAdmin.from('system_settings').upsert(
      {
        key: SETTING_KEY,
        value: JSON.stringify(sanitized),
        description: '生徒管理ページ上部に表示する外部ツールへのクイックリンク（全教室共通）',
        category: 'ui',
        updated_at: now,
      },
      { onConflict: 'key' }
    );

    if (error) {
      console.error('quick-links PUT error:', error);
      return NextResponse.json(
        { error: '保存に失敗しました', detail: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, links: sanitized });
  } catch (err) {
    console.error('quick-links PUT fatal:', err);
    const message = err instanceof Error ? err.message : '不明なエラー';
    return NextResponse.json(
      { error: 'サーバーエラーが発生しました', detail: message },
      { status: 500 }
    );
  }
}
