'use client';

/**
 * 授業報告書の見本（ダミーデータ）
 *
 * URL: /lesson-reports/sample
 *
 * 用途：関係者に「授業報告書がどんな内容で書かれ、どう見えるか」をデモするための
 *       読み取り専用の完成見本。実データは使わず、固定のダミーで完成形を再現する。
 *
 * 実際の入力フォームは /lesson-reports/[scheduleEntryId]。
 */

import { AdminLayout } from '@/components/layouts';
import { Card, CardContent } from '@/components/ui';
import Link from 'next/link';
import {
  ChevronLeft,
  Target,
  BookOpen,
  ClipboardCheck,
  MessageSquareText,
  CalendarDays,
  GraduationCap,
} from 'lucide-react';

// ─── ダミーデータ（固定見本） ───────────────────────────
const SAMPLE = {
  studentName: '山田 太郎',
  grade: '中2',
  teacherName: '田中 花子',
  lessonDate: '2026-05-28',
  slotLabel: '3限 16:20〜17:50',
  subjects: ['英語'],
  midTermGoal: '英文法 Unit 5〜8 を完了し、1学期期末で 80 点以上を取る',
  midActionGoal: '宿題を毎回提出し、間違えた問題を翌日に必ず復習する習慣をつける',
  shortTermGoal: '現在完了形（継続・経験・完了）の使い分けを理解し、自分で例文を5つ作れる',
  schoolProgress: '教科書 p.62 現在完了形（継続用法）',
  units: [
    {
      isMain: true,
      textbook: 'New Horizon 中2 英語',
      unit: 'Unit 6 / 現在完了形',
      pages: 'p.48〜52',
    },
    {
      isMain: false,
      textbook: '英文法ドリル',
      unit: '現在完了形（継続）',
      pages: 'p.20〜22',
    },
  ],
  homeworkCompletionPct: 90,
  homeworkCorrectPct: 75,
  todayCorrectPct: 85,
  vocab: { score: 18, total: 20, passed: true },
  check: { score: 8, total: 10, passed: true },
  reviewComment:
    '現在完了形の「継続」用法はよく理解できていました。have/has の使い分けも問題ありません。「経験」用法でやや混乱が見られたので、次回 ever / never を使った例文練習を中心に進めます。宿題の取り組みも丁寧で、間違い直しもできていました。この調子で続けましょう。',
  homeworkAssignments: [
    { date: '2026-05-29', text: '英文法ドリル p.23〜24（現在完了形・経験）' },
    { date: '2026-05-30', text: '単語練習 Unit 6（46〜49）3回ずつ' },
    { date: '2026-06-01', text: '教科書 p.63 音読 + Q&A ノート作成' },
  ],
  subjectSpecific: {
    label: '英単語練習',
    range: 'Unit 6 単語',
    pages: 'p.46〜49',
    timesPerDay: 3,
    duration: '1週間',
  },
};

function Pct({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex-1 min-w-[120px]">
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-xs text-text-muted">{label}</span>
        <span className="text-sm font-bold tabular-nums" style={{ color }}>
          {value}%
        </span>
      </div>
      <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${value}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 text-sm font-bold text-text-heading mb-2">
      {icon}
      {children}
    </div>
  );
}

const W = (d: string) => ['日', '月', '火', '水', '木', '金', '土'][new Date(d + 'T12:00:00').getDay()];

