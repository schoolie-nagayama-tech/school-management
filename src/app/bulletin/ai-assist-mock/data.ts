/**
 * 「連絡掲示板AIアシスト」静的モックの固定データ。
 *
 * ★ ここにあるものは全て架空のダミー。DB・API・AIには一切触れない。
 *   人名・教室名・投稿本文はすべて創作で、実在の生徒・講師とは無関係。
 */

/* ============================================================
 * タスクカタログ（13種・有限）
 * ========================================================== */

/**
 * AIが投稿から抽出できるタスクは、この13種の中から「選ぶ」だけ。
 * 自由生成させないのは、(1)判定クエリを事前に用意できる (2)進捗ボードで集計できる ため。
 */
export const TASK_CATALOG = [
  '内申入力',
  'テスト結果転記',
  '目標設定',
  '進行表入力',
  'シフト提出',
  'シフト確認',
  '出勤簿入力',
  '教材配布チェック',
  '所持教材確認',
  'テスト対策提案',
  '申込状況チェック',
  '報告書の期限',
  '報告書タイトル形式',
] as const;

export type TaskKind = (typeof TASK_CATALOG)[number];

/** タスクの対象範囲（誰の分をやるのか） */
export type TaskScope = '全生徒' | '担当生徒' | '学年' | '特定生徒' | '講師自身';

/** AIが投稿から読み取った1タスク */
export interface ExtractedTask {
  id: string;
  kind: TaskKind;
  scope: TaskScope;
  /** 対象の補足（学年名など）。無ければ空 */
  scopeNote: string;
  /** 'YYYY-MM-DD' / '毎回' / 'なし' */
  deadline: string;
  /** 何を見て「済」と判定するか。DBの状態から自動で決まる */
  judgement: string;
  /** 既定は追跡する（教室長が外したいときだけ外す） */
  defaultTracked: boolean;
}

/* ============================================================
 * タブ1: 投稿とAIの読み取り結果
 * ========================================================== */

export const MOCK_POST = {
  title: '1学期の通知表回収のお願い',
  author: '教室長 三上',
  schoolName: '見本台校',
  postedAt: '2026-07-14',
  labelName: '依頼',
  body: '1学期の通知表を回収してください。回収したらNESTの内申入力と、申込状況にチェックをお願いします。7/31まで。',
} as const;

export const EXTRACTED_TASKS: ExtractedTask[] = [
  {
    id: 'task-naishin',
    kind: '内申入力',
    scope: '全生徒',
    scopeNote: '中1〜中3',
    deadline: '2026-07-31',
    judgement: '生徒の2026年度1学期の内申が入力されている',
    defaultTracked: true,
  },
  {
    id: 'task-application',
    kind: '申込状況チェック',
    scope: '担当生徒',
    scopeNote: '',
    deadline: '2026-07-31',
    judgement: '申込状況の確認済みチェックが付いている',
    defaultTracked: true,
  },
];

/** 対象の選択肢（この5種以外は作られない）。凡例として画面に出す */
export const SCOPE_LEGEND: { scope: TaskScope; example: string }[] = [
  { scope: '全生徒', example: '教室の在籍生徒すべて' },
  { scope: '担当生徒', example: 'その講師が担当している生徒だけ' },
  { scope: '学年', example: '中3だけ、など' },
  { scope: '特定生徒', example: '投稿で名前が挙がった生徒だけ' },
  { scope: '講師自身', example: 'シフト提出・出勤簿入力など生徒に紐づかないもの' },
];

/** 期限の取り方は3種類だけ。凡例として画面に出す */
export const DEADLINE_LEGEND: { label: string; example: string }[] = [
  { label: '2026-07-31（日付）', example: 'その日までに済ませる。当日・超過は強制表示になる' },
  { label: '毎回', example: '報告書の期限・進行表入力など、授業のたびに発生するもの' },
  { label: 'なし', example: '期限のない依頼。強制表示はせず、AIの判断だけで出す' },
];

/** 再掲の検知例（同じ依頼の投稿を新規タスクにしない） */
export const RECURRENCE_NOTE =
  '7/12の投稿「通知表回収のお願い」と同じタスクとして継続します（新規作成しない）';

