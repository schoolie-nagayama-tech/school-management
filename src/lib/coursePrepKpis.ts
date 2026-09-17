import type {
  CourseProgressItem,
  StudentCourseProgress,
  CoursePrepPeriod,
  CoursePrepTrack,
  SeasonType,
  Student,
} from '@/types/database';
import { GRADE_LABELS } from '@/types/database';
import type { AutoValues } from '@/lib/api/courseProgress';

/**
 * 講習進捗ダッシュボードのKPI算出ロジックを純関数として切り出したモジュール。
 *
 * 目的: 単一校ダッシュボード（CourseProgressDashboard）と、複数校横断サマリー
 * （AllSchoolsOverview）で「提案コマ・取得コマ・取得率・申込件数・期日超過」の
 * 数え方を1か所に集約し、教室をまたいでも定義がブレないようにする。
 *
 * 注意: 進捗項目（列）は教室ごとに別管理のため、どの項目を「提案増コマ列／決定増コマ列」
 * とみなすかの判定（findItemByKeywords ベース）も校ごとに行う必要がある。
 */

// 項目名キーワードで柔軟に該当列を探す。完全一致を優先し、無ければ部分一致。
export function findItemByKeywords(
  items: CourseProgressItem[],
  keywords: string[]
): CourseProgressItem | undefined {
  for (const kw of keywords) {
    const exact = items.find((i) => i.name === kw);
    if (exact) return exact;
  }
  for (const kw of keywords) {
    const partial = items.find((i) => i.name.includes(kw));
    if (partial) return partial;
  }
  return undefined;
}

/** 提案（提示）増コマ列を特定する。proposed_extra 自動列を最優先で採用。 */
export function findProposedKomaItem(items: CourseProgressItem[]): CourseProgressItem | undefined {
  return (
    items.find((i) => i.auto_source === 'proposed_extra') ??
    findItemByKeywords(items, ['提案増コマ', '提示増コマ', '提案増コマ回数', '提示増コマ回数'])
  );
}

/**
 * 決定（取得）増コマ列を特定する。applied_extra 自動列を最優先で採用。
 * 提案増コマ列と同一列を選ばないよう、除外対象を渡せる。
 */
export function findDecidedKomaItem(
  items: CourseProgressItem[],
  excludeItemId?: string
): CourseProgressItem | undefined {
  return (
    items.find((i) => i.id !== excludeItemId && i.auto_source === 'applied_extra') ??
    items.find(
      (i) =>
        i.id !== excludeItemId &&
        i.column_type === 'number' &&
        (i.name.includes('増コマ回数') || i.name === '増コマ回数決定')
    ) ??
    findItemByKeywords(
      items.filter((i) => i.id !== excludeItemId),
      ['増コマ回数決定', '増コマ決定', '決定コマ']
    )
  );
}

/**
 * 生徒ごとの「決定（取得）増コマ」を算出して返す。
 *
 * 進捗ダッシュボードの studentDecidedKoma と同じ定義:
 * - applied_extra 自動列: max(0, applied_total - course_sessions)
 * - 手入力の「増コマ回数」列: number_value（未入力は0）
 *
 * 請求への同期など、ダッシュボード外からも同じ数え方を使うために切り出している。
 * students は id さえあればよいので軽量なオブジェクト配列でも渡せる。
 */
export function computeDecidedKomaByStudent(
  students: { id: string }[],
  items: CourseProgressItem[],
  progressData: StudentCourseProgress[],
  autoValues: AutoValues
): Record<string, number> {
  const proposedKomaItem = findProposedKomaItem(items);
  const decidedKomaItem = findDecidedKomaItem(items, proposedKomaItem?.id);

  const vals: Record<string, number> = {};
  for (const s of students) {
    if (!decidedKomaItem) {
      vals[s.id] = 0;
      continue;
    }
    if (decidedKomaItem.auto_source === 'applied_extra') {
      const sv = autoValues?.[s.id];
      const appliedTotal = sv?.applied_total ?? 0;
      const courseSessions = sv?.course_sessions ?? 0;
      vals[s.id] = Math.max(0, appliedTotal - courseSessions);
    } else {
      const d = progressData.find((p) => p.student_id === s.id && p.item_id === decidedKomaItem.id);
      vals[s.id] = d?.number_value ?? 0;
    }
  }
  return vals;
}

/**
 * 「進路調査回収」は中3(grade=9)のみが対象の項目。
 * 非中3で明示的な入力が無いセルは「対象外」とみなす（表では自動でグレー表示になる）。
 *
 * この判定は 進捗表・KPI集計（期日超過）・アラート の3か所で使うため、ここを唯一の定義とする。
 * 片方だけに実装すると「表では対象外なのにアラートには残る」といった食い違いが起きる。
 *
 * hasRecord = その生徒×項目に進捗レコードが存在するか。
 * 明示的にクリックして入力された場合は上書きとみなし、対象外にはしない。
 */
