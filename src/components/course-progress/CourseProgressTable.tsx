'use client';

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import type { Student, CourseProgressItem, StudentCourseProgress, ApplicationStatus } from '@/types/database';
import { GRADE_LABELS, PROGRESS_COLUMN_GROUPS } from '@/types/database';
import type { AutoValues } from '@/lib/api/courseProgress';
import { Tooltip } from '@/components/ui/Tooltip';

/** auto_source の表示名と簡易説明 */
const AUTO_SOURCE_LABELS: Record<string, { label: string; desc: string }> = {
  regular_weekly: { label: '通塾回数/週', desc: '通塾パターンから自動計算' },
  course_sessions: { label: '講習期間通常回数', desc: '講習期間中の通塾回数を自動計算' },
  proposed_extra: { label: '提示増コマ', desc: '教科別計 - 通常回数' },
  subject_proposal: { label: '進行表コマ数', desc: '進行表の提案コマ数を科目名で自動集計' },
};

interface CourseProgressTableProps {
  students: Student[];
  items: CourseProgressItem[];
  progressData: StudentCourseProgress[];
  autoValues?: AutoValues;
  canEdit: boolean;
  onStatusChange: (studentId: string, itemId: string, status: ApplicationStatus | null) => void;
  onNumberChange: (studentId: string, itemId: string, value: number | null) => void;
  onDateChange: (studentId: string, itemId: string, value: string | null) => void;
  onItemNameChange?: (itemId: string, name: string) => void;
  onItemDeadlineChange?: (itemId: string, deadline: string | null) => void;
}

function nextStatus(current: ApplicationStatus | null | undefined): ApplicationStatus | null {
  if (!current) return 'completed';
  if (current === 'completed') return 'not_applicable';
  if (current === 'not_applicable') return null;
  // pending(旧データ)は完了扱いにする
  if (current === 'pending') return 'completed';
  return null;
}

function formatDeadline(deadline: string | null): string {
  if (!deadline) return '';
  const d = new Date(deadline);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 科目名マッチング: auto_source='subject_proposal' の列に対して、科目名→コマ数を返す */
function getSubjectProposalValue(
  subjectProposals: Record<string, number> | undefined,
  itemName: string
): number {
  if (!subjectProposals) return 0;
  // 完全一致
  if (subjectProposals[itemName] !== undefined) return subjectProposals[itemName];
  // 列名に科目名が含まれるか（例: "提示コマ(英語)" に "英語" が含まれる）
  for (const [subject, count] of Object.entries(subjectProposals)) {
    if (itemName.includes(subject)) return count;
  }
  return 0;
}

// ヒートマップセルの色を返す
function getCellStyle(
  item: CourseProgressItem,
  status: ApplicationStatus | null | undefined,
  numberValue: number | null | undefined,
  groupColor: string
): { bg: string; text: string; border: string } {
  if (item.column_type === 'check') {
    if (status === 'completed' || status === 'pending') return { bg: `${groupColor}22`, text: groupColor, border: `${groupColor}44` };
    if (status === 'not_applicable') return { bg: '#f3f4f6', text: '#9ca3af', border: '#e5e7eb' };
    return { bg: '#ffffff', text: '#d1d5db', border: '#f3f4f6' };
  }
  if (item.column_type === 'number') {
    if (numberValue != null && numberValue > 0) return { bg: `${groupColor}15`, text: groupColor, border: `${groupColor}30` };
    if (numberValue === 0) return { bg: '#f9fafb', text: '#9ca3af', border: '#e5e7eb' };
    return { bg: '#ffffff', text: '#d1d5db', border: '#f3f4f6' };
  }
  return { bg: '#ffffff', text: '#6b7280', border: '#e5e7eb' };
}

function statusSymbol(status: ApplicationStatus | null | undefined): string {
  if (status === 'completed') return '\u2713';
  if (status === 'not_applicable') return '\u2013';
  if (status === 'pending') return '\u2713'; // 旧データ互換: pendingも完了表示
  return '';
}

// 編集ポップオーバー
function EditPopover({
  type,
  value,
  onChange,
  onSave,
  onCancel,
  position,
}: {
  type: 'number' | 'date' | 'item-name' | 'deadline';
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
  position: { top: number; left: number };
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onCancel();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onCancel]);

  return (
    <div
      ref={ref}
      className="fixed z-[100] bg-white border border-gray-300 rounded-lg shadow-xl p-2"
      style={{ top: position.top, left: position.left }}
    >
      <input
        type={type === 'number' ? 'number' : type === 'deadline' ? 'date' : 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSave();
          if (e.key === 'Escape') onCancel();
        }}
        autoFocus
        className="w-28 px-2 py-1 text-xs border border-gray-200 rounded focus:ring-1 focus:ring-blue-400 focus:border-blue-400 outline-none"
      />
    </div>
  );
}

