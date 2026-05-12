import { Check } from 'lucide-react';
import type { CurriculumItem, StudentProgress } from '@/types/database';

export interface PrintUnitDraft {
  curriculum_item_id: number;
  koma_count: number;
  applied_koma: number;
  reason: string;
  group_id: number;
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
    <div className="space-y-5 print:space-y-4">
      <div className="p-5 bg-ink text-text-on-primary rounded-2xl print:rounded-none print:bg-white print:text-text-heading print:border-b-2 print:border-ink">
        <div className="text-lg font-bold">{year}年 {seasonLabel}講習のご提案</div>
        <div className="text-sm mt-1 opacity-90 print:opacity-100">
          {studentName} さま / {textbookName}
        </div>
      </div>

      {theme && (
        <section className="p-4 bg-surface-raised rounded-xl border border-border-default print:border-border-strong">
          <h2 className="text-sm font-bold text-text-heading mb-1">講習テーマ</h2>
          <p className="text-sm text-text-body">{theme}</p>
        </section>
      )}

      <section className="p-4 bg-surface-raised rounded-xl border border-border-default print:border-border-strong">
        <h2 className="text-sm font-bold text-text-heading mb-2">現在の進捗</h2>
        <div className="flex items-center gap-3">
          <div className="flex-1 h-2 bg-surface-hover rounded-full overflow-hidden print:border print:border-border-strong">
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

      <section className="p-4 bg-surface-raised rounded-xl border border-border-default print:border-border-strong">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-text-heading">テキスト全単元と講習対象</h2>
          <span className="text-sm font-bold text-accent-ink print:text-text-heading">
            講習 {totalKoma}コマ / {activeUnits.length}単元
          </span>
        </div>
        <table className="w-full text-xs">
          <thead className="border-b border-border-default">
            <tr>
              <th className="py-2 text-left font-semibold text-text-muted">単元</th>
              <th className="py-2 text-center w-14 font-semibold text-text-muted">状況</th>
              <th className="py-2 text-center w-12 font-semibold text-text-muted">コマ</th>
              <th className="py-2 text-left font-semibold text-text-muted">講習で扱う理由</th>
            </tr>
          </thead>
          <tbody>
            {allItems.map((item) => {
              const isTarget = selectedIds.has(item.id);
              const progress = progressMap.get(item.id);
              const itemDone = !!progress?.school_progress_date;
              const unit = unitMap.get(item.id);
              const isGrouped = unit && unit.group_id > 0;
              const members = isGrouped ? groupMap.get(unit.group_id) : undefined;
              const isGroupHead = members && members[0]?.curriculum_item_id === item.id;

              return (
                <tr
                  key={item.id}
                  className={
                    isTarget
                      ? 'bg-accent-ink-subtle border-b border-accent-ink/10 print:bg-surface'
                      : 'border-b border-border-subtle'
                  }
                >
                  <td
                    className={`py-2 ${
                      isTarget
                        ? 'font-bold text-accent-ink print:text-text-heading'
                        : itemDone
                          ? 'text-text-faint line-through'
                          : 'text-text-body'
                    }`}
                  >
                    {item.title}
                    {isGrouped && (
                      <span className="ml-1 text-[9px] text-info">G{unit.group_id}</span>
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
                  <td className="py-2 text-center font-bold text-accent-ink print:text-text-heading">
                    {isTarget && (!isGrouped || isGroupHead) ? unit?.koma_count : ''}
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

      <section className="p-4 bg-surface rounded-xl border border-border-default print:border-border-strong">
        <div className="flex items-center gap-3">
          <div className="text-sm text-text-muted">講習内容:</div>
          <div className="text-sm font-bold text-accent-ink print:text-text-heading">
            {activeUnits.length}単元 / {totalKoma}コマ
          </div>
        </div>
      </section>
    </div>
  );
}