export default function LessonReportSamplePage() {
  return (
    <AdminLayout headerTitle="授業報告書（見本）">
      <div className="max-w-2xl mx-auto p-4 space-y-4">
        {/* 見本である旨の注記 */}
        <div className="flex items-center gap-2">
          <Link
            href="/lesson-reports/pending"
            className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text-body"
          >
            <ChevronLeft className="w-4 h-4" />
            報告書一覧へ
          </Link>
        </div>
        <div className="rounded-lg bg-info-subtle border border-info/30 px-3 py-2 text-xs text-info">
          これは授業報告書の<strong>見本（ダミーデータ）</strong>です。実際は講師が授業ごとにこの内容を入力し、室長が承認して保護者に公開します。
        </div>

        {/* ヘッダー：生徒・講師・日付 */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-start justify-between flex-wrap gap-2">
              <div>
                <div className="text-lg font-bold text-text-heading">
                  {SAMPLE.studentName}
                  <span className="ml-2 text-sm font-normal text-text-muted">{SAMPLE.grade}</span>
                </div>
                <div className="text-sm text-text-muted mt-0.5">
                  {SAMPLE.lessonDate}（{W(SAMPLE.lessonDate)}）{SAMPLE.slotLabel}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-text-muted">担当講師</div>
                <div className="text-sm font-semibold">{SAMPLE.teacherName}</div>
                <div className="mt-1 flex gap-1 justify-end">
                  {SAMPLE.subjects.map((s) => (
                    <span
                      key={s}
                      className="px-1.5 py-0.5 text-[10px] rounded bg-sky-50 text-sky-700 border border-sky-200"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-success-subtle text-success text-[11px] font-semibold">
              公開済み
            </div>
          </CardContent>
        </Card>

        {/* 3層目標 */}
        <Card>
          <CardContent className="p-4">
            <SectionTitle icon={<Target className="w-4 h-4 text-info" />}>目標</SectionTitle>
            <div className="space-y-2">
              <div className="rounded-lg bg-surface border border-border-subtle p-2.5">
                <div className="text-[10px] text-text-muted font-semibold">中期目標（教材）</div>
                <div className="text-sm text-text-body">{SAMPLE.midTermGoal}</div>
              </div>
              <div className="rounded-lg bg-surface border border-border-subtle p-2.5">
                <div className="text-[10px] text-text-muted font-semibold">中期目標（行動）</div>
                <div className="text-sm text-text-body">{SAMPLE.midActionGoal}</div>
              </div>
              <div className="rounded-lg bg-info-subtle border border-info/30 p-2.5">
                <div className="text-[10px] text-info font-semibold">この授業の目標（短期）</div>
                <div className="text-sm text-text-body">{SAMPLE.shortTermGoal}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 学習内容（学校進度 + 教材） */}
        <Card>
          <CardContent className="p-4">
            <SectionTitle icon={<BookOpen className="w-4 h-4 text-info" />}>学習内容</SectionTitle>
            <div className="rounded-lg bg-surface border border-border-subtle p-2.5 mb-2">
              <div className="text-[10px] text-text-muted font-semibold">学校進度</div>
              <div className="text-sm text-text-body">{SAMPLE.schoolProgress}</div>
            </div>
            <ul className="space-y-1.5">
              {SAMPLE.units.map((u, i) => (
                <li
                  key={i}
                  className="flex items-center gap-2 rounded-lg border border-border-subtle p-2.5"
                >
                  <span
                    className={`px-1.5 py-0.5 text-[10px] rounded font-semibold flex-shrink-0 ${
                      u.isMain
                        ? 'bg-info text-white'
                        : 'bg-gray-100 text-gray-600 border border-gray-200'
                    }`}
                  >
                    {u.isMain ? 'メイン' : 'サブ'}
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-text-body">{u.textbook}</div>
                    <div className="text-xs text-text-muted">
                      {u.unit} ／ {u.pages}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {/* 達成度・テスト */}
        <Card>
          <CardContent className="p-4">
            <SectionTitle icon={<ClipboardCheck className="w-4 h-4 text-info" />}>
              達成度・テスト
            </SectionTitle>
            <div className="flex flex-wrap gap-3 mb-3">
              <Pct label="宿題実施率" value={SAMPLE.homeworkCompletionPct} color="var(--info)" />
              <Pct label="宿題正答率" value={SAMPLE.homeworkCorrectPct} color="var(--warning)" />
              <Pct label="本日正答率" value={SAMPLE.todayCorrectPct} color="var(--success)" />
            </div>
            <div className="flex flex-wrap gap-2">
              <div className="flex items-center gap-1.5 rounded-lg border border-border-subtle px-2.5 py-1.5">
                <span className="text-xs text-text-muted">単語テスト</span>
                <span className="text-sm font-bold tabular-nums">
                  {SAMPLE.vocab.score}/{SAMPLE.vocab.total}
                </span>
                <span
                  className={`px-1.5 py-0.5 text-[10px] rounded-full font-semibold ${
                    SAMPLE.vocab.passed
                      ? 'bg-success-subtle text-success'
                      : 'bg-danger-subtle text-danger'
                  }`}
                >
                  {SAMPLE.vocab.passed ? '合格' : '再テスト'}
                </span>
              </div>
              <div className="flex items-center gap-1.5 rounded-lg border border-border-subtle px-2.5 py-1.5">
                <span className="text-xs text-text-muted">チェックテスト</span>
                <span className="text-sm font-bold tabular-nums">
                  {SAMPLE.check.score}/{SAMPLE.check.total}
                </span>
                <span
                  className={`px-1.5 py-0.5 text-[10px] rounded-full font-semibold ${
                    SAMPLE.check.passed
                      ? 'bg-success-subtle text-success'
                      : 'bg-danger-subtle text-danger'
                  }`}
                >
                  {SAMPLE.check.passed ? '合格' : '再テスト'}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 講評 */}
        <Card>
          <CardContent className="p-4">
            <SectionTitle icon={<MessageSquareText className="w-4 h-4 text-info" />}>
              講評
            </SectionTitle>
            <p className="text-sm text-text-body leading-relaxed whitespace-pre-wrap">
              {SAMPLE.reviewComment}
            </p>
          </CardContent>
        </Card>

        {/* 次回までの宿題（日割り） */}
        <Card>
          <CardContent className="p-4">
            <SectionTitle icon={<CalendarDays className="w-4 h-4 text-info" />}>
              次回までの宿題
            </SectionTitle>
            <ul className="space-y-1.5">
              {SAMPLE.homeworkAssignments.map((h, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="flex-shrink-0 mt-0.5 px-2 py-0.5 rounded-md bg-surface border border-border-subtle text-[11px] font-semibold tabular-nums text-text-muted">
                    {h.date.slice(5).replace('-', '/')}（{W(h.date)}）
                  </span>
                  <span className="text-sm text-text-body">{h.text}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {/* 科目別欄（英語＝単語練習） */}
        <Card>
          <CardContent className="p-4">
            <SectionTitle icon={<GraduationCap className="w-4 h-4 text-info" />}>
              科目別（{SAMPLE.subjectSpecific.label}）
            </SectionTitle>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="rounded-lg border border-border-subtle p-2">
                <div className="text-[10px] text-text-muted">範囲</div>
                <div className="text-sm font-medium">{SAMPLE.subjectSpecific.range}</div>
              </div>
              <div className="rounded-lg border border-border-subtle p-2">
                <div className="text-[10px] text-text-muted">ページ</div>
                <div className="text-sm font-medium">{SAMPLE.subjectSpecific.pages}</div>
              </div>
              <div className="rounded-lg border border-border-subtle p-2">
                <div className="text-[10px] text-text-muted">1日の回数</div>
                <div className="text-sm font-medium">{SAMPLE.subjectSpecific.timesPerDay} 回</div>
              </div>
              <div className="rounded-lg border border-border-subtle p-2">
                <div className="text-[10px] text-text-muted">期間</div>
                <div className="text-sm font-medium">{SAMPLE.subjectSpecific.duration}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
