import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { portalFormResponseSchema } from '@/lib/validations/schemas';
import { createFurikaeCalendarEvents } from '@/lib/google-calendar';
import { FORM_TYPE_LABELS } from '@/types/database';
import { zoukomaKomaCount } from '@/lib/utils/zoukomaKoma';
import {
  DUPLICATE_WINDOW_MINUTES,
  normalizeFormEmail,
  normalizeFormName,
  stableStringify,
} from '@/lib/utils/formDedup';
import { captureApiError } from '@/lib/api-error';

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

    // Zodスキーマでバリデーション
    const parsed = portalFormResponseSchema.safeParse(body);
    if (!parsed.success) {
      const messages = parsed.error.issues.map((i) => i.message).join(', ');
      return NextResponse.json({ error: `入力内容に不備があります: ${messages}` }, { status: 400 });
    }

    const { school_id, form_type, form_period, student_name, grade, email, response_data } =
      parsed.data;
    const status_checks = (body as Record<string, unknown>).status_checks;

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

    // 二重送信ガード（冪等化）
    // 送信できたか不安になった保護者が数分後に同じ内容をもう一度送るケースがあるため、
    // 直近の「氏名・メール・回答内容が完全に同じ」申込は新規作成せず既存レコードを返す。
    // 保護者には通常どおり完了画面が出るので、失敗と勘違いした三度目の送信も起きない。
    // 内容が違う再送信は「内容の変更・追加申込」なので通す（ハード制約にしない理由）。
    const recentDuplicate = await findRecentDuplicate(supabaseAdmin, {
      school_id,
      form_type,
      form_period,
      student_name,
      email: email ?? '',
      response_data,
    });
    if (recentDuplicate) {
      console.log(
        `[portal/form-responses] 重複送信を無視しました: ${form_type}/${form_period} ${student_name} → ${recentDuplicate.id}`
      );
      return NextResponse.json({ data: recentDuplicate, duplicate: true });
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
        return NextResponse.json({ error: 'この内容は既に送信されています。' }, { status: 409 });
      }
      throw error;
    }

    // 生徒の自動マッチング＆申込状況の自動更新（失敗しても回答は成功扱い）
    try {
      await autoLinkAndUpdateApplication(supabaseAdmin, created, school_id, form_type, form_period);
    } catch (e) {
      captureApiError(e, {
        route: 'POST /api/portal/form-responses',
      });
      console.warn('[portal/form-responses] 自動紐付けに失敗しました（無視します）:', e);
    }

    // フォーム回答を請求データに自動反映（失敗しても回答は成功扱い）
    try {
      await autoSyncFormToBilling(supabaseAdmin, created.id, school_id, form_type);
    } catch (e) {
      captureApiError(e, {
        route: 'POST /api/portal/form-responses',
      });
      console.warn('[portal/form-responses] 請求への自動反映に失敗しました（無視します）:', e);
    }

    // 模試の振替受験 → Google Calendarにイベント作成（失敗しても回答は成功扱い）
    if (form_type === 'moshi') {
      try {
        const rd = response_data as Record<string, unknown>;
        if (rd.exam_type === 'furikae' && rd.furikae_date && rd.furikae_time) {
          // 学年番号→表示名変換
          const gradeNames: Record<number, string> = {
            4: '小4',
            5: '小5',
            6: '小6',
            7: '中1',
            8: '中2',
            9: '中3',
          };
          // 期間タイトルを取得
          const { data: periodData } = await supabaseAdmin
            .from('form_periods')
            .select('title')
            .eq('school_id', school_id)
            .eq('form_type', 'moshi')
            .eq('period_key', form_period)
            .maybeSingle();

          await createFurikaeCalendarEvents({
            schoolId: school_id,
            studentName: student_name,
            grade: gradeNames[grade] || `${grade}`,
            furikaeDate: rd.furikae_date as string,
            furikaeDateLabel: (rd.furikae_date_label as string) || '',
            furikaeTime: rd.furikae_time as string,
            periodTitle: periodData?.title || undefined,
          });
        }
      } catch (e) {
        captureApiError(e, {
          route: 'POST /api/portal/form-responses',
        });
        console.warn(
          '[portal/form-responses] カレンダーイベント作成に失敗しました（無視します）:',
          e
        );
      }
    }

    // 申込通知メール送信（失敗しても回答は成功扱い）
    try {
      // 自動紐付け後の最新データを取得してメール送信
      const { data: latestResponse, error: refetchError } = await supabaseAdmin
        .from('form_responses')
        .select('*')
        .eq('id', created.id)
        .single();

      if (refetchError) {
        console.warn(
          '[portal/form-responses] 最新データの再取得に失敗（元データで通知します）:',
          refetchError
        );
      }

      const { error: invokeError } = await supabaseAdmin.functions.invoke(
        'send-form-notification',
        { body: { record: latestResponse || created } }
      );
      if (invokeError) {
        console.warn('[portal/form-responses] 申込通知メールの送信に失敗しました:', invokeError);
      }
    } catch (e) {
      captureApiError(e, {
        route: 'POST /api/portal/form-responses',
      });
      console.warn('[portal/form-responses] 申込通知メールの送信に失敗しました:', e);
    }

    // プッシュ通知（新回答受信）— 失敗しても回答は成功扱い
    try {
      const formLabel = FORM_TYPE_LABELS[form_type as keyof typeof FORM_TYPE_LABELS] ?? form_type;
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
      await fetch(`${appUrl}/api/push/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-key': process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
        },
        body: JSON.stringify({
          schoolId: school_id,
          title: `新しい回答：${formLabel}`,
          bodyText: `${student_name} さんから${formLabel}の申込が届きました`,
          url: '/responses',
        }),
      });
    } catch (e) {
      captureApiError(e, {
        route: 'POST /api/portal/form-responses',
      });
      console.warn('[portal/form-responses] プッシュ通知に失敗しました（無視します）:', e);
    }

    return NextResponse.json({ data: created });
  } catch (error) {
    captureApiError(error, {
      route: 'POST /api/portal/form-responses',
    });
    console.error('[portal/form-responses] create failed:', error);
    return NextResponse.json({ error: 'フォーム回答の作成に失敗しました' }, { status: 500 });
  }
}

/**
 * 名前を正規化する（スペースの有無・全角半角スペースを統一して比較用に変換）
 */
function normalizeName(name: string): string {
  return normalizeFormName(name);
}

/**
 * 直近 DUPLICATE_WINDOW_MINUTES 以内の「同一人物・同一内容」の申込を探す。
 *
 * 期間内の候補行をまとめて取ってからアプリ側で突き合わせる。氏名の空白差やメールの
 * 大文字小文字差を吸収したいので、DB側の等値比較には寄せていない。
 * 判定できなかった場合は null を返して送信を通す（重複防止のために申込自体を落とさない）。
 */
async function findRecentDuplicate(
  supabaseAdmin: SupabaseClient,
  params: {
    school_id: string;
    form_type: string;
    form_period: string;
    student_name: string;
    email: string;
    response_data: unknown;
  }
) {
  const since = new Date(Date.now() - DUPLICATE_WINDOW_MINUTES * 60 * 1000).toISOString();

  // メールの絞り込みはDB側でやらない（ilike はメール中の _ をワイルドカードと解釈して
  // 誤検知し、eq は大文字小文字差を取りこぼすため）。時間幅が10分なので候補は少ない。
  const { data, error } = await supabaseAdmin
    .from('form_responses')
    .select('*')
    .eq('school_id', params.school_id)
    .eq('form_type', params.form_type)
    .eq('form_period', params.form_period)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.warn('[portal/form-responses] 重複チェックに失敗しました（送信は継続）:', error);
    return null;
  }

  const name = normalizeFormName(params.student_name);
  const email = normalizeFormEmail(params.email);
  const payload = stableStringify(params.response_data);

  return (
    (data || []).find(
      (r: { student_name: string; email: string | null; response_data: unknown }) =>
        normalizeFormName(r.student_name || '') === name &&
        normalizeFormEmail(r.email) === email &&
        stableStringify(r.response_data) === payload
    ) || null
  );
}

/**
 * 回答の生徒名から自動的に生徒をマッチングし、紐付け＋申込状況を更新する
 * - スペースの有無を正規化して比較
 * - 同じ教室・同じ学年で1人だけ一致した場合のみ自動紐付け
 * - 期間に申込項目が紐付けられていれば申込状況も自動で「completed」にする
 */
async function autoLinkAndUpdateApplication(
  supabaseAdmin: SupabaseClient,
  response: {
    id: string;
    student_name: string;
    grade?: number;
    school_id?: string;
    form_type?: string;
    form_period?: string;
  },
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
  const matched = students.filter((s: { last_name: string; first_name: string; id: string }) => {
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
    await supabaseAdmin.from('student_applications').insert({
      school_id: schoolId,
      student_id: matchedStudent.id,
      item_id: period.linked_application_item_id,
      status: 'completed',
    });
  }

  console.log(
    `[auto-link] 申込状況を自動更新: student=${matchedStudent.id}, item=${period.linked_application_item_id}`
  );
}

/**
 * フォーム回答を請求データに自動反映する
 *
 * 1. 紐付け済みの生徒IDを取得
 * 2. アクティブな請求期間で linked_form_type が一致する請求項目を検索
 * 3. 該当生徒のフォーム回答数をカウントして student_billings に upsert
 */
async function autoSyncFormToBilling(
  supabaseAdmin: SupabaseClient,
  responseId: string,
  schoolId: string,
  formType: string
) {
  // 1. 紐付け後の回答データを取得（linked_student_id が設定されているか確認）
  const { data: response } = await supabaseAdmin
    .from('form_responses')
    .select('linked_student_id')
    .eq('id', responseId)
    .single();

  if (!response?.linked_student_id) return; // 紐付けされていなければスキップ

  const studentId = response.linked_student_id;

  // 2. アクティブな請求期間を取得
  const { data: activePeriods } = await supabaseAdmin
    .from('billing_periods')
    .select('id, start_date, end_date')
    .eq('school_id', schoolId)
    .eq('is_active', true);

  if (!activePeriods || activePeriods.length === 0) return;

  // 3. 全期間の紐付け項目を1クエリで取得
  const periodIds = activePeriods.map((p) => p.id);
  const { data: linkedItems } = await supabaseAdmin
    .from('billing_items')
    .select('id, billing_period_id')
    .in('billing_period_id', periodIds)
    .eq('school_id', schoolId)
    .eq('linked_form_type', formType);

  if (!linkedItems || linkedItems.length === 0) return;

  // 増コマは「申込コマ数」を請求数として扱う（回答件数ではない）。
  const isZoukoma = formType === 'zoukoma';

  // 4. 請求数は「期間ごとに同一」なので期間単位で1回だけ並列集計。
  //    通常フォームは回答件数、増コマは申込コマ数の合計を採用する。
  const countByPeriod = new Map<string, number>();
  await Promise.all(
    activePeriods.map(async (period) => {
      const d = new Date(period.end_date);
      d.setDate(d.getDate() + 1);
      const periodEndPlusOne = d.toISOString().split('T')[0];

      if (isZoukoma) {
        const { data: rows, error: rowsError } = await supabaseAdmin
          .from('form_responses')
          .select('response_data')
          .eq('form_type', formType)
          .eq('linked_student_id', studentId)
          .eq('school_id', schoolId)
          .gte('created_at', `${period.start_date}T00:00:00`)
          .lt('created_at', `${periodEndPlusOne}T00:00:00`);

        if (rowsError) {
          console.warn(`[auto-billing] 増コマ集計に失敗: ${rowsError.message}`);
          return;
        }
        const totalKoma = (rows || []).reduce(
          (sum: number, r: { response_data?: unknown }) => sum + zoukomaKomaCount(r.response_data),
          0
        );
        countByPeriod.set(period.id, totalKoma);
      } else {
        const { count, error: countError } = await supabaseAdmin
          .from('form_responses')
          .select('id', { count: 'exact', head: true })
          .eq('form_type', formType)
          .eq('linked_student_id', studentId)
          .eq('school_id', schoolId)
          .gte('created_at', `${period.start_date}T00:00:00`)
          .lt('created_at', `${periodEndPlusOne}T00:00:00`);

        if (countError) {
          console.warn(`[auto-billing] 回答数カウントに失敗: ${countError.message}`);
          return;
        }
        countByPeriod.set(period.id, count || 0);
      }
    })
  );

  // 5. 回答数が1件以上ある項目だけを対象に、既存 is_billed を保持してバルク upsert
  const targetItems = linkedItems.filter(
    (it) => (countByPeriod.get(it.billing_period_id) || 0) > 0
  );
  if (targetItems.length === 0) return;

  const itemIds = targetItems.map((it) => it.id);
  const { data: existingBillings } = await supabaseAdmin
    .from('student_billings')
    .select('billing_item_id, is_billed')
    .eq('student_id', studentId)
    .in('billing_item_id', itemIds);
  const billedMap = new Map<string, boolean>(
    (existingBillings || []).map((r: { billing_item_id: string; is_billed: boolean }) => [
      r.billing_item_id,
      r.is_billed,
    ])
  );

  const payload = targetItems.map((item) => ({
    school_id: schoolId,
    student_id: studentId,
    billing_item_id: item.id,
    is_billed: billedMap.get(item.id) ?? false,
    value_number: countByPeriod.get(item.billing_period_id) || 0,
  }));

  const { error: upsertError } = await supabaseAdmin
    .from('student_billings')
    .upsert(payload, { onConflict: 'student_id,billing_item_id' });
  if (upsertError) {
    console.warn(`[auto-billing] 請求自動反映に失敗: ${upsertError.message}`);
    return;
  }

  console.log(
    `[auto-billing] 請求自動反映: student=${studentId}, form_type=${formType}, items=${payload.length}`
  );
}
