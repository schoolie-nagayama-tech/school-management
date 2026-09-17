'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Loading } from '@/components/ui';
import { getStudentScheduleEntries } from '@/lib/api/schedule';
import { getSubjects } from '@/lib/api/subjects';
import { getFormations } from '@/lib/api/schedule-formations';
import type { ScheduleEntry } from '@/types/schedule';
import { SCHEDULE_ENTRY_FORMATION_LABELS, INDIVIDUAL_FORMATION } from '@/types/schedule';
import { normalizePersonName } from '@/lib/utils/personName';

interface StudentScheduleCalendarProps {
  studentId: string;
}

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

/**
 * 'YYYY-MM-DD' を自前で組み立てる。
 * Date#toISOString() はUTC変換されるため、JSTの深夜帯では日付が前日にズレる。
 * 年月日は必ず getFullYear/getMonth/getDate から組み立てること。
 */
function toDateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * 1件分の授業行。
 * 開始時刻・コマ名・科目・講師名を必ず1行に収め、省略せず全項目を出す
 * （「他N件」的な省略はここでは絶対にしない。カレンダーの目的が
 * 　問い合わせ対応時の即答なので、隠れている予定があると困る）。
 */
function ScheduleEntryLine({
  entry,
  subjectMap,
  formationLabels,
}: {
  entry: ScheduleEntry;
  subjectMap: Map<string, string>;
  formationLabels: Record<string, string>;
}) {
  const isAbsent = entry.attendance_status === 'absent';
  const isPresent = entry.attendance_status === 'present';
  const isTransferredOut = entry.status === 'transferred_out';
  const isTransferredIn = entry.status === 'transferred_in';
  const isOneToOne = entry.ratio === 1;
  const halfLabel =
    entry.half_position === 'first' ? '前' : entry.half_position === 'second' ? '後' : null;

  // 行の背景色。優先度は 欠席 > 振替元 > 振替先 > 体験 > テスト対策・追加授業 > 講習 > 通常。
  // 座席表の StudentCard（src/components/schedule/StudentCard.tsx）と同じ規約に揃えている。
  const colorClass = isAbsent
    ? 'bg-red-50 border-red-200'
    : isTransferredOut
      ? 'bg-gray-100 border-gray-200 opacity-60'
      : isTransferredIn
        ? 'bg-sky-50 border-sky-200'
        : entry.kind === 'trial'
          ? 'bg-emerald-50 border-emerald-200'
          : entry.kind === 'test_prep' || entry.kind === 'additional'
            ? 'bg-violet-50 border-violet-200'
            : entry.kind === 'koushu'
              ? 'bg-orange-50 border-orange-200'
              : 'bg-blue-50 border-blue-200';

  const strike = isAbsent || isTransferredOut;

  const startTime = entry.time_slot?.start_time ? entry.time_slot.start_time.slice(0, 5) : '';

  // コマ名: 個別は「N限」、それ以外の形態は「形態ラベルN」（座席表の呼び方に合わせる）。
  const formation = entry.formation ?? '';
  const formationLabel =
    formationLabels[formation] ?? SCHEDULE_ENTRY_FORMATION_LABELS[formation] ?? formation;
  const komaLabel = entry.time_slot
    ? formation === INDIVIDUAL_FORMATION
      ? `${entry.time_slot.slot_number}限`
      : `${formationLabel}${entry.time_slot.slot_number}`
    : '—';

  const subjectLabel = (entry.subject_ids ?? [])
    .map((id) => subjectMap.get(id))
    .filter((n): n is string => !!n)
    .join('・');

  // 講師名: display_name → last_name → email の @ より前、の順でフォールバック。
  // ここは教室長側の画面なので講師名は必ず出す（保護者ポータルとは方針が違う）。
  const teacher = entry.teacher;
  const teacherNameRaw = teacher
    ? teacher.display_name ||
      teacher.last_name ||
      (teacher.email ? teacher.email.split('@')[0] : '')
    : '';
  const teacherName = normalizePersonName(teacherNameRaw) || '担当未定';

  return (
    <div
      title={isTransferredIn ? '振替で入ったコマ' : undefined}
      className={`flex flex-wrap items-center gap-x-1 gap-y-0.5 rounded border px-1 py-0.5 text-[10px] leading-tight ${colorClass}`}
    >
      <span className="shrink-0 tabular-nums text-gray-400">{startTime}</span>
      <span className="shrink-0 font-semibold text-gray-700">{komaLabel}</span>
      <span className={strike ? 'text-gray-400 line-through' : 'text-gray-800'}>
        {subjectLabel || '科目未設定'}
      </span>
      <span className="text-gray-500">{teacherName}</span>
      {isOneToOne && (
        <span
          className="shrink-0 text-[8px] font-bold text-gray-500"
          title="1対1授業（生徒1名で満席）"
        >
          1:1
        </span>
      )}
      {halfLabel && (
        <span
          className="shrink-0 rounded bg-gray-200 px-1 text-[8px] text-gray-600"
          title={entry.half_position === 'first' ? '前半45分' : '後半45分'}
        >
          {halfLabel}
        </span>
      )}
      {isPresent && (
        <span className="ml-auto shrink-0 rounded bg-emerald-500 px-1 text-[8px] font-bold text-white">
          済
        </span>
      )}
      {isAbsent && (
        <span className="ml-auto shrink-0 rounded bg-red-500 px-1 text-[8px] font-bold text-white">
          欠
        </span>
      )}
      {isTransferredOut && (
        <span className="ml-auto shrink-0 rounded bg-gray-400 px-1 text-[8px] font-bold text-white">
          振
        </span>
      )}
    </div>
  );
}

