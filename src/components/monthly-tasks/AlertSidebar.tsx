'use client';

import { useMemo } from 'react';
import type { MonthlyTaskWithChecks, School } from '@/types/database';
import { AlertTriangle, Clock, CalendarCheck, Building2 } from 'lucide-react';

interface AlertSidebarProps {
  tasks: MonthlyTaskWithChecks[];
  schools: School[];
  year: number;
  month: number;
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDate();
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  return `${d.getMonth() + 1}/${day}(${weekdays[d.getDay()]})`;
}

export function AlertSidebar({ tasks, schools }: AlertSidebarProps) {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

  const schoolIds = useMemo(() => schools.map((s) => s.id), [schools]);

  // タスクが該当教室で未完了かチェック
  const isIncomplete = (task: MonthlyTaskWithChecks) => {
    return schoolIds.some((sid) => {
      const check = task.checks.find((c) => c.school_id === sid);
      return !check || !check.is_completed;
    });
  };

  const overdueTasks = useMemo(
    () => tasks.filter((t) => t.task_date < todayStr && isIncomplete(t)),
    [tasks, todayStr, schoolIds]
  );

  const todayTasks = useMemo(
    () => tasks.filter((t) => t.task_date === todayStr),
    [tasks, todayStr]
  );

  const tomorrowTasks = useMemo(
    () => tasks.filter((t) => t.task_date === tomorrowStr),
    [tasks, tomorrowStr]
  );

  // 教室別進捗
  const schoolProgress = useMemo(() => {
    return schools.map((school) => {
      const total = tasks.length;
      const completed = tasks.filter((t) => {
        const check = t.checks.find((c) => c.school_id === school.id);
        return check?.is_completed;
      }).length;
      return {
        school,
        total,
        completed,
        percent: total > 0 ? Math.round((completed / total) * 100) : 0,
      };
    });
  }, [tasks, schools]);

  return (
    <div className="space-y-3">
      {/* 超過タスク */}
      {overdueTasks.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <AlertTriangle className="w-4 h-4 text-red-600" />
            <h3 className="text-xs font-bold text-red-700">
              期日超過 ({overdueTasks.length})
            </h3>
          </div>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {overdueTasks.map((task) => {
              const incompleteSchools = schools.filter((s) => {
                const check = task.checks.find((c) => c.school_id === s.id);
                return !check || !check.is_completed;
              });
              return (
                <div
                  key={task.id}
                  className="text-xs p-1.5 bg-white rounded border border-red-100"
                >
                  <div className="font-medium text-red-800 truncate">
                    {task.task_name}
                  </div>
                  <div className="text-red-500 mt-0.5 flex items-center justify-between">
                    <span>{formatDate(task.task_date)}</span>
                    <span className="text-[10px]">
                      未: {incompleteSchools.map((s) => s.name.slice(0, 3)).join(', ')}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 今日のタスク */}
      <div className={`border rounded-lg p-3 ${todayTasks.length > 0 ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-gray-200'}`}>
        <div className="flex items-center gap-1.5 mb-2">
          <Clock className="w-4 h-4 text-blue-600" />
          <h3 className="text-xs font-bold text-blue-700">
            今日 ({todayTasks.length})
          </h3>
        </div>
        {todayTasks.length > 0 ? (
          <div className="space-y-1.5 max-h-36 overflow-y-auto">
            {todayTasks.map((task) => {
              const allDone = schoolIds.every((sid) => {
                const check = task.checks.find((c) => c.school_id === sid);
                return check?.is_completed;
              });
              return (
                <div
                  key={task.id}
                  className={`text-xs p-1.5 bg-white rounded border ${
                    allDone ? 'border-green-200 text-gray-400 line-through' : 'border-blue-100'
                  }`}
                >
                  <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${
                    task.category === 'business' ? 'bg-orange-400' : 'bg-purple-400'
                  }`} />
                  {task.task_name}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-gray-400">タスクなし</p>
        )}
      </div>

      {/* 明日のタスク */}
      {tomorrowTasks.length > 0 && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <CalendarCheck className="w-4 h-4 text-gray-500" />
            <h3 className="text-xs font-bold text-gray-600">
              明日 ({tomorrowTasks.length})
            </h3>
          </div>
          <div className="space-y-1 max-h-28 overflow-y-auto">
            {tomorrowTasks.map((task) => (
              <div key={task.id} className="text-xs text-gray-500 truncate">
                <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${
                  task.category === 'business' ? 'bg-orange-400' : 'bg-purple-400'
                }`} />
                {task.task_name}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 教室別進捗 */}
      {schoolProgress.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <Building2 className="w-4 h-4 text-gray-500" />
            <h3 className="text-xs font-bold text-gray-600">教室別進捗</h3>
          </div>
          <div className="space-y-2">
            {schoolProgress.map(({ school, completed, total, percent }) => (
              <div key={school.id}>
                <div className="flex items-center justify-between text-xs mb-0.5">
                  <span className="text-gray-600 truncate max-w-[100px]">
                    {school.name}
                  </span>
                  <span className="text-gray-500">
                    {completed}/{total} ({percent}%)
                  </span>
                </div>
                <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-[width] duration-500 ease-out ${
                      percent >= 80 ? 'bg-green-500' : percent >= 50 ? 'bg-yellow-500' : 'bg-red-400'
                    }`}
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
