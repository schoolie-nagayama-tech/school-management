'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getProgressWidget,
  toggleCheck,
  type ProgressWidgetData,
  type ProgressWidgetTask,
} from '@/lib/api/monthlyTasks';
import { AlertTriangle, ArrowRight, Check, ListTodo, Trophy } from 'lucide-react';
import Link from 'next/link';

function formatDate(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getMonth() + 1}/${d.getDate()}(${['日','月','火','水','木','金','土'][d.getDay()]})`;
}

const CELEBRATION_STYLE_ID = 'task-progress-celebration';
const CELEBRATION_CSS = `
@keyframes confetti-burst {
  0% { transform: translate(-50%, -50%) scale(0); opacity: 1; }
  60% { opacity: 1; }
  100% { transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(1); opacity: 0; }
}
@keyframes badge-pop {
  0% { transform: scale(0) rotate(-12deg); opacity: 0; }
  60% { transform: scale(1.15) rotate(2deg); opacity: 1; }
  100% { transform: scale(1) rotate(0deg); opacity: 1; }
}
@keyframes bar-shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
`;

const PARTICLE_COUNT = 24;

function CompletionParticles() {
  const particles = useRef(
    Array.from({ length: PARTICLE_COUNT }, (_, i) => {
      const angle = (i / PARTICLE_COUNT) * 360;
      const distance = 40 + Math.random() * 60;
      const dx = Math.cos((angle * Math.PI) / 180) * distance;
      const dy = Math.sin((angle * Math.PI) / 180) * distance - 20;
      const size = 3 + Math.random() * 4;
      const delay = Math.random() * 0.3;
      const colors = ['#22c55e', '#eab308', '#3b82f6', '#f97316', '#a855f7'];
      const color = colors[i % colors.length];
      return { dx, dy, size, delay, color };
    })
  ).current;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {particles.map((p, i) => (
        <span
          key={i}
          className="absolute left-1/2 top-1/2 rounded-full"
          style={{
            width: p.size,
            height: p.size,
            backgroundColor: p.color,
            '--dx': `${p.dx}px`,
            '--dy': `${p.dy}px`,
            animation: `confetti-burst 0.8s ease-out ${p.delay}s forwards`,
            opacity: 0,
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
}

function TaskCheckbox({
  task,
  onComplete,
}: {
  task: ProgressWidgetTask;
  onComplete: (task: ProgressWidgetTask) => void;
}) {
  const [completing, setCompleting] = useState(false);
  const [done, setDone] = useState(false);

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (completing || done) return;
    setCompleting(true);
    try {
      await Promise.all(
        task.incompleteSchoolIds.map((sid) => toggleCheck(task.id, sid, true))
      );
      setDone(true);
      setTimeout(() => onComplete(task), 300);
    } catch {
      setCompleting(false);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={completing || done}
      className={`flex-shrink-0 w-4 h-4 rounded border transition-all duration-200 flex items-center justify-center ${
        done
          ? 'bg-green-500 border-green-500'
          : completing
            ? 'bg-gray-200 border-gray-300 animate-pulse'
            : task.overdue
              ? 'border-red-300 hover:border-red-500 hover:bg-red-50'
              : task.category === 'business'
                ? 'border-orange-300 hover:border-orange-500 hover:bg-orange-50'
                : 'border-purple-300 hover:border-purple-500 hover:bg-purple-50'
      }`}
      title="完了にする"
    >
      {done && <Check className="w-3 h-3 text-white" />}
    </button>
  );
}

export function TaskProgressWidget() {
  const [data, setData] = useState<ProgressWidgetData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showCelebration, setShowCelebration] = useState(false);

  useEffect(() => {
    if (!document.getElementById(CELEBRATION_STYLE_ID)) {
      const style = document.createElement('style');
      style.id = CELEBRATION_STYLE_ID;
      style.textContent = CELEBRATION_CSS;
      document.head.appendChild(style);
    }
    return () => {
      document.getElementById(CELEBRATION_STYLE_ID)?.remove();
    };
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const result = await getProgressWidget();
      setData(result);
      if (result.allComplete) {
        setShowCelebration(true);
      }
    } catch {
      // non-critical
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleComplete = useCallback((completed: ProgressWidgetTask) => {
    setData((prev) => {
      if (!prev) return prev;
      const remaining = prev.tasks.filter((t) => t.id !== completed.id);
      if (remaining.length === 0) {
        setShowCelebration(true);
        return { allComplete: true, tasks: [] };
      }
      return { ...prev, tasks: remaining };
    });
  }, []);

  if (isLoading) {
    return (
      <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
        <div className="h-10 animate-pulse rounded bg-gray-100" />
      </div>
    );
  }

  if (!data) return null;

  const now = new Date();
  const monthLabel = `${now.getMonth() + 1}月`;

  if (data.allComplete) {
    return (
      <div className="relative mb-4 rounded-xl border border-green-300 bg-gradient-to-r from-green-50 via-emerald-50 to-green-50 shadow-sm overflow-hidden">
        {showCelebration && <CompletionParticles />}
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-600 text-white text-xs font-bold"
              style={{ animation: 'badge-pop 0.5s ease-out 0.2s both' }}
            >
              <Trophy className="w-3.5 h-3.5" />
              {monthLabel}の業務 全完了
            </span>
          </div>
          <Link
            href="/tasks"
            className="flex items-center gap-1 text-xs text-green-700 hover:text-green-900 font-medium transition-colors"
          >
            業務進捗を見る
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
        <div
          className="h-1"
          style={{
            background: 'linear-gradient(90deg, #22c55e 0%, #4ade80 40%, #86efac 50%, #4ade80 60%, #22c55e 100%)',
            backgroundSize: '200% 100%',
            animation: 'bar-shimmer 2s linear infinite',
          }}
        />
      </div>
    );
  }

  const overdueTasks = data.tasks.filter((t) => t.overdue);
  const upcomingTasks = data.tasks.filter((t) => !t.overdue);

  return (
    <div className="mb-4 rounded-xl border border-gray-200 bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <ListTodo className="w-4 h-4 text-gray-500" />
          <span className="text-sm font-bold text-gray-700">業務進捗</span>
          <span className="text-xs text-gray-400">{monthLabel}</span>
          <span className="text-[10px] text-gray-400">
            残 {data.tasks.length}件
          </span>
        </div>
        <Link
          href="/tasks"
          className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium transition-colors"
        >
          詳細を見る
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      {/* Task list */}
      <div className="px-4 py-2.5 flex flex-wrap gap-1.5">
        {overdueTasks.map((task) => (
          <span
            key={task.id}
            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-red-200 bg-red-50 text-[11px]"
          >
            <TaskCheckbox task={task} onComplete={handleComplete} />
            <AlertTriangle className="w-3 h-3 text-red-500 flex-shrink-0" />
            <span className="font-medium text-red-600">{formatDate(task.task_date)}</span>
            <span className="text-red-700 max-w-[120px] truncate">{task.task_name}</span>
          </span>
        ))}
        {upcomingTasks.map((task) => (
          <span
            key={task.id}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] border ${
              task.category === 'business'
                ? 'bg-orange-50 border-orange-200 text-orange-700'
                : 'bg-purple-50 border-purple-200 text-purple-700'
            }`}
          >
            <TaskCheckbox task={task} onComplete={handleComplete} />
            <span className="font-medium">{formatDate(task.task_date)}</span>
            <span className="max-w-[120px] truncate">{task.task_name}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
