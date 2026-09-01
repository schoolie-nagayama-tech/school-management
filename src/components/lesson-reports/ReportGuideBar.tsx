'use client';

/**
 * 報告書の「ゆるいガイド」バー
 *
 * 正典: docs/lesson-report-flow-plan.md §3。
 *
 * ★ 拘束しない案内役に徹する:
 *   入力UIはここに作らない（フォーム本体で書く）。このバーは
 *   「次の未完了の質問」と進捗を出し、その欄まで連れて行くだけ。
 *   講師が順番どおりに書かなくても邪魔をしない（バーが指す先が変わるだけ）。
 *
 * ★ 提出前チェック（フッター）はこのバーとは独立。バーを×で消しても従来どおり動く。
 */

import { Check, ChevronRight, Compass, Send, X } from 'lucide-react';
import type { GuideStepState } from '@/lib/lesson-reports/guideSteps';
import { nextPendingStep } from '@/lib/lesson-reports/guideSteps';

interface ReportGuideBarProps {
  steps: GuideStepState[];
  /** 質問のセクションへスクロールする（targetId は DOM の id） */
  onJump: (targetId: string) => void;
  /** 「該当なし」等を押したときに、そのステップを手動で済にする */
  onManualDone: (id: string) => void;
  /** ×（このバーを閉じる。localStorage に記憶される） */
  onDismiss: () => void;
  /** 全問済みのときの「提出へ」 */
  onSubmitJump: () => void;
}

export function ReportGuideBar({
  steps,
  onJump,
  onManualDone,
  onDismiss,
  onSubmitJump,
}: ReportGuideBarProps) {
  // 答える対象が無い質問（skipped）は分母から外す。「宿題行が無いのに10問中」と出さない
  const countedSteps = steps.filter((s) => s.status !== 'skipped');
  const current = nextPendingStep(steps);
  const currentNumber = current ? countedSteps.findIndex((s) => s.id === current.id) + 1 : 0;

  return (
    // ★ 固定位置を top-11 にしているのは、既存の「今日の指導範囲」スティッキーバーが
    //   top-0 / z-30 に出るため。重ねずにその下へ並ぶようにしている。
    <div className="sticky top-11 z-20">
      <div className="rounded-lg border border-border bg-surface-raised px-3 py-2 shadow-sm">
        <div className="flex items-center gap-2">
          <Compass className="h-3.5 w-3.5 shrink-0 text-info" />
          <span className="shrink-0 text-[10px] font-bold tracking-wide text-text-muted">
            {current ? `Q${currentNumber}/${countedSteps.length}` : '記入ガイド'}
          </span>
          {/* 進捗ドット: タップでその質問へ飛べる（順番に縛らないための逃げ道） */}
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
            {countedSteps.map((s) => (
              <button
                key={s.id}
                type="button"
                title={s.question}
                aria-label={s.question}
                onClick={() => onJump(s.targetId)}
                className={`h-2 w-2 rounded-full transition-colors duration-150 ${
                  s.id === current?.id
                    ? 'bg-info ring-2 ring-info/30'
                    : s.status === 'done'
                      ? 'bg-success'
                      : 'border border-border bg-transparent'
                }`}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="ガイドを閉じる"
            className="shrink-0 text-text-faint transition-colors duration-150 hover:text-text-muted"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {current ? (
            <>
              <p className="min-w-0 flex-1 text-[13px] font-bold text-text-heading">
                {current.question}
              </p>
              {/* 自動判定できない質問だけ「該当なし」等で先へ進める（手動の済は保存しない） */}
              {current.manualDoneLabel && (
                <button
                  type="button"
                  onClick={() => onManualDone(current.id)}
                  className="shrink-0 rounded-md border border-border px-2.5 py-1 text-[11px] font-bold text-text-muted transition-colors duration-150 hover:bg-surface active:scale-[0.97]"
                >
                  <Check className="mr-1 inline h-3 w-3" />
                  {current.manualDoneLabel}
                </button>
              )}
              <button
                type="button"
                onClick={() => onJump(current.targetId)}
                className="shrink-0 rounded-md border border-info bg-info-subtle px-2.5 py-1 text-[11px] font-bold text-info transition-colors duration-150 hover:bg-info/10 active:scale-[0.97]"
              >
                ここに答える
                <ChevronRight className="ml-0.5 inline h-3 w-3" />
              </button>
            </>
          ) : (
            <>
              <p className="min-w-0 flex-1 text-[13px] font-bold text-success">
                書き終わりました。あとは提出だけです
              </p>
              <button
                type="button"
                onClick={onSubmitJump}
                className="shrink-0 rounded-md border border-success bg-success-subtle px-2.5 py-1 text-[11px] font-bold text-success transition-colors duration-150 hover:bg-success/10 active:scale-[0.97]"
              >
                <Send className="mr-1 inline h-3 w-3" />
                提出へ
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
