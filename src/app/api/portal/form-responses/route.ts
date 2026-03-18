import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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

/**
 * 保護者ポータル用フォーム回答送信エンドポイント（認証不要）
 * サービスロールキーで RLS をバイパスして form_responses に挿入する
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const {
      school_id,
      form_type,
      form_period,
      student_name,
      grade,
      email,
      response_data,
      status_checks,
    } = body as {
      school_id?: string;
      form_type?: string;
      form_period?: string;
      student_name?: string;
      grade?: number;
      email?: string;
      response_data?: unknown;
      status_checks?: unknown;
    };

    if (!school_id || !form_type || !form_period || !student_name || !email) {
      return NextResponse.json(
        { error: 'school_id, form_type, form_period, student_name, email は必須です' },
        { status: 400 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();

    // フォーム公開期間が有効かチェック
    const { data: period, error: periodError } = await supabaseAdmin
      .from('form_periods')
      .select('id, is_active, is_archived, publish_start, publish_end')
      .eq('school_id', school_id)
      .eq('form_type', form_type)
      .eq('period_key', form_period)
      .maybeSingle();

    if (periodError) {
      throw periodError;
    }

    if (!period || !period.is_active || period.is_archived) {
      return NextResponse.json({ error: '現在受付していません' }, { status: 400 });
    }

    const now = new Date();
    if (period.publish_start && new Date(period.publish_start) > now) {
      return NextResponse.json({ error: '現在受付していません' }, { status: 400 });
    }
    if (period.publish_end && new Date(period.publish_end) < now) {
      return NextResponse.json({ error: '受付期間が終了しました' }, { status: 400 });
    }

    const { data: created, error } = await supabaseAdmin
      .from('form_responses')
      .insert({
        school_id,
        form_type,
        form_period,
        student_name,
        grade,
        email,
        response_data,
        status_checks,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'この内容は既に送信されています。' },
          { status: 409 }
        );
      }
      throw error;
    }

    // 生徒の自動マッチング＆申込状況の自動更新（失敗しても回答は成功扱い）
    try {
      await autoLinkAndUpdateApplication(supabaseAdmin, created, school_id, form_type, form_period);
    } catch (e) {
      console.warn('[portal/form-responses] 自動紐付けに失敗しました（無視します）:', e);
    }

    // 申込通知メール送信（失敗しても回答は成功扱い）
    try {
      // 自動紐付け後の最新データを取得してメール送信
      const { data: latestResponse } = await supabaseAdmin
        .from('form_responses')
        .select('*')
        .eq('id', created.id)
        .single();

      const { error: invokeError } = await supabaseAdmin.functions.invoke(
        'send-form-notification',
        { body: { record: latestResponse || created } }
      );
      if (invokeError) {
        console.warn('[portal/form-responses] 申込通知メールの送信に失敗しました:', invokeError);
      }
    } catch (e) {
      console.warn('[portal/form-responses] 申込通知メールの送信に失敗しました:', e);
    }

    return NextResponse.json({ data: created });
  } catch (error) {
    console.error('[portal/form-responses] create failed:', error);
    return NextResponse.json(
      { error: 'フォーム回答の作成に失敗しました' },
      { status: 500 }
    );
  }
}

/**
 * 名前を正規化する（スペースの有無・全角半角スペースを統一して比較用に変換）
 */
function normalizeName(name: string): string {
  // 全角スペース→半角スペース、連続スペースを除去、前後トリム、全て小文字化
  return name
    .replace(/\u3000/g, ' ')  // 全角スペース→半角
    .replace(/\s+/g, '')      // 全てのスペースを除去
    .trim()
    .toLowerCase();
}

/**
 * 回答の生徒名から自動的に生徒をマッチングし、紐付け＋申込状況を更新する
 * - スペースの有無を正規化して比較
 * - 同じ教室・同じ学年で1人だけ一致した場合のみ自動紐付け
 * - 期間に申込項目が紐付けられていれば申込状況も自動で「completed」にする
 */
async function autoLinkAndUpdateApplication(
  supabaseAdmin: any,
  response: { id: string; student_name: string; grade?: number; school_id?: string; form_type?: string; form_period?: string },
  schoolId: string,
  formType: string,
  formPeriod: string
) {
  if (!response.student_name || !response.grade) return;

  // 同じ教室・同じ学年の生徒を取得
  const { data: students, error: studentsError } = await supabaseAdmin
    .from('students')
    .select('id, last_name, first_name, grade')
    .eq('school_id', schoolId)
    .eq('grade', response.grade)
    .is('deleted_at', null);

  if (studentsError || !students || students.length === 0) return;

  // 回答の名前を正規化
  const normalizedResponseName = normalizeName(response.student_name);

  // 名前マッチング（スペース有無を正規化して比較）
  const matched = students.filter((s: any) => {
    const fullName = normalizeName(`${s.last_name}${s.first_name}`);
    return fullName === normalizedResponseName;
  });

  // 1人だけ一致した場合のみ自動紐付け（複数一致は曖昧なのでスキップ）
  if (matched.length !== 1) return;

  const matchedStudent = matched[0];

  // 回答に生徒を紐付け
  const { error: linkError } = await supabaseAdmin
    .from('form_responses')
    .update({
      linked_student_id: matchedStudent.id,
      linked_at: new Date().toISOString(),
    })
    .eq('id', response.id);

  if (linkError) {
    console.warn('[auto-link] 紐付け更新に失敗:', linkError);
    return;
  }

  console.log(`[auto-link] 自動紐付け成功: ${response.student_name} → ${matchedStudent.id}`);

  // 期間に申込項目が紐付けられているか確認
  const { data: period } = await supabaseAdmin
    .from('form_periods')
    .select('linked_application_item_id')
    .eq('school_id', schoolId)
    .eq('form_type', formType)
    .eq('period_key', formPeriod)
    .maybeSingle();

  if (!period?.linked_application_item_id) return;

  // 申込状況を自動更新（completed）
  // 既存レコードがあれば更新、なければ作成
  const { data: existing } = await supabaseAdmin
    .from('student_applications')
    .select('id')
    .eq('student_id', matchedStudent.id)
    .eq('item_id', period.linked_application_item_id)
    .eq('school_id', schoolId)
    .maybeSingle();

  if (existing) {
    await supabaseAdmin
      .from('student_applications')
      .update({ status: 'completed' })
      .eq('id', existing.id);
  } else {
    await supabaseAdmin
      .from('student_applications')
      .insert({
        school_id: schoolId,
        student_id: matchedStudent.id,
        item_id: period.linked_application_item_id,
        status: 'completed',
      });
  }

  console.log(`[auto-link] 申込状況を自動更新: student=${matchedStudent.id}, item=${period.linked_application_item_id}`);
}
