'use client';

/**
 * タブ5「仕組み」。
 *
 * 見せたいこと:
 *   - AIに任せるのは「投稿文の読み取り」と「出すタイミング・一言の文面」だけ。
 *   - 済／未済の判定も、表示の上限も、期限の強制もプログラム側で決め打つ。
 *   - だからコストが読める（未対応が無いコマではAIを呼ばない）。
 */

import { Bot, Coins, Cpu } from 'lucide-react';
import { COST_NOTES, FLOW_STEPS, RESPONSIBILITY_TABLE } from '../data';
import { Note, Panel } from './parts';

export function HowItWorksTab() {
  return (
    <div className="space-y-4">
      {/* 縦のステップ表示 */}
      <Panel title="流れ">
        <ol className="space-y-0">
          {FLOW_STEPS.map((step, i) => {
            const isLast = i === FLOW_STEPS.length - 1;
            const isAi = step.actor === 'ai';
            return (
              <li key={step.title} className="flex gap-3">
                {/* 左のレール（番号＋縦線）。AIの担当だけ色を変える */}
                <div className="flex flex-col items-center">
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11.5px] font-bold ${
                      isAi ? 'bg-info text-white' : 'bg-surface text-text-muted'
                    }`}
                  >
                    {i + 1}
                  </span>
                  {!isLast && <span className="w-px flex-1 bg-border" />}
                </div>
                <div className={isLast ? 'pb-0' : 'pb-4'}>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13px] font-bold text-text-heading">{step.title}</span>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        isAi ? 'bg-info-subtle text-info' : 'bg-surface text-text-muted'
                      }`}
                    >
                      {isAi ? <Bot className="h-3 w-3" /> : <Cpu className="h-3 w-3" />}
                      {isAi ? 'AI' : 'プログラム'}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-text-body">{step.detail}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </Panel>

      {/* 責任分界の2列表 */}
      <Panel title="プログラムが決めること / AIが決めること" tone="accent">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[460px] text-[12px]">
            <thead>
              <tr className="border-b border-border text-[10.5px] font-bold text-text-muted">
                <th className="px-2 py-1.5 text-left">
                  <Cpu className="mr-1 inline h-3 w-3" />
                  プログラムが決めること
                </th>
                <th className="px-2 py-1.5 text-left">
                  <Bot className="mr-1 inline h-3 w-3" />
                  AIが決めること
                </th>
              </tr>
            </thead>
            <tbody>
              {RESPONSIBILITY_TABLE.map((row) => (
                <tr key={row.program} className="border-b border-border last:border-b-0">
                  <td className="px-2 py-2 align-top leading-relaxed text-text-body">
                    {row.program}
                  </td>
                  <td className="px-2 py-2 align-top leading-relaxed text-text-body">{row.ai}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Note>
          AIに数を数えさせない、上限を決めさせない、期限を判断させない。ここを分けておくと、挙動が読めて検証もできます。
        </Note>
      </Panel>

      {/* コスト目安 */}
      <Panel title="コスト目安" icon={<Coins className="h-3.5 w-3.5" />}>
        <ul className="list-disc space-y-1 pl-5 text-[12.5px] leading-relaxed text-text-body">
          {COST_NOTES.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
