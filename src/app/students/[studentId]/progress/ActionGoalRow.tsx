'use client';

import type { ActionGoal } from '@/types/database';

export function ActionGoalRow({
  goal,
  isMeeting,
  onPatch,
  onDelete,
}: {
  goal: ActionGoal;
  isMeeting: boolean;
  onPatch: (patch: Partial<ActionGoal>) => void;
  onDelete: () => void;
}) {
  const toggleAchieved = () => onPatch({ achieved: !goal.achieved });
  const incCounter = () => {
    if (goal.counter_target == null) return;
    const next = Math.min(goal.counter_target, (goal.counter_current ?? 0) + 1);
    onPatch({ counter_current: next, achieved: next >= goal.counter_target });
  };
  const decCounter = () => {
    if (goal.counter_target == null) return;
    const next = Math.max(0, (goal.counter_current ?? 0) - 1);
    onPatch({
      counter_current: next,
      achieved: goal.counter_target != null && next >= goal.counter_target,
    });
  };

  return (
    <div className="flex items-center gap-2 bg-white rounded px-2 py-1.5 group">
      <button
        onClick={toggleAchieved}
        disabled={isMeeting}
        className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 text-xs transition-[background-color,border-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] ${
          goal.achieved ? 'bg-green-500 text-white' : 'bg-white border border-[#d1d5db]'
        } ${isMeeting ? 'cursor-default' : 'hover:border-[#1e3a5f] active:scale-[0.97]'}`}
      >
        {goal.achieved ? '✓' : ''}
      </button>
      <span
        className={`flex-1 text-sm ${goal.achieved ? 'line-through text-[#9ca3af]' : 'text-[#1f2937]'}`}
      >
        {goal.title}
      </span>
      {goal.counter_target != null && (
        <div className="flex items-center gap-1 bg-[#f3f4f6] rounded px-1 py-0.5">
          {!isMeeting && (
            <button
              onClick={decCounter}
              className="w-5 h-5 rounded hover:bg-white text-[#6b7280] text-xs transition-[background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]"
            >
              −
            </button>
          )}
          <span className="text-xs font-medium text-[#1f2937] font-mono min-w-[40px] text-center">
            {goal.counter_current ?? 0}/{goal.counter_target}
          </span>
          {!isMeeting && (
            <button
              onClick={incCounter}
              className="w-5 h-5 rounded hover:bg-white text-[#6b7280] text-xs transition-[background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]"
            >
              ＋
            </button>
          )}
        </div>
      )}
      {!isMeeting && (
        <button
          onClick={onDelete}
          className="w-6 h-6 rounded hover:bg-red-50 text-[#9ca3af] hover:text-red-600 text-xs opacity-0 group-hover:opacity-100 transition-[opacity,background-color,color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]"
          title="削除"
        >
          ✕
        </button>
      )}
    </div>
  );
}
