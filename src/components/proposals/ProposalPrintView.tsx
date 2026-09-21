import { Check } from 'lucide-react';
import type { CurriculumItem, StudentProgress } from '@/types/database';

export interface PrintUnitDraft {
  curriculum_item_id: number;
  koma_count: number;
  applied_koma: number;
  reason: string;
  group_id: number;
  intent_tag: string | null;
}

/** 紙1枚に載るテキスト1冊ぶん。books の並び順がそのまま「1冊目・2冊目…」＝進める順になる */
export interface PrintBook {
  textbookName: string;
  theme: string;
  allItems: CurriculumItem[];
  activeUnits: PrintUnitDraft[];
  progressMap: Map<number, StudentProgress>;
  totalKoma: number;
}

/**
 * 紙1枚ぶんのデータ。
 *
 * ★1枚＝提案書1件ではない。同じ生徒・同じ期・同じ科目の提案書（テキスト1冊ずつ）は
 *   1枚にまとめて渡す。目的が1つ（同じ科目を続けてやる）なのに紙が3枚に割れると、
 *   保護者には別々の提案に見えてしまうため。まとめる規則は lib/proposals/printSheetGrouping.ts。
 */
export interface ProposalPrintData {
  studentName: string;
  seasonLabel: string;
  year: number;
  /** 科目。複数冊のときのヘッダーに出す（1冊のときは書名を出すので使わない） */
  subject: string;
  books: PrintBook[];
}

const INTENT_TAG_PRINT_COLOR: Record<string, string> = {
  予習: 'text-purple-700 border-purple-200',
  復習: 'text-blue-700 border-blue-200',
  苦手克服: 'text-rose-700 border-rose-200',
  苦手補強: 'text-red-700 border-red-200',
  定着: 'text-emerald-700 border-emerald-200',
  直前演習: 'text-amber-700 border-amber-200',
  応用発展: 'text-indigo-700 border-indigo-200',
};

type GroupPos = 'first' | 'mid' | 'last' | 'solo';

function getGroupPos(
  allItems: CurriculumItem[],
  idx: number,
  unitMap: Map<number, PrintUnitDraft>
): GroupPos | null {
  const unit = unitMap.get(allItems[idx].id);
  if (!unit || unit.group_id === 0) return null;
  const gid = unit.group_id;
  const prevSame = idx > 0 && unitMap.get(allItems[idx - 1].id)?.group_id === gid;
  const nextSame = idx < allItems.length - 1 && unitMap.get(allItems[idx + 1].id)?.group_id === gid;
  if (!prevSame && !nextSame) return 'solo';
  if (!prevSame) return 'first';
  if (!nextSame) return 'last';
  return 'mid';
}

/** 冊ごとに使い回す派生データ（選択済みID・単元マップ・消化済み数） */
function deriveBook(book: PrintBook) {
  return {
    selectedIds: new Set(book.activeUnits.map((u) => u.curriculum_item_id)),
    unitMap: new Map(book.activeUnits.map((u) => [u.curriculum_item_id, u])),
    doneCount: book.allItems.filter((item) => !!book.progressMap.get(item.id)?.school_progress_date)
      .length,
  };
}

