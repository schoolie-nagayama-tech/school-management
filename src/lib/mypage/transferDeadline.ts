/**
 * 振替締切の判定（JST基準の純関数）。
 *
 * 正典: docs/portal-v2-requirements.md §7-2「振替ルール（2026-07-14 追加確定）」
 *   締切 = 対象授業の「前日 21:00（JST）」まで。
 *   締切後（前日21:00以降〜当日）は振替不可＝欠席のみ受け付ける。
 *
 * ★ なぜ純関数として切り出すか:
 *   この判定はクライアント（振替希望トグルの無効化）とサーバー（改ざん対策の再検証）の
 *   両方で使う。UTCで動くサーバー環境でも必ずJSTで計算するため、Date のローカルTZに
 *   依存しない実装にする（UTCエポックで固定オフセット計算）。
 *
 * JST = UTC+9。前日21:00(JST) は UTC では前日12:00。よって締切の絶対時刻(UTC)は
 *   Date.UTC(y, m-1, d-1, 12, 0, 0)
 * となる（対象授業日 y-m-d の前日12:00 UTC = 前日21:00 JST）。
 */

/** 'YYYY-MM-DD' を厳密にパースして [年, 月(1-12), 日] を返す。不正なら null。 */
function parseYmd(dateStr: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return [y, mo, d];
}

/**
 * 対象授業日（JSTカレンダー日 'YYYY-MM-DD'）に対する振替締切の絶対時刻(ms, UTCエポック)。
 * = 前日 21:00 JST = 前日 12:00 UTC。
 *
 * @returns 締切のエポックms。dateStr が不正なら null。
 */
export function transferDeadlineMs(lessonDate: string): number | null {
  const parsed = parseYmd(lessonDate);
  if (!parsed) return null;
  const [y, mo, d] = parsed;
  // Date.UTC は day=0 や負値も繰り下げてくれるので、前日 = d-1 をそのまま渡してよい
  // （月初 d=1 のとき d-1=0 → 前月末日の12:00 UTC に正しく繰り下がる）。
  return Date.UTC(y, mo - 1, d - 1, 12, 0, 0, 0);
}

/**
 * 「振替締切を過ぎているか」を返す（過ぎていれば振替不可＝欠席のみ）。
 *
 * 境界（§7-2 の確定仕様・テストで固定）:
 *   - 前日 20:59(JST) → まだ可（false）
 *   - 前日 21:00(JST) ちょうど → 不可（true）… 締切「まで」なので21:00到達で締切
 *   - 当日 → 不可（true）
 *
 * @param lessonDate 対象授業日 'YYYY-MM-DD'（JSTカレンダー日）
 * @param now        判定基準時刻（省略時は現在）。テスト用に注入可能。
 * @returns 締切超過なら true（振替不可）。dateStr 不正時は安全側に倒し true。
 */
export function isTransferDeadlinePassed(lessonDate: string, now: Date = new Date()): boolean {
  const deadline = transferDeadlineMs(lessonDate);
  if (deadline == null) return true; // パース不能は「振替させない」安全側
  return now.getTime() >= deadline;
}
