'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { InlineLoading } from '@/components/ui';
import { getFormResponsesByStudent } from '@/lib/api/form-responses';
import { FORM_TYPE_LABELS, type FormResponse } from '@/types/database';

interface FormResponsesSectionProps {
  studentId: string;
}

/**
 * status_checks のキー → [済みの言い方, 未の言い方]。
 * 各申込の詳細モーダル（src/components/forms/<種別>/…ResponseDetailModal.tsx）と同じ言葉にしてある。
 * ここに無いキーは出さない（意味の分からない英字キーを画面に出さないため）。
 */
const STATUS_CHECK_LABELS: Record<string, [string, string]> = {
  handled: ['対応済み', '未対応'],
  applied: ['申込済み', '未申込'],
  order: ['発注済み', '未発注'],
  charged: ['計上済み', '未計上'],
};

/** 申込の詳細画面があるフォーム種別（/forms/responses/[種別]/[期]）。教材販売には無い */
const TYPES_WITH_DETAIL = new Set(['zoukoma', 'moshi', 'mogi', 'shukaisu', 'youbi', 'soudan']);

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

/**
 * 申込状況の表の中身（申込日・種別・期・状態）。見出しは呼び出し側の HubSection が持つ。
 *
 * 第1段では内容の要約（何コマ・どの模試か等）は出さない。種別ごとに response_data の形が違い、
 * 無理に共通化すると取り違えるため。中身は行の「期」から各申込の画面で見る。
 */
export function FormResponsesSection({ studentId }: FormResponsesSectionProps) {
  const [rows, setRows] = useState<FormResponse[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getFormResponsesByStudent(studentId)
      .then((r) => {
        if (!cancelled) setRows(r);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  if (failed) return <p className="text-[13px] text-danger">申込の履歴の取得に失敗しました</p>;
  if (rows === null) return <InlineLoading label="読み込み中…" />;
  if (rows.length === 0) {
    return (
      <p className="text-[13px] text-text-muted">
        この生徒に紐付いた申込はありません（申込一覧で生徒に紐付けるとここに出ます）
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px] tabular-nums">
        <thead>
          <tr className="border-b border-border-subtle text-left text-xs text-text-muted">
            <th className="py-1.5 pr-3 font-medium">申込日</th>
            <th className="py-1.5 pr-3 font-medium">種別</th>
            <th className="py-1.5 pr-3 font-medium">期</th>
            <th className="py-1.5 font-medium">状態</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const checks = Object.entries(STATUS_CHECK_LABELS).filter(
              ([key]) => r.status_checks && key in r.status_checks
            );
            return (
              <tr key={r.id} className="border-b border-border-subtle last:border-0">
                <td className="whitespace-nowrap py-1.5 pr-3 font-mono text-xs">
                  {formatDate(r.created_at)}
                </td>
                <td className="whitespace-nowrap py-1.5 pr-3">
                  {FORM_TYPE_LABELS[r.form_type] ?? r.form_type}
                </td>
                <td className="whitespace-nowrap py-1.5 pr-3">
                  {TYPES_WITH_DETAIL.has(r.form_type) ? (
                    <Link
                      href={`/forms/responses/${r.form_type}/${r.form_period}?schoolId=${r.school_id}`}
                      className="text-primary hover:underline"
                    >
                      {r.form_period}
                    </Link>
                  ) : (
                    r.form_period
                  )}
                </td>
                <td className="py-1.5">
                  {checks.length === 0 ? (
                    <span className="text-text-faint">—</span>
                  ) : (
                    <span className="flex flex-wrap gap-x-2">
                      {checks.map(([key, [done, pending]]) =>
                        r.status_checks[key] ? (
                          // 済みはもう手を離れているので控えめに。未は対応が要るので本文の濃さで出す
                          <span key={key} className="text-text-muted">
                            {done}
                          </span>
                        ) : (
                          <span key={key} className="text-text-body">
                            {pending}
                          </span>
                        )
                      )}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
