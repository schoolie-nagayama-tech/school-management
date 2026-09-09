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

import { toSurnameOnly } from '@/lib/utils/teacherName';

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
 * APIが1回に受け取ってよい「今日やること」の件数。
 * ★画面が送ってくる件数の上限で、材料に載せる件数（MAX_PLAN_TODOS）とは別。
 *   ここで一度受けてから、重要なものだけを材料に残す。
 */
export const MAX_INPUT_TODOS = 100;
/** 材料に載せる用事の上限。★多すぎると各時間帯4件に収まらず、AIが黙って落とす */
export const MAX_PLAN_TODOS = 50;
/**
 * 受け取った用事の本文・補足の上限。★超えたぶんは切る。
 *   AIの出力（切り詰めない＝行ごと捨てる）と扱いが違うのは、こちらが自分の画面から
 *   来たデータで、捨てると用事そのものが段取りから消えてしまうため。
 */
export const MAX_TODO_TEXT_LENGTH = 120;
/** カレンダーのタイトルの上限。★長い予定名でプロンプトが膨らむのを防ぐだけ */
export const MAX_CALENDAR_TITLE_LENGTH = 120;

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

/**
 * AIに渡す用事1件。
 *
 * ★これは画面の「今日やること」（TodayTodoItem）を写したもの。
 *   段取りのためにサーバーで用事を集め直さない。別々に集めると、同じ画面の上と下で
 *   違う用事が並び、どちらが正しいか分からなくなる（2026-09-09 決定）。
 *
 * ★生徒は姓のみ。フルネームも連絡先もAIに渡さない。
 */
export interface PlanTodo {
  /** 「今日やること」の安定ID。todoId の突き合わせに使う */
  id: string;
  /** 行頭チップの文言（面談 / 教材 / 報告書 / タスク など） */
  label: string;
  /** やること1行（TodayTodoItem.title） */
  text: string;
  /** 補足。締切・件数など判断材料になるもの */
  note?: string;
  /** ★姓のみ */
  studentSurname?: string;
  /** その用事に紐づく時限。★これがあるので「どのコマに来る生徒か」をAIに推測させずに済む */
  slotNumber?: number;
  /** 期限を過ぎている */
  overdue?: boolean;
  /** 緊急度が高い（TodayTodoItem.urgency === 'high'） */
  urgent?: boolean;
}

