/**
 * 通塾日程の版管理（いつから適用するか）と、履歴行の状態判定の純ロジック。
 *
 * 背景:
 *  通塾日程は1行=1版（effective_from 〜 effective_until）で持つ。編集のたびに版を切ると
 *  「まだ始まっていない行」まで無駄に分割され履歴が読めなくなるため、版を切るか上書きするかの
 *  分岐をここに切り出してテストで固定する。日付比較は 'YYYY-MM-DD' の辞書順比較で足りる
 *  （ゼロ埋め固定長のため）。DB・React に依存させないこと。
 */

/** 保存の仕方。'version'=旧行を前日で終了し新行を作る / 'overwrite'=その行をそのまま書き換える */
export type PatternSaveMode = 'version' | 'overwrite';

export interface PatternSaveModeInput {
  /** 編集対象パターンの現在の適用開始日 'YYYY-MM-DD' */
  patternEffectiveFrom: string | null | undefined;
  /** フォームで指定した「変更を適用する日」 'YYYY-MM-DD' */
  applyDate: string | null | undefined;
  /**
   * 講座（特別講座）のパターンか。
   * 版を切る API（scheduleRegularPatternChangeFrom）は special_course_id を引き継がないため、
   * 講座の行を分割すると講座との紐づきが消える。講座は常に上書きにする。
   */
  isCourse?: boolean;
}

/**
 * 変更をどう保存するかを決める。
 *  - 変更日 > 現在の適用開始日 … 版を切る（前日までの内容が履歴として残る）
 *  - 変更日 <= 現在の適用開始日 … 上書き（まだ始まっていない行を無駄に分割しない）
 * 日付が欠けている壊れたデータは、分割して履歴を散らかすより上書きの方が安全なので上書き。
 */
export function resolvePatternSaveMode(input: PatternSaveModeInput): PatternSaveMode {
  if (input.isCourse) return 'overwrite';
  const from = input.patternEffectiveFrom;
  const applyDate = input.applyDate;
  if (!from || !applyDate) return 'overwrite';
  return applyDate > from ? 'version' : 'overwrite';
}

export interface CellEntryCreationInput {
  /** クリックしたセルの日付 'YYYY-MM-DD' */
  cellDate: string;
  /** フォームで指定した授業の開始日 'YYYY-MM-DD'。未指定なら従来どおり当週に作る */
  startDate: string | null | undefined;
}

/**
 * 座席表の空席「＋」から通常授業を登録するとき、
 * クリックしたセルの日付に当週ぶんの schedule_entry を同時に作ってよいかを判定する。
 *
 * 開始日がセルの日付より後＝まだ始まっていない授業なので、ここでエントリを作ると
 * 開始日前の授業が座席表に出てしまう。開始日以降の週には週次再生成
 * （planWeeklyEntries が effective_from を見る）が自動で並べるので、作らなくてよい。
 * 日付比較は 'YYYY-MM-DD' の辞書順で足りる（ゼロ埋め固定長のため）。
 */
export function shouldCreateEntryForCell(input: CellEntryCreationInput): boolean {
  if (!input.startDate) return true;
  return input.startDate <= input.cellDate;
}

/** 履歴行の状態。'ended'=終了 / 'current'=現在 / 'upcoming'=開始前 */
export type PatternPeriodStatus = 'ended' | 'current' | 'upcoming';

export interface PatternPeriod {
  effective_from: string | null | undefined;
  effective_until: string | null | undefined;
}

/**
 * 履歴行が今日の時点でどの状態かを判定する。
 * 境界日は「その日も有効」（effective_from=今日 は現在、effective_until=今日 も現在）。
 * 終了判定を先に見るのは、effective_until < effective_from という壊れた行を
 * 「開始前」と誤表示しないため。
 */
export function getPatternPeriodStatus(pattern: PatternPeriod, today: string): PatternPeriodStatus {
  const until = pattern.effective_until;
  if (until && until < today) return 'ended';
  const from = pattern.effective_from;
  if (from && from > today) return 'upcoming';
  return 'current';
}

/** 今日の YYYY-MM-DD（ローカル時刻＝JST想定） */
export function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** 'YYYY-MM-DD' を '2026/4/1' 形式にする（ゼロ埋めを外して密度を優先） */
export function formatDateSlash(date: string | null | undefined): string {
  if (!date) return '';
  const [y, m, d] = date.split('-');
  if (!y || !m || !d) return date;
  return `${Number(y)}/${Number(m)}/${Number(d)}`;
}

/** 期間の表示。終了日が無ければ「2026/4/1 〜」（無期限） */
export function formatPatternPeriod(pattern: PatternPeriod): string {
  const from = formatDateSlash(pattern.effective_from);
  const until = formatDateSlash(pattern.effective_until);
  if (!from && !until) return '';
  return until ? `${from} 〜 ${until}` : `${from} 〜`;
}

/** 開始前バッジの文言（例「10/1から」）。年は同じ年でも冗長なので出さない。 */
export function formatUpcomingBadge(effectiveFrom: string | null | undefined): string {
  if (!effectiveFrom) return '開始前';
  const [, m, d] = effectiveFrom.split('-');
  if (!m || !d) return '開始前';
  return `${Number(m)}/${Number(d)}から`;
}

/** マトリクスのセルに添える開始前の小バッジ（例「10/1〜」） */
export function formatUpcomingCellBadge(effectiveFrom: string | null | undefined): string {
  if (!effectiveFrom) return '開始前';
  const [, m, d] = effectiveFrom.split('-');
  if (!m || !d) return '開始前';
  return `${Number(m)}/${Number(d)}〜`;
}
