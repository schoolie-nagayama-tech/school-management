import { supabase } from '../supabase';
import type { ProposalOrigin, ProposalSchool } from '@/lib/interview/targetProposals';

/**
 * ④「志望校と提案」の材料の読み込み。
 * ------------------------------------------------------------------
 * targetSchools.ts と同じく API Route を作らずブラウザから直に読む（高校マスタは全員が読める）。
 *
 * ★教室の都県の学校をまとめて読む（都立205校・神奈川県立199校）。1000行の上限には届かないが、
 *   都県を足すときは .range() で分けて読むこと（PostgREST は黙って切り捨てる）。
 * ★めやすは埋め込み（high_school_standards）で一緒に取る。.in('high_school_id', 200件) は
 *   URLが長くなりすぎるので使わない。
 */

interface StandardEmbed {
  naishin: number | null;
  naishin_max: number | null;
  hensachi: number | null;
  source_year: number;
  source_label: string | null;
  verified_at: string | null;
}

interface SchoolWithStandards {
  id: string;
  prefecture: string;
  school_name: string;
  course: string;
  category: string;
  lat: number | string | null;
  lon: number | string | null;
  access_lines: string[] | null;
  high_school_standards: StandardEmbed[] | null;
}

const SELECT =
  'id,prefecture,school_name,course,category,lat,lon,access_lines,' +
  'high_school_standards(naishin,naishin_max,hensachi,source_year,source_label,verified_at)';

/** numeric 列は文字列で返ってくることがある */
function num(v: number | string | null): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function toProposalSchool(row: SchoolWithStandards): ProposalSchool {
  // 最新年度のめやす1件だけを使う（targetSchools.ts の pickLatestStandard と同じ規則）
  const latest = (row.high_school_standards ?? [])
    .slice()
    .sort((a, b) => b.source_year - a.source_year)[0];
  return {
    id: row.id,
    prefecture: row.prefecture,
    schoolName: row.school_name,
    course: row.course,
    category: row.category,
    lat: num(row.lat),
    lon: num(row.lon),
    accessLines: row.access_lines ?? [],
    naishin: latest?.naishin ?? null,
    naishinMax: latest?.naishin_max ?? null,
    hensachi: latest?.hensachi ?? null,
    sourceLabel: latest?.source_label ?? '',
    verifiedAt: latest?.verified_at ?? null,
  };
}

/**
 * 提案の候補（教室の都県の学校すべて）と、登録済みの志望校（他県でも）を読む。
 * prefecture が null（都県未登録の教室）なら登録済みの志望校だけ。
 */
export async function getProposalSchools(
  prefecture: string | null,
  registeredIds: readonly string[]
): Promise<ProposalSchool[]> {
  const [area, registered] = await Promise.all([
    prefecture ? fetchByPrefecture(prefecture) : Promise.resolve([]),
    registeredIds.length > 0 ? fetchByIds(registeredIds) : Promise.resolve([]),
  ]);
  const byId = new Map<string, ProposalSchool>();
  for (const row of [...area, ...registered]) byId.set(row.id, toProposalSchool(row));
  return Array.from(byId.values());
}

/**
 * ★問い合わせは1本ずつ関数に分け、戻り値の型をここで確定させる。
 *   条件つきの Supabase の問い合わせ（埋め込み付き）を Promise.all の中で三項演算子に並べると、
 *   型の推論が膨らんで CI の tsc がメモリ不足で落ちた（2026-09-25）。
 */
async function fetchByPrefecture(prefecture: string): Promise<SchoolWithStandards[]> {
  const { data, error } = await supabase
    .from('high_schools')
    .select(SELECT)
    .eq('prefecture', prefecture)
    .limit(1000);
  if (error) throw new Error(`高校マスタの取得に失敗しました: ${error.message}`);
  return (data ?? []) as unknown as SchoolWithStandards[];
}

async function fetchByIds(ids: readonly string[]): Promise<SchoolWithStandards[]> {
  const { data, error } = await supabase
    .from('high_schools')
    .select(SELECT)
    .in('id', [...ids]);
  if (error) throw new Error(`高校マスタの取得に失敗しました: ${error.message}`);
  return (data ?? []) as unknown as SchoolWithStandards[];
}

/** 教室の最寄り駅（教室設定）。未設定なら null */
export async function getClassroomOrigin(schoolId: string): Promise<ProposalOrigin | null> {
  const { data, error } = await supabase
    .from('schools')
    .select('nearest_station,nearest_station_lat,nearest_station_lon')
    .eq('id', schoolId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as {
    nearest_station: string | null;
    nearest_station_lat: number | string | null;
    nearest_station_lon: number | string | null;
  };
  const lat = num(row.nearest_station_lat);
  const lon = num(row.nearest_station_lon);
  if (!row.nearest_station || lat == null || lon == null) return null;
  return { name: row.nearest_station, lat, lon };
}
