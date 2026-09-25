import { supabase } from '../supabase';
import type { Database } from '@/types/database';
import { REGION_LABEL, type Region } from '@/lib/interview/region';
import type { AdmissionRule, AdmissionRuleBody } from '@/lib/interview/privateAdmission';

/**
 * 志望校・高校マスタの読み書き。
 * ------------------------------------------------------------------
 * このリポジトリの流儀（src/lib/api/interviews.ts）に合わせ、API Route を作らず
 * ブラウザから Supabase を直叩きする。RLS（check_school_access）が教室スコープを守る。
 * 正典: docs/interview-script-ai-plan.md §4
 */

type HighSchoolRow = Database['public']['Tables']['high_schools']['Row'];
type HighSchoolStandardRow = Database['public']['Tables']['high_school_standards']['Row'];
type AdmissionRuleDbRow = Database['public']['Tables']['high_school_admission_rules']['Row'];
type TargetSchoolDbRow = Database['public']['Tables']['student_target_schools']['Row'];

/** 志望校1件がマスタに当たったときの合格めやす情報 */
export interface TargetSchoolMaster {
  prefecture: string;
  schoolName: string;
  // ★空文字＝普通科の本体（NULLではない）。UNIQUE制約の都合でDB側の既定値も空文字。
  course: string;
  category: string;
  /**
   * 設置区分。私立・国立は下の admissionRules で推薦・併願優遇を判定する。
   * ★以下の私立まわりの項目は省略可。省略＝公立（都立・神奈川県立だけだった頃の呼び出し元を壊さない）
   */
  establishment?: HighSchoolRow['establishment'];
  genderType?: HighSchoolRow['gender_type'];
  naishin: number | null;
  naishinMax: number | null;
  /**
   * 偏差値。★私立の共学校は男子表・女子表で値が違うことがある。そのときは null にして
   * hensachiByGender に両方を持つ（生徒の性別を NEST が持っていないので、どちらかに決めて
   * 差を出すと、女子に男子の偏差値で「あと3」と言ってしまう）。
   */
  hensachi: number | null;
  hensachiByGender?: { 男子?: number; 女子?: number };
  /** 私立・国立の推薦・併願優遇の基準（最新年度）。公立は空 */
  admissionRules?: AdmissionRule[];
  sourceLabel: string;
  // ★NULL＝紙の原本とまだ突き合わせていない（手起こしの数値）。画面ではその旨を示す。
  verifiedAt: string | null;
  /**
   * 沿線（複数可）。★最寄駅（primary_station）は持たせない。
   * 直線距離で選んでおり、乗り換えを無視した「最寄り」は保護者に言えない
   * （docs/data/README.md）。通学の話は沿線までにとどめる。
   */
  accessLines: string[];
}

/** 生徒1人の志望校1件（第1〜3志望のいずれか） */
export interface TargetSchoolRow {
  id: string;
  rank: number;
  schoolName: string;
  // ★null可。私立・国立・他県はマスタに無いので、自由記述のまま残る。
  highSchoolId: string | null;
  reason: string | null;
  updatedAt: string;
  // マスタに当たったときだけ入る。当たらなければ null（＝自由記述のまま）。
  master: TargetSchoolMaster | null;
}

/** 保存時に渡す1件分の入力 */
export interface TargetSchoolInput {
  rank: number;
  schoolName: string;
  highSchoolId: string | null;
  reason: string | null;
}

/** 高校マスタの検索結果（最新年度のめやすを添えたもの） */
export interface HighSchoolSearchResult {
  id: string;
  prefecture: string;
  schoolName: string;
  course: string;
  category: string;
  establishment: HighSchoolRow['establishment'];
  municipality: string | null;
  naishin: number | null;
  naishinMax: number | null;
  /** 男女で違えば null（hensachiByGender を見る）。TargetSchoolMaster と同じ理由 */
  hensachi: number | null;
  hensachiByGender: { 男子?: number; 女子?: number };
  sourceLabel: string;
  verifiedAt: string | null;
  /** 沿線。★最寄駅は持たせない（TargetSchoolMaster と同じ理由） */
  accessLines: string[];
}

/**
 * high_school_standards は年度ごとに複数行あるうち、source_year が最大の1件だけを使う。
 * DB側の .order() はモック環境やRLS越しでも並びを厳密に保証しないため、
 * 呼び出し側（JS）で最大年度を選び直す。
 */
/**
 * 最新年度の行をすべて返す。★私立は同じ年度に男子表・女子表の2行がある（gender 列）。
 * 都立・神奈川県立は gender=NULL の1行だけなので、従来どおり1件になる。
 */
