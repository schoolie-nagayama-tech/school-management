import 'server-only';
import { getPortalServiceClient } from '@/lib/mypage/serviceClient';
import { parseAccessStations, type SchoolMatch } from '@/lib/ai/schoolLookup';

/**
 * 高校マスタの読み込み（AIヘルプの2つ目の材料）。
 *
 * 引き当ての決まりは schoolLookup.ts（純関数）。ここはDBを読むところだけ。
 * faqIndex.ts と /api/ai/help の分け方に合わせてある。
 */

/**
 * ★PostgREST は未ページングの .select() を1000行で静かに切り捨てる。
 *   いまは 404校 / 609行だが、めやすは毎年1版ずつ積むので数年で超える。
 *   最初からページングして読む。
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

/** マスタ全件（学校×学科）に、最新年度のめやすを付けて返す */
export async function loadSchools(): Promise<SchoolMatch[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.schools;
  const supabase = getPortalServiceClient();

  const schools = await selectAll<{
    id: string;
    prefecture: string;
    school_name: string;
    course: string;
    category: string;
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
      .select(
        'id,prefecture,school_name,course,category,region,old_district,municipality,lat,lon,' +
          'primary_station,primary_lines,access_lines,access_stations'
      )
      .range(from, to)
  );

  const standards = await selectAll<{
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
    verified_at: string | null;
  }>((from, to) =>
    supabase
      .from('high_school_standards')
      .select(
        'high_school_id,source_year,source_label,total_score,naishin,naishin_max,hensachi,exam_type,gakuryoku_ratio,note,verified_at'
      )
      .range(from, to)
  );

  // ★同じ学校に複数年度の行がある。最大年度の1件だけを使う（targetSchools.ts と同じ決まり）。
  //   DB側の .order() に頼らず、ここで選び直す。
  const latest = new Map<string, (typeof standards)[number]>();
  for (const s of standards) {
    const cur = latest.get(s.high_school_id);
    if (!cur || s.source_year > cur.source_year) latest.set(s.high_school_id, s);
  }

  const out: SchoolMatch[] = schools.map((h) => {
    const s = latest.get(h.id);
    return {
      prefecture: h.prefecture,
      schoolName: h.school_name,
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
      hensachi: s?.hensachi ?? null,
      examType: s?.exam_type ?? null,
      gakuryokuRatio: s?.gakuryoku_ratio ?? null,
      note: s?.note ?? null,
      verifiedAt: s?.verified_at ?? null,
    };
  });
  cache = { at: Date.now(), schools: out };
  return out;
}

/** テスト用。モジュールキャッシュを捨てる */
export function clearSchoolCache() {
  cache = null;
}
