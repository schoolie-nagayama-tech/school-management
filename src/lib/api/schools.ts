import { supabase } from '@/lib/supabase';
import type { School } from '@/types/database';

// デフォルト教室IDを取得（環境変数から）
export function getDefaultSchoolId(): string {
  const schoolId = process.env.NEXT_PUBLIC_DEFAULT_SCHOOL_ID;
  if (!schoolId) {
    const errorMessage = [
      'NEXT_PUBLIC_DEFAULT_SCHOOL_ID が設定されていません。',
      '',
      '設定手順:',
      '1. SupabaseのSQL Editorで supabase/schema.sql を実行してください',
      '2. 以下のSQLでデフォルト教室のIDを取得してください:',
      "   SELECT id FROM schools WHERE code = 'DEFAULT';",
      '3. .env.local に以下を追加してください:',
      '   NEXT_PUBLIC_DEFAULT_SCHOOL_ID=取得したUUID',
      '4. 開発サーバーを再起動してください',
    ].join('\n');
    throw new Error(errorMessage);
  }
  return schoolId;
}

// 教室を1件取得
export async function getSchool(id: string): Promise<School | null> {
  const { data, error } = await supabase.from('schools').select('*').eq('id', id).maybeSingle();

  if (error) {
    console.error('Error fetching school:', error);
    throw new Error('教室情報の取得に失敗しました');
  }

  return data as School | null;
}

// 教室コードで教室を取得
export async function getSchoolByCode(code: string): Promise<School | null> {
  const { data, error } = await supabase.from('schools').select('*').eq('code', code).maybeSingle();

  if (error) {
    console.error('Error fetching school by code:', error);
    throw new Error('教室情報の取得に失敗しました');
  }

  return data as School | null;
}

/** 同時並列の getSchools を1本のリクエストにまとめる（Auth / Master / ヘッダー等） */
let getSchoolsInflight: Promise<School[]> | null = null;

async function fetchSchoolsFromSupabase(): Promise<School[]> {
  const { data, error } = await supabase
    .from('schools')
    .select('*')
    .order('name', { ascending: true });

  if (error) {
    console.error('Error fetching schools:', error);
    throw new Error('教室一覧の取得に失敗しました');
  }

  return (data || []) as School[];
}

// 教室一覧を取得
export async function getSchools(): Promise<School[]> {
  if (!getSchoolsInflight) {
    getSchoolsInflight = fetchSchoolsFromSupabase().finally(() => {
      getSchoolsInflight = null;
    });
  }
  return getSchoolsInflight;
}

