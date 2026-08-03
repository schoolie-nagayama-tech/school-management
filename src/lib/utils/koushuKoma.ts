/**
 * 講習の残りコマ計算（進行表の申込コマ vs 実施コマ）
 *
 * 「このままプラン通りに終わるのか」を進行表だけで判定するための純関数群。
 * DB へは触らず、呼び出し側が渡した進捗行から計算する（画面/一覧/フィードで同じ数字を出すため
 * 定義はこのファイル1か所に集約する。定義を変えるならここだけを変えること）。
 *
 * ★ コマの数え方（重要）
 *   指導日セルの数 ≠ コマ数。1コマの授業で複数単元を進めるのが常態で、本番実測でも
 *   1コマあたり平均1.8単元進んでいる（夏期: 指導日セル4523件 / セッション2353件）。
 *   そのため実施コマは progress_sessions（= 1コマ1セッション）の distinct 数で数える。
 *   直接入力でセッションが無い指導日（実測3.8%）は日付で1コマとみなす。
 *
 * ★ 申込コマの持ち方
 *   student_progress.application_count は「結合グループの先頭行に合計・他は0」の規約で
 *   保存されている（syncApplicationToProgress）。よって単純合算で二重計上にならない。
 *
 * ★ グループの単位
 *   申込結合(applied_group_number) → 提案結合(group_number) → 単独行、の順に使う。
 *   本番では提案結合だけがあって申込結合が無い教材が多数派のため、両方を見る必要がある。
 */

/**
 * 計算に必要な進捗行の最小形（画面・API どちらからでも組み立てられる形にしておく）。
 *
 * ★ 配列は必ず**カリキュラム順（進行表の表示順）**で渡すこと。
 *   「そのグループより先へ進んでいるか」を並び順から判断しているため、順不同で渡すと
 *   やり切り判定が崩れる。
 */
export interface KoushuKomaRow {
  /** 行の識別子（グループに属さない行のグループキーに使う） */
  rowKey: string | number;
  /** 申込コマ数（結合グループでは先頭行に合計、他は0） */
  applicationCount: number;
  /** 申込結合番号 */
  appliedGroupNumber?: number | null;
  /** 提案結合番号 */
  groupNumber?: number | null;
  /** この単元の指導記録 */
  lessons: { lesson_date?: string | null; session_id?: string | null }[];
}

/** 結合グループ単位の消化状況（どのグループでズレたかを行に出すために使う） */
export interface KoushuGroupStat {
  /** グループキー（申込結合 → 提案結合 → 単独行） */
  key: string;
  /** 予定コマ（グループの申込コマ合計） */
  planned: number;
  /** 消化コマ */
  consumed: number;
  /** グループ内の全単元に指導日が入っているか（＝1回は触った） */
  allTaught: boolean;
  /** やり切ったと判断したか（allTaught かつ、より後ろの単元に指導実績がある） */
  finished: boolean;
  /** consumed - planned。マイナス=予定より少ないコマで終えた / プラス=予定より多く使った */
  delta: number;
  /** 予定コマを表示している行（application_count>0 の先頭行。無ければグループ先頭行） */
  anchorRowKey: string | number;
}

export interface KoushuKomaSummary {
  /** 申込コマ合計 */
  applied: number;
  /** 実施済みコマ（セッション数ベース） */
  done: number;
  /** 残りコマ。マイナスは申込を超えて実施している状態 */
  remaining: number;
  /** 残りの単元をやり切るのに要るコマ（未完了グループの申込コマの残り合計） */
  needed: number;
  /** remaining - needed。プラス=前倒し / 0=プラン通り / マイナス=このままだと終わらない */
  diff: number;
  /** グループ単位の内訳（予定と実施がズレた箇所を特定するため） */
  groups: KoushuGroupStat[];
}

type Lesson = { lesson_date?: string | null; session_id?: string | null };

