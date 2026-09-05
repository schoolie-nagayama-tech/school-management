import { NextRequest, NextResponse } from 'next/server';
import { getApiAuth } from '@/lib/api-auth';
import { isManagerOrAbove } from '@/lib/utils/roles';
import { getPortalServiceClient } from '@/lib/mypage/serviceClient';
import type { SupabaseClient } from '@supabase/supabase-js';
import { callClaudeJson, isClaudeConfigured, CLAUDE_MODELS, ClaudeError } from '@/lib/ai/claude';
import {
  conceptSystemPrompt,
  conceptUserText,
  MAX_CONCEPTS_PER_CALL,
  parseConceptResult,
  type ConceptInput,
  type ConceptResult,
} from '@/lib/ai/koushuConcept';
import { KOUSHU_CONCEPT_FEATURE_KEY } from '@/lib/bulletin/schoolSetting';
import { GRADE_LABELS, ASSESSMENT_NAME_LABELS } from '@/types/database';

export const dynamic = 'force-dynamic';

/**
 * 講習テーマを書き足す（教室長以上）。
 *
 * ★教室長が書いた一言（「予習」など）を、その生徒の単元と成績で膨らませる。
 *   776件（263名×科目）を1件ずつ書く余裕がないので短くなっている、という運用が前提。
 *
 * ★成績を外部（Anthropic）へ送る。掲示板の本文より機微が高いので、
 *   教室ごとの栓を別のキーで持つ（koushu_concept）。既定はOFF。
 *   プライバシーポリシーのリーガルチェックが終わるまで、どの教室もオンにしない。
 *
 * ★書き込まない。作った結果を返すだけで、保存するかは画面が決める
 *   （776件を黙って書き換えないため）。
 *
 * 正典: docs/ai-features-integration-plan.md §2-5
 */

interface ConceptResponse {
  results: ConceptResult[];
  degraded: boolean;
  disabled: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 直近の成績を1件だけ拾う。★その科目のものだけ */
function pickLatest(
  rows: { name_code: string; created_at: string; value: number }[]
): { label: string; value: number } | null {
  if (rows.length === 0) return null;
  const latest = rows.reduce((a, b) => (a.created_at >= b.created_at ? a : b));
  return {
    label: ASSESSMENT_NAME_LABELS[latest.name_code] ?? latest.name_code,
    value: latest.value,
  };
}

/**
 * 提案書ごとの材料を集める。
 * ★渡すのはその生徒のものだけ。ほかの生徒の提案書も過去のテーマの文面も渡さない。
 */
async function loadInputs(
  supabase: SupabaseClient,
  proposalIds: string[],
  schoolId: string
): Promise<ConceptInput[]> {
  const { data: proposals } = await supabase
    .from('seasonal_proposals')
    .select('id, student_id, textbook_id, theme, school_id')
    .in('id', proposalIds)
    .eq('school_id', schoolId);

  if (!proposals || proposals.length === 0) return [];

  const studentIds = Array.from(new Set(proposals.map((p) => p.student_id as string)));
  const textbookIds = Array.from(
    new Set(
      proposals.map((p) => p.textbook_id as number | null).filter((v): v is number => v != null)
    )
  );

  const [{ data: students }, { data: textbooks }, { data: units }] = await Promise.all([
    supabase.from('students').select('id, grade').in('id', studentIds),
    supabase.from('textbooks').select('id, subject').in('id', textbookIds),
    supabase
      .from('seasonal_proposal_units')
      .select('proposal_id, koma_count, curriculum_items(title)')
      .in('proposal_id', proposalIds)
      .order('sort_order', { ascending: true }),
  ]);

  const gradeById = new Map(
    (students ?? []).map((s) => [s.id as string, s.grade as number | null])
  );
  const subjectById = new Map(
    (textbooks ?? []).map((t) => [t.id as number, (t.subject as string) ?? ''])
  );

  const unitsByProposal = new Map<string, { title: string; koma: number }[]>();
  for (const u of units ?? []) {
    // ★PostgREST の結合は配列で返ることがあるので、両方の形を受ける
    const raw = u.curriculum_items as { title: string } | { title: string }[] | null;
    const item = Array.isArray(raw) ? (raw[0] ?? null) : raw;
    if (!item?.title) continue;
    const list = unitsByProposal.get(u.proposal_id as string) ?? [];
    list.push({ title: item.title, koma: (u.koma_count as number) ?? 1 });
    unitsByProposal.set(u.proposal_id as string, list);
  }

  // 成績。★科目が分かるものだけを引き、生徒×科目で束ねる
  const { data: assessments } = await supabase
    .from('assessments')
    .select('student_id, category, name_code, created_at, assessment_scores(subject, value)')
    .in('student_id', studentIds)
    .in('category', ['regular_test', 'report_card']);

  type Row = { name_code: string; created_at: string; value: number };
  const testBy = new Map<string, Row[]>();
  const cardBy = new Map<string, Row[]>();

  for (const a of assessments ?? []) {
    const scores = (a.assessment_scores ?? []) as { subject: string; value: number | null }[];
    for (const s of scores) {
      if (s.value == null) continue;
      const key = `${a.student_id as string}:${s.subject}`;
      const row: Row = {
        name_code: a.name_code as string,
        created_at: a.created_at as string,
        value: s.value,
      };
      const target = a.category === 'regular_test' ? testBy : cardBy;
      const list = target.get(key) ?? [];
      list.push(row);
      target.set(key, list);
    }
  }

  return proposals.map((p) => {
    const studentId = p.student_id as string;
    const subject = subjectById.get(p.textbook_id as number) ?? '';
    const key = `${studentId}:${subject}`;
    const grade = gradeById.get(studentId) ?? null;

    return {
      proposalId: p.id as string,
      theme: (p.theme as string) ?? '',
      gradeLabel: grade != null ? (GRADE_LABELS[grade] ?? '') : '',
      subject,
      units: unitsByProposal.get(p.id as string) ?? [],
      // ★無ければ null のまま。prompt 側で「触れないこと」と伝える
      testScore: pickLatest(testBy.get(key) ?? []),
      reportCard: pickLatest(cardBy.get(key) ?? []),
    };
  });
}

export async function POST(request: NextRequest) {
  const { auth } = await getApiAuth(request);
  if (!auth) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }
  if (!isManagerOrAbove(auth.role)) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  let body: { schoolId?: unknown; proposalIds?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
  }

