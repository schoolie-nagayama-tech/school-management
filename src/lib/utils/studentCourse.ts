/**
 * 科目ごとのコース（PS1 / PS2 / キッズ）の表示ヘルパー。
 *
 * コースの実体は「指導比率(ratio) × 授業時間(duration_minutes)」の組で、
 * PS1/PS2/キッズという名前はその組に対する現場の呼び名でしかない。
 * ★DBにコース名は持たない（名前を持つと、比率・時間と二重に管理することになり、
 *   片方だけ変わってズレる。名前はここで毎回引き直す）。
 */

/** 指導比率。1=1対1（生徒1名で満席） / 2=1対2。 */
export type CourseRatio = 1 | 2;

/** コース上の授業時間(分)。null = 科目マスタの既定に従う（実質90分）。 */
export type CourseDuration = 45 | 90 | null;

/** コースの中身。 */
export interface StudentCourse {
  subjectId: string;
  ratio: CourseRatio;
  durationMinutes: CourseDuration;
  updatedAt?: string | null;
}

/**
 * 実効の授業時間。コースが時間を持っていなければ科目マスタの既定にフォールバックする。
 * null は「全コマ扱い」の意味で、既存の挙動と同じ（seatOccupancy がそう解釈する）。
 */
export function resolveDuration(
  courseDuration: CourseDuration | undefined,
  subjectDuration: number | null | undefined
): 45 | 90 | null {
  if (courseDuration === 45 || courseDuration === 90) return courseDuration;
  if (subjectDuration === 45) return 45;
  if (subjectDuration === 90) return 90;
  return null;
}

/** 45分授業か（半コマ占有の対象か）。 */
export function isHalfLesson(duration: 45 | 90 | null): boolean {
  return duration === 45;
}

/**
 * コース名。名前が無い組み合わせは内容をそのまま返す。
 * 1対1×45分は単価表には存在するが現場の呼び名が無いので、名前を作らずそのまま出す。
 */
export function courseLabel(ratio: CourseRatio, duration: CourseDuration): string {
  if (duration === 45) {
    return ratio === 2 ? 'キッズ' : '1対1・45分';
  }
  // duration が null（科目マスタ既定＝90分扱い）も90分コースとして名乗らせる。
  return ratio === 1 ? 'PS1' : 'PS2';
}

/** コースの中身の表示（「1対1・90分」）。 */
export function courseDetail(ratio: CourseRatio, duration: CourseDuration): string {
  const r = ratio === 1 ? '1対1' : '1対2';
  const d = duration === 45 ? '45分' : '90分';
  return `${r}・${d}`;
}

/** 「PS1（1対1・90分）」の形。名前が内容と同じときは重複させない。 */
export function courseFullLabel(ratio: CourseRatio, duration: CourseDuration): string {
  const label = courseLabel(ratio, duration);
  const detail = courseDetail(ratio, duration);
  return label === detail ? detail : `${label}（${detail}）`;
}

export interface CourseOption {
  ratio: CourseRatio;
  duration: CourseDuration;
  /** 教室長向けのコース名表示。 */
  label: string;
  /** 内容（講師にはこちらを主に出す）。 */
  detail: string;
}

const PS1: CourseOption = { ratio: 1, duration: 90, label: 'PS1', detail: '1対1・90分' };
const PS2: CourseOption = { ratio: 2, duration: 90, label: 'PS2', detail: '1対2・90分' };
const KIDS: CourseOption = { ratio: 2, duration: 45, label: 'キッズ', detail: '1対2・45分' };
const ONE_TO_ONE_45: CourseOption = {
  ratio: 1,
  duration: 45,
  label: '1対1・45分',
  detail: '1対1・45分',
};

/**
 * 選べるコース。45分は小1〜小4だけ（単価表の設定範囲に合わせる。
 * FAQ「45分は小1〜小4のみ設定できます」と同じ境界）。
 *
 * @param grade 学年(1-12)。未確定なら null を渡す（45分は出さない）。
 * @param includeUnnamed 1対1×45分も出すか。既存データの編集で必要になったときだけ true。
 */
export function courseOptionsForGrade(
  grade: number | null | undefined,
  includeUnnamed = false
): CourseOption[] {
  const allows45 = typeof grade === 'number' && grade >= 1 && grade <= 4;
  const options = [PS1, PS2];
  if (allows45) {
    options.push(KIDS);
    if (includeUnnamed) options.push(ONE_TO_ONE_45);
  }
  return options;
}

/**
 * コースが未設定の科目で、形態が選ばれないまま保存されようとしていないかの判定。
 *
 * ★読み込み失敗も「選べていない」に含める。
 *   失敗を空（＝未設定）と同じ扱いにして既定へ落とすと、
 *   本当は1対1の生徒を1対2で登録してしまう。止めるのが正しい。
 */
export function isCourseSelectionMissing(
  course: StudentCourse | null,
  loadError: boolean,
  ratio: CourseRatio | null
): boolean {
  if (loadError) return true;
  if (course) return false;
  return ratio === null;
}

/** 変更理由。理由を必須にすることで「片手間に変えられない」を担保する。 */
export const COURSE_REASON_CODES = [
  'initial',
  'correction',
  'course_change',
  'grade_change',
  'other',
] as const;
export type CourseReasonCode = (typeof COURSE_REASON_CODES)[number];

export const COURSE_REASON_LABELS: Record<CourseReasonCode, string> = {
  initial: '初回登録',
  correction: '登録の誤りを訂正する',
  course_change: '保護者の申し出でコースを変更する',
  grade_change: '学年の切り替え',
  other: 'その他',
};

/** 変更ダイアログで選ばせる理由（初回登録は自動で付くので選ばせない）。 */
export const COURSE_CHANGE_REASONS: CourseReasonCode[] = [
  'correction',
  'course_change',
  'grade_change',
  'other',
];
