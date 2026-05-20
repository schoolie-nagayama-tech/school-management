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

export interface ProposalPrintData {
  studentName: string;
  textbookName: string;
  seasonLabel: string;
  year: number;
  theme: string;
  allItems: CurriculumItem[];
  activeUnits: PrintUnitDraft[];
  progressMap: Map<number, StudentProgress>;
  totalKoma: number;
  groupMap?: Map<number, PrintUnitDraft[]>;
}

const INTENT_TAG_PRINT_COLOR: Record<string, string> = {
  '苦手補強': 'text-red-700 border-red-200',
  '既習の定着': 'text-blue-700 border-blue-200',
  '未習の先取り': 'text-purple-700 border-purple-200',
  '学校進度に合わせる': 'text-emerald-700 border-emerald-200',
  '直前演習': 'text-amber-700 border-amber-200',
  '応用発展': 'text-indigo-700 border-indigo-200',
};

type GroupPos = 'first' | 'mid' | 'last' | 'solo';

function getGroupPos(
  allItems: CurriculumItem[],
  idx: number,
  unitMap: Map<number, PrintUnitDraft>,
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

export function ProposalPrintView({
  studentName,
  textbookName,
  seasonLabel,
  year,
  theme,
  allItems,
  activeUnits,
  progressMap,
  totalKoma,
}: ProposalPrintData) {
  const selectedIds = new Set(activeUnits.map((u) => u.curriculum_item_id));
  const unitMap = new Map(activeUnits.map((u) => [u.curriculum_item_id, u]));
  const doneCount = allItems.filter((item) => !!progressMap.get(item.id)?.school_progress_date).length;

  return (
    <div className="proposal-print-page space-y-5 print:space-y-1">
      {/* ヘッダー */}
      <div className="p-5 bg-ink text-text-on-primary rounded-2xl print:rounded-none print:bg-white print:text-text-heading print:border-b-2 print:border-ink print:p-0 print:pb-1">
        <div className="text-lg font-bold print:text-sm">{year}年 {seasonLabel}講習のご提案</div>
        <div className="text-sm mt-1 opacity-90 print:opacity-100 print:text-[10px] print:mt-0">
          {studentName} さま / {textbookName}
        </div>
      </div>

      {/* テーマ（印刷時も表示） */}
      {theme && (
        <section className="p-4 print:p-1 bg-surface-raised rounded-xl border border-border-default print:border-border-strong">
          <h2 className="text-sm print:text-[10px] font-bold text-text-heading mb-1 print:mb-0">講習テーマ</h2>
          <p className="text-sm print:text-[10px] text-text-body">{theme}</p>
        </section>
      )}

      {/* 現在の進捗（画面のみ） */}
      <section className="p-4 bg-surface-raised rounded-xl border border-border-default print:hidden">
        <h2 className="text-sm font-bold text-text-heading mb-2">現在の進捗</h2>
        <div className="flex items-center gap-3">
          <div className="flex-1 h-2 bg-surface-hover rounded-full overflow-hidden">
            <div
              className="h-full bg-ink rounded-full"
              style={{ width: allItems.length ? `${(doneCount / allItems.length) * 100}%` : '0%' }}
            />
          </div>
          <span className="text-sm font-bold text-text-heading shrink-0">
            {doneCount}
            <span className="text-xs font-normal text-text-muted">/{allItems.length}単元</span>
          </span>
        </div>
      </section>

      {/* 講習対象単元テーブル（画面のみ） */}
      <section className="p-4 bg-surface-raised rounded-xl border border-border-default print:hidden">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-text-heading">講習対象単元</h2>
          <span className="text-sm font-bold text-accent-ink">
            {activeUnits.length}単元 / {totalKoma}コマ
          </span>
        </div>
        <table className="w-full text-xs">
          <thead className="border-b border-border-default">
            <tr>
              <th className="py-2 text-left font-semibold text-text-muted">単元名</th>
              <th className="py-2 text-center w-10 font-semibold text-text-muted">コマ</th>
              <th className="py-2 text-left font-semibold text-text-muted">指導意図</th>
              <th className="py-2 text-left font-semibold text-text-muted">講習で扱う理由</th>
            </tr>
          </thead>
          <tbody>
            {activeUnits.map((unit, _i, arr) => {
              const item = allItems.find((it) => it.id === unit.curriculum_item_id);
              if (!item) return null;
              const isGrouped = unit.group_id > 0;
              const isGroupHead = isGrouped && (arr.findIndex((u) => u.group_id === unit.group_id) === _i);
              const isGroupLast = isGrouped && (
                _i === arr.length - 1 || arr[_i + 1]?.group_id !== unit.group_id
              );
              const intentTag = unit.intent_tag ?? null;

              return (
                <tr
                  key={item.id}
                  className={isGrouped && !isGroupLast ? 'border-b border-transparent' : 'border-b border-border-subtle'}
                >
                  <td className={`py-1.5 font-medium text-text-heading ${isGrouped ? 'pl-2 border-l-2 border-l-text-muted' : ''}`}>
                    {item.title}
                  </td>
                  <td className="py-1.5 text-center font-bold text-text-heading">
                    {(!isGrouped || isGroupHead) ? unit.koma_count : ''}
                  </td>
                  <td className="py-1.5">
                    {intentTag && (
                      <span className={`inline-block px-1.5 py-0.5 border rounded-full text-[9px] font-medium ${INTENT_TAG_PRINT_COLOR[intentTag] ?? 'text-text-muted border-border-default'}`}>
                        {intentTag}
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 text-text-body">{unit.reason}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* テキスト全単元（画面のみ：テーブル表示） */}
      <section className="p-4 bg-surface-raised rounded-xl border border-border-default print:hidden">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-text-heading">テキスト全単元</h2>
          <span className="text-sm font-bold text-accent-ink">
            講習 {activeUnits.length}単元 / {totalKoma}コマ
          </span>
        </div>
        <table className="w-full text-xs proposal-print-table">
          <thead className="border-b border-border-default">
            <tr>
              <th className="py-2 text-left font-semibold text-text-muted">単元</th>
              <th className="py-2 text-center w-14 font-semibold text-text-muted">状況</th>
              <th className="py-2 text-center w-12 font-semibold text-text-muted">コマ</th>
              <th className="py-2 text-left font-semibold text-text-muted">指導意図</th>
              <th className="py-2 text-left font-semibold text-text-muted">理由</th>
            </tr>
          </thead>
          <tbody>
            {allItems.map((item, idx) => {
              const isTarget = selectedIds.has(item.id);
              const progress = progressMap.get(item.id);
              const itemDone = !!progress?.school_progress_date;
              const unit = unitMap.get(item.id);
              const gpos = getGroupPos(allItems, idx, unitMap);
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
                  <td className="py-2">
                    {isTarget && intentTag && (
                      <span
                        className={`inline-block px-1.5 py-0.5 border rounded-full text-[9px] font-medium ${INTENT_TAG_PRINT_COLOR[intentTag] ?? 'text-text-muted border-border-default'}`}
                      >
                        {intentTag}
                      </span>
                    )}
                  </td>
                  <td className={`py-2 ${isTarget ? 'text-text-body' : 'text-text-faint'}`}>
                    {isTarget ? unit?.reason : ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* テキスト全単元（印刷用：2段組コンパクト表示） */}
      <section className="hidden print:block print:p-0">
        <div className="flex items-center justify-between mb-1 border-b border-black pb-0.5">
          <h2 className="text-[10px] font-bold">テキスト全単元</h2>
          <span className="text-[10px] font-bold">
            講習 {totalKoma}コマ
          </span>
        </div>
        <div className="proposal-print-compact">
          {allItems.map((item, idx) => {
            const isTarget = selectedIds.has(item.id);
            const progress = progressMap.get(item.id);
            const itemDone = !!progress?.school_progress_date;
            const unit = unitMap.get(item.id);
            const gpos = getGroupPos(allItems, idx, unitMap);
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
        </div>
      </section>

      {/* サマリーフッター */}
      <section className="p-4 print:p-1 bg-surface rounded-xl border border-border-default print:border-border-strong">
        <div className="flex items-center gap-3">
          <div className="text-sm print:text-[10px] text-text-muted">講習内容:</div>
          <div className="text-sm print:text-[10px] font-bold text-accent-ink print:text-text-heading">
            {totalKoma}コマ
          </div>
        </div>
      </section>
    </div>
  );
}
