import { supabase } from '../supabase';
import type { ProposalOrigin, ProposalSchool } from '@/lib/interview/targetProposals';
import type { AdmissionRule } from '@/lib/interview/privateAdmission';
import { toAdmissionRule } from './targetSchools';

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
     * ★ここは公立（挑戦・順当・安全）の候補だけ。私立は併願優遇の判定で並べ方が違うので、
     *   起点のまわりだけを getNearbyPrivateSchools で別に読む（都県で絞らず、行数も抑えられる）。
     *   登録済みの私立の志望校は fetchByIds で読むので、公立と同じ表にも並ぶ。
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

/* ============================================================
 * 近くの私立（④「志望校と提案」の私立（併願優遇））
 * ========================================================== */

/** 私立1校×コースぶん。判定に使う基準（最新年度）を添える */
export interface NearbyPrivateSchool {
  school: ProposalSchool;
  /** 男女で偏差値が違う共学校の両方（違わなければ空） */
  hensachiByGender: { 男子?: number; 女子?: number };
  /** 共学／男子／女子。冊子に書かれていなければ null */
  genderType: string | null;
  rules: AdmissionRule[];
}

interface RuleEmbed {
  id: string;
  high_school_id: string;
  kind: AdmissionRule['kind'];
  exam_label: string;
  public_only: boolean;
  applicant_scope: string | null;
  gender: '男子' | '女子' | null;
  strength: AdmissionRule['strength'];
  rule: unknown;
  checks: string[] | null;
  source_label: string;
  source_year: number;
  verified_at: string | null;
  sort_order: number;
}

interface PrivateRow extends SchoolWithStandards {
  gender_type: string | null;
  high_school_admission_rules: RuleEmbed[] | null;
}

/**
 * ★raw_text（冊子の原文）は読まない。行が千を超える量になり、表と比較には要らない
 *  （原文は根拠の「推薦・併願の条件」が志望校の分だけ読む）。
 * ★1本の文字列リテラルで書く（SELECT と同じ理由）。
 */
// prettier-ignore
const PRIVATE_SELECT = 'id,prefecture,establishment,school_name,course,category,lat,lon,access_lines,gender_type,high_school_standards(naishin,naishin_max,hensachi,source_year,source_label,verified_at,gender),high_school_admission_rules(id,high_school_id,kind,exam_label,public_only,applicant_scope,gender,strength,rule,checks,source_label,source_year,verified_at,sort_order)' as const;

/**
 * 教室の最寄り駅から直線 radiusKm の四角に入る私立を読む（都県では絞らない）。
 * ★都県で絞らないのは、永山校なら神奈川、清瀬校なら埼玉の私立も通える範囲に入るため。
 *   距離の正確な絞り込み（円）は呼び出し側（privateProposals.ts）で行う。
 * ★位置の無い私立（地名検索で当たらなかった14校）は出てこない。登録済みの志望校なら表には並ぶ。
 * ★永山校で約220行（基準は約1,100行を埋め込みで受ける）。上の行が1000を超えたら .range で分けること。
 */
export async function getNearbyPrivateSchools(
  origin: ProposalOrigin,
  radiusKm: number
): Promise<NearbyPrivateSchool[]> {
  const dLat = radiusKm / 111;
  const dLon = radiusKm / (111 * Math.cos((origin.lat * Math.PI) / 180));
  const { data, error } = await supabase
    .from('high_schools')
    .select(PRIVATE_SELECT)
    .eq('establishment', '私立')
    .gte('lat', origin.lat - dLat)
    .lte('lat', origin.lat + dLat)
    .gte('lon', origin.lon - dLon)
    .lte('lon', origin.lon + dLon)
    .limit(1000);
  if (error) throw new Error(`私立の高校マスタの取得に失敗しました: ${error.message}`);
  const rows = (data ?? []) as unknown as PrivateRow[];
  return rows.map((row) => {
    const embeds = row.high_school_admission_rules ?? [];
    const latestYear = Math.max(0, ...embeds.map((r) => r.source_year));
    const rules = embeds
      .filter((r) => r.source_year === latestYear)
      .map((r) =>
        toAdmissionRule({ ...r, raw_text: '' } as unknown as Parameters<typeof toAdmissionRule>[0])
      )
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const all = row.high_school_standards ?? [];
    const year = Math.max(0, ...all.map((s) => s.source_year));
    const byGender: { 男子?: number; 女子?: number } = {};
    for (const s of all)
      if (s.source_year === year && s.gender && s.hensachi != null) byGender[s.gender] = s.hensachi;
    return {
      school: toProposalSchool(row),
      hensachiByGender: byGender,
      genderType: row.gender_type,
      rules,
    };
  });
}
