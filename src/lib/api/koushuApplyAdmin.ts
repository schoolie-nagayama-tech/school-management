/**
 * 講習申込（Web申込）の管理側データアクセス。
 *
 * 正典仕様: docs/koushu-auto-allocation-spec.md §10-4（入口の管理UI）・§16-4（トークン）。
 *
 * 扱うもの:
 *   1. 公開設定 — course_prep_periods の apply_publish_start/end・apply_price_table・
 *      schedule_end_by_grade。書き込みは service role の /api/courses/prep（upsert_period）
 *      経由。あちらでロール（教室長以上）と jsonb の形を検証している。
 *   2. 申込トークン — koushu_apply_tokens。読み書きともブラウザクライアント（RLS が
 *      check_school_access で教室スコープを守る）。
 *   3. 申込状況 — koushu_enrollments に行があるか。「申込済み」の定義は公開ローダーの
 *      hasExistingEnrollment と同じテーブル・同じ条件に合わせてある（片方だけ変えないこと）。
 *
 * ★ 非公開の担保: このファイルは管理側専用。保護者に見える面の公開判定は
 *   lib/utils/koushuApplyPure.ts の isApplyPublished 一本で、ここでは行わない。
 */

import { supabase } from '@/lib/supabase';
import { fetchAllInChunks } from '@/lib/utils/supabasePaging';
import { callCoursePrepApi } from '@/lib/api/coursePrepApi';
import type { PriceTable } from '@/types/koushu-apply';
import type { SeasonType } from '@/types/database';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

// ============================================================
// 1. 公開設定（course_prep_periods）
// ============================================================

export interface KoushuApplyPeriodSettings {
  id: string | null;
  schoolId: string;
  season: SeasonType;
  year: number;
  scheduleStartDate: string | null;
  scheduleEndDate: string | null;
  applyPublishStart: string | null;
  applyPublishEnd: string | null;
  applyPriceTable: PriceTable | null;
  scheduleEndByGrade: Record<string, string> | null;
}

interface PeriodRow {
  id: string;
  school_id: string;
  season: SeasonType;
  year: number;
  schedule_start_date: string | null;
  schedule_end_date: string | null;
  apply_publish_start: string | null;
  apply_publish_end: string | null;
  apply_price_table: PriceTable | null;
  schedule_end_by_grade: Record<string, string> | null;
}

/**
 * 教室の講習期間を新しい順に取得する。
 * getKoushuPeriods（koushu-period.ts）と違い、schedule_start/end が未設定の期間も返す。
 * 「期間だけ先に作って後から日付を入れる」運用があるため、設定画面では隠さない。
 */
export async function getKoushuApplyPeriods(
  schoolId: string
): Promise<KoushuApplyPeriodSettings[]> {
  const { data, error } = await db
    .from('course_prep_periods')
    .select(
      'id, school_id, season, year, schedule_start_date, schedule_end_date, apply_publish_start, apply_publish_end, apply_price_table, schedule_end_by_grade'
    )
    .eq('school_id', schoolId)
    .order('year', { ascending: false })
    .order('season', { ascending: true });

  if (error) throw new Error(error.message || '講習期間の取得に失敗しました');

  return ((data ?? []) as PeriodRow[]).map((p) => ({
    id: p.id,
    schoolId: p.school_id,
    season: p.season,
    year: p.year,
    scheduleStartDate: p.schedule_start_date,
    scheduleEndDate: p.schedule_end_date,
    applyPublishStart: p.apply_publish_start,
    applyPublishEnd: p.apply_publish_end,
    applyPriceTable: p.apply_price_table,
    scheduleEndByGrade: p.schedule_end_by_grade,
  }));
}

/**
 * 公開設定を保存する。
 * 検証（ロール・単価表の形・公開期間の対称性）はサーバー側で行うので、
 * ここは素直に渡すだけにして「画面を通せば書ける」経路を作らない。
 */
export async function saveKoushuApplySettings(params: {
  schoolId: string;
  season: SeasonType;
  year: number;
  applyPublishStart: string | null;
  applyPublishEnd: string | null;
  applyPriceTable: PriceTable | null;
  scheduleEndByGrade: Record<string, string> | null;
}): Promise<void> {
  await callCoursePrepApi('upsert_period', params.schoolId, {
    season: params.season,
    year: params.year,
    applyPublishStart: params.applyPublishStart,
    applyPublishEnd: params.applyPublishEnd,
    applyPriceTable: params.applyPriceTable,
    scheduleEndByGrade: params.scheduleEndByGrade,
  });
}

// ============================================================
// 2. 申込トークン（koushu_apply_tokens）
// ============================================================