/* ============================================================
 * タブ2: 進捗ボード
 * ========================================================== */

/**
 * 講師1人ぶんの内訳。担当 = 済 + 未済 になるようにダミー値を作ってある。
 * ★ done は実データ（内申が入力されている）基準。手動チェックの数ではない。
 *   合計は担当59名・済41名で、上の NAISHIN_SUMMARY と一致させてある。
 */
export interface TeacherProgressRow {
  id: string;
  name: string;
  assigned: number;
  /** 実データ基準の済（内申が入力されている担当生徒の数） */
  done: number;
  aiAssist: boolean;
}

export const NAISHIN_TEACHER_ROWS: TeacherProgressRow[] = [
  { id: 't-kawase', name: '川瀬 直樹', assigned: 12, done: 9, aiAssist: true },
  { id: 't-morita', name: '森田 彩香', assigned: 11, done: 8, aiAssist: true },
  { id: 't-tachibana', name: '立花 悠', assigned: 10, done: 7, aiAssist: false },
  { id: 't-onishi', name: '大西 慎一', assigned: 9, done: 6, aiAssist: true },
  { id: 't-nakai', name: '中井 みなみ', assigned: 9, done: 6, aiAssist: false },
  { id: 't-fujiwara', name: '藤原 亮太', assigned: 8, done: 5, aiAssist: true },
];

/** 担当講師の解決順（座席表が正典。固定講師と進行表はその補完） */
export const ASSIGNMENT_RESOLUTION_NOTE = '担当は 座席表 → 固定講師 → 進行表の講師名 の順で解決';

/**
 * 生徒単位の状態。
 * - done: 実データ（内申）も手動チェックも入っている
 * - done_unchecked: 実データは入っているのに手動チェックだけ付いていない（＝チェック漏れ）
 * - todo: 実データが入っていない。本当に未対応
 * - blocked: 講師がポップアップで理由を返した保留（「今日はできない」）
 *
 * ★ done_unchecked を独立させているのが要点。本番DBで数えたところ、教室長が見ていた
 *   「手動チェックの数」と実データの数が大きくズレていた（下の NAISHIN_SUMMARY 参照）。
 */
export type StudentTaskState = 'done' | 'done_unchecked' | 'todo' | 'blocked';

export interface StudentProgressRow {
  id: string;
  name: string;
  grade: string;
  teacherName: string;
  state: StudentTaskState;
  /** blocked のときだけ使う理由 */
  blockedReason?: string;
}

export const NAISHIN_STUDENT_ROWS: StudentProgressRow[] = [
  { id: 's-1', name: '佐々木 花', grade: '中2', teacherName: '川瀬 直樹', state: 'todo' },
  { id: 's-2', name: '青木 陸', grade: '中3', teacherName: '川瀬 直樹', state: 'done' },
  {
    id: 's-3',
    name: '早瀬 千夏',
    grade: '中1',
    teacherName: '森田 彩香',
    state: 'blocked',
    blockedReason: '通知表を持ってきていない',
  },
  { id: 's-4', name: '野々村 蓮', grade: '中3', teacherName: '森田 彩香', state: 'done_unchecked' },
  { id: 's-5', name: '篠原 美結', grade: '中2', teacherName: '立花 悠', state: 'done_unchecked' },
  {
    id: 's-6',
    name: '真砂 湊',
    grade: '中2',
    teacherName: '立花 悠',
    state: 'blocked',
    blockedReason: '通知表を持ってきていない',
  },
  { id: 's-7', name: '有馬 咲希', grade: '中1', teacherName: '大西 慎一', state: 'done' },
  { id: 's-8', name: '土屋 奏太', grade: '中3', teacherName: '大西 慎一', state: 'done_unchecked' },
  { id: 's-9', name: '瀬川 灯', grade: '中2', teacherName: '中井 みなみ', state: 'todo' },
  { id: 's-10', name: '倉持 陽向', grade: '中1', teacherName: '藤原 亮太', state: 'done' },
];

