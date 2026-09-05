'use client';

/**
 * 掲示板AIアシスト: 教室長が見る「残っている人」。
 *
 * 正典: docs/bulletin-ai-assist.html
 *
 * ★見るのは「残り何人」と「誰が残っているか」だけ。押すものは「×」1つにする。
 *   前の設計には依頼ごとの追跡ボタンが2か所、数え直す、申込状況の列を選ぶ、があった。
 *   教室長は1日に何度もここを通るので、押すものが増えるほど見られなくなる。
 *
 * ★達成率（47/62）は出さない。教室長が動く先は「誰がまだか」であって割合ではない。
 *   分数を出すと、残り1人でも「76%」に見えて動く気にならない。
 *
 * ★判定できない種別に数字を出さない。実データで数えられない種別に人数を出すと、
 *   その数字を見て督促が飛ぶ——いま起きている問題そのものを再生産する。
 */

import { useCallback, useEffect, useState } from 'react';
import { fetchWithAuth } from '@/lib/api/auth';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/useToast';
import { isManagerOrAbove } from '@/lib/utils/roles';
import type { BulletinProgressResponse, BulletinTaskView } from '@/lib/bulletin/apiTypes';
import { ASSESSMENT_NAME_LABELS } from '@/types/database';
import type { ApplicationItem, School } from '@/types/database';
import { TASK_PERIOD_CHOICES, type TaskKind } from '@/lib/bulletin/taskCatalog';
import { getApplicationItems } from '@/lib/api/applications';

/** 教室が複数選ばれているときだけ、行に教室名を添える */
interface Row extends BulletinTaskView {
  schoolId: string;
  schoolName: string;
}

/** 「いま追加」を出す期間。投稿した教室長がその場で結果を見られればよい */
const FRESH_HOURS = 24;

interface BulletinTaskBoardProps {
  /** 教室名の対応表。掲示板がすでに持っているものを受け取る（同じ取得を二度しない） */
  schools: School[];
  /** 値が変わったら数え直す。投稿の読み取りが終わったときに掲示板側が変える */
  reloadKey?: number;
  /** 投稿から依頼を読み取っている最中。★待たせている理由が分かるように出す */
  isExtracting?: boolean;
  className?: string;
}

