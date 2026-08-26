'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, MoreHorizontal, Repeat } from 'lucide-react';
import { AbsenceSheet } from './AbsenceSheet';
import { formatGradeLabel } from '@/lib/utils/gradeLabel';
import type {
  PortalExamEventDto,
  PortalScheduleEntryDto,
  PortalTimeSlotDto,
  TransferQuota,
} from '@/types/mypage-schedule';

/**
 * 予定ビュー（時間割・今後の予定）— 保護者側。
 *
 * 正典: docs/portal-v2-requirements.md §4「S. スケジュール」/ §7-3、UIモック。
 *
 * 構成（モック準拠）:
 *   兄弟切替タブ → 週ナビ（前後移動）→ 日付グルーピング（今日を強調）→ コマ行
 *   → 凡例＋残り振替回数の控えめな1行。
 *
 * ★ 残り振替回数を目立たせない理由（§7-3 の確定方針）:
 *   振替は「権利」であって「推奨」ではない。カードで大きく出すと「使わないと損」という
 *   誘導になるため、凡例の並びに小さく1行だけ出す。
 */

/** 兄弟切替に使う生徒（親から渡す）。 */
export interface ScheduleStudent {
  id: string;
  name: string;
  grade: number | null;
}

/** 種別バッジの表示定義（§実装指示のマッピング）。 */
type BadgeKind = 'regular' | 'transfer' | 'koushu' | 'test_prep' | 'cancelled' | 'other' | 'exam';

/**
 * 予定の status/kind から表示バッジを決める。
 * ★ status を kind より優先する: 「講習コマを振替した」ときは利用者にとって
 *   重要なのは『振替』であり、休講なら何の種別でも『休講』。
 */
function badgeOf(entry: PortalScheduleEntryDto): BadgeKind {
  if (entry.status === 'cancelled') return 'cancelled';
  if (entry.status === 'transferred_in') return 'transfer';
  if (entry.kind === 'koushu') return 'koushu';
  if (entry.kind === 'test_prep') return 'test_prep';
  if (entry.kind === 'regular') return 'regular';
  return 'other';
}

const BADGE_LABEL: Record<BadgeKind, string> = {
  regular: '通常',
  transfer: '振替',
  koushu: '講習',
  test_prep: 'テスト対策',
  cancelled: '休講',
  other: 'その他',
  exam: '模試',
};

const BADGE_CLASS: Record<BadgeKind, string> = {
  regular: 'bg-surface-hover text-text-muted',
  transfer: 'bg-ink-subtle text-ink',
  koushu: 'bg-warning-subtle text-warning',
  test_prep: 'bg-success-subtle text-success',
  cancelled: 'bg-primary-subtle text-primary-dark',
  other: 'bg-surface-hover text-text-muted',
  // 講習(warning)・振替(ink)と混同しないよう、模試だけ info 系の色相にする。
  exam: 'bg-info-subtle text-info',
};

/**
 * 予定リストに混ぜる1件（授業 or 申込済み模試）。
 * ★ なぜ判別ユニオンにするか: schedule_entries 由来の授業と form_responses 由来の
 *   模試は取得元も形も別だが、同じ日付グルーピング・時刻順マージのリストに並べる
 *   必要がある。型を分けたまま `type` タグで分岐すれば、模試側に無い時限・座席・
 *   講師の概念を授業側の型に引きずられずに済む。
 */
type DayItem =
  | { kind: 'lesson'; entry: PortalScheduleEntryDto }
  | { kind: 'exam'; exam: PortalExamEventDto };

/** 模試の timeLabel（'10:00〜13:00' 等、自由入力）から先頭の開始時刻を取り出す。 */
function examStartTime(timeLabel: string | null): string | null {
  const m = timeLabel?.match(/^(\d{1,2}):(\d{2})/);
  // '9:00' のような1桁時はゼロ埋めして 'HH:MM' に正規化（文字列比較でのソート用）。
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
}

/** 同日内の並び替えキー（'HH:MM'）。時刻不明なら末尾に回るよう大きい値にする。 */
function sortKeyOf(item: DayItem): string {
  if (item.kind === 'lesson') return item.entry.startTime ?? '99:99';
  return examStartTime(item.exam.timeLabel) ?? '99:99';
}

