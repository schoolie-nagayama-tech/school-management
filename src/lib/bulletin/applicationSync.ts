/**
 * 実データから申込状況のチェックを自動で付けるときの規約。
 *
 * 正典: docs/bulletin-ai-assist.html
 *
 * ★なぜ規約を関数にして切り出すか:
 *   「自動が書き込んでよいか」の判断を書く場所が散らばると、必ずどこかで抜けて
 *   教室長が外したチェックを自動が付け直す。判断はここ1か所に置く。
 */

/** 申込状況の行のうち、自動判定に必要な最小限 */
export interface ApplicationRowState {
  /** 行が存在するか */
  exists: boolean;
  /** 'manual' = 人が触った ／ 'auto' = 実データから自動で付いた */
  setBy?: 'manual' | 'auto';
}

/**
 * 自動でチェックを書き込んでよいか。
 *
 * ★書いてよいのは「行が無い」か「前回も自動で付けた」ときだけ。
 *   人が触った行には二度と触らない。
 *
 *   - 行が無い → まだ誰も触っていないので自動で付けてよい
 *   - set_by='auto' → 前回も自動。実データが変わったら追随してよい
 *   - set_by='manual' → 人の判断。付けた／外した／対象外にした のどれであっても尊重する
 *
 *   既存の行はすべて set_by='manual'（列の既定値）なので、
 *   導入時点で入っている「対象外」を自動が「完了」で塗り替える事故は起きない。
 */
export function canAutoWrite(row: ApplicationRowState): boolean {
  if (!row.exists) return true;
  return row.setBy === 'auto';
}

/**
 * 人がチェックを外すとき、行を消してよいか。
 *
 * ★自動で付いた行は消してはいけない。消すと「まだ付けていない」と区別できず、
 *   次の同期で自動が付け直してしまう。status を空にして set_by='manual' で残し、
 *   「人が外した」という事実を持たせる。
 *
 *   人が自分で付けた行は、消しても自動が付け直すことはない（元から manual なので
 *   canAutoWrite が false）。従来どおり消してよい。
 */
export function canDeleteOnClear(row: ApplicationRowState): boolean {
  if (!row.exists) return true;
  return row.setBy !== 'auto';
}
