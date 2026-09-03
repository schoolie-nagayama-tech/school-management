'use client';

/**
 * タブ1「投稿後のAI読み取り」（教室長視点）。
 *
 * 見せたいこと:
 *   - 投稿のやり方は今まで通り。AIの読み取りは投稿後に自動で後ろに付くだけ。
 *   - AIは13種の有限カタログから選ぶだけで、タスク名を自由に作らない。
 *   - 各タスクは「何を見て済にするか」が最初から決まっている（＝自動で進捗が出る）。
 */

import { useCallback, useState } from 'react';
import { CalendarClock, Info, Repeat, Sparkles, Users } from 'lucide-react';
import {
  DEADLINE_LEGEND,
  EXTRACTED_TASKS,
  MOCK_POST,
  RECURRENCE_NOTE,
  SCOPE_LEGEND,
  TASK_CATALOG,
  type ExtractedTask,
} from '../data';
import { Note, Panel, Pill } from './parts';

export function ExtractTab() {
  // 追跡する／しないのトグル。既定は data.ts の defaultTracked に従う
  const [tracked, setTracked] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    EXTRACTED_TASKS.forEach((t) => {
      init[t.id] = t.defaultTracked;
    });
    return init;
  });

  const toggleTracked = useCallback((id: string, next: boolean) => {
    setTracked((prev) => ({ ...prev, [id]: next }));
  }, []);

  // カタログのうち、この投稿から選ばれた種別（チップの強調に使う）
  const pickedKinds = EXTRACTED_TASKS.filter((t) => tracked[t.id]).map((t) => t.kind);

  return (
    <div className="space-y-4">
      {/* 既存の掲示板投稿カード（見た目だけ再現。編集も保存もしない） */}
      <Panel title="連絡掲示板（投稿の見た目は今まで通り）">
        <div className="rounded-lg border border-border bg-white p-3">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="shrink-0 rounded bg-info px-2 py-0.5 text-xs font-medium text-white">
                {MOCK_POST.labelName}
              </span>
              <span className="truncate font-semibold text-text-heading">{MOCK_POST.title}</span>
            </div>
            <span className="shrink-0 text-xs text-text-faint">{MOCK_POST.schoolName}</span>
          </div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-body">
            {MOCK_POST.body}
          </p>
          <div className="mt-2 flex items-center gap-2 text-[11px] text-text-faint">
            <span>{MOCK_POST.author}</span>
            <span>{MOCK_POST.postedAt}</span>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Pill tone="ink">
            <Info className="h-3 w-3" />
            投稿方法は今までと同じ。この読み取りは投稿後に自動で付きます
          </Pill>
        </div>
      </Panel>

      {/* AIが読み取ったタスク */}
      <Panel
        title="AIが読み取ったタスク"
        tone="accent"
        icon={<Sparkles className="h-3.5 w-3.5" />}
        right={<span className="text-[10.5px]">13種のカタログから選択</span>}
      >
        <div className="space-y-2">
          {EXTRACTED_TASKS.map((task) => (
            <ExtractedTaskRow
              key={task.id}
              task={task}
              tracked={tracked[task.id] ?? false}
              onChange={(next) => toggleTracked(task.id, next)}
            />
          ))}
        </div>

        {/* 再掲の検知 */}
        <div className="mt-3 flex items-start gap-2 rounded-md border border-border bg-surface px-3 py-2">
          <Repeat className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-muted" />
          <p className="text-[11.5px] font-semibold text-text-body">{RECURRENCE_NOTE}</p>
        </div>
        <Note>
          同じ依頼を何度も投稿しても、タスクは1本のまま進捗が積み上がります。締切だけが更新されます。
        </Note>
      </Panel>

      {/* カタログ全体（AIが選べる範囲を可視化する） */}
      <Panel title="タスクカタログ（この13種以外は作られない）">
        <div className="flex flex-wrap gap-1.5">
          {TASK_CATALOG.map((kind) => {
            const picked = pickedKinds.indexOf(kind) >= 0;
            return (
              <span
                key={kind}
                className={`rounded-full border px-2.5 py-1 text-[11.5px] font-semibold ${
                  picked
                    ? 'border-info bg-info text-white'
                    : 'border-border bg-white text-text-muted'
                }`}
              >
                {kind}
              </span>
            );
          })}
        </div>
        <Note>
          色が付いているのが、この投稿から選ばれた種別です。カタログを閉じているので、判定クエリと進捗の集計をあらかじめ用意できます。
        </Note>

        {/* 対象・期限も選択肢が決まっている。凡例として並べておく */}
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <h3 className="mb-1.5 text-[10.5px] font-bold tracking-wide text-text-muted">
              対象（5種）
            </h3>
            <ul className="space-y-1">
              {SCOPE_LEGEND.map((s) => (
                <li key={s.scope} className="text-[11.5px] leading-relaxed">
                  <span className="font-bold text-text-body">{s.scope}</span>
                  <span className="text-text-faint">: {s.example}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="mb-1.5 text-[10.5px] font-bold tracking-wide text-text-muted">
              期限（3種）
            </h3>
            <ul className="space-y-1">
              {DEADLINE_LEGEND.map((d) => (
                <li key={d.label} className="text-[11.5px] leading-relaxed">
                  <span className="font-bold text-text-body">{d.label}</span>
                  <span className="text-text-faint">: {d.example}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Panel>
    </div>
  );
}

/** 抽出タスク1行（種別・対象・期限・判定方法・追跡トグル） */
function ExtractedTaskRow({
  task,
  tracked,
  onChange,
}: {
  task: ExtractedTask;
  tracked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div
      className={`rounded-md border p-3 transition-colors duration-150 ${
        tracked ? 'border-info/40 bg-info-subtle/20' : 'border-border bg-surface'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-info px-2.5 py-1 text-[11.5px] font-bold text-white">
          {task.kind}
        </span>
        <Pill tone="muted">
          <Users className="h-3 w-3" />
          {task.scope}
          {task.scopeNote ? `（${task.scopeNote}）` : ''}
        </Pill>
        <Pill tone={task.deadline === '毎回' ? 'ink' : 'warning'}>
          <CalendarClock className="h-3 w-3" />
          {task.deadline === 'なし' ? '期限なし' : task.deadline}
        </Pill>

        {/* 追跡する／しない。既定は「追跡する」 */}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <TrackToggleButton label="追跡する" active={tracked} onClick={() => onChange(true)} />
          <TrackToggleButton label="追跡しない" active={!tracked} onClick={() => onChange(false)} />
        </div>
      </div>

      <div className="mt-2 grid grid-cols-[64px_1fr] gap-2 text-[11.5px]">
        <span className="font-bold text-text-muted">判定方法</span>
        <span className={tracked ? 'text-text-body' : 'text-text-faint line-through'}>
          {task.judgement}
        </span>
      </div>
    </div>
  );
}

/** 2択のトグルボタン（選択中を塗る） */
function TrackToggleButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-[11px] font-bold transition-colors duration-150 active:scale-[0.97] ${
        active
          ? 'border-ink bg-ink text-white'
          : 'border-border bg-white text-text-muted hover:bg-surface'
      }`}
    >
      {label}
    </button>
  );
}