/** 'YYYY-MM-DD'（JSTカレンダー日）を Date を介さず扱うためのユーティリティ群。 */

/** 今日の JST カレンダー日 'YYYY-MM-DD'。 */
function todayJst(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' に日数を足す（UTC基準で計算しTZに依存させない）。 */
function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

/** その日を含む週の月曜日を返す。 */
function mondayOf(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=日
  // 日曜(0)は前週扱いにして月曜起点にする。
  const delta = dow === 0 ? -6 : 1 - dow;
  return addDays(dateStr, delta);
}

const DOW_JP = ['日', '月', '火', '水', '木', '金', '土'];

/** 'YYYY-MM-DD' → '7月14日(月)'。 */
function formatDayHeading(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${m}月${d}日(${DOW_JP[dow]})`;
}

/** 'YYYY-MM-DD' → '7月14日'。 */
function formatShort(dateStr: string): string {
  const [, m, d] = dateStr.split('-').map(Number);
  return `${m}月${d}日`;
}

/** 'YYYY-MM-DD' → '7/22'（フリー期間の注記用）。 */
function formatSlash(dateStr: string): string {
  const [, m, d] = dateStr.split('-').map(Number);
  return `${m}/${d}`;
}

export function ScheduleView({ students }: { students: ScheduleStudent[] }) {
  const [studentId, setStudentId] = useState<string>(students[0]?.id ?? '');
  const [weekStart, setWeekStart] = useState<string>(() => mondayOf(todayJst()));
  const [entries, setEntries] = useState<PortalScheduleEntryDto[]>([]);
  // 教室に実在する時限（振替希望の「時限」選択肢）。予定APIに同梱されてくる。
  const [timeSlots, setTimeSlots] = useState<PortalTimeSlotDto[]>([]);
  // 申込済み模試の実施予定（schedule_entries とは別ソース。予定APIに同梱されてくる）。
  const [exams, setExams] = useState<PortalExamEventDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [quota, setQuota] = useState<TransferQuota | null>(null);
  // 「…」から開く欠席・振替シートの対象コマ。
  const [sheetEntry, setSheetEntry] = useState<PortalScheduleEntryDto | null>(null);

  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart]);
  const today = useMemo(() => todayJst(), []);

  const load = useCallback(async () => {
    if (!studentId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/mypage/schedule?studentId=${encodeURIComponent(studentId)}&from=${weekStart}&to=${weekEnd}`
      );
      const json = await res.json();
      setEntries(res.ok ? (json.entries ?? []) : []);
      setTimeSlots(res.ok ? (json.timeSlots ?? []) : []);
      setExams(res.ok ? (json.exams ?? []) : []);
    } finally {
      setLoading(false);
    }
  }, [studentId, weekStart, weekEnd]);

  useEffect(() => {
    load();
  }, [load]);

  // 残り振替回数。★ 基準日は「表示中の週」ではなく今日にする:
  //   凡例の1行は「今月あと何回か」の概況表示。個別コマの判定はシート側で
  //   そのコマの日付を基準に取り直す（§7-3 の「月の基準は対象授業日」）。
  useEffect(() => {
    if (!studentId) return;
    let cancelled = false;
    (async () => {
      const res = await fetch(
        `/api/mypage/transfer-usage?studentId=${encodeURIComponent(studentId)}&targetDate=${today}`
      );
      const json = await res.json();
      if (!cancelled) setQuota(res.ok ? (json.quota ?? null) : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [studentId, today]);

  // 日付ごとにグルーピングし、同日内は授業・模試を時刻順にマージする
  // （APIはそれぞれ日付・開始時刻順で返すが、混ぜた後の並びはここで決め直す）。
  const grouped = useMemo(() => {
    const map = new Map<string, DayItem[]>();
    const push = (date: string, item: DayItem) => {
      if (!map.has(date)) map.set(date, []);
      map.get(date)!.push(item);
    };
    for (const e of entries) push(e.entryDate, { kind: 'lesson', entry: e });
    for (const ex of exams) push(ex.entryDate, { kind: 'exam', exam: ex });

    return Array.from(map.entries())
      .map(([date, items]): [string, DayItem[]] => {
        items.sort((a, b) => sortKeyOf(a).localeCompare(sortKeyOf(b)));
        return [date, items];
      })
      .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }, [entries, exams]);

  if (students.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface-raised p-4 text-sm text-text-muted">
        表示できる生徒がいません。
      </div>
    );
  }

  return (
    <div>
      {/* 兄弟切替（1人なら出さない） */}
      {students.length > 1 && (
        <div className="mb-3 flex gap-2 overflow-x-auto">
          {students.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setStudentId(s.id)}
              className={`whitespace-nowrap rounded-full border px-3 py-1 text-xs transition-colors ${
                studentId === s.id
                  ? 'border-text-heading bg-text-heading font-semibold text-surface-raised'
                  : 'border-border bg-surface-raised text-text-muted hover:bg-surface-hover'
              }`}
            >
              {s.name}
              {s.grade != null && `（${formatGradeLabel(s.grade)}）`}
            </button>
          ))}
        </div>
      )}

      {/* 週ナビ */}
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          aria-label="前の週"
          onClick={() => setWeekStart(addDays(weekStart, -7))}
          className="flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-surface-raised text-text-muted transition-colors hover:bg-surface-hover"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-bold text-text-heading">
          {formatShort(weekStart)} 〜 {formatShort(weekEnd)}
        </span>
        <button
          type="button"
          aria-label="次の週"
          onClick={() => setWeekStart(addDays(weekStart, 7))}
          className="flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-surface-raised text-text-muted transition-colors hover:bg-surface-hover"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* 予定リスト */}
      <div className="space-y-3">
        {loading ? (
          <p className="py-8 text-center text-sm text-text-muted">読み込み中…</p>
        ) : grouped.length === 0 ? (
          <p className="py-8 text-center text-sm text-text-muted">この週の予定はありません。</p>
        ) : (
          grouped.map(([date, dayItems]) => (
            <div key={date}>
              <div
                className={`mb-1.5 flex items-center gap-1.5 text-xs font-bold ${
                  date === today ? 'text-primary' : 'text-text-muted'
                }`}
              >
                {formatDayHeading(date)}
                {date === today && (
                  <span className="rounded-full bg-primary px-2 py-0.5 text-[9.5px] text-text-on-primary">
                    今日
                  </span>
                )}
              </div>
              {dayItems.map((item) =>
                item.kind === 'lesson' ? (
                  <LessonRow
                    key={item.entry.id}
                    entry={item.entry}
                    onAction={() => setSheetEntry(item.entry)}
                  />
                ) : (
                  <ExamRow key={item.exam.id} exam={item.exam} />
                )
              )}
            </div>
          ))
        )}
      </div>

      {/* 凡例＋残り振替回数（控えめな1行） */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <span className="flex gap-1.5">
          {(['regular', 'transfer', 'koushu', 'test_prep', 'exam'] as BadgeKind[]).map((k) => (
            <span
              key={k}
              className={`rounded-full px-2 py-0.5 text-[9.5px] font-bold ${BADGE_CLASS[k]}`}
            >
              {BADGE_LABEL[k]}
            </span>
          ))}
        </span>
        <QuotaLine quota={quota} />
      </div>

      {/* コマから開く欠席・振替シート（日付・時限はプリフィル） */}
      {sheetEntry && (
        <AbsenceSheet
          studentId={studentId}
          entry={sheetEntry}
          timeSlots={timeSlots}
          onClose={() => setSheetEntry(null)}
          onSent={() => {
            setSheetEntry(null);
            // 残り回数が変わりうるので取り直す。
            load();
          }}
        />
      )}
    </div>
  );
}

