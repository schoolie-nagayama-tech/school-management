'use client';

/**
 * 授業登録フォームに置くコース欄（PS1 / PS2 / キッズ）。
 *
 * 設計の要点は「初回だけ聞く」こと。
 *  - その科目のコースが既にある → 読み取り専用で表示するだけ。選択肢を出さない。
 *  - まだ無い → 選ばせる。★既定値を置かない（未選択のあいだは保存させない）。
 *
 * 以前はここが常に選択可能で、選んだ値がコースに書き戻されていた。
 * 曜日を足すたび・版を切るたび・講師を変えるたびに選び直せたので、
 * 1対1の生徒でもどこか1回で1対2を選べばコースごと1対2になり、矛盾が残らなかった。
 * 選択肢そのものを消すのが、この部品の目的。
 *
 * 講師と教室長で出し方を変える:
 *  - 教室長以上 → コース名（PS1/PS2/キッズ）で選ばせる。そのままコースとして登録される。
 *  - 講師 → 生の形態（1対1・90分 など）で選ばせる。講師はコース名で考えていないため。
 *    講師が選んだ値は「その授業」にだけ入り、コースは作らない（間違ったコースが静かに増えると、
 *    以降の登録が全部それに従ってしまう）。未設定のまま登録された分は教室長のダッシュボードに出る。
 */

import { Lock } from 'lucide-react';
import {
  courseDetail,
  courseFullLabel,
  courseOptionsForGrade,
  type CourseDuration,
  type CourseRatio,
  type StudentCourse,
} from '@/lib/utils/studentCourse';

export interface CoursePickerProps {
  /** 設定済みのコース。null = 未設定。 */
  course: StudentCourse | null;
  /** コースの読み込み状態。 */
  loading?: boolean;
  /**
   * 読み込みに失敗したか。★失敗を「未設定」と同じ扱いにしない。
   * 失敗したまま選ばせると、本当は1対1の生徒を1対2で登録してしまう。
   */
  loadError?: boolean;
  /** 未設定のときに選択中の比率。null = 未選択。 */
  ratio: CourseRatio | null;
  /** 未設定のときに選択中の授業時間。 */
  durationMinutes: CourseDuration;
  onChange: (ratio: CourseRatio, durationMinutes: CourseDuration) => void;
  /** 生徒の学年（45分＝キッズを出す条件）。 */
  grade?: number | null;
  /** 教室長以上か。コース名で選ばせ、登録もできる。 */
  canManageCourse: boolean;
  /** 「コースを変更」を押したとき。教室長以上のときだけ渡す。 */
  onRequestChange?: () => void;
  /** 科目が未選択のときは何も出さない。 */
  subjectSelected: boolean;
  /**
   * いまこの行に保存されている比率・時間（編集時のみ渡す）。
   * コースと食い違っていたら、黙って直さずに「保存するとこう変わる」と見せる。
   * 直すこと自体は正しい（保護者に見えているのは実登録なので、直すのは登録のほう）が、
   * 講師を変えるつもりで開いた人に、比率まで変わることを気づかせないのは別の事故になる。
   */
  registeredRatio?: CourseRatio | null;
  registeredDuration?: CourseDuration;
  /** 説明文に出す対象（「山田 太郎さんの英語」）。 */
  studentName?: string | null;
  subjectName?: string | null;
}

