/**
 * 提出前チェック（純関数）
 *
 * 正典: docs/lesson-report-session-merge-plan.md フェーズ2 §F。
 *
 * ★ 方針: ボタンを黙って無効化しない。
 *   「提出」は押せるままにして、押したときに何が足りないかを言い、その入力欄まで
 *   連れて行く。無効化されたボタンは理由を伝えないので、講師は原因を探して画面を
 *   往復することになる。
 *
 * ★ 必須はこの3つだけ。増やさないこと:
 *   1. 本日の指導範囲 … 何を教えたか分からない報告書を保護者に出さない
 *   2. 引継ぎ         … 次の担当講師が前回を知る唯一の手段
 *   3. 講評           … 保護者が読む本文。ここが空なら報告書の意味が無い
 *   下書き保存・自動保存はこのチェックで止めない（書きかけを保存できないと困るため）。
 */

/** 不足している入力の種別（画面側がスクロール先を決めるキー）。 */
export type SubmitCheckField = 'taught-range' | 'handover' | 'review';

/** 不足1件。label＝入力欄の名前 / message＝どうすれば埋まるか。 */
export interface SubmitCheckIssue {
  field: SubmitCheckField;
  label: string;
  message: string;
}

export interface SubmitValidationInput {
  /** 進行表で管理中の教材（教材セット）が1件以上あるか */
  hasTextbooks: boolean;
  /** 進行表グリッドで「今日やった」と選ばれている単元の数（全教材セットの合計） */
  selectedUnitCount: number;
  /** プリント・テキスト外の教材の自由記述 */
  extraMaterials: string;
  /** 引継ぎ（教室内のみ） */
  handover: string;
  /** 講評（保護者が読む本文） */
  reviewComment: string;
}

/**
 * 提出できるかを判定する。戻り値が空配列なら提出してよい。
 *
 * 指導範囲の判定だけ条件が分かれる:
 *   進行表に教材がある生徒 → グリッドで単元を選んでいること（自由記述では代替させない。
 *     教材があるのに進行表を更新しない運用が常態化すると進行表が死ぬ）
 *   進行表に教材が無い生徒 → プリント等の自由記述が埋まっていればよい
 *     （選ぶ対象がそもそも無いので、これを必須にすると提出できなくなる）
 */
export function validateForSubmit(input: SubmitValidationInput): SubmitCheckIssue[] {
  const issues: SubmitCheckIssue[] = [];

  const hasTaughtRange = input.hasTextbooks
    ? input.selectedUnitCount > 0
    : input.extraMaterials.trim() !== '';
  if (!hasTaughtRange) {
    issues.push({
      field: 'taught-range',
      label: '本日の指導範囲',
      message: input.hasTextbooks
        ? '下の進行表で、今日やった単元のセルをクリックしてください'
        : 'プリント・テキスト外の教材の欄に、今日やった内容を入力してください',
    });
  }

  if (input.handover.trim() === '') {
    issues.push({
      field: 'handover',
      label: '引継ぎ',
      message: '次の担当講師・室長へ、今日の様子と次回の入り方を書いてください',
    });
  }

  if (input.reviewComment.trim() === '') {
    issues.push({
      field: 'review',
      label: '講評',
      message: '保護者が読む本文です。空のままでは提出できません',
    });
  }

  return issues;
}