export function isGrade9OnlyCoursePrepItem(item: { name: string; column_type: string }): boolean {
  return item.column_type === 'check' && item.name.includes('進路調査');
}

export function isCoursePrepOutOfScope(
  item: { name: string; column_type: string },
  grade: number | null | undefined,
  hasRecord: boolean
): boolean {
  return isGrade9OnlyCoursePrepItem(item) && (grade ?? 0) !== 9 && !hasRecord;
}

/** YYYY-MM-DD 形式かどうか。壊れた値を最大値の比較に混ぜないための門番。 */
function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * 生徒に効く「区分」を返す。当てはめ → 既定の学年 → null（共通）の順で解決する。
 *
 * なぜ区分か: 冬期は生徒によって講習期間が違う。学年別終了日で表そうとしたが、
 * 同じ小6でも受験する子としない子がいるので学年では割れない。中3のように学年で
 * ほぼ決まるものは既定の学年で一括、小6の受験生のような例外は個別に当てはめる。
 *
 * assignments は studentId → trackId のマップ。**キーが無い＝未指定**で、
 * 値が null なのは「既定の学年による当てはめを打ち消して共通に戻す」明示指定。
 * この2つは意味が違うので、必ず has() で分岐する（null 判定だけにしない）。
 */
export function resolveStudentTrack(
  tracks: CoursePrepTrack[],
  assignments: Map<string, string | null>,
  studentId: string,
  grade: number | null | undefined
): CoursePrepTrack | null {
  return createTrackResolver(tracks, assignments).resolve(studentId, grade);
}

/**
 * 区分の解決を1回だけ組み立てて使い回す形。
 *
 * ★ 生徒ごとに resolveStudentTrack を呼ぶと、そのたびに区分の配列コピーと並べ替えが走る。
 *   進捗表は200名規模で毎レンダー解決するので、人数ぶんの並べ替えがそのまま「もっさり」になる。
 *   並べ替えと「学年 → 既定の区分」の対応表を先に作り、生徒ごとの解決を O(1) にする。
 *
 * 解決の順序は resolveStudentTrack と同じ（個別の当てはめ → 既定の学年 → null）。
 */
export function createTrackResolver(
  tracks: CoursePrepTrack[],
  assignments: Map<string, string | null>
): { resolve: (studentId: string, grade: number | null | undefined) => CoursePrepTrack | null } {
  const byId = new Map<string, CoursePrepTrack>();
  for (const t of tracks) byId.set(t.id, t);

  // 複数の区分が同じ学年を既定にしていたら sort_order の若い方を採る。
  // 並び順が同じときは名前で決める（名前は期の中で一意なので必ず1つに決まる）。
  const ordered = tracks
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'ja'));
  const byGrade = new Map<number, CoursePrepTrack>();
  for (const t of ordered) {
    for (const g of t.default_grades ?? []) {
      if (!byGrade.has(g)) byGrade.set(g, t);
    }
  }

  return {
    resolve(studentId, grade) {
      // 1. 個別の当てはめが最優先。共通に戻す明示指定（null）もここで効く。
      if (assignments.has(studentId)) {
        const trackId = assignments.get(studentId) ?? null;
        if (trackId === null) return null;
        return byId.get(trackId) ?? null;
      }
      // 2. 既定の学年。
      if (grade == null) return null;
      return byGrade.get(grade) ?? null;
    },
  };
}

/**
 * 生徒の講習期間を返す。区分があればその期間、無ければ共通の期間。
 * 区分の開始日が空なら共通の開始日を使う（開始日は共通のままの区分が大半のため）。
 */
export function resolveTrackWindow(
  track: CoursePrepTrack | null,
  commonStart: string | null,
  commonEnd: string | null
): { start: string | null; end: string | null } {
  if (!track) return { start: commonStart, end: commonEnd };
  return {
    start: track.schedule_start_date || commonStart,
    end: track.schedule_end_date || commonEnd,
  };
}

/**
 * 表に出す短縮名。short_name があればそれ、無ければ name の先頭2文字。
 * 進捗表の学年セル横に出す想定なので、長い名前をそのまま出さない。
 */
export function trackShortLabel(track: CoursePrepTrack): string {
  const short = (track.short_name ?? '').trim();
  if (short) return short;
  // tsconfig に target 指定が無く ES5 扱いのため slice ではなく Array.from で文字単位に切る
  return Array.from(track.name ?? '')
    .slice(0, 2)
    .join('');
}

/**
 * 期の「最後の区分が終わる日」を返す。共通の終了日と全区分の終了日の最大。
 *
 * なぜ必要か: 冬期は区分で講習期間が違う（中3や受験生だけ入試直前まで続く）。共通の終了日
 * だけを見て「期が終わった」と判定すると、まだ講習中の生徒がいるのに確定保存してしまい、
 * そのあとに入る取得コマが実績から丸ごと落ちる。終了判定は必ず一番遅い区分に合わせる。
 *
 * 値は 'YYYY-MM-DD' 固定長なので辞書順比較で日付順になる。書式が違う値は無視する。
 * （Phase 6 の schedule_end_by_grade は Phase 8 で区分に置き換えたので、もう見ない。）
 */
