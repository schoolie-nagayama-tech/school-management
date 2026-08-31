import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { portalDuplicateCheckSchema } from '@/lib/validations/schemas';
import { normalizeFormEmail, normalizeFormName } from '@/lib/utils/formDedup';

export const dynamic = 'force-dynamic';

/**
 * 保護者ポータル用の重複申込チェック（認証不要）
 *
 * 同じ期間に同じ氏名・メールアドレスの申込が既にあるかだけを返す。
 * 「送れたか不安でもう一度送る」事故を送信前に止めるための確認ダイアログ用。
 * 返すのは有無と申込日時だけで、回答内容や他の申込者の情報は一切返さない。
 * 氏名・メールを含むためGETではなくPOSTで受ける（URLに個人情報を載せない）。
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const parsed = portalDuplicateCheckSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: '入力内容に不備があります' }, { status: 400 });
    }

    const { school_id, form_type, form_period, student_name, email } = parsed.data;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Supabase env not set');
    }
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 氏名・メールの絞り込みはDB側でやらない（ilike はメール中の _ をワイルドカードと解釈して
    // 誤検知し、eq は大文字小文字差や氏名の空白差を取りこぼすため）。取得は3列だけで軽い。
    // アーカイブ済みは教室側で無効にした申込なので除外する。
    const { data, error } = await supabaseAdmin
      .from('form_responses')
      .select('student_name, email, created_at')
      .eq('school_id', school_id)
      .eq('form_type', form_type)
      .eq('form_period', form_period)
      .eq('is_archived', false)
      .order('created_at', { ascending: false })
      .limit(1000);

    if (error) throw error;

    // 氏名の空白差・メールの大文字小文字差を吸収して突き合わせる
    // （氏名も見るので、兄弟で同じメールを使っていても誤検知しない）
    const name = normalizeFormName(student_name);
    const mail = normalizeFormEmail(email);
    const matched = (data || []).find(
      (r: { student_name: string; email: string | null }) =>
        normalizeFormName(r.student_name || '') === name && normalizeFormEmail(r.email) === mail
    );

    return NextResponse.json({
      exists: Boolean(matched),
      submitted_at: matched?.created_at ?? null,
    });
  } catch (error) {
    console.error('[portal/form-responses/check] failed:', error);
    // 判定できないときは重複なし扱い。確認ダイアログのためだけに申込を止めない
    return NextResponse.json({ exists: false, submitted_at: null });
  }
}