/** その日のカレンダーの予定。★タイトルは教室長自身の予定なのでそのまま渡す */
export interface PlanCalendarEvent {
  /** 'HH:MM' */
  start: string;
  /** 'HH:MM' */
  end: string;
  title: string;
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
  /** 今日やること。★画面の「今日やること」から渡ってくる（サーバーで集め直さない） */
  todos: PlanTodo[];
  /** 教室長のGoogleカレンダーの予定。未連携・取得失敗なら空 */
  calendar: PlanCalendarEvent[];
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
 * 「今日やること」を材料にする
 * ========================================================== */

/**
 * 画面から送られてきた「今日やること」を、材料に載せてよい形にする。
 *
 * ★1件ずつ検める。読めない要素があっても残りは使う
 *   （1件おかしいだけで段取りが組めなくなるほうが最悪）。
 *
 * ★生徒はここで姓だけに落とす。画面はフルネームを持っているが、AIには渡さない。
 *
 * @param raw 画面が送ってきた TodayTodoItem の配列（信用しない）
 */
export function sanitizePlanTodos(raw: unknown): PlanTodo[] {
  if (!Array.isArray(raw)) return [];

  const out: PlanTodo[] = [];
  const seen = new Set<string>();

  for (const row of raw as unknown[]) {
    if (out.length >= MAX_INPUT_TODOS) break;
    if (!row || typeof row !== 'object') continue;

    const r = row as {
      id?: unknown;
      label?: unknown;
      title?: unknown;
      note?: unknown;
      student?: unknown;
      slotNumber?: unknown;
      overdue?: unknown;
      urgency?: unknown;
    };

    // ID と本文が無いものは、あとで todoId の突き合わせもできないので捨てる
    if (typeof r.id !== 'string') continue;
    const id = r.id.trim();
    if (!id || id.length > 128) continue;
    // ★同じIDが2回来たら後は無視（todoId がどちらを指すか決まらなくなる）
    if (seen.has(id)) continue;

    if (typeof r.title !== 'string') continue;
    const text = r.title.replace(/\s+/g, ' ').trim().slice(0, MAX_TODO_TEXT_LENGTH);
    if (!text) continue;

    const label = typeof r.label === 'string' ? r.label.replace(/\s+/g, ' ').trim() : '';
    const note =
      typeof r.note === 'string'
        ? r.note.replace(/\s+/g, ' ').trim().slice(0, MAX_TODO_TEXT_LENGTH)
        : '';

    // ★姓だけにする。画面は「山田 太郎」を持っているが、渡すのは「山田」
    const studentName =
      r.student && typeof r.student === 'object'
        ? (r.student as { name?: unknown }).name
        : undefined;
    const studentSurname =
      typeof studentName === 'string' ? toSurnameOnly(studentName).slice(0, 32) : '';

    // 時限は整数のときだけ採る。小数や文字列で来たら、その項目は残して時限だけ落とす
    const slotNumber =
      typeof r.slotNumber === 'number' && Number.isInteger(r.slotNumber) && r.slotNumber > 0
        ? r.slotNumber
        : undefined;

    seen.add(id);
    out.push({
      id,
      label,
      text,
      ...(note ? { note } : {}),
      ...(studentSurname ? { studentSurname } : {}),
      ...(slotNumber != null ? { slotNumber } : {}),
      ...(r.overdue === true ? { overdue: true } : {}),
      ...(r.urgency === 'high' ? { urgent: true } : {}),
    });
  }

  return out;
}

/**
 * 材料に載せる用事を選ぶ。
 *
 * ★上限を超えるときに切るのは「重要でないもの」から。
 *   期限超過 → 緊急 → 時限がある（＝その時間に人が教室にいる） の順で残す。
 *   残ったものは、元の並び（時間順）のまま返す。
 */
export function selectPlanTodos(todos: readonly PlanTodo[], limit = MAX_PLAN_TODOS): PlanTodo[] {
  if (todos.length <= limit) return todos.slice();

  const rank = (t: PlanTodo): number => {
    if (t.overdue) return 0;
    if (t.urgent) return 1;
    if (t.slotNumber != null) return 2;
    return 3;
  };

  const keep = new Set(
    todos
      .map((t, index) => ({ t, index }))
      // 同じ重さなら元の並び（時間順）を保つ
      .sort((a, b) => rank(a.t) - rank(b.t) || a.index - b.index)
      .slice(0, limit)
      .map((x) => x.index)
  );

  return todos.filter((_, index) => keep.has(index));
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
    '  用事に「N限」と書いてあるなら、そのコマに置くこと。',
    '  時限が書かれていない用事は、その生徒の授業があるコマを探して置くこと。',
    '- 誰にも紐づかない用事（報告書・タスクなど）は、授業前か片付けに置く。',
    '- ★カレンダーの予定が入っている時間帯には用事を置かない。',
    '  予定そのものも項目として出し、その時間に何があるかが分かるようにする',
    '  （カレンダーから作る項目に todoId は付けない）。',
    '- ★カレンダーで来塾する予定（面談など）があるなら、',
    '  その人に渡すものはその時間に置いてよい（授業に来ない生徒でも、面談で来るなら渡せます）。',
    `- 各時間帯は 0〜${MAX_ITEMS_PER_BLOCK}件。詰め込みすぎると結局どれもやりません。`,
    '- 「期限超過」「急ぎ」と書かれた用事は、先に置ける時間帯に置く。',
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

  /**
   * 用事1件を1行に。★形は `[チップ] やること（生徒の姓・N限・期限超過）`。
   * 画面の「今日やること」の見え方に合わせてあるので、
   * 出てきた段取りと下の一覧を並べて見たときに同じ用事だと分かる。
   */
  const todoLines = materials.todos.map((t) => {
    const marks: string[] = [];
    if (t.studentSurname) marks.push(t.studentSurname);
    if (t.slotNumber != null) marks.push(`${t.slotNumber}限`);
    if (t.overdue) marks.push('期限超過');
    if (t.urgent) marks.push('急ぎ');
    if (t.note) marks.push(flat(t.note));
    const chip = t.label ? `[${flat(t.label)}] ` : '';
    return `- ${t.id}: ${chip}${flat(t.text)}${marks.length > 0 ? `（${marks.join('・')}）` : ''}`;
  });

  const calendarLines = materials.calendar.map((c) => `- ${c.start}〜${c.end} ${flat(c.title)}`);

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
    '【カレンダーの予定（この時間には用事を置かない。予定そのものも項目に出す）】',
    ...(calendarLines.length > 0 ? calendarLines : ['- なし']),
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
    '- ★カレンダーの予定が入っている時間帯は避ける。',
    '  ただし、その予定で来塾する人に渡すものなら、その時間に置いてよい。',
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
