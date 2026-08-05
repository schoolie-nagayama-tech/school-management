'use client';

/**
 * ステップ1: 申込内容（個別）。
 * モック `apply-mock` の StepSubjects を本実装へ移植。
 * 提案書由来の科目はコマ数のみ増減可能（形式は教室が決めた値の表示のみ。決定14）。
 * 提案外の科目は保護者が科目・形式（1対1/1対2・45分/90分）を選んで追加できる（決定25・48）。
 */
import { useState } from 'react';
import { Minus, Plus, AlertCircle } from 'lucide-react';
import type { ApplyAddableSubject, ApplyDuration, ApplyRatio } from '@/types/koushu-apply';
import { chargeableKoma } from '@/types/koushu-apply';
import { yen } from './koushuApplyClientUtils';
import type { ApplyLineView } from './KoushuApplyForm';

interface StepSubjectsProps {
  lines: ApplyLineView[];
  komaBySubject: Record<string, number>;
  bumpKoma: (subjectId: string, delta: number) => void;
  addableSubjects: ApplyAddableSubject[];
  addedSubjectIds: string[];
  addSubject: (subjectId: string) => void;
  removeSubject: (subjectId: string) => void;
  setSubjectFormat: (
    subjectId: string,
    patch: Partial<{ ratio: ApplyRatio; duration: ApplyDuration }>
  ) => void;
  allow45: boolean;
  totals: { totalKoma: number; totalRegular: number; totalChargeable: number; totalFee: number };
}

