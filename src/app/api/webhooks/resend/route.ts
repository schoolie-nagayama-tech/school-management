/**
 * POST /api/webhooks/resend
 *
 * Resend (Svix形式) の Webhook を受信し、inquiry_mail_logs に
 * 開封日時 (opened_at) / クリック日時 (clicked_at) を記録する。
 *
 * 対象イベント:
 *   email.opened  → opened_at を初回のみ記録
 *   email.clicked → clicked_at を初回のみ記録。opened_at も未記録なら同時に埋める。
 *
 * その他のイベント (email.sent, email.delivered 等) は 200 で無視する。
 * resend_email_id に対応する行が存在しない場合も 200 正常終了とする
 * (問合せ以外のメール —— フォーム通知等 —— が届いても巻き込まれないようにするため)。
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

// Node.js runtime を明示 (crypto モジュール使用のため)
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ────────────────────────────────────────────────
// Supabase service role クライアント (RLS バイパス)
// ────────────────────────────────────────────────

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase env not set');
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ────────────────────────────────────────────────
// Svix 署名検証
// https://docs.svix.com/receiving/verifying-payloads/how
//
// 手順:
//   1. RESEND_WEBHOOK_SECRET から "whsec_" プレフィックスを除いて base64 デコードし鍵バイト列を得る
//   2. signedContent = `${svix-id}.${svix-timestamp}.${rawBody}` を構築
//   3. HMAC-SHA256(鍵, signedContent) を base64 エンコード
//   4. svix-signature ヘッダの値 ("v1,<sig1> v1,<sig2>" 形式) と比較
//   5. timestamp が現在から ±5分超の場合はリプレイ攻撃として拒否
// ────────────────────────────────────────────────

function verifySvixSignature(
  rawBody: string,
  svixId: string | null,
  svixTimestamp: string | null,
  svixSignature: string | null,
  secret: string
): boolean {
  if (!svixId || !svixTimestamp || !svixSignature) {
    console.error('[resend-webhook] missing svix headers', {
      hasId: !!svixId,
      hasTs: !!svixTimestamp,
      hasSig: !!svixSignature,
    });
    return false;
  }

  // リプレイ攻撃対策: ±5分を超えるリクエストは拒否
  const ts = parseInt(svixTimestamp, 10);
  if (isNaN(ts) || Math.abs(Date.now() / 1000 - ts) > 300) {
    console.error('[resend-webhook] timestamp out of range', { ts });
    return false;
  }

  // "whsec_" プレフィックスを除いて base64 デコード
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');

  // 署名対象文字列を組み立て
  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;

  // HMAC-SHA256 を計算して base64 エンコード
  const expectedSig = crypto
    .createHmac('sha256', secretBytes)
    .update(signedContent)
    .digest('base64');

  // svix-signature ヘッダは "v1,<base64sig>" が空白区切りで複数並ぶ場合がある
  // いずれか一つでも一致すれば OK
  const sigParts = svixSignature.split(' ');
  for (const part of sigParts) {
    const sigValue = part.startsWith('v1,') ? part.slice(3) : part;
    try {
      const ok = crypto.timingSafeEqual(
        Buffer.from(expectedSig),
        Buffer.from(sigValue)
      );
      if (ok) return true;
    } catch {
      // 長さ不一致などは不一致として次の候補へ
    }
  }

  console.error('[resend-webhook] signature mismatch', {
    expectedPrefix: expectedSig.slice(0, 8),
    receivedParts: sigParts.map((p) => p.slice(0, 12)),
  });
  return false;
}

// ────────────────────────────────────────────────
// Webhook ペイロード型
// ────────────────────────────────────────────────

interface ResendWebhookPayload {
  type: string;
  data: {
    email_id: string;
    [key: string]: unknown;
  };
}

// ────────────────────────────────────────────────
// Handler
// ────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // 環境変数チェック
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[resend-webhook] RESEND_WEBHOOK_SECRET is not configured');
    return NextResponse.json(
      { error: 'webhook secret not configured' },
      { status: 503 }
    );
  }

  // rawBody を先に読む（署名検証は raw テキストに対して行う）
  const rawBody = await request.text();

  // Svix 署名ヘッダを取得
  const svixId = request.headers.get('svix-id');
  const svixTimestamp = request.headers.get('svix-timestamp');
  const svixSignature = request.headers.get('svix-signature');

  // 署名検証
  if (!verifySvixSignature(rawBody, svixId, svixTimestamp, svixSignature, secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // JSON パース
  let payload: ResendWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { type, data } = payload;
  const emailId = data?.email_id;

  console.log('[resend-webhook] received', { type, emailId });

  // 対象外イベントは無視して正常終了
  if (type !== 'email.opened' && type !== 'email.clicked') {
    return NextResponse.json({ ok: true, ignored: true });
  }

  if (!emailId) {
    console.error('[resend-webhook] email_id missing in payload');
    return NextResponse.json({ error: 'email_id missing' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  try {
    if (type === 'email.opened') {
      // 初回開封のみ記録 (opened_at IS NULL の行のみ UPDATE)
      // .select('id') で更新された行を返させ、配列長で matched を判定する
      const { data: openedRows } = await admin
        .from('inquiry_mail_logs')
        .update({ opened_at: new Date().toISOString() })
        .eq('resend_email_id', emailId)
        .is('opened_at', null)
        .select('id');

      const matched = (openedRows?.length ?? 0) > 0;
      console.log('[resend-webhook] email.opened', { emailId, matched });
      return NextResponse.json({ ok: true, matched });
    }

    if (type === 'email.clicked') {
      const now = new Date().toISOString();

      // clicked_at を初回のみ記録
      // .select('id') で更新された行を返させ、配列長で matched を判定する
      const { data: clickedRows } = await admin
        .from('inquiry_mail_logs')
        .update({ clicked_at: now })
        .eq('resend_email_id', emailId)
        .is('clicked_at', null)
        .select('id');

      // クリック = 開封済みと同義なので opened_at も未記録なら同時に埋める
      await admin
        .from('inquiry_mail_logs')
        .update({ opened_at: now })
        .eq('resend_email_id', emailId)
        .is('opened_at', null);

      const matched = (clickedRows?.length ?? 0) > 0;
      console.log('[resend-webhook] email.clicked', { emailId, matched });
      return NextResponse.json({ ok: true, matched });
    }
  } catch (e) {
    console.error('[resend-webhook] DB update failed', e);
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }

  // ここには到達しないが TypeScript のための fallback
  return NextResponse.json({ ok: true });
}