  const schoolId = typeof body.schoolId === 'string' ? body.schoolId : '';
  if (!UUID_RE.test(schoolId)) {
    return NextResponse.json({ error: '教室IDが不正です' }, { status: 400 });
  }
  if (!auth.schoolIds.includes(schoolId)) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  const proposalIds = Array.isArray(body.proposalIds)
    ? body.proposalIds
        .filter((v): v is string => typeof v === 'string' && UUID_RE.test(v))
        .slice(0, MAX_CONCEPTS_PER_CALL)
    : [];
  if (proposalIds.length === 0) {
    return NextResponse.json({ error: '対象がありません' }, { status: 400 });
  }

  const empty: ConceptResponse = { results: [], degraded: false, disabled: false };
  const supabase = getPortalServiceClient();

  // ★この教室で成績をAIに送ってよいか。掲示板とは別のキー（既定OFF）
  const { data: setting } = await supabase
    .from('school_ai_settings')
    .select('enabled')
    .eq('school_id', schoolId)
    .eq('feature_key', KOUSHU_CONCEPT_FEATURE_KEY)
    .maybeSingle();

  if (!setting?.enabled) {
    return NextResponse.json({ ...empty, disabled: true } satisfies ConceptResponse);
  }

  if (!isClaudeConfigured()) {
    return NextResponse.json({ ...empty, degraded: true } satisfies ConceptResponse);
  }

  const inputs = await loadInputs(supabase, proposalIds, schoolId);
  if (inputs.length === 0) {
    return NextResponse.json({ error: '提案書が見つかりません' }, { status: 404 });
  }

  try {
    const raw = await callClaudeJson<unknown>({
      // 文章を組み立てるので smart。整えるほうは fast で足りる
      model: CLAUDE_MODELS.smart,
      // 書き方の決まりは毎回同じなのでキャッシュに載せる
      system: [{ text: conceptSystemPrompt(), cache: true }],
      userText: conceptUserText(inputs),
      maxTokens: 3000,
    });
    const results = parseConceptResult(raw, inputs);
    if (results.length === 0) {
      return NextResponse.json({ ...empty, degraded: true } satisfies ConceptResponse);
    }
    return NextResponse.json({
      results,
      degraded: false,
      disabled: false,
    } satisfies ConceptResponse);
  } catch (e) {
    const reason = e instanceof ClaudeError ? e.reason : 'unavailable';
    console.error('[ai/koushu/concept] failed', reason, e);
    return NextResponse.json({ ...empty, degraded: true } satisfies ConceptResponse);
  }
}
