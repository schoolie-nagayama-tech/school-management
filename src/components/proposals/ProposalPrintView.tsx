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
  groupMap: Map<number, PrintUnitDraft[]>;
}

const INTENT_TAG_PRINT_COLOR: Record<string, string> = {
  '苦手補強': 'text-red-700 border-red-200',
  '既習の定着': 'text-blue-700 border-blue-200',
  '未習の先取り': 'text-purple-700 border-purple-200',
  '学校進度に合わせる': 'text-emerald-700 border-emerald-200',
  '直前演習': 'text-amber-700 border-amber-200',
  '応用発展': 'text-indigo-700 border-indigo-200',
};

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
  groupMap,
}: ProposalPrintData) {
  const selectedIds = new Set(activeUnits.map((u) => u.curriculum_item_id));
  const unitMap = new Map(activeUnits.map((u) => [u.curriculum_item_id, u]));
  const doneCount = allItems.filter((item) => !!progressMap.get(item.id)?.school_progress_date).length;

  return (
    <div className="proposal-print-page space-y-5 print:space-y-2">
      {/* ヘッダー */}
      <div className="p-5 bg-ink text-text-on-primary rounded-2xl print:rounded-none print:bg-white print:text-text-heading print:border-b-2 print:border-ink print:p-0 print:pb-2">
        <div className="text-lg font-bold print:text-base">{year}年 {seasonLabel}講習のご提案</div>
        <div className="text-sm mt-1 opacity-90 print:opacity-100 print:text-xs print:mt-0.5">
          {studentName} さま / {textbookName}
        </div>
      </div>

      {/* テーマ（印刷時も表示） */}
      {theme && (
        <section className="p-4 print:p-2 bg-surface-raised rounded-xl border border-border-default print:border-border-strong">
          <h2 className="text-sm print:text-xs font-bold text-text-heading mb-1 print:mb-0.5">講習テーマ</h2>
          <p className="text-sm print:text-xs text-text-body">{theme}</p>
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
            {activeUnits.map((unit) => {
              const item = allItems.find((i) => i.id === unit.curriculum_item_id);
              if (!item) return null;
              const isGrouped = unit.group_id > 0;
              const members = isGrouped ? groupMap.get(unit.group_id) : undefined;
              const isGroupHead = members && members[0]?.curriculum_item_id === item.id;
              const intentTag = unit.intent_tag
                ?? (isGrouped && members ? members[0]?.intent_tag : null)
                ?? null;

              return (
                <tr key={item.id} className="border-b border-border-subtle">
                  <td className="py-1.5 font-medium text-text-heading">
                    {item.title}
                    {isGrouped && <span className="ml-1 text-[9px] text-info">G{unit.group_id}</span>}
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

      {/* テキスト全単元（画面 + 印刷） */}
      <section className="p-4 print:p-2 bg-surface-raised rounded-xl border border-border-default print:border-border-strong">
        <div className="flex items-center justify-between mb-3 print:mb-1.5">
          <h2 className="text-sm print:text-xs font-bold text-text-heading">テキスト全単元</h2>
          <span className="text-sm print:text-xs font-bold text-accent-ink print:text-text-heading">
            講習 {activeUnits.length}単元 / {totalKoma}コマ
          </span>
        </div>
        <table className="w-full text-xs proposal-print-table">
          <thead className="border-b border-border-default">
            <tr>
              <th className="py-2 print:py-1 text-left font-semibold text-text-muted print:text-[10px]">単元</th>
              <th className="py-2 print:py-1 text-center w-14 font-semibold text-text-muted print:text-[10px]">状況</th>
              <th className="py-2 print:py-1 text-center w-12 font-semibold text-text-muted print:text-[10px]">コマ</th>
              <th className="py-2 print:py-1 text-left font-semibold text-text-muted print:text-[10px]">指導意図</th>
              <th className="py-2 print:py-1 text-left font-semibold text-text-muted print:text-[10px] print:hidden">理由</th>
            </tr>
          </thead>
          <tbody>
            {allItems.map((item) => {
              const isTarget = selectedIds.has(item.id);
              const progress = progressMap.get(item.id);
              const itemDone = !!progress?.school_progress_date;
              const unit = unitMap.get(item.id);
              const isGrouped = unit && unit.group_id > 0;
              const members = isGrouped ? groupMap.get(unit!.group_id) : undefined;
              const isGroupHead = members && members[0]?.curriculum_item_id === item.id;

              const intentTag = unit?.intent_tag
                ?? (isGrouped && members ? members[0]?.intent_tag : null)
                ?? null;

              return (
                <tr
                  key={item.id}
                  className={
                    isTarget
                      ? 'bg-accent-ink-subtle border-b border-accent-ink/10 print:bg-gray-50'
                      : 'border-b border-border-subtle'
                  }
                >
                  <td
                    className={`py-2 print:py-1 print:text-[11px] ${
                      isTarget
                        ? 'font-bold text-accent-ink print:text-text-heading'
                        : itemDone
                          ? 'text-text-faint line-through'
                          : 'text-text-body'
                    }`}
                  >
                    {item.title}
                    {isGrouped && (
                      <span className="ml-1 text-[9px] print:text-[8px] text-info">G{unit!.group_id}</span>
                    )}
                  </td>
                  <td className="py-2 print:py-1 text-center">
                    {itemDone ? (
                      <span className="inline-flex items-center gap-0.5 text-[10px] print:text-[9px] text-text-faint">
                        <Check className="w-3 h-3 print:w-2.5 print:h-2.5" />済
                      </span>
                    ) : isTarget ? (
                      <span className="px-1.5 py-0.5 bg-ink text-text-on-primary text-[10px] print:text-[9px] font-bold rounded">
                        講習
                      </span>
                    ) : (
                      <span className="text-[10px] print:text-[9px] text-text-faint">--</span>
                    )}
                  </td>
                  <td className="py-2 print:py-1 text-center font-bold text-accent-ink print:text-text-heading print:text-[11px]">
                    {isTarget && (!isGrouped || isGroupHead) ? unit?.koma_count : ''}
                  </td>
                  <td className="py-2 print:py-1">
                    {isTarget && intentTag && (
                      <span
                        className={`inline-block px-1.5 py-0.5 border rounded-full text-[9px] print:text-[8px] font-medium ${INTENT_TAG_PRINT_COLOR[intentTag] ?? 'text-text-muted border-border-default'}`}
                      >
                        {intentTag}
                      </span>
                    )}
                  </td>
                  <td className={`py-2 print:hidden ${isTarget ? 'text-text-body' : 'text-text-faint'}`}>
                    {isTarget ? unit?.reason : ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* サマリーフッター */}
      <section className="p-4 print:p-2 bg-surface rounded-xl border border-border-default print:border-border-strong">
        <div className="flex items-center gap-3">
          <div className="text-sm print:text-xs text-text-muted">講習内容:</div>
          <div className="text-sm print:text-xs font-bold text-accent-ink print:text-text-heading">
            {activeUnits.length}単元 / {totalKoma}コマ
          </div>
        </div>
      </section>
    </div>
  );
}
