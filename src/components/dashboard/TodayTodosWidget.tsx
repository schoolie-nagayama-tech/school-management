'use client';

/**
 * ダッシュボード「今日やること」ウィジェット。
 * ------------------------------------------------------------------
 * 朝の1分で今日の段取りが決まる行動リスト。月次タスク・報告書・アラート・当日の座席という
 * 別々のページに散らばっている情報から「今日やる理由があるもの」だけを選別し、
 * 1項目=1行動の形で並べる。既存の「要対応アラート」「本日の授業」カードが状況表示なのに対し、
 * こちらは行動リスト（済にすれば下がる）という棲み分け。
 *
 * ★ 教室の運営の用事（欠勤・未配置・報告書・タスク）と、生徒への用事（申込の締切・面談時期など）を
 *   **種別で分けず1本のリストに混ぜる**のは意図的な仕様。教室長は「運営か生徒か」ではなく
 *   時間の流れで動くため、種別で分けると同じ時間帯の用事が2箇所に散る（2026-08-31 ユーザー判断）。
 *   代わりに時限の変わり目に見出しを挟んで、上から時間順であることが読み取れるようにする。
 *
 * 読み込みは二段構え。軽いクエリ（fetchTodayTodosLight）で即描画し、
 * 重いクエリ（fetchTodayTodosHeavy）の結果を後からマージする。
 * 軽い方が既に読めているので、重い方の待ちでカードをスケルトンで覆わない。
 *
 * 「済」は localStorage に当日分だけ保存する（サーバー保存はしない）。
 * 日付が変わればキーごと変わるので、翌日は自然に空から始まる。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui';
import { fetchTodayTodosLight, fetchTodayTodosHeavy } from '@/lib/api/todayTodos';
import {
  compareTodayTodos,
  type TodayTodoItem,
  type TodayTodoSource,
  type TodayTodoUrgency,
} from '@/types/today-todos';
import { ListTodo, Check, Loader2, AlertTriangle, RotateCw } from 'lucide-react';

/* ============================================================
 * 表示用の定数
 * ========================================================== */

type ToneKey = 'danger' | 'warning' | 'info' | 'primary';

// tone → Tailwind クラス（既存デザイントークンのみ）
const TONE: Record<ToneKey, { text: string; bg: string }> = {
  danger: { text: 'text-danger', bg: 'bg-danger-subtle' },
  warning: { text: 'text-warning', bg: 'bg-warning-subtle' },
  info: { text: 'text-info', bg: 'bg-info-subtle' },
  primary: { text: 'text-primary', bg: 'bg-primary-subtle' },
};

// 用事の出どころ → チップの色。urgency==='high' の行だけは danger で上書きする
const SOURCE_TONE: Record<TodayTodoSource, ToneKey> = {
  seat: 'info',
  student: 'primary',
  report: 'warning',
  task: 'primary',
  transfer: 'warning',
  material: 'info',
};

// 緊急度 → 左端ドットの色
const URGENCY_DOT: Record<TodayTodoUrgency, string> = {
  high: 'bg-danger',
  medium: 'bg-warning',
  low: 'bg-text-faint',
};

// 「済」の記憶に使う localStorage キーの接頭辞。日付ごとに別キーにする
const DONE_KEY_PREFIX = 'nest.todayTodos.done.';

/* ============================================================
 * 小さなユーティリティ
 * ========================================================== */

/** ローカル時刻の 'YYYY-MM-DD'。サーバー時刻（UTC）とのズレを避けるためクライアントでのみ求める */
function localDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 'YYYY-MM-DD' → '8月31日(月)' */
function formatDateLabel(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  const w = ['日', '月', '火', '水', '木', '金', '土'][date.getDay()];
  return `${m}月${d}日(${w})`;
}

/**
 * 当日分の「済」IDを読み出す。
 * ついでに別の日付のキーを掃除する（前日以前の記憶は使わないので溜めない）。
 * プライベートモード等で localStorage が触れない環境でも落ちないよう全体を try/catch する。
 */
function loadDoneIds(today: string): Set<string> {
  const key = `${DONE_KEY_PREFIX}${today}`;
  try {
    // 古い日付のキーを削除（削除中に index がずれるので、先に集めてから消す）
    const staleKeys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(DONE_KEY_PREFIX) && k !== key) staleKeys.push(k);
    }
    staleKeys.forEach((k) => window.localStorage.removeItem(k));

    const raw = window.localStorage.getItem(key);
    if (!raw) return new Set<string>();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set<string>();
    return new Set(parsed.filter((v): v is string => typeof v === 'string'));
  } catch {
    return new Set<string>();
  }
}

/** 当日分の「済」IDを保存する。失敗しても UI は動き続ける（当日中のメモリ上の状態は保つ） */
function saveDoneIds(today: string, ids: Set<string>): void {
  try {
    window.localStorage.setItem(`${DONE_KEY_PREFIX}${today}`, JSON.stringify(Array.from(ids)));
  } catch {
    // localStorage が使えない環境（プライベートモード・容量超過）では記憶をあきらめる
  }
}

