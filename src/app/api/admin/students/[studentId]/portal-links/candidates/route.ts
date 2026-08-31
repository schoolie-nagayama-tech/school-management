import { NextRequest, NextResponse } from 'next/server';
import { authorizeStudentScope } from '@/lib/api/portalStudentScope';

export const dynamic = 'force-dynamic';

/**
 * 「登録済みの保護者から選ぶ」ための候補アカウント一覧（生徒詳細モーダル用）。
 *
 * 兄弟の2人目以降は、招待を発行しなくてもここから直接紐づけられる（POST portal-links）。
 * 認可は portal-links と同じ manager 以上＋自教室スコープ。
 *
 * ★ 候補に出すのは「自教室の生徒に既に紐づいているアカウント」だけ:
 *   全アカウントを検索させると、他教室・他家庭のアカウント名（＝LINEの表示名＝個人情報）が
 *   教室長に見えてしまう。POST 側でも同じ条件を再検証しているので、UIを迂回しても足せない。
 *
 * ★ 兄弟候補（is_sibling_candidate）はあくまで推測:
 *   students.is_sibling は真偽値だけで「誰と兄弟か」を持たないため、姓の一致で拾っている。
 *   別のご家庭のことがあるので、UI側では「候補」と明示して確認を挟むこと。
 */

/** 候補として返す上限。面談中に眺める前提なので、多すぎても選べない。 */
const CANDIDATE_LIMIT = 50;

/**
 * 紐づけ行の読み取り上限。
 * PostgREST の既定は1000行で静かに切り捨てるため、明示的に range を指定して
 * 「上限に当たったか」を検知できるようにする（落とし穴_PostgRESTの1000行上限）。
 */
const LINK_SCAN_LIMIT = 2000;

