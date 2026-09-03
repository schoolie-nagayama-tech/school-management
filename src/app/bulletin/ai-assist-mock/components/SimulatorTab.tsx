'use client';

/**
 * タブ4「授業中ポップアップ（シミュレータ）」（講師視点）。★このモックの中心。
 *
 * 見せたいこと:
 *   - ポップアップは画面を塞がない小さなカードで、1回の授業に最大1件しか出ない。
 *   - 「いつ出すか」はプログラムの固定チェックポイント＋AIの判断で決まる。
 *   - 出さない判断（まだ待つ／今日は見送る）が普通に起きる。既定は出さない側に倒す。
 *   - 期限当日・超過だけはAIを介さずプログラムが強制表示する。
 *
 * 時間の進み方はスライダー（0〜80分）で手動。実物は授業の経過時間で自動に進む。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, Check, Cpu, MessageSquare, SkipForward, X } from 'lucide-react';
import {
  BLOCK_REASONS,
  CHECKPOINTS,
  LESSON_LENGTH_MIN,
  NAISHIN_SCORES,
  NAISHIN_SUBJECTS,
  SCENARIOS,
  SIM_STUDENT,
  type AiCallEntry,
  type ScenarioId,
} from '../data';
import { Note, Panel, Pill } from './parts';

/** ポップアップの中の表示段階 */
type PopupMode =
  | 'card' // 最初の一言＋2ボタン
  | 'form' // 「入力する」を押して内申ミニフォームを開いた
  | 'saved' // ミニフォームを保存した（モックなので保存はしない）
  | 'reason' // 「今日はできない」を押して理由チップを出した
  | 'sent' // 理由を選んで室長に伝えた
  | 'closed'; // 閉じた

