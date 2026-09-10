/**
 * AIが返した抽出結果を、DBに入れてよい形に落とす。
 *
 * 正典: docs/bulletin-ai-assist.html
 *
 * ★AIの出力をそのまま信じない。カタログに無い種別・知らない対象・壊れた日付は捨てる。
 *   カタログを閉じている意味は「検証する側が有限で済む」ことにあるので、
 *   ここで弾かないと閉じた意味が無くなる。
 */

import {
  TASK_KINDS,
  TASK_SCOPES,
  TASK_DUE_TYPES,
  isTeacherSelfKind,
  type TaskDueType,
  type TaskKind,
  type TaskScope,
} from './taskCatalog';

/** DBに入れる形のタスク1件 */
export interface ExtractedTask {
  kind: TaskKind;
  scope: TaskScope;
  targetGrades: number[];
  /** scope=attending_school のときの対象の通学校（students.school_name の表記そのまま） */
  targetSchoolNames: string[];
  dueType: TaskDueType;
  dueDate: string | null;
  /** 投稿のどこからそう読んだか。画面で教室長に見せる */
  reason: string;
  /**
   * AIがこの依頼の根拠にした投稿の一文（原文のまま）。見つからなければ空文字。
   * ★どこで読み間違えたかを追うために持つ。要約された文では追えないので、
   *   長すぎるもの（＝AIが写さずに作った可能性が高い）は捨てて空にする。
   */
  sourceExcerpt: string;
}

const KIND_SET = new Set<string>(TASK_KINDS);
const SCOPE_SET = new Set<string>(TASK_SCOPES);
const DUE_TYPE_SET = new Set<string>(TASK_DUE_TYPES);

/** 小1(1) 〜 既卒(13)。これ以外の学年は捨てる */
const MIN_GRADE = 1;
const MAX_GRADE = 13;

/** 通学校名1件あたりの上限文字数。長すぎるものはAIが読み違えているので捨てる */
const MAX_SCHOOL_NAME_LEN = 30;
/** 通学校の指定はこの件数まで。1投稿でこれを超えるのは読み違えている */
const MAX_SCHOOL_NAMES = 10;

/** 1つの投稿から取るタスクの上限。これを超えるのは読み違えているので切る */
const MAX_TASKS_PER_POST = 5;

/**
 * 根拠の一文の上限。プロンプトでは40字と指示しているが、少しの超過は許す。
 * ★これを超えたら「そのまま写す」に従っていない（要約や作文をしている）と見なして捨てる。
 *   要約された文は読み間違いの追跡に使えないので、中途半端に残すより空のほうがよい。
 */
const MAX_SOURCE_EXCERPT_LEN = 60;

/** 根拠の一文を整える。改行はカードの1行に収まらないので空白に潰す */
function normalizeSourceExcerpt(value: unknown): string {
  if (typeof value !== 'string') return '';
  const text = value.replace(/[\r\n]+/g, ' ').trim();
  if (text.length === 0 || text.length > MAX_SOURCE_EXCERPT_LEN) return '';
  return text;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  // 2026-02-31 のような存在しない日を弾く（Dateは繰り上げてしまう）
  return d.toISOString().slice(0, 10) === value;
}

/**
 * AIの生の出力を検証して、入れてよいものだけ返す。
 *
 * ★捨てた件数は返さない。ここで弾かれるのは「AIが一覧を無視した」ときだけで、
 *   運用で気にする値ではない。気にすべきは抽出そのものの精度で、それは
 *   教室長が投稿直後に見て「追跡しない」に落とせることで担保する。
 */