/**
 * 指導記録の集合をコマ数に換算する。
 *
 * セッションIDがあるものは distinct session_id で数え、セッションが無い直接入力ぶんは
 * 日付で1コマとみなす。ただしセッションと同じ日付の直接入力は同じコマの記録とみなして
 * 数えない（二重計上を避ける）。同日に同教材で2コマある場合、セッション経由なら正しく2、
 * 直接入力だけなら1に丸まる（＝残りを多めに見せる安全側）。
 */
function countKoma(lessons: Lesson[]): number {
  const taught = lessons.filter((l) => !!l.lesson_date);
  const sessionIds = new Set<string>();
  const sessionDates = new Set<string>();
  for (const l of taught) {
    if (l.session_id) {
      sessionIds.add(l.session_id);
      sessionDates.add(l.lesson_date as string);
    }
  }
  const manualDates = new Set<string>();
  for (const l of taught) {
    if (!l.session_id && !sessionDates.has(l.lesson_date as string)) {
      manualDates.add(l.lesson_date as string);
    }
  }
  return sessionIds.size + manualDates.size;
}

/** 行が属するグループのキー（申込結合 → 提案結合 → 単独行） */
function groupKeyOf(row: KoushuKomaRow): string {
  if (row.appliedGroupNumber != null) return `a:${row.appliedGroupNumber}`;
  if (row.groupNumber != null) return `g:${row.groupNumber}`;
  return `r:${row.rowKey}`;
}

/**
 * 進捗行から講習のコマ状況を計算する。
 *
 * needed（残り必要コマ）はグループ単位の残りを足したもので、判定はこの2種類で決まる:
 * - **やり切ったグループは残り0**。予定を使い切っていなくても借金は残らない。
 *   例: 「比例の式・反比例の式」を2コマ予定で1コマで終わらせたら、浮いた1コマは前倒しになる。
 *   ★これを入れないと、終わった単元がいつまでも1コマ要求し続けて「プラン通り」に見えてしまう
 *   （本番の実例で発覚: 残りコマ6・進行表の残り予定5なのに判定が0＝プラン通りと出ていた）。
 * - 未完了グループは max(申込コマ − 実施コマ, 0)。予定より多く使えば残りコマだけが減り、
 *   マイナス（遅れ）になる。
 *
 * ★「やり切った」の判定に *より後ろの単元に指導実績があること* を要求している理由:
 *   全単元に1回ずつ日付が入っただけでは終わったとは限らない（同じ単元の2回目・3回目を
 *   次のコマでやる進め方が普通にある）。1コマ目を終えた直後に「前倒し」と言い切ると
 *   2回目が来た瞬間に評価が逆転してしまう。先の単元に進んでいれば戻らないと判断できる。
 *   最前線のグループは判定を保留（＝残り必要を多めに見る安全側）にし、実際に2回目が
 *   入れば消化コマが増えてズレは自然に解消する。
 *
 * 申込コマが1つも無い教材（＝講習ラベルだけで申込が未転記）は applied=0 で返るので、
 * 呼び出し側は applied===0 のときバッジを出さないこと。
 */
