/**
 * AIの読み取りの答え合わせ。型・値の一覧・記録する関数をここ1か所に置く。
 *
 * 正典: docs/bulletin-ai-assist.html
 *
 * ★なぜ1か所か。
 *   AIが合っていたかどうかが、いままでどこにも残っていなかった。本番で
 *   「PCSを配布 → 教材配布チェック」「諏訪中生 → 対象が空で母数0」の2つの誤りが
 *   起きたが、気づけたのは教室長がスクリーンショットを送ってくれたからで、
 *   DBを見ても分からなかった。直せるのは、間違いが数えられるようになってからである。
 *   機能ごとにテーブルや入口を作ると「AIはどこで間違えているか」を横断で数えられず、
 *   結局どれも見なくなる。だから表も ai_feedback の1つだけ、入口もこのファイル1つだけにする。
 *   今後どのAI機能のフィードバックもここを通す（feature と targetKind で分ける）。
 *
 * ★bulletin_popup_logs と混ぜない。
 *   あちらは「AIがカードを出さなかった理由」の機械ログで、1授業ごとに自動で積もる。
 *   こちらは人が押したときだけ入る答え合わせ。目的も量も違い、同じ表にすると
 *   人の答えが機械ログに埋もれて読めなくなる。
 *
 * ★verdict を自由記述にしない。
 *   自由文にすると「読み間違い」「よみまちがい」「違う」が別物になり、
 *   何件あったのかを数えられなくなる。数えられないフィードバックは改善に使えない。
 *   足りない答えが出てきたら、この一覧に値を足す（画面で書かせない）。
 */

import type { AiFeatureKey } from './features';

/** 人の答え。★増やすときはここに足す（画面から自由文で入れさせない） */
export const FEEDBACK_VERDICTS = [
  /** 読み間違い（AIの解釈が違う）。これが集まった分だけプロンプトを直せる */
  'misread',
  /** もう済んでいる（AIの読みは合っているが、追う必要が無い） */
  'already_done',
  /** 追わなくていい（依頼ではあるが、この教室では追跡しないと決めた） */
  'not_needed',
  /** 合っていた。★いまの掲示板UIからは入らない。将来ほかの機能で使う */
  'ok',
  'other',
] as const;

export type FeedbackVerdict = (typeof FEEDBACK_VERDICTS)[number];

/** 画面に出す短い語。★チップに載るので短くする（長いと押すのをためらう） */
export const FEEDBACK_VERDICT_LABELS: Record<FeedbackVerdict, string> = {
  misread: '読み間違い',
  already_done: 'もう済んだ',
  not_needed: '追わなくていい',
  ok: '合っていた',
  other: 'その他',
};

/** 何についてのフィードバックか。★AI機能が増えるたびにここに足す */
export const FEEDBACK_TARGET_KINDS = ['bulletin_task'] as const;

export type FeedbackTargetKind = (typeof FEEDBACK_TARGET_KINDS)[number];

/** 記録する1件 */
export interface AiFeedbackInput {
  schoolId: string;
  feature: AiFeatureKey;
  targetKind: FeedbackTargetKind;
  /** 対象のID。消えても記録は残るので、DB側でもFKは張っていない */
  targetId?: string;
  /** AIが実際に出したもの。あとから読み間違いを再現するための材料 */
  aiOutput?: Record<string, unknown>;
  verdict: FeedbackVerdict;
  /** 任意の一言。当面UIからは入れない */
  note?: string;
}

export function isFeedbackVerdict(value: unknown): value is FeedbackVerdict {
  return typeof value === 'string' && (FEEDBACK_VERDICTS as readonly string[]).includes(value);
}

export function isFeedbackTargetKind(value: unknown): value is FeedbackTargetKind {
  return typeof value === 'string' && (FEEDBACK_TARGET_KINDS as readonly string[]).includes(value);
}

/**
 * 答え合わせの一覧の1行（GET /api/ai/feedback）。
 * ★APIの型もここに置く。ルートに置くと画面がルートを import することになり、
 *   クライアントからサーバー専用のモジュールを引き込む形になってしまう。
 */
export interface AiFeedbackRow {
  id: string;
  createdAt: string;
  schoolId: string;
  schoolName: string;
  feature: string;
  targetKind: string;
  targetId: string | null;
  aiOutput: Record<string, unknown>;
  verdict: string;
  note: string | null;
  createdByName: string;
}

export interface AiFeedbackListResponse {
  rows: AiFeedbackRow[];
}

/**
 * フィードバックを記録する（クライアントから呼ぶ）。
 *
 * ★失敗しても投げない。記録は「おまけ」であって、本体の操作（依頼を消す等）を
 *   止めてよい理由にはならない。FBが送れなかったせいで消せなかった、が起きると
 *   教室長は次から理由を押さなくなり、集めたかったものが集まらなくなる。
 *
 * ★fetchWithAuth は関数の中で読み込む（import を上に書かない）。
 *   このファイルは値の一覧をサーバー側（/api/ai/feedback）からも参照するが、
 *   @/lib/api/auth は読み込むだけでブラウザ用のSupabaseクライアントを作るため、
 *   上で import するとサーバーのルートにそれを引き込んでしまう。
 */
export async function recordAiFeedback(input: AiFeedbackInput): Promise<void> {
  try {
    const { fetchWithAuth } = await import('@/lib/api/auth');
    const res = await fetchWithAuth('/api/ai/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      console.error('[ai/feedback] 記録できませんでした', res.status);
    }
  } catch (e) {
    console.error('[ai/feedback] 記録できませんでした', e);
  }
}