/** id で重複排除しつつマージし、並び順を作り直す */
function mergeItems(base: TodayTodoItem[], incoming: TodayTodoItem[]): TodayTodoItem[] {
  const byId = new Map<string, TodayTodoItem>();
  for (const item of base.concat(incoming)) byId.set(item.id, item);
  return Array.from(byId.values()).sort(compareTodayTodos);
}

/* ============================================================
 * 本体
 * ========================================================== */

export function TodayTodosWidget({ schoolIds }: { schoolIds: string[] }) {
  // schoolIds は呼び出し側で毎レンダー新しい配列になりうるので、依存には文字列キーを使う
  const schoolIdsKey = schoolIds.join(',');

  // 日付はクライアントでのみ確定させる（サーバー時刻とズレるとハイドレーションが崩れるため）
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => {
    setToday(localDateString(new Date()));
  }, []);

  const [items, setItems] = useState<TodayTodoItem[]>([]);
  const [lightLoading, setLightLoading] = useState(true);
  const [heavyLoading, setHeavyLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  // 「再読み込み」で effect を回し直すためのカウンタ
  const [reloadCount, setReloadCount] = useState(0);

  const [doneIds, setDoneIds] = useState<Set<string>>(() => new Set<string>());

  // 当日分の「済」を復元（日付が変われば別キーなので自然に空になる）
  useEffect(() => {
    if (!today) return;
    setDoneIds(loadDoneIds(today));
  }, [today]);

  // 二段読み込み。取得中に schoolIds や日付が変わったら古い結果は捨てる
  useEffect(() => {
    if (!today) return;
    const ids = schoolIdsKey ? schoolIdsKey.split(',') : [];
    if (ids.length === 0) {
      // 教室が選ばれていないときは何も取得しない（空表示にする）
      setItems([]);
      setLightLoading(false);
      setHeavyLoading(false);
      setHasError(false);
      return;
    }

    let cancelled = false;
    setLightLoading(true);
    setHeavyLoading(false);
    setHasError(false);
    setItems([]);

    // 軽い方が終わったかどうか。重い方だけ失敗したときはエラー表示にせず既に読めた分を残す
    let lightSucceeded = false;

    (async () => {
      try {
        const light = await fetchTodayTodosLight(ids, today);
        if (cancelled) return;
        lightSucceeded = true;
        setItems([...light.items].sort(compareTodayTodos));
        setLightLoading(false);
        setHeavyLoading(true);

        const heavy = await fetchTodayTodosHeavy(
          ids,
          today,
          light.todayStudentIds,
          light.slotByStudentId
        );
        if (cancelled) return;
        setItems((prev) => mergeItems(prev, heavy));
        setHeavyLoading(false);
      } catch {
        if (cancelled) return;
        setHeavyLoading(false);
        setLightLoading(false);
        if (!lightSucceeded) setHasError(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [schoolIdsKey, today, reloadCount]);

  // 「済」の切り替え。押し間違いを戻せるよう、もう一度押すと未完了に戻る
  const toggleDone = useCallback(
    (id: string) => {
      setDoneIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        if (today) saveDoneIds(today, next);
        return next;
      });
    },
    [today]
  );

  /**
   * 表示行を組み立てる。
   * 未完了を compareTodayTodos の順に並べ、完了した行はまとめて一番下へ（消さない）。
   * 未完了の並びには時限の変わり目で見出しを挟み、時間順であることを読み取れるようにする。
   */
  const rows = useMemo(() => {
    type Row =
      | { type: 'heading'; key: string; text: string }
      | { type: 'item'; key: string; item: TodayTodoItem; done: boolean };

    const pending = items.filter((i) => !doneIds.has(i.id)).sort(compareTodayTodos);
    const done = items.filter((i) => doneIds.has(i.id)).sort(compareTodayTodos);

    const result: Row[] = [];
    let prevSlot: number | null | undefined = undefined;
    for (const item of pending) {
      const slot = item.slotNumber ?? null;
      if (slot !== prevSlot) {
        result.push({
          type: 'heading',
          key: `heading-${slot ?? 'none'}`,
          text:
            slot === null
              ? '時間の決まっていないこと'
              : `${slot}限${item.slotTime ? ` ${item.slotTime}` : ''}`,
        });
        prevSlot = slot;
      }
      result.push({ type: 'item', key: item.id, item, done: false });
    }
    if (done.length > 0) {
      result.push({ type: 'heading', key: 'heading-done', text: '済んだこと' });
      for (const item of done) result.push({ type: 'item', key: item.id, item, done: true });
    }
    return result;
  }, [items, doneIds]);

  const remaining = items.filter((i) => !doneIds.has(i.id)).length;

  return (
    <Card>
      <CardContent className="py-3">
        {/* ヘッダー: アイコン + タイトル + 今日の日付 + 残り件数バッジ */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border-subtle pb-2">
          <ListTodo className="w-5 h-5 shrink-0 text-text-muted" />
          <h2 className="text-base font-bold text-text-heading">今日やること</h2>
          <span className="text-sm text-text-muted">{today ? formatDateLabel(today) : ''}</span>
          <span className="ml-auto shrink-0 inline-flex items-center rounded-full bg-primary-subtle px-2.5 py-0.5 text-xs font-bold text-primary">
            残り{remaining}件
          </span>
        </div>

        {/* 読み込み中（軽い方も未完了）: スケルトン3行 */}
        {(lightLoading || today === null) && !hasError && (
          <div className="pt-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3 py-3">
                <span className="h-2 w-2 shrink-0 rounded-full bg-surface-raised" />
                <div className="h-4 w-16 shrink-0 animate-pulse rounded-full bg-surface-raised" />
                <div className="h-4 flex-1 animate-pulse rounded bg-surface-raised" />
              </div>
            ))}
          </div>
        )}

        {/* 取得に失敗したとき */}
        {hasError && (
          <div className="flex flex-col items-start gap-2 py-6">
            <p className="flex items-center gap-2 text-sm text-text-muted">
              <AlertTriangle className="w-4 h-4 shrink-0 text-warning" />
              今日やることを取得できませんでした
            </p>
            <button
              type="button"
              onClick={() => setReloadCount((c) => c + 1)}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-text-muted transition-colors hover:bg-surface-hover hover:text-primary"
            >
              <RotateCw className="w-3.5 h-3.5" />
              再読み込み
            </button>
          </div>
        )}

        {/* 0件（達成演出はしない。静かに「無い」と伝えるだけ） */}
        {!lightLoading && !hasError && today !== null && items.length === 0 && (
          <div className="py-6">
            <p className="text-sm text-text-muted">今日やることはありません</p>
            <p className="mt-1 text-xs text-text-faint">新しい用事が出るとここに並びます</p>
          </div>
        )}

        {/* 統合リスト（運営の用事と生徒への用事を混ぜて時間順に出す） */}
        {!lightLoading && !hasError && items.length > 0 && (
          <div>
            {rows.map((row) =>
              row.type === 'heading' ? (
                <p key={row.key} className="pb-1 pt-3 text-xs font-bold text-text-muted">
                  {row.text}
                </p>
              ) : (
                <TodoRow key={row.key} item={row.item} done={row.done} onToggleDone={toggleDone} />
              )
            )}
          </div>
        )}

        {/* 重い方の読み込み中。カードは覆わず、末尾に1行だけ控えめに出す */}
        {heavyLoading && !hasError && (
          <p className="flex items-center gap-1.5 pt-3 text-xs text-text-faint">
            <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" />
            他の項目を確認中…
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/* ============================================================
 * 1行
 * ========================================================== */

function TodoRow({
  item,
  done,
  onToggleDone,
}: {
  item: TodayTodoItem;
  done: boolean;
  onToggleDone: (id: string) => void;
}) {
  // 緊急度が高い行はチップも danger にして、ドットと合わせて一目で拾えるようにする
  const tone = TONE[item.urgency === 'high' ? 'danger' : SOURCE_TONE[item.source]];

  // 本文（チップ・生徒名・title・超過バッジ）。狭い幅で崩れないよう flex-wrap
  const body = (
    <>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ${tone.bg} ${tone.text}`}
        >
          {item.label}
        </span>
        {item.student && (
          <span className="inline-flex items-baseline gap-1">
            <span
              className={`text-sm font-bold ${done ? 'text-text-faint line-through' : 'text-text-heading'}`}
            >
              {item.student.name}
            </span>
            {item.student.grade != null && (
              <span className="text-xs text-text-faint">{item.student.grade}年</span>
            )}
          </span>
        )}
        <span
          className={`text-sm font-medium ${done ? 'text-text-faint line-through' : 'text-text-body'}`}
        >
          {item.title}
        </span>
        {item.overdue && !done && (
          <span className="inline-flex shrink-0 items-center rounded-full bg-danger-subtle px-2 py-0.5 text-xs font-bold text-danger">
            超過
          </span>
        )}
      </div>
      {item.note && <p className="mt-0.5 text-xs text-text-faint">{item.note}</p>}
    </>
  );

  return (
    <div
      className={`flex items-start gap-3 border-b border-border-subtle py-3 last:border-0 ${
        done ? 'opacity-60' : ''
      }`}
    >
      {/* 緊急度ドット */}
      <span
        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${done ? 'bg-text-faint' : URGENCY_DOT[item.urgency]}`}
        aria-hidden="true"
      />

      {/* href がある行だけクリックできる。ダッシュボードが起点なので別タブでは開かない */}
      {item.href ? (
        <Link
          href={item.href}
          className="min-w-0 flex-1 rounded-md transition-colors hover:text-primary"
        >
          {body}
        </Link>
      ) : (
        <div className="min-w-0 flex-1">{body}</div>
      )}

      {/* 済ボタン。行のリンク遷移を誘発しないよう既定動作と伝播を止める */}
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onToggleDone(item.id);
        }}
        aria-pressed={done}
        className={`flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
          done
            ? 'border-success bg-success-subtle text-success'
            : 'border-border text-text-muted hover:bg-surface-hover hover:text-primary'
        }`}
      >
        <Check className="w-3.5 h-3.5" />済
      </button>
    </div>
  );
}

export default TodayTodosWidget;
