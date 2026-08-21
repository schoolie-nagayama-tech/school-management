/**
 * 「宿題未実施マーク」⇄「宿題のやってきた量（％）」の双方向同期（純関数）
 *
 * 正典: docs/lesson-report-session-merge-plan.md §0 決定5。
 *
 * 決めたこと:
 *   - マークON        → やってきた量は 0%
 *   - やってきた量 0% → マークON
 *   - やってきた量 >0 → マークOFF
 *   - やってきた量が未入力（null）になったときはマークを触らない
 *     （「まだ入れていない」だけで、宿題をやってきたかどうかの情報ではないため）
 *   「やってきていない」も「忘れた」も同じ扱い（区別しない）。講師に理由の入力を求めない。
 *
 * ★ 純関数としてここに切り出す理由:
 *   同期規則がフォームのイベントハンドラに散ると「マークは付いているのに 80%」のような
 *   矛盾した状態が簡単に生まれる。規則をこの1ファイルに閉じ込め、テスト
 *   （src/__tests__/lib/lessonReportHomeworkMark.test.ts）で境界を固定する。
 *   UI（/lesson-reports/[scheduleEntryId]）はこの関数の戻り値をそのまま state に入れるだけ。
 */

/** 同期対象の2値をまとめた状態。 */
export interface HomeworkMarkState {
  /** 宿題未実施マーク（保護者公開） */
  homeworkNotDone: boolean;
  /** 宿題のやってきた量（％）。null は未入力 */
  completionPct: number | null;
}

/**
 * 「宿題未実施」マークを押したとき。
 *
 * ON にしたら実施率は 0% に落とす。
 * OFF に戻すときは、マークが書いた 0% だけを未入力（null）に戻す。
 * 0% のまま残すと「マークOFFなのに実施率0%」という、規則の上では
 * マークONと同義の矛盾した状態になるため。
 * 講師が自分で 0% 以外を入れていた場合はその値を尊重して触らない。
 */
export function applyHomeworkMark(state: HomeworkMarkState, nextMark: boolean): HomeworkMarkState {
  if (nextMark) {
    return { homeworkNotDone: true, completionPct: 0 };
  }
  return {
    homeworkNotDone: false,
    completionPct: state.completionPct === 0 ? null : state.completionPct,
  };
}

/**
 * 「やってきた量」のスライダーを動かしたとき。
 *
 * 0% にしたらマークON、1%以上にしたらマークOFF。
 * null（未入力）はマークを触らない。
 */
export function applyHomeworkCompletionPct(
  state: HomeworkMarkState,
  nextPct: number | null
): HomeworkMarkState {
  if (nextPct === null) {
    return { homeworkNotDone: state.homeworkNotDone, completionPct: null };
  }
  return { homeworkNotDone: nextPct === 0, completionPct: nextPct };
}
