'use client';

/**
 * 通塾日程パターン × 講師マッチング画面
 *
 * URL: /schedule/regular-patterns/match
 *
 * 用途：teacher_id NULL の通塾日程パターンに講師を割り当てる作業を支援。
 *      415件 / 266 生徒（実データ時点）の運用作業を効率化する。
 *
 * 表示：
 *  - 未割当パターン一覧（曜日 → コマ順）
 *  - 各行に「候補講師」をスコア順で表示（◎担当固定 / ○過去担当 / 教科対応 / 性別一致）
 *  - ワンクリック割当：pattern.teacher_id 更新 + 未来の schedule_entries も同時更新
 *
 * フィルタ：
 *  - 曜日（月〜土）
 *  - 「候補1人だけ→即決可能なパターン」だけ表示
 *  - 未割当残数の表示
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { AdminLayout } from '@/components/layouts';
import { Card, CardContent } from '@/components/ui';
import { Button } from '@/components/ui';
import { ToastContainer, Loading } from '@/components/ui';
import { useToast } from '@/hooks/useToast';
import { useAuth } from '@/contexts/AuthContext';
import { useMasterData } from '@/contexts/MasterDataContext';
import {
  getUnassignedPatterns,
  getPatternMatchCandidates,
  assignTeacherToPattern,
  type UnassignedPatternRow,
  type PatternMatchCandidate,
} from '@/lib/api/pattern-matching';
import { logScheduleChange } from '@/lib/api/schedule-change-logs';
import { CheckCircle2, Filter, RefreshCw, Sparkles, Info, X } from 'lucide-react';
import AccessDenied from '@/components/AccessDenied';
import { formatGradeLabel } from '@/lib/utils/gradeLabel';

const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

export default function PatternMatchPage() {
  const { profile, selectedSchoolId, getSelectedSchoolIds } = useAuth();
  const { subjects: masterSubjects } = useMasterData();
  const { toasts, removeToast, success, error: toastError } = useToast();

  const [patterns, setPatterns] = useState<UnassignedPatternRow[]>([]);
  const [candidatesByPattern, setCandidatesByPattern] = useState<
    Map<string, PatternMatchCandidate[]>
  >(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [actingPatternId, setActingPatternId] = useState<string | null>(null);
  const [filterDay, setFilterDay] = useState<number | 'all'>('all');
  const [filterSingleCandidate, setFilterSingleCandidate] = useState(false);
  const [showLegend, setShowLegend] = useState(false);
  // 「全候補を見る」モーダルで開いているパターン
  const [allCandidatesPattern, setAllCandidatesPattern] = useState<UnassignedPatternRow | null>(
    null
  );

  // 科目ID → 名前への解決マップ
  const subjectNameById = useMemo(
    () => new Map(masterSubjects.map((s) => [s.id, s.name])),
    [masterSubjects]
  );

  const isManager =
    profile?.role === 'admin' || profile?.role === 'manager' || profile?.role === 'owner';

  // 単一の school 選択を前提 (複数校選択時は最初の1校)
  const schoolId =
    selectedSchoolId && selectedSchoolId !== 'all'
      ? selectedSchoolId
      : (getSelectedSchoolIds()[0] ?? null);

  const load = useCallback(async () => {
    if (!schoolId) return;
    setIsLoading(true);
    try {
      const rows = await getUnassignedPatterns(schoolId);
      setPatterns(rows);

      // 候補を並列に取得（1パターンずつ getPatternMatchCandidates）
      // 数百件あると遅くなるので、まず最大30件だけ並列展開し、残りは遅延
      const initial = rows.slice(0, 30);
      const candMap = new Map<string, PatternMatchCandidate[]>();
      await Promise.all(
        initial.map(async (p) => {
          try {
            const c = await getPatternMatchCandidates(schoolId, p);
            candMap.set(p.id, c);
          } catch {
            candMap.set(p.id, []);
          }
        })
      );
      setCandidatesByPattern(candMap);

      // 残りはバックグラウンドで順次取得
      const rest = rows.slice(30);
      void (async () => {
        for (const p of rest) {
          try {
            const c = await getPatternMatchCandidates(schoolId, p);
            setCandidatesByPattern((prev) => {
              const next = new Map(prev);
              next.set(p.id, c);
              return next;
            });
          } catch {
            /* noop */
          }
        }
      })();
    } catch (e) {
      toastError(e instanceof Error ? e.message : '取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [schoolId, toastError]);

  useEffect(() => {
    if (isManager) load();
  }, [isManager, load]);

  const handleAssign = async (patternId: string, teacherId: string) => {
    setActingPatternId(patternId);
    try {
      const pattern = patterns.find((p) => p.id === patternId);
      const result = await assignTeacherToPattern(patternId, teacherId);
      // 履歴ログ：マッチング画面からの恒久割当
      if (schoolId && pattern) {
        await logScheduleChange({
          school_id: schoolId,
          actor_user_id: profile?.id ?? null,
          action_type: 'pattern_assign',
          pattern_id: patternId,
          student_id: pattern.student_id,
          before_teacher_id: null,
          after_teacher_id: teacherId,
          description: `一括マッチング画面から割当 (${result.entriesUpdated} 件の未来エントリも更新)`,
        });
      }
      success(`割当完了（${result.entriesUpdated} 件のエントリも更新）`);
      // パターンをローカルから削除（同じ画面に出続けないように）
      setPatterns((prev) => prev.filter((p) => p.id !== patternId));
      setCandidatesByPattern((prev) => {
        const next = new Map(prev);
        next.delete(patternId);
        return next;
      });
    } catch (e) {
      toastError(e instanceof Error ? e.message : '割当に失敗しました');
    } finally {
      setActingPatternId(null);
    }
  };

  if (!isManager) return <AccessDenied />;

  // フィルタ適用後の表示対象
  const visible = patterns.filter((p) => {
    if (filterDay !== 'all' && p.day_of_week !== filterDay) return false;
    if (filterSingleCandidate) {
      const c = candidatesByPattern.get(p.id);
      if (!c || c.length !== 1) return false;
    }
    return true;
  });

  // 曜日×コマでグルーピング
  const grouped = new Map<string, UnassignedPatternRow[]>();
  for (const p of visible) {
    const key = `${p.day_of_week}|${p.time_slot?.slot_number ?? 0}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(p);
  }

  return (
    <AdminLayout headerTitle="通塾日程 講師マッチング">
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">通塾日程 講師マッチング</h1>
            <p className="text-sm text-text-muted mt-1">
              担当未決定の通塾日程に講師を割り当てます。シフト・教科対応・希望ルールを考慮した候補を表示。
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowLegend((v) => !v)}
              title="スコアの意味と色分けを表示"
            >
              <Info className="w-3.5 h-3.5 mr-1" />
              凡例
            </Button>
            <Button variant="outline" size="sm" onClick={load} disabled={isLoading}>
              <RefreshCw className={`w-3.5 h-3.5 mr-1 ${isLoading ? 'animate-spin' : ''}`} />
              再取得
            </Button>
          </div>
        </div>

        {/* スコア凡例：講師バッジ横の数字や色の意味を1パネルで説明 */}
        {showLegend && (
          <Card>
            <CardContent className="p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5 text-info" />
                  講師バッジの読み方
                </span>
                <button
                  type="button"
                  onClick={() => setShowLegend(false)}
                  className="text-xs text-text-muted hover:text-text-body"
                  aria-label="凡例を閉じる"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="text-xs text-text-muted leading-relaxed">
                バッジ右の数字は <strong>マッチングスコア</strong>。高いほど推薦度が高い。
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                <ScorePill score="50+" color="success" label="◎ 担当固定" />
                <ScorePill score="30+" color="info" label="○ 過去6か月担当" />
                <ScorePill score="20+" color="muted" label="教科対応" />
                <ScorePill score="10+" color="muted" label="希望性別一致" />
                <ScorePill score="5" color="muted" label="ベース: 出勤可能" />
                <ScorePill score="+5" color="muted" label="当該コマも出勤可" />
              </div>
              <div className="text-[11px] text-text-faint pt-1 border-t border-border-subtle">
                色: <span className="text-success font-semibold">緑=即決推奨 (50+)</span> ／
                <span className="text-info font-semibold ml-1">青=有力 (30+)</span> ／ 白=候補
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="p-3 flex flex-wrap items-center gap-3">
            <Filter className="w-4 h-4 text-text-muted" />
            <span className="text-sm font-semibold">フィルタ:</span>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setFilterDay('all')}
                className={`px-2 py-1 text-xs rounded border ${
                  filterDay === 'all'
                    ? 'bg-info text-white border-info'
                    : 'bg-white text-text-muted border-border-default'
                }`}
              >
                全曜日
              </button>
              {[1, 2, 3, 4, 5, 6].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setFilterDay(d)}
                  className={`px-2 py-1 text-xs rounded border ${
                    filterDay === d
                      ? 'bg-info text-white border-info'
                      : 'bg-white text-text-muted border-border-default'
                  }`}
                >
                  {DAY_LABELS[d]}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-1.5 text-xs cursor-pointer ml-3">
              <input
                type="checkbox"
                checked={filterSingleCandidate}
                onChange={(e) => setFilterSingleCandidate(e.target.checked)}
                className="accent-info"
              />
              候補1人のみ（即決可）
            </label>
            <div className="ml-auto text-xs text-text-muted">
              残: <strong className="text-text-body">{patterns.length}</strong> 件
              {visible.length !== patterns.length && (
                <>
                  {' '}
                  / 表示: <strong className="text-text-body">{visible.length}</strong> 件
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          <Loading />
        ) : visible.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-text-muted">
              <Sparkles className="w-8 h-8 mx-auto mb-2 text-success" />
              {patterns.length === 0
                ? '担当未決定パターンはありません。マッチング完了！'
                : '現在のフィルタに該当する候補はありません'}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {Array.from(grouped.entries())
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([groupKey, groupPatterns]) => {
                const [dowStr, slotNum] = groupKey.split('|');
                const dow = parseInt(dowStr, 10);
                const slotLabel = groupPatterns[0]?.time_slot;
                return (
                  <Card key={groupKey}>
                    <CardContent className="p-0">
                      <div className="px-4 py-2 bg-surface border-b text-sm font-semibold flex items-center gap-2">
                        <span className="text-info">{DAY_LABELS[dow]}曜</span>
                        <span>{slotNum}限</span>
                        {slotLabel && (
                          <span className="text-xs text-text-muted">
                            ({slotLabel.start_time?.slice(0, 5)}〜{slotLabel.end_time?.slice(0, 5)})
                          </span>
                        )}
                        <span className="ml-auto text-xs text-text-muted">
                          {groupPatterns.length} 件
                        </span>
                      </div>
                      <ul className="divide-y divide-border-subtle">
                        {groupPatterns.map((p) => {
                          const studentName = p.student
                            ? `${p.student.last_name} ${p.student.first_name}`
                            : p.student_id;
                          const grade = p.student ? formatGradeLabel(p.student.grade) : '';
                          const candidates = candidatesByPattern.get(p.id);
                          return (
                            <li key={p.id} className="px-4 py-3">
                              <div className="flex items-start gap-3 flex-wrap">
                                <div className="min-w-[180px]">
                                  <div className="font-semibold text-sm">{studentName}</div>
                                  <div className="text-xs text-text-muted">{grade}</div>
                                  {/* 科目チップ：何の授業をする予定の枠か一目で分かるように */}
                                  {p.subject_ids && p.subject_ids.length > 0 && (
                                    <div className="flex flex-wrap gap-1 mt-1">
                                      {p.subject_ids.map((sid) => (
                                        <span
                                          key={sid}
                                          className="inline-block px-1.5 py-0.5 text-[10px] rounded bg-sky-50 text-sky-800 border border-sky-200"
                                        >
                                          {subjectNameById.get(sid) ?? sid.slice(0, 6)}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                                <div className="flex-1 min-w-0">
                                  {candidates === undefined ? (
                                    <span className="text-xs text-text-faint">候補を読込中...</span>
                                  ) : candidates.length === 0 ? (
                                    <span className="text-xs text-danger">
                                      候補なし（出勤可能講師なし or 全員除外）
                                    </span>
                                  ) : (
                                    <div className="flex flex-wrap gap-1.5">
                                      {candidates.slice(0, 6).map((c) => (
                                        <button
                                          key={c.user_id}
                                          type="button"
                                          onClick={() => handleAssign(p.id, c.user_id)}
                                          disabled={actingPatternId === p.id}
                                          className={`group inline-flex items-center gap-1 px-2 py-1 rounded border text-xs transition-[background-color,border-color,transform] duration-150 ease-[var(--ease-out)] active:scale-[0.97] disabled:opacity-50 ${
                                            c.score >= 50
                                              ? 'bg-success-subtle border-success text-success font-semibold hover:bg-success/15'
                                              : c.score >= 30
                                                ? 'bg-info-subtle border-info text-info hover:bg-info/15'
                                                : 'bg-white border-border-default text-text-body hover:bg-surface'
                                          }`}
                                          title={`スコア: ${c.score} / ${c.reasons.join('・')}${c.warnings.length ? ' / ⚠ ' + c.warnings.join('・') : ''}`}
                                        >
                                          {c.score >= 50 && <CheckCircle2 className="w-3 h-3" />}
                                          <span>{c.display_name || c.email || '名無し'}</span>
                                          <span className="text-[10px] opacity-70 tabular-nums">
                                            {c.score}
                                          </span>
                                        </button>
                                      ))}
                                      {candidates.length > 6 && (
                                        <button
                                          type="button"
                                          onClick={() => setAllCandidatesPattern(p)}
                                          className="text-xs text-info hover:underline self-center px-1.5 py-1 rounded hover:bg-info-subtle/50 transition-colors"
                                        >
                                          全候補 {candidates.length} 名を見る →
                                        </button>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </CardContent>
                  </Card>
                );
              })}
          </div>
        )}
      </div>

      {/* 全候補モーダル：6人で打ち切らず、除外された候補も含めて全部見せる */}
      {allCandidatesPattern && (
        <AllCandidatesModal
          pattern={allCandidatesPattern}
          candidates={candidatesByPattern.get(allCandidatesPattern.id) ?? []}
          subjectNameById={subjectNameById}
          isActing={actingPatternId === allCandidatesPattern.id}
          onAssign={(teacherId) => {
            handleAssign(allCandidatesPattern.id, teacherId);
            setAllCandidatesPattern(null);
          }}
          onClose={() => setAllCandidatesPattern(null)}
        />
      )}
    </AdminLayout>
  );
}

// =========================================================
// 凡例用の小さなチップ
// =========================================================
function ScorePill({
  score,
  color,
  label,
}: {
  score: string;
  color: 'success' | 'info' | 'muted';
  label: string;
}) {
  const cls =
    color === 'success'
      ? 'bg-success-subtle border-success text-success'
      : color === 'info'
        ? 'bg-info-subtle border-info text-info'
        : 'bg-white border-border-default text-text-body';
  return (
    <div className="flex items-center gap-1.5">
      <span
        className={`inline-flex items-center justify-center min-w-[36px] px-1.5 py-0.5 rounded border text-[10px] font-semibold tabular-nums ${cls}`}
      >
        {score}
      </span>
      <span className="text-text-muted">{label}</span>
    </div>
  );
}

// =========================================================
// 全候補モーダル
// =========================================================
function AllCandidatesModal({
  pattern,
  candidates,
  subjectNameById,
  isActing,
  onAssign,
  onClose,
}: {
  pattern: UnassignedPatternRow;
  candidates: PatternMatchCandidate[];
  subjectNameById: Map<string, string>;
  isActing: boolean;
  onAssign: (teacherId: string) => void;
  onClose: () => void;
}) {
  const studentName = pattern.student
    ? `${pattern.student.last_name} ${pattern.student.first_name}`
    : pattern.student_id;
  const grade = pattern.student ? formatGradeLabel(pattern.student.grade) : '';
  const dowLabel = DAY_LABELS[pattern.day_of_week];
  const slot = pattern.time_slot;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="px-5 py-3 border-b border-border-subtle sticky top-0 bg-white flex items-center justify-between">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-text-heading truncate">
              {studentName}{' '}
              <span className="text-xs font-normal text-text-muted ml-1">{grade}</span>
            </h3>
            <p className="text-xs text-text-muted">
              {dowLabel}曜 {slot?.slot_number}限
              {slot && ` (${slot.start_time?.slice(0, 5)}〜${slot.end_time?.slice(0, 5)})`}
              {pattern.subject_ids && pattern.subject_ids.length > 0 && (
                <span className="ml-2">
                  {pattern.subject_ids.map((sid) => subjectNameById.get(sid) ?? sid).join('・')}
                </span>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-text-muted hover:text-text-body p-1"
            aria-label="閉じる"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4">
          {candidates.length === 0 ? (
            <p className="text-sm text-text-muted text-center py-8">候補講師が見つかりません</p>
          ) : (
            <ul className="space-y-1.5">
              {candidates.map((c) => (
                <li key={c.user_id}>
                  <button
                    type="button"
                    onClick={() => onAssign(c.user_id)}
                    disabled={isActing}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg border text-left transition-colors duration-150 disabled:opacity-50 ${
                      c.score >= 50
                        ? 'bg-success-subtle border-success hover:bg-success/15'
                        : c.score >= 30
                          ? 'bg-info-subtle border-info hover:bg-info/15'
                          : 'bg-white border-border-default hover:bg-surface'
                    }`}
                  >
                    <span
                      className={`flex-shrink-0 inline-flex items-center justify-center w-10 h-7 rounded border text-xs font-bold tabular-nums ${
                        c.score >= 50
                          ? 'bg-white border-success text-success'
                          : c.score >= 30
                            ? 'bg-white border-info text-info'
                            : 'bg-surface border-border-default text-text-body'
                      }`}
                    >
                      {c.score}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-text-body truncate">
                        {c.score >= 50 && (
                          <CheckCircle2 className="inline w-3.5 h-3.5 mr-1 text-success" />
                        )}
                        {c.display_name || c.email || '名無し'}
                      </div>
                      {(c.reasons.length > 0 || c.warnings.length > 0) && (
                        <div className="text-[11px] text-text-muted mt-0.5 flex flex-wrap gap-x-1.5 gap-y-0.5">
                          {c.reasons.map((r, i) => (
                            <span key={`r-${i}`}>・{r}</span>
                          ))}
                          {c.warnings.map((w, i) => (
                            <span key={`w-${i}`} className="text-warning">
                              ⚠ {w}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
