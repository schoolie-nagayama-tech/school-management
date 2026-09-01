/**
 * 報告書の「ゆるいガイド」ステップ（純関数）
 *
 * 正典: docs/lesson-report-flow-plan.md §3（方式）・§4（ステップ構成）。
 *
 * ★ 方針: 拘束しない。
 *   ウィザード（1問1画面）は不採用。フォームの上に貼る sticky バーが
 *   「次の未完了の質問」を指すだけで、入力はフォーム本体で行う。
 *   講師がどこを直接書いてもよく、この関数は state を見て今の状況を言い直すだけ。
 *
 * ★ 保存経路・state を増やさない:
 *   ここに来るのは既存のフォーム state から組み立てたプリミティブだけ。
 *   ガイド専用の保存先は作らない（手動の「済」もページ内 state のみ）。
 *
 * ★ 提出前チェック（submitValidation.ts）と意味をズラさない:
 *   taught / handover / review の判定式は validateForSubmit とまったく同じにする。
 *   「ガイドは済なのに提出で止められる」が起きると講師の信頼を失う。
 */

/** ページ側が state から組み立てて渡す入力。プリミティブだけにしてテスト可能に保つ */
export interface GuideStepInput {
  tardy: boolean;
  homeworkNotDone: boolean;
  hasTextbooks: boolean;
  selectedUnitCount: number;
  extraMaterials: string;
  /** 宿題・演習の達成度スライダーが存在するか／1つでも動かしたか */
  homeworkAchievementAvailable: boolean;
  homeworkAchievementFilled: boolean;
  /** 確認テストの点数が入っているか */
  checkTestScoreFilled: boolean;
  /** 学校の進度が1件でも入っているか */
  schoolProgressFilled: boolean;
  goal: string; // 今日の目標
  /** 次回の予定（自動提案 or 手動選択）が1件でも立っているか */
  nextPlanFilled: boolean;
  /** 次回までの宿題の日割り行が存在するか／1行でも中身が入っているか */
  homeworkRowsAvailable: boolean;
  homeworkRowsFilled: boolean;
  handover: string;
  review: string; // 講評
}

/**
 * done    … 答えた（自動判定 or 手動で「済」）
 * pending … まだ答えていない
 * skipped … そもそも答える対象が無い（進捗の分母から外す）
 */
export type GuideStepStatus = 'done' | 'pending' | 'skipped';

export interface GuideStepState {
  id: string;
  /** バーに大きく出す質問文 */
  question: string;
  /** スクロール先の DOM id（page 側でセクションに付ける） */
  targetId: string;
  status: GuideStepStatus;
  /** 自動判定できない質問に出す「済にする」ボタンの文言。不要なら undefined */
  manualDoneLabel?: string;
}

/** ステップ1つぶんの定義（判定だけを差し替えられるように分離） */
interface GuideStepDef {
  id: string;
  question: string;
  targetId: string;
  manualDoneLabel?: string;
  /**
   * 自動判定。
   * true      … 埋まっている
   * false     … まだ
   * 'skipped' … 答える対象がそもそも無い（宿題行が無い等）
   */
  evaluate: (input: GuideStepInput) => boolean | 'skipped';
}

/**
 * ステップ定義（設計書 §4 の1〜10）。
 * 並び順＝授業を思い出す時系列。11問目「提出」はバー側の表示分岐なのでここには入れない。
 *
 * ★ 目標（goal）を内容の後ろに置くのは意図的:
 *   文書の表示順は「目標→内容」だが、授業後に思い出す順は
 *   「やったこと→ゴールは何だったか」の方が書きやすい（設計書 §4 の注記）。
 */
const STEP_DEFS: readonly GuideStepDef[] = [
  {
    id: 'mood',
    question: '今日の様子で当てはまるものは？',
    targetId: 'guide-mood',
    manualDoneLabel: '該当なし',
    // 遅刻・宿題未実施は「押さないのが正解」でもありうるので、押されていなければ手動で済にする
    evaluate: (i) => i.tardy || i.homeworkNotDone,
  },
  {
    id: 'taught',
    question: '今日はどこをやった？',
    targetId: 'guide-taught',
    // 必須（提出前チェックと同じ条件式。ここだけは手動で済にできない）
    evaluate: (i) => (i.hasTextbooks ? i.selectedUnitCount > 0 : i.extraMaterials.trim() !== ''),
  },
  {
    id: 'homework-check',
    question: '宿題・演習のでき具合は？',
    targetId: 'guide-homework-check',
    manualDoneLabel: '該当なし',
    evaluate: (i) => (i.homeworkAchievementAvailable ? i.homeworkAchievementFilled : 'skipped'),
  },
  {
    id: 'check-test',
    question: '確認テストはやった？',
    targetId: 'guide-check-test',
    manualDoneLabel: 'やってない',
    evaluate: (i) => i.checkTestScoreFilled,
  },
  {
    id: 'school-progress',
    question: '学校はいまどこまで進んでる？',
    targetId: 'guide-school-progress',
    manualDoneLabel: '聞けなかった',
    evaluate: (i) => i.schoolProgressFilled,
  },
  {
    id: 'goal',
    question: 'この授業のゴールは何だった？',
    targetId: 'guide-goal',
    evaluate: (i) => i.goal.trim() !== '',
  },
  {
    id: 'next-plan',
    question: '次回は何をやる？',
    targetId: 'guide-next-plan',
    // 進行表の続きが自動提案されるので、たいていは開いた時点で done になる
    evaluate: (i) => i.nextPlanFilled,
  },
  {
    id: 'homework-assign',
    question: '次回までの宿題は？',
    targetId: 'guide-homework-assign',
    manualDoneLabel: '今回は出さない',
    evaluate: (i) => (i.homeworkRowsAvailable ? i.homeworkRowsFilled : 'skipped'),
  },
  {
    id: 'handover',
    question: '次の先生への引継ぎを書こう',
    targetId: 'guide-handover',
    // 必須（提出前チェックと同じ条件式）
    evaluate: (i) => i.handover.trim() !== '',
  },
  {
    id: 'review',
    question: '保護者へのメッセージ（講評）を書こう',
    targetId: 'guide-review',
    // 必須（提出前チェックと同じ条件式）
    evaluate: (i) => i.review.trim() !== '',
  },
];

/**
 * いまの入力から各ステップの状態を出す。
 *
 * @param manualDone バー上で「済にする」を押したステップID（ページ内 state・保存しない）。
 *   入っていれば自動判定より優先して done にする。
 */
export function computeGuideSteps(
  input: GuideStepInput,
  manualDone: ReadonlySet<string>
): GuideStepState[] {
  return STEP_DEFS.map((def) => {
    // 手動の「済」が最優先。講師が「該当なし」と言ったものを機械が蒸し返さない
    let status: GuideStepStatus;
    if (manualDone.has(def.id)) {
      status = 'done';
    } else {
      const result = def.evaluate(input);
      status = result === 'skipped' ? 'skipped' : result ? 'done' : 'pending';
    }
    return {
      id: def.id,
      question: def.question,
      targetId: def.targetId,
      status,
      manualDoneLabel: def.manualDoneLabel,
    };
  });
}

/** 次に案内する質問（未完了の先頭）。全部済んでいれば null＝あとは提出だけ。 */
export function nextPendingStep(steps: GuideStepState[]): GuideStepState | null {
  return steps.find((s) => s.status === 'pending') ?? null;
}
