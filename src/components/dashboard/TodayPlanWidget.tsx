'use client';

/**
 * ダッシュボード「今日の段取り」ウィジェット。
 * ------------------------------------------------------------------
 * すぐ下の「今日やること」が一覧なのに対し、こちらは**時間帯への割り付け**。
 * 授業前／各コマ／片付け／明日以降 に置き、21:30 に収まらないものは外へ出す。
 *
 * ★出てくるのは読み物ではなくタスク。チェック・書き換え・移動・削除・追加ができ、
 *   直した結果が正典。AIが出すのは案で、決めるのは教室長。
 *
 * ★材料はすぐ下の「今日やること」そのもの（props の todos）。ここで用事を集め直さない。
 *   別々に集めると、同じ画面の上と下で違う用事が並ぶ（2026-09-09 決定）。
 *
 * ★組むのは1日1回。すでに組んだ日は「組む」ボタンを出さない。
 *   組み直すと、手で直した並び・消した項目・書き換えた本文が全部消える。
 *   日中に増えた用事は上の入力欄から足す（AIは入れ場所だけ決める）。
 *
 * ★教室が1つだけ選ばれているときだけ出す。
 *   コマの時刻も授業も教室ごとに違うので、複数校ぶんを1本の時間割に混ぜられない。
 *
 * ★機能がオフの教室では、ウィジェットごと出さない（押せる形にしない＝送信が起きない）。
 *   これは AiWriteBar・HandoverDigestPanel と同じ約束。
 *
 * 正典: docs/today-plan-ai-plan.md
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, ToastContainer } from '@/components/ui';
import { useToast } from '@/hooks/useToast';
import { fetchWithAuth } from '@/lib/api/auth';
import { TODAY_PLAN_FEATURE_KEY } from '@/lib/ai/features';
import { WORK_END, WORK_START, type PlanBlock, type PlanItem } from '@/lib/ai/todayPlan';
import type { TodayTodoItem } from '@/types/today-todos';
import { CalendarClock, Check, Loader2, Plus, Sparkles, X, ArrowUp } from 'lucide-react';

/** 保存の間引き。1文字打つたびに投げると、書いている最中に何度も往復する */
const SAVE_DEBOUNCE_MS = 500;

interface PlanBlockInfo {
  key: PlanBlock;
  label: string;
}

