import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { parseNottaSlackMessage } from '@/lib/utils/nottaSlackParser';
import { captureApiError } from '@/lib/api-error';

export const dynamic = 'force-dynamic';

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase env not set');
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Slack Events API 署名検証。
 * See: https://api.slack.com/authentication/verifying-requests-from-slack
 */
function verifySlackSignature(
  body: string,
  timestamp: string | null,
  signature: string | null
): boolean {
  const secret = (process.env.SLACK_SIGNING_SECRET || '').trim();
  if (!secret) {
    console.error('[slack-notta] SLACK_SIGNING_SECRET is not set');
    return false;
  }
  if (!timestamp || !signature) {
    console.error('[slack-notta] missing timestamp or signature header', {
      hasTs: !!timestamp,
      hasSig: !!signature,
    });
    return false;
  }

  // リプレイ攻撃対策: 5分以上古いリクエストは拒否
  const ts = parseInt(timestamp, 10);
  if (isNaN(ts) || Math.abs(Date.now() / 1000 - ts) > 60 * 5) return false;

  const base = `v0:${timestamp}:${body}`;
  const hmac = crypto.createHmac('sha256', secret).update(base).digest('hex');
  const expected = `v0=${hmac}`;

  try {
    const ok = crypto.timingSafeEqual(
      Buffer.from(expected, 'utf8'),
      Buffer.from(signature, 'utf8')
    );
    if (!ok) {
      console.error('[slack-notta] signature mismatch', {
        expectedPrefix: expected.slice(0, 12),
        gotPrefix: signature.slice(0, 12),
        bodyLen: body.length,
      });
    }
    return ok;
  } catch (e) {
    captureApiError(e, {
      route: 'POST /api/webhooks/slack/notta',
      action: 'verify_signature',
    });
    console.error('[slack-notta] signature compare threw', e);
    return false;
  }
}

interface SlackMessageEvent {
  type: string;
  subtype?: string;
  channel?: string;
  ts?: string;
  text?: string;
  bot_id?: string;
  user?: string;
  attachments?: Array<{ text?: string; fallback?: string; title?: string }>;
  blocks?: unknown;
}

interface SlackEventPayload {
  type: 'url_verification' | 'event_callback';
  challenge?: string;
  event?: SlackMessageEvent;
  team_id?: string;
  event_id?: string;
}

/**
 * Slack blocks / 任意のネスト構造から "text" フィールドを再帰的に抽出。
 * rich_text blocks (nested elements) にも対応。
 */
function collectTextFromBlocks(value: unknown, out: string[]): void {
  if (!value) return;
  if (typeof value === 'string') {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectTextFromBlocks(v, out);
    return;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    // "text" が文字列なら直接採用 (rich_text の text element など)
    if (typeof obj.text === 'string') {
      out.push(obj.text as string);
    } else if (obj.text) {
      // text が object (section block 等) なら中を再帰
      collectTextFromBlocks(obj.text, out);
    }
    // elements / fields / blocks など再帰対象を辿る
    for (const k of ['elements', 'fields', 'blocks']) {
      if (obj[k]) collectTextFromBlocks(obj[k], out);
    }
    // その他のキーで配列/オブジェクトがあれば辿る
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'text' || k === 'elements' || k === 'fields' || k === 'blocks') continue;
      if (Array.isArray(v) || (v && typeof v === 'object')) {
        collectTextFromBlocks(v, out);
      }
    }
    // URL も抽出対象にする（rich_text_link 要素の url フィールド）
    if (typeof obj.url === 'string') out.push(obj.url as string);
  }
}

/**
 * Slack の message イベントから、ブロック・アタッチメント・text を結合した
 * 完全なテキストを取り出す。
 */
