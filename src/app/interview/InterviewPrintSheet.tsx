/**
 * 面談ワークスペース 印刷シート（A4縦1枚）
 * ------------------------------------------------------------------
 * courses/progress の CourseProgressReport と同じ流儀: 画面には `hidden print:block` で隠しておき、
 * 印刷時だけ表示される専用ブロック。名前付きページ（globals.css の `interviewreport`）で
 * 用紙サイズ・向きを固定する。
 */

import type { AssessmentWithScores, Student } from '@/types/database';
import { computeScoreSummary, fmtDateJa, type TextbookProgressSummary } from './interview.shared';
import type { HandoverInfo } from './InterviewTimeline';
import type { MemoSnapshot } from './InterviewMemoPanel';
import { formatGradeLabel } from '@/lib/utils/gradeLabel';
import { INTERVIEW_TYPE_LABELS, type StudentInterview } from '@/types/database';

interface InterviewPrintSheetProps {
  student: Student;
  today: string;
  handover: HandoverInfo | null;
  /** 面談タイムラインの直近3件（新しい順） */
  recentInterviews: StudentInterview[];
  assessments: AssessmentWithScores[];
  textbookSummaries: TextbookProgressSummary[];
  memo: MemoSnapshot;
}

export function InterviewPrintSheet({
  student,
  today,
  handover,
  recentInterviews,
  assessments,
  textbookSummaries,
  memo,
}: InterviewPrintSheetProps) {
  const scoreSummary = computeScoreSummary(assessments);
  const hasMemoContent = memo.memo.trim().length > 0;

  return (
    <div className="interview-report-print-page hidden bg-white text-black print:block">
      {/* ヘッダー */}
      <div className="mb-3 flex items-end justify-between border-b-2 border-black pb-1.5">
        <div>
          <div className="text-base font-bold leading-tight">
            {student.last_name} {student.first_name} さん 面談シート
          </div>
          <div className="mt-0.5 text-xs">
            {formatGradeLabel(student.grade)}
            {student.school_name ? ` ／ ${student.school_name}` : ''}
          </div>
        </div>
        <div className="text-right text-[10px] leading-tight">
          <div>面談日：{memo.interviewDate}</div>
          <div>出力日：{today}</div>
        </div>
      </div>

      {/* 前回の申し送り */}
      <div className="mb-3">
        <div className="mb-1 border-b border-black pb-0.5 text-xs font-bold">前回の申し送り</div>
        {handover ? (
          <div className="text-[10px] leading-snug">
            <span className="text-gray-500">（{fmtDateJa(handover.date)}）</span>{' '}
            <span className="whitespace-pre-wrap">{handover.text}</span>
          </div>
        ) : (
          <p className="text-[10px] text-gray-500">面談記録はまだありません</p>
        )}
      </div>

      {/* 直近3件の面談 */}
      <div className="mb-3">
        <div className="mb-1 border-b border-black pb-0.5 text-xs font-bold">直近の面談記録</div>
        {recentInterviews.length === 0 ? (
          <p className="text-[10px] text-gray-500">面談記録はまだありません</p>
        ) : (
          <div className="flex flex-col gap-1">
            {recentInterviews.slice(0, 3).map((iv) => (
              <div key={iv.id} className="break-inside-avoid text-[10px] leading-snug">
                <span className="font-medium">
                  {fmtDateJa(iv.interview_date)}・{INTERVIEW_TYPE_LABELS[iv.interview_type]}
                  {iv.title ? `「${iv.title}」` : ''}
                </span>
                <span className="whitespace-pre-wrap text-gray-700"> {iv.content}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 成績表 */}
      <div className="mb-3">
        <div className="mb-1 border-b border-black pb-0.5 text-xs font-bold">
          成績（定期テスト直近3件）
        </div>
        {scoreSummary.testLabels.length === 0 ? (
          <p className="text-[10px] text-gray-500">成績の登録がありません</p>
        ) : (
          <table className="w-full border-collapse text-[10px]">
            <thead>
              <tr className="border-b border-gray-400 text-gray-600">
                <th className="py-1 pl-1 text-left font-medium">教科</th>
                {scoreSummary.testLabels.map((name, i) => (
                  <th key={`${name}-${i}`} className="py-1 text-right font-medium">
                    {name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {scoreSummary.rows.map((row) => (
                <tr key={row.subject} className="border-b border-gray-200">
                  <td className="py-0.5 pl-1">{row.label}</td>
                  {row.values.map((v, i) => (
                    <td key={i} className="py-0.5 text-right tabular-nums">
                      {v ?? '—'}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="border-t-2 border-black font-bold">
                <td className="py-0.5 pl-1">合計</td>
                {scoreSummary.totals.map((t, i) => (
                  <td key={i} className="py-0.5 text-right tabular-nums">
                    {t}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        )}
      </div>

      {/* 進行表サマリ */}
      <div className="mb-3">
        <div className="mb-1 border-b border-black pb-0.5 text-xs font-bold">進行表サマリ</div>
        {textbookSummaries.length === 0 ? (
          <p className="text-[10px] text-gray-500">進行表で管理中のテキストはありません</p>
        ) : (
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10px]">
            {textbookSummaries.map((tb) => (
              <div
                key={tb.id}
                className="flex items-center justify-between gap-2 break-inside-avoid"
              >
                <span className="truncate">
                  {tb.name}
                  {tb.subject ? `（${tb.subject}）` : ''}
                  {tb.stalled ? ' ※停滞' : ''}
                </span>
                <span className="shrink-0 tabular-nums">{tb.progressPct}%</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 今回のメモ */}
      <div>
        <div className="mb-1 border-b border-black pb-0.5 text-xs font-bold">
          今回の面談メモ（{memo.interviewTypeLabel}
          {memo.title ? `：${memo.title}` : ''}）
        </div>
        {hasMemoContent ? (
          <p className="whitespace-pre-wrap text-[10px] leading-relaxed">{memo.memo}</p>
        ) : (
          // 未入力なら手書き用の罫線を敷く
          <div>
            {Array.from({ length: 14 }).map((_, i) => (
              <div key={i} className="h-[18px] border-b border-gray-300" />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
