'use client';

/**
 * 面談ワークスペース左カラム: 志望校（第1〜3志望）の入力パネル
 * ------------------------------------------------------------------
 * 面談の②（ヒアリング）でその場で聞いて入れる想定。「報告事項」カード（InterviewBriefCard）の
 * 近くに置く。正典: docs/interview-script-ai-plan.md §4
 *
 * ★候補を選ばず自由記述のままでも保存できる。私立・国立・他県はマスタ（都立のみ205件）に
 *   無いので、ここを塞ぐと入力そのものができなくなる。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, Button } from '@/components/ui';
import {
  getStudentTargetSchools,
  saveStudentTargetSchools,
  searchHighSchools,
  type TargetSchoolRow,
  type HighSchoolSearchResult,
} from '@/lib/api/targetSchools';

const SEARCH_DEBOUNCE_MS = 300;
const RANKS = [1, 2, 3] as const;
const RANK_LABEL: Record<(typeof RANKS)[number], string> = {
  1: '第1志望',
  2: '第2志望',
  3: '第3志望',
};

/** 画面編集用のフォーム状態（rank 1〜3を必ず持つ。DBに無いrankは空欄で持つ） */
interface FormRow {
  rank: number;
  schoolName: string;
  highSchoolId: string | null;
  reason: string;
  master: TargetSchoolRow['master'];
}

function emptyRow(rank: number): FormRow {
  return { rank, schoolName: '', highSchoolId: null, reason: '', master: null };
}

/**
 * 必要内申の表示。
 * ★満点が65以外のとき（3教科校は75、産業技術高専は独自換算で52）は分母を添える。
 *   分母が無いと、面談で言う「必要内申55」が65点満点の55として伝わってしまう。
 */
function formatNaishin(
  naishin: number | null,
  naishinMax: number | null,
  label = '必要内申'
): string {
  if (naishin == null) return `${label}は未設定`;
  if (naishinMax != null && naishinMax !== 65) return `${label}${naishin}/${naishinMax}`;
  return `${label}${naishin}`;
}

function toFormRows(rows: TargetSchoolRow[]): FormRow[] {
  const byRank = new Map(rows.map((r) => [r.rank, r]));
  return RANKS.map((rank) => {
    const found = byRank.get(rank);
    if (!found) return emptyRow(rank);
    return {
      rank,
      schoolName: found.schoolName,
      highSchoolId: found.highSchoolId,
      reason: found.reason ?? '',
      master: found.master,
    };
  });
}

interface Props {
  studentId: string;
  schoolId: string;
}

