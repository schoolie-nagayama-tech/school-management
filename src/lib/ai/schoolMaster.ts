import 'server-only';
import { getPortalServiceClient } from '@/lib/mypage/serviceClient';
import { latestRulesBySchool } from '@/lib/interview/admissionRuleRow';
import {
  parseAccessStations,
  summarizeHensachi,
  toAdmissionTexts,
  type Establishment,
  type SchoolMatch,
} from '@/lib/ai/schoolLookup';

/**
 * 高校マスタの読み込み（AIヘルプの2つ目の材料）。
 *
 * 引き当ての決まりは schoolLookup.ts（純関数）。ここはDBを読むところだけ。
 * faqIndex.ts と /api/ai/help の分け方に合わせてある。
 */

/**
 * ★PostgREST は未ページングの .select() を1000行で静かに切り捨てる。
 *   私立・国立を入れて high_schools だけで1,255行、めやすは約1,900行、推薦・併願の基準は約3,100行。
 *   どれも1000行を超えるので、必ずページングして読む。
 * ★ページングするときは必ず .order('id') を付ける（リポジトリ内のページングの書き方と同じ）。
 *   並びを決めずに range で切ると、ページの境目で行が重なったり抜けたりしうる。
 */
async function selectAll<T>(
  build: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

let cache: { at: number; schools: SchoolMatch[] } | null = null;
/** マスタは年に数回しか変わらない。リクエストごとに引き直さない */
const TTL_MS = 10 * 60 * 1000;

/** マスタ全件（学校×学科・コース）に、最新年度のめやすと推薦・併願優遇の基準を付けて返す */
export async function loadSchools(): Promise<SchoolMatch[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.schools;
  const supabase = getPortalServiceClient();

  // ★2026-09-25 までは公立だけに絞っていた（プロンプトと引き当てが都立・県立の前提だったため）。
  //   2026-09-28 に私立・国立の読み方（区分・コース・男女別偏差値・基準）を足したので絞り込みを外した。
  const schools = await selectAll<{
    id: string;
    prefecture: string;
    school_name: string;
    course: string;
    category: string;
    establishment: Establishment | null;
    gender_type: string | null;
    region: string | null;
    old_district: number | null;
    municipality: string | null;
    lat: number | null;
    lon: number | null;
    primary_station: string | null;
    primary_lines: string[] | null;
    access_lines: string[] | null;
    access_stations: string[] | null;
  }>((from, to) =>
    supabase
      .from('high_schools')
      // ★列名は1本の文字列リテラルで書く。`+` でつなぐと supabase-js の型が列を読めず
      //   GenericStringError になり、CIの型チェックで落ちる。
      .select(
        'id,prefecture,school_name,course,category,establishment,gender_type,region,old_district,municipality,lat,lon,primary_station,primary_lines,access_lines,access_stations'
      )
      .order('id', { ascending: true })
      .range(from, to)
  );

  const standards = await selectAll<{
    id: string;
    high_school_id: string;
    source_year: number;
    source_label: string;
    total_score: number | null;
    naishin: number | null;
    naishin_max: number | null;
    hensachi: number | null;
    exam_type: string | null;
    gakuryoku_ratio: string | null;
    note: string | null;
    gender: '男子' | '女子' | null;
    verified_at: string | null;
  }>((from, to) =>
    supabase
      .from('high_school_standards')
      .select(
        'id,high_school_id,source_year,source_label,total_score,naishin,naishin_max,hensachi,exam_type,gakuryoku_ratio,note,gender,verified_at'
      )
      .order('id', { ascending: true })
      .range(from, to)
  );

  // ★raw_text（冊子の原文）は選ばない。全校ぶん読むと重く、AIには文にした基準だけを渡すため。
  const ruleRows = await selectAll<{
    id: string;
    high_school_id: string;
    source_year: number;
    source_label: string;
    exam_label: string;
    kind: '推薦' | '単願' | '併願';
    public_only: boolean;
    applicant_scope: string | null;
    gender: '男子' | '女子' | null;
    strength: '出願資格' | '出願基準' | '目安' | null;
    rule: Record<string, unknown>;
    checks: string[];
    sort_order: number;
    verified_at: string | null;
  }>((from, to) =>
    supabase
      .from('high_school_admission_rules')
      .select(
        'id,high_school_id,source_year,source_label,exam_label,kind,public_only,applicant_scope,gender,strength,rule,checks,sort_order,verified_at'
      )
      .order('id', { ascending: true })
      .range(from, to)
  );
  // 学校ごとに最新年度の基準だけ（面談ワークスペースと同じ決まり。targetSchools.ts）
  const rulesBySchool = latestRulesBySchool(ruleRows);

  // ★同じ学校に複数年度の行がある。最大年度の行だけを使う（targetSchools.ts と同じ決まり）。
  //   DB側の .order() に頼らず、ここで選び直す。
  // ★私立は同じ年度に男子表・女子表の2行がある（gender 列）。最大年度の行はすべて残し、
  //   偏差値は summarizeHensachi でまとめる。代表の出典は男女共通の行（無ければ先頭）から取る。
  const latestYear = new Map<string, number>();
  for (const s of standards) {
    latestYear.set(
      s.high_school_id,
      Math.max(latestYear.get(s.high_school_id) ?? 0, s.source_year)
    );
  }
  const latest = new Map<string, (typeof standards)[number][]>();
  for (const s of standards) {
    if (s.source_year !== latestYear.get(s.high_school_id)) continue;
    const list = latest.get(s.high_school_id) ?? [];
    list.push(s);
    latest.set(s.high_school_id, list);
  }

  const out: SchoolMatch[] = schools.map((h) => {
    const rows = latest.get(h.id) ?? [];
    const s = rows.find((r) => r.gender == null) ?? rows[0];
    const { hensachi, byGender } = summarizeHensachi(rows);
    return {
      prefecture: h.prefecture,
      schoolName: h.school_name,
      // ★列を足す前の環境では null になりうるので公立に寄せる（targetSchools.ts と同じ）
      establishment: h.establishment ?? '公立',
      genderType: h.gender_type,
      course: h.course,
      category: h.category,
      region: h.region,
      oldDistrict: h.old_district,
      municipality: h.municipality,
      lat: h.lat,
      lon: h.lon,
      primaryStation: h.primary_station,
      primaryLines: h.primary_lines,
      accessLines: h.access_lines,
      accessStations: parseAccessStations(h.access_stations),
      sourceLabel: s?.source_label ?? '',
      sourceYear: s?.source_year ?? 0,
      totalScore: s?.total_score ?? null,
      naishin: s?.naishin ?? null,
      naishinMax: s?.naishin_max ?? null,
      hensachi,
      hensachiByGender: byGender,
      examType: s?.exam_type ?? null,
      gakuryokuRatio: s?.gakuryoku_ratio ?? null,
      note: s?.note ?? null,
      // ★男女別の行は確認日も行ごと。1行でも紙と未突合なら、未突合として扱う（言い過ぎない側に倒す）
      verifiedAt:
        rows.length > 0 && rows.every((r) => r.verified_at) ? (s?.verified_at ?? null) : null,
      admission: toAdmissionTexts(rulesBySchool.get(h.id) ?? []),
    };
  });
  cache = { at: Date.now(), schools: out };
  return out;
}

/** テスト用。モジュールキャッシュを捨てる */
export function clearSchoolCache() {
  cache = null;
}