export function parseExtractedTasks(raw: unknown): ExtractedTask[] {
  const tasks = (raw as { tasks?: unknown })?.tasks;
  if (!Array.isArray(tasks)) return [];

  const out: ExtractedTask[] = [];

  for (const item of tasks) {
    if (!item || typeof item !== 'object') continue;
    const t = item as Record<string, unknown>;

    // ★カタログに無い種別・対象は捨てる
    const kind = typeof t.kind === 'string' && KIND_SET.has(t.kind) ? (t.kind as TaskKind) : null;
    if (!kind) continue;

    let scope =
      typeof t.scope === 'string' && SCOPE_SET.has(t.scope) ? (t.scope as TaskScope) : null;
    if (!scope) continue;

    // ★シフト提出などは生徒に紐づかない。AIが生徒向けの対象を選んでいても、種別のほうを優先する
    //   （完了履歴の student_id が NULL になる種別なので、生徒で配ると数えられなくなる）
    if (isTeacherSelfKind(kind)) scope = 'teacher_self';

    const dueType =
      typeof t.due_type === 'string' && DUE_TYPE_SET.has(t.due_type)
        ? (t.due_type as TaskDueType)
        : 'none';

    // 日付が壊れていたら期限なしに落とす（当日・超過の強制表示が誤爆するのを防ぐ）
    const rawDate = typeof t.due_date === 'string' ? t.due_date : null;
    const hasValidDate = rawDate != null && isValidDate(rawDate);
    const dueDate = dueType === 'date' && hasValidDate ? rawDate : null;
    const finalDueType: TaskDueType = dueType === 'date' && !hasValidDate ? 'none' : dueType;

    const targetGrades = Array.isArray(t.target_grades)
      ? Array.from(
          new Set(
            t.target_grades.filter(
              (g): g is number =>
                typeof g === 'number' && Number.isInteger(g) && g >= MIN_GRADE && g <= MAX_GRADE
            )
          )
        ).sort((a, b) => a - b)
      : [];

    // ★文字列配列・各30字・最大10件・trim・重複除去。長すぎる／多すぎるのはAIが読み違えている
    const rawSchoolNames = Array.isArray(t.target_school_names) ? t.target_school_names : [];
    const targetSchoolNames = Array.from(
      new Set(
        rawSchoolNames
          .filter((n): n is string => typeof n === 'string')
          .map((n) => n.trim())
          .filter((n) => n.length > 0 && n.length <= MAX_SCHOOL_NAME_LEN)
      )
    ).slice(0, MAX_SCHOOL_NAMES);

    out.push({
      kind,
      scope,
      // scope が grade でないなら学年の絞りは持たせない
      targetGrades: scope === 'grade' ? targetGrades : [],
      // scope が attending_school でないなら通学校の絞りは持たせない
      targetSchoolNames: scope === 'attending_school' ? targetSchoolNames : [],
      dueType: finalDueType,
      dueDate,
      reason: typeof t.reason === 'string' ? t.reason.slice(0, 200) : '',
      sourceExcerpt: normalizeSourceExcerpt(t.source_excerpt),
    });
  }

  // ★同じ種別×対象は1件にまとめる。同じ依頼を2度数えると進捗が割れる
  //   通学校（target_school_names）が違えば別の依頼として扱う
  //  （「諏訪中生」と「永山中生」は同じ種別でも母数が別なので束ねない）
  const seen = new Set<string>();
  const deduped = out.filter((t) => {
    const key = `${t.kind}::${t.scope}::${[...t.targetSchoolNames].sort().join(',')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return deduped.slice(0, MAX_TASKS_PER_POST);
}

/* ============================================================
 * 再掲のまとめ方
 * ========================================================== */

/** 既にあるタスクのうち、再掲の突き合わせに使う最小限 */
export interface OpenTask {
  id: string;
  kind: TaskKind;
  scope: TaskScope;
  dueDate: string | null;
  /** scope=attending_school のときの対象の通学校。それ以外・未設定なら空 */
  targetSchoolNames?: string[];
}

/** 通学校の集合が同じか（順序は無視する） */
function sameSchoolNames(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const as = [...a].sort();
  const bs = [...b].sort();
  return as.every((v, i) => v === bs[i]);
}

/**
 * 抽出したタスクが、すでにあるタスクの「再掲」かどうかを判定する。
 *
 * ★同じ依頼が繰り返し投稿される（通知表回収は4教室で8投稿、清瀬校だけで4回）。
 *   投稿ごとに別タスクを作ると、進捗が投稿のたびにリセットされてしまう。
 *   同じものは1本の継続タスクに束ね、投稿だけを足していく。
 *
 * ★突き合わせは「種別と対象が同じ」で見る。期限は再掲のたびに延びるので条件に入れない
 *   （7/31が8/10に延びても、同じ通知表回収の依頼である）。
 *   ★対象には通学校（target_school_names）も含める。「諏訪中生」と「永山中生」は
 *   同じ種別でも母数が別の依頼なので、別のタスクとして扱う。
 *
 * @returns 束ねる先のタスク。無ければ null（新規作成する）
 */
export function findReminderTarget(
  task: ExtractedTask,
  openTasks: readonly OpenTask[]
): OpenTask | null {
  return (
    openTasks.find(
      (o) =>
        o.kind === task.kind &&
        o.scope === task.scope &&
        sameSchoolNames(o.targetSchoolNames ?? [], task.targetSchoolNames)
    ) ?? null
  );
}

/**
 * 再掲で期限が変わったか。変わっていれば継続タスクの期限を更新する。
 * ★期限が縮む（前倒し）ことも延びることもあるので、単純に新しい値で上書きする。
 */
export function shouldUpdateDueDate(task: ExtractedTask, target: OpenTask): boolean {
  if (task.dueType !== 'date' || task.dueDate == null) return false;
  return task.dueDate !== target.dueDate;
}