/**
 * 上段のサマリ（実物はDBから数える。ここは本番DBで再現した実数をそのまま置いた固定値）。
 *
 * ★ この機能の動機そのものになった発見:
 *   教室長が見ていた「59名中14名」は〈申込状況の手動チェック〉の数で、同時点の実データ
 *   （assessments の内申）は 59名中41名が入力済みだった。つまり実態は「回収が進んでいない」
 *   ではなく「チェックの付け忘れ」。督促の対象が28名ぶん丸ごと間違っていたことになる。
 *   だから済判定は必ず実データ側で行い、手動チェックは参照しない。
 */
export const NAISHIN_SUMMARY = {
  taskTitle: '1学期通知表回収 → 内申入力',
  total: 59,
  /** 実データ: 内申が入力されている生徒数。AIタスクの済判定はこちらを使う */
  realDone: 41,
  /** 手動チェック: 申込状況の確認済みチェックが付いている数（教室長が見ていた数字） */
  manualChecked: 13,
  /** 実データは済なのに手動チェックだけ付いていない数（41 − 13） */
  uncheckedGap: 28,
  measuredAgo: '3分前',
} as const;

/** 2つ目のタスク。判定が手動チェックそのものなので、上の「手動チェック」と同じ数になる */
export const APPLICATION_SUMMARY = {
  taskTitle: '申込状況チェック',
  total: 59,
  done: 13,
  measuredAgo: '3分前',
} as const;

/* ============================================================
 * タブ3: AIアシスト設定
 * ========================================================== */

export interface AssistTeacherRow {
  id: string;
  name: string;
  /** 直近30日の未対応率（自動ONの条件説明に使うダミー値） */
  ignoredRate: number;
  defaultOn: boolean;
}

export const ASSIST_TEACHERS: AssistTeacherRow[] = [
  { id: 't-kawase', name: '川瀬 直樹', ignoredRate: 18, defaultOn: true },
  { id: 't-morita', name: '森田 彩香', ignoredRate: 25, defaultOn: true },
  { id: 't-tachibana', name: '立花 悠', ignoredRate: 62, defaultOn: false },
  { id: 't-onishi', name: '大西 慎一', ignoredRate: 41, defaultOn: true },
  { id: 't-nakai', name: '中井 みなみ', ignoredRate: 55, defaultOn: false },
  { id: 't-fujiwara', name: '藤原 亮太', ignoredRate: 9, defaultOn: true },
];

/* ============================================================
 * タブ4: 授業中ポップアップ（シミュレータ）
 * ========================================================== */

export type ScenarioId = 'A' | 'B' | 'C' | 'D';

/** タイムラインのチェックポイント（分）。プログラム側が動く瞬間 */
export interface Checkpoint {
  at: number;
  label: string;
  note: string;
}

export const CHECKPOINTS: Checkpoint[] = [
  { at: 0, label: '授業を記録', note: '起動。未対応タスクを取得する' },
  { at: 27, label: '1/3チェック', note: 'DBを再照合。残っていればAIに聞く' },
  { at: 53, label: '2/3チェック', note: 'DBを再照合。残っていればAIに聞く' },
  { at: 65, label: '最終ライン', note: 'これ以降は出さない（授業の終盤を邪魔しない）' },
  { at: 80, label: '終了', note: '授業終了' },
];

export const LESSON_LENGTH_MIN = 80;

/** プログラム（コード側）が各チェックポイントで何をしたか */
export interface ProgramLogEntry {
  at: number;
  text: string;
}

/** AIを呼んだときの入出力（呼ばなかったチェックポイントには存在しない） */
export interface AiCallEntry {
  at: number;
  /** AIに渡した材料 */
  inputs: string[];
  decision: '出す' | 'まだ待つ' | '今日は見送る';
  reason: string;
  /** AIが生成した文面（出す場合のみ中身が入る） */
  message: string;
}

export interface Scenario {
  id: ScenarioId;
  label: string;
  summary: string;
  program: ProgramLogEntry[];
  aiCalls: AiCallEntry[];
  /** ポップアップが出る分。null＝出ない */
  popupAt: number | null;
  /** ポップアップの文面（AI生成 or 強制テンプレート） */
  popupMessage: string;
  /** 期限当日などでプログラムが強制表示したか（AIを介していない） */
  popupForced: boolean;
  /** 画面下に出す注記 */
  footnote: string;
}

