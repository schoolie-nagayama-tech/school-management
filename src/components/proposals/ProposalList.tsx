'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Check, FileText, Plus, Printer, User } from 'lucide-react';
import { Button, Loading, InlineLoading } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import {
  getProposalsByStudent,
  getTextbookUnitsWithProgress,
  bulkPublishProposals,
  calcTotalKoma,
  calcTotalAppliedKoma,
} from '@/lib/api/proposals';
import { ProposalPrintView } from './ProposalPrintView';
import type { PrintUnitDraft, ProposalPrintData } from './ProposalPrintView';
import type { SeasonalProposalWithDetails, SeasonType, ProposalStatus } from '@/types/database';
import { SEASON_LABELS, PROPOSAL_STATUS_LABELS, GRADE_LABELS } from '@/types/database';

const STATUS_BADGE: Record<ProposalStatus, string> = {
  draft: 'bg-surface-hover text-text-muted',
  sent: 'bg-info-subtle text-info',
  approved: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
};

export default function ProposalList() {
  const params = useParams();
  const studentId = params?.studentId as string;

  const [loading, setLoading] = useState(true);
  const [studentName, setStudentName] = useState('');
  const [studentGrade, setStudentGrade] = useState<number | null>(null);
  const [proposals, setProposals] = useState<SeasonalProposalWithDetails[]>([]);
  const [printMode, setPrintMode] = useState(false);
  const [printLoading, setPrintLoading] = useState(false);
  const [printData, setPrintData] = useState<ProposalPrintData[]>([]);

  // 一括公開
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [publishing, setPublishing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: student } = await supabase
        .from('students')
        .select('last_name, first_name, grade')
        .eq('id', studentId)
        .single();

      if (student) {
        setStudentName(`${student.last_name} ${student.first_name}`);
        setStudentGrade(student.grade ?? null);
      }

      const list = await getProposalsByStudent(studentId);
      setProposals(list);
      setSelected(new Set());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    load();
  }, [load]);

  // ── チェック操作 ──

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const publishable = proposals.filter((p) => p.status !== 'approved');
  const selectedCount = Array.from(selected).filter((id) =>
    publishable.some((p) => p.id === id)
  ).length;

  const selectAllPublishable = () => setSelected(new Set(publishable.map((p) => p.id)));
  const clearSelection = () => setSelected(new Set());

  const handleBulkPublish = async () => {
    const ids = Array.from(selected).filter((id) => publishable.some((p) => p.id === id));
    if (ids.length === 0) return;
    if (!window.confirm(
      `${ids.length}件の提案書を公開しますか？\n\n申込コマ数が進行表に反映され、講師に公開されます。`
    )) return;
    setPublishing(true);
    try {
      const { success, failed } = await bulkPublishProposals(ids);
      if (failed > 0) {
        alert(`${success}件を公開、${failed}件が失敗しました`);
      }
      clearSelection();
      await load();
    } catch (e) {
      console.error(e);
    } finally {
      setPublishing(false);
    }
  };

  // ── 一括印刷（科目順にソート） ──

  const handleBulkPrint = async () => {
    if (proposals.length === 0) return;
    setPrintLoading(true);
    try {
      const results: ProposalPrintData[] = [];

      const sorted = [...proposals].sort((a, b) => {
        const sa = a.textbook?.subject ?? '';
        const sb = b.textbook?.subject ?? '';
        if (sa !== sb) return sa.localeCompare(sb, 'ja');
        const na = a.textbook?.name ?? '';
        const nb = b.textbook?.name ?? '';
        return na.localeCompare(nb, 'ja');
      });

      for (const p of sorted) {
        const { items, progressMap } = await getTextbookUnitsWithProgress(
          p.student_textbook_id ?? null,
          p.textbook_id
        );

        const activeUnits: PrintUnitDraft[] = p.units
          .filter((u) => u.koma_count > 0)
          .map((u) => ({
            curriculum_item_id: u.curriculum_item_id,
            koma_count: u.koma_count,
            applied_koma: u.applied_koma ?? 0,
            reason: u.reason,
            group_id: u.group_id,
            intent_tag: u.intent_tag ?? null,
          }));

        const groupMap = new Map<number, PrintUnitDraft[]>();
        for (const u of activeUnits) {
          if (u.group_id > 0) {
            const list = groupMap.get(u.group_id) ?? [];
            list.push(u);
            groupMap.set(u.group_id, list);
          }
        }

        const tbName = p.textbook?.subject
          ? `${p.textbook.subject} ${p.textbook.name}`
          : p.textbook?.name ?? '';

        results.push({
          studentName,
          textbookName: tbName,
          seasonLabel: `${SEASON_LABELS[p.season as SeasonType]}`,
          year: p.year,
          theme: p.theme,
          allItems: items,
          activeUnits,
          progressMap,
          totalKoma: calcTotalKoma(p.units),
          groupMap,
        });
      }

      setPrintData(results);
      setPrintMode(true);
      setTimeout(() => window.print(), 300);
    } catch (e) {
      console.error(e);
    } finally {
      setPrintLoading(false);
    }
  };

  const currentYear = new Date().getFullYear();
  const currentSeason = getCurrentSeason();

  // ── 印刷モード ──
  if (printMode) {
    return (
      <div className="max-w-5xl mx-auto">
        <div className="mb-4 flex items-center gap-2 print:hidden">
          <button
            onClick={() => setPrintMode(false)}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium border border-border-default text-text-body rounded-lg hover:bg-surface-hover transition-colors duration-150"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            戻る
          </button>
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-ink text-text-on-primary rounded-lg hover:brightness-[0.85] transition-[filter] duration-150"
          >
            <Printer className="w-3.5 h-3.5" />
            印刷
          </button>
          <span className="text-sm text-text-muted ml-2">{studentName} ({printData.length}件)</span>
        </div>
        <div className="space-y-8">
          {printData.map((data, i) => (
            <div key={i} className="print:break-before-page first:print:break-before-auto">
              <ProposalPrintView {...data} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── 科目→テキストごとにグループ化 ──
  const byTextbook = new Map<number, { name: string; subject: string; proposals: SeasonalProposalWithDetails[] }>();
  for (const p of proposals) {
    const tbId = p.textbook_id;
    const tbName = p.textbook?.name ?? '不明なテキスト';
    const tbSubject = p.textbook?.subject ?? '';
    if (!byTextbook.has(tbId)) {
      byTextbook.set(tbId, { name: tbName, subject: tbSubject, proposals: [] });
    }
    byTextbook.get(tbId)!.proposals.push(p);
  }
  const sortedTextbooks = Array.from(byTextbook.entries()).sort(([, a], [, b]) => {
    if (a.subject !== b.subject) return a.subject.localeCompare(b.subject, 'ja');
    return a.name.localeCompare(b.name, 'ja');
  });

  const hasSelection = selected.size > 0;

  return (
    <div className="max-w-5xl mx-auto">
      {/* ヘッダー */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Link
            href="/courses/proposals"
            className="text-xs text-text-muted hover:text-text-heading inline-flex items-center gap-1 transition-colors duration-150"
          >
            <ArrowLeft className="w-3 h-3" />
            提案書一覧
          </Link>
          <span className="text-xs text-text-faint">/</span>
          <span className="text-xs text-text-muted">{studentName}</span>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-ink/10 flex items-center justify-center shrink-0">
              <User className="w-4 h-4 text-ink" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-text-heading">{studentName}</h1>
              <p className="text-xs text-text-muted">
                {studentGrade ? `${GRADE_LABELS[studentGrade]} ` : ''}提案書 {proposals.length}件
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {proposals.length > 0 && (
              <button
                onClick={handleBulkPrint}
                disabled={printLoading}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium border border-border-default text-text-body rounded-lg hover:bg-surface-hover active:scale-[0.97] transition-[colors,transform] duration-150 disabled:opacity-50"
              >
                {printLoading ? (
                  <InlineLoading size="sm" label="読み込み中..." />
                ) : (
                  <>
                    <Printer className="w-3 h-3" />
                    一括印刷
                  </>
                )}
              </button>
            )}
            <Link
              href={`/students/${studentId}/proposals/new?season=${currentSeason}&year=${currentYear}`}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-ink text-text-on-primary rounded-lg hover:brightness-[0.85] transition-[filter] duration-150"
            >
              <Plus className="w-3 h-3" />
              新規作成
            </Link>
          </div>
        </div>
      </div>

      {/* 一括公開バー */}
      {!loading && publishable.length > 0 && (
        <div
          className={`mb-4 flex items-center gap-3 px-3.5 py-2 rounded-xl border transition-all duration-200 ${
            hasSelection
              ? 'bg-emerald-50 border-emerald-200 shadow-sm'
              : 'bg-surface-raised border-border-subtle'
          }`}
        >
          <button
            onClick={() => hasSelection ? clearSelection() : selectAllPublishable()}
            className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors duration-150 ${
              hasSelection
                ? 'bg-emerald-600 border-emerald-600 text-white'
                : 'border-border-default hover:border-text-muted'
            }`}
          >
            {hasSelection && <Check className="w-2.5 h-2.5" />}
          </button>

          {hasSelection ? (
            <>
              <span className="text-xs font-medium text-emerald-800">
                {selectedCount}件選択
              </span>
              <button
                onClick={clearSelection}
                className="text-[11px] text-emerald-600 hover:text-emerald-800 transition-colors"
              >
                解除
              </button>
              <div className="flex-1" />
              <button
                onClick={handleBulkPublish}
                disabled={publishing || selectedCount === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 active:scale-[0.97] transition-[colors,transform] duration-150 disabled:opacity-50"
              >
                {publishing ? (
                  <InlineLoading size="sm" label="公開中..." />
                ) : (
                  `公開する`
                )}
              </button>
            </>
          ) : (
            <>
              <span className="text-xs text-text-faint">
                未公開 {publishable.length}件
              </span>
              <div className="flex-1" />
              <button
                onClick={selectAllPublishable}
                className="text-[11px] text-text-faint hover:text-text-muted transition-colors"
              >
                すべて選択
              </button>
            </>
          )}
        </div>
      )}

      {/* 一覧 */}
      {loading ? (
        <Loading size="md" />
      ) : proposals.length === 0 ? (
        <div className="py-12 text-center text-sm text-text-faint">
          提案書はまだありません
        </div>
      ) : (
        <div className="space-y-6">
          {sortedTextbooks.map(([tbId, { name, subject, proposals: tbProposals }]) => (
            <div key={tbId} className="bg-surface-raised rounded-xl border border-border-default overflow-hidden">
              <div className="px-4 py-3 border-b border-border-subtle">
                <div className="font-semibold text-sm text-text-heading">
                  {subject && <span className="text-text-muted font-normal mr-1.5">{subject}</span>}
                  {name}
                </div>
              </div>

              <div className="divide-y divide-border-subtle">
                {tbProposals.map((p) => {
                  const koma = calcTotalKoma(p.units);
                  const appliedKoma = calcTotalAppliedKoma(p.units);
                  const isChecked = selected.has(p.id);
                  const isApproved = p.status === 'approved';

                  return (
                    <div
                      key={p.id}
                      className={`flex items-center gap-3 pl-3 pr-4 py-3 transition-colors duration-150 ${
                        isChecked ? 'bg-emerald-50/60' : 'hover:bg-surface-hover'
                      }`}
                    >
                      {/* チェックボックス or 公開済みマーク */}
                      {!isApproved ? (
                        <button
                          onClick={() => toggleSelect(p.id)}
                          className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors duration-150 ${
                            isChecked
                              ? 'bg-emerald-600 border-emerald-600 text-white'
                              : 'border-border-default hover:border-text-muted'
                          }`}
                        >
                          {isChecked && <Check className="w-2.5 h-2.5" />}
                        </button>
                      ) : (
                        <div className="w-4 h-4 shrink-0 flex items-center justify-center">
                          <Check className="w-3 h-3 text-emerald-500" />
                        </div>
                      )}

                      <Link
                        href={`/students/${studentId}/proposals/${p.id}`}
                        className="flex items-center gap-3 flex-1 min-w-0"
                      >
                        <FileText className="w-4 h-4 text-text-faint shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-text-heading truncate">
                            {p.theme || `${p.year}年 ${SEASON_LABELS[p.season as SeasonType]}講習`}
                          </div>
                          <div className="text-xs text-text-muted flex gap-2 flex-wrap">
                            <span>{p.year}年 {SEASON_LABELS[p.season as SeasonType]}</span>
                            <span>{p.units.length}単元 / {koma}コマ</span>
                            {appliedKoma != null && (
                              <span className="text-info">申込 {appliedKoma}コマ</span>
                            )}
                          </div>
                        </div>
                        <span
                          className={`px-2 py-0.5 text-[10px] font-bold rounded shrink-0 ${STATUS_BADGE[p.status]}`}
                        >
                          {PROPOSAL_STATUS_LABELS[p.status]}
                        </span>
                      </Link>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function getCurrentSeason(): SeasonType {
  const month = new Date().getMonth() + 1;
  if (month >= 2 && month <= 4) return 'spring';
  if (month >= 5 && month <= 9) return 'summer';
  return 'winter';
}
