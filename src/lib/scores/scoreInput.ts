/**
 * 成績セルの入力と表示の共通ルール（「テストなし」を含む）。
 *
 * 「テストなし」＝その回にその科目のテストが無かった（美術のテストが無い回など）。
 * それまでは成績未入力アラートを消すために 0 を入れる運用で、0 が本当の0点として
 * 前回比・成績低下アラート・合計・グラフに混ざっていた。DB は assessment_scores.no_test
 * （true のとき value は必ず NULL）で持つ。
 *
 * 入力は3つの画面（生徒の成績ページ・生徒詳細の成績・成績一覧）で同じにしたいので、
 * 文字列の読み方をここに1つだけ置く。
 */

/** 画面に出す「テストなし」の印 */
export const NO_TEST_MARK = '×';
/** 印の意味（title / aria-label / CSV で使う） */
export const NO_TEST_LABEL = 'テストなし';
/** 表の近くに出す入力のヒント */
export const NO_TEST_HINT = 'テストが無い科目は ×（x か - を入力）';

/**
 * 「テストなし」として受け付ける文字（NFKC で正規化した後に比べる）。
 * 全角の Ｘ・－ は NFKC で半角になるので、ここには正規化後の形を置く。
 * ー（長音）・−（マイナス記号）・✕ は NFKC でも変わらないが、日本語入力のまま
 * 打たれやすいので受け付ける。
 */
const NO_TEST_INPUTS = new Set(['×', '✕', 'x', 'X', '-', 'ー', '−', '‐']);

export type ParsedScoreInput =
  | { kind: 'value'; value: number }
  | { kind: 'noTest' }
  | { kind: 'empty' }
  | { kind: 'invalid' };

/**
 * セルに打たれた文字を読む。
 * - 空 → 未入力（value=null, no_test=false）
 * - × / x / - など → テストなし
 * - 数値 → 値（全角数字も受け付ける）
 * - それ以外 → 不正（保存しない）
 */
export function parseScoreInput(text: string): ParsedScoreInput {
  const normalized = text.normalize('NFKC').trim();
  if (normalized === '') return { kind: 'empty' };
  if (NO_TEST_INPUTS.has(normalized)) return { kind: 'noTest' };
  // Number('') や Number(' ') は 0 になるが、空は上で弾いてある。
  // parseFloat だと「80点」の 80 だけ拾って保存してしまうため、数値全体でないものは不正にする。
  const n = Number(normalized);
  if (!Number.isFinite(n)) return { kind: 'invalid' };
  return { kind: 'value', value: n };
}

/** 成績1科目分（value と no_test）。no_test が無い行は false と読む。 */
export interface ScoreCellState {
  value: number | null;
  no_test?: boolean;
}

/** 編集を始めるときにセルへ入れておく文字 */
export function scoreEditText(score: ScoreCellState | null | undefined): string {
  if (!score) return '';
  if (score.no_test) return NO_TEST_MARK;
  return score.value !== null && score.value !== undefined ? String(score.value) : '';
}

/** 読んだ入力を保存する値（value と no_test）に直す。不正なら null。 */
export function parsedToScoreState(parsed: ParsedScoreInput): Required<ScoreCellState> | null {
  switch (parsed.kind) {
    case 'value':
      return { value: parsed.value, no_test: false };
    case 'noTest':
      // DB の check（no_test なら value は NULL）に合わせて値は必ず空にする
      return { value: null, no_test: true };
    case 'empty':
      return { value: null, no_test: false };
    default:
      return null;
  }
}
