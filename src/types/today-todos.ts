/**
 * ダッシュボード「今日やること」の項目型。
 *
 * コンセプト: 朝の1分で今日の段取りが決まる行動リスト。
 * 月次タスク・報告書・アラート・当日の座席という別々の場所にある情報から
 * 「今日やる理由があるもの」だけを選別し、1本のリストに統合する。
 *
 * ★ 教室の運営（欠勤・未配置・報告書・タスク）と、生徒への用事（申込の締切・面談時期など）は
 *   **分けずに1本に混ぜる**。教室長は「運営か生徒か」で動くのではなく時間の流れで動くため、
 *   種別で分けると同じ時間帯の用事が2箇所に散る（2026-08-31 ユーザー判断）。
 *
 * ★ 生徒への用事を出す意味: 生徒が教室に来ている日は、本人・保護者に直接
 *   「渡す・聞く・案内する」ができる唯一の機会。逃すと電話や郵送になり、手間も遅延も増える。
 *   そのため「今日授業がある生徒 × その生徒の未処理の用事」を突き合わせる。
 */

/** 用事の出どころ。行頭チップの色分けに使う。 */
export type TodayTodoSource =
  /** 当日の座席（欠勤・未配置・体験） */
  | 'seat'
  /** 生徒に紐づく用事（申込の締切・面談時期・成績未入力など。アラート由来） */
  | 'student'
  /** 授業報告書（未提出・承認待ち） */
  | 'report'
  /** 月次タスク */
  | 'task'
  /** 振替期限 */
  | 'transfer'
  /** 教材の配布待ち */
  | 'material';

/** 目立たせ方。high=赤 / medium=橙 / low=通常。 */
export type TodayTodoUrgency = 'high' | 'medium' | 'low';

export interface TodayTodoItem {
  /**
   * 安定ID。「済」の記憶キーになるので、同じ用事なら再読み込みしても同じ値になること。
   * 由来のレコードIDを含めて組み立てる（例: `alert:${alert.id}` / `absence:${date}|${slotId}|${teacherId}`）。
   */
  id: string;
  source: TodayTodoSource;
  /** 行頭チップの文言（例: 欠勤 / 未配置 / 体験 / 申込 / 面談 / 報告書 / タスク / 振替 / 教材） */
  label: string;
  /** やること1行。名詞ではなく行動が分かる文にする（例:「面談の日程を聞く」） */
  title: string;
  /** 補足。期限・件数・内訳など判断材料になるものだけ（例:「締切 9/5（あと5日）」） */
  note?: string;
  /** 生徒に紐づく用事ならその生徒。教室の運営の用事なら undefined。 */
  student?: { id: string; name: string; grade?: number };
  /** 授業に紐づくなら時限番号。並び順の主キーになる。 */
  slotNumber?: number;
  /** 時限の時間帯（例:「16:20〜18:30」）。表示用で、並び順には使わない。 */
  slotTime?: string;
  /** 期限を過ぎている用事。時刻を持たない用事の中で先頭に出す。 */
  overdue?: boolean;
  urgency: TodayTodoUrgency;
  /** クリックしたときの遷移先。無ければ行はクリックできない。 */
  href?: string;
}

/**
 * 並び順の比較関数。
 *
 * 方針は「上から時間順」。教室長は時間の流れどおりに動くため、時限を持つ用事
 * （＝その時間に生徒・講師が教室にいる用事）を時限順に並べ、時間の決まっていない
 * 用事（タスク・報告書）は下にまとめる。下の群では期限超過を先頭にする。
 *
 * 期限超過を全体の先頭に出さないのは、「3限に講師が欠勤」より先に
 * 「請求データの確認（2日超過）」が来ると、当日の動線が読めなくなるため。
 * 期限超過は下の群の先頭＋バッジで気付けるようにする。
 */
export function compareTodayTodos(a: TodayTodoItem, b: TodayTodoItem): number {
  const aTimed = a.slotNumber != null;
  const bTimed = b.slotNumber != null;
  // 時限つきが先、時限なしが後
  if (aTimed !== bTimed) return aTimed ? -1 : 1;
  if (aTimed && bTimed && a.slotNumber !== b.slotNumber) {
    return (a.slotNumber ?? 0) - (b.slotNumber ?? 0);
  }
  // 時限なし群では期限超過を先頭へ
  if (!aTimed && !!a.overdue !== !!b.overdue) return a.overdue ? -1 : 1;
  // 最後は緊急度（高→低）
  const rank: Record<TodayTodoUrgency, number> = { high: 0, medium: 1, low: 2 };
  return rank[a.urgency] - rank[b.urgency];
}