export function resolvePeriodLastEndDate(
  period: { schedule_end_date: string | null } | null | undefined,
  // 終了日しか見ないので、cron のように終了日だけを引いた軽い行でも渡せる形にしてある
  tracks?: Pick<CoursePrepTrack, 'schedule_end_date'>[] | null
): string | null {
  let last: string | null =
    period && isIsoDate(period.schedule_end_date) ? period.schedule_end_date : null;
  for (const track of tracks ?? []) {
    const value = track?.schedule_end_date;
    if (!isIsoDate(value)) continue;
    if (last === null || value > last) last = value;
  }
  return last;
}

/** 期を一意に指すキー。course_prep_* 系はどのテーブルも (教室 × 期 × 年) で1件を指す。 */
export function coursePrepPeriodKey(p: {
  school_id: string;
  season: string;
  year: number;
}): string {
  return `${p.school_id}:${p.season}:${p.year}`;
}

/** 期の絞り込み結果。項目や進捗を引き当てるのに要る3点だけを持つ。 */
export interface CoursePrepPeriodScope {
  school_id: string;
  season: SeasonType;
  year: number;
}

/**
 * 「まだ終わっていない期」を選ぶ。講習準備アラートが対象にする期の唯一の定義。
 *
 * なぜ月で決めないか: 講習の準備は講習期間より前に走る。夏期2026（7/06〜8/31）の
 * 準備項目の期日は 5/13〜7/01 に並ぶ。つまり9月に動いているのは冬期の準備であって、
 * 「9月だから夏期」と月で決めると常に1期ぶんずれる。年も new Date().getFullYear() で
 * 決めてはいけない。冬期2026 は year=2026 のまま 2027-01 まで続くので、1月になった
 * 途端に year=2027 と一致しなくなり、冬期のアラートが黙って全部消える。
 *
 * 判定は「終わったか」だけを見る。まだ先の期が混ざっても、期日が遠ければ呼び出し側の
 * 警告日数（warnDays）の窓で落ちるので、未来側の上限は設けない。
 *
 * 除外する期:
 *  - 確定保存（course_prep_snapshots）済み。進捗表が「当時の姿」に凍結されていて、
 *    今から進捗を埋めても確定データは変わらない＝消しようがないアラートになるため。
 *  - 最後の区分の終了日が今日より前。終了日は resolvePeriodLastEndDate で解決するので、
 *    受験生だけ2月まで続く冬期のような期は、受験生が終わるまで開いたままになる。
 *
 * 終了日がまったく引けない期（共通の終了日も区分も未設定）は「開いている」側に倒す。
 * アラートを黙って消すより、出しすぎて人が気づけるほうが害が小さい。
 *
 * 期は重なる。冬期2026 は高校受験の区分が 2027-02-28 まで続き、その頃には春期2027 の
 * 準備期日が動き始めている。片方だけを選ぶともう片方の未完了が見えなくなるので、
 * 重なっている期は全部返す。
 *
 * @param todayIso JSTの今日（'YYYY-MM-DD'）。固定長なので辞書順比較で日付順になる。
 */
export function selectOpenCoursePrepPeriods(
  periods: {
    school_id: string;
    season: SeasonType;
    year: number;
    schedule_end_date: string | null;
  }[],
  tracks: { school_id: string; season: SeasonType; year: number; schedule_end_date: string }[],
  snapshots: { school_id: string; season: SeasonType; year: number }[],
  todayIso: string
): CoursePrepPeriodScope[] {
  const tracksByPeriod = new Map<string, { schedule_end_date: string }[]>();
  for (const t of tracks) {
    const key = coursePrepPeriodKey(t);
    const arr = tracksByPeriod.get(key);
    if (arr) arr.push(t);
    else tracksByPeriod.set(key, [t]);
  }

  const closedKeys = new Set(snapshots.map(coursePrepPeriodKey));

  const open: CoursePrepPeriodScope[] = [];
  for (const p of periods) {
    const key = coursePrepPeriodKey(p);
    if (closedKeys.has(key)) continue;
    // 終了日しか見ないので、区分は終了日だけの軽い行で渡せる
    const lastEnd = resolvePeriodLastEndDate(p, tracksByPeriod.get(key) ?? []);
    if (lastEnd !== null && lastEnd < todayIso) continue;
    open.push({ school_id: p.school_id, season: p.season, year: p.year });
  }
  return open;
}

/** 期の並び順。同じ年の中では 春 → 夏 → 冬 の順に進む。 */
const SEASON_ORDER: Record<SeasonType, number> = { spring: 1, summer: 2, winter: 3 };

