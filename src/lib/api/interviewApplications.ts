/**
 * 面談ワークスペース: 申込から見えることの読み込み（生徒1人ぶん）
 * ------------------------------------------------------------------
 * ④テスト対策（提案書＋増コマ申込）・②週回数変更・④模試の申込を、面談画面が1人ぶんだけ読む。
 * 並べ方（行の組み立て）は interview.shared.ts の純粋関数（buildTestPrepLines ほか）に任せ、
 * ここは「DBの形 → 純粋関数の入力の形」への変換だけをする。
 *
 * ★教室全体を読まない。form_responses は linked_student_id で、提案書は student_id で直接絞る
 *  （面談は1人ずつ開くもので、教室ぶん読むと1000行の上限と待ち時間の両方に当たる）。
 * ★どれも .limit() を付ける（PostgREST は未ページングの select を1000行で黙って切る）。
 * ★読めなくても面談画面は開けるよう、呼び出し側は失敗を空で受ける（InterviewWorkspace）。
 */

import { supabase } from '@/lib/supabase';
import { getMoshiExamDates } from '@/lib/utils/moshiExamDates';
import type { MoshiSettings } from '@/types/forms/moshi';
import {
  resolveTestPrepZoukoma,
  type MockApplicationForInterview,
  type ShukaisuChangeForInterview,
  type TestPrepProposalForInterview,
  type ZoukomaResponseForInterview,
} from '@/app/interview/interview.shared';

// test_prep_* は DB 型定義に未登録（lib/api/test-prep-proposals.ts と同じ扱い）
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => supabase as any;

/** 何件の提案書まで読むか（buildTestPrepLines が見るのは最新2件） */
const TEST_PREP_LIMIT = 2;

type ProposalRow = {
  id: string;
  title: string | null;
  created_at: string;
  zoukoma_period_id: string | null;
  exam_type: { name: string | null } | null;
  subjects:
    | {
        subject_name: string;
        proposed_koma: number | null;
        sort_order: number | null;
        units:
          | { unit_name: string | null; koma_count: number | null; sort_order: number | null }[]
          | null;
      }[]
    | null;
};

const bySortOrder = (a: { sort_order: number | null }, b: { sort_order: number | null }) =>
  (a.sort_order ?? 0) - (b.sort_order ?? 0);

/**
 * 公開済みのテスト対策の提案書（新しい順・最大2件）と、それぞれの増コマ申込の状況。
 *
 * ★公開済み（published）だけ。下書きは保護者に出していない提案で、面談で「対策した」とは言えない。
 * ★増コマ申込は、提案書の期（zoukoma_period_id → form_periods.period_key）と
 *   同じ期のこの生徒の回答で判定する（lib/api/dashboardForms.ts の取得判定と同じ突き合わせ）。
 */
