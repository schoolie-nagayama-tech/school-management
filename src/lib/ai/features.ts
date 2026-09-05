/**
 * AIが乗っている機能は4つ。名前とキーをここに1か所だけ置く。
 *
 * 正典: docs/ai-features-integration-plan.md
 *
 * ★「掲示板AIアシスト」は廃語。あの語は3つの違うものを指していた
 *   （講師ごとのスイッチ／教室長が見る「残っている人」／機能全体の総称）。
 *   どれの話をしているか分からなくなり、実際に取り違えが起きた。
 *
 * ★画面の名前で呼ばない。掲示板の画面には「おまかせ下書き」と「講師のAIサポート」の
 *   2つが同居していて、どちらを掲示板と呼んでもぶつかる。
 *   さらに推敲は講習テーマでも使っている（画面をまたぐ道具）。
 *
 * ★スイッチは機能ごとに分ける。まとめると「読み取りは要らないが下書きは使いたい」ができない。
 *   送るデータも、外に出してよいかの判断も、機能ごとに違う。
 *
 * ★行が無ければOFF。設定を作り忘れた教室が黙って外部送信するのを防ぐ。
 */

/** 教室ごとに入切する機能のキー。DBの school_ai_settings.feature_key に入る */
export const AI_FEATURE_KEYS = ['ai_compose', 'teacher_assist', 'plan_theme'] as const;
export type AiFeatureKey = (typeof AI_FEATURE_KEYS)[number];

/**
 * おまかせ下書き（作る・推敲する）。
 * 掲示板の投稿画面と、講習テーマの推敲で使う。送るのは書きかけの文章。
 */
export const COMPOSE_FEATURE_KEY: AiFeatureKey = 'ai_compose';

/**
 * 講師のAIサポート（投稿の読み取り → 残っている人 → 授業中のカード）。
 * 送るのは投稿の件名と本文。
 * ★誰に授業中のカードを出すかは、これとは別に講師ごとのスイッチで決める。
 */
export const TEACHER_ASSIST_FEATURE_KEY: AiFeatureKey = 'teacher_assist';

/**
 * テーマふくらませ（テーマの一言 ＋ 単元 ＋ 成績）。
 * ★これだけ生徒の成績を送る。ほかと同じスイッチにすると、
 *   連絡文のために開けた教室から成績まで流れ出す。
 */
export const PLAN_THEME_FEATURE_KEY: AiFeatureKey = 'plan_theme';

/** 画面に出す名前。★ここを直せば全部の画面が変わる */
export const AI_FEATURE_LABELS: Record<AiFeatureKey, string> = {
  ai_compose: 'おまかせ下書き',
  teacher_assist: '講師のAIサポート',
  plan_theme: 'テーマふくらませ',
};

/** 何をする機能か。設定画面でスイッチの横に出す */
export const AI_FEATURE_DESCRIPTIONS: Record<AiFeatureKey, string> = {
  ai_compose:
    '掲示板の投稿画面で、一言の指示から本文の下書きを作ります。書いたものを整える（推敲）もここです。',
  teacher_assist:
    '投稿から依頼を読み取り、教室長に「残っている人」を、講師に授業中のカードを出します。',
  plan_theme: '講習提案書のテーマ欄に書いた一言を、その生徒の単元と成績でふくらませます。',
};

/** 何を外に出すのか。スイッチの近くに必ず出す（入れる判断の材料） */
export const AI_FEATURE_SENDS: Record<AiFeatureKey, string> = {
  ai_compose: '書きかけの文章',
  teacher_assist: '投稿の件名と本文',
  plan_theme: '生徒の単元と成績',
};

export function isAiFeatureKey(value: unknown): value is AiFeatureKey {
  return typeof value === 'string' && (AI_FEATURE_KEYS as readonly string[]).includes(value);
}

/**
 * AIヘルプ（FAQで答える）は4つ目だが、ここに無い。
 * 送るのは利用者の質問文とFAQ本文だけで、生徒や講師の個人データを含まないため、
 * 教室ごとの栓を持たせていない。
 */
