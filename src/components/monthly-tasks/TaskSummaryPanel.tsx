'use client';

import { useMemo, useState, useEffect, useCallback } from 'react';
import type { MonthlyTaskWithChecks, School } from '@/types/database';
import {
  AlertTriangle,
  Building2,
  Clock,
  Calendar as CalendarIcon,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  allDay: boolean;
}

interface TaskSummaryPanelProps {
  tasks: MonthlyTaskWithChecks[];
  schools: School[];
  year: number;
  month: number;
  googleCalendarId?: string; // connected email
}

function getToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function TaskSummaryPanel({
  tasks,
  schools,
  year,
  month,
  googleCalendarId,
}: TaskSummaryPanelProps) {
  const today = getToday();
  const weekLater = (() => {
    const d = new Date(today + 'T00:00:00');
    d.setDate(d.getDate() + 7);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  const schoolIds = schools.map(s => s.id);

  const stats = useMemo(() => {
    let totalChecks = 0;
    let completedChecks = 0;
    let overdueTasks = 0;

    for (const task of tasks) {
      let allDone = true;
      for (const sid of schoolIds) {
        totalChecks++;
        const check = task.checks.find(c => c.school_id === sid);
        if (check?.is_completed) {
          completedChecks++;
        } else {
          allDone = false;
        }
      }
      if (task.task_date < today && !allDone) {
        overdueTasks++;
      }
    }

    const percent = totalChecks > 0 ? Math.round((completedChecks / totalChecks) * 100) : 0;
    return { totalChecks, completedChecks, percent, overdueTasks, totalTasks: tasks.length };
  }, [tasks, schoolIds, today]);

  const schoolProgress = useMemo(() => {
    return schools.map(school => {
      const total = tasks.length;
      const completed = tasks.filter(t =>
        t.checks.find(c => c.school_id === school.id)?.is_completed
      ).length;
      const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
      return { school, total, completed, percent };
    });
  }, [tasks, schools]);

  const upcomingTasks = useMemo(() => {
    return tasks.filter(t => {
      if (t.task_date < today || t.task_date > weekLater) return false;
      const allDone = schoolIds.every(sid =>
        t.checks.find(c => c.school_id === sid)?.is_completed
      );
      return !allDone;
    }).sort((a, b) => a.task_date.localeCompare(b.task_date));
  }, [tasks, today, weekLater, schoolIds]);

  // Google Calendar events
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);

  const fetchCalendarEvents = useCallback(async () => {
    if (!googleCalendarId) return;
    setCalendarLoading(true);
    setCalendarError(null);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session) return;
      const timeMin = `${year}-${String(month).padStart(2, '0')}-01T00:00:00+09:00`;
      const lastDay = new Date(year, month, 0).getDate();
      const timeMax = `${year}-${String(month).padStart(2, '0')}-${lastDay}T23:59:59+09:00`;
      const res = await fetch(
        `/api/integrations/google/calendar/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`,
        { headers: { Authorization: `Bearer ${session.access_token}` } }
      );
      if (res.ok) {
        const { data } = await res.json();
        setCalendarEvents(data || []);
      } else {
        const err = await res.json();
        setCalendarError(err.error || '取得に失敗しました');
      }
    } catch {
      setCalendarError('カレンダーの取得に失敗しました');
    } finally {
      setCalendarLoading(false);
    }
  }, [googleCalendarId, year, month]);

  useEffect(() => {
    fetchCalendarEvents();
  }, [fetchCalendarEvents]);

  // 週間表示用 state
  const [weekOffset, setWeekOffset] = useState(0); // 0=今週, -1=先週, +1=来週

  // 今週の月曜日を基準に weekOffset 分ずらした週の日付配列 (月〜日)
  const weekDays = useMemo(() => {
    const d = new Date(today + 'T00:00:00');
    const dayOfWeek = d.getDay(); // 0=日
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    d.setDate(d.getDate() + mondayOffset + weekOffset * 7);
    const days: string[] = [];
    for (let i = 0; i < 7; i++) {
      const dd = new Date(d);
      dd.setDate(d.getDate() + i);
      days.push(`${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, '0')}-${String(dd.getDate()).padStart(2, '0')}`);
    }
    return days;
  }, [today, weekOffset]);

  // Group calendar events by date
  const eventsByDate = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {};
    for (const evt of calendarEvents) {
      const dateStr = evt.allDay ? evt.start : evt.start.slice(0, 10);
      if (!map[dateStr]) map[dateStr] = [];
      map[dateStr].push(evt);
    }
    return map;
  }, [calendarEvents]);

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3 flex-shrink-0">
        {/* Overall progress */}
        <div className="bg-white rounded-lg border border-gray-200 p-3">
          <div className="text-[10px] text-gray-500 mb-1">全体進捗</div>
          <div className="flex items-end gap-2">
            <span className="text-2xl font-bold text-gray-800">{stats.percent}%</span>
            <span className="text-xs text-gray-400 pb-1">
              {stats.completedChecks}/{stats.totalChecks}
            </span>
          </div>
          <div className="mt-2 h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                stats.percent >= 80 ? 'bg-green-500' : stats.percent >= 50 ? 'bg-yellow-500' : 'bg-[#d32f2f]'
              }`}
              style={{ width: `${stats.percent}%` }}
            />
          </div>
        </div>

        {/* Overdue */}
        <div className={`rounded-lg border p-3 ${
          stats.overdueTasks > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'
        }`}>
          <div className="text-[10px] text-gray-500 mb-1">超過タスク</div>
          <div className="flex items-end gap-2">
            <span className={`text-2xl font-bold ${stats.overdueTasks > 0 ? 'text-red-600' : 'text-gray-800'}`}>
              {stats.overdueTasks}
            </span>
            <span className="text-xs text-gray-400 pb-1">件</span>
          </div>
          {stats.overdueTasks > 0 && (
            <div className="mt-1 text-[10px] text-red-500 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              早めに対応してください
            </div>
          )}
        </div>

        {/* School progress */}
        <div className="bg-white rounded-lg border border-gray-200 p-3">
          <div className="text-[10px] text-gray-500 mb-1.5 flex items-center gap-1">
            <Building2 className="w-3 h-3" />
            教室別進捗
          </div>
          {schoolProgress.length === 0 ? (
            <div className="text-xs text-gray-400">教室なし</div>
          ) : (
            schoolProgress.map(({ school, completed, total, percent }) => (
              <div key={school.id} className="flex items-center gap-2 mb-1">
                <span className="text-[11px] text-gray-600 w-14 truncate">{school.name}</span>
                <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      percent >= 80 ? 'bg-green-500' : percent >= 50 ? 'bg-yellow-500' : 'bg-red-400'
                    }`}
                    style={{ width: `${percent}%` }}
                  />
                </div>
                <span className="text-[10px] text-gray-400 w-10 text-right">{completed}/{total}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Upcoming tasks */}
      <div className="bg-white rounded-lg border border-gray-200 p-3 flex-shrink-0">
        <div className="flex items-center gap-1.5 mb-2">
          <Clock className="w-3.5 h-3.5 text-gray-500" />
          <span className="text-xs font-bold text-gray-600">今後7日間のタスク</span>
          <span className="text-[10px] text-gray-400">({upcomingTasks.length}件)</span>
        </div>
        {upcomingTasks.length === 0 ? (
          <div className="text-xs text-gray-400">今後7日間に未完了タスクはありません</div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {upcomingTasks.map(task => {
              const dayNum = parseInt(task.task_date.split('-')[2]);
              return (
                <div
                  key={task.id}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded text-[11px] border ${
                    task.category === 'business'
                      ? 'bg-orange-50 border-orange-200 text-orange-700'
                      : 'bg-purple-50 border-purple-200 text-purple-700'
                  }`}
                >
                  <span className="font-medium">{dayNum}日</span>
                  <span>{task.task_name}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Google Calendar - 週間表示 */}
      <div className="flex-1 bg-white rounded-lg border border-gray-200 overflow-hidden min-h-[200px] flex flex-col">
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-3 py-1.5 border-b bg-gray-50 flex-shrink-0">
          <div className="flex items-center gap-1.5">
            <CalendarIcon className="w-3.5 h-3.5 text-gray-500" />
            <span className="text-xs font-bold text-gray-600">Googleカレンダー</span>
          </div>
          {googleCalendarId && (
            <div className="flex items-center gap-1.5">
              <button onClick={() => setWeekOffset(w => w - 1)} className="px-1 py-0.5 text-gray-400 hover:text-gray-600 text-xs">◀</button>
              <button
                onClick={() => setWeekOffset(0)}
                className={`px-2 py-0.5 text-[10px] rounded transition-colors ${weekOffset === 0 ? 'bg-blue-100 text-blue-700 font-bold' : 'text-gray-500 hover:bg-gray-100'}`}
              >
                今週
              </button>
              <button onClick={() => setWeekOffset(w => w + 1)} className="px-1 py-0.5 text-gray-400 hover:text-gray-600 text-xs">▶</button>
              <span className="w-px h-3 bg-gray-200" />
              <button
                onClick={fetchCalendarEvents}
                disabled={calendarLoading}
                className="text-gray-400 hover:text-gray-600 transition-colors"
                title="更新"
              >
                <RefreshCw className={`w-3 h-3 ${calendarLoading ? 'animate-spin' : ''}`} />
              </button>
              <a
                href={`https://calendar.google.com/calendar/r/week/${weekDays[0].replace(/-/g, '/')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:text-blue-800"
                title="Googleカレンダーで開く"
              >
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}
        </div>

        {/* カレンダー本体 */}
        <div className="flex-1 overflow-hidden">
          {!googleCalendarId ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400 p-6">
              <CalendarIcon className="w-10 h-10 mb-2 text-gray-300" />
              <div className="text-xs font-medium mb-1">Googleカレンダー未連携</div>
              <div className="text-[11px] text-center max-w-[280px]">
                アカウント設定からGoogleカレンダーを連携すると、ここに予定が表示されます。
              </div>
            </div>
          ) : calendarLoading ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : calendarError ? (
            <div className="flex flex-col items-center justify-center h-32 text-gray-400 p-4">
              <div className="text-xs text-red-500 mb-2">{calendarError}</div>
              <button onClick={fetchCalendarEvents} className="text-[11px] text-blue-600 hover:text-blue-800">再試行</button>
            </div>
          ) : (
            <div className="grid grid-cols-7 h-full">
              {weekDays.map((dateStr, i) => {
                const d = new Date(dateStr + 'T00:00:00');
                const dayNum = d.getDate();
                const dow = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
                const isToday = dateStr === today;
                const isSun = d.getDay() === 0;
                const isSat = d.getDay() === 6;
                const events = (eventsByDate[dateStr] || []).sort((a, b) => {
                  if (a.allDay && !b.allDay) return -1;
                  if (!a.allDay && b.allDay) return 1;
                  return a.start.localeCompare(b.start);
                });

                return (
                  <div
                    key={dateStr}
                    className={`flex flex-col border-r last:border-r-0 ${
                      isToday ? 'bg-blue-50/50' : ''
                    } ${i === 0 ? '' : ''}`}
                  >
                    {/* 曜日ヘッダー */}
                    <div className={`text-center py-1 border-b text-[10px] font-medium ${
                      isToday ? 'bg-blue-100 text-blue-700' :
                      isSun ? 'text-red-500 bg-gray-50' :
                      isSat ? 'text-blue-500 bg-gray-50' :
                      'text-gray-500 bg-gray-50'
                    }`}>
                      <div>{dow}</div>
                      <div className={`text-sm font-bold leading-tight ${
                        isToday ? 'text-blue-700' : 'text-gray-700'
                      }`}>
                        {dayNum}
                      </div>
                    </div>
                    {/* イベント */}
                    <div className="flex-1 overflow-y-auto p-0.5 space-y-0.5">
                      {events.map(evt => {
                        const timeStr = evt.allDay
                          ? ''
                          : new Date(evt.start).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', hour12: false });
                        return (
                          <div
                            key={evt.id}
                            className={`rounded px-1 py-0.5 text-[10px] leading-tight truncate cursor-default ${
                              evt.allDay
                                ? 'bg-blue-100 text-blue-800 font-medium'
                                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            }`}
                            title={`${timeStr ? timeStr + ' ' : ''}${evt.summary}`}
                          >
                            {timeStr && <span className="text-gray-400 mr-0.5">{timeStr}</span>}
                            {evt.summary}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
