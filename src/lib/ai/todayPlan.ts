/**
 * 今日の段取り — 「今日やること」を時間帯に割り付ける。
 *
 * 正典: docs/today-plan-ai-plan.md
 *
 * ★組み直さない。組むのは1日1回だけ。
 *   朝に組んだ段取りは日中に必ず崩れるが、そのたびに全部組み直すと
 *   消した項目や、手で直した並びが吹き飛ぶ。日中に増えた用事は
 *   「入れ場所だけ」決めて1件足す（place）。これが2段構えの理由。
 *
 * ★出てくるのは読み物ではなくタスク。チェック・書き換え・移動・削除・追加ができ、
 *   直した結果が正典。AIが出すのは案で、決めるのは教室長。
 *
 * ★AIの出力を信じない。ここのパーサは、渡していないコマ・渡していない日付・
 *   長すぎる文を全部落とす。読めない出力で段取りを壊さないため
 *   （壊れるくらいなら空を返して、呼び出し側が「組めなかった」に倒す）。
 *
 * このファイルは純関数だけ。fetch もDBも触らない（テストできるようにするため）。
 */

/** 勤務の開始。★出勤簿からは引かない（2026-09-07 決定・既定固定） */
export const WORK_START = '13:00';
/** 勤務の終わり。★1日はここで終わる。これ以降の時間帯を作らせない */
export const WORK_END = '21:30';

/** 1つの時間帯に置ける件数の上限。並べすぎると結局読まれない */
export const MAX_ITEMS_PER_BLOCK = 4;
/** 項目本文の上限。★超えたら捨てる（切り詰めると文の途中で切れて意味が変わる） */
export const MAX_TEXT_LENGTH = 80;
/** 置いた理由の上限。1行で読み切れる長さに留める */
export const MAX_WHY_LENGTH = 60;

/**
 * 段取りの時間帯。
 * - `before` … 授業前（勤務開始〜最初のコマ）
 * - `slot:<schedule_time_slots.id>` … そのコマの時間
 * - `after` … 片付け（最後のコマ〜21:30）
 * - `later` … 今日は入らないもの。when にいつやるかを持つ
 *
 * ★コマは番号ではなくIDで持つ。教室ごとにコマの時刻が違い、
 *   同じ番号に個別と集団で別の時刻が割り当たっているため、番号では時間が決まらない。
 */
export type PlanBlock = 'before' | `slot:${string}` | 'after' | 'later';

/** 段取りの1件。★手で直した結果がそのまま保存される */
export interface PlanItem {
  /** 呼び出し側が crypto.randomUUID() で振る。AIには作らせない */
  id: string;
  block: PlanBlock;
  /** 何をするか */
  text: string;
  /** なぜそこに置いたか。1行 */
  why: string;
  done: boolean;
  /**
   * どこから来た項目か。
   * - `ai` … AIが組んだ／入れ場所を決めた
   * - `user` … 教室長が自分で足した
   * - `todo` … 「今日やること」の行をそのまま持ってきた
   */
  source: 'ai' | 'user' | 'todo';
  /** 元になった「今日やること」のID（あれば） */
  todoId?: string;
  /** block === 'later' のときだけ。いつやるか（YYYY-MM-DD） */
  when?: string;
}

/** AIに渡す材料。★新しく読むデータを増やさない（既存のものだけ） */
export interface PlanMaterials {
  /** 段取りを組む日（YYYY-MM-DD） */
  date: string;
  /** 勤務の枠。★既定固定 */
  workHours: { start: typeof WORK_START; end: typeof WORK_END };
  /** その教室のコマ（時刻順） */
  slots: { id: string; label: string; start: string; end: string }[];
  /** 今日の授業。★生徒・講師は姓のみ */
  lessons: { slotId: string; studentSurname: string; teacherSurname?: string }[];
  /** 今日やること */
  todos: { id: string; text: string; studentSurname?: string; due?: string }[];
  /** この先で授業の登録がある日。★later はこの中からしか選ばせない */
  upcomingLessonDays: string[];
}

/** パーサが返す1件。id・done・source は呼び出し側が付ける */
export interface PlanDraftItem {
  block: PlanBlock;
  text: string;
  why: string;
  todoId?: string;
  when?: string;
}

/** 差し込み（place）の答え。1件ぶんの入れ場所だけ */
export interface PlanPlacement {
  block: PlanBlock;
  when?: string;
  why: string;
}

/* ============================================================
 * 時間帯の並び
 * ========================================================== */

/**
 * その教室の時間帯を、時間の流れの順に並べる。
 * ★画面もAIもこの順を正典にする。ここを直せば両方が変わる。
 */
export function planBlocksForSchool(slots: readonly { id: string }[]): PlanBlock[] {
  return ['before', ...slots.map((s) => `slot:${s.id}` as PlanBlock), 'after', 'later'];
}