export interface KoushuApplyToken {
  token: string;
  studentId: string;
  season: string;
  year: number;
  createdAt: string;
  revokedAt: string | null;
}

/** 乱数トークン（32バイト＝64桁hex）。招待トークン generateToken と同方式 */
function generateApplyToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

interface TokenRow {
  token: string;
  student_id: string;
  season: string;
  year: number;
  created_at: string;
  revoked_at: string | null;
}

/**
 * 生徒ごとの「有効なトークン」を引く（失効済みは除外）。
 * 同じ生徒に複数の有効トークンがあれば最新（created_at 降順の先頭）を採用する。
 * 生徒数は教室規模で数百になるため .in() はチャンク分割する。
 */
export async function getActiveApplyTokens(
  schoolId: string,
  season: string,
  year: number,
  studentIds: string[]
): Promise<Map<string, KoushuApplyToken>> {
  const result = new Map<string, KoushuApplyToken>();
  if (studentIds.length === 0) return result;

  const rows = await fetchAllInChunks<TokenRow>(studentIds, (chunk, from, to) =>
    db
      .from('koushu_apply_tokens')
      .select('token, student_id, season, year, created_at, revoked_at')
      .eq('school_id', schoolId)
      .eq('season', season)
      .eq('year', year)
      .is('revoked_at', null)
      .in('student_id', chunk)
      .order('created_at', { ascending: false })
      .range(from, to)
  );

  for (const r of rows) {
    // 降順で取ってあるので、既に入っていれば古い方＝上書きしない
    if (result.has(r.student_id)) continue;
    result.set(r.student_id, {
      token: r.token,
      studentId: r.student_id,
      season: r.season,
      year: r.year,
      createdAt: r.created_at,
      revokedAt: r.revoked_at,
    });
  }
  return result;
}

/**
 * 生徒×講習期間のトークンを発行する（決定19・§16-4）。
 * 既に有効なトークンがあればそれを返す（同じ生徒に無用なURLを増やさない）。
 * 作り直したいときは revokeApplyToken を先に呼ぶ。
 */
export async function issueApplyToken(params: {
  schoolId: string;
  studentId: string;
  season: string;
  year: number;
  createdBy?: string | null;
}): Promise<KoushuApplyToken> {
  const existing = await getActiveApplyTokens(params.schoolId, params.season, params.year, [
    params.studentId,
  ]);
  const found = existing.get(params.studentId);
  if (found) return found;

  const token = generateApplyToken();
  const { data, error } = await db
    .from('koushu_apply_tokens')
    .insert({
      token,
      school_id: params.schoolId,
      student_id: params.studentId,
      season: params.season,
      year: params.year,
      created_by: params.createdBy ?? null,
    })
    .select('token, student_id, season, year, created_at, revoked_at')
    .single();

  if (error) throw new Error(error.message || '申込リンクの発行に失敗しました');

  const row = data as TokenRow;
  return {
    token: row.token,
    studentId: row.student_id,
    season: row.season,
    year: row.year,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  };
}

/**
 * トークンを失効させる（決定19: 再発行は新しい行を作る）。
 * 失効すると resolveApplyContext が reason:'revoked' → 404 になり、配布済みURLが使えなくなる。
 */
export async function revokeApplyToken(token: string): Promise<void> {
  const { error } = await db
    .from('koushu_apply_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('token', token)
    .is('revoked_at', null);
  if (error) throw new Error(error.message || '申込リンクの失効に失敗しました');
}

/** 申込URLを組み立てる（配布・QR用） */
export function buildApplyUrl(token: string, origin?: string): string {
  const base = origin ?? (typeof window !== 'undefined' ? window.location.origin : '');
  return `${base}/koushu-apply/${token}`;
}

// ============================================================
// 3. 申込状況（koushu_enrollments）
// ============================================================

/**
 * 申込済みの生徒IDの集合を返す。
 *
 * ★ 判定は「(school_id, season, student_id) の行が1つでもあるか」。
 *   koushu_enrollments に year 列が無いため season 単位になる点は既存の集計
 *   （getKoushuPlacementProgressByPeriod）と同じ制約で、意図的に揃えてある。
 */
export async function getAppliedStudentIds(
  schoolId: string,
  season: string,
  studentIds: string[]
): Promise<Set<string>> {
  const applied = new Set<string>();
  if (studentIds.length === 0) return applied;

  const rows = await fetchAllInChunks<{ student_id: string }>(studentIds, (chunk, from, to) =>
    db
      .from('koushu_enrollments')
      .select('student_id, id')
      .eq('school_id', schoolId)
      .eq('season', season)
      .in('student_id', chunk)
      .order('id', { ascending: true })
      .range(from, to)
  );

  for (const r of rows) applied.add(r.student_id);
  return applied;
}
