/**
 * AIが乗っている機能は5つ。名前とキーをここに1か所だけ置く。
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
// ★栓は機能が動くときに足す。先に置くと「何も動かないスイッチ」が設定画面に並ぶ。
//   （保護者との連絡は、その機能のPRでここに足す）
export const AI_FEATURE_KEYS = [
  'ai_compose',
  'teacher_assist',
  'plan_theme',
  'student_digest',
  'today_plan',
  'parent_message',
] as const;
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

/**
 * 生徒のまとめ（面談の報告事項カード ＋ 進行表の引継ぎの要約）。
 * どちらも「その生徒について書かれたものを束ねて読ませる」同じ動きなので1つの栓にする。
 * ★送るのは引継ぎ・成績・出欠・保護者とのやりとり。plan_theme より広い。
 *   引継ぎは本番で95%が埋まっており（直近90日 5,931件）、講師はすでにちゃんと書いている。
 *   AIの仕事は「整える」ではなく「誰も通して読めない量を束ねる」ほう。
 */
export const STUDENT_DIGEST_FEATURE_KEY: AiFeatureKey = 'student_digest';

/**
 * 今日の段取り（ダッシュボードの「今日やること」を時間帯に割り付ける）。
 *
 * ★送るのは今日の用事・授業のコマ・生徒と講師の姓だけ。成績も引継ぎも送らない。
 *   それでも別の栓にするのは、これが教室長ひとりの手元の道具だから。
 *   まとめると「生徒のまとめは閉じたままで段取りだけ使う」ができなくなる。
 */
export const TODAY_PLAN_FEATURE_KEY: AiFeatureKey = 'today_plan';

/**
 * 保護者との連絡（保護者チャットの返信欄で、教室長の箇条書きを文章にする）。
 * ★内容はAIが決めない。教室長が箇条書きで用意した答えを、そのスレッドのやりとりに
 *   合う文章にするだけ。送るのは保護者とのやりとり本文（氏名を含む）。
 */
export const PARENT_MESSAGE_FEATURE_KEY: AiFeatureKey = 'parent_message';

/** 画面に出す名前。★ここを直せば全部の画面が変わる */
export const AI_FEATURE_LABELS: Record<AiFeatureKey, string> = {
  ai_compose: 'おまかせ下書き',
  teacher_assist: '講師のAIサポート',
  plan_theme: 'テーマふくらませ',
  student_digest: '生徒のまとめ',
  today_plan: '今日の段取り',
  parent_message: '保護者との連絡',
};

/** 何をする機能か。設定画面でスイッチの横に出す */
export const AI_FEATURE_DESCRIPTIONS: Record<AiFeatureKey, string> = {
  ai_compose:
    '掲示板の投稿画面で、一言の指示から本文の下書きを作ります。書いたものを整える（推敲）もここです。保護者向けの投稿はお知らせの体裁に、報告書の講評も整えます。',
  teacher_assist:
    '投稿から依頼を読み取り、教室長に「残っている人」を、講師に授業中のカードを出します。',
  plan_theme: '講習提案書のテーマ欄に書いた一言を、その生徒の単元と成績でふくらませます。',
  student_digest:
    '進行表で過去の引継ぎを時系列のまま畳みます。面談の前には、成績・引継ぎ・保護者とのやりとりを束ねて報告事項を作ります。',
  today_plan:
    'ダッシュボードの「今日やること」を、授業前・各コマ・片付けの時間帯に割り付けます。Googleカレンダーの予定がある時間帯は空けます。朝に1回組み、日中に増えた用事は入れ場所だけ決めます。',
  parent_message:
    '保護者チャットで、教室長が書いた箇条書きを、これまでのやりとりの流れに合わせた文章にします。',
};

/** 何を外に出すのか。スイッチの近くに必ず出す（入れる判断の材料） */
export const AI_FEATURE_SENDS: Record<AiFeatureKey, string> = {
  ai_compose: '書きかけの文章',
  teacher_assist: '投稿の件名と本文',
  plan_theme: '生徒の単元と成績',
  student_digest: '生徒の引継ぎ・成績・保護者とのやりとり',
  // ★カレンダーの予定は件名ごと送る（何の予定かが分からないと時間を空ける判断ができない）。
  //   ここは教室長自身のカレンダーで、生徒・講師は姓だけに落としている。
  today_plan: '今日の用事・授業のコマ・生徒と講師の姓・カレンダーの予定（件名を含む）',
  parent_message: '保護者とのやりとり（氏名を含む）',
};

export function isAiFeatureKey(value: unknown): value is AiFeatureKey {
  return typeof value === 'string' && (AI_FEATURE_KEYS as readonly string[]).includes(value);
}

/**
 * AIヘルプ（FAQで答える）もAIを使うが、ここに無い。
 * 送るのは利用者の質問文とFAQ本文だけで、生徒や講師の個人データを含まないため、
 * 教室ごとの栓を持たせていない。
 */
