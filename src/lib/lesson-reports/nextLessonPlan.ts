/**
 * 機能D「次回の予定」の判定規則（純関数）
 *
 * 正典: docs/lesson-report-next-plan.md §1。
 *
 * なぜ既定を自動にするか（本番データの裏付け）:
 *   progress_sessions.handover の実データに「次回：進行表通り」「次回、進行表通り」という
 *   手打ちが多数ある。この機能はその入力をそのまま置き換えるものなので、
 *   **講師が何もしなくても正しい状態になる**（＝進行表の続きが自動で入る）ことが要件。
 *
 * ★ 純関数としてここに切り出す理由:
 *   「どこまで進んだか」の判定がフォームのイベントハンドラに散ると、教材セットごとに
 *   微妙に違う結果が出る。規則をこの1ファイルに閉じ込め、テスト
 *   （src/__tests__/lib/lessonReportNextPlan.test.ts）で境界を固定する。
 *
 * ★ 「自動か手動か」はDBに持たない:
 *   保存されるのは最終的に画面に出ている単元IDだけ（保存時点の確定値が正典）。
 *   表示のたびに再計算すると、後から進行表が進んだときに過去の報告書の
 *   「次回の予定」が書き換わってしまう。
 */

/**
 * 判定に必要なぶんだけを取り出した進行表グリッドの1行。
 *
 * ★ 並びはカリキュラム順であること（グリッドに出ている順）。
 *   「今日やった単元より後ろ」を配列の位置で判定するため、並びが崩れると結果も崩れる。
 */
export interface NextPlanRow {
  curriculumItemId: number;
  /** 1〜3回目の指導日が入っているか（index 0 = 1回目）。 */
  lessonFilled: readonly [boolean, boolean, boolean];
}

/**
 * 進行表グリッドの行（CurriculumItemWithProgress と構造的に同じ形）から
 * 判定用の行を作る。
 *
 * 構造的な型で受けるのは、テストで巨大な DB 型を組み立てずに済ませるため
 * （呼び出し側は CurriculumItemWithProgress[] をそのまま渡せる）。
 */
export interface NextPlanGridRowLike {
  id: number;
  progress?: {
    lessons?: Array<{ lesson_number: number; lesson_date?: string | null }> | null;
  } | null;
}

export function toNextPlanRows(rows: readonly NextPlanGridRowLike[]): NextPlanRow[] {
  return rows.map((row) => {
    const lessons = row.progress?.lessons ?? [];
    const filledAt = (n: 1 | 2 | 3) =>
      lessons.some((l) => l.lesson_number === n && !!l.lesson_date && l.lesson_date !== '');
    return {
      curriculumItemId: row.id,
      lessonFilled: [filledAt(1), filledAt(2), filledAt(3)] as const,
    };
  });
}

/** 1〜3回目がすべて埋まっている（＝この単元はもう終わっている）か。 */
function isFinished(row: NextPlanRow): boolean {
  return row.lessonFilled.every(Boolean);
}

/**
 * 「進行表通り」の次回の予定を求める。
 *
 * 規則:
 *   - 今日やった単元（taughtItemIds）のうち **カリキュラム順で一番後ろ** の位置を求め、
 *     その次の行から探して「まだ3回とも埋まっていない先頭の1単元」を返す。
 *   - 今日の選択が空なら先頭から探す（＝まだ終わっていない先頭の単元）。
 *   - 該当なし（最終単元まで終わっている等）なら空配列。
 *
 * 返すのは常に0件か1件。複数になるのは講師が手で選び直したときだけ。
 *
 * ★ lessonFilled は「保存済みの指導日」であって今日の選択は含まない。
 *   今日やった単元の後ろから探すので、今日の選択を埋まり扱いしなくても
 *   「今日やった単元がまた次回の予定に出る」ことはない。
 */
export function computeAutoNextPlan(
  rows: readonly NextPlanRow[],
  taughtItemIds: readonly number[]
): number[] {
  const taught = new Set(taughtItemIds);
  // 今日やった単元の最後尾（見つからなければ -1 ＝ 先頭から探す）
  let lastTaughtIndex = -1;
  for (let i = 0; i < rows.length; i++) {
    if (taught.has(rows[i].curriculumItemId)) lastTaughtIndex = i;
  }
  for (let i = lastTaughtIndex + 1; i < rows.length; i++) {
    if (!isFinished(rows[i])) return [rows[i].curriculumItemId];
  }
  return [];
}

/**
 * 画面に出す（＝保存する）次回の予定を決める。
 *
 * manual が null のあいだは自動値に追従し、講師が一度でも手で触ったら
 * その値を正典にする（勝手に書き換えない）。
 * 手で全部外して空にした場合も「手動で空」として尊重する（null ではなく []）。
 */
export function resolveNextPlan(auto: readonly number[], manual: readonly number[] | null) {
  return manual === null ? [...auto] : [...manual];
}

/**
 * ピッカーで単元をトグルしたときの次の手動値。
 *
 * 初回（manual === null）は「今表示されている自動値」を土台にする。
 * いきなり空から始めると、講師が1件足したつもりで自動値が消える。
 */
export function toggleNextPlanUnit(
  current: readonly number[] | null,
  auto: readonly number[],
  curriculumItemId: number
): number[] {
  const base = current === null ? [...auto] : [...current];
  return base.includes(curriculumItemId)
    ? base.filter((id) => id !== curriculumItemId)
    : [...base, curriculumItemId];
}