export function computeKoushuKoma(rows: KoushuKomaRow[]): KoushuKomaSummary {
  const applied = rows.reduce((sum, r) => sum + (r.applicationCount || 0), 0);
  const done = countKoma(rows.flatMap((r) => r.lessons || []));

  type Bucket = {
    planned: number;
    lessons: Lesson[];
    /** グループ内に指導日の無い単元が1つでもあれば未着手の単元が残っている */
    untaughtUnits: number;
    /** グループが占める行の最後の位置（「ここより先に進んだか」の判定に使う） */
    lastIndex: number;
    anchorRowKey: string | number;
    /** anchor を application_count>0 の行に寄せたか（最初の1回だけ上書きする） */
    anchorFixed: boolean;
  };

  // 指導実績のある一番後ろの行。ここより手前のグループは「もう先へ進んだ」と判断できる。
  let frontierIndex = -1;
  rows.forEach((row, index) => {
    if ((row.lessons || []).some((l) => !!l.lesson_date)) frontierIndex = index;
  });

  const groups = new Map<string, Bucket>();
  rows.forEach((row, index) => {
    const key = groupKeyOf(row);
    const g: Bucket = groups.get(key) || {
      planned: 0,
      lessons: [],
      untaughtUnits: 0,
      lastIndex: index,
      anchorRowKey: row.rowKey,
      anchorFixed: false,
    };
    g.planned += row.applicationCount || 0;
    g.lessons.push(...(row.lessons || []));
    if (!(row.lessons || []).some((l) => !!l.lesson_date)) g.untaughtUnits++;
    g.lastIndex = index;
    // 予定コマの数字が出ている行にマーカーを出したいので、そこを anchor にする
    if (!g.anchorFixed && (row.applicationCount || 0) > 0) {
      g.anchorRowKey = row.rowKey;
      g.anchorFixed = true;
    }
    groups.set(key, g);
  });

  // tsconfig の target が ES5 系のため Map のイテレータを直接回さない（downlevelIteration 未使用）
  const groupStats: KoushuGroupStat[] = [];
  let needed = 0;
  for (const [key, g] of Array.from(groups.entries())) {
    const consumed = countKoma(g.lessons);
    const allTaught = g.untaughtUnits === 0;
    // 全単元に触れていても、まだ最前線なら次のコマで2回目をやるかもしれない＝やり切ったと決めない
    const finished = allTaught && g.lastIndex < frontierIndex;
    groupStats.push({
      key,
      planned: g.planned,
      consumed,
      allTaught,
      finished,
      delta: consumed - g.planned,
      anchorRowKey: g.anchorRowKey,
    });
    // 申込コマが無いグループ（提案されなかった単元）は「やり切るべき対象」に含めない。
    // ただしそこに使ったコマは done に入るので、残りコマだけが減って遅れとして現れる。
    if (g.planned <= 0) continue;
    needed += finished ? 0 : Math.max(g.planned - consumed, 0);
  }

  const remaining = applied - done;
  return { applied, done, remaining, needed, diff: remaining - needed, groups: groupStats };
}

/**
 * 「予定と実施がズレたグループ」だけを取り出す。進行表の該当行に印を出す用。
 *
 * 対象は「予定コマがあり」「1コマ以上やっていて」「予定と実施が違う」グループ。
 * まだ手を付けていないグループ(consumed=0)はズレではなく単なる未実施なので出さない。
 * 未完了のまま予定を使い切っていないだけ（例: 2コマ予定で1コマ実施・単元がまだ残っている）も
 * ズレではないので、`finished` なものと使いすぎのものだけを返す。
 */
export function koushuGroupDeviations(summary: KoushuKomaSummary): KoushuGroupStat[] {
  return summary.groups.filter(
    (g) => g.planned > 0 && g.consumed > 0 && g.delta !== 0 && (g.finished || g.delta > 0)
  );
}

export type KoushuPaceTone = 'ahead' | 'onplan' | 'behind';

/**
 * 判定バッジの文言と色調。
 * 「残り何コマか」ではなく「プランに対して足りているか」を1語で言い切る。
 */
export function koushuPaceLabel(summary: KoushuKomaSummary): {
  text: string;
  tone: KoushuPaceTone;
} {
  const { diff, remaining } = summary;
  // 申込を超えて実施している場合は残りコマ自体がマイナス。まずそれを言う。
  if (remaining < 0) return { text: `${-remaining}コマ超過`, tone: 'behind' };
  if (diff > 0) return { text: `+${diff}コマ前倒し`, tone: 'ahead' };
  if (diff < 0) return { text: `${-diff}コマ不足`, tone: 'behind' };
  return { text: 'プラン通り', tone: 'onplan' };
}

/** バッジ配色（Tailwind クラス）。3か所（進行表・カード・確認フィード）で同じ色にする */
export const KOUSHU_PACE_CLASS: Record<KoushuPaceTone, string> = {
  ahead: 'bg-emerald-50 text-emerald-800 border-emerald-300',
  onplan: 'bg-gray-50 text-gray-700 border-gray-300',
  behind: 'bg-red-50 text-red-800 border-red-300',
};