interface LinkRow {
  account_id: string;
  student_id: string;
  students: {
    last_name: string | null;
    first_name: string | null;
    last_name_kana: string | null;
    grade: number | null;
    school_id: string | null;
  } | null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ studentId: string }> }
) {
  const { studentId: studentIdRaw } = await params;
  const gate = await authorizeStudentScope(request, studentIdRaw);
  if (!gate.ok) return gate.error;
  const { supabase, studentId, auth } = gate;

  const q = (request.nextUrl.searchParams.get('q') ?? '').trim();

  // 対象生徒の姓（兄弟候補の判定に使う）。
  const { data: target, error: targetErr } = await supabase
    .from('students')
    .select('last_name, last_name_kana')
    .eq('id', studentId)
    .maybeSingle();

  if (targetErr) {
    console.error('[portal-links/candidates] 対象生徒の取得に失敗:', targetErr.message);
    return NextResponse.json({ error: '取得に失敗しました' }, { status: 500 });
  }

  const targetLastName = ((target as { last_name?: string | null } | null)?.last_name ?? '').trim();
  const targetLastNameKana = (
    (target as { last_name_kana?: string | null } | null)?.last_name_kana ?? ''
  ).trim();

  // 自教室の生徒に紐づく行だけを引く。
  // students!inner + students.school_id の in で「親行そのもの」を絞る（embed だけ絞ると親が残る）。
  const { data: links, error: linkErr } = await supabase
    .from('portal_account_students')
    .select(
      'account_id, student_id, students!inner(last_name, first_name, last_name_kana, grade, school_id)'
    )
    .in('students.school_id', auth.schoolIds)
    .range(0, LINK_SCAN_LIMIT - 1);

  if (linkErr) {
    console.error('[portal-links/candidates] 紐づけ取得に失敗:', linkErr.message);
    return NextResponse.json({ error: '取得に失敗しました' }, { status: 500 });
  }

  const linkRows = (links ?? []) as unknown as LinkRow[];
  if (linkRows.length >= LINK_SCAN_LIMIT) {
    // 上限に当たったら候補が欠ける可能性がある。件数が増えたら検索をDB側へ寄せる合図。
    console.warn('[portal-links/candidates] 紐づけ行が読み取り上限に到達。候補が欠ける可能性あり');
  }

  // アカウントごとに「自教室で見ている生徒」をまとめる。
  const byAccount = new Map<
    string,
    {
      students: Array<{ student_id: string; student_name: string; grade: number | null }>;
      alreadyLinked: boolean;
      siblingHint: boolean;
    }
  >();

  for (const row of linkRows) {
    const s = row.students;
    if (!s) continue;
    const entry = byAccount.get(row.account_id) ?? {
      students: [],
      alreadyLinked: false,
      siblingHint: false,
    };

    if (row.student_id === studentId) {
      // 既にこの生徒に紐づいているアカウントは候補から外す（重複紐づけの提案を出さない）。
      entry.alreadyLinked = true;
    } else {
      const name = `${s.last_name ?? ''} ${s.first_name ?? ''}`.trim();
      entry.students.push({
        student_id: row.student_id,
        student_name: name || '（不明な生徒）',
        grade: s.grade ?? null,
      });
      // 姓（または姓カナ）が一致する生徒を見ているアカウントは兄弟の可能性が高い。
      const sameName =
        (targetLastName !== '' && (s.last_name ?? '').trim() === targetLastName) ||
        (targetLastNameKana !== '' && (s.last_name_kana ?? '').trim() === targetLastNameKana);
      if (sameName) entry.siblingHint = true;
    }

    byAccount.set(row.account_id, entry);
  }

  const candidateIds = Array.from(byAccount.entries())
    .filter(([, v]) => !v.alreadyLinked && v.students.length > 0)
    .map(([id]) => id);

  if (candidateIds.length === 0) {
    return NextResponse.json({ candidates: [] });
  }

  // アカウント情報（表示名・LINE状態）を引く。line_user_id の値そのものは返さない。
  const { data: accounts, error: accErr } = await supabase
    .from('portal_accounts')
    .select('id, display_name, login_id, line_user_id, line_followed, last_login_at')
    .in('id', candidateIds);

  if (accErr) {
    console.error('[portal-links/candidates] アカウント取得に失敗:', accErr.message);
    return NextResponse.json({ error: '取得に失敗しました' }, { status: 500 });
  }

  type AccountRow = {
    id: string;
    display_name: string;
    login_id: string | null;
    line_user_id: string | null;
    line_followed: boolean | null;
    last_login_at: string | null;
  };

  const needle = q.toLowerCase();

  const candidates = ((accounts ?? []) as AccountRow[])
    .map((a) => {
      const entry = byAccount.get(a.id)!;
      const hasLine = a.line_user_id != null;
      return {
        account_id: a.id,
        display_name: a.display_name,
        login_id: a.login_id,
        has_line: hasLine,
        line_followed: hasLine ? a.line_followed !== false : null,
        last_login_at: a.last_login_at,
        students: entry.students,
        is_sibling_candidate: entry.siblingHint,
      };
    })
    // 検索語は「保護者の表示名」と「紐づく生徒名」の両方に当てる
    // （表示名がLINEのニックネームで本名と違うことがあるため、生徒名からも辿れるようにする）。
    .filter((c) => {
      if (!needle) return true;
      if (c.display_name.toLowerCase().includes(needle)) return true;
      return c.students.some((s) => s.student_name.toLowerCase().includes(needle));
    })
    // 兄弟候補を先頭へ。次に最終ログインが新しい順（生きているアカウントを上に）。
    .sort((a, b) => {
      if (a.is_sibling_candidate !== b.is_sibling_candidate) return a.is_sibling_candidate ? -1 : 1;
      const at = a.last_login_at ? Date.parse(a.last_login_at) : 0;
      const bt = b.last_login_at ? Date.parse(b.last_login_at) : 0;
      return bt - at;
    })
    .slice(0, CANDIDATE_LIMIT);

  return NextResponse.json({ candidates });
}
