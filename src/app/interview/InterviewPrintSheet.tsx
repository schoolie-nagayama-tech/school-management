/**
 * 面談ワークスペース 印刷シート（A4縦1枚）
 * ------------------------------------------------------------------
 * courses/progress の CourseProgressReport と同じ流儀: 画面には `hidden print:block` で隠しておき、
 * 印刷時だけ表示される専用ブロック。名前付きページ（globals.css の `interviewreport`）で
 * 用紙サイズ・向きを固定する。
 *
 * 「今回の面談メモ」欄（手書き罫線含む）は廃止した。面談記録がNotta取込に一本化され、
 * このシートを見ながらメモを手書きする運用が無くなったため。代わりに、面談で話題にしやすい
 * 進行表の直近単元履歴＋引継ぎと、成績（定期テスト）を載せる。A4縦1枚に収めるため
 * 進行表は上位3テキスト×直近3単元に絞る。
 */

import type { AssessmentWithScores, Student } from '@/types/database';
import {
  computeDisciplineMonthly,
  computeScoreSummary,
  fmtDateJa,
  summarizeTextbookDetail,
} from './interview.shared';
import type { HandoverInfo } from './InterviewTimeline';
import type { TextbookProgressData } from './ProgressPanel';
import type { DisciplineSessionRow } from '@/lib/api/progress-sessions';
import type { BriefView } from './InterviewBriefCard';
import { formatGradeLabel } from '@/lib/utils/gradeLabel';
import { INTERVIEW_TYPE_LABELS, type StudentInterview } from '@/types/database';

interface InterviewPrintSheetProps {
  student: Student;
  today: string;
  handover: HandoverInfo | null;
  /** 面談タイムラインの直近3件（新しい順） */
  recentInterviews: StudentInterview[];
  assessments: AssessmentWithScores[];
  /** 進行表の生データ（画面の ProgressPanel と同じもの）。集計はこちら側で行う */
  textbookData: TextbookProgressData[];
  /** 宿題・遅刻パネルと同じ生セッション行。集計は computeDisciplineMonthly で画面側と揃える */
  disciplineSessions: DisciplineSessionRow[];
  /**
   * 報告事項（AI）。作っていなければ null で、その節ごと出さない。
   * ★画面で手直しした「見えること」がそのまま入る（親が結果を持っているため）。
   */
  brief?: BriefView | null;
}

export function InterviewPrintSheet({
  student,
  today,
  handover,
  recentInterviews,
  assessments,
  textbookData,
  disciplineSessions,
  brief,
}: InterviewPrintSheetProps) {
  const scoreSummary = computeScoreSummary(assessments);
  // 画面（DisciplinePanel）と同じ直近6ヶ月・同じ集計関数で数字を揃える
  const disciplineMonths = computeDisciplineMonthly(disciplineSessions, 6, new Date());

  // A4縦1枚に収めるため上位3テキスト×直近3単元に絞る（画面側は5件だが印刷は紙面の都合で減らす）
  const printTextbooks = textbookData.slice(0, 3).map(({ textbook, rows }) => {
    const detail = summarizeTextbookDetail(textbook, rows);
    return { ...detail, recentLessons: detail.recentLessons.slice(0, 3) };
  });

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

      {/* 報告事項（AI）。作っていなければ節ごと出さない。画面と同じく申し送りの直下に置く。
          ★紙は簡素に: 現状の行＋見えること＋話す項目だけ（色線・編集欄は紙では意味を持たない）。 */}
      {brief && (
        <div className="mb-3">
          <div className="mb-1 border-b border-black pb-0.5 text-xs font-bold">報告事項</div>
          <div className="flex flex-col gap-1">
            {brief.sections.map((s) => (
              <div key={s.key} className="break-inside-avoid text-[10px] leading-snug">
                <span className="font-medium">{s.label}：</span>
                <span className="text-gray-700">{s.current.join(' ／ ')}</span>
                {s.seen && <div className="ml-2">→ {s.seen}</div>}
              </div>
            ))}
          </div>
          {brief.thread && (
            <div className="mt-1 text-[10px] leading-snug">
              <span className="font-medium">つなげて見えること：</span>
              {brief.thread}
            </div>
          )}
          {brief.talk.length > 0 && (
            <div className="mt-1 text-[10px] leading-snug">
              <div className="font-medium">話す項目</div>
              <ol className="ml-4 list-decimal">
                {brief.talk.map((t, i) => (
                  <li key={i}>{t.text}</li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}

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

      {/* 成績表（定期テスト直近3件） */}
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

      {/* 進行表（直近の単元履歴＋引継ぎ） */}
      <div>
        <div className="mb-1 border-b border-black pb-0.5 text-xs font-bold">
          進行表（直近の単元履歴）
        </div>
        {printTextbooks.length === 0 ? (
          <p className="text-[10px] text-gray-500">進行表で管理中のテキストはありません</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {printTextbooks.map((tb) => (
              <div key={tb.id} className="break-inside-avoid text-[10px] leading-snug">
                <div className="font-medium">
                  {tb.name}
                  {tb.subject ? `（${tb.subject}）` : ''}・{tb.done}/{tb.total}（{tb.progressPct}%）
                  {tb.stalled ? ' ※停滞' : ''}
                </div>
                {tb.recentLessons.length === 0 ? (
                  <p className="text-gray-500">実施記録なし</p>
                ) : (
                  <ul className="ml-2 list-disc">
                    {tb.recentLessons.map((l, i) => (
                      <li key={i}>
                        {fmtDateJa(l.lessonDate)}　{l.unitTitle}
                        {l.teacherName ? `（${l.teacherName}）` : ''}
                        {l.handover && (
                          <span className="text-gray-700"> ／引継ぎ: {l.handover}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 宿題・遅刻（直近6ヶ月・月次） */}
      <div className="mt-3">
        <div className="mb-1 border-b border-black pb-0.5 text-xs font-bold">
          宿題・遅刻（直近6ヶ月）
        </div>
        {disciplineMonths.every((m) => m.lessonDays === 0) ? (
          <p className="text-[10px] text-gray-500">直近6ヶ月の授業記録がありません</p>
        ) : (
          <table className="w-full border-collapse text-[10px]">
            <thead>
              <tr className="border-b border-gray-400 text-gray-600">
                <th className="py-1 pl-1 text-left font-medium">月</th>
                <th className="py-1 text-right font-medium">授業</th>
                <th className="py-1 text-right font-medium">宿題忘れ</th>
                <th className="py-1 text-right font-medium">遅刻</th>
              </tr>
            </thead>
            <tbody>
              {disciplineMonths.map((m) => (
                <tr key={m.month} className="border-b border-gray-200">
                  <td className="py-0.5 pl-1">{m.label}</td>
                  <td className="py-0.5 text-right tabular-nums">
                    {m.lessonDays > 0 ? `${m.lessonDays}日` : '—'}
                  </td>
                  <td className="py-0.5 text-right tabular-nums">
                    {m.homeworkMissedDays > 0 ? `${m.homeworkMissedDays}日` : '—'}
                  </td>
                  <td className="py-0.5 text-right tabular-nums">
                    {m.tardyDays > 0 ? `${m.tardyDays}日` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