/** 印刷用のコンパクト単元行（1冊のときの2段組も、複数冊のときの冊ごと1列もこれを使う） */
function CompactUnitRows({ book }: { book: PrintBook }) {
  const { selectedIds, unitMap } = deriveBook(book);
  return (
    <>
      {book.allItems.map((item, idx) => {
        const isTarget = selectedIds.has(item.id);
        const itemDone = !!book.progressMap.get(item.id)?.school_progress_date;
        const unit = unitMap.get(item.id);
        const gpos = getGroupPos(book.allItems, idx, unitMap);
        const isGrouped = gpos !== null;
        const isGroupHead = gpos === 'first' || gpos === 'solo';
        const isGroupMerged = gpos === 'first' || gpos === 'mid';
        const intentTag = unit?.intent_tag ?? null;

        return (
          <div
            key={item.id}
            className={[
              'proposal-print-compact-item flex items-center gap-1',
              isTarget ? 'font-bold' : itemDone ? 'text-gray-400 line-through' : '',
              isGrouped && isTarget ? 'bg-gray-100 border-l-[2px] border-l-black pl-1' : '',
              isGroupMerged && isTarget ? 'proposal-print-compact-item--merged' : '',
            ].join(' ')}
          >
            <span className="w-3 text-center shrink-0">
              {itemDone ? '✓' : isTarget ? '■' : ' '}
            </span>
            <span className="flex-1 min-w-0 truncate">{item.title}</span>
            {isTarget && (!isGrouped || isGroupHead) && unit && (
              <span className="shrink-0 tabular-nums">{unit.koma_count}コマ</span>
            )}
            {isTarget && intentTag && (
              <span className="shrink-0 text-[7px] px-1 border border-gray-300 rounded-sm">
                {intentTag}
              </span>
            )}
          </div>
        );
      })}
    </>
  );
}