export function SimulatorTab() {
  const [scenarioId, setScenarioId] = useState<ScenarioId>('B');
  const [minutes, setMinutes] = useState(0);
  const [popupMode, setPopupMode] = useState<PopupMode>('card');
  /** 内申ミニフォームの入力値。既存の値は出さない仕様なので、初期状態は必ず空 */
  const [naishin, setNaishin] = useState<Record<string, number>>({});
  const [chosenReason, setChosenReason] = useState<string | null>(null);

  const scenario = useMemo(
    () => SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0],
    [scenarioId]
  );

  // ポップアップが出ているか（プログラムが決めた表示分を過ぎたか）
  const popupVisible = scenario.popupAt !== null && minutes >= scenario.popupAt;

  // 時間を巻き戻して非表示に戻ったら、ポップアップの中の状態も初期化する
  useEffect(() => {
    if (!popupVisible) {
      setPopupMode('card');
      setNaishin({});
      setChosenReason(null);
    }
  }, [popupVisible]);

  // シナリオを切り替えたら、ポップアップの中の状態を必ず初期化する
  useEffect(() => {
    setPopupMode('card');
    setNaishin({});
    setChosenReason(null);
  }, [scenarioId]);

  /** 経過分まででプログラムが動いたログ */
  const programLog = scenario.program.filter((e) => e.at <= minutes);
  /** 経過分まででAIを呼んだ記録 */
  const aiCalls = scenario.aiCalls.filter((c) => c.at <= minutes);

  /** 次のチェックポイントへ進む（無ければ何もしない） */
  const goNextCheckpoint = useCallback(() => {
    const next = CHECKPOINTS.find((c) => c.at > minutes);
    setMinutes(next ? next.at : LESSON_LENGTH_MIN);
  }, [minutes]);

  const changeScenario = useCallback((id: ScenarioId) => {
    setScenarioId(id);
    setMinutes(0);
  }, []);

  const hasNextCheckpoint = CHECKPOINTS.some((c) => c.at > minutes);

  return (
    <div className="space-y-4">
      {/* シナリオ切替 */}
      <Panel title="シナリオ">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {SCENARIOS.map((s) => {
            const active = s.id === scenarioId;
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={active}
                onClick={() => changeScenario(s.id)}
                className={`rounded-lg border p-3 text-left transition-colors duration-150 active:scale-[0.98] ${
                  active ? 'border-info bg-info-subtle' : 'border-border bg-white hover:bg-surface'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                      active ? 'bg-info text-white' : 'bg-surface text-text-muted'
                    }`}
                  >
                    {s.id}
                  </span>
                  <span
                    className={`text-[12.5px] font-bold ${
                      active ? 'text-info' : 'text-text-heading'
                    }`}
                  >
                    {s.label}
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-text-muted">{s.summary}</p>
              </button>
            );
          })}
        </div>
      </Panel>

      {/* 授業経過 */}
      <Panel
        title="授業経過"
        tone="accent"
        right={
          <span>
            {minutes}分 / {LESSON_LENGTH_MIN}分
          </span>
        }
      >
        <Timeline minutes={minutes} />
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            type="range"
            min={0}
            max={LESSON_LENGTH_MIN}
            step={1}
            value={minutes}
            onChange={(e) => setMinutes(parseInt(e.target.value, 10))}
            className="min-w-[200px] flex-1"
            aria-label="授業経過（分）"
          />
          <button
            type="button"
            onClick={goNextCheckpoint}
            disabled={!hasNextCheckpoint}
            className="shrink-0 rounded-md border border-info px-3 py-1.5 text-[11.5px] font-bold text-info transition-colors duration-150 hover:bg-info-subtle active:scale-[0.97] disabled:cursor-not-allowed disabled:border-border disabled:text-text-faint disabled:hover:bg-white"
          >
            <SkipForward className="mr-1 inline h-3.5 w-3.5" />
            次のチェックポイントへ
          </button>
          <button
            type="button"
            onClick={() => setMinutes(0)}
            className="shrink-0 rounded-md border border-border px-3 py-1.5 text-[11.5px] font-bold text-text-muted transition-colors duration-150 hover:bg-surface active:scale-[0.97]"
          >
            0分に戻す
          </button>
        </div>
      </Panel>

      {/* 授業画面 ＋ 判定パネル */}
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        {/* 授業画面（簡略化した報告書×進行表フォーム。入力欄はすべてダミー） */}
        <Panel title="授業画面（報告書×進行表フォーム・簡略）">
          <div className="relative min-h-[420px] rounded-lg border border-border bg-surface/40 p-3">
            <div className="rounded-md bg-ink px-3 py-2 text-white">
              <div className="text-[10px] uppercase tracking-wide opacity-70">
                2026-07-31 {SIM_STUDENT.slot} {SIM_STUDENT.time}
              </div>
              <div className="mt-0.5 text-base font-bold">
                {SIM_STUDENT.name}
                <span className="ml-1 text-xs font-normal opacity-80">
                  （{SIM_STUDENT.grade}・{SIM_STUDENT.subject}）
                </span>
              </div>
            </div>

            <div className="mt-3 space-y-3">
              <DummyField label="今日の目標">
                <input
                  type="text"
                  disabled
                  placeholder="例: 一次関数の変化の割合を説明できる"
                  className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-text-faint"
                />
              </DummyField>
              <DummyField label="本日の指導範囲">
                <div className="flex flex-wrap gap-1.5">
                  {['一次関数のグラフ', '変化の割合', '式の決定'].map((u) => (
                    <span
                      key={u}
                      className="rounded-full border border-border bg-white px-2.5 py-1 text-[11.5px] font-semibold text-text-muted"
                    >
                      {u}
                    </span>
                  ))}
                </div>
              </DummyField>
              <DummyField label="宿題・演習">
                <input type="range" min={0} max={100} step={5} disabled className="w-full" />
              </DummyField>
              <DummyField label="講評">
                <textarea
                  rows={4}
                  disabled
                  placeholder="5行程度で記入"
                  className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-text-faint"
                />
              </DummyField>
            </div>

            {/* ポップアップ（画面右下・モーダルにしない） */}
            {popupVisible && popupMode !== 'closed' && (
              <AssistPopup
                message={scenario.popupMessage}
                forced={scenario.popupForced}
                mode={popupMode}
                naishin={naishin}
                chosenReason={chosenReason}
                onOpenForm={() => setPopupMode('form')}
                onOpenReason={() => setPopupMode('reason')}
                onPickScore={(subject, score) =>
                  setNaishin((prev) => ({ ...prev, [subject]: score }))
                }
                onSave={() => setPopupMode('saved')}
                onPickReason={(reason) => {
                  setChosenReason(reason);
                  setPopupMode('sent');
                }}
                onClose={() => setPopupMode('closed')}
              />
            )}

            {!popupVisible && (
              <div className="pointer-events-none absolute bottom-3 right-3 rounded-md border border-dashed border-border bg-white/70 px-3 py-2 text-[11px] text-text-faint">
                いまはポップアップなし
              </div>
            )}
          </div>
          <Note>
            入力欄はすべてダミーです。ポップアップが画面右下の小さなカードであること（モーダルで塞がないこと）を見るための枠です。
          </Note>
        </Panel>

        {/* 右カラム: 2つのパネル */}
        <div className="space-y-4">
          <Panel title="プログラムの判定" icon={<Cpu className="h-3.5 w-3.5" />}>
            {programLog.length === 0 ? (
              <Note>まだ何も動いていません。スライダーを0分（起動）まで進めてください。</Note>
            ) : (
              <ol className="space-y-1.5">
                {programLog.map((e, i) => (
                  <li key={`${e.at}-${i}`} className="flex gap-2">
                    <span className="mt-0.5 shrink-0 rounded bg-surface px-1.5 py-0.5 text-[10.5px] font-bold tabular-nums text-text-muted">
                      {e.at}分
                    </span>
                    <span className="text-[12px] leading-relaxed text-text-body">{e.text}</span>
                  </li>
                ))}
              </ol>
            )}
          </Panel>

          <Panel title="AIの判断" tone="accent" icon={<Bot className="h-3.5 w-3.5" />}>
            {aiCalls.length === 0 ? (
              <div className="space-y-2">
                <Pill tone="muted">AI呼び出しなし</Pill>
                <Note>
                  {scenario.popupForced
                    ? '期限当日のため、AIを呼ばずにプログラムが強制表示しています。'
                    : '未対応が残っているときだけAIを呼びます。ここまでの経過では呼んでいません。'}
                </Note>
              </div>
            ) : (
              <div className="space-y-3">
                {aiCalls.map((call, i) => (
                  <AiCallCard key={`${call.at}-${i}`} call={call} />
                ))}
              </div>
            )}
          </Panel>

          <div className="rounded-md border border-border bg-surface px-3 py-2">
            <p className="text-[11px] leading-relaxed text-text-muted">
              既定は出さない側に倒します（誤爆より見逃し）。迷ったら「まだ待つ」「今日は見送る」を選ばせます。
            </p>
          </div>
        </div>
      </div>

      {/* シナリオごとの注記 */}
      <div className="rounded-md border border-info/40 bg-info-subtle px-3 py-2">
        <p className="text-[11.5px] font-semibold text-info">
          シナリオ{scenario.id}: {scenario.footnote}
        </p>
      </div>
    </div>
  );
}

