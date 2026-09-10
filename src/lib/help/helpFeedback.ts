/**
 * AIヘルプの評価まわりの型（GET /api/ai/help/questions の応答）。
 *
 * ★ルートに置かない。画面（/help と /admin/ai-feedback）がルートを import すると、
 *   クライアントからサーバー専用のモジュールを引き込む形になる（lib/ai/feedback.ts と同じ理由）。
 *
 * ★ai_feedback には入れない。AIヘルプの評価は help_questions に質問と一緒に残っていて、
 *   教室に依存しない（ヘルプは全社共通）。ai_feedback は教室ごとの記録なので、
 *   school_id を持たない行を入れると表の約束が崩れる。画面で並べるだけにする。
 */

/** 答えられなかった／立たなかった質問の1行（同じ文面は畳んで回数にしてある） */
export interface HelpQuestionRow {
  question: string;
  role: string;
  pagePath: string | null;
  /** 同じ文面で聞かれた回数 */
  count: number;
  /** いちばん新しく聞かれた日時 */
  lastAskedAt: string;
}

/** 評価の件数（これまでの合計） */
export interface HelpFeedbackSummary {
  /** 聞かれた質問の数 */
  total: number;
  /** 「役に立った」を押された数 */
  helpful: number;
  /** 「立たなかった」を押された数 */
  notHelpful: number;
  /** FAQに答えが無かった／業務判断で答えなかった数 */
  unanswered: number;
  /** AIを呼べなかった数（鍵未設定・障害）。答えられなかったとは別に数える */
  degraded: number;
}

export interface HelpQuestionsResponse {
  rows: HelpQuestionRow[];
  /** 件数が取れなかったときは null（0で埋めない） */
  summary: HelpFeedbackSummary | null;
  available: boolean;
}