export function BulletinTaskBoard({
  schools,
  reloadKey = 0,
  isExtracting = false,
  className = '',
}: BulletinTaskBoardProps) {
  const { getSelectedSchoolIds, profile } = useAuth();
  const { error: toastError } = useToast();

  const [rows, setRows] = useState<Row[]>([]);
  const [measuredAt, setMeasuredAt] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  /** ×で消した行。UIからは畳むが「戻す」で戻せるように覚えておく */
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  /** 申込状況の列の候補（教室ごと）。★列名は教室ごとに違うので教室単位で持つ */
  const [itemsBySchool, setItemsBySchool] = useState<Record<string, ApplicationItem[]>>({});

  const canSee = isManagerOrAbove(profile?.role);
  const schoolIds = getSelectedSchoolIds();
  const schoolKey = schoolIds.join(',');

  const load = useCallback(async () => {
    const ids = schoolKey ? schoolKey.split(',') : [];
    if (!canSee || ids.length === 0) {
      setRows([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      // 教室ごとに1本ずつ。★数えるのは閲覧時なので、順番に待たずに並列で叩く
      const results = await Promise.all(
        ids.map(async (id) => {
          const res = await fetchWithAuth(`/api/ai/bulletin/progress?school_id=${id}`);
          if (!res.ok) return [] as Row[];
          const json = (await res.json()) as BulletinProgressResponse;
          const name = schools.find((s) => s.id === id)?.name ?? '';
          return json.tasks.map((t) => ({ ...t, schoolId: id, schoolName: name }));
        })
      );
      setRows(results.flat());
      setMeasuredAt(new Date().toISOString());
    } catch {
      // ★掲示板そのものを壊さない。数えられなければ何も出さないだけにする
      setRows([]);
    } finally {
      setIsLoading(false);
    }
    // reloadKey は「読み取りが終わったので数え直す」合図。値そのものは使わない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSee, schoolKey, schools, reloadKey]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * 申込状況の列の候補を取る。★列名は教室ごとにバラバラなので、
   *   AIにも名前で推測させない（人が1回選ぶ）。選び終えた依頼では選択欄が消える。
   */
  useEffect(() => {
    const ids = schoolKey ? schoolKey.split(',') : [];
    if (!canSee || ids.length === 0) return;
    let alive = true;
    void (async () => {
      try {
        const items = await getApplicationItems(ids);
        if (!alive) return;
        const map: Record<string, ApplicationItem[]> = {};
        for (const it of items) {
          const sid = it.school_id;
          if (!sid) continue;
          (map[sid] ??= []).push(it);
        }
        setItemsBySchool(map);
      } catch {
        // 取れなくてもボードは動く（選択欄が空になるだけ）
        setItemsBySchool({});
      }
    })();
    return () => {
      alive = false;
    };
  }, [canSee, schoolKey]);

  /**
   * 依頼の設定を変える（追跡の入切／どの回か／申込状況の列）。
   * ★変えたら数え直す。回や列が決まると判定できるようになるので、その場で人数が出る。
   */
  const patchTask = async (
    taskId: string,
    patch: { targetPeriod?: string; applicationItemId?: string }
  ) => {
    const res = await fetchWithAuth('/api/ai/bulletin/tasks', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, ...patch }),
    });
    if (!res.ok) {
      toastError('変更できませんでした');
      return;
    }
    await load();
  };

  /** ×＝この依頼は追跡しない。消さずに tracked=false にするので「戻す」で戻せる */
  const setTracked = async (taskId: string, tracked: boolean) => {
    const res = await fetchWithAuth('/api/ai/bulletin/tasks', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, tracked }),
    });
    if (!res.ok) {
      toastError(tracked ? '戻せませんでした' : '消せませんでした');
      return;
    }
    setRemoved((prev) => {
      const next = new Set(prev);
      if (tracked) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  if (!canSee) return null;
  // ★依頼が1件も無いときは、空の箱を掲示板に足さない。
  //   ただし読み取り中は、投稿したのに何も出ない時間の理由が分かるように出す
  if (!isExtracting && (isLoading || rows.length === 0)) return null;

  const multiSchool = schoolIds.length > 1;

  return (
    <section className={`mt-4 ${className}`} aria-label="残っている人">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold text-text-heading">残っている人</h3>
        {isExtracting ? (
          <span className="text-[11px] text-text-muted">投稿から依頼を読み取っています…</span>
        ) : (
          measuredAt && (
            <span className="font-mono text-[11px] tabular-nums text-text-faint">
              {formatClock(measuredAt)} 時点
            </span>
          )
        )}
      </div>

      <div className="flex flex-col gap-2">
        {rows.map((row) => (
          <TaskRow
            key={`${row.schoolId}:${row.taskId}`}
            row={row}
            showSchool={multiSchool}
            removed={removed.has(row.taskId)}
            onToggle={() => void setTracked(row.taskId, removed.has(row.taskId))}
            applicationItems={itemsBySchool[row.schoolId] ?? []}
            onPeriodChange={(period) => void patchTask(row.taskId, { targetPeriod: period })}
            onItemChange={(itemId) => void patchTask(row.taskId, { applicationItemId: itemId })}
          />
        ))}
      </div>
    </section>
  );
}

function TaskRow({
  row,
  showSchool,
  removed,
  onToggle,
  applicationItems,
  onPeriodChange,
  onItemChange,
}: {
  row: Row;
  showSchool: boolean;
  removed: boolean;
  onToggle: () => void;
  applicationItems: ApplicationItem[];
  onPeriodChange: (period: string) => void;
  onItemChange: (itemId: string) => void;
}) {
  const label =
    showSchool && row.schoolName ? `${row.kindLabel}（${row.schoolName}）` : row.kindLabel;

  if (removed) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-border px-3.5 py-2">
        <span className="text-xs text-text-faint">{label} を消しました</span>
        <button
          type="button"
          onClick={onToggle}
          className="rounded-md border border-border px-2.5 py-1 text-[11px] text-text-muted transition-colors hover:bg-surface-hover"
        >
          戻す
        </button>
      </div>
    );
  }

  // ★判定できない種別。人数を出さず、そう書く。
  //   ただし「どの回か」さえ決まれば数えられる種別（定期テスト）は、その選択欄を出す。
  if (row.unsupported) {
    const canJudgeOnceChosen = row.needsPeriod && !row.targetPeriod;
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface-hover/40 px-3.5 py-2.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-sm font-bold text-text-heading">{label}</span>
          <span className="text-xs text-text-muted">
            {canJudgeOnceChosen
              ? 'どの回のことか選ぶと、残り人数を数えます'
              : 'まだ数えられません。数えられるまで人数は出しません'}
          </span>
          <RemoveButton onClick={onToggle} className="ml-auto" />
        </div>
        {canJudgeOnceChosen && (
          <PeriodPicker kind={row.kind} value={row.targetPeriod} onChange={onPeriodChange} />
        )}
      </div>
    );
  }

  const fresh = isFresh(row.createdAt);
  const zero = row.notYet === 0;
  const hidden = Math.max(0, row.notYet - row.notYetNames.length);
  // ★決めることが残っているときだけ選択欄を出す。決まったら消える（常設の操作を増やさない）
  const askPeriod = row.needsPeriod && !row.targetPeriod;
  const askItem = !row.unsupported && !row.applicationItemId;

  return (
    <div
      className={`flex flex-col gap-2 rounded-lg border px-3.5 py-3 ${
        fresh ? 'border-ink/35 bg-ink-subtle' : 'border-border-subtle bg-surface-hover/40'
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-base font-bold text-text-heading">{label}</span>
        {fresh ? (
          <span className="shrink-0 rounded-full bg-ink px-2 py-0.5 text-[10px] font-bold text-white">
            いま追加
          </span>
        ) : (
          <DueLabel dueDate={row.dueDate} />
        )}
      </div>

      {/* ★この画面の主役。残り人数だけを大きく出す */}
      <div className="flex items-baseline gap-2">
        <span
          className={`text-3xl font-bold leading-none tabular-nums ${
            zero ? 'text-success' : 'text-text-heading'
          }`}
        >
          {row.notYet}
        </span>
        <span className="text-sm text-text-body">人 残っています</span>
      </div>

      {row.notYetNames.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {row.notYetNames.map((name) => (
            <span
              key={name}
              className="whitespace-nowrap rounded-full border border-border bg-surface px-2.5 py-0.5 text-xs text-text-body"
            >
              {name}
            </span>
          ))}
          {hidden > 0 && (
            <span className="whitespace-nowrap rounded-full border border-dashed border-border px-2.5 py-0.5 text-xs text-text-muted">
              ほか{hidden}人
            </span>
          )}
        </div>
      )}

      {/* ★決めることが残っているときだけ出る。決まったら消えるので、常設の操作にはならない */}
      {(askPeriod || askItem) && (
        <div className="flex flex-col gap-1.5 rounded-md border border-dashed border-border bg-surface px-2.5 py-2">
          {askPeriod && (
            <PeriodPicker kind={row.kind} value={row.targetPeriod} onChange={onPeriodChange} />
          )}
          {askItem && (
            <label className="flex flex-wrap items-center gap-1.5 text-[11px] text-text-muted">
              <span>済んだ人に自動でチェックを付ける列（任意）</span>
              <select
                value=""
                onChange={(e) => e.target.value && onItemChange(e.target.value)}
                className="rounded border border-border bg-surface px-1.5 py-0.5 text-[11px] text-text-body"
              >
                <option value="">選ぶ</option>
                {applicationItems.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`text-xs ${zero ? 'text-success' : 'text-text-muted'}`}>
          {footNote(row)}
        </span>
        <RemoveButton onClick={onToggle} />
      </div>
    </div>
  );
}

/**
 * 「どの回か」を選ぶ。
 * ★AIには選ばせない。「テスト結果を入力して」からは回が決まらず、
 *   外すと入っていない回を見て「全員済」と出す——最も危ない方向に誤る。
 */
function PeriodPicker({
  kind,
  value,
  onChange,
}: {
  kind: TaskKind;
  value: string | null;
  onChange: (period: string) => void;
}) {
  const choices = TASK_PERIOD_CHOICES[kind] ?? [];
  return (
    <label className="flex flex-wrap items-center gap-1.5 text-[11px] text-text-muted">
      <span>どの回のことか</span>
      <select
        value={value ?? ''}
        onChange={(e) => e.target.value && onChange(e.target.value)}
        className="rounded border border-border bg-surface px-1.5 py-0.5 text-[11px] text-text-body"
      >
        <option value="">選ぶ</option>
        {choices.map((c) => (
          <option key={c} value={c}>
            {ASSESSMENT_NAME_LABELS[c] ?? c}
          </option>
        ))}
      </select>
    </label>
  );
}

function RemoveButton({ onClick, className = '' }: { onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="この依頼は追跡しない"
      className={`shrink-0 rounded-md border border-border px-2.5 py-1 text-[11px] text-text-muted transition-colors hover:bg-surface-hover ${className}`}
    >
      × 消す
    </button>
  );
}

function DueLabel({ dueDate }: { dueDate: string | null }) {
  if (!dueDate) return null;
  const today = new Date().toISOString().slice(0, 10);
  const over = dueDate <= today;
  return (
    <span
      className={`shrink-0 whitespace-nowrap font-mono text-[11px] tabular-nums ${
        over ? 'font-bold text-danger' : 'text-text-faint'
      }`}
    >
      {formatMonthDay(dueDate)}まで{over ? '・過ぎています' : ''}
    </span>
  );
}

/**
 * カード下の1行。★教室長が次に何をするかが変わることだけを書く。
 * 自動でチェックが付いたなら「督促は要りません」まで言い切る（それが督促を止める唯一の手がかり）。
 */
function footNote(row: Row): string {
  if (row.notYet === 0 && row.autoChecked > 0) {
    return `済んだ${row.autoChecked}人に、チェックを自動で付けました。督促は要りません`;
  }
  if (row.notYet === 0) return '全員済んでいます。督促は要りません';

  const latest = row.sources[0];
  if (!latest) return '';
  const base = `${latest.postedAt ? `${formatMonthDay(latest.postedAt)}の` : ''}投稿「${latest.title}」から`;
  // 同じ依頼が2回以上投稿されている＝すでに督促が重なっている
  if (row.sources.length > 1) {
    const oldest = row.sources[row.sources.length - 1];
    const since = oldest.postedAt ? `${formatMonthDay(oldest.postedAt)}から` : '';
    return `${base}。${since}${row.sources.length}回目の依頼です`;
  }
  return base;
}

/** 作られたばかりか（投稿した教室長が、その場で結果を見られるようにするため） */
function isFresh(createdAt: string): boolean {
  const t = new Date(createdAt).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t < FRESH_HOURS * 3600_000;
}

function formatClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 'YYYY-MM-DD' でも ISO でも 'M/D' にする */
function formatMonthDay(value: string): string {
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
