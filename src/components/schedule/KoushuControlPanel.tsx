'use client';

/**
 * 講習コントロールパネル（座席表の講習モード操作を1か所に集約）
 *
 * 講習モードの切替は頻繁な操作ではないため、講習系の操作（マッチング実行・下書き公開・配置進捗）を
 * このアコーディオン1枚にまとめてツールバーをすっきりさせる。
 *
 * 機能:
 *  - 個別の自動マッチング実行（generateKoushuIndividualProposals）→ 下書き提案を一覧
 *  - 下書きの個別公開 / 全公開 / 却下（既存 schedule-match.ts を利用）
 *  - 配置進捗（KoushuPlacementPanel）を内包
 */

import { useState, useCallback, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui';
import { KoushuPlacementPanel } from './KoushuPlacementPanel';
import { generateKoushuIndividualProposals, type KoushuMatchResult } from '@/lib/api/koushu-match';
import {
  getProposalsByBatch,
  publishProposal,
  publishAllDraftsInBatch,
  dismissProposal,
  type ScheduleMatchProposal,
} from '@/lib/api/schedule-match';
import type { KoushuPeriodInfo } from '@/lib/api/koushu-period';
import { ChevronDown, ChevronRight, Wand2, Check, X, GraduationCap } from 'lucide-react';

interface Props {
  period: KoushuPeriodInfo;
  schoolId: string;
  /** マッチング実行者（公開者）の user_id */
  executedBy: string;
  /** 配置モード開始（既存 KoushuPlacementPanel 用） */
  onStartPlacement?: (studentId: string, subjectIds: string[]) => void;
  placingStudentId?: string | null;
  /** 配置モード中の科目ID（科目別配置の終了ラベル判定用） */
  placingSubjectId?: string | null;
  /** 科目ID→名前 */
  subjectNameById?: Map<string, string>;
  /** 配置進捗の再フェッチ用キー */
  refreshKey?: number;
  /** 集団コマ時間がある場合、集団の配置進捗も表示する */
  showGroupProgress?: boolean;
  /** 公開などで座席表エントリが変わったとき、親に再取得を促す */
  onPublished: () => void;
  /** 下書き提案が変化したとき親に通知（座席表に★で重ねるため） */
  onDraftsChange?: (drafts: ScheduleMatchProposal[]) => void;
  /** 講習モード解除 */
  onClose: () => void;
}

export function KoushuControlPanel({
  period,
  schoolId,
  executedBy,
  onStartPlacement,
  placingStudentId,
  placingSubjectId,
  subjectNameById,
  refreshKey,
  showGroupProgress = false,
  onPublished,
  onDraftsChange,
  onClose,
}: Props) {
  const [open, setOpen] = useState(true);
  const [running, setRunning] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [proposals, setProposals] = useState<ScheduleMatchProposal[]>([]);
  const [result, setResult] = useState<KoushuMatchResult | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const drafts = proposals.filter((p) => p.status === 'draft');

  // 下書きの変化を親へ通知（座席表に★で重ねる）。閉じる時はクリアされるよう空配列も流す。
  useEffect(() => {
    onDraftsChange?.(proposals.filter((p) => p.status === 'draft'));
  }, [proposals, onDraftsChange]);

  const reloadProposals = useCallback(async (bid: string) => {
    const list = await getProposalsByBatch(bid);
    setProposals(list);
  }, []);

  const handleRunMatching = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await generateKoushuIndividualProposals({ schoolId, period, executedBy });
      setBatchId(res.batchId);
      setResult(res);
      if (res.batchId) await reloadProposals(res.batchId);
      else setProposals([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'マッチングに失敗しました');
    } finally {
      setRunning(false);
    }
  };

  const handlePublishOne = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      await publishProposal(id, executedBy);
      if (batchId) await reloadProposals(batchId);
      onPublished();
    } catch (e) {
      setError(e instanceof Error ? e.message : '公開に失敗しました');
    } finally {
      setBusyId(null);
    }
  };

  const handleDismissOne = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      await dismissProposal(id);
      if (batchId) await reloadProposals(batchId);
    } catch (e) {
      setError(e instanceof Error ? e.message : '却下に失敗しました');
    } finally {
      setBusyId(null);
    }
  };

  const handlePublishAll = async () => {
    if (!batchId) return;
    setRunning(true);
    setError(null);
    try {
      const r = await publishAllDraftsInBatch(batchId, executedBy);
      await reloadProposals(batchId);
      onPublished();
      if (r.failed > 0) setError(`${r.published}件公開・${r.failed}件は重複等で失敗`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '一括公開に失敗しました');
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card className="border-info/40">
      <CardContent className="p-3">
        {/* ヘッダー（折りたたみトグル） */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-1.5 font-semibold text-sm text-info"
          >
            {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            <GraduationCap className="w-4 h-4" />
            講習モード: {period.label}
          </button>
          <span className="text-xs text-text-muted">
            {period.schedule_start_date} 〜 {period.schedule_end_date}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto text-xs text-text-muted hover:text-text-body"
          >
            講習モードを終了
          </button>
        </div>

        {open && (
          <div className="mt-3 space-y-3">
            {/* 個別マッチング */}
            <div className="rounded-lg border border-border-subtle p-2.5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-text-body">個別 自動マッチング</span>
                <button
                  type="button"
                  onClick={handleRunMatching}
                  disabled={running}
                  className="ml-auto inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-info text-white hover:bg-info/90 disabled:opacity-50"
                >
                  <Wand2 className="w-3.5 h-3.5" />
                  {running ? '実行中…' : 'マッチング実行'}
                </button>
                {drafts.length > 0 && (
                  <button
                    type="button"
                    onClick={handlePublishAll}
                    disabled={running}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md border border-success text-success hover:bg-success-subtle disabled:opacity-50"
                  >
                    <Check className="w-3.5 h-3.5" />
                    下書きを全公開（{drafts.length}）
                  </button>
                )}
              </div>

              {result && (
                <div className="mt-1.5 text-xs">
                  <p className="text-text-muted">提案 {result.proposalsCreated} 件を作成</p>
                  {result.unmatched.length > 0 && (
                    <div className="mt-1 rounded border border-warning/30 bg-warning-subtle/40 p-1.5">
                      <p className="text-warning font-semibold mb-0.5">
                        未マッチ {result.unmatched.reduce((s, u) => s + u.remaining, 0)} コマ（
                        {result.unmatched.length}名）— 出勤講師・空きコマが足りていません
                      </p>
                      <ul className="max-h-28 overflow-y-auto space-y-0.5">
                        {result.unmatched.map((u) => (
                          <li key={u.student_id} className="text-text-muted">
                            {u.student_name ?? u.student_id.slice(0, 8)}：残 {u.remaining} コマ（
                            {u.reason}）
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* 下書き一覧 */}
              {drafts.length > 0 && (
                <div className="mt-2 max-h-56 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="text-left text-text-muted">
                      <tr>
                        <th className="py-1 pr-2">日付</th>
                        <th className="py-1 pr-2">コマ</th>
                        <th className="py-1 pr-2">生徒</th>
                        <th className="py-1 pr-2">講師</th>
                        <th className="py-1 pr-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {drafts.map((p) => {
                        const conflicts = p.match_meta?.conflicts ?? [];
                        return (
                          <tr key={p.id} className="border-t border-border-subtle">
                            <td className="py-1 pr-2 tabular-nums">{p.proposal_date.slice(5)}</td>
                            <td className="py-1 pr-2">
                              {p.time_slot ? `${p.time_slot.slot_number}限` : '—'}
                            </td>
                            <td className="py-1 pr-2">
                              {p.student ? `${p.student.last_name}${p.student.first_name}` : '—'}
                            </td>
                            <td className="py-1 pr-2">
                              {p.teacher?.display_name || p.teacher?.email || '—'}
                              {conflicts.includes('教科外') && (
                                <span className="ml-1 px-1 py-0.5 rounded bg-warning-subtle text-warning text-[9px]">
                                  教科外
                                </span>
                              )}
                            </td>
                            <td className="py-1 pr-2">
                              <div className="flex items-center gap-1 justify-end">
                                <button
                                  type="button"
                                  onClick={() => handlePublishOne(p.id)}
                                  disabled={busyId === p.id}
                                  title="このコマを公開"
                                  className="w-5 h-5 flex items-center justify-center rounded text-success hover:bg-success-subtle disabled:opacity-50"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDismissOne(p.id)}
                                  disabled={busyId === p.id}
                                  title="この提案を却下"
                                  className="w-5 h-5 flex items-center justify-center rounded text-danger hover:bg-danger/10 disabled:opacity-50"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {error && (
                <p className="mt-1.5 text-xs text-danger bg-danger/5 rounded px-2 py-1">{error}</p>
              )}
            </div>

            {/* 配置進捗（手動配置）。個別の残コマを見ながら空きセルに配置する補助 */}
            <KoushuPlacementPanel
              period={period}
              formation="individual"
              onStartPlacement={onStartPlacement}
              placingStudentId={placingStudentId}
              placingSubjectId={placingSubjectId}
              subjectNameById={subjectNameById}
              refreshKey={refreshKey}
            />

            {/* 集団の配置進捗（進捗表示のみ。集団は集団レーンのモーダルで手動作成） */}
            {showGroupProgress && (
              <KoushuPlacementPanel period={period} formation="group" refreshKey={refreshKey} />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
