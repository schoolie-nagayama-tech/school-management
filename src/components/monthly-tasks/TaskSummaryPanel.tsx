'use client';

import { useMemo } from 'react';
import type { MonthlyTaskWithChecks, School } from '@/types/database';
import {
  AlertTriangle,
  Building2,
  Clock,
  Calendar as CalendarIcon,
  ExternalLink,
} from 'lucide-react';

interface TaskSummaryPanelProps {
  tasks: MonthlyTaskWithChecks[];
  schools: School[];
  year: number;
  month: number;
  googleCalendarId?: string;
}

function getToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function addDays(dateStr: string, days: number) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function TaskSummaryPanel({
  tasks,
  schools,
  year,
  month,
  googleCalendarId,
}: TaskSummaryPanelProps) {
  const today = getToday();
  const weekLater = addDays(today, 7);
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

  // Google Calendar embed URL
  const calendarSrc = googleCalendarId
    ? `https://calendar.google.com/calendar/embed?src=${encodeURIComponent(googleCalendarId)}&ctz=Asia%2FTokyo&mode=MONTH&showTitle=0&showNav=0&showDate=0&showPrint=0&showTabs=0&showCalendars=0&wkst=2`
    : null;

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

      {/* Google Calendar area */}
      <div className="flex-1 bg-white rounded-lg border border-gray-200 overflow-hidden min-h-[300px] flex flex-col">
        <div className="flex items-center justify-between px-3 py-2 border-b bg-gray-50 flex-shrink-0">
          <div className="flex items-center gap-1.5">
            <CalendarIcon className="w-3.5 h-3.5 text-gray-500" />
            <span className="text-xs font-bold text-gray-600">Googleカレンダー</span>
          </div>
          {calendarSrc && (
            <a
              href={`https://calendar.google.com/calendar/r/month/${year}/${month}/1`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-[10px] text-blue-600 hover:text-blue-800"
            >
              <ExternalLink className="w-3 h-3" />
              カレンダーを開く
            </a>
          )}
        </div>
        <div className="flex-1">
          {calendarSrc ? (
            <iframe
              src={calendarSrc}
              className="w-full h-full border-0"
              title="Google Calendar"
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-gray-400 p-6">
              <CalendarIcon className="w-12 h-12 mb-3 text-gray-300" />
              <div className="text-sm font-medium mb-1">Googleカレンダー未設定</div>
              <div className="text-xs text-center max-w-[300px]">
                Googleカレンダーを連携するには、カレンダーIDを設定してください。
                カレンダーの設定から「カレンダーの統合」&rarr;「カレンダーID」を取得できます。
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
