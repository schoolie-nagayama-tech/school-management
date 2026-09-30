'use client';

import { useEffect, useState } from 'react';
import { InlineLoading } from '@/components/ui';
import { getStudentLogs, toStudentLogEvents, type StudentLogEvent } from '@/lib/api/studentLogs';
import { HubSection } from './HubSection';

interface LogsSectionProps {
  studentId: string;
}

/** 表に出す件数 */
const SHOW_COUNT = 20;
/**
 * 取りに行く件数。表示する変更が無いログ（科目だけの更新など）を落とすので、出す件数より多めに取る。
 * 落ちた分だけ20件に届かないことはあるが、そのために追加で取り直すほどの情報ではない。
 */
const FETCH_COUNT = 50;

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16).replace('T', ' ');
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
    d.getMinutes()
  )}`;
}

/**
 * 変更履歴（student_logs の直近）。日時と出来事だけを出す。
 * ★理由（diff.reason）も操作者（actor）も出さない（2026-09 ユーザー決定）。
 * 出来事の文言は通知フィードと同じ（buildChangeSummary）。別の言い方にすると同じ変更が2通りに読める。
 */
export function LogsSection({ studentId }: LogsSectionProps) {
  return (
    <HubSection id="sec-logs" title="変更履歴" lazy placeholderHeight={160}>
      <LogsBody studentId={studentId} />
    </HubSection>
  );
}

function LogsBody({ studentId }: LogsSectionProps) {
  const [events, setEvents] = useState<StudentLogEvent[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setEvents(null);
    setFailed(false);
    getStudentLogs(studentId, FETCH_COUNT)
      .then((logs) => {
        if (!cancelled) setEvents(toStudentLogEvents(logs, SHOW_COUNT));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  if (failed) return <p className="text-[13px] text-danger">変更履歴の取得に失敗しました</p>;
  if (events === null) return <InlineLoading label="読み込み中…" />;
  if (events.length === 0) {
    return <p className="text-[13px] text-text-muted">変更履歴はありません</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px] tabular-nums">
        <thead>
          <tr className="border-b border-border-subtle text-left text-xs text-text-muted">
            <th className="py-1.5 pr-3 font-medium">日時</th>
            <th className="py-1.5 font-medium">出来事</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id} className="border-b border-border-subtle last:border-0">
              <td className="whitespace-nowrap py-1.5 pr-3 align-top font-mono text-xs">
                {formatDateTime(e.createdAt)}
              </td>
              <td className="py-1.5">{e.summary}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
