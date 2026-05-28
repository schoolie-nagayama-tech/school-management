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

import { useState } from 'react';
import { AdminLayout } from '@/components/layouts';
import { Card, CardContent } from '@/components/ui';
import { Button } from '@/components/ui';
import Link from 'next/link';
import { DemoProgressPreview } from '@/components/lesson-reports/DemoProgressPreview';
import {
  ChevronLeft,
  Target,
  BookOpen,
  ClipboardCheck,
  MessageSquareText,
  CalendarDays,
  GraduationCap,
  Eye,
  Pencil,
  Smartphone,
  CheckCircle2,
  Star,
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
  // 表示モード: preview=室長が承認時に見る完成形 / form=講師が書く入力画面 /
  //            portal=生徒・保護者がポータルで見る形
  const [mode, setMode] = useState<'preview' | 'form' | 'portal'>('preview');

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
          これは授業報告書の<strong>見本（ダミーデータ）</strong>です。講師が「入力画面」で記入 → 室長が「完成イメージ」を確認・承認 → 生徒・保護者に「保護者の見え方」で公開されます。
        </div>

        {/* モード切替タブ */}
        <div className="flex gap-1 p-1 bg-surface rounded-lg border border-border-subtle w-fit flex-wrap">
          <button
            type="button"
            onClick={() => setMode('form')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              mode === 'form' ? 'bg-white shadow-sm text-info' : 'text-text-muted hover:text-text-body'
            }`}
          >
            <Pencil className="w-3.5 h-3.5" />
            入力画面（講師）
          </button>
          <button
            type="button"
            onClick={() => setMode('preview')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              mode === 'preview' ? 'bg-white shadow-sm text-info' : 'text-text-muted hover:text-text-body'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            完成イメージ（室長）
          </button>
          <button
            type="button"
            onClick={() => setMode('portal')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              mode === 'portal' ? 'bg-white shadow-sm text-info' : 'text-text-muted hover:text-text-body'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5" />
            保護者の見え方
          </button>
        </div>

        {mode === 'form' ? (
          <Card>
            <CardContent className="p-6 text-center space-y-3">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-info-subtle text-info mx-auto">
                <Pencil className="w-6 h-6" />
              </div>
              <p className="text-sm text-text-body">
                講師が記入する<strong>実際の入力画面</strong>を、ダミーデータが入った状態で開きます。<br />
                各項目を実際に触って確認できます（保存・提出はされません）。
              </p>
              <Link href="/lesson-reports/demo">
                <Button>
                  <Pencil className="w-4 h-4 mr-1" />
                  実際の入力画面を開く
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : mode === 'portal' ? (
          <PortalView />
        ) : (
        <>
        {/* 完成イメージ（保護者が見る形） */}

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

        {/* 室長の確認画面でも進行表をマージして表示。
            報告書の内容と進行フィードを同じページで突き合わせて承認できる動線。 */}
        <DemoProgressPreview />
        </>
        )}
      </div>
    </AdminLayout>
  );
}

// ─── 保護者の見え方（生徒・保護者がポータルで見る形）──────────
// スマホ表示を想定したやさしいトーンのカード。専門用語を減らし、
// 「がんばり」「先生から」など保護者に伝わる言葉で見せる。
function PortalView() {
  return (
    <div className="space-y-3">
      {/* スマホ枠っぽい見せ方で「生徒・保護者の画面」と分かるように */}
      <div className="mx-auto max-w-sm">
        <div className="rounded-[2rem] border-4 border-gray-800 bg-gray-800 p-2 shadow-xl">
          <div className="rounded-[1.5rem] bg-gradient-to-b from-sky-50 to-white overflow-hidden">
            {/* ステータスバー風 */}
            <div className="bg-info text-white px-4 py-3">
              <div className="text-[11px] opacity-80">スクールIE ○○校 保護者ページ</div>
              <div className="text-base font-bold">{SAMPLE.studentName} さんの授業レポート</div>
            </div>

            <div className="p-3 space-y-3 max-h-[70vh] overflow-y-auto">
              {/* 日付 */}
              <div className="text-center text-xs text-text-muted">
                {SAMPLE.lessonDate}（{W(SAMPLE.lessonDate)}）{SAMPLE.subjects.join('・')} ／ {SAMPLE.teacherName} 先生
              </div>

              {/* 先生からのひとこと（講評を主役に） */}
              <div className="rounded-2xl bg-white border border-sky-100 shadow-sm p-4">
                <div className="flex items-center gap-1.5 text-sm font-bold text-info mb-2">
                  <MessageSquareText className="w-4 h-4" />
                  先生から
                </div>
                <p className="text-sm text-text-body leading-relaxed">{SAMPLE.reviewComment}</p>
              </div>

              {/* がんばり（達成度をやさしく） */}
              <div className="rounded-2xl bg-white border border-sky-100 shadow-sm p-4">
                <div className="flex items-center gap-1.5 text-sm font-bold text-success mb-3">
                  <Star className="w-4 h-4" />
                  今日のがんばり
                </div>
                <div className="space-y-2.5">
                  {[
                    { label: '宿題をやってきた', value: SAMPLE.homeworkCompletionPct },
                    { label: '宿題の正解率', value: SAMPLE.homeworkCorrectPct },
                    { label: '今日の理解度', value: SAMPLE.todayCorrectPct },
                  ].map((s) => (
                    <div key={s.label}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-text-body">{s.label}</span>
                        <span className="font-bold text-success tabular-nums">{s.value}%</span>
                      </div>
                      <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-success"
                          style={{ width: `${s.value}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex gap-2 flex-wrap">
                  <span className="px-2 py-1 rounded-full bg-success-subtle text-success text-xs font-semibold">
                    単語テスト {SAMPLE.vocab.score}/{SAMPLE.vocab.total} 合格
                  </span>
                  <span className="px-2 py-1 rounded-full bg-success-subtle text-success text-xs font-semibold">
                    チェックテスト {SAMPLE.check.score}/{SAMPLE.check.total} 合格
                  </span>
                </div>
              </div>

              {/* 今日やったこと */}
              <div className="rounded-2xl bg-white border border-sky-100 shadow-sm p-4">
                <div className="flex items-center gap-1.5 text-sm font-bold text-info mb-2">
                  <BookOpen className="w-4 h-4" />
                  今日やったこと
                </div>
                <ul className="space-y-1 text-sm text-text-body">
                  {SAMPLE.units.map((u, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <span className="text-info mt-0.5">・</span>
                      <span>
                        {u.textbook}（{u.unit} / {u.pages}）
                      </span>
                    </li>
                  ))}
                  <li className="flex items-start gap-1.5 text-text-muted">
                    <span className="mt-0.5">・</span>
                    <span>学校の進み: {SAMPLE.schoolProgress}</span>
                  </li>
                </ul>
              </div>

              {/* 次回までの宿題（チェックリスト風） */}
              <div className="rounded-2xl bg-white border border-sky-100 shadow-sm p-4">
                <div className="flex items-center gap-1.5 text-sm font-bold text-warning mb-2">
                  <CalendarDays className="w-4 h-4" />
                  次回までの宿題
                </div>
                <ul className="space-y-1.5">
                  {SAMPLE.homeworkAssignments.map((h, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <CheckCircle2 className="w-4 h-4 text-gray-300 flex-shrink-0 mt-0.5" />
                      <div>
                        <span className="text-[11px] font-semibold text-warning">
                          {h.date.slice(5).replace('-', '/')}（{W(h.date)}）まで
                        </span>
                        <div className="text-text-body">{h.text}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

              <p className="text-center text-[10px] text-text-faint pt-1 pb-2">
                ※ これは保護者ポータルでの表示見本です
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
