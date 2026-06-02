'use client';

import Link from 'next/link';
import { useRef, useEffect, useState } from 'react';
import { Button } from '@/components/ui';
import { Settings, ChevronDown, GraduationCap, BookPlus } from 'lucide-react';
import type { KoushuPeriodInfo } from '@/lib/api/koushu-period';
import type { ZoukomaPlacementPeriod } from '@/lib/api/zoukoma-placement';

const DAY_LABELS: { value: number; label: string }[] = [
  { value: 0, label: '日' },
  { value: 1, label: '月' },
  { value: 2, label: '火' },
  { value: 3, label: '水' },
  { value: 4, label: '木' },
  { value: 5, label: '金' },
  { value: 6, label: '土' },
];

function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getWeekStart(d: Date): Date {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const start = new Date(d);
  start.setDate(d.getDate() + diff);
  start.setHours(0, 0, 0, 0);
  return start;
}

function formatWeekLabel(start: Date): string {
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const sameMonth =
    start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth();
  if (sameMonth) {
    return `${start.getFullYear()}年${start.getMonth() + 1}月 ${start.getDate()}〜${end.getDate()}日`;
  }
  return `${start.getFullYear()}年${start.getMonth() + 1}月${start.getDate()}日〜${end.getFullYear()}年${end.getMonth() + 1}月${end.getDate()}日`;
}

interface ScheduleToolbarProps {
  weekStart: Date;
  weekStartStr: string;
  schoolId: string;
  visibleDaysOfWeek: number[];
  // 講習選択は course_prep_periods (春期/夏期/冬期 × 年) ベース。
  // seasonal_courses は座席表とは独立した「生徒別プラン」のためここでは扱わない。
  koushuList: KoushuPeriodInfo[];
  selectedKoushu: KoushuPeriodInfo | null;
  // 追加授業（テスト対策）= 増コマ申込期間ベース
  zoukomaList: ZoukomaPlacementPeriod[];
  selectedZoukoma: ZoukomaPlacementPeriod | null;
  onWeekChange: (newWeekStart: Date) => void;
  onSettingsOpen: () => void;
  onVisibleDaysChange: (days: number[]) => void;
  onKoushuSelect: (period: KoushuPeriodInfo | null) => void;
  onZoukomaSelect: (period: ZoukomaPlacementPeriod | null) => void;
}

