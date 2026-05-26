/**
 * 生徒の通塾可能表 公開送信エンドポイント
 *
 * 保護者ポータル経由（未ログイン）で生徒の通塾可能日時を提出する用途。
 * service role key を使い RLS を回避して INSERT を実行する。
 *
 * バリデーション：
 *  - 必須項目チェック
 *  - 生徒が指定教室に在籍していること
 *  - 設定 (setting) が published 状態であること
 *  - 期間内の日付であること
 *
 * 1回目は新規 INSERT。再送信は edit_token がない限りエラー（修正は室長許可が必要）。
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// service role クライアントはリクエスト時に作る。モジュールロード時に作ると、
// Next.js のビルド時ページデータ収集フェーズで env が無い CI 環境などで
// `supabaseUrl is required` でビルドが落ちる。
function getAdminDb(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Supabase env vars are not configured');
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

interface SubmitBody {
  setting_id: string;
  student_id: string;
  submitter_email: string;
  submitter_name?: string;
  notes?: string;
  selected_slots: Array<{ shift_date: string; time_slot: string }>;
  edit_token?: string; // 指定時は既存提出の上書き（要 allow_edit=true）
}

export async function POST(req: NextRequest) {
  let body: SubmitBody;
  try {
    body = (await req.json()) as SubmitBody;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  // 基本バリデーション
  if (!body.setting_id || !body.student_id || !body.submitter_email) {
    return NextResponse.json({ error: 'missing_required_fields' }, { status: 400 });
  }
  if (!Array.isArray(body.selected_slots) || body.selected_slots.length === 0) {
    return NextResponse.json({ error: 'no_slots_selected' }, { status: 400 });
  }

  const adminDb = getAdminDb();

  // setting を確認（published のみ受け付け）
  const { data: setting, error: settingErr } = await adminDb
    .from('seasonal_shift_settings')
    .select('id, school_id, status, start_date, end_date')
    .eq('id', body.setting_id)
    .maybeSingle();

  if (settingErr || !setting) {
    return NextResponse.json({ error: 'setting_not_found' }, { status: 404 });
  }
  if (setting.status !== 'published') {
    return NextResponse.json({ error: 'setting_not_published' }, { status: 403 });
  }

  // 生徒が指定教室に在籍しているか確認
  const { data: student, error: stuErr } = await adminDb
    .from('students')
    .select('id, school_id, status')
    .eq('id', body.student_id)
    .maybeSingle();
  if (stuErr || !student || student.school_id !== setting.school_id) {
    return NextResponse.json({ error: 'student_not_in_school' }, { status: 403 });
  }
  if (student.status === 'withdrawn') {
    return NextResponse.json({ error: 'student_withdrawn' }, { status: 403 });
  }

  // 期間内の日付か（最低限のサニティチェック）
  for (const s of body.selected_slots) {
    if (s.shift_date < setting.start_date || s.shift_date > setting.end_date) {
      return NextResponse.json(
        { error: 'date_out_of_range', invalid_date: s.shift_date },
        { status: 400 }
      );
    }
  }

  // 既存提出を確認（edit_token があれば修正、無ければ新規）
  let submissionId: string;
  if (body.edit_token) {
    const { data: existing, error: exErr } = await adminDb
      .from('seasonal_shift_student_submissions')
      .select('id, allow_edit')
      .eq('edit_token', body.edit_token)
      .eq('setting_id', body.setting_id)
      .maybeSingle();
    if (exErr || !existing) {
      return NextResponse.json({ error: 'invalid_edit_token' }, { status: 403 });
    }
    if (!existing.allow_edit) {
      return NextResponse.json({ error: 'edit_not_allowed' }, { status: 403 });
    }
    // 上書き：本体を更新 → スロット全置換
    const { error: updErr } = await adminDb
      .from('seasonal_shift_student_submissions')
      .update({
        submitter_email: body.submitter_email,
        submitter_name: body.submitter_name || null,
        notes: body.notes || null,
        submitted_at: new Date().toISOString(),
        // 再提出後は再ロック
        allow_edit: false,
        edit_token: null,
      })
      .eq('id', existing.id);
    if (updErr) {
      console.error('update error', updErr);
      return NextResponse.json({ error: 'update_failed' }, { status: 500 });
    }
    submissionId = existing.id;
  } else {
    // 既存があるか確認（修正トークンなしで重複送信防止）
    const { data: dup } = await adminDb
      .from('seasonal_shift_student_submissions')
      .select('id')
      .eq('setting_id', body.setting_id)
      .eq('student_id', body.student_id)
      .maybeSingle();
    if (dup) {
      return NextResponse.json({ error: 'already_submitted' }, { status: 409 });
    }
    const { data: created, error: createErr } = await adminDb
      .from('seasonal_shift_student_submissions')
      .insert({
        setting_id: body.setting_id,
        school_id: setting.school_id,
        student_id: body.student_id,
        submitter_email: body.submitter_email,
        submitter_name: body.submitter_name || null,
        notes: body.notes || null,
      })
      .select('id')
      .single();
    if (createErr || !created) {
      console.error('create error', createErr);
      return NextResponse.json({ error: 'create_failed' }, { status: 500 });
    }
    submissionId = (created as { id: string }).id;
  }

  // スロットを全置換
  await adminDb
    .from('seasonal_shift_student_submission_slots')
    .delete()
    .eq('submission_id', submissionId);

  const rows = body.selected_slots.map((s) => ({
    submission_id: submissionId,
    shift_date: s.shift_date,
    time_slot: s.time_slot,
    available: true,
  }));
  const { error: slotErr } = await adminDb
    .from('seasonal_shift_student_submission_slots')
    .insert(rows);
  if (slotErr) {
    console.error('slot insert error', slotErr);
    return NextResponse.json({ error: 'slot_insert_failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, submission_id: submissionId });
}

// 設定情報取得：未ログインでフォーム描画用に必要
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const settingId = searchParams.get('setting_id');
  const studentCode = searchParams.get('student_code');
  const studentEmail = searchParams.get('student_email');

  if (!settingId) {
    return NextResponse.json({ error: 'missing_setting_id' }, { status: 400 });
  }

  const adminDb = getAdminDb();

  // 設定 + 開講日時マトリクスを取得
  const { data: setting, error: settingErr } = await adminDb
    .from('seasonal_shift_settings')
    .select('id, school_id, name, start_date, end_date, deadline, status, description, weekday_slots, saturday_slots')
    .eq('id', settingId)
    .maybeSingle();

  if (settingErr || !setting) {
    return NextResponse.json({ error: 'setting_not_found' }, { status: 404 });
  }
  if (setting.status !== 'published') {
    return NextResponse.json({ error: 'setting_not_published' }, { status: 403 });
  }

  const { data: slotSettings } = await adminDb
    .from('seasonal_shift_slot_settings')
    .select('slot_date, time_slot, is_open')
    .eq('setting_id', settingId)
    .eq('is_open', true)
    .order('slot_date', { ascending: true });

  // 生徒検索（student_code 指定時のみ：完全一致の安全な検索）
  type StudentLite = { id: string; last_name: string; first_name: string; grade: number };
  let student: StudentLite | null = null;
  if (studentCode) {
    const { data: stu } = await adminDb
      .from('students')
      .select('id, last_name, first_name, grade, school_id, status')
      .eq('school_id', setting.school_id)
      .eq('student_code', studentCode)
      .neq('status', 'withdrawn')
      .maybeSingle();
    if (stu) {
      const s = stu as unknown as StudentLite;
      student = { id: s.id, last_name: s.last_name, first_name: s.first_name, grade: s.grade };
    }
  }

  // 既存提出（編集用に確認）
  type ExistingSub = { id: string; allow_edit: boolean };
  let existingSubmission: ExistingSub | null = null;
  if (student) {
    const { data: ex } = await adminDb
      .from('seasonal_shift_student_submissions')
      .select('id, allow_edit')
      .eq('setting_id', settingId)
      .eq('student_id', student.id)
      .maybeSingle();
    if (ex) existingSubmission = ex as unknown as ExistingSub;
  }

  return NextResponse.json({
    setting,
    open_slots: slotSettings ?? [],
    student,
    existing_submission: existingSubmission,
    // submitter_email は ヒント用に echo（実認証ではない）
    hint_email: studentEmail,
  });
}
