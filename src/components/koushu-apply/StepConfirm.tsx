'use client';

/**
 * ステップ4: 確認。
 * モック `apply-mock` の StepConfirm を本実装へ移植。読み取り専用の内訳表示のみで、
 * 送信ボタンは KoushuApplyForm の固定フッタ側に置く（ステップ間で共通のボタンにするため）。
 * 内訳は「個別（差引後）」「小集団・プログラミング（差引対象外）」を分けて出し、最後に合算する（決定43）。
 */
import { AlertCircle } from 'lucide-react';
import type { ApplyCourse } from '@/types/koushu-apply';
import { chargeableKoma } from '@/types/koushu-apply';
import { yen } from './koushuApplyClientUtils';
import type { ApplyLineView } from './KoushuApplyForm';

interface StepConfirmProps {
  lines: ApplyLineView[];
  komaBySubject: Record<string, number>;
  totals: { totalKoma: number; totalRegular: number; totalChargeable: number; totalFee: number };
  joinedCourses: ApplyCourse[];
  totalCourseFee: number;
  grandTotal: number;
  okCells: number;
  totalOpenSlots: number;
}

export function StepConfirm({
  lines,
  komaBySubject,
  totals,
  joinedCourses,
  totalCourseFee,
  grandTotal,
  okCells,
  totalOpenSlots,
}: StepConfirmProps) {
  const tight = okCells < totals.totalKoma * 2;
  const excludedLines = lines.filter((l) => l.unitPrice == null);

  return (
    <div className="space-y-3">
      {excludedLines.length > 0 && (
        <div className="rounded-lg border border-danger bg-danger-subtle p-3 flex gap-2">
          <AlertCircle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
          <p className="text-xs text-[var(--headline)] leading-relaxed">
            {excludedLines.map((l) => l.subjectName).join('・')}
            は単価が未設定のため、オンライン申込の対象外です。教室までご確認ください。
          </p>
        </div>
      )}

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
          <p className="text-[10px] text-[var(--paragraph)]">
            税込。期間中の通常授業ぶんはお月謝に含まれるため、講習費からは差し引いています。
          </p>
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

      <div className="rounded-xl border border-[var(--stroke)] px-3 py-2.5 flex items-center justify-between">
        <span className="text-sm text-[var(--headline)]">通える枠</span>
        <span className="text-sm font-semibold text-[var(--headline)] tabular-nums">
          {okCells}枠{' '}
          <span className="text-xs font-normal text-[var(--paragraph)]">
            / 全{totalOpenSlots}枠
          </span>
        </span>
      </div>

      {tight && (
        <div className="rounded-lg border border-warning bg-warning-subtle p-3 flex gap-2">
          <AlertCircle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
          <p className="text-xs text-[var(--headline)]">
            通える枠が申込コマ数に対して少なめです。ご希望どおりに組めない場合があります。
          </p>
        </div>
      )}

      <p className="text-[11px] text-[var(--paragraph)]">
        送信後の変更は教室までご連絡ください。日程は教室で組み、決まり次第お知らせします。
      </p>
    </div>
  );
}