// 教科別グループの合計列キー
const SUBJECT_GROUP_KEY = '教科別';

export function CourseProgressTable({
  students,
  items,
  progressData,
  autoValues,
  canEdit,
  onStatusChange,
  onNumberChange,
  onDateChange,
  onItemNameChange,
  onItemDeadlineChange,
}: CourseProgressTableProps) {
  const [editingCell, setEditingCell] = useState<{ studentId: string; itemId: string; type: 'number' | 'date' } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editPosition, setEditPosition] = useState({ top: 0, left: 0 });
  // 項目名 / 期日編集
  const [editingHeader, setEditingHeader] = useState<{ itemId: string; type: 'item-name' | 'deadline' } | null>(null);
  const [editHeaderValue, setEditHeaderValue] = useState('');
  const [headerEditPosition, setHeaderEditPosition] = useState({ top: 0, left: 0 });

  const progressMap = useMemo(() => {
    const map = new Map<string, StudentCourseProgress>();
    for (const d of progressData) {
      map.set(`${d.student_id}:${d.item_id}`, d);
    }
    return map;
  }, [progressData]);

  const sortedStudents = useMemo(() => {
    return [...students].sort((a, b) => (a.grade || 0) - (b.grade || 0));
  }, [students]);

  // グループ分け
  const columnGroups = useMemo(() => {
    const groups: { key: string; label: string; color: string; items: CourseProgressItem[] }[] = [];
    const ungrouped: CourseProgressItem[] = [];
    const groupMap = new Map<string, CourseProgressItem[]>();

    for (const item of items) {
      const g = item.column_group;
      if (g && PROGRESS_COLUMN_GROUPS[g]) {
        if (!groupMap.has(g)) groupMap.set(g, []);
        groupMap.get(g)!.push(item);
      } else {
        ungrouped.push(item);
      }
    }
    if (ungrouped.length > 0) {
      groups.push({ key: '_ungrouped', label: 'その他', color: '#6b7280', items: ungrouped });
    }
    for (const [key, groupItems] of Array.from(groupMap)) {
      const def = PROGRESS_COLUMN_GROUPS[key];
      groups.push({ key, label: def.label, color: def.color, items: groupItems });
    }
    return groups;
  }, [items]);

  // 教科別グループがあるかチェック
  const subjectGroup = useMemo(() => columnGroups.find((g) => g.key === SUBJECT_GROUP_KEY), [columnGroups]);
  const hasSubjectTotal = !!subjectGroup && subjectGroup.items.some((i) => i.column_type === 'number');

  // 教科別合計の計算（生徒ID→合計値）
  const subjectTotals = useMemo(() => {
    if (!hasSubjectTotal || !subjectGroup) return {};
    const totals: Record<string, number> = {};
    for (const s of students) {
      let sum = 0;
      for (const item of subjectGroup.items) {
        if (item.column_type !== 'number') continue;
        if (item.auto_source) {
          const sv = autoValues?.[s.id];
          if (sv) {
            if (item.auto_source === 'regular_weekly') sum += sv.regular_weekly;
            else if (item.auto_source === 'course_sessions') sum += sv.course_sessions;
            else if (item.auto_source === 'subject_proposal') sum += getSubjectProposalValue(sv.subject_proposals, item.name);
          }
        } else {
          const d = progressMap.get(`${s.id}:${item.id}`);
          if (d?.number_value != null) sum += d.number_value;
        }
      }
      totals[s.id] = sum;
    }
    return totals;
  }, [hasSubjectTotal, subjectGroup, students, progressMap, autoValues]);

  // アイテムごとのグループカラー
  const itemGroupColor = useMemo(() => {
    const map: Record<string, string> = {};
    for (const g of columnGroups) {
      for (const item of g.items) {
        map[item.id] = g.color;
      }
    }
    return map;
  }, [columnGroups]);

  // 列ごとの集計（check: 完了数/対象数, number: 合計, date: 入力済み数）
  const columnAggregates = useMemo(() => {
    const agg: Record<string, { completed: number; total: number; sum: number; filled: number }> = {};
    for (const item of items) {
      let completed = 0;
      let total = 0;
      let sum = 0;
      let filled = 0;
      for (const s of students) {
        if (item.auto_source && item.column_type === 'number') {
          const sv = autoValues?.[s.id];
          let v = 0;
          if (sv) {
            if (item.auto_source === 'regular_weekly') v = sv.regular_weekly;
            else if (item.auto_source === 'course_sessions') v = sv.course_sessions;
            else if (item.auto_source === 'proposed_extra') {
              const st = subjectTotals[s.id] ?? 0;
              v = Math.max(0, st - (sv.course_sessions ?? 0));
            }
            else if (item.auto_source === 'subject_proposal') v = getSubjectProposalValue(sv.subject_proposals, item.name);
          }
          sum += v;
          filled++;
        } else {
          const d = progressMap.get(`${s.id}:${item.id}`);
          if (item.column_type === 'check') {
            if (d?.status !== 'not_applicable') total++;
            if (d?.status === 'completed') completed++;
          } else if (item.column_type === 'number') {
            if (d?.number_value != null) { sum += d.number_value; filled++; }
          } else if (item.column_type === 'date') {
            if (d?.date_value) filled++;
          }
        }
      }
      agg[item.id] = { completed, total, sum, filled };
    }
    return agg;
  }, [items, students, progressMap, autoValues, subjectTotals]);

  // グループ別進捗率
  const groupCompletionRates = useMemo(() => {
    const rates: Record<string, { completed: number; total: number }> = {};
    for (const g of columnGroups) {
      const checkItems = g.items.filter((i) => i.column_type === 'check');
      let completed = 0;
      const total = checkItems.length * students.length;
      for (const item of checkItems) {
        for (const s of students) {
          const d = progressMap.get(`${s.id}:${item.id}`);
          if (d?.status === 'completed') completed++;
        }
      }
      rates[g.key] = { completed, total };
    }
    return rates;
  }, [columnGroups, students, progressMap]);

  // 生徒ごとの全体完了率
  const studentCompletionRates = useMemo(() => {
    const checkItems = items.filter((i) => i.column_type === 'check');
    const rates: Record<string, { completed: number; total: number }> = {};
    for (const s of students) {
      let completed = 0;
      for (const item of checkItems) {
        const d = progressMap.get(`${s.id}:${item.id}`);
        if (d?.status === 'completed') completed++;
      }
      rates[s.id] = { completed, total: checkItems.length };
    }
    return rates;
  }, [items, students, progressMap]);

  // 生徒ごとのグループ別完了率
  const studentGroupRates = useMemo(() => {
    const rates: Record<string, Record<string, { completed: number; total: number }>> = {};
    for (const s of students) {
      rates[s.id] = {};
      for (const g of columnGroups) {
        const checkItems = g.items.filter((i) => i.column_type === 'check');
        if (checkItems.length === 0) continue;
        let completed = 0;
        for (const item of checkItems) {
          const d = progressMap.get(`${s.id}:${item.id}`);
          if (d?.status === 'completed') completed++;
        }
        rates[s.id][g.key] = { completed, total: checkItems.length };
      }
    }
    return rates;
  }, [students, columnGroups, progressMap]);

  // チェックセルクリック
  const handleCheckClick = useCallback(
    (studentId: string, itemId: string) => {
      if (!canEdit) return;
      const d = progressMap.get(`${studentId}:${itemId}`);
      onStatusChange(studentId, itemId, nextStatus(d?.status));
    },
    [canEdit, progressMap, onStatusChange]
  );

  // 数値/日付セルクリック
  const handleCellClick = useCallback(
    (e: React.MouseEvent, studentId: string, item: CourseProgressItem) => {
      if (!canEdit) return;
      if (item.auto_source && item.column_type === 'number') return;
      if (item.column_type === 'check') return;
      const rect = (e.target as HTMLElement).getBoundingClientRect();
      const d = progressMap.get(`${studentId}:${item.id}`);
      const currentVal = item.column_type === 'number'
        ? (d?.number_value != null ? String(d.number_value) : '')
        : (d?.date_value || '');
      setEditValue(currentVal);
      setEditPosition({ top: rect.bottom + 4, left: rect.left });
      setEditingCell({ studentId, itemId: item.id, type: item.column_type as 'number' | 'date' });
    },
    [canEdit, progressMap]
  );

  // 数値/日付保存
  const handleCellSave = useCallback(() => {
    if (!editingCell) return;
    const { studentId, itemId, type } = editingCell;
    setEditingCell(null);
    if (type === 'number') {
      const trimmed = editValue.trim();
      const val = trimmed === '' ? null : Number(trimmed);
      if (trimmed !== '' && isNaN(val as number)) return;
      onNumberChange(studentId, itemId, val);
    } else {
      onDateChange(studentId, itemId, editValue.trim() || null);
    }
  }, [editingCell, editValue, onNumberChange, onDateChange]);

  // ヘッダー編集
  const handleHeaderClick = useCallback(
    (e: React.MouseEvent, itemId: string, type: 'item-name' | 'deadline', currentValue: string) => {
      if (!canEdit) return;
      if (type === 'item-name' && !onItemNameChange) return;
      if (type === 'deadline' && !onItemDeadlineChange) return;
      const rect = (e.target as HTMLElement).getBoundingClientRect();
      setEditHeaderValue(currentValue);
      setHeaderEditPosition({ top: rect.bottom + 4, left: rect.left });
      setEditingHeader({ itemId, type });
    },
    [canEdit, onItemNameChange, onItemDeadlineChange]
  );

  const handleHeaderSave = useCallback(() => {
    if (!editingHeader) return;
    const { itemId, type } = editingHeader;
    setEditingHeader(null);
    if (type === 'item-name') {
      const name = editHeaderValue.trim();
      if (name && onItemNameChange) onItemNameChange(itemId, name);
    } else {
      if (onItemDeadlineChange) onItemDeadlineChange(itemId, editHeaderValue || null);
    }
  }, [editingHeader, editHeaderValue, onItemNameChange, onItemDeadlineChange]);

  // 自動計算値
  const getAutoValue = useCallback(
    (studentId: string, autoSource: string | null, itemName?: string): number | null => {
      if (!autoSource || !autoValues) return null;
      const sv = autoValues[studentId];
      if (!sv) return 0;
      if (autoSource === 'regular_weekly') return sv.regular_weekly;
      if (autoSource === 'course_sessions') return sv.course_sessions;
      // 提示増コマ = 教科別合計 - 講習期間通常回数
      if (autoSource === 'proposed_extra') {
        const subjectTotal = subjectTotals[studentId] ?? 0;
        const courseSessions = sv.course_sessions ?? 0;
        return Math.max(0, subjectTotal - courseSessions);
      }
      // 進行表コマ数（科目別）
      if (autoSource === 'subject_proposal') {
        return getSubjectProposalValue(sv.subject_proposals, itemName || '');
      }
      return null;
    },
    [autoValues, subjectTotals]
  );

  // コンテナ幅を測定してセル幅を動的に計算
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // 左固定列の幅
  const GRADE_W = 36;
  const NAME_W = 88;
  const PROGRESS_W = 72;
  const LEFT_TOTAL = GRADE_W + NAME_W + PROGRESS_W;

  // 合計列の幅
  const TOTAL_COL_W = hasSubjectTotal ? 40 : 0;

  // セル幅を動的計算: 残り幅を項目数で均等割り（最小36px）
  const MIN_CELL_W = 36;
  const itemCount = items.length;
  const availableWidth = containerWidth > 0 ? containerWidth - LEFT_TOTAL - TOTAL_COL_W : 0;
  const dynamicCellW = itemCount > 0 && availableWidth > 0
    ? Math.max(MIN_CELL_W, Math.floor(availableWidth / itemCount))
    : 36;
  // スクロールが必要かどうか
  const needsScroll = dynamicCellW <= MIN_CELL_W;

  if (students.length === 0) {
    return <div ref={containerRef} className="py-12 text-center text-sm text-gray-400 italic">対象の生徒がいません</div>;
  }
  if (items.length === 0) {
    return <div ref={containerRef} className="py-12 text-center text-sm text-gray-400 italic">進捗項目がありません。テンプレートから作成してください。</div>;
  }

  return (
    <>
      <div ref={containerRef} className={`border border-gray-200 rounded-xl bg-white shadow-sm overflow-auto max-h-[80vh]`}>
        <table className="border-collapse w-full" style={needsScroll ? { minWidth: `${LEFT_TOTAL + itemCount * MIN_CELL_W + TOTAL_COL_W}px` } : undefined}>
          {/* ===== グループカラーバー ===== */}
          <thead className="sticky top-0 z-40">
            <tr>
              {/* 左固定: 空欄 */}
              <th
                colSpan={3}
                className="sticky left-0 z-50 bg-white"
                style={{ width: LEFT_TOTAL, minWidth: LEFT_TOTAL }}
              />
              {/* グループ別カラーバー */}
              {columnGroups.map((g) => {
                const rate = groupCompletionRates[g.key];
                const pct = rate && rate.total > 0 ? Math.round((rate.completed / rate.total) * 100) : 0;
                // 教科別は+1列（合計列）
                const extraCols = (g.key === SUBJECT_GROUP_KEY && hasSubjectTotal) ? 1 : 0;
                return (
                  <th
                    key={g.key}
                    colSpan={g.items.length + extraCols}
                    className="px-1 py-1 text-center relative"
                    style={{ backgroundColor: `${g.color}15` }}
                  >
                    {/* カラーバートップ */}
                    <div
                      className="absolute top-0 left-0 right-0 h-[3px]"
                      style={{ backgroundColor: g.color }}
                    />
                    <div className="flex items-center justify-center gap-1 pt-0.5">
                      <span className="text-[10px] font-semibold" style={{ color: g.color }}>{g.label}</span>
                      {rate && rate.total > 0 && (
                        <span
                          className="text-[9px] px-1 rounded-full font-medium"
                          style={{
                            backgroundColor: `${g.color}20`,
                            color: g.color,
                          }}
                        >
                          {pct}%
                        </span>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>

            {/* ===== 項目名ヘッダー ===== */}
            <tr className="bg-gray-50">
              {/* 学年 */}
              <th
                className="sticky left-0 z-50 bg-gray-50 border-b border-gray-200 text-[10px] text-gray-400 font-normal px-1 py-1"
                style={{ width: GRADE_W, minWidth: GRADE_W }}
              >
                学年
              </th>
              {/* 名前 */}
              <th
                className="sticky z-50 bg-gray-50 border-b border-gray-200 text-[10px] text-gray-600 font-medium text-left px-1 py-1"
                style={{ left: GRADE_W, width: NAME_W, minWidth: NAME_W }}
              >
                生徒名
              </th>
              {/* 進捗 */}
              <th
                className="sticky z-50 bg-gray-50 border-b border-gray-200 text-[10px] text-gray-400 font-normal text-center px-1 py-1"
                style={{ left: GRADE_W + NAME_W, width: PROGRESS_W, minWidth: PROGRESS_W }}
              >
                進捗
              </th>
              {/* 各項目 + 教科別合計 */}
              {columnGroups.flatMap((g) => {
                const headerCells = g.items.map((item) => {
                  const isOverdue = item.deadline && new Date(item.deadline) < new Date();
                  return (
                    <th
                      key={item.id}
                      className="border-b border-gray-200 px-0 py-1 text-center align-top"
                      style={{ width: dynamicCellW, minWidth: MIN_CELL_W }}
                    >
                      <Tooltip text={`${item.name}${item.deadline ? ` (期日: ${formatDeadline(item.deadline)})` : ''}${item.auto_source ? ` [自動: ${AUTO_SOURCE_LABELS[item.auto_source]?.label || item.auto_source}]` : ''}`}>
                        <div
                          className={`text-[10px] leading-[1.3] px-0.5 min-h-[28px] flex items-center justify-center ${
                            onItemNameChange && canEdit ? 'cursor-pointer hover:text-blue-600' : ''
                          }`}
                          style={{ color: itemGroupColor[item.id] }}
                          onDoubleClick={(e) => {
                            if (onItemNameChange && canEdit) {
                              handleHeaderClick(e, item.id, 'item-name', item.name);
                            }
                          }}
                        >
                          <span className="line-clamp-3 break-all text-center">
                            {item.name}
                            {item.auto_source && <span className="text-blue-400 text-[8px] ml-0.5">A</span>}
                          </span>
                        </div>
                        {/* 期日バッジ */}
                        <div
                          className={`text-[8px] leading-none mt-0.5 ${
                            isOverdue ? 'text-red-500 font-bold' : 'text-gray-400'
                          } ${onItemDeadlineChange && canEdit ? 'cursor-pointer hover:underline' : ''}`}
                          onClick={(e) => {
                            if (onItemDeadlineChange && canEdit) {
                              handleHeaderClick(e, item.id, 'deadline', item.deadline || '');
                            }
                          }}
                        >
                          {item.deadline ? formatDeadline(item.deadline) : ''}
                        </div>
                      </Tooltip>
                    </th>
                  );
                });
                // 教科別グループの後に合計列を追加
                if (g.key === SUBJECT_GROUP_KEY && hasSubjectTotal) {
                  headerCells.push(
                    <th
                      key="_subject_total_header"
                      className="border-b border-gray-200 px-0 py-1 text-center align-top bg-gray-100/50"
                      style={{ width: TOTAL_COL_W, minWidth: TOTAL_COL_W }}
                    >
                      <div className="text-[9px] leading-[1.2] font-bold min-h-[22px] flex items-center justify-center" style={{ color: subjectGroup?.color }}>
                        合計
                      </div>
                    </th>
                  );
                }
                return headerCells;
              })}
            </tr>

            {/* ===== 列集計行（ヘッダー下） ===== */}
            <tr className="bg-gray-100/60">
              <th
                colSpan={3}
                className="sticky left-0 z-30 bg-gray-100 px-2 py-0.5 text-[9px] font-bold text-gray-500 border-b border-gray-300 text-left"
                style={{ width: LEFT_TOTAL, minWidth: LEFT_TOTAL }}
              >
                集計
              </th>
              {columnGroups.flatMap((g) => {
                const cells = g.items.map((item) => {
                  const agg = columnAggregates[item.id];
                  const groupColor = g.color;

                  if (item.column_type === 'check') {
                    const pct = agg && agg.total > 0 ? Math.round((agg.completed / agg.total) * 100) : 0;
                    return (
                      <th key={item.id} className="border-b border-gray-300 p-0 text-center font-normal">
                        <Tooltip text={`${agg?.completed ?? 0}/${agg?.total ?? 0} 完了`}>
                          <div className="w-full py-0.5 flex flex-col items-center justify-center">
                            <span className="text-[9px] font-bold" style={{ color: pct >= 80 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444' }}>
                              {pct}%
                            </span>
                            <span className="text-[8px] text-gray-400 leading-none">{agg?.completed ?? 0}/{agg?.total ?? 0}</span>
                          </div>
                        </Tooltip>
                      </th>
                    );
                  }

                  if (item.column_type === 'number') {
                    return (
                      <th key={item.id} className="border-b border-gray-300 p-0 text-center font-normal">
                        <Tooltip text={`合計: ${agg?.sum ?? 0}（${agg?.filled ?? 0}名入力済み）`}>
                          <div className="w-full py-0.5 flex flex-col items-center justify-center">
                            <span className="text-[9px] font-bold" style={{ color: groupColor }}>{agg?.sum ?? 0}</span>
                            <span className="text-[8px] text-gray-400 leading-none">{agg?.filled ?? 0}名</span>
                          </div>
                        </Tooltip>
                      </th>
                    );
                  }

                  if (item.column_type === 'date') {
                    return (
                      <th key={item.id} className="border-b border-gray-300 p-0 text-center font-normal">
                        <Tooltip text={`${agg?.filled ?? 0}/${students.length}名 入力済み`}>
                          <div className="w-full py-0.5 flex flex-col items-center justify-center">
                            <span className="text-[9px] font-bold" style={{ color: groupColor }}>
                              {agg?.filled ?? 0}/{students.length}
                            </span>
                          </div>
                        </Tooltip>
                      </th>
                    );
                  }

                  return <th key={item.id} className="border-b border-gray-300" />;
                });

                if (g.key === SUBJECT_GROUP_KEY && hasSubjectTotal) {
                  const grandTotal = Object.values(subjectTotals).reduce((a, b) => a + b, 0);
                  cells.push(
                    <th key="_subject_total_agg" className="border-b border-gray-300 p-0 text-center bg-gray-100 font-normal">
                      <div className="w-full py-0.5">
                        <span className="text-[9px] font-bold" style={{ color: subjectGroup?.color }}>{grandTotal}</span>
                      </div>
                    </th>
                  );
                }

                return cells;
              })}
            </tr>
          </thead>

          {/* ===== ボディ ===== */}
          <tbody>
            {sortedStudents.map((student, si) => {
              const completion = studentCompletionRates[student.id];
              const completionPct = completion && completion.total > 0 ? Math.round((completion.completed / completion.total) * 100) : 0;
              const gRates = studentGroupRates[student.id] || {};
              const isEven = si % 2 === 0;
              const prevStudent = si > 0 ? sortedStudents[si - 1] : null;
              const showGradeSep = !prevStudent || prevStudent.grade !== student.grade;

              return (
                <tr
                  key={student.id}
                  className={`${isEven ? 'bg-white' : 'bg-gray-50/50'} ${showGradeSep && si > 0 ? 'border-t-2 border-t-gray-300' : ''} hover:bg-blue-50/30`}
                >
                  {/* 学年 */}
                  <td
                    className={`sticky left-0 z-10 px-1 py-0.5 text-center text-[10px] text-gray-400 border-b border-gray-100 ${isEven ? 'bg-white' : 'bg-gray-50/80'}`}
                    style={{ width: GRADE_W, minWidth: GRADE_W }}
                  >
                    {GRADE_LABELS[student.grade || 0] || ''}
                  </td>
                  {/* 名前 */}
                  <td
                    className={`sticky z-10 px-1.5 py-0.5 border-b border-gray-100 ${isEven ? 'bg-white' : 'bg-gray-50/80'}`}
                    style={{ left: GRADE_W, width: NAME_W, minWidth: NAME_W }}
                  >
                    <span className="text-[11px] font-medium text-[#1e3a5f] whitespace-nowrap">
                      {student.last_name} {student.first_name}
                    </span>
                  </td>
                  {/* 進捗バー + グループドット */}
                  <td
                    className={`sticky z-10 px-1 py-0.5 border-b border-gray-100 border-r border-r-gray-200 ${isEven ? 'bg-white' : 'bg-gray-50/80'}`}
                    style={{ left: GRADE_W + NAME_W, width: PROGRESS_W, minWidth: PROGRESS_W }}
                  >
                    <div className="flex items-center gap-1">
                      <div className="flex-1 bg-gray-100 rounded-full h-1.5 min-w-[24px]">
                        <div
                          className="h-1.5 rounded-full transition-[width] duration-500 ease-out"
                          style={{
                            width: `${completionPct}%`,
                            backgroundColor: completionPct >= 80 ? '#10b981' : completionPct >= 50 ? '#f59e0b' : '#ef4444',
                          }}
                        />
                      </div>
                      <span className="text-[9px] text-gray-400 w-7 text-right shrink-0">{completionPct}%</span>
                    </div>
                    <div className="flex items-center gap-0.5 mt-0.5">
                      {columnGroups.map((g) => {
                        const gr = gRates[g.key];
                        if (!gr) return null;
                        const gPct = gr.total > 0 ? gr.completed / gr.total : 0;
                        return (
                          <Tooltip key={g.key} text={`${g.label}: ${gr.completed}/${gr.total}`}>
                            <div
                              className="w-2 h-2 rounded-full border"
                              style={{
                                backgroundColor: gPct >= 1 ? g.color : gPct > 0 ? `${g.color}40` : '#e5e7eb',
                                borderColor: gPct > 0 ? g.color : '#d1d5db',
                              }}
                            />
                          </Tooltip>
                        );
                      })}
                    </div>
                  </td>

                  {/* ===== ヒートマップセル ===== */}
                  {columnGroups.flatMap((g) => {
                    const cells = g.items.map((item) => {
                      const d = progressMap.get(`${student.id}:${item.id}`);
                      const groupColor = g.color;

                      // 自動計算
                      if (item.auto_source && item.column_type === 'number') {
                        const autoVal = getAutoValue(student.id, item.auto_source, item.name);
                        return (
                          <td key={item.id} className="border-b border-gray-100 p-0 text-center">
                            <div
                              className="w-full h-[30px] flex items-center justify-center text-[10px] font-semibold"
                              style={{ backgroundColor: `${groupColor}12`, color: groupColor }}
                            >
                              {autoVal ?? 0}
                            </div>
                          </td>
                        );
                      }

                      // チェック
                      if (item.column_type === 'check') {
                        const style = getCellStyle(item, d?.status, null, groupColor);
                        return (
                          <td key={item.id} className="border-b border-gray-100 p-0 text-center">
                            <div
                              className={`w-full h-[30px] flex items-center justify-center text-xs font-bold ${canEdit ? 'cursor-pointer' : ''} transition-colors`}
                              style={{
                                backgroundColor: style.bg,
                                color: style.text,
                                borderLeft: `1px solid ${style.border}`,
                                borderRight: `1px solid ${style.border}`,
                              }}
                              onClick={() => handleCheckClick(student.id, item.id)}
                            >
                              {statusSymbol(d?.status)}
                            </div>
                          </td>
                        );
                      }

                      // 数値
                      if (item.column_type === 'number') {
                        const style = getCellStyle(item, null, d?.number_value, groupColor);
                        return (
                          <td key={item.id} className="border-b border-gray-100 p-0 text-center">
                            <div
                              className={`w-full h-[30px] flex items-center justify-center text-[10px] font-medium ${canEdit ? 'cursor-pointer hover:ring-1 hover:ring-blue-300 hover:ring-inset' : ''} transition-[box-shadow] duration-150`}
                              style={{ backgroundColor: style.bg, color: style.text }}
                              onClick={(e) => handleCellClick(e, student.id, item)}
                            >
                              {d?.number_value != null ? d.number_value : ''}
                            </div>
                          </td>
                        );
                      }

                      // 日付
                      if (item.column_type === 'date') {
                        const dateStr = d?.date_value
                          ? new Date(d.date_value).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })
                          : '';
                        return (
                          <td key={item.id} className="border-b border-gray-100 p-0 text-center">
                            <div
                              className={`w-full h-[30px] flex items-center justify-center text-[9px] ${canEdit ? 'cursor-pointer hover:ring-1 hover:ring-blue-300 hover:ring-inset' : ''} transition-[box-shadow] duration-150`}
                              style={{
                                backgroundColor: dateStr ? `${groupColor}10` : '#ffffff',
                                color: dateStr ? groupColor : '#d1d5db',
                              }}
                              onClick={(e) => handleCellClick(e, student.id, item)}
                            >
                              {dateStr}
                            </div>
                          </td>
                        );
                      }

                      return <td key={item.id} className="border-b border-gray-100" />;
                    });

                    // 教科別グループの後に合計セル
                    if (g.key === SUBJECT_GROUP_KEY && hasSubjectTotal) {
                      const total = subjectTotals[student.id] ?? 0;
                      cells.push(
                        <td key="_subject_total" className="border-b border-gray-100 p-0 text-center bg-gray-50/80">
                          <div
                            className="w-full h-[30px] flex items-center justify-center text-[11px] font-bold"
                            style={{ color: subjectGroup?.color }}
                          >
                            {total}
                          </div>
                        </td>
                      );
                    }

                    return cells;
                  })}
                </tr>
              );
            })}
          </tbody>

        </table>
      </div>

      {/* 凡例 */}
      <div className="mt-3 flex flex-wrap items-center gap-4 text-[10px] text-gray-500 px-1">
        <span className="font-medium text-gray-600">凡例:</span>
        <div className="flex items-center gap-1">
          <div className="w-4 h-4 rounded flex items-center justify-center bg-white text-gray-300 text-[10px] border border-gray-100"></div>
          <span>未入力</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-4 h-4 rounded flex items-center justify-center bg-green-50 text-green-600 text-[10px] font-bold border border-green-200">{'\u2713'}</div>
          <span>完了</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-4 h-4 rounded flex items-center justify-center bg-gray-100 text-gray-400 text-[10px] border border-gray-200">{'\u2013'}</div>
          <span>対象外</span>
        </div>
        <span className="text-gray-300">|</span>
        <span>クリックで切替（空欄→完了→対象外→空欄）/ 数値はクリックで編集</span>
        {onItemNameChange && <span>/ 項目名はダブルクリックで編集</span>}
      </div>

      {/* 数値/日付編集ポップオーバー */}
      {editingCell && (
        <EditPopover
          type={editingCell.type}
          value={editValue}
          onChange={setEditValue}
          onSave={handleCellSave}
          onCancel={() => setEditingCell(null)}
          position={editPosition}
        />
      )}

      {/* ヘッダー編集ポップオーバー */}
      {editingHeader && (
        <EditPopover
          type={editingHeader.type}
          value={editHeaderValue}
          onChange={setEditHeaderValue}
          onSave={handleHeaderSave}
          onCancel={() => setEditingHeader(null)}
          position={headerEditPosition}
        />
      )}
    </>
  );
}