export function TargetSchoolsPanel({ studentId, schoolId }: Props) {
  const [rows, setRows] = useState<FormRow[]>(RANKS.map(emptyRow));
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  // 候補検索の状態（rank ごと）
  const [candidates, setCandidates] = useState<Record<number, HighSchoolSearchResult[]>>({});
  const [searchingRank, setSearchingRank] = useState<number | null>(null);
  const [openRank, setOpenRank] = useState<number | null>(null);
  const debounceTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    if (!studentId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await getStudentTargetSchools(studentId);
        if (cancelled) return;
        setRows(toFormRows(data));
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : '志望校の取得に失敗しました');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  // アンマウント時に残っているデバウンスタイマーを掃除する
  useEffect(() => {
    const timers = debounceTimers.current;
    return () => {
      Object.values(timers).forEach((t) => clearTimeout(t));
    };
  }, []);

  const runSearch = useCallback(async (rank: number, q: string) => {
    setSearchingRank(rank);
    try {
      const results = await searchHighSchools(q);
      setCandidates((prev) => ({ ...prev, [rank]: results }));
    } catch {
      setCandidates((prev) => ({ ...prev, [rank]: [] }));
    } finally {
      setSearchingRank((cur) => (cur === rank ? null : cur));
    }
  }, []);

  const handleNameChange = (rank: number, value: string) => {
    setSavedMessage(null);
    setRows((prev) =>
      prev.map((r) =>
        // 入力し直したら以前選んだマスタ一致は解除する（自由記述扱いに戻す）。
        // 選び直す前に古い「マスタに一致」表示が残ると誤解を招くため。
        r.rank === rank ? { ...r, schoolName: value, highSchoolId: null, master: null } : r
      )
    );

    const timers = debounceTimers.current;
    if (timers[rank]) clearTimeout(timers[rank]);
    const q = value.trim();
    if (!q) {
      setCandidates((prev) => ({ ...prev, [rank]: [] }));
      setOpenRank((cur) => (cur === rank ? null : cur));
      return;
    }
    timers[rank] = setTimeout(() => {
      runSearch(rank, q);
      setOpenRank(rank);
    }, SEARCH_DEBOUNCE_MS);
  };

  const handleReasonChange = (rank: number, value: string) => {
    setSavedMessage(null);
    setRows((prev) => prev.map((r) => (r.rank === rank ? { ...r, reason: value } : r)));
  };

  const handleSelectCandidate = (rank: number, candidate: HighSchoolSearchResult) => {
    setSavedMessage(null);
    setRows((prev) =>
      prev.map((r) =>
        r.rank === rank
          ? {
              ...r,
              schoolName: candidate.schoolName,
              highSchoolId: candidate.id,
              master: {
                prefecture: candidate.prefecture,
                schoolName: candidate.schoolName,
                course: candidate.course,
                category: candidate.category,
                naishin: candidate.naishin,
                naishinMax: candidate.naishinMax,
                hensachi: candidate.hensachi,
                sourceLabel: candidate.sourceLabel,
                verifiedAt: candidate.verifiedAt,
              },
            }
          : r
      )
    );
    setOpenRank(null);
    setCandidates((prev) => ({ ...prev, [rank]: [] }));
  };

  const handleSave = async () => {
    if (saving) return; // 二重送信防止
    setSaving(true);
    setError(null);
    setSavedMessage(null);
    try {
      await saveStudentTargetSchools(
        studentId,
        schoolId,
        rows.map((r) => ({
          rank: r.rank,
          schoolName: r.schoolName,
          highSchoolId: r.highSchoolId,
          reason: r.reason,
        }))
      );
      const data = await getStudentTargetSchools(studentId);
      setRows(toFormRows(data));
      setSavedMessage('保存しました');
    } catch (e) {
      setError(e instanceof Error ? e.message : '志望校の保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-baseline gap-2">
          <CardTitle>志望校</CardTitle>
          <span className="text-xs text-text-faint">面談の②で聞いて、その場で入れる</span>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            読み込み中...
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {rows.map((row) => (
              <div key={row.rank} className="flex flex-col gap-1.5">
                <label
                  htmlFor={`target-school-${row.rank}`}
                  className="text-xs font-medium text-text-muted"
                >
                  {RANK_LABEL[row.rank as (typeof RANKS)[number]]}
                </label>
                <div className="relative">
                  <input
                    id={`target-school-${row.rank}`}
                    type="text"
                    value={row.schoolName}
                    onChange={(e) => handleNameChange(row.rank, e.target.value)}
                    onFocus={() => row.schoolName.trim() && setOpenRank(row.rank)}
                    placeholder="学校名を入力"
                    className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-text-body placeholder-text-faint transition-colors duration-150 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  {openRank === row.rank && (
                    <>
                      <div
                        className="fixed inset-0 z-10"
                        aria-hidden
                        onClick={() => setOpenRank(null)}
                      />
                      <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-52 overflow-y-auto rounded-lg border border-border bg-surface-raised shadow-lg">
                        {searchingRank === row.rank ? (
                          <div className="py-3 text-center text-xs text-text-muted">検索中...</div>
                        ) : (candidates[row.rank] || []).length === 0 ? (
                          <div className="py-3 text-center text-xs text-text-muted">
                            該当する高校がありません（マスタは都立のみ）
                          </div>
                        ) : (
                          <ul className="py-1">
                            {(candidates[row.rank] || []).map((c) => (
                              <li key={c.id}>
                                <button
                                  type="button"
                                  onClick={() => handleSelectCandidate(row.rank, c)}
                                  className="block w-full px-3 py-2 text-left text-sm hover:bg-surface"
                                >
                                  {c.schoolName}
                                  {c.course && (
                                    <span className="text-text-muted">（{c.course}）</span>
                                  )}
                                  <span className="ml-1 text-xs text-text-faint">
                                    {[
                                      c.municipality,
                                      c.naishin != null
                                        ? formatNaishin(c.naishin, c.naishinMax, '内申')
                                        : null,
                                      c.hensachi != null ? `偏差値${c.hensachi}` : null,
                                    ]
                                      .filter(Boolean)
                                      .join(' ・ ')}
                                  </span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </>
                  )}
                </div>

                {row.highSchoolId && row.master ? (
                  <div className="flex items-start gap-1.5 text-xs text-success">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      マスタに一致 ―― {formatNaishin(row.master.naishin, row.master.naishinMax)}・
                      {row.master.hensachi != null
                        ? `偏差値${row.master.hensachi}`
                        : '偏差値は未設定'}
                      が④に出る
                      {row.master.verifiedAt == null && '（紙との突き合わせ未確認）'}
                    </span>
                  </div>
                ) : row.schoolName.trim() ? (
                  <div className="flex items-start gap-1.5 text-xs text-warning">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>マスタに無い（私立など）。名前だけ残る</span>
                  </div>
                ) : null}

                <input
                  type="text"
                  value={row.reason}
                  onChange={(e) => handleReasonChange(row.rank, e.target.value)}
                  placeholder="志望の理由（面談で聞いた言葉のまま・任意）"
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text-body placeholder-text-faint transition-colors duration-150 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            ))}

            {error && <p className="text-sm text-danger">{error}</p>}
            {savedMessage && <p className="text-sm text-success">{savedMessage}</p>}

            <div className="flex items-center gap-2">
              <Button type="button" size="sm" onClick={handleSave} disabled={saving}>
                {saving ? '保存中...' : '保存する'}
              </Button>
            </div>

            <p className="text-xs leading-relaxed text-text-faint">
              マスタは都立のみ（205件）。私立・国立・他県は名前だけ残る。
              緑園都市校のように通塾圏が神奈川県立中心の教室では、都立マスタだけでは届かない。
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