export async function getInterviewTestPrep(
  studentId: string
): Promise<TestPrepProposalForInterview[]> {
  const { data, error } = await db()
    .from('test_prep_proposals')
    .select(
      'id, title, created_at, zoukoma_period_id, exam_type:exam_types(name), subjects:test_prep_proposal_subjects(subject_name, proposed_koma, sort_order, units:test_prep_proposal_units(unit_name, koma_count, sort_order))'
    )
    .eq('student_id', studentId)
    .eq('status', 'published')
    .order('created_at', { ascending: false })
    .limit(TEST_PREP_LIMIT);
  if (error) throw new Error(`テスト対策の提案書の取得に失敗しました: ${error.message}`);
  const rows = (data ?? []) as ProposalRow[];
  if (rows.length === 0) return [];

  // 期のID → period_key
  const periodIds = Array.from(
    new Set(rows.map((r) => r.zoukoma_period_id).filter((id): id is string => !!id))
  );
  const periodKeyById = new Map<string, string>();
  let zoukoma: ZoukomaResponseForInterview[] = [];
  if (periodIds.length > 0) {
    const { data: periods } = await supabase
      .from('form_periods')
      .select('id, period_key')
      .in('id', periodIds);
    for (const p of (periods ?? []) as { id: string; period_key: string }[]) {
      periodKeyById.set(p.id, p.period_key);
    }
    const keys = Array.from(new Set(Array.from(periodKeyById.values())));
    if (keys.length > 0) {
      const { data: responses } = await supabase
        .from('form_responses')
        .select('form_period, created_at, response_data')
        .eq('form_type', 'zoukoma')
        .eq('linked_student_id', studentId)
        .in('form_period', keys)
        .order('created_at', { ascending: false })
        .limit(20);
      zoukoma = (
        (responses ?? []) as { form_period: string; created_at: string; response_data: unknown }[]
      ).map((r) => ({
        formPeriod: r.form_period,
        createdAt: r.created_at,
        responseData: r.response_data,
      }));
    }
  }

  return rows.map((r) => ({
    id: r.id,
    examName: r.exam_type?.name ?? null,
    title: r.title ?? 'テスト対策',
    createdAt: r.created_at,
    subjects: (r.subjects ?? [])
      .slice()
      .sort(bySortOrder)
      .map((s) => ({
        name: s.subject_name,
        koma: s.proposed_koma ?? 0,
        units: (s.units ?? [])
          .slice()
          .sort(bySortOrder)
          .map((u) => ({ name: (u.unit_name ?? '').trim(), koma: u.koma_count ?? 0 }))
          .filter((u) => u.name !== ''),
      })),
    zoukoma: resolveTestPrepZoukoma(
      r.zoukoma_period_id ? (periodKeyById.get(r.zoukoma_period_id) ?? null) : null,
      zoukoma
    ),
  }));
}

/** 何か月前までの申込を読むか（buildShukaisuLines も半年で切る） */
const LOOKBACK_MONTHS = 6;

function monthsAgoIso(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString();
}

/**
 * この生徒に紐付いた週回数変更の申込のうち、いちばん新しい1件（半年以内）。
 *
 * ★アーカイブ済みも読む。アーカイブは「処理が済んだので一覧から下げた」印で、
 *   変更が取り消されたという意味ではない（面談で話すのはむしろ処理済みの変更のその後）。
 */
export async function getInterviewShukaisu(
  studentId: string
): Promise<ShukaisuChangeForInterview | null> {
  const { data, error } = await supabase
    .from('form_responses')
    .select('created_at, response_data, status_checks')
    .eq('form_type', 'shukaisu')
    .eq('linked_student_id', studentId)
    .gte('created_at', monthsAgoIso(LOOKBACK_MONTHS))
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(`週回数変更の取得に失敗しました: ${error.message}`);
  const row = (data ?? [])[0] as
    | { created_at: string; response_data: unknown; status_checks: unknown }
    | undefined;
  if (!row) return null;

  const rd = (row.response_data ?? {}) as {
    current?: { weekly_count?: unknown };
    requested?: { weekly_count?: unknown };
    change_from?: unknown;
  };
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const changeFrom =
    typeof rd.change_from === 'string' && /^\d{4}-\d{2}/.test(rd.change_from)
      ? rd.change_from.slice(0, 7)
      : null;
  const checks = (row.status_checks ?? {}) as { seated?: unknown };
  return {
    createdAt: row.created_at,
    currentWeekly: num(rd.current?.weekly_count),
    requestedWeekly: num(rd.requested?.weekly_count),
    changeFrom,
    seated: checks.seated === true,
  };
}

/** 模試の申込を何件まで読むか */
const MOCK_APPLICATION_LIMIT = 20;

