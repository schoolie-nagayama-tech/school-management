/**
 * 講習申込フォーム（保護者向け・公開経路）の初期表示ローダー。
 *
 * 正典仕様: docs/koushu-auto-allocation-spec.md §9〜§17（決定13〜54）。
 * 入出力契約: `src/types/koushu-apply.ts`。
 *
 * 未ログインの保護者から直接叩かれる公開経路（トークン or 生徒コード）なので、
 * service role クライアントで RLS をバイパスして読む（`seasonal-shift-student/submit` と同じパターン）。
 *
 * `src/app/api/koushu-apply/route.ts`（送信API）は、ここで定義した「申込コンテキストの解決」
 * 「提案の集計」「開講枠の解決」を共有して二重実装を避ける（公開判定・科目解決のロジックが
 * ローダーとAPIでズレるとバグの元になるため）。
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { fetchAllPaged } from '@/lib/utils/supabasePaging';
import { GRADE_LABELS } from '@/types/database';
import { INDIVIDUAL_FORMATION } from '@/types/schedule';
import {
  lookupUnitPrice,
  MAX_GRADE_FOR_45MIN,
  type ApplyAddableSubject,
  type ApplyAvailabilitySlot,
  type ApplyCourse,
  type ApplyDuration,
  type ApplyProposalLine,
  type ApplyRatio,
  type KoushuApplyFormData,
  type PriceTable,
} from '@/types/koushu-apply';
import {
  aggregateProposalsBySubject,
  calendarWeeks,
  countWeeklyRegularSlots,
  gradeCategoryOf,
  isApplyPublished,
  markHeldSessions,
  regularKomaInPeriod,
  remainingSessionCount,
  resolveGradeEndDate,
  sumProposalUnitsKoma,
  type ProposalSubjectInput,
} from '@/lib/utils/koushuApplyPure';

// このファイルが触るテーブルの多くは Q1〜Q3 で追加された列・テーブルで、
// 生成型（src/types/database.ts）に未反映（apply_publish_start 等）。
// 既存の講習系コード（seasonalCourses.ts / koushu-period.ts）と同じく any でクエリする。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyDb = any;

const SEASON_LABEL_JA: Record<string, string> = { spring: '春期', summer: '夏期', winter: '冬期' };

/**
 * service role クライアントはリクエスト時に作る。モジュールロード時に作ると、
 * Next.js のビルド時ページデータ収集フェーズで env が無い CI 環境などで
 * `supabaseUrl is required` でビルドが落ちる（既存の公開APIと同じ注意点）。
 */
