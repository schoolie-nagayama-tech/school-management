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
  /** 私立は男子表・女子表で別の行（NULL＝男女共通） */
  gender: '男子' | '女子' | null;
}

interface SchoolWithStandards {
  id: string;
  prefecture: string;
  establishment: '公立' | '私立' | '国立';
  school_name: string;
  course: string;
  category: string;
  lat: number | string | null;
  lon: number | string | null;
  access_lines: string[] | null;
  high_school_standards: StandardEmbed[] | null;
}

/**
 * ★1本の文字列リテラルで書く（`+` でつながない）。つなぐと型が string に広がり、
 *   supabase-js が select の文字列を型の上で読み解く処理が string 全体に対して走って、
 *   CI の tsc がメモリ不足で落ちた（2026-09-25）。
 */
// prettier-ignore
const SELECT = 'id,prefecture,establishment,school_name,course,category,lat,lon,access_lines,high_school_standards(naishin,naishin_max,hensachi,source_year,source_label,verified_at,gender)' as const;

/** numeric 列は文字列で返ってくることがある */
function num(v: number | string | null): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function toProposalSchool(row: SchoolWithStandards): ProposalSchool {
  // 最新年度のめやすを使う（targetSchools.ts の pickLatestStandards と同じ規則）
  const all = row.high_school_standards ?? [];
  const latestYear = Math.max(...all.map((s) => s.source_year));
  const latestRows = all.filter((s) => s.source_year === latestYear);
  const latest = latestRows.find((s) => s.gender == null) ?? latestRows[0];
  /**
   * ★私立の共学校は男子表・女子表で偏差値が違うことがある。違えば null（区分を付けない）。
   *   NEST は生徒の性別を持っていないので、どちらかに寄せると半分の生徒に違う表で区分を言う。
   */
  const values = Array.from(new Set(latestRows.map((s) => s.hensachi).filter((v) => v != null)));
  const hensachi =
    latest?.gender == null ? (latest?.hensachi ?? null) : values.length === 1 ? values[0] : null;
  return {
    id: row.id,
    prefecture: row.prefecture,
    establishment: row.establishment ?? '公立',
    schoolName: row.school_name,
    course: row.course,
    category: row.category,
    lat: num(row.lat),
    lon: num(row.lon),
    accessLines: row.access_lines ?? [],
    naishin: latest?.naishin ?? null,
    naishinMax: latest?.naishin_max ?? null,
    hensachi,
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

/** 問い合わせは1本ずつ関数に分け、戻り値の型をここで確定させる（呼び出し側で型を推論させない） */
async function fetchByPrefecture(prefecture: string): Promise<SchoolWithStandards[]> {
  const { data, error } = await supabase
    .from('high_schools')
    .select(SELECT)
    .eq('prefecture', prefecture)
    /**
     * ★提案の候補は公立だけ。私立・国立は所在地（緯度経度）がまだ無く、距離で絞れないので
     *   候補にできない（2026-09-25 時点。所在地を入れたらこの絞り込みを外す）。
     *   登録済みの私立の志望校は fetchByIds で読むので、表には並ぶ。
     * ★私立を足すと東京都だけで千行近くになり、1000行の上限にも掛かる（外すときは .range で分ける）。
     */
    .eq('establishment', '公立')
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