/**
 * 「いま準備が動いている期」を1つだけ選ぶ。Googleカレンダーの面談予約を進捗に
 * 書き戻すときの、唯一の書き込み先の定義。
 *
 * アラート（selectOpenCoursePrepPeriods）は重なっている期を全部返してよいが、同期は
 * 書き込み先を1つに決めないといけないので、開いている期からさらに1つに絞る。
 *
 * 選び方: 準備は講習期間より前に走るので、★これから始まる期のうち、いちばん早く始まる期
 * を採る。9月なら夏期（7/06〜8/31）はもう終わっていて、次に始まるのは冬期（12/07〜）なので
 * 冬期。2月なら冬期は高校受験の区分が2/28まで残って「開いて」はいるが、次に始まるのは
 * 春期2027 なので春期を採る（冬期の面談は11〜12月にとうに終わっている）。
 * 開いている期がすべて開始日を過ぎているときだけ、いちばん早く終わる期に倒す。
 *
 * ★予約日（イベントの開始日）から期を決めるやり方は採らない。面談は講習期間より前に行うので、
 * 予約日はどの期の講習期間にも入らない（夏期2026 は期間 7/06〜8/31 に対して面談申込の期日が
 * 5/30）。日付を期間に当てはめると、どの期にも当たらないか、たまたま重なった前の期に当たる。
 *
 * 開始日は共通の開始日だけを見る。区分（course_prep_tracks）は終わりを後ろへ伸ばすもので、
 * 始まりは共通のままというのが運用の前提（退塾者を表に残す判定も共通の開始日だけを見る）。
 *
 * 完全ではない。冬期の講習中（12月下旬）にすでに春期の期が作ってあると、春期を選んでしまう。
 * 書き込み先の期は呼び出し側が利用者にそのまま見せるので（「2027年春期の面談申込を…」）、
 * 外したときに人が気づける形にしてある。
 *
 * 開始日も終了日も引けない期は、いつの期か分からないので最後に回す。それでも並びが決まらない
 * ときは (年, 期) の暦順で決める（呼び出すたびに書き込み先が変わらないように）。
 *
 * @param todayIso JSTの今日（'YYYY-MM-DD'）。固定長なので辞書順比較で日付順になる。
 * @returns 書き込み先の期。開いている期が1つも無ければ null
 */
export function selectCoursePrepSyncTargetPeriod(
  periods: {
    school_id: string;
    season: SeasonType;
    year: number;
    schedule_start_date: string | null;
    schedule_end_date: string | null;
  }[],
  tracks: { school_id: string; season: SeasonType; year: number; schedule_end_date: string }[],
  snapshots: { school_id: string; season: SeasonType; year: number }[],
  todayIso: string
): CoursePrepPeriodScope | null {
  const open = selectOpenCoursePrepPeriods(periods, tracks, snapshots, todayIso);
  if (open.length === 0) return null;

  const tracksByPeriod = new Map<string, { schedule_end_date: string }[]>();
  for (const t of tracks) {
    const key = coursePrepPeriodKey(t);
    const arr = tracksByPeriod.get(key);
    if (arr) arr.push(t);
    else tracksByPeriod.set(key, [t]);
  }

  // 並べ替えに使う日付を期ごとに1回だけ解決しておく
  const windowByKey = new Map<string, { start: string | null; end: string | null }>();
  for (const p of periods) {
    const key = coursePrepPeriodKey(p);
    windowByKey.set(key, {
      start: isIsoDate(p.schedule_start_date) ? p.schedule_start_date : null,
      end: resolvePeriodLastEndDate(p, tracksByPeriod.get(key) ?? []),
    });
  }

  const ranked = open.map((scope) => {
    const w = windowByKey.get(coursePrepPeriodKey(scope)) ?? { start: null, end: null };
    // これから始まる期を先に見る（0）。すでに始まっている・開始日が無い期は後回し（1）。
    const upcoming = w.start !== null && w.start > todayIso;
    return { scope, upcoming, sortKey: upcoming ? w.start : w.end };
  });

  ranked.sort((a, b) => {
    if (a.upcoming !== b.upcoming) return a.upcoming ? -1 : 1;
    // これから始まる期どうしは開始が早い順、それ以外は終わりが早い順。
    // 日付が無いものは比べようがないので後ろへ送る。
    if (a.sortKey !== b.sortKey) {
      if (a.sortKey === null) return 1;
      if (b.sortKey === null) return -1;
      return a.sortKey < b.sortKey ? -1 : 1;
    }
    if (a.scope.year !== b.scope.year) return a.scope.year - b.scope.year;
    return SEASON_ORDER[a.scope.season] - SEASON_ORDER[b.scope.season];
  });

  return ranked[0].scope;
}

/**
 * 進捗項目のうち「面談の予約が取れたら完了にしてよい」ものかを判定する。
 *
 * 項目名は教室・期ごとに違い、本番では「面談申込」（夏期）と「面談申込・面談日決定」（冬期）の
 * 2通りが使われている。どちらも部分一致「面談申込」で拾える。
 *
 * ★ただし「面談申込未提出者へ電話」も同じ部分一致に引っかかる。これは申込が取れていない生徒に
 * 電話をかける作業で、予約が取れた生徒については完了ではなく「対象外」になる項目なので、
 * カレンダー同期で完了にしてはいけない。同じ理由で「未申込」を含む名前も外す。
 */