/** ローカル時刻の 'YYYY-MM-DD'。★サーバー（UTC）で決めると日付が1日ずれる */
function localDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** ISO文字列 → 'HH:MM'。読めなければ空（「に組みました」だけ出さない） */
function toClock(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function TodayPlanWidget({
  schoolIds,
  todos,
}: {
  schoolIds: string[];
  /**
   * 下の「今日やること」が読んだ用事。★段取りの材料はこれ（ここで集め直さない）。
   * null は「まだ読めていない」。そのあいだは「組む」を押させない
   * （空のまま組むと、その日はもう組み直せない）。
   */
  todos?: TodayTodoItem[] | null;
}) {
  // ★教室は1つだけ。0件でも2件以上でも出さない
  const schoolId = schoolIds.length === 1 ? schoolIds[0] : '';

  /** 「今日やること」が読めているか。押せるのはこれが true のときだけ */
  const todosReady = Array.isArray(todos);

  const { toasts, removeToast, error: toastError } = useToast();

  // 日付はクライアントでのみ確定させる（サーバー時刻とズレるとハイドレーションが崩れる）
  const [date, setDate] = useState<string | null>(null);
  useEffect(() => {
    setDate(localDateString(new Date()));
  }, []);

  /** この教室でAIを使えるか。null=まだ分からない */
  const [available, setAvailable] = useState<boolean | null>(null);
  const [blocks, setBlocks] = useState<PlanBlockInfo[]>([]);
  const [plan, setPlan] = useState<PlanItem[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [draft, setDraft] = useState('');

  /* --------------------------------------------------------
   * 栓（オフなら以降は何も読まない・出さない）
   * ------------------------------------------------------ */
  useEffect(() => {
    if (!schoolId) {
      setAvailable(false);
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const res = await fetchWithAuth(
          `/api/ai/feature-setting?school_id=${schoolId}&feature=${TODAY_PLAN_FEATURE_KEY}`
        );
        if (!alive) return;
        if (!res.ok) return setAvailable(false);
        const json = (await res.json()) as { enabled: boolean };
        setAvailable(json.enabled);
      } catch {
        if (alive) setAvailable(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [schoolId]);

  /* --------------------------------------------------------
   * 読み込み
   * ------------------------------------------------------ */
  useEffect(() => {
    if (available !== true || !schoolId || !date) return;
    let alive = true;
    setLoading(true);
    void (async () => {
      try {
        const res = await fetchWithAuth(`/api/today-plan?school_id=${schoolId}&date=${date}`);
        if (!alive) return;
        if (!res.ok) throw new Error('failed');
        const json = (await res.json()) as {
          plan: PlanItem[];
          generatedAt: string | null;
          blocks: PlanBlockInfo[];
        };
        setPlan(Array.isArray(json.plan) ? json.plan : []);
        setGeneratedAt(json.generatedAt);
        setBlocks(Array.isArray(json.blocks) ? json.blocks : []);
      } catch {
        if (alive) toastError('今日の段取りを読み込めませんでした');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [available, schoolId, date, toastError]);

  /* --------------------------------------------------------
   * 保存（変更のたびに丸ごと置き換え・500msデバウンス）
   * ------------------------------------------------------ */
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 保存中に state が入れ替わっても、最後の中身を送れるよう ref で持つ
  const latestRef = useRef<PlanItem[]>([]);
  latestRef.current = plan;

  const queueSave = useCallback(
    (next: PlanItem[]) => {
      latestRef.current = next;
      if (!schoolId || !date) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        void (async () => {
          try {
            const res = await fetchWithAuth('/api/today-plan', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ schoolId, date, plan: latestRef.current }),
            });
            if (!res.ok) throw new Error('failed');
          } catch {
            toastError('段取りを保存できませんでした');
          }
        })();
      }, SAVE_DEBOUNCE_MS);
    },
    [schoolId, date, toastError]
  );

  // 画面を離れるときに保留中のタイマーを片付ける
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  /** 段取りを差し替えて保存を予約する。★UIは待たない（先に描いてから送る） */
  const apply = useCallback(
    (next: PlanItem[]) => {
      setPlan(next);
      queueSave(next);
    },
    [queueSave]
  );

  const updateItem = useCallback(
    (id: string, patch: Partial<PlanItem>) => {
      apply(latestRef.current.map((i) => (i.id === id ? { ...i, ...patch } : i)));
    },
    [apply]
  );

  const removeItem = useCallback(
    (id: string) => {
      apply(latestRef.current.filter((i) => i.id !== id));
    },
    [apply]
  );

  const addItem = useCallback(
    (block: PlanBlock) => {
      // ★AIは呼ばない。押した時間帯にそのまま空行を足して、その場で書かせる
      const item: PlanItem = {
        id: crypto.randomUUID(),
        block,
        text: '',
        why: '',
        done: false,
        source: 'user',
      };
      apply([...latestRef.current, item]);
    },
    [apply]
  );

  /* --------------------------------------------------------
   * 組む（朝に1回）
   * ------------------------------------------------------ */
  const generate = async () => {
    // ★用事が読めていないうちは組ませない（空のまま組むと、その日はもう組み直せない）
    if (generating || !schoolId || !date || !todosReady) return;
    setGenerating(true);
    try {
      const res = await fetchWithAuth('/api/ai/today-plan/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schoolId, date, todos }),
      });
      if (!res.ok) throw new Error('failed');
      const json = (await res.json()) as {
        plan: PlanItem[];
        generatedAt: string | null;
        alreadyGenerated: boolean;
        degraded: boolean;
        disabled: boolean;
      };
      if (json.disabled) return setAvailable(false);
      if (json.degraded) return toastError('いまは段取りを組めませんでした');
      setPlan(Array.isArray(json.plan) ? json.plan : []);
      setGeneratedAt(json.generatedAt);
    } catch {
      toastError('いまは段取りを組めませんでした');
    } finally {
      setGenerating(false);
    }
  };

  /* --------------------------------------------------------
   * 用事を足す（入れ場所だけAIが決める）
   * ------------------------------------------------------ */
  const place = async () => {
    const text = draft.trim();
    if (!text || placing || !schoolId || !date) return;
    setPlacing(true);
    try {
      const res = await fetchWithAuth('/api/ai/today-plan/place', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // ★組むときと同じ材料を渡す（入れ場所を決めるのに今日の用事が要る）
        body: JSON.stringify({ schoolId, date, text, todos: todos ?? [] }),
      });
      if (!res.ok) throw new Error('failed');
      const json = (await res.json()) as {
        item: PlanItem | null;
        degraded: boolean;
        disabled: boolean;
      };
      if (json.disabled) return setAvailable(false);
      if (!json.item) throw new Error('empty');
      // ★サーバー側で保存済み。ここで保存し直すと入れ違いになる
      setPlan((prev) => [...prev, json.item as PlanItem]);
      setDraft('');
    } catch {
      toastError('用事を足せませんでした');
    } finally {
      setPlacing(false);
    }
  };

  /* --------------------------------------------------------
   * 表示
   * ------------------------------------------------------ */
  const grouped = useMemo(() => {
    const map = new Map<string, PlanItem[]>();
    for (const item of plan) {
      const list = map.get(item.block) ?? [];
      list.push(item);
      map.set(item.block, list);
    }
    return map;
  }, [plan]);

  const total = plan.length;
  const remaining = plan.filter((i) => !i.done).length;
  const builtAt = toClock(generatedAt);

  // ★オフ・未確定・教室が1つでないあいだは何も出さない
  if (available !== true) return null;

  return (
    <Card>
      <CardContent className="py-3">
        <ToastContainer toasts={toasts} onRemove={removeToast} />

        {/* ヘッダー */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border-subtle pb-2">
          <CalendarClock className="w-5 h-5 shrink-0 text-text-muted" />
          <h2 className="text-base font-bold text-text-heading">今日の段取り</h2>
          {total > 0 && (
            <span className="inline-flex shrink-0 items-center rounded-full bg-ink-subtle px-2.5 py-0.5 text-xs font-bold text-ink">
              残り {remaining} 件／全 {total} 件
            </span>
          )}
          <span className="ml-auto shrink-0 text-xs text-text-faint">
            {builtAt ? `${builtAt} に組みました ・ ` : ''}
            勤務 {WORK_START}〜{WORK_END}
          </span>
        </div>

        {loading && (
          <p className="flex items-center gap-1.5 py-6 text-sm text-text-muted">
            <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
            読み込み中…
          </p>
        )}

        {/* まだ組んでいない日。★ここでは「組む」だけを出す */}
        {!loading && generatedAt === null && (
          <div className="flex flex-col items-start gap-2 py-6">
            <button
              type="button"
              onClick={() => void generate()}
              disabled={generating || !todosReady}
              className="inline-flex items-center gap-1.5 rounded-full border border-ink/25 bg-surface px-3.5 py-1.5 text-xs font-medium text-ink transition-opacity disabled:opacity-40"
            >
              {generating || !todosReady ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {generating ? '組んでいます…' : '今日の段取りを組む'}
            </button>
            <p className="text-xs text-text-faint">
              {todosReady
                ? '下の「今日やること」・今日のコマ・カレンダーの予定から、時間帯への割り付けを作ります。組むのは1日1回です'
                : '今日やることの読み込みを待っています'}
            </p>
          </div>
        )}

        {/* 組んである日 */}
        {!loading && generatedAt !== null && (
          <div className="pt-3">
            {/* 増えた用事の差し込み */}
            <div className="mb-3 flex items-center gap-2">
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void place();
                  }
                }}
                placeholder="用事を足す（入れ場所はAIが決めます）"
                className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-text-body placeholder:text-text-faint"
              />
              <button
                type="button"
                onClick={() => void place()}
                disabled={placing || draft.trim().length === 0}
                aria-label="用事を足す"
                className="inline-flex shrink-0 items-center justify-center rounded-md border border-ink/25 bg-surface p-1.5 text-ink transition-opacity disabled:opacity-40"
              >
                {placing ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <ArrowUp className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>

            {/* ★空の時間帯も見出しは出す。無いことが分かって初めて「ここに置こう」ができる */}
            {blocks.map((b) => (
              <section key={b.key} className="border-t border-border-subtle py-2 first:border-t-0">
                <p className="pb-1 text-xs font-bold text-text-muted">{b.label}</p>
                {(grouped.get(b.key) ?? []).map((item) => (
                  <PlanRow
                    key={item.id}
                    item={item}
                    blocks={blocks}
                    onUpdate={updateItem}
                    onRemove={removeItem}
                  />
                ))}
                <button
                  type="button"
                  onClick={() => addItem(b.key)}
                  className="mt-1 inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-xs text-text-faint transition-colors hover:text-primary"
                >
                  <Plus className="h-3 w-3" aria-hidden="true" />
                  追加
                </button>
              </section>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ============================================================
 * 1行
 * ========================================================== */

function PlanRow({
  item,
  blocks,
  onUpdate,
  onRemove,
}: {
  item: PlanItem;
  blocks: PlanBlockInfo[];
  onUpdate: (id: string, patch: Partial<PlanItem>) => void;
  onRemove: (id: string) => void;
}) {
  /**
   * ★本文は contentEditable。value を state に持って再描画すると、
   *   打っている最中にカーソルが先頭へ飛ぶ。
   *   なので初期値だけ流し込み、blur のときにDOMから読んで保存する。
   */
  const bodyRef = useRef<HTMLSpanElement | null>(null);

  return (
    <div className="flex items-start gap-2 py-1.5">
      {/* 移動: どの時間帯へ動かすか。★ドラッグは作らない（選ぶだけで済む） */}
      <select
        value={item.block}
        onChange={(e) => onUpdate(item.id, { block: e.target.value as PlanBlock })}
        aria-label="移動先の時間帯"
        className="mt-0.5 shrink-0 rounded-md border border-border bg-surface px-1 py-0.5 text-[11px] text-text-muted"
      >
        {blocks.map((b) => (
          <option key={b.key} value={b.key}>
            {b.label}
          </option>
        ))}
      </select>

      {/* 済 */}
      <button
        type="button"
        onClick={() => onUpdate(item.id, { done: !item.done })}
        aria-pressed={item.done}
        aria-label="済にする"
        className={`mt-0.5 flex shrink-0 items-center rounded-md border p-1 transition-colors ${
          item.done
            ? 'border-success bg-success-subtle text-success'
            : 'border-border text-text-muted hover:bg-surface-hover hover:text-primary'
        }`}
      >
        <Check className="h-3.5 w-3.5" aria-hidden="true" />
      </button>

      <div className="min-w-0 flex-1">
        <span
          ref={bodyRef}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          tabIndex={0}
          onBlur={() => {
            const next = (bodyRef.current?.textContent ?? '').trim();
            if (next !== item.text) onUpdate(item.id, { text: next });
          }}
          className={`block rounded px-0.5 text-sm outline-none focus:bg-surface-hover ${
            item.done ? 'text-text-faint line-through' : 'text-text-body'
          }`}
        >
          {item.text}
        </span>
        {(item.why || item.when) && (
          <p className="mt-0.5 px-0.5 text-xs text-text-faint">
            {item.when ? `${item.when}　` : ''}
            {item.why}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={() => onRemove(item.id)}
        aria-label="この用事を消す"
        className="mt-0.5 shrink-0 rounded-md p-1 text-text-faint transition-colors hover:text-danger"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

export default TodayPlanWidget;