export function getAdminDb(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Supabase env vars are not configured');
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// ============================================================
// 申込コンテキストの解決（ローダー・送信APIの共通の入口）
// ============================================================

export type ResolveParams =
  | { kind: 'token'; token: string }
  | { kind: 'studentCode'; schoolCode: string; studentCode: string };

interface PeriodRow {
  id: string;
  school_id: string;
  season: string;
  year: number;
  schedule_start_date: string | null;
  schedule_end_date: string | null;
  apply_publish_start: string | null;
  apply_publish_end: string | null;
  apply_price_table: PriceTable | null;
  schedule_end_by_grade: Record<string, string> | null;
}

interface StudentRow {
  id: string;
  school_id: string;
  last_name: string;
  first_name: string;
  grade: number;
  status: string;
}

export interface ApplyContext {
  db: AnyDb;
  schoolId: string;
  studentId: string;
  season: string;
  year: number;
  period: PeriodRow;
  student: StudentRow;
  /** 由来の可読な区別（ログ・監査用途）。書き込み側では使わない */
  via: ResolveParams['kind'];
}

export type ApplyContextResult =
  | { ok: true; ctx: ApplyContext }
  | { ok: false; reason: 'not_found' | 'not_published' | 'revoked' };

/**
 * トークン or 生徒コードから「生徒×講習期間」の申込コンテキストを解決する。
 * 公開判定（決定29・§12）はここに一本化する。ここが非公開の担保の要なので絶対に緩めないこと。
 */
export async function resolveApplyContext(params: ResolveParams): Promise<ApplyContextResult> {
  const db = getAdminDb() as AnyDb;

  let schoolId: string;
  let studentId: string;
  let season: string;
  let year: number;

  if (params.kind === 'token') {
    const { data: tokenRow } = await db
      .from('koushu_apply_tokens')
      .select('school_id, student_id, season, year, revoked_at')
      .eq('token', params.token)
      .maybeSingle();
    if (!tokenRow) return { ok: false, reason: 'not_found' };
    if (tokenRow.revoked_at) return { ok: false, reason: 'revoked' };
    schoolId = tokenRow.school_id;
    studentId = tokenRow.student_id;
    season = tokenRow.season;
    year = tokenRow.year;
  } else {
    // 生徒コード経由: 教室コード → 生徒コードの完全一致で解決する（/seasonal-shift-student と同方式）。
    const { data: school } = await db
      .from('schools')
      .select('id')
      .eq('code', params.schoolCode)
      .maybeSingle();
    if (!school) return { ok: false, reason: 'not_found' };

    const { data: student } = await db
      .from('students')
      .select('id, grade, status')
      .eq('school_id', school.id)
      .eq('student_code', params.studentCode)
      .maybeSingle();
    if (!student || student.status === 'withdrawn') return { ok: false, reason: 'not_found' };

    // 生徒コード経由には season/year の指定が無いため、公開設定がある期間の中から
    // 最も新しく公開設定された期間を暫定選択する。実際に「今公開中か」は下の
    // isApplyPublished の共通チェックで判定するため、ここで外れていても not_published に
    // 正しくマップされる（未来/過去の期間しか無ければ not_published、そもそも一度も
    // 公開設定されたことが無ければ not_found）。
    const { data: periods } = await db
      .from('course_prep_periods')
      .select('season, year, apply_publish_start')
      .eq('school_id', school.id)
      .not('apply_publish_start', 'is', null)
      .order('apply_publish_start', { ascending: false })
      .limit(1);
    const current = ((periods ?? []) as Array<{ season: string; year: number }>)[0];
    if (!current) return { ok: false, reason: 'not_found' };

    schoolId = school.id;
    studentId = student.id;
    season = current.season;
    year = current.year;
  }

  const { data: period } = await db
    .from('course_prep_periods')
    .select(
      'id, school_id, season, year, schedule_start_date, schedule_end_date, apply_publish_start, apply_publish_end, apply_price_table, schedule_end_by_grade'
    )
    .eq('school_id', schoolId)
    .eq('season', season)
    .eq('year', year)
    .maybeSingle();
  if (!period) return { ok: false, reason: 'not_found' };
  if (!period.schedule_start_date || !period.schedule_end_date) {
    return { ok: false, reason: 'not_published' };
  }
  if (!isApplyPublished(period.apply_publish_start, period.apply_publish_end, new Date())) {
    return { ok: false, reason: 'not_published' };
  }

  const { data: student } = await db
    .from('students')
    .select('id, school_id, last_name, first_name, grade, status')
    .eq('id', studentId)
    .maybeSingle();
  if (!student || student.school_id !== schoolId || student.status === 'withdrawn') {
    return { ok: false, reason: 'not_found' };
  }

  return {
    ok: true,
    ctx: {
      db,
      schoolId,
      studentId,
      season,
      year,
      period: period as PeriodRow,
      student,
      via: params.kind,
    },
  };
}

/** ctx から派生する期間・学年の値をまとめて計算する（ローダー・送信APIの両方で使う） */
export function derivePeriodInfo(ctx: ApplyContext) {
  const grade = ctx.student.grade;
  const gradeLabel = GRADE_LABELS[grade] ?? String(grade);
  const gradeCategory = gradeCategoryOf(grade);
  // resolveApplyContext で schedule_start_date/schedule_end_date の非NULLは確認済み
  const startDate = ctx.period.schedule_start_date as string;
  const endDate = resolveGradeEndDate(
    ctx.period.schedule_end_date as string,
    ctx.period.schedule_end_by_grade,
    grade
  );
  const weeks = calendarWeeks(startDate, endDate);
  const priceTable = ctx.period.apply_price_table ?? null;
  const allow45 = grade <= MAX_GRADE_FOR_45MIN;
  return { grade, gradeLabel, gradeCategory, startDate, endDate, weeks, priceTable, allow45 };
}

// ============================================================
// 提案（決定32・33・34・47）
// ============================================================

/**
 * 生徒×期間の提案書（status in sent/approved）を科目単位に合算して取得する（決定33・34）。
 * regularKoma・unitPrice も含めて完成させる（ローダー表示・送信APIの検証の両方で使う共通の正）。
 */
export async function loadProposalLines(
  ctx: ApplyContext,
  opts: {
    startDate: string;
    endDate: string;
    weeks: number;
    gradeLabel: string;
    priceTable: PriceTable | null;
  }
): Promise<ApplyProposalLine[]> {
  const { db, studentId, season, year } = ctx;

  const { data: proposalRows } = await db
    .from('seasonal_proposals')
    .select('id, textbook_id, theme, ratio, duration_minutes')
    .eq('student_id', studentId)
    .eq('season', season)
    .eq('year', year)
    .in('status', ['sent', 'approved']);
  const proposals = (proposalRows ?? []) as Array<{
    id: string;
    textbook_id: number | null;
    theme: string | null;
    ratio: number | null;
    duration_minutes: number | null;
  }>;
  if (proposals.length === 0) return [];

  const proposalIds = proposals.map((p) => p.id);
  const { data: unitRows } = await db
    .from('seasonal_proposal_units')
    .select('proposal_id, koma_count, group_id')
    .in('proposal_id', proposalIds);
  const units = (unitRows ?? []) as Array<{
    proposal_id: string;
    koma_count: number;
    group_id: number;
  }>;
  const unitsByProposal = new Map<string, Array<{ groupId: number; komaCount: number }>>();
  for (const u of units) {
    const list = unitsByProposal.get(u.proposal_id) ?? [];
    list.push({ groupId: u.group_id, komaCount: u.koma_count });
    unitsByProposal.set(u.proposal_id, list);
  }

  const textbookIds = Array.from(
    new Set(proposals.map((p) => p.textbook_id).filter((id): id is number => id != null))
  );
  const { data: textbookRows } =
    textbookIds.length > 0
      ? await db.from('textbooks').select('id, name, subject_id').in('id', textbookIds)
      : { data: [] as Array<{ id: number; name: string; subject_id: string | null }> };
  const textbookById = new Map(
    ((textbookRows ?? []) as Array<{ id: number; name: string; subject_id: string | null }>).map(
      (t) => [t.id, t]
    )
  );

  const subjectIds = Array.from(
    new Set(
      Array.from(textbookById.values())
        .map((t) => t.subject_id)
        .filter((id): id is string => !!id)
    )
  );
  const { data: subjectRows } =
    subjectIds.length > 0
      ? await db.from('subjects').select('id, name').in('id', subjectIds)
      : { data: [] as Array<{ id: string; name: string }> };
  const subjectNameById = new Map(
    ((subjectRows ?? []) as Array<{ id: string; name: string }>).map((s) => [s.id, s.name])
  );

  const subjectInputs: ProposalSubjectInput[] = [];
  let skippedUnresolved = 0;
  for (const p of proposals) {
    const textbook = p.textbook_id != null ? textbookById.get(p.textbook_id) : undefined;
    const subjectId = textbook?.subject_id ?? null;
    if (!textbook || !subjectId) {
      // 科目未解決の提案書（textbooks.subject_id 未設定・バックフィル漏れ等）は
      // 科目単位で見せるフォームに乗せられないため除外し、件数だけログに残す。
      skippedUnresolved++;
      continue;
    }
    const koma = sumProposalUnitsKoma(unitsByProposal.get(p.id) ?? []);
    subjectInputs.push({
      subjectId,
      subjectName: subjectNameById.get(subjectId) ?? '不明な科目',
      textbookName: textbook.name,
      theme: p.theme,
      koma,
      ratio: p.ratio === 1 ? 1 : 2,
      duration: p.duration_minutes === 45 ? 45 : 90,
    });
  }
  if (skippedUnresolved > 0) {
    console.warn(
      `[koushuApply] 科目未解決の提案書を除外しました: student=${studentId}, count=${skippedUnresolved}`
    );
  }

  const aggregated = aggregateProposalsBySubject(subjectInputs);

  // regularKoma算出のため、この生徒の有効な個別通塾日程を1回だけ取得して使い回す。
  const { data: patternRows } = await db
    .from('schedule_regular_patterns')
    .select('day_of_week, time_slot_id, subject_ids, effective_from, effective_until')
    .eq('student_id', studentId)
    .eq('formation', INDIVIDUAL_FORMATION)
    .eq('is_active', true);
  const patterns = (patternRows ?? []) as Array<{
    day_of_week: number;
    time_slot_id: string;
    subject_ids: string[] | null;
    effective_from: string | null;
    effective_until: string | null;
  }>;
  // 期間と重ならない（期間より後に始まる/期間より前に終わる）パターンは除外する。
  const overlapping = patterns.filter(
    (p) =>
      (!p.effective_from || p.effective_from <= opts.endDate) &&
      (!p.effective_until || p.effective_until >= opts.startDate)
  );

  return aggregated.map((a) => {
    const weekly = countWeeklyRegularSlots(
      overlapping
        .filter((p) => (p.subject_ids ?? []).includes(a.subjectId))
        .map((p) => ({ dayOfWeek: p.day_of_week, timeSlotId: p.time_slot_id }))
    );
    const regularKoma = regularKomaInPeriod(weekly, opts.weeks);
    const unitPrice = lookupUnitPrice(opts.priceTable, opts.gradeLabel, a.ratio, a.duration);
    return {
      subjectId: a.subjectId,
      subjectName: a.subjectName,
      textbookNames: a.textbookNames,
      theme: a.theme,
      proposedKoma: a.proposedKoma,
      ratio: a.ratio,
      duration: a.duration,
      regularKoma,
      unitPrice,
    };
  });
}

// ============================================================
// 追加可能科目（決定25・48）
// ============================================================

export async function loadAddableSubjects(
  ctx: ApplyContext,
  opts: {
    gradeCategory: 'elementary' | 'middle' | 'high';
    priceTable: PriceTable | null;
    gradeLabel: string;
    allow45: boolean;
    excludeSubjectIds: Set<string>;
  }
): Promise<ApplyAddableSubject[]> {
  const { data: rows } = await ctx.db
    .from('subjects')
    .select('id, name, grade_category')
    .eq('grade_category', opts.gradeCategory);
  const durations: ApplyDuration[] = opts.allow45 ? [45, 90] : [90];
  const ratios: ApplyRatio[] = [1, 2];

  return (
    ((rows ?? []) as Array<{ id: string; name: string }>)
      .filter((s) => !opts.excludeSubjectIds.has(s.id))
      .map((s) => {
        const options: ApplyAddableSubject['options'] = [];
        for (const ratio of ratios) {
          for (const duration of durations) {
            const unitPrice = lookupUnitPrice(opts.priceTable, opts.gradeLabel, ratio, duration);
            if (unitPrice != null) options.push({ ratio, duration, unitPrice });
          }
        }
        return { subjectId: s.id, subjectName: s.name, options };
      })
      // 単価が1つも無い科目はそもそも申込めないので載せない。
      .filter((s) => s.options.length > 0)
  );
}

/** 生徒の学年帯に属する科目IDの集合（送信APIのバリデーション用） */
export async function loadSubjectIdsForGradeCategory(
  db: AnyDb,
  gradeCategory: 'elementary' | 'middle' | 'high'
): Promise<Set<string>> {
  const { data } = await db.from('subjects').select('id').eq('grade_category', gradeCategory);
  return new Set(((data ?? []) as Array<{ id: string }>).map((s) => s.id));
}

// ============================================================
// コース（小集団・プログラミング。決定36〜42・45）
// ============================================================

interface CourseRow {
  id: string;
  name: string;
  session_dates: Array<{ date: string; start_time: string; end_time: string }> | null;
  unit_price: number | null;
}

/**
 * 生徒の学年に合い、開催予定が申込期間に重なるコースを取得する（決定36・40・44）。
 * `seasonal_courses` に formation 列が無いため（既知のスキーマギャップ。実装報告を参照）、
 * 既存の `koushu_enrollments` からそのコースで過去に使われた formation を逆引きする。
 * 過去の申込が無いコースは 'group'（集団レーンの既定キー）にフォールバックする。
 */
export async function loadCourses(
  ctx: ApplyContext,
  opts: { grade: number; startDate: string; endDate: string; todayIso: string }
): Promise<ApplyCourse[]> {
  const { data: rows } = await ctx.db
    .from('seasonal_courses')
    .select('id, name, target_grades, session_dates, unit_price')
    .eq('school_id', ctx.schoolId)
    .eq('season', ctx.season)
    .eq('is_active', true);

  const candidates = ((rows ?? []) as Array<CourseRow & { target_grades: number[] | null }>).filter(
    (c) => (c.target_grades ?? []).includes(opts.grade)
  );
  const inRange = candidates.filter((c) => {
    const sessions = c.session_dates ?? [];
    return (
      c.unit_price != null &&
      sessions.some((s) => s.date >= opts.startDate && s.date <= opts.endDate)
    );
  });
  if (inRange.length === 0) return [];

  const courseIds = inRange.map((c) => c.id);
  const { data: formationRows } = await ctx.db
    .from('koushu_enrollments')
    .select('course_id, formation')
    .in('course_id', courseIds);
  const formationByCourse = new Map<string, string>();
  for (const r of (formationRows ?? []) as Array<{ course_id: string | null; formation: string }>) {
    if (r.course_id && !formationByCourse.has(r.course_id)) {
      formationByCourse.set(r.course_id, r.formation);
    }
  }

  return inRange.map((c) => {
    const sessions = markHeldSessions(c.session_dates ?? [], opts.todayIso);
    return {
      courseId: c.id,
      name: c.name,
      formation: formationByCourse.get(c.id) ?? 'group',
      unitPrice: c.unit_price as number,
      sessions,
      remainingCount: remainingSessionCount(sessions),
    };
  });
}

// ============================================================
// 通塾可能日程の開講枠（決定15・§9-3）
// ============================================================

/**
 * 期間に重なる講習シフト設定（生徒版と講師版で共通流用の seasonal_shift_settings）を解決する。
 * 複数重なる場合は開始日が新しいものを優先する。無ければ null（開講枠なし扱い）。
 */
export async function resolveShiftSettingId(
  db: AnyDb,
  schoolId: string,
  startDate: string,
  endDate: string
): Promise<string | null> {
  const { data } = await db
    .from('seasonal_shift_settings')
    .select('id, start_date')
    .eq('school_id', schoolId)
    .eq('status', 'published')
    .lte('start_date', endDate)
    .gte('end_date', startDate)
    .order('start_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

/**
 * 指定した setting_id 配下の開講枠（is_open=true）を期間で絞って取得する。
 * 送信API側は setting_id を書き込み対象としても使うため、resolveShiftSettingId と分離して
 * 二重にシフト設定を引かなくて済むようにしている。
 */
export async function loadOpenSlotsForSetting(
  db: AnyDb,
  settingId: string,
  startDate: string,
  endDate: string
): Promise<ApplyAvailabilitySlot[]> {
  // 開講枠は (期間の日数 × 1日のコマ数) でスケールしうるため、1000行上限に備えてページングする。
  const rows = await fetchAllPaged<{ slot_date: string; time_slot: string }>((from, to) =>
    db
      .from('seasonal_shift_slot_settings')
      .select('slot_date, time_slot')
      .eq('setting_id', settingId)
      .eq('is_open', true)
      .gte('slot_date', startDate)
      .lte('slot_date', endDate)
      .order('slot_date', { ascending: true })
      .range(from, to)
  );
  return rows.map((r) => ({ date: r.slot_date, timeSlot: r.time_slot }));
}

/** 開講している枠（is_open=true）を期間で絞って取得する。開講枠が無ければ空配列。 */
export async function loadOpenAvailabilitySlots(
  db: AnyDb,
  schoolId: string,
  startDate: string,
  endDate: string
): Promise<ApplyAvailabilitySlot[]> {
  const settingId = await resolveShiftSettingId(db, schoolId, startDate, endDate);
  if (!settingId) return [];
  return loadOpenSlotsForSetting(db, settingId, startDate, endDate);
}

// ============================================================
// 既申込判定（決定30・53）
// ============================================================

/** 生徒×期間の申込（koushu_enrollments）が既に存在するか */
export async function hasExistingEnrollment(
  db: AnyDb,
  schoolId: string,
  season: string,
  studentId: string
): Promise<boolean> {
  const { data } = await db
    .from('koushu_enrollments')
    .select('id')
    .eq('school_id', schoolId)
    .eq('season', season)
    .eq('student_id', studentId)
    .limit(1)
    .maybeSingle();
  return !!data;
}

// ============================================================
// メイン: フォーム初期表示
// ============================================================

export async function loadKoushuApplyForm(
  params: ResolveParams
): Promise<
  | { ok: true; data: KoushuApplyFormData }
  | { ok: false; reason: 'not_found' | 'not_published' | 'revoked' }
> {
  const resolved = await resolveApplyContext(params);
  if (!resolved.ok) return resolved;
  const ctx = resolved.ctx;
  const { grade, gradeLabel, gradeCategory, startDate, endDate, weeks, priceTable, allow45 } =
    derivePeriodInfo(ctx);

  const proposals = await loadProposalLines(ctx, {
    startDate,
    endDate,
    weeks,
    gradeLabel,
    priceTable,
  });
  const proposedSubjectIds = new Set(proposals.map((p) => p.subjectId));

  const addableSubjects = await loadAddableSubjects(ctx, {
    gradeCategory,
    priceTable,
    gradeLabel,
    allow45,
    excludeSubjectIds: proposedSubjectIds,
  });

  const todayIso = new Date().toISOString().slice(0, 10);
  const courses = await loadCourses(ctx, { grade, startDate, endDate, todayIso });

  const availabilitySlots = await loadOpenAvailabilitySlots(
    ctx.db,
    ctx.schoolId,
    startDate,
    endDate
  );

  const alreadySubmitted = await hasExistingEnrollment(
    ctx.db,
    ctx.schoolId,
    ctx.season,
    ctx.studentId
  );

  const data: KoushuApplyFormData = {
    student: {
      id: ctx.student.id,
      name: `${ctx.student.last_name} ${ctx.student.first_name}`,
      grade,
      gradeLabel,
    },
    period: {
      schoolId: ctx.schoolId,
      season: ctx.season,
      year: ctx.year,
      label: `${ctx.year} ${SEASON_LABEL_JA[ctx.season] ?? ctx.season}講習`,
      startDate,
      endDate,
    },
    proposals,
    addableSubjects,
    courses,
    availabilitySlots,
    allow45,
    alreadySubmitted,
  };

  return { ok: true, data };
}