/* ============================================================
 * タイムライン
 * ========================================================== */

/** 0〜80分のバーにチェックポイントのマーカーを置く */
function Timeline({ minutes }: { minutes: number }) {
  const pct = Math.round((minutes / LESSON_LENGTH_MIN) * 100);
  return (
    <div>
      <div className="relative h-2.5 w-full rounded-full bg-surface">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-info/50 transition-[width] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]"
          style={{ width: `${pct}%` }}
        />
        {CHECKPOINTS.map((c) => {
          const passed = minutes >= c.at;
          return (
            <span
              key={c.at}
              className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white ${
                passed ? 'bg-info' : 'bg-border'
              }`}
              style={{ left: `${(c.at / LESSON_LENGTH_MIN) * 100}%` }}
            />
          );
        })}
      </div>
      {/* マーカーの説明は縦に並べる（バー上に置くと重なって読めなくなるため） */}
      <ul className="mt-3 space-y-1">
        {CHECKPOINTS.map((c) => {
          const passed = minutes >= c.at;
          return (
            <li key={c.at} className="flex items-center gap-2">
              <span
                className={`w-10 shrink-0 rounded px-1.5 py-0.5 text-center text-[10.5px] font-bold tabular-nums ${
                  passed ? 'bg-info text-white' : 'bg-surface text-text-faint'
                }`}
              >
                {c.at}分
              </span>
              <span
                className={`text-[12px] font-bold ${passed ? 'text-text-heading' : 'text-text-faint'}`}
              >
                {c.label}
              </span>
              <span className="text-[11px] text-text-faint">{c.note}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ============================================================
 * ポップアップ
 * ========================================================== */

function AssistPopup({
  message,
  forced,
  mode,
  naishin,
  chosenReason,
  onOpenForm,
  onOpenReason,
  onPickScore,
  onSave,
  onPickReason,
  onClose,
}: {
  message: string;
  forced: boolean;
  mode: PopupMode;
  naishin: Record<string, number>;
  chosenReason: string | null;
  onOpenForm: () => void;
  onOpenReason: () => void;
  onPickScore: (subject: string, score: number) => void;
  onSave: () => void;
  onPickReason: (reason: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute bottom-3 right-3 w-[300px] rounded-lg border border-info/50 bg-white shadow-lg">
      <div className="flex items-center gap-1.5 rounded-t-lg bg-info-subtle px-3 py-1.5">
        <MessageSquare className="h-3.5 w-3.5 text-info" />
        <span className="text-[10.5px] font-bold tracking-wide text-info">NESTからの確認</span>
        {forced && (
          <span className="rounded-full bg-warning-subtle px-1.5 py-0.5 text-[9.5px] font-bold text-warning">
            期限当日
          </span>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="閉じる"
          className="ml-auto text-text-muted transition-colors duration-150 hover:text-text-heading"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="p-3">
        {/* 最初の一言＋2ボタン */}
        {mode === 'card' && (
          <>
            <p className="text-[12.5px] leading-relaxed text-text-body">{message}</p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={onOpenForm}
                className="flex-1 rounded-md bg-info px-2 py-1.5 text-[11.5px] font-bold text-white transition-opacity duration-150 hover:opacity-90 active:scale-[0.97]"
              >
                入力する
              </button>
              <button
                type="button"
                onClick={onOpenReason}
                className="flex-1 rounded-md border border-border px-2 py-1.5 text-[11.5px] font-bold text-text-muted transition-colors duration-150 hover:bg-surface active:scale-[0.97]"
              >
                今日はできない
              </button>
            </div>
          </>
        )}

        {/* 内申ミニフォーム。カードの中でそのまま入力できる（別画面に飛ばさない） */}
        {mode === 'form' && (
          <>
            <p className="mb-2 text-[11px] font-bold text-text-muted">
              1学期の内申（5教科）
              <span className="ml-1 font-medium text-text-faint">既存の値は表示しません</span>
            </p>
            <div className="space-y-1.5">
              {NAISHIN_SUBJECTS.map((subject) => (
                <div key={subject} className="flex items-center gap-1.5">
                  <span className="w-8 shrink-0 text-[11.5px] font-semibold text-text-body">
                    {subject}
                  </span>
                  {NAISHIN_SCORES.map((score) => {
                    const on = naishin[subject] === score;
                    return (
                      <button
                        key={score}
                        type="button"
                        aria-pressed={on}
                        onClick={() => onPickScore(subject, score)}
                        className={`h-7 flex-1 rounded border text-[11.5px] font-bold tabular-nums transition-colors duration-150 active:scale-[0.95] ${
                          on
                            ? 'border-info bg-info text-white'
                            : 'border-border bg-white text-text-muted hover:bg-surface'
                        }`}
                      >
                        {score}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={onSave}
              className="mt-3 w-full rounded-md bg-info px-2 py-1.5 text-[11.5px] font-bold text-white transition-opacity duration-150 hover:opacity-90 active:scale-[0.97]"
            >
              保存する
            </button>
          </>
        )}

        {mode === 'saved' && (
          <div className="flex items-start gap-2">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            <div>
              <p className="text-[12.5px] font-bold text-text-heading">入力しました</p>
              <p className="mt-0.5 text-[11px] text-text-faint">
                モックなので保存されません。実物はここで進捗ボードが「済」に変わります。
              </p>
            </div>
          </div>
        )}

        {/* 「今日はできない」の理由チップ */}
        {mode === 'reason' && (
          <>
            <p className="mb-2 text-[11.5px] font-semibold text-text-body">理由を選んでください</p>
            <div className="flex flex-wrap gap-1.5">
              {BLOCK_REASONS.map((reason) => (
                <button
                  key={reason}
                  type="button"
                  onClick={() => onPickReason(reason)}
                  className="rounded-full border border-border bg-white px-2.5 py-1 text-[11.5px] font-semibold text-text-muted transition-colors duration-150 hover:bg-surface active:scale-[0.97]"
                >
                  {reason}
                </button>
              ))}
            </div>
          </>
        )}

        {mode === 'sent' && (
          <div className="flex items-start gap-2">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            <div>
              <p className="text-[12.5px] font-bold text-text-heading">室長に伝えました</p>
              <p className="mt-0.5 text-[11px] text-text-faint">
                「{chosenReason}」として進捗ボードに残ります。今日はもう出しません。
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================
 * 小物
 * ========================================================== */

/** AI呼び出し1回ぶんの記録（渡した材料・判断・理由・文面） */
function AiCallCard({ call }: { call: AiCallEntry }) {
  const decisionTone =
    call.decision === '出す'
      ? 'bg-info text-white'
      : call.decision === 'まだ待つ'
        ? 'bg-warning-subtle text-warning'
        : 'bg-surface text-text-muted';
  return (
    <div className="rounded-md border border-border bg-white p-2.5">
      <div className="flex items-center gap-2">
        <span className="rounded bg-surface px-1.5 py-0.5 text-[10.5px] font-bold tabular-nums text-text-muted">
          {call.at}分
        </span>
        <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${decisionTone}`}>
          {call.decision}
        </span>
      </div>

      <p className="mt-2 text-[10.5px] font-bold tracking-wide text-text-muted">渡した材料</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        {call.inputs.map((line) => (
          <li key={line} className="text-[11px] leading-relaxed text-text-body">
            {line}
          </li>
        ))}
      </ul>

      <p className="mt-2 text-[10.5px] font-bold tracking-wide text-text-muted">理由</p>
      <p className="text-[11px] leading-relaxed text-text-body">{call.reason}</p>

      {call.message && (
        <>
          <p className="mt-2 text-[10.5px] font-bold tracking-wide text-text-muted">生成した文面</p>
          <p className="rounded bg-info-subtle px-2 py-1 text-[11px] leading-relaxed text-info">
            {call.message}
          </p>
        </>
      )}
    </div>
  );
}

/** 授業画面のダミー入力欄（ラベル＋中身） */
function DummyField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="mb-1 block text-[11px] font-bold text-text-muted">{label}</span>
      {children}
    </div>
  );
}
