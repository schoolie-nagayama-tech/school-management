'use client';

/**
 * 面談ワークスペースの3パネル（成績・進行表・宿題/遅刻）を生徒ハブに置くための包み。
 *
 * ★パネルは src/app/interview/ の部品をそのまま使い、描き直さない。成績サマリは既に4か所で
 *   別実装になっていて、画面によって数字の見え方が違う事故の元になっている（docs/student-hub-plan.md §2）。
 * ★データは HubDataContext から読む（「今の状態」と同じ取得を共有し、2回取らない）。取り方は
 *   src/app/interview/InterviewWorkspace.tsx と同じ関数・同じ組み合わせにしてある（HubDataContext.tsx）。
 *   取り方が違うと、同じパネルなのに面談画面とハブで中身が食い違う。直すときは両方を見ること。
 *
 * パネルはそれぞれ自前のカード枠と小見出しを持つ。ハブのセクション（HubSection）の中に置くと
 * 枠が二重になるので、外側の div で内側カードの枠線・角丸・背景だけを消している（部品側は変えない）。
 */
import type { ReactNode } from 'react';
import { ScorePanel } from '@/app/interview/ScorePanel';
import { ProgressPanel } from '@/app/interview/ProgressPanel';
import { DisciplinePanel } from '@/app/interview/DisciplinePanel';
import { useHubAssessments, useHubDisciplineSessions, useHubProgress } from './HubDataContext';

/** 内側カードの枠を消す包み。パネルの CardContent の左右余白はそのまま生かす */
export function Unframed({ children }: { children: ReactNode }) {
  return (
    <div className="[&>div]:rounded-none [&>div]:border-0 [&>div]:bg-transparent">{children}</div>
  );
}

export function HubScorePanel() {
  // ★成績は志望校セクション（useTargetProposals）と今の状態も使うので、ハブ共通の取得係から読む。
  //   ここで listAssessments を直接呼ぶと、同じ成績を2回取りに行く（HubDataContext.tsx）
  const { assessments, loading } = useHubAssessments();

  return (
    <Unframed>
      <ScorePanel assessments={assessments} loading={loading} />
    </Unframed>
  );
}

export function HubProgressPanel() {
  // ★進行表は「今の状態」（停滞の数）も使うので、ハブ共通の取得係から読む。
  //   このセクションは見えてから読み込むので待たずに取り始める（今の状態が先に取っていればそれを使う）
  const { progress, loading } = useHubProgress();

  return (
    <Unframed>
      <ProgressPanel
        textbookData={progress.textbookData}
        goals={progress.goals}
        loading={loading}
      />
    </Unframed>
  );
}

export function HubDisciplinePanel() {
  // ★宿題・遅刻のセッションは「今の状態」（今月の回数）も使うので、ハブ共通の取得係から読む。
  //   期間（直近6ヶ月）は面談画面と同じ（HubDataContext.tsx の disciplineFromDate）
  const { sessions, loading } = useHubDisciplineSessions();

  return (
    <Unframed>
      <DisciplinePanel sessions={sessions} loading={loading} />
    </Unframed>
  );
}
