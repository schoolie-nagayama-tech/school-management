'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import Link from 'next/link';
import { ArrowLeft, Check, Filter, FileText, Plus, Printer, User } from 'lucide-react';
import { Loading, InlineLoading } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import {
  getProposalsByStudent,
  bulkPublishProposals,
  bulkMarkProposalsSent,
  calcTotalKoma,
  calcTotalAppliedKoma,
} from '@/lib/api/proposals';
import { buildPrintSheets } from '@/lib/proposals/buildPrintSheets';
import {
  getProposalOrderCandidates,
  isRelevantOrderCandidate,
  type OrderCandidate,
} from '@/lib/api/ordering';
import { ProposalPrintView } from './ProposalPrintView';
import { PublishOrderDialog } from './PublishOrderDialog';
import type { ProposalPrintData } from './ProposalPrintView';
import type { SeasonalProposalWithDetails, SeasonType, ProposalStatus } from '@/types/database';
import { SEASON_LABELS, PROPOSAL_STATUS_LABELS, GRADE_LABELS } from '@/types/database';
import { getSubjectBadgeColor } from '@/lib/subjectBadge';
import { getPreparingSeason } from './proposalEditor.shared';

const STATUS_BADGE: Record<ProposalStatus, string> = {
  draft: 'bg-surface-hover text-text-muted',
  sent: 'bg-info-subtle text-info',
  approved: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
};

