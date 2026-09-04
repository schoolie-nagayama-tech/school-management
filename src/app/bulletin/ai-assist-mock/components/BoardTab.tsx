'use client';

/**
 * タブ2「進捗ボード」（教室長視点）。
 *
 * 見せたいこと:
 *   - 依頼を投げっぱなしにせず、済／未済がDBから自動で数えられる。
 *   - ★ 済の判定は実データ（内申が入っているか）で行う。手動チェックの数と実態は大きくズレる。
 *   - 講師別に見えるので「誰に声をかけるか」が一目でわかる。
 *   - 「今日はできない」（生徒側の事情）を未済と区別して置く。ここが督促の質を決める。
 */

import { AlertTriangle, Clock, RefreshCw } from 'lucide-react';
import {
  APPLICATION_SUMMARY,
  ASSIGNMENT_RESOLUTION_NOTE,
  NAISHIN_STUDENT_ROWS,
  NAISHIN_SUMMARY,
  NAISHIN_TEACHER_ROWS,
  type StudentProgressRow,
  type StudentTaskState,
} from '../data';
import { Note, OnOffBadge, Panel, ProgressBar } from './parts';

export function BoardTab() {
  return (
    <div className="space-y-4">
      {/* メインのタスク: 通知表回収 → 内申入力 */}
      <Panel
        title={NAISHIN_SUMMARY.taskTitle}
        tone="accent"
        right={
          <span className="inline-flex items-center gap-1 text-[10.5px] text-info">
            <Clock className="h-3 w-3" />
            最終計測: {NAISHIN_SUMMARY.measuredAgo}
          </span>
        }
      >
        {/* 主: 実データ（AIタスクの済判定はこちら） */}
        <SummaryHeader done={NAISHIN_SUMMARY.realDone} total={NAISHIN_SUMMARY.total} />
        <p className="mt-1 text-[11px] font-bold text-text-muted">
          実データ（内申が入力されている）
        </p>

        {/* 従: 手動チェック。教室長が今まで見ていた数字なので、比較用に小さく灰色で置く */}
        <div className="mt-3 rounded-md border border-border bg-surface px-3 py-2">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-bold tabular-nums text-text-muted">
              {NAISHIN_SUMMARY.manualChecked} / {NAISHIN_SUMMARY.total}
            </span>
            <span className="text-[11px] font-bold text-text-faint">手動チェック（申込状況）</span>
          </div>
          <ProgressBar
            done={NAISHIN_SUMMARY.manualChecked}
            total={NAISHIN_SUMMARY.total}
            className="mt-1.5 opacity-40"
          />
        </div>

        {/* 差分の強調行。ここが「督促の相手を間違えていた」ことの正体 */}
        <div className="mt-2 flex items-start gap-2 rounded-md border border-warning/50 bg-warning-subtle px-3 py-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p className="text-[12.5px] font-bold leading-relaxed text-warning">
            チェック漏れ {NAISHIN_SUMMARY.uncheckedGap}名 — 内申は入っているがチェックが付いていない
          </p>
        </div>
        <Note>
          教室長はこの手動チェックを見て督促を4回繰り返していましたが、講師は7割やっていました。済の判定を実データ側に移すと、この空振りが消えます。
        </Note>

        {/* 講師別内訳 */}
        <h3 className="mb-2 mt-5 text-[11px] font-bold tracking-wide text-text-muted">
          講師別の内訳
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[460px] text-[12.5px]">
            <thead>
              <tr className="border-b border-border text-[10.5px] font-bold text-text-muted">
                <th className="px-2 py-1.5 text-left">講師</th>
                <th className="px-2 py-1.5 text-right">担当</th>
                <th className="px-2 py-1.5 text-right">済（実データ）</th>
                <th className="px-2 py-1.5 text-right">未済</th>
                <th className="px-2 py-1.5 text-center">AIアシスト</th>
              </tr>
            </thead>
            <tbody>
              {NAISHIN_TEACHER_ROWS.map((row) => {
                const todo = row.assigned - row.done;
                return (
                  <tr key={row.id} className="border-b border-border last:border-b-0">
                    <td className="px-2 py-1.5 font-semibold text-text-heading">{row.name}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-text-body">
                      {row.assigned}名
                    </td>
                    <td className="px-2 py-1.5 text-right font-bold tabular-nums text-success">
                      {row.done}名
                    </td>
                    {/* 未済が多い講師ほど目立つように色を変える（0名なら落ち着かせる） */}
                    <td
                      className={`px-2 py-1.5 text-right font-bold tabular-nums ${
                        todo > 0 ? 'text-warning' : 'text-text-faint'
                      }`}
                    >
                      {todo}名
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <OnOffBadge on={row.aiAssist} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Note>{ASSIGNMENT_RESOLUTION_NOTE}</Note>
        <Note>
          「済」は実データ（内申が入力されている）で数えます。AIアシストがOFFの講師にもポップアップは出ませんが、進捗ボードには同じように載ります。
        </Note>

        {/* 生徒別 */}
        <h3 className="mb-2 mt-5 text-[11px] font-bold tracking-wide text-text-muted">
          生徒別（抜粋10名）
        </h3>
        <div className="space-y-1">
          {NAISHIN_STUDENT_ROWS.map((s) => (
            <StudentRow key={s.id} row={s} />
          ))}
        </div>
        <Note>
          「済（チェック漏れ）」は実データは入っているのに手動チェックだけ付いていない生徒。督促ではなくチェックを付けるだけで片付きます。
        </Note>
        <Note>
          「今日はできない」は、講師がポップアップで理由を返したもの。未済とは分けて置き、督促の対象から外します。
        </Note>
      </Panel>

      {/* 2つ目のタスクは小さく */}
      <Panel
        title={APPLICATION_SUMMARY.taskTitle}
        right={
          <span className="inline-flex items-center gap-1 text-[10.5px] text-text-muted">
            <RefreshCw className="h-3 w-3" />
            最終計測: {APPLICATION_SUMMARY.measuredAgo}
          </span>
        }
      >
        <SummaryHeader done={APPLICATION_SUMMARY.done} total={APPLICATION_SUMMARY.total} compact />
        <Note>
          同じ投稿から抽出された2件目のタスク。判定が「確認済みチェックが付いている」なので、上の「手動チェック」と同じ数になります。これ単体を進捗と読むと実態を28名ぶん見誤ります。
        </Note>
      </Panel>
    </div>
  );
}

/** 「N名中M名 完了」＋プログレスバー */
function SummaryHeader({
  done,
  total,
  compact = false,
}: {
  done: number;
  total: number;
  compact?: boolean;
}) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div>
      <div className="mb-1.5 flex items-baseline gap-2">
        <span
          className={`font-bold tabular-nums text-text-heading ${compact ? 'text-lg' : 'text-2xl'}`}
        >
          {total}名中{done}名
        </span>
        <span className="text-sm font-bold text-text-muted">完了</span>
        <span className="ml-auto text-[11px] font-bold tabular-nums text-info">{pct}%</span>
      </div>
      <ProgressBar done={done} total={total} />
    </div>
  );
}

/** 生徒1名ぶんの行（済／未／今日はできない） */
function StudentRow({ row }: { row: StudentProgressRow }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-white px-3 py-1.5">
      <StateChip state={row.state} />
      <span className="text-[12.5px] font-semibold text-text-heading">{row.name}</span>
      <span className="text-[11px] text-text-muted">{row.grade}</span>
      {row.blockedReason && (
        <span className="truncate text-[11px] text-text-faint">（{row.blockedReason}）</span>
      )}
      <span className="ml-auto shrink-0 text-[11px] text-text-faint">担当: {row.teacherName}</span>
    </div>
  );
}

/**
 * 4状態のチップ。色で「対応が要る／要らない」を分ける。
 * 「済（チェック漏れ）」は督促不要なので、未（警告色）ではなく情報色で置く。
 */
function StateChip({ state }: { state: StudentTaskState }) {
  const map: Record<StudentTaskState, { label: string; className: string }> = {
    done: { label: '済', className: 'bg-success-subtle text-success' },
    done_unchecked: { label: '済（チェック漏れ）', className: 'bg-info-subtle text-info' },
    todo: { label: '未', className: 'bg-warning-subtle text-warning' },
    blocked: { label: '今日はできない', className: 'bg-surface text-text-muted' },
  };
  const { label, className } = map[state];
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full px-2 py-0.5 text-[10.5px] font-bold ${className}`}
    >
      {label}
    </span>
  );
}
