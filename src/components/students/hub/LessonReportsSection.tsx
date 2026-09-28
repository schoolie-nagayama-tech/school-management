'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { InlineLoading } from '@/components/ui';
import { getApprovedReportsByStudent } from '@/lib/api/class-reports';
import { attachSubjectNames } from '@/lib/lesson-reports/reportSubjectNames';
import { normalizePersonName } from '@/lib/utils/personName';
import type { ClassReport } from '@/types/class-report';

interface LessonReportsSectionProps {
  studentId: string;
}

/** ハブに出す件数。全件は報告書の一覧ページで見る */
const RECENT_COUNT = 5;

/**
 * 授業の様子（承認済み報告書の直近5件）。1件1行で 日付・科目・講師・講評。
 * 承認済みだけなのは、保護者にも見せる前提の報告書だけを「様子」として扱うため（一覧ページと同じ）。
 */
export function LessonReportsSection({ studentId }: LessonReportsSectionProps) {
  const [reports, setReports] = useState<ClassReport[] | null>(null);
  const [subjects, setSubjects] = useState<Map<string, string>>(new Map());
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getApprovedReportsByStudent(studentId, RECENT_COUNT);
        // 科目は報告書に無く、元の授業から逆引きする（一覧ページと同じ関数）
        const map = await attachSubjectNames(data).catch(() => new Map<string, string>());
        if (cancelled) return;
        setReports(data);
        setSubjects(map);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  if (failed) return <p className="text-[13px] text-danger">報告書の取得に失敗しました</p>;
  if (reports === null) return <InlineLoading label="読み込み中…" />;

  return (
    <>
      {reports.length === 0 ? (
        <p className="text-[13px] text-text-muted">承認済みの授業報告書はまだありません</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {reports.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-border-subtle py-1.5 text-[13px] last:border-0"
            >
              <span className="shrink-0 font-mono text-xs text-text-muted">{r.lesson_date}</span>
              <span className="shrink-0 font-medium text-text-heading">
                {subjects.get(r.id) ?? 'その他'}
              </span>
              <span className="shrink-0 text-xs text-text-muted">
                {normalizePersonName(r.teacher?.display_name) || '—'}
              </span>
              <span
                className="min-w-0 flex-1 truncate text-text-body"
                title={r.review_comment ?? ''}
              >
                {r.review_comment || <span className="text-text-faint">講評なし</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Link
        href={`/students/${studentId}/lesson-reports`}
        className="mt-2 inline-block text-[13px] text-primary hover:underline"
      >
        すべての報告書を見る
      </Link>
    </>
  );
}