/** 「9月度オープン模試申込み」→「9月度オープン模試」。全角数字は半角に（月の重なりを見分けるため） */
function moshiName(title: string | null): string {
  const base = (title ?? '模試')
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\s*(申し込み|申込み|申込)\s*$/, '')
    .trim();
  return base || '模試';
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * この生徒の模試の申込（Vもぎ＝mogi・塾内模試＝moshi）を、受験日の分かるものだけ返す。
 *
 * 受験日の決め方（★決めきれないものは返さない。推測で「まだ入っていない」と言わない）:
 * - mogi: 選んだ日程ごとに1件。date_id の先頭が 'YYYY-MM-DD'（「2026-11-15__toritsu_v」）
 * - moshi: 振替受験なら furikae_date、通常受験なら selected_exam_date。
 *   どちらも無い古い回答は、その期の日程（form_periods.settings）が1つだけのときに限り、それを使う。
 *   日程が2つ以上あって選んだ日が残っていない回答は、どの日に受けたか分からないので飛ばす。
 */
export async function getInterviewMockApplications(
  studentId: string
): Promise<MockApplicationForInterview[]> {
  const { data, error } = await supabase
    .from('form_responses')
    .select('school_id, form_type, form_period, response_data')
    .in('form_type', ['mogi', 'moshi'])
    .eq('linked_student_id', studentId)
    .gte('created_at', monthsAgoIso(LOOKBACK_MONTHS))
    .order('created_at', { ascending: false })
    .limit(MOCK_APPLICATION_LIMIT);
  if (error) throw new Error(`模試の申込の取得に失敗しました: ${error.message}`);
  const rows = (data ?? []) as {
    school_id: string;
    form_type: 'mogi' | 'moshi';
    form_period: string;
    response_data: unknown;
  }[];
  if (rows.length === 0) return [];

  // moshi は名前（期のタイトル）と、古い回答の受験日を期から引く
  const moshiRows = rows.filter((r) => r.form_type === 'moshi');
  const periodByKey = new Map<string, { title: string | null; settings: MoshiSettings }>();
  if (moshiRows.length > 0) {
    const { data: periods } = await supabase
      .from('form_periods')
      .select('school_id, period_key, title, settings')
      .eq('form_type', 'moshi')
      .in('school_id', Array.from(new Set(moshiRows.map((r) => r.school_id))))
      .in('period_key', Array.from(new Set(moshiRows.map((r) => r.form_period))))
      .limit(50);
    for (const p of (periods ?? []) as {
      school_id: string;
      period_key: string;
      title: string | null;
      settings: unknown;
    }[]) {
      periodByKey.set(`${p.school_id}|${p.period_key}`, {
        title: p.title,
        settings: (p.settings ?? {}) as MoshiSettings,
      });
    }
  }

  const out: MockApplicationForInterview[] = [];
  for (const r of rows) {
    const rd = (r.response_data ?? {}) as Record<string, unknown>;
    if (r.form_type === 'mogi') {
      const selections = Array.isArray(rd.selections) ? (rd.selections as unknown[]) : [];
      for (const s of selections) {
        const sel = (s ?? {}) as { date_id?: unknown; exam_type_label?: unknown };
        const date = typeof sel.date_id === 'string' ? sel.date_id.slice(0, 10) : '';
        if (!YMD.test(date)) continue;
        const name =
          typeof sel.exam_type_label === 'string' && sel.exam_type_label.trim()
            ? sel.exam_type_label.trim()
            : 'Vもぎ';
        out.push({ name, examDate: date });
      }
      continue;
    }

    const period = periodByKey.get(`${r.school_id}|${r.form_period}`);
    const pick = (v: unknown) => (typeof v === 'string' && YMD.test(v) ? v : null);
    let date = rd.exam_type === 'furikae' ? pick(rd.furikae_date) : pick(rd.selected_exam_date);
    if (!date && rd.exam_type !== 'furikae' && period) {
      const dates = getMoshiExamDates(period.settings);
      if (dates.length === 1 && YMD.test(dates[0].date)) date = dates[0].date;
    }
    if (!date) continue;
    out.push({ name: moshiName(period?.title ?? null), examDate: date });
  }
  return out;
}
