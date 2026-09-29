/**
 * 成績表（PCS・進研テスト・Vもぎ）から講習提案書を下書きする機能の型。
 * 正典: docs/score-sheet-plan-draft.md
 *
 * ★読み取った結果は保存しない（決定15）。ここの型はブラウザの中でだけ使い、
 *   残るのは提案書の単元と、単元ごとの根拠の文字列（seasonal_proposal_units.reason）だけ。
 */

export type ScoreSubject = 'math' | 'eng';

export const SCORE_SUBJECT_LABEL: Record<ScoreSubject, string> = {
  math: '数学',
  eng: '英語',
};

/** PCS の印。●＝できる、△＝あいまい、×＝できない。空欄（出題なし）は印なしとして持たない */
export type PcsMark = '●' | '△' | '×';

/** PCS の1単元ぶん。group は帳票の群の見出し（例「比例・反比例」「助動詞」） */
export interface PcsUnitMark {
  group: string;
  unit: string;
  /** 今回の印（右の枠）。前回だけ印がある単元は now=null */
  now: PcsMark | null;
  prev: PcsMark | null;
}

export interface PcsReading {
  subject: ScoreSubject;
  /** 「中学2年生」から読む。読めなければ null */
  grade: number | null;
  /** 「2026年08月Iテスト」のように帳票に書かれたまま */
  examLabel: string | null;
  units: PcsUnitMark[];
  /** 座標から単元を引けなかった印の数（様式が変わったときに気づくため） */
  orphanMarks: number;
}

/** 模試の設問の正誤。帳票の記号のまま持つ。部分点の設問は本人の得点（数） */
export type MockResult = 'o' | 'x' | 'x_to_double' | 'x_to_star' | number;

export interface MockItem {
  /** 設問番号（帳票のまま。例「5 問1」「3(3)①」） */
  q: string;
  /** 設問の内容（例「立体の体積」「文脈把握」） */
  content: string;
  /** 全体の正答率（%）。部分点の設問は null */
  rate: number | null;
  /** 部分点の設問の平均点。○×の設問は null */
  avg: number | null;
  result: MockResult;
}

export interface MockArea {
  name: string;
  /** 領域の本人の得点率（%）。部分点の領域は null */
  ownPct: number | null;
  items: MockItem[];
}

export type MockDocType = 'shinken_test' | 'vmogi_tokyo';

export interface MockSheet {
  docType: MockDocType;
  examLabel: string | null;
  grade: number | null;
  /** 教科ごとの偏差値（1ページ目） */
  ss: Partial<Record<ScoreSubject, number>>;
  /** 第1志望校と合格基準の偏差値（Vもぎのみ） */
  firstChoice: { name: string; baseSs: number | null } | null;
  subjects: Partial<Record<ScoreSubject, MockArea[]>>;
  /**
   * 帳票の氏名。★選んだ生徒と同じ人かを確かめるためだけに使い、保存しない・どこにも送らない
   */
  studentName: string | null;
}

/** 検算の結果 */
export type AreaCheck =
  | { status: 'ok'; counted: number }
  | { status: 'mismatch'; counted: number; printed: number }
  | { status: 'partial' }; // 部分点の領域は得点率で検算できない

/** 下書きに使う根拠1つ */
export interface Evidence {
  src: 'pcs' | 'mock';
  /** 出どころの表示名（「PCS」「進研」「Vもぎ」） */
  srcLabel: string;
  /** 画面と reason に出す文字（例「比例の式」「5 問1 空間内の角の大きさ」） */
  label: string;
  /** 記号（例「×」「△」「×→◎」「0点」） */
  mark: string;
  /** 全体正答率が低い難問 */
  hard?: boolean;
}

/** 教材の単元（curriculum_items の並び順のまま） */
export interface PlanUnit {
  id: number;
  no: string | null;
  title: string;
}

/**
 * 1冊ぶんの下書き。形は提案書エディタの UnitDraft に合わせる
 * （koma_count / group_id / intent_tag / reason）。
 */
export interface DraftUnit {
  curriculum_item_id: number;
  koma_count: number;
  group_id: number;
  intent_tag: string | null;
  reason: string;
}