/** 予定1コマの行。休講は打ち消し＋薄く。 */
function LessonRow({ entry, onAction }: { entry: PortalScheduleEntryDto; onAction: () => void }) {
  const badge = badgeOf(entry);
  const isCancelled = badge === 'cancelled';
  const subjectText = entry.subjectNames.join('・') || '授業';

  return (
    <div
      className={`mb-1.5 flex items-center gap-2.5 rounded-xl border border-border-subtle bg-surface-raised px-3 py-2.5 ${
        isCancelled ? 'opacity-65' : ''
      }`}
    >
      {/* 時限・開始時刻 */}
      <div className="w-14 flex-none border-r border-border-subtle pr-2.5 text-center">
        {entry.slotNumber != null && (
          <div className="text-[11px] text-text-muted">{entry.slotNumber}限</div>
        )}
        <div className="text-[13px] font-bold text-text-heading">{entry.startTime ?? '—'}</div>
      </div>

      {/* 科目・種別・講師 */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5 text-[13.5px] font-semibold text-text-heading">
          <span className={isCancelled ? 'line-through' : ''}>{subjectText}</span>
          <span className={`rounded-full px-2 py-0.5 text-[9.5px] font-bold ${BADGE_CLASS[badge]}`}>
            {BADGE_LABEL[badge]}
          </span>
        </div>
        {entry.teacherName && (
          <div className="text-[11.5px] text-text-muted">{entry.teacherName}先生</div>
        )}
      </div>

      {/* 休講のコマからは連絡できない（既に授業が無い）。 */}
      {!isCancelled && (
        <button
          type="button"
          aria-label="この授業について連絡する"
          onClick={onAction}
          className="flex-none text-text-faint transition-colors hover:text-text-body"
        >
          <MoreHorizontal className="h-4.5 w-4.5" />
        </button>
      )}
    </div>
  );
}

/**
 * 申込済み模試1件の行。
 * ★ 授業行（LessonRow）とあえて見た目を揃えすぎない: 時限・座席・講師が無い
 *   模試に「…」（欠席・振替）を出すと押しても何も起きない行に見えるため、
 *   アクションは付けない（教室に直接連絡する運用のため）。
 */
function ExamRow({ exam }: { exam: PortalExamEventDto }) {
  // 左カラム（幅56px）に '10:00〜13:00' は収まらないので開始時刻だけ出し、
  // 時間帯の全体と会場は下段にまとめる（375px前提）。
  const startTime = examStartTime(exam.timeLabel);
  const detail = [exam.timeLabel !== startTime ? exam.timeLabel : null, exam.venueLabel]
    .filter(Boolean)
    .join('・');

  return (
    <div className="mb-1.5 flex items-center gap-2.5 rounded-xl border border-border-subtle bg-surface-raised px-3 py-2.5">
      <div className="w-14 flex-none border-r border-border-subtle pr-2.5 text-center">
        <div className="text-[13px] font-bold text-text-heading">{startTime ?? '—'}</div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5 text-[13.5px] font-semibold text-text-heading">
          <span>{exam.title}</span>
          <span className={`rounded-full px-2 py-0.5 text-[9.5px] font-bold ${BADGE_CLASS.exam}`}>
            {BADGE_LABEL.exam}
          </span>
        </div>
        {detail && <div className="text-[11.5px] text-text-muted">{detail}</div>}
      </div>
    </div>
  );
}

/**
 * 残り振替回数の1行（控えめ）。
 * - フリー期間中: 「7/22〜8/9 は振替制限なし（講習前期間）」
 * - 通常:         「7月の振替 残り1回」
 */
function QuotaLine({ quota }: { quota: TransferQuota | null }) {
  if (!quota) return null;

  if (quota.mode === 'free') {
    return (
      <span className="flex items-center gap-1.5 text-[11px] text-ink">
        <Repeat className="h-3 w-3 flex-none" />
        {formatSlash(quota.startDate)}〜{formatSlash(quota.endDate)} は振替制限なし
        {quota.label ? `（${quota.label}）` : ''}
      </span>
    );
  }

  // 「2026年7月」→「7月」（1行を短く保つ）。
  const monthOnly = quota.monthLabel.replace(/^\d+年/, '');
  return (
    <span className="flex items-center gap-1.5 text-[11px] tabular-nums text-text-muted">
      <Repeat className="h-3 w-3 flex-none" />
      {monthOnly}の振替 残り{quota.remaining}回
    </span>
  );
}
