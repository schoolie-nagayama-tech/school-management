import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { nottaWebhookSchema } from '@/lib/validations/schemas';

export const dynamic = 'force-dynamic';

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase env not set');
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function verifyToken(request: NextRequest): boolean {
  const expected = process.env.NOTTA_WEBHOOK_SECRET;
  if (!expected) {
    console.error('[notta-webhook] NOTTA_WEBHOOK_SECRET is not set');
    return false;
  }
  const header = request.headers.get('authorization') || '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  return token === expected;
}

/**
 * Notta → Zapier → 本アプリ
 * Zapier の "Webhooks by Zapier (POST)" から叩かれるエンドポイント。
 * Authorization: Bearer <NOTTA_WEBHOOK_SECRET> で認証。
 */
export async function POST(request: NextRequest) {
  if (!verifyToken(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = nottaWebhookSchema.safeParse(body);
  if (!parsed.success) {
    const messages = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
    return NextResponse.json({ error: `Validation error: ${messages}` }, { status: 400 });
  }

  const {
    school_id,
    external_id,
    title,
    recorded_at,
    duration_seconds,
    transcript,
    audio_url,
    speakers,
  } = parsed.data;

  try {
    const supabaseAdmin = getSupabaseAdmin();

    const { data, error } = await supabaseAdmin
      .from('notta_transcripts')
      .insert({
        school_id,
        external_id: external_id || null,
        title: title || null,
        recorded_at: recorded_at || null,
        duration_seconds: duration_seconds ?? null,
        transcript,
        audio_url: audio_url || null,
        speakers: speakers ?? null,
        raw_payload: body as Record<string, unknown>,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'この録音は既に取り込み済みです', external_id },
          { status: 409 }
        );
      }
      if (error.code === '23503') {
        return NextResponse.json(
          { error: 'school_id が存在しません' },
          { status: 400 }
        );
      }
      throw error;
    }

    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    console.error('[notta-webhook] insert failed:', error);
    return NextResponse.json(
      { error: '文字起こしの取り込みに失敗しました' },
      { status: 500 }
    );
  }
}
