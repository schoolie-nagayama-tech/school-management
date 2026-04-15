import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { parseNottaSlackMessage } from '@/lib/utils/nottaSlackParser';

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
 * Slack の message イベントから、ブロック・アタッチメント・text を結合した
 * 完全なテキストを取り出す。Notta の投稿はフォーマット方法が分からないので
 * 全部を連結してパーサーに渡す。
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
  if (event.blocks && Array.isArray(event.blocks)) {
    for (const b of event.blocks as Array<Record<string, unknown>>) {
      const text = b.text as { text?: string } | undefined;
      if (text?.text) parts.push(text.text);
      const fields = b.fields as Array<{ text?: string }> | undefined;
      if (Array.isArray(fields)) {
        for (const f of fields) if (f.text) parts.push(f.text);
      }
    }
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
  } catch {
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
    return NextResponse.json({ ok: true });
  }

  const event = payload.event;

  // message イベント以外、編集/削除はスキップ
  if (event.type !== 'message') return NextResponse.json({ ok: true });
  if (event.subtype && event.subtype !== 'bot_message') {
    return NextResponse.json({ ok: true });
  }
  if (!event.channel || !event.ts) return NextResponse.json({ ok: true });

  const fullText = extractFullText(event);
  if (!fullText.trim()) return NextResponse.json({ ok: true });

  // Notta 特有のキーワードが無ければ無視（他の bot 投稿に巻き込まれないため）
  if (!/タイトル[:：]/.test(fullText) && !/AI Notes/.test(fullText)) {
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
    console.error('[slack-notta] insert failed:', e);
    // Slack 側の自動 Retry を避けるため 200 を返す
    return NextResponse.json({ ok: false, error: 'internal error' }, { status: 200 });
  }
}