/** 時間帯 → 画面に出す見出し。コマは時刻まで出す（何時の話か分からないと動けない） */
export function describePlanBlocks(
  slots: readonly { id: string; label: string; start: string; end: string }[]
): { key: PlanBlock; label: string }[] {
  return [
    { key: 'before' as PlanBlock, label: `授業前 ${WORK_START}〜` },
    ...slots.map((s) => ({
      key: `slot:${s.id}` as PlanBlock,
      label: `${s.label} ${s.start}〜${s.end}`,
    })),
    { key: 'after' as PlanBlock, label: `片付け 〜${WORK_END}` },
    { key: 'later' as PlanBlock, label: '明日以降' },
  ];
}

/* ============================================================
 * 1段目: 朝に1回組む
 * ========================================================== */

export function planSystemPrompt(): string {
  return [
    'あなたは学習塾の教室長の1日を組み立てる係です。',
    '渡された「今日やること」を、授業前・各コマ・片付けの時間帯に割り付けます。',
    '',
    '■ いちばん大事なこと',
    `- ★1日は ${WORK_END} で終わり。勤務は ${WORK_START}〜${WORK_END} です。この枠の外に用事を置かない。`,
    '- ★データにない予定を作らない。渡した用事とコマ以外のものを書き足さない。',
    '  「掃除をする」「メールを確認する」のような、こちらが渡していない用事を作らないこと。',
    '- ★この段取りは1日に1回しか組みません。あとから作り直さないので、',
    '  渡した用事は今日ぶんを最後まで置き切ってください（置き場所に迷ったものを捨てない）。',
    '- ★生徒と講師は姓だけで渡しています。フルネームを推測して補わない。',
    '',
    '■ どこに置くか',
    '- ★生徒に渡す用事は、その生徒が来るコマに置く。帰ってからでは渡せません。',
    '  誰に渡すかが書かれている用事は、その生徒の授業があるコマを探して置くこと。',
    '- 誰にも紐づかない用事（報告書・タスクなど）は、授業前か片付けに置く。',
    `- 各時間帯は 0〜${MAX_ITEMS_PER_BLOCK}件。詰め込みすぎると結局どれもやりません。`,
    '- 置いた理由を why に1行で書く。締切があるものは why に締切日を書く。',
    '',
    '■ 今日に入らないもの',
    '- block を "later" にし、when にいつやるかを YYYY-MM-DD で書く。',
    '- ★when は「この先で授業がある日」として渡した日付の中からだけ選ぶ。',
    '  授業の登録が無い日に回しても、その日は誰も教室にいません。',
    '',
    '■ 書き方',
    `- text は${MAX_TEXT_LENGTH}字まで。何をするかが分かる言い切りにする。`,
    `- why は${MAX_WHY_LENGTH}字まで。1行。`,
    '- todoId は、渡した用事から作った項目にだけ、その用事のIDをそのまま写す。',
    '',
    '出力はJSONだけ。前置きは書かない:',
    '{"items":[{"block":"slot:xxxx","text":"山田さんに教材を渡す","why":"4限に来るため",' +
      '"todoId":"material:1"},{"block":"later","text":"面談の日程を聞く","why":"今日は来ないため",' +
      '"when":"2026-09-09"}]}',
  ].join('\n');
}

/** 材料の並べ方。★1件1行に潰す（行が崩れると、どれが1件か読めなくなる） */
export function planUserText(materials: PlanMaterials): string {
  const flat = (s: string) => s.replace(/\s+/g, ' ').trim();

  const slotLines = materials.slots.map((s) => `- ${s.id} … ${s.label} ${s.start}〜${s.end}`);

  // コマごとに誰が来るかをまとめる。用事を「その生徒が来るコマ」に置かせるための材料
  const bySlot = new Map<string, string[]>();
  for (const l of materials.lessons) {
    const list = bySlot.get(l.slotId) ?? [];
    list.push(
      l.teacherSurname ? `${l.studentSurname}（${l.teacherSurname}先生）` : l.studentSurname
    );
    bySlot.set(l.slotId, list);
  }
  const lessonLines = materials.slots.map((s) => {
    const names = bySlot.get(s.id) ?? [];
    return `- ${s.label}（${s.id}）: ${names.length > 0 ? names.join('、') : 'なし'}`;
  });

  const todoLines = materials.todos.map((t) => {
    const who = t.studentSurname ? ` [${t.studentSurname}]` : '';
    const due = t.due ? `（締切 ${t.due}）` : '';
    return `- ${t.id}: ${flat(t.text)}${who}${due}`;
  });

  return [
    `【日付】${materials.date}`,
    `【勤務】${materials.workHours.start}〜${materials.workHours.end}`,
    '',
    '【コマ】',
    ...(slotLines.length > 0 ? slotLines : ['- なし']),
    '',
    '【今日の授業（コマごとの生徒・姓のみ）】',
    ...(lessonLines.length > 0 ? lessonLines : ['- なし']),
    '',
    `【今日やること（${materials.todos.length}件）】`,
    ...(todoLines.length > 0 ? todoLines : ['- なし']),
    '',
    '【この先で授業がある日（later はこの中から選ぶ）】',
    materials.upcomingLessonDays.length > 0
      ? materials.upcomingLessonDays.join('、')
      : 'なし（later は使えません）',
  ].join('\n');
}

