'use client';

/**
 * 送信後の申込済み表示（読み取り専用）。
 *
 * 2つの状況で使う:
 *  1. `AppliedSummary` — このセッション内で送信が成功した直後。手元の選択状態が残っているので
 *     内訳（個別・小集団/プログラミング・合計）まで見せられる（モック AppliedSummaryMock の移植）。
 *  2. `AlreadySubmittedNotice` — ページ読み込み時点で既に申込済み（`alreadySubmitted`）。
 *     過去の申込内容はサーバーから返さない契約（`KoushuApplyFormData` に含まれない）ため、
 *     内訳は再現できない。文言のみ表示する（決定53: 再提出は一切見せない。教室からの個別連絡のみ）。
 */
import { Info } from 'lucide-react';
import type { ApplyCourse } from '@/types/koushu-apply';
import { chargeableKoma } from '@/types/koushu-apply';
import { yen } from './koushuApplyClientUtils';
import type { ApplyLineView } from './KoushuApplyForm';

const APPLIED_NOTICE = '申込を受け付けています。お申込み内容の変更・キャンセルはできません。';

interface AppliedSummaryProps {
  lines: ApplyLineView[];
  komaBySubject: Record<string, number>;
  totals: { totalKoma: number; totalRegular: number; totalChargeable: number; totalFee: number };
  joinedCourses: ApplyCourse[];
  totalCourseFee: number;
  grandTotal: number;
}

/** このセッション内で送信が成功した直後の内訳付き表示 */
export function AppliedSummary({
  lines,
  komaBySubject,
  totals,
  joinedCourses,
  totalCourseFee,
  grandTotal,
}: AppliedSummaryProps) {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-info bg-info-subtle p-3 flex gap-2">
        <Info className="w-4 h-4 text-info shrink-0 mt-0.5" />
        <p className="text-xs text-[var(--headline)] leading-relaxed">{APPLIED_NOTICE}</p>
      </div>

      <div className="rounded-xl border border-[var(--stroke)] overflow-hidden">
        <div className="px-3 py-2 bg-gray-50 text-xs font-medium text-[var(--headline)]">
          申込内容
        </div>

        <div className="px-3 pt-2 text-[11px] font-medium text-[var(--paragraph)]">個別</div>
        {lines
          .filter((l) => l.unitPrice != null && (komaBySubject[l.subjectId] ?? 0) > 0)
          .map((l) => {
            const n = komaBySubject[l.subjectId] ?? 0;
            const price = l.unitPrice as number;
            return (
              <div
                key={l.subjectId}
                className="px-3 py-2.5 flex items-center justify-between border-t border-[var(--stroke)]"
              >
                <div>
                  <p className="text-sm text-[var(--headline)] flex items-center gap-1.5">
                    {l.subjectName}
                    {l.addedByParent && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-info-subtle text-info">
                        追加
                      </span>
                    )}
                  </p>
                  <p className="text-[11px] text-[var(--paragraph)]">
                    {l.ratio === 1 ? '1対1' : '1対2'} / {l.duration}分 ・ {n}コマ
                    {l.regularKoma > 0 && `（うち通常 ${Math.min(n, l.regularKoma)}コマ）`}
                  </p>
                  <p className="text-[11px] text-[var(--paragraph)]">
                    講習費 {chargeableKoma(n, l.regularKoma)}コマ × {yen(price)}
                  </p>
                </div>
                <span className="text-sm font-semibold text-[var(--headline)] tabular-nums">
                  {yen(chargeableKoma(n, l.regularKoma) * price)}
                </span>
              </div>
            );
          })}
        <div className="px-3 py-2.5 border-t border-[var(--stroke)] bg-gray-50 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-sm text-[var(--headline)]">合計コマ数</span>
            <span className="text-sm font-semibold text-[var(--headline)] tabular-nums">
              {totals.totalKoma}コマ
            </span>
          </div>
          {totals.totalRegular > 0 && (
            <div className="flex items-center justify-between text-xs text-[var(--paragraph)]">
              <span>うち通常授業（月謝に含む）</span>
              <span className="tabular-nums">−{totals.totalRegular}コマ</span>
            </div>
          )}
          <div className="flex items-center justify-between text-xs text-[var(--paragraph)]">
            <span>講習費の対象</span>
            <span className="tabular-nums">{totals.totalChargeable}コマ</span>
          </div>
          <div className="flex items-center justify-between pt-1.5 border-t border-[var(--stroke)]">
            <span className="text-sm text-[var(--headline)]">個別 小計</span>
            <span className="text-base font-semibold text-[var(--headline)] tabular-nums">
              {yen(totals.totalFee)}
            </span>
          </div>
        </div>

        {joinedCourses.length > 0 && (
          <>
            <div className="px-3 pt-2 border-t border-[var(--stroke)] text-[11px] font-medium text-[var(--paragraph)]">
              小集団・プログラミング（差引対象外）
            </div>
            {joinedCourses.map((c) => {
              const fee = c.unitPrice * c.remainingCount;
              const startIndex = c.sessions.findIndex((s) => !s.held);
              const startSessionNumber = startIndex >= 0 ? startIndex + 1 : c.sessions.length + 1;
              const fullyJoined = startSessionNumber === 1;
              return (
                <div
                  key={c.courseId}
                  className="px-3 py-2.5 flex items-center justify-between border-t border-[var(--stroke)]"
                >
                  <div>
                    <p className="text-sm text-[var(--headline)]">{c.name}</p>
                    <p className="text-[11px] text-[var(--paragraph)]">
                      {fullyJoined
                        ? `${c.formation} ・ ${c.sessions.length}回 × ${yen(c.unitPrice)}`
                        : `${c.formation} ・ 第${startSessionNumber}回から参加・残り${c.remainingCount}回 × ${yen(c.unitPrice)}`}
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-[var(--headline)] tabular-nums">
                    {yen(fee)}
                  </span>
                </div>
              );
            })}
            <div className="px-3 py-2.5 border-t border-[var(--stroke)] bg-gray-50 flex items-center justify-between">
              <span className="text-sm text-[var(--headline)]">小集団・プログラミング 小計</span>
              <span className="text-base font-semibold text-[var(--headline)] tabular-nums">
                {yen(totalCourseFee)}
              </span>
            </div>
          </>
        )}

        <div className="px-3 py-3 border-t border-[var(--stroke)] flex items-center justify-between">
          <span className="text-sm font-semibold text-[var(--headline)]">合計</span>
          <span className="text-lg font-semibold text-[var(--headline)] tabular-nums">
            {yen(grandTotal)}
          </span>
        </div>
      </div>

      <p className="text-[11px] text-[var(--paragraph)]">
        通える日の入力内容も送信済みです。日程は教室で組み、決まり次第お知らせします。
      </p>
    </div>
  );
}

/** ページ読み込み時点で既に申込済み（過去セッションぶん。内訳は再現できない） */
export function AlreadySubmittedNotice() {
  return (
    <div className="rounded-lg border border-info bg-info-subtle p-4 flex gap-2">
      <Info className="w-4 h-4 text-info shrink-0 mt-0.5" />
      <p className="text-xs text-[var(--headline)] leading-relaxed">{APPLIED_NOTICE}</p>
    </div>
  );
}
