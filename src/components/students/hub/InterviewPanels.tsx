'use client';

/**
 * 面談ワークスペースの3パネル（成績・進行表・宿題/遅刻）を生徒ハブに置くための取得係。
 *
 * ★パネルは src/app/interview/ の部品をそのまま使い、描き直さない。成績サマリは既に4か所で
 *   別実装になっていて、画面によって数字の見え方が違う事故の元になっている（docs/student-hub-plan.md §2）。
 * ★データの取り方も src/app/interview/InterviewWorkspace.tsx と同じ関数を同じ組み合わせで呼ぶ。
 *   取り方が違うと、同じパネルなのに面談画面とハブで中身が食い違う。直すときは両方を見ること。
 *
 * パネルはそれぞれ自前のカード枠と小見出しを持つ。ハブのセクション（HubSection）の中に置くと
 * 枠が二重になるので、外側の div で内側カードの枠線・角丸・背景だけを消している（部品側は変えない）。
 */
import { useEffect, useState, type ReactNode } from 'react';
import { getStudentTextbooks, getStudentProgress } from '@/lib/api/progress';
import {
  getStudentDisciplineSessions,
  getFeedGoalsByTextbooks,
  type DisciplineSessionRow,
  type FeedGoalSummary,
} from '@/lib/api/progress-sessions';
import { ScorePanel } from '@/app/interview/ScorePanel';
import { ProgressPanel, type TextbookProgressData } from '@/app/interview/ProgressPanel';
import { DisciplinePanel } from '@/app/interview/DisciplinePanel';
import { useHubAssessments } from './HubDataContext';

/** 内側カードの枠を消す包み。パネルの CardContent の左右余白はそのまま生かす */
export function Unframed({ children }: { children: ReactNode }) {
  return (
    <div className="[&>div]:rounded-none [&>div]:border-0 [&>div]:bg-transparent">{children}</div>
  );
}

export function HubScorePanel() {
  // ★成績は志望校セクション（useTargetProposals）も使うので、ハブ共通の取得係から読む。
  //   ここで listAssessments を直接呼ぶと、同じ成績を2回取りに行く（HubDataContext.tsx）
  const { assessments, loading } = useHubAssessments();

  return (
    <Unframed>
      <ScorePanel assessments={assessments} loading={loading} />
    </Unframed>
  );
}

export function HubProgressPanel({ studentId }: { studentId: string }) {
  const [textbookData, setTextbookData] = useState<TextbookProgressData[]>([]);
  const [goals, setGoals] = useState<Record<string, FeedGoalSummary>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const raw = await getStudentTextbooks(studentId);
        // 進行表パネルに出すのは「進行表で管理中」のテキストのみ（/progress ページ・面談画面と同じ絞り込み）
        const tracked = raw.filter((t) => t.track_progress);
        // 進行記録はテキストごとに取るが、目標・行動目標は全テキストまとめて1回で取れる
        const [data, g] = await Promise.all([
          Promise.all(
            tracked.map(async (textbook) => ({
              textbook,
              rows: await getStudentProgress(textbook.id).catch(() => []),
            }))
          ),
          getFeedGoalsByTextbooks(tracked.map((t) => t.id)).catch(() => ({})),
        ]);
        if (cancelled) return;
        setTextbookData(data);
        setGoals(g);
      } catch (e) {
        console.error('Error fetching progress:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  return (
    <Unframed>
      <ProgressPanel textbookData={textbookData} goals={goals} loading={loading} />
    </Unframed>
  );
}

export function HubDisciplinePanel({ studentId }: { studentId: string }) {
  const [sessions, setSessions] = useState<DisciplineSessionRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // 集計対象期間（直近6ヶ月）の開始日 = 今日から遡って6ヶ月前の月の1日（面談画面と同じ）
    const from = new Date();
    from.setDate(1);
    from.setMonth(from.getMonth() - 5);
    const fromStr = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-01`;
    setLoading(true);
    getStudentDisciplineSessions(studentId, fromStr)
      .catch(() => [] as DisciplineSessionRow[])
      .then((rows) => {
        if (cancelled) return;
        setSessions(rows);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  return (
    <Unframed>
      <DisciplinePanel sessions={sessions} loading={loading} />
    </Unframed>
  );
}
