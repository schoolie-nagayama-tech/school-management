'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, FileText } from 'lucide-react';
import { groupReportsByMonth, type PortalReportListItem } from '@/types/mypage-report';
import { formatGradeLabel } from '@/lib/utils/gradeLabel';

/**
 * 授業報告書の一覧 — 保護者側（§7-4・UIモック セクション1）。
 *
 * 構成（モック準拠）:
 *   兄弟切替タブ → 月グルーピング見出し → カード（日付／教科・講師名／今日の目標の抜粋／
 *   テスト・宿題の結果チップ）。未読は左端の色帯＋「新着」。
 *
 * ★ 開かなくても概況が掴めるようにする（モックの意図）:
 *   保護者が毎回詳細を開くとは限らない。カードに結果チップを出すことで、
 *   一覧をスクロールするだけで「今週どうだったか」が分かる。
 *
 * 既読化は詳細ページ側で行う（一覧のタップ＝詳細を開く）。
 */

/** 兄弟切替に使う生徒（親から渡す）。 */
export interface ReportStudent {
  id: string;
  name: string;
  grade: number | null;
}

export function ReportsView({ students }: { students: ReportStudent[] }) {
  const [studentId, setStudentId] = useState<string | null>(students[0]?.id ?? null);
  const [items, setItems] = useState<PortalReportListItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!studentId) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/mypage/reports?studentId=${encodeURIComponent(studentId)}`)
      .then((r) => (r.ok ? r.json() : { reports: [] }))
      .then((d: { reports?: PortalReportListItem[] }) => {
        if (!cancelled) setItems(d.reports ?? []);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  const groups = useMemo(() => groupReportsByMonth(items), [items]);

  if (students.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface-raised p-4 text-sm text-text-muted">
        表示できる生徒がいません。教室から届いた招待で生徒を紐づけてください。
      </div>
    );
  }

  return (
    <div>
      {/* 兄弟切替（1人なら出さない） */}
      {students.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {students.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setStudentId(s.id)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                s.id === studentId
                  ? 'border-text-heading bg-text-heading font-semibold text-surface-raised'
                  : 'border-border bg-surface-raised text-text-muted'
              }`}
            >
              {s.name}
              {s.grade != null && `（${formatGradeLabel(s.grade)}）`}
            </button>
          ))}
        </div>
      )}

      {loading && items.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface-raised p-4 text-sm text-text-muted">
          読み込み中…
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface-raised p-4 text-sm text-text-muted">
          公開されている報告書はまだありません。
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <section key={g.monthKey}>
              <h2 className="mb-2 text-xs font-bold text-text-muted">{g.monthLabel}</h2>
              <ul className="space-y-2">
                {g.items.map((r) => (
                  <li key={r.id}>
                    <ReportCard report={r} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

/** 一覧カード1枚。 */
function ReportCard({ report }: { report: PortalReportListItem }) {
  const chips = buildChips(report);
  return (
    <Link
      href={`/mypage/reports/${report.id}`}
      className={`flex items-start gap-3 rounded-xl border bg-surface-raised p-3 transition-colors hover:bg-surface-hover ${
        report.isRead ? 'border-border' : 'border-l-4 border-l-primary border-border'
      }`}
    >
      <span className="mt-0.5 flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-ink-subtle text-ink">
        <FileText className="h-[18px] w-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-bold text-text-heading">
            {formatLessonDate(report.lessonDate)}
          </span>
          <span className="text-xs text-text-muted">{subtitleOf(report)}</span>
          {!report.isRead && (
            <span className="rounded-full bg-primary px-2 py-[1px] text-[9.5px] font-bold text-text-on-primary">
              新着
            </span>
          )}
        </div>
        {report.shortTermGoal && (
          <p className="mt-0.5 truncate text-xs text-text-body">{report.shortTermGoal}</p>
        )}
        {chips.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {chips.map((c) => (
              <span
                key={c.label}
                className={`rounded-full px-2 py-[1.5px] text-[9.5px] font-bold ${c.className}`}
              >
                {c.label}
              </span>
            ))}
          </div>
        )}
      </div>
      <ChevronRight className="h-4 w-4 flex-none self-center text-text-faint" />
    </Link>
  );
}

/** カードの副題（「数学 ・ 佐々木先生」）。教科も講師も無ければ空。 */
function subtitleOf(r: PortalReportListItem): string {
  return [r.subjectNames.join('・'), r.teacherName ? `${r.teacherName}先生` : null]
    .filter(Boolean)
    .join(' ・ ');
}

interface Chip {
  label: string;
  className: string;
}

/**
 * カードの結果チップを組み立てる（モック準拠）。
 * テストは「合格なら success / 不合格・未判定なら warning」。宿題はやってきた量のみ
 * （％を3つ並べるとカードが読めなくなるので、詳細に譲る）。
 *
 * ★ テストは確認テストの1本のみ（英単語のチップは廃止）。理由は types/mypage-report.ts の注記。
 */
function buildChips(r: PortalReportListItem): Chip[] {
  const chips: Chip[] = [];
  const push = (
    name: string,
    score: number | null,
    total: number | null,
    passed: boolean | null
  ) => {
    if (score == null || total == null) return;
    const label = `${name} ${score}/${total}${passed ? ' 合格' : ''}`;
    chips.push({
      label,
      className: passed ? 'bg-success-subtle text-success' : 'bg-warning-subtle text-warning',
    });
  };
  push('確認テスト', r.checkTestScore, r.checkTestTotal, r.checkTestPassed);
  if (r.homeworkCompletionPct != null) {
    chips.push({
      label: `宿題 ${r.homeworkCompletionPct}%`,
      className: 'bg-ink-subtle text-ink',
    });
  }
  return chips;
}

/** 'YYYY-MM-DD' → '7月14日(月)'。 */
export function formatLessonDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dow = ['日', '月', '火', '水', '木', '金', '土'][
    new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  ];
  return `${m}月${d}日(${dow})`;
}