function extractFullText(event: SlackMessageEvent): string {
  const parts: string[] = [];
  if (event.text) parts.push(event.text);
  if (event.attachments) {
    for (const att of event.attachments) {
      if (att.title) parts.push(att.title);
      if (att.text) parts.push(att.text);
      if (att.fallback) parts.push(att.fallback);
    }
  }
  if (event.blocks) {
    collectTextFromBlocks(event.blocks, parts);
  }
  return parts.join('\n');
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const timestamp = request.headers.get('x-slack-request-timestamp');
  const signature = request.headers.get('x-slack-signature');

  let payload: SlackEventPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch (error) {
    captureApiError(error, {
      route: 'POST /api/webhooks/slack/notta',
    });
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Slack App 設定時の URL 検証 (署名検証前に応答しても Slack 的に OK)
  // https://api.slack.com/events/url_verification
  if (payload.type === 'url_verification') {
    console.log('[slack-notta] url_verification received');
    // challenge をそのまま text で返すのが最も互換性が高い
    return new NextResponse(payload.challenge || '', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    });
  }

  if (!verifySlackSignature(rawBody, timestamp, signature)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (payload.type !== 'event_callback' || !payload.event) {
    console.log('[slack-notta] non-event payload', { type: payload.type });
    return NextResponse.json({ ok: true });
  }

  const event = payload.event;
  console.log('[slack-notta] event received', {
    type: event.type,
    subtype: event.subtype,
    channel: event.channel,
    ts: event.ts,
    hasText: !!event.text,
    textLen: event.text?.length,
    hasAttachments: !!event.attachments?.length,
    attachmentsCount: event.attachments?.length,
    hasBlocks: Array.isArray(event.blocks) && event.blocks.length > 0,
  });

  // message イベント以外、編集/削除はスキップ
  if (event.type !== 'message') return NextResponse.json({ ok: true });
  // 編集/削除/スレッド返信以外の bot 投稿と通常投稿は受け付ける
  // Notta は incoming webhook / bot の可能性があるので subtype=bot_message も許可
  if (event.subtype && event.subtype !== 'bot_message' && event.subtype !== 'file_share') {
    console.log('[slack-notta] skipped subtype', event.subtype);
    return NextResponse.json({ ok: true });
  }
  if (!event.channel || !event.ts) return NextResponse.json({ ok: true });

  const fullText = extractFullText(event);
  console.log('[slack-notta] extracted text preview', {
    len: fullText.length,
    preview: fullText.slice(0, 200),
  });
  if (!fullText.trim()) return NextResponse.json({ ok: true });

  // Notta 特有のキーワードが無ければ無視（他の bot 投稿に巻き込まれないため）
  if (!/タイトル[:：]/.test(fullText) && !/AI Notes/.test(fullText)) {
    console.log('[slack-notta] not a notta message, skipped', {
      channel: event.channel,
      preview: fullText.slice(0, 120),
    });
    return NextResponse.json({ ok: true, skipped: 'not a notta message' });
  }

  try {
    const admin = getSupabaseAdmin();

    // channel_id → school_id 解決
    const { data: school, error: schoolErr } = await admin
      .from('schools')
      .select('id')
      .eq('slack_channel_id', event.channel)
      .maybeSingle();

    if (schoolErr) throw schoolErr;
    if (!school) {
      console.warn('[slack-notta] no school mapped to channel', event.channel);
      return NextResponse.json(
        { ok: true, skipped: 'no school mapped', channel: event.channel },
        { status: 200 }
      );
    }

    const parsed = parseNottaSlackMessage(fullText);

    const { error: insertErr } = await admin.from('notta_transcripts').insert({
      school_id: school.id,
      external_id: `slack:${event.ts}`,
      title: parsed.title,
      recorded_at: parsed.recordedAt,
      duration_seconds: parsed.durationSeconds,
      transcript: parsed.summary,
      audio_url: parsed.audioUrl,
      speakers: null,
      raw_payload: payload as unknown as Record<string, unknown>,
    });

    if (insertErr) {
      if (insertErr.code === '23505') {
        // 重複は正常扱い（Slack が Retry する場合あり）
        return NextResponse.json({ ok: true, duplicate: true });
      }
      throw insertErr;
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e) {
    captureApiError(e, {
      route: 'POST /api/webhooks/slack/notta',
    });
    console.error('[slack-notta] insert failed:', e);
    // Slack 側の自動 Retry を避けるため 200 を返す
    return NextResponse.json({ ok: false, error: 'internal error' }, { status: 200 });
  }
}