export function isInterviewBookingProgressItem(item: { name: string }): boolean {
  const name = item.name ?? '';
  if (!name.includes('面談申込')) return false;
  return !name.includes('未提出') && !name.includes('未申込');
}

/**
 * 生徒1人分の「通常授業の回数（course_sessions）」を数える。
 *
 * dayMap: 曜日(0=日〜6=土) → その曜日のコマ数（通塾パターンの本数）
 * dayCounts: 期間内に各曜日が何回出現するか。期間日付が無いときは null を渡す。
 *
 * dayCounts が null（開始日か終了日が未設定）のときは、期間が引けないのでパターン本数の
 * 合計をそのまま返す従来の挙動に倒す。
 */
export function computeCourseSessionsForStudent(
  dayMap: Record<number, number> | undefined,
  dayCounts: Record<number, number> | null
): number {
  const map = dayMap ?? {};
  if (!dayCounts) {
    return Object.values(map).reduce((sum, count) => sum + count, 0);
  }
  let sessions = 0;
  for (const [day, patternCount] of Object.entries(map)) {
    sessions += patternCount * (dayCounts[Number(day)] || 0);
  }
  return sessions;
}

export interface SchoolKpis {
  studentCount: number;
  // 提案増コマ合計 / 取得（決定）増コマ合計
  totalProposed: number;
  totalDecided: number;
  // 取得率（取得 ÷ 提案）。提案0は0扱い。
  acquisitionRate: number;
  // 提案を作成済みの生徒数（提示増コマ>0）
  proposedStudentCount: number;
  // 申込済みの生徒数（決定コマの記録あり。0コマ確定も含む）
  decidedStudentCount: number;
  // 期日を過ぎても未完了のチェック項目×生徒 の件数
  overdueCount: number;
  // 期間設定の目標・予算コマ（カードでの達成度表示用）
  targetKoma: number;
  budgetKoma: number;
}

/**
 * 1校分のKPIを算出する。CourseProgressDashboard の各 useMemo と同じ数え方に揃えてある。
 * today は 'YYYY-MM-DD'（期日超過判定の基準日）。
 */
export function computeSchoolKpis(
  students: Student[],
  items: CourseProgressItem[],
  progressData: StudentCourseProgress[],
  autoValues: AutoValues,
  period: CoursePrepPeriod | null,
  today: string
): SchoolKpis {
  // --- 提案増コマ列・決定（取得）増コマ列の特定（finder は共通関数に集約） ---
  const proposedKomaItem = findProposedKomaItem(items);
  const decidedKomaItem = findDecidedKomaItem(items, proposedKomaItem?.id);

  // 生徒ごと 提案増コマ
  const proposedByStudent: Record<string, number> = {};
  for (const s of students) {
    if (proposedKomaItem) {
      if (proposedKomaItem.auto_source === 'proposed_extra') {
        const sv = autoValues?.[s.id];
        const proposalTotal = sv?.proposal_total ?? 0;
        const courseSessions = sv?.course_sessions ?? 0;
        proposedByStudent[s.id] = Math.max(0, proposalTotal - courseSessions);
      } else {
        const d = progressData.find(
          (p) => p.student_id === s.id && p.item_id === proposedKomaItem.id
        );
        proposedByStudent[s.id] = d?.number_value ?? 0;
      }
    } else {
      proposedByStudent[s.id] = 0;
    }
  }

  // 生徒ごと 決定（取得）増コマ と「記録があるか（申込済判定）」
  const decidedByStudent: Record<string, number> = {};
  const decidedHasValue: Record<string, boolean> = {};
  for (const s of students) {
    if (!decidedKomaItem) {
      decidedByStudent[s.id] = 0;
      decidedHasValue[s.id] = false;
      continue;
    }
    if (decidedKomaItem.auto_source === 'applied_extra') {
      const sv = autoValues?.[s.id];
      const appliedTotal = sv?.applied_total ?? 0;
      const courseSessions = sv?.course_sessions ?? 0;
      const val = Math.max(0, appliedTotal - courseSessions);
      decidedByStudent[s.id] = val;
      // 自動列は明示的な0入力の概念が無いので「値>0」を記録ありとみなす
      decidedHasValue[s.id] = val > 0;
    } else {
      const d = progressData.find((p) => p.student_id === s.id && p.item_id === decidedKomaItem.id);
      decidedByStudent[s.id] = d?.number_value ?? 0;
      // 手入力列は number_value が記録されていれば（0でも）申込済とみなす
      decidedHasValue[s.id] = d?.number_value != null;
    }
  }

  const totalProposed = Object.values(proposedByStudent).reduce((a, b) => a + b, 0);
  const totalDecided = Object.values(decidedByStudent).reduce((a, b) => a + b, 0);
  const proposedStudentCount = Object.values(proposedByStudent).filter((v) => v > 0).length;
  const decidedStudentCount = Object.values(decidedHasValue).filter(Boolean).length;

  // --- 期日超過（チェック項目で期日を過ぎ未完了の生徒件数）---
  let overdueCount = 0;
  const overdueItems = items.filter(
    (i) => i.column_type === 'check' && i.deadline && i.deadline < today && !i.is_hidden
  );
  for (const item of overdueItems) {
    for (const s of students) {
      const d = progressData.find((p) => p.student_id === s.id && p.item_id === item.id);
      // 非中3の進路調査など「対象外」セルは期日超過に数えない
      if (isCoursePrepOutOfScope(item, s.grade, !!d)) continue;
      if (!d || (d.status !== 'completed' && d.status !== 'not_applicable')) {
        overdueCount++;
      }
    }
  }

  return {
    studentCount: students.length,
    totalProposed,
    totalDecided,
    acquisitionRate: totalProposed > 0 ? totalDecided / totalProposed : 0,
    proposedStudentCount,
    decidedStudentCount,
    overdueCount,
    targetKoma: period?.target_koma || 0,
    budgetKoma: period?.budget_koma || 0,
  };
}