export function ScheduleToolbar({
  weekStart,
  weekStartStr,
  schoolId,
  visibleDaysOfWeek,
  koushuList,
  selectedKoushu,
  zoukomaList,
  selectedZoukoma,
  onWeekChange,
  onSettingsOpen,
  onVisibleDaysChange,
  onKoushuSelect,
  onZoukomaSelect,
}: ScheduleToolbarProps) {
  const [weekPickerOpen, setWeekPickerOpen] = useState(false);
  const weekPickerInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (weekPickerOpen && weekPickerInputRef.current?.showPicker) {
      weekPickerInputRef.current.showPicker();
    }
  }, [weekPickerOpen]);

  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              const prev = new Date(weekStart);
              prev.setDate(prev.getDate() - 7);
              onWeekChange(prev);
            }}
          >
            前週
          </Button>
          {weekPickerOpen ? (
            <input
              ref={weekPickerInputRef}
              type="date"
              value={toLocalDateStr(weekStart)}
              onChange={(e) => {
                const val = e.target.value;
                if (val) {
                  onWeekChange(getWeekStart(new Date(val + 'T12:00:00')));
                  setWeekPickerOpen(false);
                }
              }}
              onBlur={() => setWeekPickerOpen(false)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setWeekPickerOpen(false);
              }}
              autoFocus
              className="min-w-[180px] py-1 px-2 text-sm border border-gray-200 rounded-lg text-[var(--paragraph)] focus:ring-2 focus:ring-gray-300 focus:border-gray-300 focus:outline-none"
              title="週を選択"
            />
          ) : (
            <button
              type="button"
              onClick={() => setWeekPickerOpen(true)}
              className="text-sm text-[var(--paragraph)] min-w-[180px] py-1 px-2 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
              title="クリックで週を選択"
            >
              {formatWeekLabel(weekStart)}
            </button>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              const next = new Date(weekStart);
              next.setDate(next.getDate() + 7);
              onWeekChange(next);
            }}
          >
            次週
          </Button>
          {weekStartStr !== toLocalDateStr(getWeekStart(new Date())) && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onWeekChange(getWeekStart(new Date()))}
            >
              今週
            </Button>
          )}
        </div>
        {schoolId && (
          <Button
            variant="secondary"
            size="sm"
            onClick={onSettingsOpen}
            className="flex items-center gap-1"
          >
            <Settings className="h-4 w-4" />
            座席表の設定
            <ChevronDown className="h-4 w-4 opacity-70" />
          </Button>
        )}
        {schoolId && (
          <>
            <span className="text-sm text-[var(--paragraph)] ml-1">表示曜日:</span>
            <div className="flex flex-wrap items-center gap-1">
              {DAY_LABELS.map((d) => (
                <label
                  key={d.value}
                  className="flex items-center gap-1 text-xs cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={visibleDaysOfWeek.includes(d.value)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        onVisibleDaysChange([...visibleDaysOfWeek, d.value].sort((a, b) => a - b));
                      } else {
                        onVisibleDaysChange(visibleDaysOfWeek.filter((x) => x !== d.value));
                      }
                    }}
                    className="rounded border-[var(--stroke)]"
                  />
                  <span className="text-[var(--headline)]">{d.label}</span>
                </label>
              ))}
            </div>
          </>
        )}
      </div>
      {schoolId && (
        <div className="flex items-center gap-2 flex-wrap">
          <Link href="/schedule/regular-patterns">
            <Button variant="secondary" size="sm">
              通塾日程
            </Button>
          </Link>
          <Link href="/schedule/koushu">
            <Button variant="secondary" size="sm" className="flex items-center gap-1">
              <GraduationCap className="h-3.5 w-3.5" />
              講習管理
            </Button>
          </Link>
          {/* 追加授業（テスト対策）の生徒別 増コマ登録画面への導線。講習管理の隣に置く。 */}
          <Link href="/schedule/zoukoma">
            <Button variant="secondary" size="sm" className="flex items-center gap-1">
              <BookPlus className="h-3.5 w-3.5" />
              追加授業設定
            </Button>
          </Link>
          {/* 追加授業（テスト対策）モード切替：増コマ申込期間から選択。
              選ぶと座席表上部に配置パネルが出て、増コマ申込を test_prep コマとして落とし込める。 */}
          {zoukomaList.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-[var(--paragraph)]">テスト対策:</span>
              <select
                value={selectedZoukoma?.id ?? ''}
                onChange={(e) => {
                  const period = zoukomaList.find((z) => z.id === e.target.value) ?? null;
                  onZoukomaSelect(period);
                }}
                className="text-xs px-2 py-1 border border-[var(--stroke)] rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
              >
                <option value="">通常</option>
                {zoukomaList.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.label}
                  </option>
                ))}
              </select>
              {selectedZoukoma && (
                <span className="text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full font-medium">
                  追加授業モード
                </span>
              )}
            </div>
          )}
          {/* 講習モード切替（期間ベース）
              course_prep_periods で start/end_date が設定された春期/夏期/冬期から選択。 */}
          {koushuList.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-[var(--paragraph)]">講習:</span>
              <select
                value={selectedKoushu?.id ?? ''}
                onChange={(e) => {
                  const period = koushuList.find((k) => k.id === e.target.value) ?? null;
                  onKoushuSelect(period);
                }}
                className="text-xs px-2 py-1 border border-[var(--stroke)] rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
              >
                <option value="">通常</option>
                {koushuList.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.label}
                  </option>
                ))}
              </select>
              {selectedKoushu && (
                <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full font-medium">
                  講習モード
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