export interface PlanParseOptions {
  /** 置いてよい時間帯。planBlocksForSchool の結果 */
  allowedBlocks: readonly PlanBlock[];
  /** 紐づけてよい用事のID */
  allowedTodoIds: readonly string[];
  /** later で指定してよい日付 */
  allowedDays: readonly string[];
}

/**
 * AIの生の出力を、保存してよい形にする。★出力を信じない。
 *
 * - 渡していない時間帯は捨てる（コマIDを作られたら気づけないので突き合わせで落とす）
 * - text/why が長すぎる行は捨てる（切り詰めない）
 * - 渡していない todoId は外す（項目そのものは残す。用事が消えるほうが困る）
 * - later で when が「授業がある日」でなければ捨てる（誰もいない日に回されても意味がない）
 * - 1つの時間帯につき4件まで
 * - 読めない出力なら空。呼び出し側が「組めなかった」に倒す
 */
export function parsePlanResult(raw: unknown, options: PlanParseOptions): PlanDraftItem[] {
  if (!raw || typeof raw !== 'object') return [];

  const rows = (raw as { items?: unknown }).items;
  if (!Array.isArray(rows)) return [];

  const allowedBlocks = new Set<string>(options.allowedBlocks as readonly string[]);
  const allowedTodoIds = new Set<string>(options.allowedTodoIds as readonly string[]);
  const allowedDays = new Set<string>(options.allowedDays as readonly string[]);

  const countByBlock = new Map<string, number>();
  const out: PlanDraftItem[] = [];

  for (const row of rows as unknown[]) {
    if (!row || typeof row !== 'object') continue;
    const r = row as {
      block?: unknown;
      text?: unknown;
      why?: unknown;
      todoId?: unknown;
      when?: unknown;
    };

    if (typeof r.block !== 'string' || !allowedBlocks.has(r.block)) continue;
    const block = r.block as PlanBlock;

    // ★1つの時間帯に4件まで。溢れたぶんは捨てる（並べすぎると読まれない）
    const used = countByBlock.get(block) ?? 0;
    if (used >= MAX_ITEMS_PER_BLOCK) continue;

    if (typeof r.text !== 'string') continue;
    const text = r.text.trim();
    if (!text || text.length > MAX_TEXT_LENGTH) continue;

    const why = typeof r.why === 'string' ? r.why.trim() : '';
    if (why.length > MAX_WHY_LENGTH) continue;

    // later は「いつやるか」まで決まって初めて意味がある
    let when: string | undefined;
    if (block === 'later') {
      const w = typeof r.when === 'string' ? r.when.trim() : '';
      if (!allowedDays.has(w)) continue;
      when = w;
    }

    // ★todoId が合わないだけで項目は捨てない。紐づけを外して残す
    const todoId =
      typeof r.todoId === 'string' && allowedTodoIds.has(r.todoId) ? r.todoId : undefined;

    countByBlock.set(block, used + 1);
    out.push({ block, text, why, ...(todoId ? { todoId } : {}), ...(when ? { when } : {}) });
  }

  return out;
}

/* ============================================================
 * 2段目: 日中に増えた用事を1件だけ差し込む
 * ========================================================== */

export function placeSystemPrompt(): string {
  return [
    'あなたは学習塾の教室長の1日を組み立てる係です。',
    'すでに組んである今日の段取りに、あとから増えた用事を1件だけ差し込みます。',
    '',
    '■ いちばん大事なこと',
    '- ★決めるのは、その1件をどこに置くかだけです。',
    '  いまの段取りは空き具合を見せるために渡しているだけで、並べ替えたり書き換えたりしない。',
    '  ★段取りを作り直さない。ほかの項目には一切触れないこと。',
    `- ★1日は ${WORK_END} で終わり。勤務は ${WORK_START}〜${WORK_END} です。`,
    '- ★データにない予定を作らない。渡していないコマや日付を作らない。',
    '- ★生徒と講師は姓だけで渡しています。フルネームを推測して補わない。',
    '',
    '■ どこに置くか',
    '- ★その用事に生徒が出てくるなら、その生徒が来るコマに置く。帰ってからでは渡せません。',
    '- 誰にも紐づかないなら、授業前か片付けの空いているほうに置く。',
    `- すでに${MAX_ITEMS_PER_BLOCK}件ある時間帯は避け、空いている時間帯を選ぶ。`,
    '- 今日どうやっても入らないときだけ block を "later" にし、',
    '  when に「この先で授業がある日」として渡した日付の中から1つ選んで書く。',
    '',
    `- why は${MAX_WHY_LENGTH}字まで。なぜそこに置いたかを1行で書く。`,
    '',
    '出力はJSONだけ。前置きは書かない:',
    '{"block":"slot:xxxx","why":"山田さんが4限に来るため"}',
  ].join('\n');
}