export default function ProposalList() {
  const params = useParams();
  const studentId = params?.studentId as string;
  const { profile } = useAuth();
  // 一括公開は教室長以上(manager/owner/admin)のみ許可
  const isManagerOrAbove =
    profile?.role === 'manager' || profile?.role === 'owner' || profile?.role === 'admin';

  const [loading, setLoading] = useState(true);
  const [studentName, setStudentName] = useState('');
  const [studentGrade, setStudentGrade] = useState<number | null>(null);
  const [proposals, setProposals] = useState<SeasonalProposalWithDetails[]>([]);
  /**
   * 講習（期）の絞り込み。教室全体の一覧（/courses/proposals）と同じ仕様に揃える。
   * ★既定は「これから準備する期」。全部出すと過去の講習の提案書が混ざって、
   *   いま作っている期のものを探せない（全体の一覧が全シーズン既定をやめたのと同じ理由）。
   * ★年度は全体の一覧と同じく前後1年ぶんだけ選べる。「全年度」は無い。
   */
  const [filterYear, setFilterYear] = useState<number>(new Date().getFullYear());
  const [filterSeason, setFilterSeason] = useState<SeasonType | ''>(() => getPreparingSeason());
  const [printMode, setPrintMode] = useState(false);
  const [printLoading, setPrintLoading] = useState(false);
  const [printData, setPrintData] = useState<ProposalPrintData[]>([]);

  // 一括公開 / 一括提案済み
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [publishing, setPublishing] = useState(false);
  const [sending, setSending] = useState(false);
  // 公開後の教材発注ダイアログ（公開前に算出した候補スナップショット）
  const [orderDialog, setOrderDialog] = useState<OrderCandidate[] | null>(null);

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

  // ★絞り込みを変えたら選択を捨てる。見えていない提案書が一括公開に混ざらないようにする
  useEffect(() => {
    setSelected(new Set());
  }, [filterYear, filterSeason]);

  // ── チェック操作 ──

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /**
   * 絞り込み後の提案書。★以降の集計・一括操作・印刷はすべてこれを見る。
   *   画面に出ていないものが一括公開や印刷に混ざると、別の期の提案書を
   *   知らないうちに公開してしまう。
   */
  const visibleProposals = proposals.filter(
    (p) => p.year === filterYear && (!filterSeason || p.season === filterSeason)
  );
  /** 絞り込みで隠れている件数。「消えた」と思わせないために件数だけ伝える */
  const hiddenCount = proposals.length - visibleProposals.length;

  // 一括操作の対象は「未公開（下書き or 提案済み）」。バー表示・全選択の母集団。
  const actionable = visibleProposals.filter((p) => p.status !== 'approved');
  // 公開対象は「提案済み(sent)」のみ。下書きからの直接公開は禁止（提案済みを経由させる）。
  const publishable = visibleProposals.filter((p) => p.status === 'sent');
  // 公開ボタン用: 選択中のうち sent（公開できる）件数
  const selectedCount = Array.from(selected).filter((id) =>
    publishable.some((p) => p.id === id)
  ).length;
  // 「提案済みにする」は下書き(draft)のみ対象（sentの再初期化で手入力の申込を上書きしないため）
  const selectedDraftCount = Array.from(selected).filter((id) =>
    visibleProposals.some((p) => p.id === id && p.status === 'draft')
  ).length;
  // 「○件選択」表示用: 未公開のうち選択中の件数
  const selectedActionableCount = Array.from(selected).filter((id) =>
    actionable.some((p) => p.id === id)
  ).length;

  const selectAllActionable = () => setSelected(new Set(actionable.map((p) => p.id)));
  const clearSelection = () => setSelected(new Set());

  const handleBulkPublish = async () => {
    // 一括公開は教室長以上のみ許可
    if (!isManagerOrAbove) return;
    const ids = Array.from(selected).filter((id) => publishable.some((p) => p.id === id));
    if (ids.length === 0) return;
    if (
      !window.confirm(
        `${ids.length}件の提案書を公開しますか？\n\n申込コマ数が進行表に反映され、講師に公開されます。`
      )
    )
      return;
    setPublishing(true);
    try {
      // 公開前に発注候補をスナップショット（所持判定は is_draft=false 化の前に取る必要がある）
      const targets = visibleProposals.filter((p) => ids.includes(p.id));
      let candidates: OrderCandidate[] = [];
      try {
        candidates = await getProposalOrderCandidates(
          targets.map((p) => ({
            proposalId: p.id,
            studentId: p.student_id,
            studentName,
            schoolId: p.school_id ?? null,
            textbookId: p.textbook_id,
            textbookName: p.textbook?.subject
              ? `${p.textbook.subject} ${p.textbook.name}`
              : (p.textbook?.name ?? '不明'),
            materialId: p.textbook?.material_id ?? null,
          }))
        );
      } catch (e) {
        console.error('発注候補の取得に失敗:', e);
      }

      const { success, failed } = await bulkPublishProposals(ids);
      if (failed > 0) {
        alert(`${success}件を公開、${failed}件が失敗しました`);
      }
      clearSelection();
      await load();

      const relevant = candidates.filter(isRelevantOrderCandidate);
      if (relevant.length > 0) setOrderDialog(candidates);
    } catch (e) {
      console.error(e);
    } finally {
      setPublishing(false);
    }
  };

  // ── 一括提案済み（draft → sent。公開と違い進行表へは反映しない） ──
  const handleBulkSent = async () => {
    const ids = Array.from(selected).filter((id) =>
      visibleProposals.some((p) => p.id === id && p.status === 'draft')
    );
    if (ids.length === 0) return;
    if (
      !window.confirm(
        `${ids.length}件の提案書を「提案済み」にしますか？\n\n申込コマ数を入力できる状態になります（進行表への反映は公開時）。`
      )
    )
      return;
    setSending(true);
    try {
      const { success, failed } = await bulkMarkProposalsSent(ids);
      if (failed > 0) {
        alert(`${success}件を提案済みに、${failed}件が失敗しました`);
      }
      clearSelection();
      await load();
    } catch (e) {
      console.error(e);
    } finally {
      setSending(false);
    }
  };

  // ── 一括印刷（同じ科目は1枚にまとめ、紙は科目順） ──

  const handleBulkPrint = async () => {
    // ★印刷するのは絞り込んだぶんだけ。全期を出すと過去の講習の紙まで混ざる
    if (visibleProposals.length === 0) return;
    setPrintLoading(true);
    try {
      // まとめる規則（生徒×期×科目で1枚・中は作った順）と取得は buildPrintSheets に集約。
      // 教室全体の提案書一覧（/courses/proposals）も同じ関数を使う。
      const results = await buildPrintSheets(visibleProposals, studentName);

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
  // 新規作成の既定シーズン。実施の数か月前に作るので「今」ではなく「次に作るシーズン」
  const newProposalSeason = getPreparingSeason();

  // ── 印刷モード ──
  if (printMode) {
    return (
      <div className="proposal-print-root max-w-5xl mx-auto">
        <div className="mb-4 flex items-center gap-2 print:hidden">
          <button
            onClick={() => setPrintMode(false)}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium border border-border text-text-body rounded-lg hover:bg-surface-hover transition-colors duration-150"
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
          <span className="text-sm text-text-muted ml-2">
            {studentName} ({printData.length}枚)
          </span>
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
  const byTextbook = new Map<
    number,
    { name: string; subject: string; proposals: SeasonalProposalWithDetails[] }
  >();
  for (const p of visibleProposals) {
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

  // ── 科目別サマリー（上部に「何の科目を何コマ提案しているか」を集約表示） ──
  // 全提案書を科目で束ね、提案コマ数・申込コマ数を合算する。科目バッジ＋コマ数で一覧性を上げる狙い。
  const bySubject = new Map<string, { koma: number; appliedKoma: number; count: number }>();
  for (const p of visibleProposals) {
    const subject = p.textbook?.subject || 'その他';
    const entry = bySubject.get(subject) ?? { koma: 0, appliedKoma: 0, count: 0 };
    entry.koma += calcTotalKoma(p.units);
    entry.appliedKoma += calcTotalAppliedKoma(p.units) ?? 0;
    entry.count += 1;
    bySubject.set(subject, entry);
  }
  const subjectSummary = Array.from(bySubject.entries()).sort(([a], [b]) =>
    a.localeCompare(b, 'ja')
  );
  const totalKomaAll = subjectSummary.reduce((sum, [, v]) => sum + v.koma, 0);

  const hasSelection = selected.size > 0;

  return (
    <div>
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
                {studentGrade ? `${GRADE_LABELS[studentGrade]} ` : ''}提案書{' '}
                {visibleProposals.length}件
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {visibleProposals.length > 0 && (
              <button
                onClick={handleBulkPrint}
                disabled={printLoading}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium border border-border text-text-body rounded-lg hover:bg-surface-hover active:scale-[0.97] transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] disabled:opacity-50"
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
              href={`/students/${studentId}/koushu-textbooks`}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium border border-border text-text-body rounded-lg hover:bg-surface-hover transition-colors duration-150"
            >
              使用テキスト
            </Link>
            <Link
              href={`/students/${studentId}/test-prep`}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium border border-border text-text-body rounded-lg hover:bg-surface-hover transition-colors duration-150"
            >
              テスト対策
            </Link>
            <Link
              href={`/students/${studentId}/proposals/new?season=${newProposalSeason}&year=${currentYear}`}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-ink text-text-on-primary rounded-lg hover:brightness-[0.85] transition-[filter] duration-150"
            >
              <Plus className="w-3 h-3" />
              新規作成
            </Link>
          </div>
        </div>
      </div>

      {/* 講習（期）の絞り込み。教室全体の一覧と同じ並び・同じ選択肢にする */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Filter className="w-3.5 h-3.5 text-text-faint" aria-hidden="true" />
        <select
          value={filterYear}
          onChange={(e) => setFilterYear(Number(e.target.value))}
          aria-label="年度"
          className="px-2 py-1.5 border border-border rounded-lg text-xs bg-surface-raised text-text-body"
        >
          {[currentYear + 1, currentYear, currentYear - 1].map((y) => (
            <option key={y} value={y}>
              {y}年
            </option>
          ))}
        </select>
        <select
          value={filterSeason}
          onChange={(e) => setFilterSeason(e.target.value as SeasonType | '')}
          aria-label="シーズン"
          className="px-2 py-1.5 border border-border rounded-lg text-xs bg-surface-raised text-text-body"
        >
          <option value="">全シーズン</option>
          {(['spring', 'summer', 'winter'] as SeasonType[]).map((s) => (
            <option key={s} value={s}>
              {SEASON_LABELS[s]}
            </option>
          ))}
        </select>
        {!loading && hiddenCount > 0 && (
          <span className="text-[11px] text-text-muted">ほかの期に{hiddenCount}件</span>
        )}
      </div>

      {/* 科目別サマリー */}
      {!loading && subjectSummary.length > 0 && (
        <div className="mb-4 flex items-center gap-2 flex-wrap px-3.5 py-2.5 rounded-xl border border-border-subtle bg-surface-raised">
          <span className="text-[11px] font-medium text-text-faint shrink-0">提案内容</span>
          {subjectSummary.map(([subject, v]) => {
            const colors = getSubjectBadgeColor(subject === 'その他' ? null : subject);
            return (
              <span
                key={subject}
                className="inline-flex items-center gap-1.5 pl-1.5 pr-2 py-1 rounded-lg bg-surface-hover"
              >
                <span
                  className={`inline-flex px-1.5 py-0.5 text-[11px] font-bold rounded ${colors.bg} ${colors.text}`}
                >
                  {subject}
                </span>
                <span className="text-xs font-semibold text-text-heading tabular-nums">
                  {v.koma}コマ
                </span>
              </span>
            );
          })}
          <span className="flex-1" />
          <span className="text-xs text-text-muted shrink-0">
            合計 <span className="font-bold text-text-heading tabular-nums">{totalKomaAll}</span>
            コマ
          </span>
        </div>
      )}

      {/* 一括バー: 提案済みは全スタッフ可、公開は教室長以上のみ。未公開(下書き/提案済み)があれば表示 */}
      {!loading && actionable.length > 0 && (
        <div
          className={`mb-4 flex items-center gap-3 px-3.5 py-2 rounded-xl border transition-[background-color,border-color,box-shadow] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] ${
            hasSelection
              ? 'bg-emerald-50 border-emerald-200 shadow-sm'
              : 'bg-surface-raised border-border-subtle'
          }`}
        >
          <button
            onClick={() => (hasSelection ? clearSelection() : selectAllActionable())}
            className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors duration-150 ${
              hasSelection
                ? 'bg-emerald-600 border-emerald-600 text-white'
                : 'border-border hover:border-text-muted'
            }`}
          >
            {hasSelection && <Check className="w-2.5 h-2.5" />}
          </button>

          {hasSelection ? (
            <>
              <span className="text-xs font-medium text-emerald-800">
                {selectedActionableCount}件選択
              </span>
              <button
                onClick={clearSelection}
                className="text-[11px] text-emerald-600 hover:text-emerald-800 transition-colors"
              >
                解除
              </button>
              <div className="flex-1" />
              {/* 提案済み: 下書きのみ対象。全スタッフ可 */}
              <button
                onClick={handleBulkSent}
                disabled={sending || publishing || selectedDraftCount === 0}
                title={
                  selectedDraftCount === 0
                    ? '下書きの提案書を選択してください'
                    : `${selectedDraftCount}件を提案済みにする`
                }
                className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold bg-info text-white rounded-lg hover:brightness-95 active:scale-[0.97] transition-[filter,transform] duration-150 disabled:opacity-50"
              >
                {sending ? (
                  <InlineLoading size="sm" label="変更中..." />
                ) : (
                  `提案済みにする${selectedDraftCount > 0 ? ` (${selectedDraftCount})` : ''}`
                )}
              </button>
              {/* 公開: 教室長以上のみ */}
              {isManagerOrAbove && (
                <button
                  onClick={handleBulkPublish}
                  disabled={publishing || sending || selectedCount === 0}
                  className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 active:scale-[0.97] transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] disabled:opacity-50"
                >
                  {publishing ? <InlineLoading size="sm" label="公開中..." /> : `公開する`}
                </button>
              )}
            </>
          ) : (
            <>
              <span className="text-xs text-text-faint">未公開 {actionable.length}件</span>
              <div className="flex-1" />
              <button
                onClick={selectAllActionable}
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
      ) : visibleProposals.length === 0 ? (
        <div
          className="stagger-item py-12 text-center text-sm text-text-faint"
          style={{ '--stagger-index': 0 } as React.CSSProperties}
        >
          {/* ★「消えた」と思わせない。ほかの期にあるなら、そう書いて切り替えを促す */}
          {proposals.length === 0
            ? '提案書はまだありません'
            : `この期の提案書はありません（ほかの期に${hiddenCount}件あります）`}
        </div>
      ) : (
        <div className="space-y-6">
          {sortedTextbooks.map(([tbId, { name, subject, proposals: tbProposals }], i) => (
            <div
              key={tbId}
              // stagger-item: テキストグループ単位で40ms刻みフェードイン（最大8グループでクランプ）
              className="stagger-item bg-surface-raised rounded-xl border border-border overflow-hidden"
              style={{ '--stagger-index': Math.min(i, 7) } as React.CSSProperties}
            >
              <div className="px-4 py-3 border-b border-border-subtle">
                <div className="font-semibold text-sm text-text-heading flex items-center gap-1.5">
                  {subject &&
                    (() => {
                      const colors = getSubjectBadgeColor(subject);
                      return (
                        <span
                          className={`inline-flex px-1.5 py-0.5 text-[11px] font-bold rounded shrink-0 ${colors.bg} ${colors.text}`}
                        >
                          {subject}
                        </span>
                      );
                    })()}
                  <span className="truncate">{name}</span>
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
                              : 'border-border hover:border-text-muted'
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
                            <span>
                              {p.year}年 {SEASON_LABELS[p.season as SeasonType]}
                            </span>
                            <span>
                              {p.units.length}単元 / {koma}コマ
                            </span>
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

      {/* 公開後の教材発注ダイアログ */}
      {orderDialog && (
        <PublishOrderDialog candidates={orderDialog} onClose={() => setOrderDialog(null)} />
      )}
    </div>
  );
}