/** シミュレータで使う架空の生徒（授業画面の枠に出す） */
export const SIM_STUDENT = {
  name: '佐々木 花',
  shortName: '花',
  grade: '中2',
  subject: '数学',
  slot: '3限',
  time: '18:00〜19:20',
} as const;

export const SCENARIOS: Scenario[] = [
  {
    id: 'A',
    label: '冒頭で自主的にやった',
    summary: '講師が授業前に自分で入力済み。1/3チェックで残0になり、AIは一度も呼ばれない',
    program: [
      { at: 0, text: '未対応2件を取得（内申入力・申込状況チェック）' },
      {
        at: 27,
        text: 'DB再照合 → 内申入力・申込状況チェックがどちらも済んでいた → 残0件',
      },
      { at: 27, text: '残0件のため、この授業の以降のチェックを打ち切り（AI呼び出しなし）' },
    ],
    aiCalls: [],
    popupAt: null,
    popupMessage: '',
    popupForced: false,
    footnote: '自分でやった講師には何も出ない。これが最も多いケースになる想定',
  },
  {
    id: 'B',
    label: '未対応のまま（通常）',
    summary: '1/3では「まだ待つ」、2/3で「今出す」。AIがタイミングを選ぶ標準の流れ',
    program: [
      { at: 0, text: '未対応2件を取得（内申入力・申込状況チェック）' },
      { at: 27, text: 'DB再照合 → 申込状況チェックが済んでいた → 残1件（内申入力）' },
      { at: 27, text: '残1件のためAIへ問い合わせ → 「まだ待つ」 → 表示しない' },
      { at: 53, text: 'DB再照合 → 残1件（内申入力）' },
      { at: 53, text: '残1件のためAIへ問い合わせ → 「出す」 → ポップアップを1件だけ表示' },
      { at: 65, text: '最終ライン。本日は表示済みのため、以降は問い合わせも表示もしない' },
    ],
    aiCalls: [
      {
        at: 27,
        inputs: [
          '経過: 27分 / 80分（1/3チェック）',
          '未対応タスク: 内申入力（対象: 佐々木 花）',
          '生徒の今日の状況: 遅刻あり・宿題は実施済み',
          '進行表の入力状況: 単元未選択（演習に入ったばかり）',
          '期限までの日数: 17日',
          '本日の表示回数: 0回',
        ],
        decision: 'まだ待つ',
        reason: '遅刻で到着直後、演習に入ったばかり。今は生徒への声かけを優先させたい',
        message: '',
      },
      {
        at: 53,
        inputs: [
          '経過: 53分 / 80分（2/3チェック）',
          '未対応タスク: 内申入力（対象: 佐々木 花）',
          '生徒の今日の状況: 遅刻あり・宿題は実施済み',
          '進行表の入力状況: 単元選択済み・演習が一区切り',
          '期限までの日数: 17日',
          '本日の表示回数: 0回',
        ],
        decision: '出す',
        reason: '演習が一区切りついて手が空いている。生徒本人がいるうちに聞ける最後の機会に近い',
        message:
          '花さんの1学期の内申をまだ聞けていません。演習の合間に確認して入力をお願いします。',
      },
    ],
    popupAt: 53,
    popupMessage:
      '花さんの1学期の内申をまだ聞けていません。演習の合間に確認して入力をお願いします。',
    popupForced: false,
    footnote: '1回の授業で出すのは1件だけ。出した後は最終ラインまで何も出さない',
  },
  {
    id: 'C',
    label: '期限当日（強制）',
    summary: '期限当日・超過はAIの判断を待たずプログラム側で強制表示する',
    program: [
      { at: 0, text: '未対応1件を取得（内申入力・期限は本日 2026-07-31）' },
      { at: 27, text: 'DB再照合 → 残1件・期限当日と判定' },
      { at: 27, text: '期限当日のためAIを呼ばずに強制表示（テンプレート文面）' },
      { at: 53, text: '表示済みのため何もしない' },
    ],
    aiCalls: [],
    popupAt: 27,
    popupMessage:
      '花さんの1学期の内申が未入力です。本日が期限です。授業の終わりまでに入力をお願いします。',
    popupForced: true,
    footnote: '期限当日・超過はプログラム側で強制。AIに「見送る」判断をさせない',
  },
  {
    id: 'D',
    label: '未対応なし',
    summary: '起動時点で未対応0件。以降は何も動かず、AIコストも発生しない',
    program: [
      { at: 0, text: '未対応0件を取得' },
      {
        at: 0,
        text: '未対応が無いので、この授業のチェックを起動時に終了（AI呼び出しなし・コスト0）',
      },
    ],
    aiCalls: [],
    popupAt: null,
    popupMessage: '',
    popupForced: false,
    footnote: 'AIを呼ぶのは「未対応がある生徒のコマ」だけ。大半のコマはここで終わる',
  },
];