/** いまの段取りは「空き具合」を見せるためだけに渡す。★本文まで細かく見せない */
export function placeUserText(input: {
  materials: PlanMaterials;
  currentPlan: readonly PlanItem[];
  text: string;
}): string {
  const { materials, currentPlan, text } = input;

  const blocks = describePlanBlocks(materials.slots);
  const currentLines = blocks.map((b) => {
    const items = currentPlan.filter((i) => i.block === b.key);
    const body =
      items.length > 0
        ? items.map((i) => (i.done ? `${i.text}（済）` : i.text)).join(' / ')
        : '（空き）';
    return `- ${b.key} … ${b.label}: ${items.length}件 … ${body}`;
  });

  return [
    planUserText(materials),
    '',
    '【いまの段取り（空き具合を見るためのもの。触らない）】',
    ...currentLines,
    '',
    '【差し込む用事（この1件だけ）】',
    text.replace(/\s+/g, ' ').trim(),
  ].join('\n');
}

/**
 * 差し込み先の答えを検める。★返させるのは1件ぶんの入れ場所だけ。
 * 渡していない時間帯・日付なら null（呼び出し側が既定の置き場所に倒す）。
 */
export function parsePlaceResult(
  raw: unknown,
  options: { allowedBlocks: readonly PlanBlock[]; allowedDays: readonly string[] }
): PlanPlacement | null {
  if (!raw || typeof raw !== 'object') return null;

  const r = raw as { block?: unknown; when?: unknown; why?: unknown };
  if (typeof r.block !== 'string') return null;
  if (!(options.allowedBlocks as readonly string[]).includes(r.block)) return null;
  const block = r.block as PlanBlock;

  let when: string | undefined;
  if (block === 'later') {
    const w = typeof r.when === 'string' ? r.when.trim() : '';
    if (!(options.allowedDays as readonly string[]).includes(w)) return null;
    when = w;
  }

  const why = typeof r.why === 'string' ? r.why.trim() : '';
  // ★理由が長すぎるだけで用事を落とさない。理由のほうを空にして置き場所は採る
  const safeWhy = why.length > MAX_WHY_LENGTH ? '' : why;

  return { block, ...(when ? { when } : {}), why: safeWhy };
}

/* ============================================================
 * 保存する前の検め（APIのPATCHが使う）
 * ========================================================== */

/** PATCH で受け取ってよい本文の長さ。手で書くぶんはAIより長くてよい */
export const MAX_SAVED_TEXT_LENGTH = 200;

/**
 * 画面から送られてきた段取りを検める。★丸ごと置き換えなので、ここが最後の関所。
 * 形が合わない行が1つでもあれば null（部分的に受け取ると、画面の表示と保存がずれる）。
 */
export function validatePlanForSave(
  raw: unknown,
  allowedBlocks: readonly PlanBlock[]
): PlanItem[] | null {
  if (!Array.isArray(raw)) return null;

  const allowed = new Set<string>(allowedBlocks as readonly string[]);
  const seen = new Set<string>();
  const out: PlanItem[] = [];

  for (const row of raw as unknown[]) {
    if (!row || typeof row !== 'object') return null;
    const r = row as Record<string, unknown>;

    if (typeof r.id !== 'string' || !r.id || r.id.length > 64) return null;
    // ★IDの重複は許さない。チェックや削除がどの行に効くか決まらなくなる
    if (seen.has(r.id)) return null;
    seen.add(r.id);

    if (typeof r.block !== 'string' || !allowed.has(r.block)) return null;
    if (typeof r.text !== 'string' || r.text.length > MAX_SAVED_TEXT_LENGTH) return null;

    const why = typeof r.why === 'string' ? r.why : '';
    if (why.length > MAX_SAVED_TEXT_LENGTH) return null;

    const source =
      r.source === 'ai' || r.source === 'user' || r.source === 'todo' ? r.source : 'user';

    const item: PlanItem = {
      id: r.id,
      block: r.block as PlanBlock,
      text: r.text,
      why,
      done: r.done === true,
      source,
    };
    if (typeof r.todoId === 'string' && r.todoId.length <= 128) item.todoId = r.todoId;
    if (r.block === 'later' && typeof r.when === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.when)) {
      item.when = r.when;
    }
    out.push(item);
  }

  return out;
}
