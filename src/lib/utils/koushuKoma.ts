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

/** 計算に必要な進捗行の最小形（画面・API どちらからでも組み立てられる形にしておく） */
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

export interface KoushuKomaSummary {
  /** 申込コマ合計 */
  applied: number;
  /** 実施済みコマ（セッション数ベース） */
  done: number;
  /** 残りコマ。マイナスは申込を超えて実施している状態 */
  remaining: number;
  /** 残りの単元をやり切るのに要るコマ（未消化グループの申込コマの残り合計） */
  needed: number;
  /** remaining - needed。プラス=前倒し / 0=プラン通り / マイナス=このままだと終わらない */
  diff: number;
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
 * needed（残り必要コマ）はグループ単位に max(申込コマ − 実施コマ, 0) を足したもの。
 * 1コマで2グループぶん進めた場合、そのコマは両グループで実施済みと数えられるため、
 * 「残りコマ > 残り必要コマ」＝前倒し、として自然に現れる。逆に1グループに予定より
 * 多くコマを使えば残りコマだけが減り、マイナス（遅れ）になる。
 *
 * 申込コマが1つも無い教材（＝講習ラベルだけで申込が未転記）は applied=0 で返るので、
 * 呼び出し側は applied===0 のときバッジを出さないこと。
 */
export function computeKoushuKoma(rows: KoushuKomaRow[]): KoushuKomaSummary {
  const applied = rows.reduce((sum, r) => sum + (r.applicationCount || 0), 0);
  const done = countKoma(rows.flatMap((r) => r.lessons || []));

  const groups = new Map<string, { planned: number; lessons: Lesson[] }>();
  for (const row of rows) {
    const key = groupKeyOf(row);
    const g = groups.get(key) || { planned: 0, lessons: [] };
    g.planned += row.applicationCount || 0;
    g.lessons.push(...(row.lessons || []));
    groups.set(key, g);
  }

  // tsconfig の target が ES5 系のため Map のイテレータを直接回さない（downlevelIteration 未使用）
  let needed = 0;
  for (const g of Array.from(groups.values())) {
    // 申込コマが無いグループ（提案されなかった単元）は「やり切るべき対象」に含めない。
    // ただしそこに使ったコマは done に入るので、残りコマだけが減って遅れとして現れる。
    if (g.planned <= 0) continue;
    needed += Math.max(g.planned - countKoma(g.lessons), 0);
  }

  const remaining = applied - done;
  return { applied, done, remaining, needed, diff: remaining - needed };
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
