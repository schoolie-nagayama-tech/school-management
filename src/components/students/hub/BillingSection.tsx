'use client';

import { useEffect, useState } from 'react';
import { InlineLoading } from '@/components/ui';
import { getBillingItems, getBillingPeriods, getStudentBillingsOfStudent } from '@/lib/api/billing';
import { HubSection } from './HubSection';
import { buildHubBillingRows, pickHubBillingPeriod, type HubBillingRow } from './billingRows';

interface BillingSectionProps {
  studentId: string;
  /** 生徒の所属教室。請求期間・請求項目は教室ごとに作られている */
  schoolId: string;
}

/**
 * 請求項目の計上（直近の請求期間1つ分）。
 *
 * ★NESTは金額を持たない（student_billings に金額の列が無い。請求は本部システムで別管理）。
 *   ここに出すのは「計上したか」と数量・値だけ。金額を足さないこと。
 * 色は対応が要る「未計上」にだけ付ける。計上済みはもう手を離れているので控えめに出す。
 * 見出しの右に期間名を出すため、見出しごとこの部品が持つ（期間名は読み込んでから分かる）。
 */
export function BillingSection({ studentId, schoolId }: BillingSectionProps) {
  const [periodName, setPeriodName] = useState<string | null>(null);

  return (
    <HubSection
      id="sec-billing"
      title="請求項目の計上"
      extra={periodName ? <span className="text-xs text-text-muted">{periodName}</span> : null}
      detailHref="/billing"
      detailLabel="請求管理"
      lazy
      placeholderHeight={160}
    >
      <BillingBody studentId={studentId} schoolId={schoolId} onPeriodName={setPeriodName} />
    </HubSection>
  );
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'noPeriod' }
  | { kind: 'ready'; rows: HubBillingRow[] };

function BillingBody({
  studentId,
  schoolId,
  onPeriodName,
}: BillingSectionProps & { onPeriodName: (name: string | null) => void }) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    (async () => {
      try {
        const period = pickHubBillingPeriod(await getBillingPeriods(schoolId));
        if (cancelled) return;
        if (!period) {
          onPeriodName(null);
          setState({ kind: 'noPeriod' });
          return;
        }
        onPeriodName(period.name);
        const [items, billings] = await Promise.all([
          getBillingItems(period.id, schoolId),
          getStudentBillingsOfStudent(period.id, studentId, schoolId),
        ]);
        if (cancelled) return;
        setState({ kind: 'ready', rows: buildHubBillingRows(items, billings) });
      } catch {
        if (!cancelled) setState({ kind: 'failed' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [studentId, schoolId, onPeriodName]);

  if (state.kind === 'loading') return <InlineLoading label="読み込み中…" />;
  if (state.kind === 'failed') {
    return <p className="text-[13px] text-danger">請求の計上の取得に失敗しました</p>;
  }
  if (state.kind === 'noPeriod') {
    return <p className="text-[13px] text-text-muted">請求期間がまだありません</p>;
  }
  if (state.rows.length === 0) {
    return <p className="text-[13px] text-text-muted">この期間に計上する項目はありません</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px] tabular-nums">
        <thead>
          <tr className="border-b border-border-subtle text-left text-xs text-text-muted">
            <th className="py-1.5 pr-3 font-medium">項目</th>
            <th className="py-1.5 pr-3 font-medium">計上</th>
            <th className="py-1.5 font-medium">数量・値</th>
          </tr>
        </thead>
        <tbody>
          {state.rows.map((r) => (
            <tr key={r.itemId} className="border-b border-border-subtle last:border-0">
              <td className="py-1.5 pr-3">{r.name}</td>
              <td className="whitespace-nowrap py-1.5 pr-3">
                {r.state === 'pending' ? (
                  <span className="inline-flex items-center rounded-full border border-warning bg-warning-subtle px-2 text-[11px] font-medium leading-[1.6] text-warning">
                    未計上
                  </span>
                ) : (
                  <span className="text-text-muted">計上済</span>
                )}
              </td>
              <td className="py-1.5">
                {r.value === null ? (
                  <span className="text-text-faint">—</span>
                ) : (
                  <span className="whitespace-pre-wrap break-all">{r.value}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
