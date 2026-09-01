import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { captureApiError } from '@/lib/api-error';

export const dynamic = 'force-dynamic';

/**
 * service role クライアントを生成する。
 * portal/form-responses と同じパターン — anon ポリシーは一切使わず
 * RLS をバイパスして inquiries テーブルに書き込む。
 */
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

/** src パラメータを媒体名に変換する */
function resolveMedia(src: string | null | undefined): string {
  if (!src) return '自社フォーム';
  const normalized = src.trim();
  if (normalized === 'チラシ') return 'チラシ';
  if (normalized === '看板') return '看板・外パンフ';
  return '自社フォーム';
}

/**
 * 自社問合せフォーム 公開 POST エンドポイント（認証不要）。
 * service role キーで RLS をバイパスして inquiries に insert する。
 * anon ポリシーは追加しない（このリポジトリのセキュリティ方針）。
 *
 * ハニーポット検出時は 200 を返して静かに破棄する（スパム bot に成功を装う）。
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;

    // ---- ハニーポット: hidden フィールドに値が入っていたら静かに破棄 ----
    if (body._hp && String(body._hp).trim() !== '') {
      return NextResponse.json({ success: true });
    }

    // ---- 入力抽出 ----
    const schoolCode = typeof body.schoolCode === 'string' ? body.schoolCode.trim() : '';
    const guardianName = typeof body.guardianName === 'string' ? body.guardianName.trim() : '';
    const guardianKana = typeof body.guardianKana === 'string' ? body.guardianKana.trim() : '';
    const studentName = typeof body.studentName === 'string' ? body.studentName.trim() : '';
    const grade = typeof body.grade === 'string' ? body.grade.trim() : '';
    const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const requestType = typeof body.requestType === 'string' ? body.requestType.trim() : '';
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    const src = typeof body.src === 'string' ? body.src.trim() : '';

    // ---- バリデーション ----
    if (!schoolCode) {
      return NextResponse.json({ error: '教室コードが不正です' }, { status: 400 });
    }
    if (!guardianName) {
      return NextResponse.json({ error: '保護者氏名は必須です' }, { status: 400 });
    }
    if (guardianName.length > 100) {
      return NextResponse.json(
        { error: '保護者氏名は100文字以内で入力してください' },
        { status: 400 }
      );
    }
    if (!phone && !email) {
      return NextResponse.json(
        { error: '電話番号またはメールアドレスのどちらかは必須です' },
        { status: 400 }
      );
    }
    if (message.length > 2000) {
      return NextResponse.json(
        { error: 'ご質問ご要望は2000文字以内で入力してください' },
        { status: 400 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();

    // ---- schoolCode → school_id を解決（service role で確実に取得） ----
    const { data: school, error: schoolError } = await supabaseAdmin
      .from('schools')
      .select('id, name')
      .eq('code', schoolCode)
      .maybeSingle();

    if (schoolError) {
      throw schoolError;
    }
    if (!school) {
      return NextResponse.json({ error: '教室が見つかりません' }, { status: 404 });
    }

    // ---- media / channel を決定 ----
    const media = resolveMedia(src);

    // ---- inquiries に insert ----
    const { error: insertError } = await supabaseAdmin.from('inquiries').insert({
      school_id: school.id,
      inquired_at: new Date().toISOString(),
      status: 'in_progress',
      guardian_name: guardianName || null,
      guardian_name_kana: guardianKana || null,
      student_name: studentName || null,
      grade: grade || null,
      phone: phone || null,
      email: email || null,
      request_type: requestType || null,
      initial_message: message || null,
      media,
      channel: '自社フォーム',
      raw_source: {
        _self_form: 'true',
        src: src || null,
        guardian_name: guardianName,
        guardian_name_kana: guardianKana,
        student_name: studentName,
        grade: grade,
        phone: phone,
        email: email,
        request_type: requestType,
        message: message,
      },
    });

    if (insertError) {
      throw insertError;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    captureApiError(error, {
      route: 'POST /api/inquiry-form',
    });
    console.error('[inquiry-form] POST failed:', error);
    return NextResponse.json(
      { error: '送信に失敗しました。お手数ですがもう一度お試しください。' },
      { status: 500 }
    );
  }
}