// 教室を作成
export async function createSchool(data: {
  name: string;
  code?: string | null;
  notification_email?: string | null;
  is_demo?: boolean;
}): Promise<School> {
  const { data: school, error } = await supabase
    .from('schools')
    .insert({
      name: data.name,
      code: data.code || null,
      notification_email: data.notification_email || null,
      is_demo: data.is_demo ?? false,
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating school:', error);
    if (error.code === '23505') {
      throw new Error('この教室コードは既に使用されています');
    }
    throw new Error('教室の作成に失敗しました');
  }

  return school as School;
}

// 教室を更新
export async function updateSchool(
  id: string,
  data: {
    name?: string;
    code?: string | null;
    notification_email?: string | null;
    notification_emails?: string[];
    logo_url?: string | null;
    is_demo?: boolean;
    slack_mention_id?: string | null;
    /** 面談予約URL（Googleカレンダー）。空文字ではなく null で「未設定」を表す。 */
    meeting_booking_url?: string | null;
  }
): Promise<School> {
  const { data: school, error } = await supabase
    .from('schools')
    .update({
      ...data,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('Error updating school:', error);
    if (error.code === '23505') {
      throw new Error('この教室コードは既に使用されています');
    }
    throw new Error('教室の更新に失敗しました');
  }

  return school as School;
}

/** 教室を参照している件数を取得（削除前に「何がブロックしているか」を表示するため）
 * 論理削除・アーカイブ済みは除外し、有効なデータのみカウントする。
 * 教室削除時に自動作除するもの（user_schools, portal_menu, exam_types, bulletin_*）はブロック対象に含めない。 */
export async function getSchoolBlockingReferences(
  schoolId: string
): Promise<{ label: string; count: number }[]> {
  type QueryFilter = (q: ReturnType<typeof supabase.from>) => ReturnType<typeof supabase.from>;
  const tables: { table: string; label: string; filter?: QueryFilter }[] = [
    { table: 'students', label: '生徒', filter: (q) => q.is('deleted_at', null) },
    { table: 'student_logs', label: '生徒ログ' },
    { table: 'assessments', label: 'テスト・成績' },
    {
      table: 'form_periods',
      label: 'フォーム期間',
      filter: (q) => q.or('is_archived.eq.false,is_archived.is.null'),
    },
    { table: 'form_responses', label: 'フォーム回答', filter: (q) => q.eq('is_archived', false) },
    { table: 'application_items', label: '申込項目' },
    { table: 'student_applications', label: '生徒申込' },
    { table: 'alert_dismissals', label: 'アラート非表示' },
    { table: 'student_interviews', label: '面談' },
  ];

  const results: { label: string; count: number }[] = [];

  await Promise.all(
    tables.map(async ({ table, label, filter: queryFilter }) => {
      let query = supabase
        .from(table)
        .select('id', { count: 'exact', head: true })
        .eq('school_id', schoolId);
      if (queryFilter) {
        query = queryFilter(query) as typeof query;
      }
      const { count, error } = await query;

      if (!error && count != null && count > 0) {
        results.push({ label, count });
      }
    })
  );

  // 存在する場合のみカウント（マイグレーションで未作成のテーブルがある場合を考慮）
  // exam_types は教室削除時に自動作除するためブロック対象に含めない
  const optionalTables: { table: string; label: string }[] = [
    { table: 'student_textbooks', label: '教材' },
    { table: 'form_templates', label: 'フォームテンプレート' },
    { table: 'forms', label: 'フォーム' },
  ];

  for (const { table, label } of optionalTables) {
    const { count, error } = await supabase
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq('school_id', schoolId);
    if (!error && count != null && count > 0) {
      results.push({ label, count });
    }
  }

  return results.sort((a, b) => b.count - a.count);
}

// 教室を削除
export async function deleteSchool(id: string): Promise<void> {
  // 削除ブロック要因を事前に取得してメッセージを分かりやすくする
  const blocking = await getSchoolBlockingReferences(id);
  if (blocking.length > 0) {
    const detail = blocking.map((b) => `${b.label}（${b.count}件）`).join('、');
    throw new Error(
      `この教室は次のデータで参照されているため削除できません。先に解除してください。［${detail}］`
    );
  }

  // この教室へのユーザー割り当てを解除（システム管理者の全教室参照などで残っている行を削除）
  const { error: userSchoolsError } = await supabase
    .from('user_schools')
    .delete()
    .eq('school_id', id);

  if (userSchoolsError) {
    console.error('Error deleting user_schools for school:', userSchoolsError);
    throw new Error('教室の削除に失敗しました');
  }

  // portal_menu を先に削除（CASCADE で消える場合もあるが、明示的に削除）
  const { error: menuError } = await supabase.from('portal_menu').delete().eq('school_id', id);

  if (menuError) {
    console.error('Error deleting portal_menu for school:', menuError);
    throw new Error('教室の削除に失敗しました');
  }

  // 教室作成時にマイグレーション等で自動作成されるデータを削除（これらがあると削除できないため）
  // お知らせ投稿 → お知らせラベル → 試験種別 の順
  const { error: bulletinPostsError } = await supabase
    .from('bulletin_posts')
    .delete()
    .eq('school_id', id);
  if (bulletinPostsError) {
    console.warn('Error deleting bulletin_posts for school:', bulletinPostsError);
  }
  const { error: bulletinLabelsError } = await supabase
    .from('bulletin_labels')
    .delete()
    .eq('school_id', id);
  if (bulletinLabelsError) {
    console.warn('Error deleting bulletin_labels for school:', bulletinLabelsError);
  }
  const { error: examTypesError } = await supabase.from('exam_types').delete().eq('school_id', id);
  if (examTypesError) {
    console.warn('Error deleting exam_types for school:', examTypesError);
  }

  const { error } = await supabase.from('schools').delete().eq('id', id);

  if (error) {
    console.error('Error deleting school:', error);
    if (error.code === '23503') {
      // 上でチェックした以外の参照がある場合（別テーブルやRLSで見えない行など）
      throw new Error(
        'この教室は他のデータで参照されているため削除できません。' +
          '生徒ログ・テスト成績・フォームテンプレート等が残っていないか確認するか、管理者に問い合わせください。'
      );
    }
    throw new Error('教室の削除に失敗しました');
  }
}