/** ポップアップの「今日はできない」で選べる理由チップ */
export const BLOCK_REASONS = ['通知表を持ってきていない', '時間が取れない', 'その他'] as const;

/** 内申ミニフォームの教科と評定の選択肢 */
export const NAISHIN_SUBJECTS = ['国語', '数学', '英語', '理科', '社会'] as const;
export const NAISHIN_SCORES = [1, 2, 3, 4, 5] as const;

/* ============================================================
 * タブ5: 仕組み
 * ========================================================== */

export interface FlowStep {
  title: string;
  detail: string;
  /** プログラムが決めるのか、AIが決めるのか */
  actor: 'program' | 'ai';
}

export const FLOW_STEPS: FlowStep[] = [
  {
    title: '投稿',
    detail: '教室長が今まで通り自由文で連絡掲示板に投稿する。投稿UIは変えない',
    actor: 'program',
  },
  {
    title: 'AI抽出',
    detail: '投稿を読み、13種のカタログから該当するタスクを選ぶ。自由生成はしない',
    actor: 'ai',
  },
  {
    title: '判定クエリ',
    detail: 'タスク種別ごとに用意した固定クエリでDBを見て、生徒×講師ごとに済／未済を出す',
    actor: 'program',
  },
  {
    title: '「授業を記録」で起動',
    detail: '講師が授業を開始した時点で、その生徒の未対応タスクを取得する',
    actor: 'program',
  },
  {
    title: '1/3・2/3で再照合',
    detail: '経過時間のチェックポイントでDBを見直す。残0なら以降は何もしない',
    actor: 'program',
  },
  {
    title: 'AI判断',
    detail: '残っているときだけ、今出すか・待つか・今日は見送るかをAIが決める',
    actor: 'ai',
  },
  {
    title: 'ポップアップ',
    detail: '授業画面の右下に小さく1件だけ。モーダルで画面を塞がない',
    actor: 'program',
  },
  {
    title: '進捗ボード',
    detail: '済／未済／今日はできない、を教室長が講師別・生徒別に見る',
    actor: 'program',
  },
];

/** 「プログラムが決めること」と「AIが決めること」の対比 */
export const RESPONSIBILITY_TABLE: { program: string; ai: string }[] = [
  { program: 'タスクの済／未済（DBの状態で決まる）', ai: '投稿文から13種のどれに当たるかを選ぶ' },
  {
    program: '済の判定は実データを見る（手動チェックは参照しない）',
    ai: '（判定には関与しない）',
  },
  { program: '起動・チェックポイント（0・1/3・2/3・最終ライン）', ai: 'この瞬間に出すか、待つか' },
  { program: '1授業1件までという上限', ai: 'ポップアップの文面（一言だけ）' },
  { program: '期限当日・超過の強制表示', ai: '（強制表示のときは呼ばない）' },
  { program: '対象生徒・対象講師の絞り込み', ai: '対象範囲の候補提示（教室長が確定する）' },
];

export const COST_NOTES = [
  '未対応が0件のコマではAIを呼ばない。呼ぶのは「未対応がある生徒のコマ」だけ',
  '1回の呼び出しは短文（未対応タスクと状況の箇条書き）で、モデルはHaiku想定',
  '教室規模の想定で月数百円規模。投稿の読み取りは投稿1件につき1回だけ',
];