export function StepSubjects({
  lines,
  komaBySubject,
  bumpKoma,
  addableSubjects,
  addedSubjectIds,
  addSubject,
  removeSubject,
  setSubjectFormat,
  allow45,
  totals,
}: StepSubjectsProps) {
  const [picking, setPicking] = useState(false);
  const addable = addableSubjects.filter((s) => !addedSubjectIds.includes(s.subjectId));

  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--paragraph)]">
        教室からの提案です。コマ数を確認して、変更があれば増減してください。
      </p>

      {lines.map((line) => {
        const n = line.unitPrice == null ? 0 : (komaBySubject[line.subjectId] ?? 0);
        const subjectDef = addableSubjects.find((s) => s.subjectId === line.subjectId);
        const ratiosToShow = ([2, 1] as ApplyRatio[]).filter((r) =>
          (subjectDef?.options ?? []).some((o) => o.ratio === r)
        );
        const durationsToShow = ([90, 45] as ApplyDuration[]).filter((d) =>
          (subjectDef?.options ?? []).some((o) => o.ratio === line.ratio && o.duration === d)
        );

        return (
          <div
            key={line.subjectId}
            className={`rounded-xl border p-3 ${
              line.addedByParent ? 'border-info bg-info-subtle' : 'border-[var(--stroke)]'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[var(--headline)] flex items-center gap-1.5">
                  {line.subjectName}
                  {line.addedByParent && (
                    <span className="text-[10px] font-normal px-1.5 py-0.5 rounded-full bg-info text-white">
                      追加
                    </span>
                  )}
                </p>
                <p className="text-[11px] text-[var(--paragraph)] truncate">
                  {line.textbookNames.length > 0
                    ? line.textbookNames.join('・')
                    : '教材は教室で選びます'}
                </p>
                {line.theme && (
                  <p className="text-[11px] text-[var(--paragraph)] mt-0.5">{line.theme}</p>
                )}
              </div>

              {line.addedByParent ? (
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <div className="flex rounded-full border border-[var(--stroke)] overflow-hidden">
                    {ratiosToShow.map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setSubjectFormat(line.subjectId, { ratio: r })}
                        className={`px-2 py-0.5 text-[10px] ${
                          line.ratio === r
                            ? 'bg-ink text-white'
                            : 'bg-white text-[var(--paragraph)]'
                        }`}
                      >
                        {r === 1 ? '1対1' : '1対2'}
                      </button>
                    ))}
                  </div>
                  {allow45 && durationsToShow.length > 0 && (
                    <div className="flex rounded-full border border-[var(--stroke)] overflow-hidden">
                      {durationsToShow.map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setSubjectFormat(line.subjectId, { duration: d })}
                          className={`px-2 py-0.5 text-[10px] ${
                            line.duration === d
                              ? 'bg-ink text-white'
                              : 'bg-white text-[var(--paragraph)]'
                          }`}
                        >
                          {d}分
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex gap-1 shrink-0">
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                      line.ratio === 1
                        ? 'bg-warning-subtle text-warning'
                        : 'bg-gray-100 text-[var(--paragraph)]'
                    }`}
                  >
                    {line.ratio === 1 ? '1対1' : '1対2'}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-[var(--paragraph)]">
                    {line.duration}分
                  </span>
                </div>
              )}
            </div>

            {line.unitPrice == null ? (
              // 単価表に組み合わせが無い＝オンライン申込の対象外（送信時もこの科目は除外する）
              <div className="mt-2 rounded-lg border border-danger bg-danger-subtle px-2.5 py-2 flex gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 text-danger shrink-0 mt-0.5" />
                <p className="text-[11px] text-[var(--headline)] leading-relaxed">
                  この形式は単価が未設定のため、オンラインではお申込みいただけません。教室までご確認ください。
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-[var(--stroke)]">
                  <div>
                    {!line.addedByParent && (
                      <p className="text-xs text-[var(--paragraph)]">{`提案 ${line.proposedKoma}コマ`}</p>
                    )}
                    <p className="text-[11px] text-[var(--paragraph)] mt-0.5">
                      1コマ {yen(line.unitPrice)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => bumpKoma(line.subjectId, -1)}
                      className="w-9 h-9 rounded-full border border-[var(--stroke)] bg-white flex items-center justify-center active:scale-95"
                      aria-label={`${line.subjectName}を1コマ減らす`}
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                    <span className="w-10 text-center text-lg font-semibold text-[var(--headline)] tabular-nums">
                      {n}
                    </span>
                    <button
                      type="button"
                      onClick={() => bumpKoma(line.subjectId, 1)}
                      className="w-9 h-9 rounded-full border border-[var(--stroke)] bg-white flex items-center justify-center active:scale-95"
                      aria-label={`${line.subjectName}を1コマ増やす`}
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="mt-2 pt-2 border-t border-[var(--stroke)] space-y-1">
                  {line.regularKoma > 0 && (
                    <div className="flex items-center justify-between text-[11px] text-[var(--paragraph)]">
                      <span>うち通常授業（月謝に含む）</span>
                      <span className="tabular-nums">−{Math.min(n, line.regularKoma)}コマ</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-[var(--paragraph)]">
                      講習費の対象 {chargeableKoma(n, line.regularKoma)}コマ
                    </span>
                    <span className="text-sm text-[var(--headline)] tabular-nums">
                      {yen(chargeableKoma(n, line.regularKoma) * line.unitPrice)}
                    </span>
                  </div>
                </div>
              </>
            )}

            {line.addedByParent && (
              <button
                type="button"
                onClick={() => removeSubject(line.subjectId)}
                className="mt-2 w-full py-1.5 rounded-lg border border-[var(--stroke)] bg-white text-[11px] text-[var(--paragraph)]"
              >
                この科目をやめる
              </button>
            )}
          </div>
        );
      })}

      {addable.length > 0 &&
        (picking ? (
          <div className="rounded-xl border border-[var(--stroke)] p-3">
            <p className="text-xs text-[var(--headline)] mb-2">追加する科目を選んでください</p>
            <div className="flex flex-wrap gap-1.5">
              {addable.map((s) => (
                <button
                  key={s.subjectId}
                  type="button"
                  onClick={() => {
                    addSubject(s.subjectId);
                    setPicking(false);
                  }}
                  className="px-3 py-2 rounded-lg border border-[var(--stroke)] text-sm text-[var(--headline)] active:scale-95"
                >
                  {s.subjectName}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setPicking(false)}
              className="mt-2 w-full py-1.5 text-[11px] text-[var(--paragraph)]"
            >
              やめる
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setPicking(true)}
            className="w-full py-2.5 rounded-xl border border-dashed border-[var(--stroke)] text-sm text-[var(--headline)] flex items-center justify-center gap-1"
          >
            <Plus className="w-4 h-4" />
            他の科目も追加する
          </button>
        ))}

      <div className="rounded-xl bg-gray-50 p-3 space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-sm text-[var(--headline)]">合計コマ数</span>
          <span className="text-base font-semibold text-[var(--headline)] tabular-nums">
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
          <span className="text-sm text-[var(--headline)]">講習費</span>
          <span className="text-lg font-semibold text-[var(--headline)] tabular-nums">
            {yen(totals.totalFee)}
          </span>
        </div>
        <p className="text-[10px] text-[var(--paragraph)]">
          税込。期間中の通常授業ぶんはお月謝に含まれるため、講習費からは差し引いています。
        </p>
      </div>
    </div>
  );
}