/** 画面表示用のセクション（印刷では出さない）。冊ごとに繰り返す */
function BookScreenSections({ book, showTitle }: { book: PrintBook; showTitle: boolean }) {
  const { selectedIds, unitMap, doneCount } = deriveBook(book);

  return (
    <>
      {/* 現在の進捗（画面のみ） */}
      <section className="p-4 bg-surface-raised rounded-xl border border-border print:hidden">
        <h2 className="text-sm font-bold text-text-heading mb-2">
          現在の進捗{showTitle ? `（${book.textbookName}）` : ''}
        </h2>
        <div className="flex items-center gap-3">
          <div className="flex-1 h-2 bg-surface-hover rounded-full overflow-hidden">
            <div
              className="h-full bg-ink rounded-full"
              style={{
                width: book.allItems.length ? `${(doneCount / book.allItems.length) * 100}%` : '0%',
              }}
            />
          </div>
          <span className="text-sm font-bold text-text-heading shrink-0">
            {doneCount}
            <span className="text-xs font-normal text-text-muted">/{book.allItems.length}単元</span>
          </span>
        </div>
      </section>

      {/* 講習対象単元テーブル（画面のみ） */}
      <section className="p-4 bg-surface-raised rounded-xl border border-border print:hidden">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-text-heading">
            講習対象単元{showTitle ? `（${book.textbookName}）` : ''}
          </h2>
          <span className="text-sm font-bold text-accent-ink">
            {book.activeUnits.length}単元 / {book.totalKoma}コマ
          </span>
        </div>
        <table className="w-full text-xs">
          <thead className="border-b border-border">
            <tr>
              <th className="py-2 text-left font-semibold text-text-muted">単元名</th>
              <th className="py-2 text-center w-10 font-semibold text-text-muted">コマ</th>
            </tr>
          </thead>
          <tbody>
            {book.activeUnits.map((unit, _i, arr) => {
              const item = book.allItems.find((it) => it.id === unit.curriculum_item_id);
              if (!item) return null;
              const isGrouped = unit.group_id > 0;
              const isGroupHead =
                isGrouped && arr.findIndex((u) => u.group_id === unit.group_id) === _i;
              const isGroupLast =
                isGrouped && (_i === arr.length - 1 || arr[_i + 1]?.group_id !== unit.group_id);
              const intentTag = unit.intent_tag ?? null;

              return (
                <tr
                  key={item.id}
                  className={
                    isGrouped && !isGroupLast
                      ? 'border-b border-transparent'
                      : 'border-b border-border-subtle'
                  }
                >
                  <td
                    className={`py-1.5 font-medium text-text-heading ${isGrouped ? 'pl-2 border-l-2 border-l-text-muted' : ''}`}
                  >
                    {item.title}
                    {intentTag && (
                      <span
                        className={`inline-block ml-1.5 px-1.5 py-0.5 border rounded-full text-[9px] font-medium align-middle ${INTENT_TAG_PRINT_COLOR[intentTag] ?? 'text-text-muted border-border'}`}
                      >
                        {intentTag}
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 text-center font-bold text-text-heading">
                    {!isGrouped || isGroupHead ? unit.koma_count : ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* テキスト全単元（画面のみ：テーブル表示） */}
      <section className="p-4 bg-surface-raised rounded-xl border border-border print:hidden">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-text-heading">
            テキスト全単元{showTitle ? `（${book.textbookName}）` : ''}
          </h2>
          <span className="text-sm font-bold text-accent-ink">
            講習 {book.activeUnits.length}単元 / {book.totalKoma}コマ
          </span>
        </div>
        <table className="w-full text-xs proposal-print-table">
          <thead className="border-b border-border">
            <tr>
              <th className="py-2 text-left font-semibold text-text-muted">単元</th>
              <th className="py-2 text-center w-14 font-semibold text-text-muted">状況</th>
              <th className="py-2 text-center w-12 font-semibold text-text-muted">コマ</th>
            </tr>
          </thead>
          <tbody>
            {book.allItems.map((item, idx) => {
              const isTarget = selectedIds.has(item.id);
              const progress = book.progressMap.get(item.id);
              const itemDone = !!progress?.school_progress_date;
              const unit = unitMap.get(item.id);
              const gpos = getGroupPos(book.allItems, idx, unitMap);
              const isGrouped = gpos !== null;
              const isGroupHead = gpos === 'first' || gpos === 'solo';
              const isGroupMerged = gpos === 'first' || gpos === 'mid';

              const intentTag = unit?.intent_tag ?? null;

              return (
                <tr
                  key={item.id}
                  className={
                    isTarget
                      ? `bg-accent-ink-subtle ${isGroupMerged ? 'border-b border-transparent' : 'border-b border-accent-ink/10'}`
                      : 'border-b border-border-subtle'
                  }
                >
                  <td
                    className={`py-2 ${
                      isGrouped && isTarget ? 'pl-2 border-l-2 border-l-accent-ink' : ''
                    } ${
                      isTarget
                        ? 'font-bold text-accent-ink'
                        : itemDone
                          ? 'text-text-faint line-through'
                          : 'text-text-body'
                    }`}
                  >
                    {item.title}
                    {isTarget && intentTag && (
                      <span
                        className={`inline-block ml-1.5 px-1.5 py-0.5 border rounded-full text-[9px] font-medium align-middle ${INTENT_TAG_PRINT_COLOR[intentTag] ?? 'text-text-muted border-border'}`}
                      >
                        {intentTag}
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-center">
                    {itemDone ? (
                      <span className="inline-flex items-center gap-0.5 text-[10px] text-text-faint">
                        <Check className="w-3 h-3" />済
                      </span>
                    ) : isTarget ? (
                      <span className="px-1.5 py-0.5 bg-ink text-text-on-primary text-[10px] font-bold rounded">
                        講習
                      </span>
                    ) : (
                      <span className="text-[10px] text-text-faint">--</span>
                    )}
                  </td>
                  <td className="py-2 text-center font-bold text-accent-ink">
                    {isTarget && (!isGrouped || isGroupHead) ? unit?.koma_count : ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </>
  );
}

export function ProposalPrintView({
  studentName,
  seasonLabel,
  year,
  subject,
  books,
}: ProposalPrintData) {
  const isMulti = books.length > 1;
  const totalKoma = books.reduce((sum, b) => sum + b.totalKoma, 0);
  // ヘッダーの2行目。1冊なら従来どおり書名、複数冊なら科目（どの冊も同じ科目なので科目で代表させる）
  const headerLabel = isMulti ? subject : (books[0]?.textbookName ?? '');

  // テーマ: 全冊が同じ（空でない）なら1回だけ。違うなら冊ごとに「書名: テーマ」で並べる。
  const themes = books.map((b) => b.theme.trim());
  const sharedTheme =
    themes.length > 0 && themes.every((t) => t !== '' && t === themes[0]) ? themes[0] : null;
  const hasAnyTheme = themes.some((t) => t !== '');

  return (
    <div className="proposal-print-page space-y-5 print:space-y-1">
      {/* ヘッダー */}
      <div className="p-5 bg-ink text-text-on-primary rounded-2xl print:rounded-none print:bg-white print:text-text-heading print:border-b-2 print:border-ink print:p-0 print:pb-1">
        <div className="text-lg font-bold print:text-sm">
          {year}年 {seasonLabel}講習のご提案
        </div>
        <div className="text-sm mt-1 opacity-90 print:opacity-100 print:text-[10px] print:mt-0">
          {studentName} さま{headerLabel ? ` / ${headerLabel}` : ''}
        </div>
      </div>

      {/* テーマ（印刷時も表示） */}
      {hasAnyTheme && (
        <section className="p-4 print:p-1 bg-surface-raised rounded-xl border border-border print:border-border-strong">
          <h2 className="text-sm print:text-[10px] font-bold text-text-heading mb-1 print:mb-0">
            講習テーマ
          </h2>
          {sharedTheme ? (
            <p className="text-sm print:text-[10px] text-text-body">{sharedTheme}</p>
          ) : (
            <div className="space-y-0.5">
              {books.map((b, i) =>
                b.theme.trim() ? (
                  <p key={i} className="text-sm print:text-[10px] text-text-body">
                    <span className="font-bold">{b.textbookName}:</span> {b.theme}
                  </p>
                ) : null
              )}
            </div>
          )}
        </section>
      )}

      {/* 画面表示（印刷では出さない）。冊ごとに繰り返す */}
      {books.map((book, i) => (
        <BookScreenSections key={i} book={book} showTitle={isMulti} />
      ))}

      {/* テキスト全単元（印刷用コンパクト表示） */}
      {isMulti ? (
        // 複数冊: 冊ごとに1列。左から右へ、そのまま進める順に読める形にする。
        // A4縦1枚に収めるのが目標だが、溢れたら自然に2枚目へ流す（無理に縮めない）。
        <section className="hidden print:block print:p-0">
          <div className="flex items-center justify-between mb-1 border-b border-black pb-0.5">
            <h2 className="text-[10px] font-bold">テキスト全単元</h2>
            <span className="text-[10px] font-bold">講習 合計{totalKoma}コマ</span>
          </div>
          <div
            className={`proposal-print-books ${books.length >= 3 ? 'proposal-print-books--3' : 'proposal-print-books--2'}`}
          >
            {books.map((book, i) => (
              <div key={i} className="proposal-print-book-col">
                <div className="proposal-print-book-head flex items-center gap-1">
                  <span className="shrink-0">{i + 1}冊目</span>
                  <span className="flex-1 min-w-0 truncate">{book.textbookName}</span>
                  <span className="shrink-0 tabular-nums">{book.totalKoma}コマ</span>
                </div>
                <CompactUnitRows book={book} />
              </div>
            ))}
          </div>
        </section>
      ) : (
        // 1冊: 従来どおりの2段組
        <section className="hidden print:block print:p-0">
          <div className="flex items-center justify-between mb-1 border-b border-black pb-0.5">
            <h2 className="text-[10px] font-bold">テキスト全単元</h2>
            <span className="text-[10px] font-bold">講習 {totalKoma}コマ</span>
          </div>
          <div className="proposal-print-compact">
            {books[0] && <CompactUnitRows book={books[0]} />}
          </div>
        </section>
      )}

      {/* サマリーフッター */}
      <section className="p-4 print:p-1 bg-surface rounded-xl border border-border print:border-border-strong">
        <div className="flex items-center gap-3">
          <div className="text-sm print:text-[10px] text-text-muted">講習内容:</div>
          <div className="text-sm print:text-[10px] font-bold text-accent-ink print:text-text-heading">
            {isMulti
              ? `合計${totalKoma}コマ（${books.map((b, i) => `${i + 1}冊目 ${b.totalKoma}`).join(' / ')}）`
              : `${totalKoma}コマ`}
          </div>
        </div>
      </section>
    </div>
  );
}