function pickLatestStandards(
  standards: HighSchoolStandardRow[],
  highSchoolId: string
): HighSchoolStandardRow[] {
  const mine = standards.filter((s) => s.high_school_id === highSchoolId);
  if (mine.length === 0) return [];
  const latest = Math.max(...mine.map((s) => s.source_year));
  // 男女共通（NULL）を先頭に。代表の出典・確認日はその行から取る
  return mine
    .filter((s) => s.source_year === latest)
    .sort((a, b) => (a.gender == null ? -1 : 0) - (b.gender == null ? -1 : 0));
}

/**
 * 偏差値を1つにまとめる。男女で値が違えば null（hensachiByGender を見る）。
 * ★どちらかに寄せない。NEST は生徒の性別を持っていないので、寄せると半分の生徒に違う表の数字を言う。
 */
function hensachiOf(rows: HighSchoolStandardRow[]): {
  hensachi: number | null;
  byGender: { 男子?: number; 女子?: number };
} {
  const byGender: { 男子?: number; 女子?: number } = {};
  for (const r of rows) {
    if (r.gender && r.hensachi != null) byGender[r.gender] = r.hensachi;
  }
  const common = rows.find((r) => r.gender == null)?.hensachi;
  if (common != null) return { hensachi: common, byGender };
  const values = Array.from(new Set(Object.values(byGender)));
  return { hensachi: values.length === 1 ? values[0] : null, byGender };
}

/** DBの1行 → 判定ロジックの型。rule（jsonb）の中身は取込スクリプトで形を検めてある */
function toAdmissionRule(row: AdmissionRuleDbRow): AdmissionRule {
  const body = row.rule as unknown as Partial<AdmissionRuleBody>;
  return {
    id: row.id,
    kind: row.kind,
    examLabel: row.exam_label,
    publicOnly: row.public_only,
    applicantScope: row.applicant_scope,
    gender: row.gender,
    strength: row.strength,
    body: {
      any: body.any ?? [],
      gates: body.gates ?? [],
      bonus: body.bonus ?? null,
      no_criterion: body.no_criterion ?? null,
    },
    checks: row.checks ?? [],
    rawText: row.raw_text,
    sourceLabel: row.source_label,
    verifiedAt: row.verified_at,
    sortOrder: row.sort_order,
  };
}

/** 学校ごとに最新年度の基準だけを残す（古い年度は過去の面談の再現用に残してあるだけ） */
function latestRulesBySchool(rows: AdmissionRuleDbRow[]): Map<string, AdmissionRule[]> {
  const latestYear = new Map<string, number>();
  for (const r of rows) {
    latestYear.set(
      r.high_school_id,
      Math.max(latestYear.get(r.high_school_id) ?? 0, r.source_year)
    );
  }
  const out = new Map<string, AdmissionRule[]>();
  for (const r of rows) {
    if (r.source_year !== latestYear.get(r.high_school_id)) continue;
    const list = out.get(r.high_school_id) ?? [];
    list.push(toAdmissionRule(r));
    out.set(r.high_school_id, list);
  }
  for (const list of Array.from(out.values())) list.sort((a, b) => a.sortOrder - b.sortOrder);
  return out;
}

function toMaster(
  school: HighSchoolRow | undefined,
  standards: HighSchoolStandardRow[],
  rules: AdmissionRule[]
): TargetSchoolMaster | null {
  if (!school) return null;
  const standard = standards[0];
  const { hensachi, byGender } = hensachiOf(standards);
  return {
    prefecture: school.prefecture,
    schoolName: school.school_name,
    course: school.course,
    category: school.category,
    establishment: school.establishment ?? '公立',
    genderType: school.gender_type ?? null,
    naishin: standard?.naishin ?? null,
    naishinMax: standard?.naishin_max ?? null,
    hensachi,
    hensachiByGender: byGender,
    admissionRules: rules,
    sourceLabel: standard?.source_label ?? '',
    verifiedAt: standard?.verified_at ?? null,
    accessLines: school.access_lines ?? [],
  };
}

/**
 * 生徒の志望校（第1〜3志望）を rank 昇順で取得する。
 * high_schools・high_school_standards（最新年度）を結合し、必要内申・必要偏差値・
 * 出典ラベル・verified_at も一緒に返す。
 */