export function CoursePicker({
  course,
  loading = false,
  loadError = false,
  ratio,
  durationMinutes,
  onChange,
  grade,
  canManageCourse,
  onRequestChange,
  subjectSelected,
  studentName,
  subjectName,
  registeredRatio,
  registeredDuration,
}: CoursePickerProps) {
  if (!subjectSelected) return null;

  const labelRow = (
    <label className="block text-xs font-medium text-[var(--paragraph)] mb-1">コース</label>
  );

  if (loading) {
    return (
      <div>
        {labelRow}
        <div className="text-xs text-[var(--paragraph-light)] px-3 py-2 border border-[var(--stroke)] rounded-md bg-[var(--surface)]">
          読み込み中…
        </div>
      </div>
    );
  }

  // 読み込み失敗。既定へフォールバックせず、そのことを見せて止める。
  if (loadError) {
    return (
      <div>
        {labelRow}
        <div className="text-xs text-red-700 px-3 py-2 border border-red-200 rounded-md bg-red-50">
          コースを読み込めませんでした。読み込めないまま登録すると、1対1の生徒を1対2で登録してしまう
          おそれがあるため、画面を開き直してください。
        </div>
      </div>
    );
  }

  // 設定済み。表示するだけで、ここでは変えられない。
  if (course) {
    const hasRegistered = registeredRatio === 1 || registeredRatio === 2;
    const mismatched =
      hasRegistered &&
      (registeredRatio !== course.ratio || (registeredDuration ?? null) !== course.durationMinutes);
    return (
      <div>
        {labelRow}
        <div className="flex items-center justify-between gap-2 px-3 py-2 border border-[var(--stroke)] rounded-md bg-[var(--surface)]">
          <span className="text-sm font-semibold text-[var(--headline)]">
            {courseFullLabel(course.ratio, course.durationMinutes)}
          </span>
          <span className="inline-flex items-center gap-1 text-[11px] text-[var(--paragraph-light)]">
            <Lock className="w-3 h-3" />
            この科目のコース
          </span>
        </div>
        <p className="mt-1 text-[11px] text-[var(--paragraph-light)]">
          {canManageCourse ? (
            <>
              授業の登録では変えられません。
              <button
                type="button"
                onClick={onRequestChange}
                className="text-[var(--primary)] underline hover:opacity-80"
              >
                コースを変更
              </button>
            </>
          ) : (
            '授業の登録では変えられません。変更は教室長に依頼してください'
          )}
        </p>
        {mismatched && registeredRatio && (
          <p className="mt-1 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5">
            この授業は <b>{courseDetail(registeredRatio, registeredDuration ?? null)}</b>{' '}
            で登録されています。保存すると{' '}
            <b>{courseDetail(course.ratio, course.durationMinutes)}</b> に直ります。
          </p>
        )}
      </div>
    );
  }

  // 未設定。ここが唯一の入力。
  const options = courseOptionsForGrade(grade);
  const selected = (o: { ratio: CourseRatio; duration: CourseDuration }) =>
    ratio === o.ratio && durationMinutes === o.duration;

  return (
    <div>
      <label className="flex items-center gap-2 text-xs font-medium text-[var(--paragraph)] mb-1">
        コース
        <span className="inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">
          未設定
        </span>
      </label>
      <p className="text-[11px] text-[var(--paragraph-light)] mb-2">
        {canManageCourse
          ? `${studentName ? `${studentName}さんの` : ''}${subjectName ?? 'この科目'}のコースを決めてください。以降の登録はこれに従います`
          : `${subjectName ?? 'この科目'}のコースが未設定です。この授業の形態を選んでください`}
      </p>
      <div className="flex gap-2 flex-wrap">
        {options.map((o) => (
          <button
            key={`${o.ratio}-${o.duration}`}
            type="button"
            onClick={() => onChange(o.ratio, o.duration)}
            className={`flex-1 min-w-[104px] px-3 py-2 rounded border text-sm transition-colors duration-150 ${
              selected(o)
                ? 'bg-[#1e3a5f] text-white border-[#1e3a5f]'
                : 'bg-white border-amber-300 border-dashed text-amber-700 hover:bg-amber-50'
            }`}
          >
            {canManageCourse ? (
              <>
                <span className="block font-semibold">{o.label}</span>
                <span
                  className={`block text-[10px] ${selected(o) ? 'text-[#c7d5e6]' : 'text-amber-600'}`}
                >
                  {o.detail}
                </span>
              </>
            ) : (
              <span className="block">{o.detail}</span>
            )}
          </button>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-[var(--paragraph-light)]">
        {canManageCourse
          ? 'この内容がこの科目のコースとして登録されます'
          : 'コースの設定は教室長が行います。この登録は「コース未設定」として教室長に通知されます'}
      </p>
    </div>
  );
}

// 「選べていないまま保存させない」判定は純関数として studentCourse.ts に置き、
// フォーム側はそこから直接 import する（判定を画面部品に閉じ込めるとテストできない）。
export { isCourseSelectionMissing } from '@/lib/utils/studentCourse';
