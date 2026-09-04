/**
 * 授業中ポップアップを「いつ出すか」を決める部分。
 *
 * 正典: docs/bulletin-ai-assist.html §3
 *
 * ★起動と表示を分ける。「授業を記録」は授業の前に押されるので、そこで出すのは早すぎる。
 *   押した時点では見張りを起動するだけにして、途中でDBを照合し直し、
 *   まだ残っていればAIがその場で出すかどうかを決める。
 *
 * ★ここはプログラムが決める側。AIに渡す前に、呼ぶかどうかまでを機械的に絞る。
 *   - 未対応が0件ならAIを呼ばない（大半の授業がこれに当たる。費用がゼロで済む）
 *   - 期限当日・超過はAIを通さず強制表示する
 *   - 残り15分を切ったら出さない（生徒が帰ってしまえば意味がない）
 *   - 1コマにつき1件だけ。出したらその授業ではもう出さない
 */

/** 経過のチェックポイント。1/3 と 2/3 の2回だけ照合する */
export type Checkpoint = 'first' | 'second';

/** ポップアップを出すかどうかの、プログラム側の判断 */
export type TimingDecision =
  | { action: 'skip'; reason: 'no_pending' } // 未対応が無い。AIを呼ばない
  | { action: 'skip'; reason: 'already_shown' } // 今日この授業でもう出した
  | { action: 'skip'; reason: 'too_late' } // 残り時間が足りない
  | { action: 'skip'; reason: 'not_checkpoint' } // まだ照合の時刻ではない
  | { action: 'force'; checkpoint: Checkpoint } // 期限当日・超過。AIを通さず出す
  | { action: 'ask_ai'; checkpoint: Checkpoint }; // AIに出すか判断させる

/**
 * これ以降は出さない残り時間（分）。
 * ★生徒が帰ってしまえば、生徒に聞くタイプのタスクは意味がない。
 */
export const CUTOFF_MINUTES_BEFORE_END = 15;

/** チェックポイントとみなす幅（分）。ちょうどの分に当たらなくても拾う */
const CHECKPOINT_WINDOW = 4;

/** 経過が 1/3・2/3 のどちらかの近くにいるか */
export function checkpointAt(elapsedMinutes: number, totalMinutes: number): Checkpoint | null {
  if (totalMinutes <= 0) return null;
  const first = totalMinutes / 3;
  const second = (totalMinutes * 2) / 3;
  // 2/3 を先に見る。両方の窓が重なる短いコマでは、遅いほうを採る
  if (Math.abs(elapsedMinutes - second) <= CHECKPOINT_WINDOW) return 'second';
  if (Math.abs(elapsedMinutes - first) <= CHECKPOINT_WINDOW) return 'first';
  return null;
}

export interface TimingInput {
  elapsedMinutes: number;
  totalMinutes: number;
  /** 実データで再照合した結果、まだ残っている未対応の件数 */
  pendingCount: number;
  /** この授業でもう出したか。1コマ1件だけなので、出したら終わり */
  alreadyShown: boolean;
  /** 未対応のうち、期限が今日または過ぎているものがあるか */
  hasDueTodayOrOverdue: boolean;
}

/**
 * 出すかどうかを決める。AIを呼ぶのは ask_ai のときだけ。
 *
 * ★判断の順番に意味がある。0件・表示済みを先に落とすことで、
 *   大半の授業でAIを一度も呼ばずに済む（費用が効くのはここ）。
 */
export function decideTiming(input: TimingInput): TimingDecision {
  // 未対応0件。冒頭で講師が自分でやった場合もここに来る。最も多いケース
  if (input.pendingCount <= 0) return { action: 'skip', reason: 'no_pending' };

  // 1コマにつき1件だけ
  if (input.alreadyShown) return { action: 'skip', reason: 'already_shown' };

  // 残りが少なければ、生徒に聞く時間が無い
  const remaining = input.totalMinutes - input.elapsedMinutes;
  if (remaining < CUTOFF_MINUTES_BEFORE_END) return { action: 'skip', reason: 'too_late' };

  const checkpoint = checkpointAt(input.elapsedMinutes, input.totalMinutes);
  if (!checkpoint) return { action: 'skip', reason: 'not_checkpoint' };

  // ★期限当日・超過はAIの判断を待たない。プログラム側で強制的に出す
  if (input.hasDueTodayOrOverdue) return { action: 'force', checkpoint };

  return { action: 'ask_ai', checkpoint };
}

/**
 * 期限が今日または過ぎているか。
 * @param dueDate YYYY-MM-DD。期限なしは null
 * @param today YYYY-MM-DD
 */
export function isDueTodayOrOverdue(dueDate: string | null, today: string): boolean {
  if (!dueDate) return false;
  return dueDate <= today;
}

/** 期限までの残り日数（負なら超過）。期限なしは null */
export function daysUntilDue(dueDate: string | null, today: string): number | null {
  if (!dueDate) return null;
  const due = new Date(`${dueDate}T00:00:00Z`).getTime();
  const now = new Date(`${today}T00:00:00Z`).getTime();
  if (Number.isNaN(due) || Number.isNaN(now)) return null;
  return Math.round((due - now) / 86_400_000);
}
