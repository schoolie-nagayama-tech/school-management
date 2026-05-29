'use client';

/**
 * 集団授業カード（座席表の集団レーン用）
 *
 * 個別の TeacherCard（1講師2名・座席ラベル前提）とは構造が違うため別コンポーネント。
 * 1つの (日付・集団コマ・講師) を 1カード = 1クラスとして表示する。講師1名＋生徒最大 maxStudents 名。
 */

import React from 'react';
import { X } from 'lucide-react';
import type { ScheduleEntry } from '@/types/schedule';

interface Props {
  /** 同一 (date, slot, teacher) のエントリ群＝1クラス */
  entries: ScheduleEntry[];
  maxStudents: number;
  subjectNameById?: Map<string, string>;
  onStudentClick?: (entry: ScheduleEntry, e: React.MouseEvent) => void;
  onRemoveEntry?: (entry: ScheduleEntry) => void;
}

function gradeLabel(g: number): string {
  if (g <= 6) return `小${g}`;
  if (g <= 9) return `中${g - 6}`;
  return `高${g - 9}`;
}

export function GroupCard({ entries, maxStudents, subjectNameById, onStudentClick, onRemoveEntry }: Props) {
  if (entries.length === 0) return null;
  const teacher = entries[0].teacher;
  const teacherName = teacher?.display_name || teacher?.email || '担当未定';

  // 科目はクラス内の全エントリの和集合
  const subjectIds = Array.from(new Set(entries.flatMap((e) => e.subject_ids ?? [])));
  const subjectLabels = subjectNameById
    ? subjectIds.map((id) => subjectNameById.get(id)).filter((n): n is string => !!n)
    : [];

  const count = entries.length;
  const isFull = count >= maxStudents;

  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50/60 p-1.5">
      {/* ヘッダー: 講師 + 科目 + 人数 */}
      <div className="flex items-center gap-1 mb-1">
        <span className="text-[11px] font-semibold text-violet-900 truncate flex-1 min-w-0">
          {teacherName}
        </span>
        <span className={`text-[10px] tabular-nums ${isFull ? 'text-danger font-semibold' : 'text-violet-500'}`}>
          {count}/{maxStudents}
        </span>
      </div>
      {subjectLabels.length > 0 && (
        <div className="flex flex-wrap gap-0.5 mb-1">
          {subjectLabels.map((label) => (
            <span key={label} className="px-1 py-0 rounded text-[9px] leading-tight text-violet-700 bg-white border border-violet-100">
              {label}
            </span>
          ))}
        </div>
      )}
      {/* 生徒一覧 */}
      <div className="flex flex-wrap gap-0.5">
        {entries.map((e) => {
          const name = e.student ? `${e.student.last_name}${e.student.first_name}` : '—';
          const grade = e.student ? gradeLabel(e.student.grade) : '';
          return (
            <span
              key={e.id}
              className="group/std inline-flex items-center gap-0.5 px-1 py-0.5 rounded bg-white border border-violet-100 text-[10px] text-violet-900 cursor-pointer hover:border-violet-300"
              onClick={(ev) => onStudentClick?.(e, ev)}
              title={`${name}（${grade}）`}
            >
              {name}
              {onRemoveEntry && (
                <button
                  type="button"
                  onClick={(ev) => { ev.stopPropagation(); onRemoveEntry(e); }}
                  className="opacity-0 group-hover/std:opacity-100 text-violet-300 hover:text-danger transition-opacity"
                  aria-label="この生徒を外す"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}
