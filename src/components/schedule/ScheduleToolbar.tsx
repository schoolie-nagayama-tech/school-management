'use client';

import Link from 'next/link';
import { useRef, useEffect, useState } from 'react';
import { Button } from '@/components/ui';
import { Settings, ChevronDown } from 'lucide-react';
import type { KoushuPeriodInfo } from '@/lib/api/koushu-period';

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
  // 追加授業（テスト対策）：期間は意識せず、全申込を1つの一覧で扱う
  hasTestPrep: boolean;
  testPrepActive: boolean;
  onWeekChange: (newWeekStart: Date) => void;
  onSettingsOpen: () => void;
  onVisibleDaysChange: (days: number[]) => void;
  onKoushuSelect: (period: KoushuPeriodInfo | null) => void;
  onTestPrepToggle: (active: boolean) => void;
}

export function ScheduleToolbar({
  weekStart,
  weekStartStr,
  schoolId,
  visibleDaysOfWeek,
  koushuList,
  selectedKoushu,
  hasTestPrep,
  testPrepActive,
  onWeekChange,
  onSettingsOpen,
  onVisibleDaysChange,
  onKoushuSelect,
  onTestPrepToggle,
}: ScheduleToolbarProps) {
  const [weekPickerOpen, setWeekPickerOpen] = useState(false);
  const weekPickerInputRef = useRef<HTMLInputElement>(null);
  // 「管理」メニューの開閉
  const [mgmtOpen, setMgmtOpen] = useState(false);

  // モードセレクトの現在値: '' = 通常 / 'k:<id>' = 講習期間 / 't' = テスト対策
  const modeValue = selectedKoushu ? `k:${selectedKoushu.id}` : testPrepActive ? 't' : '';
  const handleModeChange = (value: string) => {
    if (value === 't') {
      onKoushuSelect(null);
      onTestPrepToggle(true);
    } else if (value.startsWith('k:')) {
      const period = koushuList.find((k) => k.id === value.slice(2)) ?? null;
      onTestPrepToggle(false);
      onKoushuSelect(period);
    } else {
      onKoushuSelect(null);
      onTestPrepToggle(false);
    }
  };

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
              className="text-sm text-[var(--paragraph)] min-w-[180px] py-1 px-2 rounded-lg hover:bg-gray-100 transition-colors active:scale-[0.97] cursor-pointer"
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
                <label key={d.value} className="flex items-center gap-1 text-xs cursor-pointer">
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
          {/* モード切替：通常 / 講習(期間) / テスト対策。排他なので1つのセレクトに集約。 */}
          {(koushuList.length > 0 || hasTestPrep) && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-[var(--paragraph)]">モード:</span>
              <select
                value={modeValue}
                onChange={(e) => handleModeChange(e.target.value)}
                className="text-xs px-2 py-1 border border-[var(--stroke)] rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
              >
                <option value="">通常</option>
                {koushuList.length > 0 && (
                  <optgroup label="講習">
                    {koushuList.map((k) => (
                      <option key={k.id} value={`k:${k.id}`}>
                        {k.label}
                      </option>
                    ))}
                  </optgroup>
                )}
                {hasTestPrep && (
                  <optgroup label="テスト対策">
                    <option value="t">テスト対策（増コマ申込）</option>
                  </optgroup>
                )}
              </select>
              {selectedKoushu && (
                <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full font-medium">
                  講習モード
                </span>
              )}
              {testPrepActive && (
                <span className="text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full font-medium">
                  テスト対策モード
                </span>
              )}
            </div>
          )}

          {/* 管理メニュー：登録・設定系の遷移を1か所に集約 */}
          <div className="relative">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setMgmtOpen((v) => !v)}
              className="flex items-center gap-1"
            >
              管理
              <ChevronDown className="h-4 w-4 opacity-70" />
            </Button>
            {mgmtOpen && (
              <>
                {/* 外側クリックで閉じる透明バックドロップ */}
                <button
                  type="button"
                  aria-label="閉じる"
                  className="fixed inset-0 z-40 cursor-default"
                  onClick={() => setMgmtOpen(false)}
                />
                {/* dropdown-menu-right: 右起点の出現アニメ（globals.css） */}
                <div className="dropdown-menu dropdown-menu-right absolute right-0 mt-1 z-50 w-52 rounded-lg border border-[var(--stroke)] bg-white shadow-lg overflow-hidden py-1">
                  {[
                    { href: '/schedule/regular-patterns', label: '通塾日程の登録' },
                    { href: '/schedule/enrollments', label: '申込管理（講習・テスト対策）' },
                    { href: '/schedule/regular-patterns/match', label: '一括マッチング' },
                  ].map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMgmtOpen(false)}
                      className="block px-3 py-2 text-sm text-[var(--paragraph)] hover:bg-[var(--surface)]"
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