// =============================================
// 単一校ダッシュボード集計（画面ダッシュボードと印刷レポートで共用）
// ---------------------------------------------
// CourseProgressDashboard に散らばっていた集計（提案/取得コマ・取得率・面談件数・
// 学校種別分析・教科別 提案vs取得・期日超過）をこの純関数に集約する。
// 目的: 画面ダッシュボードと A3 レポートで「同じ数字」を保証し、定義のブレを防ぐこと。
// ここを唯一の集計ロジックとし、両者ともこの戻り値を描画するだけにする。
// =============================================

export type SchoolCategory = 'elementary' | 'middle' | 'high' | 'other';

export function getSchoolCategory(grade: number): SchoolCategory {
  if (grade >= 1 && grade <= 6) return 'elementary';
  if (grade >= 7 && grade <= 9) return 'middle';
  if (grade >= 10 && grade <= 12) return 'high';
  return 'other';
}

export const CATEGORY_LABELS: Record<SchoolCategory, string> = {
  elementary: '小学生',
  middle: '中学生',
  high: '高校生',
  other: 'その他',
};

// 教科別分析の表示順。ここに無い教科は末尾に日本語名順で並ぶ。
export const SUBJECT_ORDER = [
  '国語',
  '算数',
  '数学',
  '英語',
  '英検',
  '理科',
  '社会',
  '理社',
  '小論文',
  '作文',
];

export interface GradeBreakdownRow {
  grade: number;
  label: string;
  count: number;
  proposed: number;
  decided: number;
  avgProposed: number;
  avgDecided: number;
  rate: number;
}

export interface CategoryAnalysisRow {
  category: SchoolCategory;
  label: string;
  studentCount: number;
  proposedCount: number;
  decidedCount: number;
  totalProposed: number;
  totalDecided: number;
  acquisitionRate: number;
  avgProposed: number;
  avgDecided: number;
  gradeBreakdown: GradeBreakdownRow[];
}

export interface SubjectRow {
  subject: string;
  proposed: number;
  applied: number;
  rate: number;
}

export interface DashboardAggregates {
  // どの列を提案/決定増コマとして採用したか（画面の警告表示にも使う）
  proposedKomaItem?: CourseProgressItem;
  decidedKomaItem?: CourseProgressItem;
  studentInterviewItem?: CourseProgressItem;
  parentInterviewItem?: CourseProgressItem;
  // 生徒ごとの提案/取得コマと申込済み判定
  studentProposedKoma: Record<string, number>;
  studentDecidedKoma: Record<string, number>;
  studentDecidedHasValue: Record<string, boolean>;
  // メイン指標
  totalProposed: number;
  totalDecided: number;
  actualRate: number; // 取得 ÷ 提案（小数）
  actualRatePct: number;
  proposedStudentCount: number;
  decidedStudentCount: number;
  studentInterviewCount: number;
  parentInterviewCount: number;
  // 期間設定由来の指標
  expectedRate: number; // 0-100
  expectedKoma: number;
  budgetKoma: number;
  targetKoma: number;
  budgetRate: number;
  targetRate: number;
  // 期日超過
  overdueItems: CourseProgressItem[];
  overdueList: { item: CourseProgressItem; student: Student }[];
  // 内訳
  categoryAnalysis: CategoryAnalysisRow[];
  subjectAnalysis: {
    overall: SubjectRow[];
    elementary: SubjectRow[];
    middle: SubjectRow[];
    high: SubjectRow[];
  };
}