export async function getStudentTargetSchools(studentId: string): Promise<TargetSchoolRow[]> {
  const { data, error } = await supabase
    .from('student_target_schools')
    .select('*')
    .eq('student_id', studentId)
    .order('rank', { ascending: true });

  if (error) {
    throw new Error(`志望校の取得に失敗しました: ${error.message}`);
  }

  const rows = (data || []) as TargetSchoolDbRow[];
  const highSchoolIds = Array.from(
    new Set(rows.map((r) => r.high_school_id).filter((id): id is string => Boolean(id)))
  );

  let schoolsById = new Map<string, HighSchoolRow>();
  let standards: HighSchoolStandardRow[] = [];
  let rulesBySchool = new Map<string, AdmissionRule[]>();

  if (highSchoolIds.length > 0) {
    const [schoolsRes, standardsRes, rulesRes] = await Promise.all([
      supabase.from('high_schools').select('*').in('id', highSchoolIds),
      supabase
        .from('high_school_standards')
        .select('*')
        .in('high_school_id', highSchoolIds)
        .order('source_year', { ascending: false }),
      // 志望校は最大3校なので、基準の行数は多くても数十行（1000行の切り捨てには届かない）
      supabase.from('high_school_admission_rules').select('*').in('high_school_id', highSchoolIds),
    ]);

    if (schoolsRes.error) {
      throw new Error(`高校マスタの取得に失敗しました: ${schoolsRes.error.message}`);
    }
    if (standardsRes.error) {
      throw new Error(`合格めやすの取得に失敗しました: ${standardsRes.error.message}`);
    }
    if (rulesRes.error) {
      throw new Error(`私立の入試基準の取得に失敗しました: ${rulesRes.error.message}`);
    }

    // ★Promise.all で別テーブルのクエリを並べると要素の型が {} に潰れる。
    //   map の中で as を書くと s.id が引けないので、配列ごと先にキャストする。
    const schoolRows = (schoolsRes.data || []) as HighSchoolRow[];
    schoolsById = new Map(schoolRows.map((s) => [s.id, s]));
    standards = (standardsRes.data || []) as HighSchoolStandardRow[];
    rulesBySchool = latestRulesBySchool((rulesRes.data || []) as AdmissionRuleDbRow[]);
  }

  return rows.map((row) => {
    const school = row.high_school_id ? schoolsById.get(row.high_school_id) : undefined;
    const latest = row.high_school_id ? pickLatestStandards(standards, row.high_school_id) : [];
    const rules = row.high_school_id ? (rulesBySchool.get(row.high_school_id) ?? []) : [];
    return {
      id: row.id,
      rank: row.rank,
      schoolName: row.school_name,
      highSchoolId: row.high_school_id,
      reason: row.reason,
      updatedAt: row.updated_at,
      master: toMaster(school, latest, rules),
    };
  });
}

/**
 * 生徒の志望校（第1〜3志望）をまとめて保存する。
 *
 * - school_name が空の rank は削除する（＝その志望順位を未入力に戻す）。
 * - 残りは (student_id, rank) の UNIQUE 制約に対して upsert する。
 * - ★school_id はそのまま渡してよい。BEFOREトリガー trg_student_target_schools_sync_school が
 *   生徒の所属校で必ず上書きするため、呼び出し側で正確な値を用意する必要はない
 *   （ズレていてもトリガーが矯正する＝壊れない）。
 */
export async function saveStudentTargetSchools(
  studentId: string,
  schoolId: string,
  rows: TargetSchoolInput[]
): Promise<void> {
  const ranksToDelete = rows.filter((r) => !r.schoolName.trim()).map((r) => r.rank);
  const rowsToUpsert = rows
    .filter((r) => r.schoolName.trim())
    .map((r) => ({
      student_id: studentId,
      school_id: schoolId,
      rank: r.rank,
      school_name: r.schoolName.trim(),
      // ★マスタに当たらなくてもnullのまま保存できる（私立・国立・他県を塞がないため）
      high_school_id: r.highSchoolId,
      reason: r.reason?.trim() || null,
    }));

  if (ranksToDelete.length > 0) {
    const { error } = await supabase
      .from('student_target_schools')
      .delete()
      .eq('student_id', studentId)
      .in('rank', ranksToDelete);

    if (error) {
      throw new Error(`志望校の削除に失敗しました: ${error.message}`);
    }
  }

  if (rowsToUpsert.length > 0) {
    const { error } = await supabase
      .from('student_target_schools')
      .upsert(rowsToUpsert, { onConflict: 'student_id,rank' });

    if (error) {
      throw new Error(`志望校の保存に失敗しました: ${error.message}`);
    }
  }
}

