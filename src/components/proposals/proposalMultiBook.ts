// 提案書の新規作成で「テキストを最大3冊まで選ぶ」ための純粋ロジック。
//
// 3冊選んでも提案書は3件に分かれて保存される（DBの1件＝生徒×テキスト×期のまま）。
// テンプレートを生徒に適用したときと同じ形に揃えてあるので、
// ここでまとめるのは「入力画面の見え方」と「保存の前後処理」だけ。
//
// React に触らない部分だけをこのファイルに置き、テストで固定する。
import { calcTotalKoma } from '@/lib/api/proposals';

/** コマ数の計算に必要な最小限の単元情報（提案結合 group_id を含む） */
export interface BookKomaUnit {
  group_id: number;
  koma_count: number;
}

/** 冊ごとの入力。name は保存できない理由やコマ数内訳に出す書名 */
export interface BookKomaInput {
  textbookId: number;
  name: string;
  units: BookKomaUnit[];
}

export interface BookKomaSummaryRow {
  textbookId: number;
  name: string;
  /** 「1冊目」「2冊目」の番号（タブの並び順＝進める順） */
  order: number;
  unitCount: number;
  koma: number;
}

export interface BookKomaSummary {
  perBook: BookKomaSummaryRow[];
  totalKoma: number;
  totalUnitCount: number;
}

/**
 * 冊ごとのコマ数と全冊の合計。
 * 数え方は1冊のときと同じ `calcTotalKoma`（結合したグループは1コマ）を冊ごとに使う。
 * 冊をまたいで結合することは無いので、単純な足し算で合計になる。
 */
export function calcBookKomaSummary(books: BookKomaInput[]): BookKomaSummary {
  const perBook = books.map((b, i) => ({
    textbookId: b.textbookId,
    name: b.name,
    order: i + 1,
    unitCount: b.units.length,
    koma: calcTotalKoma(b.units),
  }));
  return {
    perBook,
    totalKoma: perBook.reduce((sum, b) => sum + b.koma, 0),
    totalUnitCount: perBook.reduce((sum, b) => sum + b.unitCount, 0),
  };
}

/**
 * 保存できない理由。冊ごとに判定し、原因の冊は書名を添えて返す。
 *
 * ★2冊以上のときだけ「コマ数が0の冊」を止める。
 *   1冊のときの挙動は変えない（テーマだけ入れて単元は後から、という使い方が従来できた）。
 *   複数冊では、空のまま保存すると中身の無い提案書がその冊のぶんだけ増えてしまうので止める。
 */
export function buildProposalSaveBlockers(params: {
  theme: string;
  books: { name: string; koma: number }[];
}): string[] {
  const blockers: string[] = [];
  if (!params.theme.trim()) blockers.push('テーマを入力してください');
  if (params.books.length === 0) {
    blockers.push('テキストを選択してください');
    return blockers;
  }
  if (params.books.length >= 2) {
    for (const b of params.books) {
      if (b.koma === 0) blockers.push(`「${b.name}」にコマ数が入っていません`);
    }
  }
  return blockers;
}

export interface BookSaveOutcome {
  textbookId: number;
  name: string;
  /** 保存に成功した提案書のID（失敗なら null） */
  proposalId: string | null;
}

export interface BookSaveSummary {
  savedTextbookIds: number[];
  savedProposalIds: string[];
  failedNames: string[];
  allSucceeded: boolean;
  message: string;
  tone: 'success' | 'error';
}

/**
 * 1冊ずつ保存した結果の振り分け。
 *
 * 途中で失敗したら、保存できた冊はタブから外して残りだけ再保存できる状態にしたい。
 * その判断材料（外す冊・残す冊・利用者に出す文言）をここで作る。
 */
export function summarizeBookSaves(outcomes: BookSaveOutcome[]): BookSaveSummary {
  const saved = outcomes.filter((o) => o.proposalId != null);
  const failed = outcomes.filter((o) => o.proposalId == null);
  const allSucceeded = failed.length === 0;

  let message: string;
  if (allSucceeded) {
    message = saved.length === 1 ? '保存しました' : `${saved.length}件の提案書を保存しました`;
  } else if (saved.length === 0) {
    message = `保存に失敗しました（${failed.map((f) => `「${f.name}」`).join('')}）`;
  } else {
    message =
      `${saved.length}件を保存しました。` +
      `${failed.map((f) => `「${f.name}」`).join('')}の保存に失敗しました。残りをもう一度保存してください`;
  }

  return {
    savedTextbookIds: saved.map((o) => o.textbookId),
    savedProposalIds: saved.map((o) => o.proposalId as string),
    failedNames: failed.map((o) => o.name),
    allSucceeded,
    message,
    tone: allSucceeded ? 'success' : 'error',
  };
}

/**
 * タブの並べ替え。activeId の冊を overId の冊の位置へ動かす（間の冊は1つずつずれる）。
 * どちらかが見つからなければ並びを変えない（ドラッグ中に冊が外された場合など）。
 */
export function reorderBooks(ids: number[], activeId: number, overId: number): number[] {
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from < 0 || to < 0 || from === to) return ids;
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, activeId);
  return next;
}

/**
 * 画面の見出しに出す書名。冊数が増えても1行に収まるようにする。
 * 3冊ぶん並べるとヘッダーが折り返して読みにくいので、3冊目からは「ほかn冊」に畳む。
 */
export function formatBookTitles(names: string[]): string {
  const valid = names.filter((n) => !!n.trim());
  if (valid.length === 0) return '';
  if (valid.length <= 2) return valid.join('、');
  return `${valid[0]} ほか${valid.length - 1}冊`;
}