// 面談実施チェックの完了人数を数える
function countCompleted(
  students: Student[],
  progressData: StudentCourseProgress[],
  item?: CourseProgressItem
): number {
  if (!item) return 0;
  let count = 0;
  for (const s of students) {
    const d = progressData.find((p) => p.student_id === s.id && p.item_id === item.id);
    if (d?.status === 'completed') count++;
  }
  return count;
}

/**
 * 単一校ダッシュボードの全集計を算出する純関数。
 * CourseProgressDashboard の各 useMemo と完全に同じ数え方に揃えてある。
 * today は 'YYYY-MM-DD'（期日超過判定の基準日）。
 */
export function computeDashboardAggregates(
  students: Student[],
  items: CourseProgressItem[],
  progressData: StudentCourseProgress[],
  autoValues: AutoValues,
  period: CoursePrepPeriod | null,
  today: string
): DashboardAggregates {
  const proposedKomaItem = findProposedKomaItem(items);
  const decidedKomaItem = findDecidedKomaItem(items, proposedKomaItem?.id);
  const studentInterviewItem = findItemByKeywords(items, ['生徒面談実施', '生徒面談']);
  const parentInterviewItem = findItemByKeywords(items, [
    '父母面談実施',
    '保護者面談実施',
    '父母面談',
    '保護者面談',
  ]);

  // --- 生徒ごと 提案増コマ ---
  const studentProposedKoma: Record<string, number> = {};
  for (const s of students) {
    if (proposedKomaItem) {
      if (proposedKomaItem.auto_source === 'proposed_extra') {
        const sv = autoValues?.[s.id];
        const proposalTotal = sv?.proposal_total ?? 0;
        const courseSessions = sv?.course_sessions ?? 0;
        studentProposedKoma[s.id] = Math.max(0, proposalTotal - courseSessions);
      } else {
        const d = progressData.find(
          (p) => p.student_id === s.id && p.item_id === proposedKomaItem.id
        );
        studentProposedKoma[s.id] = d?.number_value ?? 0;
      }
    } else {
      studentProposedKoma[s.id] = 0;
    }
  }

  // --- 生徒ごと 決定（取得）増コマ と 申込済み判定 ---
  const studentDecidedKoma: Record<string, number> = {};
  const studentDecidedHasValue: Record<string, boolean> = {};
  for (const s of students) {
    if (!decidedKomaItem) {
      studentDecidedKoma[s.id] = 0;
      studentDecidedHasValue[s.id] = false;
      continue;
    }
    if (decidedKomaItem.auto_source === 'applied_extra') {
      const sv = autoValues?.[s.id];
      const appliedTotal = sv?.applied_total ?? 0;
      const courseSessions = sv?.course_sessions ?? 0;
      const val = Math.max(0, appliedTotal - courseSessions);
      studentDecidedKoma[s.id] = val;
      studentDecidedHasValue[s.id] = val > 0;
    } else {
      const d = progressData.find((p) => p.student_id === s.id && p.item_id === decidedKomaItem.id);
      studentDecidedKoma[s.id] = d?.number_value ?? 0;
      studentDecidedHasValue[s.id] = d?.number_value != null;
    }
  }

  const totalProposed = Object.values(studentProposedKoma).reduce((a, b) => a + b, 0);
  const totalDecided = Object.values(studentDecidedKoma).reduce((a, b) => a + b, 0);
  const actualRate = totalProposed > 0 ? totalDecided / totalProposed : 0;
  const proposedStudentCount = Object.values(studentProposedKoma).filter((v) => v > 0).length;
  const decidedStudentCount = Object.values(studentDecidedHasValue).filter(Boolean).length;

  const budgetKoma = period?.budget_koma || 0;
  const targetKoma = period?.target_koma || 0;
  const expectedRate = period?.expected_rate || 0;
  const expectedKoma = Math.round(totalProposed * (expectedRate / 100));
  const budgetRate = budgetKoma > 0 ? totalDecided / budgetKoma : 0;
  const targetRate = targetKoma > 0 ? totalDecided / targetKoma : 0;

  // --- 期日超過タスク ---
  const overdueItems = items.filter(
    (i) => i.column_type === 'check' && i.deadline && i.deadline < today && !i.is_hidden
  );
  const overdueList: { item: CourseProgressItem; student: Student }[] = [];
  for (const item of overdueItems) {
    for (const s of students) {
      const d = progressData.find((p) => p.student_id === s.id && p.item_id === item.id);
      // 非中3の進路調査など「対象外」セルは期日超過に数えない
      if (isCoursePrepOutOfScope(item, s.grade, !!d)) continue;
      if (!d || (d.status !== 'completed' && d.status !== 'not_applicable')) {
        overdueList.push({ item, student: s });
      }
    }
  }

  // --- 学校種別分析（小中高 + 学年内訳）---
  const categoryAnalysis: CategoryAnalysisRow[] = (
    ['elementary', 'middle', 'high'] as SchoolCategory[]
  )
    .map((cat) => {
      const catStudents = students.filter((s) => getSchoolCategory(s.grade) === cat);
      if (catStudents.length === 0) return null;
      const catProposed = catStudents.reduce((sum, s) => sum + (studentProposedKoma[s.id] ?? 0), 0);
      const catDecided = catStudents.reduce((sum, s) => sum + (studentDecidedKoma[s.id] ?? 0), 0);
      const catProposedCount = catStudents.filter(
        (s) => (studentProposedKoma[s.id] ?? 0) > 0
      ).length;
      const catDecidedCount = catStudents.filter((s) => studentDecidedHasValue[s.id]).length;

      const gradeBreakdown: GradeBreakdownRow[] = [];
      const gradeSet = Array.from(new Set(catStudents.map((s) => s.grade))).sort((a, b) => a - b);
      for (const grade of gradeSet) {
        const gs = catStudents.filter((s) => s.grade === grade);
        const gProposed = gs.reduce((sum, s) => sum + (studentProposedKoma[s.id] ?? 0), 0);
        const gDecided = gs.reduce((sum, s) => sum + (studentDecidedKoma[s.id] ?? 0), 0);
        gradeBreakdown.push({
          grade,
          label: GRADE_LABELS[grade] || `${grade}`,
          count: gs.length,
          proposed: gProposed,
          decided: gDecided,
          avgProposed: gs.length > 0 ? gProposed / gs.length : 0,
          avgDecided: gs.length > 0 ? gDecided / gs.length : 0,
          rate: gProposed > 0 ? gDecided / gProposed : 0,
        });
      }

      return {
        category: cat,
        label: CATEGORY_LABELS[cat],
        studentCount: catStudents.length,
        proposedCount: catProposedCount,
        decidedCount: catDecidedCount,
        totalProposed: catProposed,
        totalDecided: catDecided,
        acquisitionRate: catProposed > 0 ? catDecided / catProposed : 0,
        avgProposed: catStudents.length > 0 ? catProposed / catStudents.length : 0,
        avgDecided: catStudents.length > 0 ? catDecided / catStudents.length : 0,
        gradeBreakdown,
      };
    })
    .filter((x): x is CategoryAnalysisRow => x !== null);

  // --- 教科別 提案 vs 取得（提案書ベース）---
  type Agg = Record<string, { proposed: number; applied: number }>;
  const overallAgg: Agg = {};
  const byCat: Record<'elementary' | 'middle' | 'high', Agg> = {
    elementary: {},
    middle: {},
    high: {},
  };
  const add = (agg: Agg, subject: string, proposed: number, applied: number) => {
    if (!agg[subject]) agg[subject] = { proposed: 0, applied: 0 };
    agg[subject].proposed += proposed;
    agg[subject].applied += applied;
  };
  for (const s of students) {
    const sv = autoValues?.[s.id];
    if (!sv) continue;
    const cat = getSchoolCategory(s.grade);
    const subjects = Array.from(
      new Set([
        ...Object.keys(sv.subject_proposals ?? {}),
        ...Object.keys(sv.subject_applied ?? {}),
      ])
    );
    for (const subject of subjects) {
      const p = sv.subject_proposals?.[subject] ?? 0;
      const a = sv.subject_applied?.[subject] ?? 0;
      add(overallAgg, subject, p, a);
      if (cat === 'elementary' || cat === 'middle' || cat === 'high')
        add(byCat[cat], subject, p, a);
    }
  }
  const toRows = (agg: Agg): SubjectRow[] =>
    Object.entries(agg)
      .map(([subject, v]) => ({
        subject,
        proposed: v.proposed,
        applied: v.applied,
        rate: v.proposed > 0 ? v.applied / v.proposed : 0,
      }))
      .sort((a, b) => {
        const ia = SUBJECT_ORDER.indexOf(a.subject);
        const ib = SUBJECT_ORDER.indexOf(b.subject);
        if (ia !== -1 && ib !== -1) return ia - ib;
        if (ia !== -1) return -1;
        if (ib !== -1) return 1;
        return a.subject.localeCompare(b.subject, 'ja');
      });

  return {
    proposedKomaItem,
    decidedKomaItem,
    studentInterviewItem,
    parentInterviewItem,
    studentProposedKoma,
    studentDecidedKoma,
    studentDecidedHasValue,
    totalProposed,
    totalDecided,
    actualRate,
    actualRatePct: Math.round(actualRate * 100),
    proposedStudentCount,
    decidedStudentCount,
    studentInterviewCount: countCompleted(students, progressData, studentInterviewItem),
    parentInterviewCount: countCompleted(students, progressData, parentInterviewItem),
    expectedRate,
    expectedKoma,
    budgetKoma,
    targetKoma,
    budgetRate,
    targetRate,
    overdueItems,
    overdueList,
    categoryAnalysis,
    subjectAnalysis: {
      overall: toRows(overallAgg),
      elementary: toRows(byCat.elementary),
      middle: toRows(byCat.middle),
      high: toRows(byCat.high),
    },
  };
}