/** 候補に見せる件数 */
const SEARCH_RESULT_LIMIT = 20;
/**
 * DBから取る件数。★教室の都県を先に並べるのは JS 側なので、20件ちょうどで取ると
 *   他県の学校で枠が埋まり、教室の都県の学校が候補から消える。多めに取ってから切る。
 */
const SEARCH_FETCH_LIMIT = 80;

/**
 * 高校マスタを学校名の部分一致で検索する（最大20件）。
 * 最新年度の内申・偏差値・所在地も一緒に返す。
 * ★course が空文字のもの（普通科の本体）を先に出す。「小平（外国語科）」より「小平」を上に、
 *   という面談での自然な並び（普通科が基本形）に合わせるため。
 * ★マスタは都立・神奈川県立と、私立・国立（東京・神奈川・埼玉ほか）。都県でも設置区分でも
 *   絞らない（東京の教室の生徒が神奈川県立を、神奈川の教室の生徒が都立を志望することもある）。
 *   代わりに、教室の都県（region）の学校を先に並べる。region が null（都県未登録の教室）なら
 *   従来どおり東京都が先。
 */
export async function searchHighSchools(
  query: string,
  region: Region | null = null
): Promise<HighSchoolSearchResult[]> {
  // ★ilike のパターンなので % と _ はワイルドカードとして効いてしまう。
  //   学校名に含まれることはないので、打ち間違いで全件マッチにならないよう落とす。
  const q = query.trim().replace(/[%_]/g, '');
  if (!q) return [];

  const { data: schools, error } = await supabase
    .from('high_schools')
    .select('*')
    .ilike('school_name', `%${q}%`)
    // ★普通科の本体（course=空文字）が枠から落ちないよう、DB側で course を先に並べる。
    //   「工科」で25件ヒットするような検索で、JS側だけで並べて実際に落ちた。
    // ★都県の並べ替えは DB ではしない。私立を入れて都県が7つ（東京・神奈川・埼玉・千葉・
    //   茨城・栃木・山梨）になり、文字コード順では「教室の都県を先に」が作れない。
    //   多めに取ってから JS で教室の都県を先に並べ、20件に切る。
    .order('course', { ascending: true })
    .order('school_name', { ascending: true })
    .limit(SEARCH_FETCH_LIMIT);

  if (error) {
    throw new Error(`高校マスタの検索に失敗しました: ${error.message}`);
  }

  const list = (schools || []) as HighSchoolRow[];
  if (list.length === 0) return [];

  const ids = list.map((s) => s.id);
  const { data: standardsData, error: standardsError } = await supabase
    .from('high_school_standards')
    .select('*')
    .in('high_school_id', ids)
    .order('source_year', { ascending: false });

  if (standardsError) {
    throw new Error(`合格めやすの取得に失敗しました: ${standardsError.message}`);
  }

  const standards = (standardsData || []) as HighSchoolStandardRow[];
  const homePrefecture = REGION_LABEL[region ?? 'tokyo'];

  return list
    .map((s) => {
      const latest = pickLatestStandards(standards, s.id);
      const standard = latest[0];
      const { hensachi, byGender } = hensachiOf(latest);
      return {
        id: s.id,
        prefecture: s.prefecture,
        schoolName: s.school_name,
        course: s.course,
        category: s.category,
        establishment: s.establishment ?? '公立',
        municipality: s.municipality,
        naishin: standard?.naishin ?? null,
        naishinMax: standard?.naishin_max ?? null,
        hensachi,
        hensachiByGender: byGender,
        sourceLabel: standard?.source_label ?? '',
        verifiedAt: standard?.verified_at ?? null,
        accessLines: s.access_lines ?? [],
      };
    })
    .sort((a, b) => {
      // 教室の都県の学校を先に（DB側の並びと同じ規則をJSでも保つ）
      const aHome = a.prefecture === homePrefecture ? 0 : 1;
      const bHome = b.prefecture === homePrefecture ? 0 : 1;
      if (aHome !== bHome) return aHome - bHome;
      // course 空文字（普通科の本体）を先に。空文字はどの非空文字より辞書順で小さいので
      // localeCompare でも自然にそうなるが、意図を明示するため比較を分ける。
      const aIsBase = a.course === '' ? 0 : 1;
      const bIsBase = b.course === '' ? 0 : 1;
      if (aIsBase !== bIsBase) return aIsBase - bIsBase;
      return a.schoolName.localeCompare(b.schoolName, 'ja');
    })
    .slice(0, SEARCH_RESULT_LIMIT);
}
