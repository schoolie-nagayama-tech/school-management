// 提案書の新規作成で「テキストを複数冊まとめて作る」ための純粋ロジック。
//
// 何冊選んでも提案書は冊数ぶんに分かれて保存される（DBの1件＝生徒×テキスト×期のまま）。
// テンプレートを生徒に適用したときと同じ形に揃えてあるので、
// ここでまとめるのは「入力画面の見え方」と「保存の前後処理」だけ。
//
// React に触らない部分だけをこのファイルに置き、テストで固定する。
import { calcTotalKoma } from '@/lib/api/proposals';
import type { CourseCurriculumSetting } from '@/components/koushu-plan/courseSettingAdapter';

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
 * ★テーマは2通り。冊ごとに theme を渡したとき（提案書の新規作成。科目ごとにテンプレが違うので
 *   タブごとに持つ）は冊ごとに見る。渡さないとき（成績表から作る）は全冊共通の params.theme を見る。
 */
export function buildProposalSaveBlockers(params: {
  theme?: string;
  books: { name: string; koma: number; theme?: string }[];
}): string[] {
  const blockers: string[] = [];
  const perBookTheme = params.books.some((b) => b.theme !== undefined);
  if (!perBookTheme) {
    if (!(params.theme ?? '').trim()) blockers.push('テーマを入力してください');
  } else if (params.books.length === 1) {
    if (!(params.books[0].theme ?? '').trim()) blockers.push('テーマを入力してください');
  } else {
    for (const b of params.books) {
      if (!(b.theme ?? '').trim()) blockers.push(`「${b.name}」の講習テーマを入力してください`);
    }
  }
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

// ─────────────────────────────────────────────
// 冊数の上限（新規作成）
// ─────────────────────────────────────────────

/**
 * 提案書の新規作成で、1科目に並べられるテキストの冊数。
 * ★講習テンプレート（CourseEditor）の上限 MAX_TEXTBOOKS とは別物。テンプレは1科目ぶんの
 *   ひな形なので3冊で足りるが、提案書は中3の5教科をまとめて作るので科目単位で数える。
 */
export const MAX_BOOKS_PER_SUBJECT = 3;
/** 提案書の新規作成で、1回に並べられるテキストの合計冊数（5教科×3冊） */
export const MAX_BOOKS_TOTAL = 15;

/** 科目が空の教材（過去問など）をまとめて数えるときの呼び名 */
const NO_SUBJECT_LABEL = '科目なし（過去問など）';

/**
 * 冊を足せるか。足せないときは理由の文言、足せるときは null。
 * ★科目は教材の科目（textbooks.subject）で数える。過去問のように科目が空の教材は
 *   「科目なし」としてまとめて数える（単元ごとに科目を持つが、冊としては1冊）。
 */
export function checkBookLimit(
  current: { subject: string }[],
  adding: { subject: string }[]
): string | null {
  const all = [...current, ...adding];
  if (all.length > MAX_BOOKS_TOTAL) {
    return `テキストは合計${MAX_BOOKS_TOTAL}冊までです`;
  }
  const counts = new Map<string, number>();
  for (const b of all) {
    const key = (b.subject ?? '').trim();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const [key, n] of Array.from(counts.entries())) {
    if (n > MAX_BOOKS_PER_SUBJECT) {
      return `「${key || NO_SUBJECT_LABEL}」のテキストは1科目${MAX_BOOKS_PER_SUBJECT}冊までです`;
    }
  }
  return null;
}

// ─────────────────────────────────────────────
// テンプレートの複数選択
// ─────────────────────────────────────────────

/** 合体に使うテンプレの形（getSeasonalCourse の戻り値の必要な部分だけ） */
export interface TemplateForMerge {
  name: string;
  textbooks: {
    textbook_id: number;
    textbook?: { name?: string | null; subject?: string | null; grade?: string | null } | null;
  }[];
  curriculum: {
    textbook_id: number;
    curriculum_item_id: number;
    proposal_count: number;
    group_number: number | null;
  }[];
}

/** 合体した結果の1冊。タブ1つ＝保存すると提案書1件 */
export interface MergedTemplateBook {
  textbookId: number;
  name: string;
  subject: string;
  grade: string;
  /** この冊を持っていたテンプレの名前（選んだ順・重複なし）。講習テーマの初期値に使う */
  templateNames: string[];
  /**
   * テンプレごとの単元設定。テンプレの数だけ並ぶ。
   * ★1つに混ぜずにテンプレごとに分けて返す。結合番号（group_number）はテンプレの中でしか
   *   意味を持たないので、取り込む側でテンプレごとに番号を振り直す必要がある。
   */
  settingsByTemplate: CourseCurriculumSetting[][];
}

/**
 * 選んだテンプレをテキスト単位にまとめる。
 *
 * - 並びは「選んだ順 → テンプレに登録した順」。最初に出てきた位置に1冊として置く。
 * - ★同じテキストが2つ以上のテンプレに入っていたら1冊にまとめる（英語コースと数学コースの
 *   両方にある都立入試過去問など）。提案書は生徒×テキスト×期で1件しか持てないので、
 *   タブを分けても保存で1件に集まる。最初から1冊にして、両方の単元を並べておく。
 */
export function mergeTemplateBooks(templates: TemplateForMerge[]): MergedTemplateBook[] {
  const order: number[] = [];
  const byId = new Map<number, MergedTemplateBook>();
  for (const t of templates) {
    for (const ct of t.textbooks) {
      let book = byId.get(ct.textbook_id);
      if (!book) {
        book = {
          textbookId: ct.textbook_id,
          name: ct.textbook?.name ?? '',
          subject: ct.textbook?.subject ?? '',
          grade: ct.textbook?.grade ?? '',
          templateNames: [],
          settingsByTemplate: [],
        };
        byId.set(ct.textbook_id, book);
        order.push(ct.textbook_id);
      }
      if (!book.templateNames.includes(t.name)) book.templateNames.push(t.name);
      book.settingsByTemplate.push(
        t.curriculum
          .filter((c) => c.textbook_id === ct.textbook_id)
          .map((c) => ({
            curriculum_item_id: c.curriculum_item_id,
            proposal_count: c.proposal_count,
            group_number: c.group_number,
          }))
      );
    }
  }
  return order.map((id) => byId.get(id) as MergedTemplateBook);
}

/** 合体した冊の講習テーマの初期値。複数のテンプレから来た冊は「A / B」 */
export function mergedBookTheme(book: { templateNames: string[] }): string {
  return book.templateNames.join(' / ');
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