/**
 * 生徒詳細モーダル「予定表」タブ：1か月分の授業を月間カレンダーで見せる。読み取り専用。
 *
 * docs/mockups/student-schedule-view-options.html の案B（月カレンダー型）が承認された形。
 * ただしモックの弱点だった「3件以上は他N件に省略」はやめ、開始時刻を必ず出す形に変えている
 * （問い合わせ対応中に予定が隠れていると困るため。詳細は各マスのコメント参照）。
 */
export function StudentScheduleCalendar({ studentId }: StudentScheduleCalendarProps) {
  const [viewDate, setViewDate] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [entries, setEntries] = useState<ScheduleEntry[]>([]);
  const [subjectMap, setSubjectMap] = useState<Map<string, string>>(new Map());
  const [formationLabels, setFormationLabels] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth(); // 0始まり

  const fetchData = useCallback(async () => {
    if (!studentId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const fromDate = toDateKey(year, month, 1);
    const lastDay = new Date(year, month + 1, 0).getDate();
    const toDate = toDateKey(year, month, lastDay);

    // AttendanceMatrix と同じ流儀: Promise.allSettled で、1つ失敗しても他は表示する。
    const [entriesRes, subjectsRes, formationsRes] = await Promise.allSettled([
      getStudentScheduleEntries(studentId, fromDate, toDate),
      getSubjects(),
      getFormations(),
    ]);

    if (entriesRes.status === 'fulfilled') {
      setEntries(entriesRes.value);
    } else {
      console.error('Error fetching student schedule entries:', entriesRes.reason);
      setEntries([]);
    }
    if (subjectsRes.status === 'fulfilled') {
      setSubjectMap(new Map(subjectsRes.value.map((s) => [s.id, s.name])));
    } else {
      console.error('Error fetching subjects:', subjectsRes.reason);
      setSubjectMap(new Map());
    }
    if (formationsRes.status === 'fulfilled') {
      // 取得失敗時は SCHEDULE_ENTRY_FORMATION_LABELS のフォールバックだけに頼る（空のままでよい）。
      setFormationLabels(Object.fromEntries(formationsRes.value.map((f) => [f.key, f.label])));
    } else {
      console.error('Error fetching formations:', formationsRes.reason);
      setFormationLabels({});
    }
    setIsLoading(false);
  }, [studentId, year, month]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ★school_id では絞らない。生徒が他教室のコマに入っている行（振替・講習など）もその生徒の
  // 予定であり、絞ると画面から警告なく消えてしまう（「予定が無い」と誤って案内する事故になる）。
  // 取得側の getStudentScheduleEntries も同じ理由で school_id 条件を持たせていない。

  // 日付キー('YYYY-MM-DD') → その日の授業一覧（開始時刻の昇順）
  const entriesByDate = useMemo(() => {
    const map = new Map<string, ScheduleEntry[]>();
    for (const entry of entries) {
      const list = map.get(entry.entry_date) ?? [];
      list.push(entry);
      map.set(entry.entry_date, list);
    }
    // Map の values() を直接 for-of すると（tsconfig に target 未設定＝ES5扱いのため）TS2802 で落ちる。
    // Array.from() を経由してから反復する。
    for (const list of Array.from(map.values())) {
      list.sort((a, b) =>
        (a.time_slot?.start_time ?? '').localeCompare(b.time_slot?.start_time ?? '')
      );
    }
    return map;
  }, [entries]);

  const summary = useMemo(() => {
    let present = 0;
    let absent = 0;
    let transferredOut = 0;
    for (const entry of entries) {
      if (entry.attendance_status === 'present') present += 1;
      else if (entry.attendance_status === 'absent') absent += 1;
      if (entry.status === 'transferred_out') transferredOut += 1;
    }
    const total = entries.length;
    const scheduled = Math.max(0, total - present - absent - transferredOut);
    return { total, present, absent, transferredOut, scheduled };
  }, [entries]);

  // 月間グリッド用のセル配列（月初・月末を null で埋めて週単位で揃える）
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstWeekday = new Date(year, month, 1).getDay(); // 0=日 ... 6=土
  const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  const cells: (number | null)[] = Array.from({ length: totalCells }, (_, i) => {
    const dayNum = i - firstWeekday + 1;
    return dayNum >= 1 && dayNum <= daysInMonth ? dayNum : null;
  });

  const now = new Date();
  const todayKey = toDateKey(now.getFullYear(), now.getMonth(), now.getDate());

  const goPrevMonth = () => setViewDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  const goNextMonth = () => setViewDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1));
  const goToday = () => setViewDate(new Date(now.getFullYear(), now.getMonth(), 1));

  if (isLoading) {
    return <Loading size="md" />;
  }

  return (
    <div className="space-y-3">
      {/* ツールバー: 月送り + 今月 + 件数サマリ */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button
          type="button"
          onClick={goPrevMonth}
          className="rounded p-1 text-gray-500 transition-colors hover:bg-gray-100"
          aria-label="前月へ"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="min-w-[92px] text-center text-sm font-bold text-gray-800">
          {year}年{month + 1}月
        </span>
        <button
          type="button"
          onClick={goNextMonth}
          className="rounded p-1 text-gray-500 transition-colors hover:bg-gray-100"
          aria-label="翌月へ"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={goToday}
          className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 transition-colors hover:bg-gray-50"
        >
          今月
        </button>
        <span className="ml-auto text-xs text-gray-500">
          全{summary.total}件（実施済 {summary.present}・予定 {summary.scheduled}・欠席{' '}
          {summary.absent}・振替元 {summary.transferredOut}）
        </span>
      </div>

      {summary.total === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-gray-50 py-10 text-center text-sm text-gray-400">
          この月に登録された授業はありません
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200">
          {/* 曜日ヘッダー */}
          <div className="grid grid-cols-7 border-b border-gray-200 text-[11px] font-bold">
            {WEEKDAY_LABELS.map((label, i) => (
              <div
                key={label}
                className={`bg-gray-50 py-1.5 text-center ${i < 6 ? 'border-r border-gray-200' : ''} ${
                  i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-gray-500'
                }`}
              >
                {label}
              </div>
            ))}
          </div>

          {/* 日付マス。高さは内容に応じた可変（min-height のみ指定）。
              予定を「他N件」で省略すると問い合わせ対応で困るため、絶対に省略しない。 */}
          <div className="grid grid-cols-7">
            {cells.map((day, i) => {
              const isLastCol = i % 7 === 6;
              if (day === null) {
                return (
                  <div
                    key={`blank-${i}`}
                    className={`min-h-[64px] border-b border-gray-200 bg-gray-50/60 ${!isLastCol ? 'border-r' : ''}`}
                  />
                );
              }
              const dateKey = toDateKey(year, month, day);
              const isToday = dateKey === todayKey;
              const weekday = (firstWeekday + day - 1) % 7;
              const isSat = weekday === 6;
              const isSun = weekday === 0;
              const dayEntries = entriesByDate.get(dateKey) ?? [];

              return (
                <div
                  key={dateKey}
                  className={`min-h-[64px] space-y-0.5 border-b border-gray-200 p-1 ${!isLastCol ? 'border-r' : ''} ${
                    isToday
                      ? 'bg-amber-50'
                      : isSat
                        ? 'bg-blue-50/40'
                        : isSun
                          ? 'bg-red-50/40'
                          : 'bg-white'
                  }`}
                >
                  <div className="flex items-center gap-1">
                    <span
                      className={`text-[11px] font-bold ${
                        isToday
                          ? 'text-amber-700'
                          : isSat
                            ? 'text-blue-600'
                            : isSun
                              ? 'text-red-600'
                              : 'text-gray-600'
                      }`}
                    >
                      {day}
                    </span>
                    {isToday && (
                      <span className="rounded bg-amber-500 px-1 text-[8px] font-bold leading-tight text-white">
                        今日
                      </span>
                    )}
                  </div>
                  {dayEntries.map((entry) => (
                    <ScheduleEntryLine
                      key={entry.id}
                      entry={entry}
                      subjectMap={subjectMap}
                      formationLabels={formationLabels}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 凡例 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-gray-100 pt-2 text-[11px] text-gray-500">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-5 rounded border border-blue-200 bg-blue-50" />
          通常
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-5 rounded border border-orange-200 bg-orange-50" />
          講習
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-5 rounded border border-violet-200 bg-violet-50" />
          テスト対策・追加
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-5 rounded border border-emerald-200 bg-emerald-50" />
          体験
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-5 rounded border border-sky-200 bg-sky-50" />
          振替で入ったコマ
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-5 rounded border border-red-200 bg-red-50" />
          欠席
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="rounded bg-emerald-500 px-1 text-[9px] font-bold text-white">済</span>
          実施済
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="rounded bg-red-500 px-1 text-[9px] font-bold text-white">欠</span>
          欠席
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="rounded bg-gray-400 px-1 text-[9px] font-bold text-white">振</span>
          振替で移動した元のコマ
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="text-[9px] font-bold text-gray-500">1:1</span>
          1対1
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="rounded bg-gray-200 px-1 text-[9px] text-gray-600">前</span>
          <span className="rounded bg-gray-200 px-1 text-[9px] text-gray-600">後</span>
          45分授業の前半・後半
        </span>
      </div>
    </div>
  );
}
