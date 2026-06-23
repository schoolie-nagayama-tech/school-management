'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { ClipboardList } from 'lucide-react';
import { Loading } from '@/components/ui';

// ── 型定義 ──
type ApplicationStatus = 'pending' | 'completed' | 'not_applicable';

interface EmbedStudent {
  id: string;
  last_name: string;
  first_name: string;
  grade: number;
  status: string;
}

interface EmbedItem {
  id: string;
  name: string;
  column_type: 'check' | 'number' | 'date';
  due_date: string | null;
  sort_order: number;
}

interface EmbedApplication {
  id: string;
  student_id: string;
  item_id: string;
  status: ApplicationStatus | null;
  number_value: number | null;
  date_value: string | null;
}

const GRADE_LABELS: Record<number, string> = {
  1: '小1',
  2: '小2',
  3: '小3',
  4: '小4',
  5: '小5',
  6: '小6',
  7: '中1',
  8: '中2',
  9: '中3',
  10: '高1',
  11: '高2',
  12: '高3',
  13: '既卒',
};

const STATUS_SYMBOLS: Record<string, string> = {
  pending: '×',
  completed: '✓',
  not_applicable: '-',
};

// ステータスサイクル: null → pending → completed → not_applicable → null
function getNextStatus(current: ApplicationStatus | null): ApplicationStatus | null {
  if (current === null) return 'pending';
  if (current === 'pending') return 'completed';
  if (current === 'completed') return 'not_applicable';
  return null;
}

function getStatusStyle(status: ApplicationStatus | null): string {
  if (status === null) return '';
  if (status === 'pending') return 'bg-gray-100 text-gray-500';
  if (status === 'completed') return 'bg-blue-100 text-blue-900 font-semibold';
  if (status === 'not_applicable') return 'bg-gray-100 text-gray-400';
  return '';
}

function formatDueDate(due: string | null): string {
  if (!due) return '';
  const d = new Date(due + 'T00:00:00');
  return `✕ ${d.getMonth() + 1}/${d.getDate()}`;
}

export default function EmbedApplicationsPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const readOnly = searchParams.get('readonly') === '1';
  const refreshMinutes = Number(searchParams.get('refresh') || '5');

  const [students, setStudents] = useState<EmbedStudent[]>([]);
  const [items, setItems] = useState<EmbedItem[]>([]);
  const [applications, setApplications] = useState<EmbedApplication[]>([]);
  const [schoolName, setSchoolName] = useState('');
  const [generatedAt, setGeneratedAt] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState<string | null>(null); // "studentId-itemId" being saved
  const [toast, setToast] = useState('');

  // 数値入力用
  const [editingNumber, setEditingNumber] = useState<{ studentId: string; itemId: string } | null>(
    null
  );
  const [numberInput, setNumberInput] = useState('');
  const numberInputRef = useRef<HTMLInputElement>(null);

  const fetchData = useCallback(async () => {
    if (!token) {
      setError('トークンが指定されていません');
      setIsLoading(false);
      return;
    }

    try {
      const res = await fetch(`/api/embed/applications?token=${encodeURIComponent(token)}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `エラー: ${res.status}`);
      }
      const data = await res.json();
      setStudents(data.students || []);
      setItems(data.items || []);
      setApplications(data.applications || []);
      setSchoolName(data.school_name || '');
      setGeneratedAt(data.generated_at || '');
      setError('');
    } catch (err) {
      console.error('Embed fetch error:', err);
      setError(err instanceof Error ? err.message : 'データの取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  // 初回 + 自動リフレッシュ
  useEffect(() => {
    fetchData();
    if (refreshMinutes > 0) {
      const interval = setInterval(fetchData, refreshMinutes * 60 * 1000);
      return () => clearInterval(interval);
    }
  }, [fetchData, refreshMinutes]);

  // ── 書き込みAPI呼び出し ──
  const postUpdate = useCallback(
    async (
      studentId: string,
      itemId: string,
      action: 'status' | 'number' | 'date',
      value: string | number | null
    ) => {
      if (!token) return;
      const key = `${studentId}-${itemId}`;
      setSaving(key);
      try {
        const res = await fetch('/api/embed/applications', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, student_id: studentId, item_id: itemId, action, value }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || '更新に失敗しました');
        }
        // ローカルstate更新
        if (action === 'status') {
          setApplications((prev) => {
            if (value === null) {
              return prev.filter((a) => !(a.student_id === studentId && a.item_id === itemId));
            }
            const existing = prev.find((a) => a.student_id === studentId && a.item_id === itemId);
            if (existing) {
              return prev.map((a) =>
                a.student_id === studentId && a.item_id === itemId
                  ? { ...a, status: value as ApplicationStatus }
                  : a
              );
            }
            return [
              ...prev,
              {
                id: `temp-${Date.now()}`,
                student_id: studentId,
                item_id: itemId,
                status: value as ApplicationStatus,
                number_value: null,
                date_value: null,
              },
            ];
          });
        } else if (action === 'number') {
          setApplications((prev) => {
            if (value === null) {
              return prev.filter((a) => !(a.student_id === studentId && a.item_id === itemId));
            }
            const existing = prev.find((a) => a.student_id === studentId && a.item_id === itemId);
            if (existing) {
              return prev.map((a) =>
                a.student_id === studentId && a.item_id === itemId
                  ? { ...a, number_value: value as number }
                  : a
              );
            }
            return [
              ...prev,
              {
                id: `temp-${Date.now()}`,
                student_id: studentId,
                item_id: itemId,
                status: null,
                number_value: value as number,
                date_value: null,
              },
            ];
          });
        } else if (action === 'date') {
          setApplications((prev) => {
            if (value === null) {
              return prev.filter((a) => !(a.student_id === studentId && a.item_id === itemId));
            }
            const existing = prev.find((a) => a.student_id === studentId && a.item_id === itemId);
            if (existing) {
              return prev.map((a) =>
                a.student_id === studentId && a.item_id === itemId
                  ? { ...a, date_value: value as string }
                  : a
              );
            }
            return [
              ...prev,
              {
                id: `temp-${Date.now()}`,
                student_id: studentId,
                item_id: itemId,
                status: null,
                number_value: null,
                date_value: value as string,
              },
            ];
          });
        }
      } catch (err) {
        console.error('Update error:', err);
        showToast(err instanceof Error ? err.message : '更新に失敗しました');
      } finally {
        setSaving(null);
      }
    },
    [token]
  );

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  // チェック列のクリック
  const handleCheckClick = (
    studentId: string,
    itemId: string,
    currentStatus: ApplicationStatus | null
  ) => {
    if (readOnly) return;
    const nextStatus = getNextStatus(currentStatus);
    postUpdate(studentId, itemId, 'status', nextStatus);
  };

  // 数値列のクリック
  const handleNumberClick = (studentId: string, itemId: string, currentValue: number | null) => {
    if (readOnly) return;
    setEditingNumber({ studentId, itemId });
    setNumberInput(currentValue != null ? String(currentValue) : '');
    setTimeout(() => numberInputRef.current?.focus(), 50);
  };

  const handleNumberSubmit = () => {
    if (!editingNumber) return;
    const val = numberInput.trim() === '' ? null : Number(numberInput);
    if (val !== null && isNaN(val)) {
      showToast('数値を入力してください');
      return;
    }
    postUpdate(editingNumber.studentId, editingNumber.itemId, 'number', val);
    setEditingNumber(null);
  };

  // 集計
  const summaries = useMemo(() => {
    return items.map((item) => {
      const studentIds = students.map((s) => s.id);
      const itemApps = applications.filter(
        (a) => a.item_id === item.id && studentIds.includes(a.student_id)
      );

      if (item.column_type === 'check') {
        const completed = itemApps.filter((a) => a.status === 'completed').length;
        const notApplicable = itemApps.filter((a) => a.status === 'not_applicable').length;
        const target = students.length - notApplicable;
        const pct = target > 0 ? Math.round((completed / target) * 100) : 0;
        return { type: 'check' as const, target, completed, pct };
      } else if (item.column_type === 'number') {
        const withValue = itemApps.filter((a) => a.number_value !== null);
        const total = withValue.reduce((sum, a) => sum + (a.number_value || 0), 0);
        return { type: 'number' as const, total, count: withValue.length };
      } else {
        const withDate = itemApps.filter((a) => a.date_value !== null);
        return { type: 'date' as const, count: withDate.length, target: students.length };
      }
    });
  }, [items, students, applications]);

  const formatTime = (iso: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-raised">
        <Loading />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-surface-raised">
        <div className="text-center text-red-600 text-sm p-4">{error}</div>
      </div>
    );
  }

  return (
    <div className="bg-surface-raised min-h-screen text-[13px]">
      {/* トースト */}
      {toast && (
        <div className="fixed top-2 left-1/2 -translate-x-1/2 z-50 bg-red-600 text-white px-4 py-2 rounded-lg shadow-lg text-xs">
          {toast}
        </div>
      )}

      {/* ヘッダー */}
      <div className="sticky top-0 z-30 bg-ink text-white px-3 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-bold text-sm flex items-center gap-1">
            <ClipboardList className="h-4 w-4" />
            申込状況
          </span>
          {schoolName && <span className="text-xs opacity-80">（{schoolName}）</span>}
          {readOnly && (
            <span className="text-[10px] bg-surface-raised/20 px-1.5 py-0.5 rounded">閲覧専用</span>
          )}
        </div>
        <div className="text-xs opacity-70">更新: {formatTime(generatedAt)}</div>
      </div>

      {/* 説明 */}
      {!readOnly && (
        <div className="px-3 py-1 text-[10px] text-gray-500 bg-gray-50 border-b">
          セルをクリックして切替: 空白→×(未申込)→✓(済)→-(対象外)→空白
        </div>
      )}

      {/* テーブル */}
      <div className="overflow-auto">
        <table className="w-full border-collapse min-w-[600px]">
          <thead>
            <tr className="bg-ink text-white">
              <th className="sticky left-0 z-20 bg-ink px-2 py-1.5 text-left text-xs font-medium w-12">
                学年
              </th>
              <th className="sticky left-12 z-20 bg-ink px-2 py-1.5 text-left text-xs font-medium min-w-[100px]">
                名前
              </th>
              {items.map((item) => (
                <th
                  key={item.id}
                  className="px-2 py-1.5 text-center text-xs font-medium min-w-[80px]"
                >
                  <div>{item.name}</div>
                  {item.due_date && (
                    <div className="text-[10px] opacity-70 font-normal">
                      {formatDueDate(item.due_date)}
                    </div>
                  )}
                </th>
              ))}
            </tr>
            {/* 集計行 */}
            <tr className="bg-gray-50 border-b-2 border-gray-300">
              <td
                className="sticky left-0 z-20 bg-gray-50 px-2 py-1 text-xs font-medium text-gray-600"
                colSpan={2}
              >
                集計
              </td>
              {items.map((item, i) => {
                const s = summaries[i];
                return (
                  <td key={item.id} className="px-2 py-1 text-center text-xs">
                    {s.type === 'check' ? (
                      <>
                        <div className="text-gray-500">対象: {s.target}人</div>
                        <div className="font-bold">
                          済: {s.completed} ({s.pct}%)
                        </div>
                      </>
                    ) : s.type === 'number' ? (
                      <>
                        <div className="font-bold">計: {s.total}</div>
                        <div className="text-gray-500">入力: {s.count}人</div>
                      </>
                    ) : (
                      <>
                        <div className="text-gray-500">対象: {s.target}人</div>
                        <div className="font-bold">
                          済: {s.count} ({s.target > 0 ? Math.round((s.count / s.target) * 100) : 0}
                          %)
                        </div>
                      </>
                    )}
                  </td>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {students.map((student, idx) => (
              <tr
                key={student.id}
                className={`border-b border-gray-200 ${idx % 2 === 0 ? 'bg-surface-raised' : 'bg-gray-50/50'}`}
              >
                <td
                  className="sticky left-0 z-10 px-2 py-1.5 text-xs text-blue-700 font-medium"
                  style={{ backgroundColor: idx % 2 === 0 ? 'white' : '#fafafa' }}
                >
                  {GRADE_LABELS[student.grade] || `${student.grade}`}
                </td>
                <td
                  className="sticky left-12 z-10 px-2 py-1.5 text-xs font-medium whitespace-nowrap"
                  style={{ backgroundColor: idx % 2 === 0 ? 'white' : '#fafafa' }}
                >
                  {student.last_name} {student.first_name}
                </td>
                {items.map((item) => {
                  const app = applications.find(
                    (a) => a.student_id === student.id && a.item_id === item.id
                  );
                  const isSaving = saving === `${student.id}-${item.id}`;

                  // 数値列
                  if (item.column_type === 'number') {
                    const isEditing =
                      editingNumber?.studentId === student.id && editingNumber?.itemId === item.id;
                    return (
                      <td
                        key={item.id}
                        className={`px-2 py-1.5 text-center text-xs ${!readOnly ? 'cursor-pointer hover:bg-blue-50 transition-colors duration-150' : ''} ${isSaving ? 'opacity-50' : ''}`}
                        onClick={() =>
                          !isEditing &&
                          handleNumberClick(student.id, item.id, app?.number_value ?? null)
                        }
                      >
                        {isEditing ? (
                          <input
                            ref={numberInputRef}
                            type="number"
                            className="w-14 text-center text-xs border border-blue-400 rounded px-1 py-0.5"
                            value={numberInput}
                            onChange={(e) => setNumberInput(e.target.value)}
                            onBlur={handleNumberSubmit}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleNumberSubmit();
                              if (e.key === 'Escape') setEditingNumber(null);
                            }}
                          />
                        ) : app?.number_value != null ? (
                          app.number_value
                        ) : (
                          '-'
                        )}
                      </td>
                    );
                  }

                  // 日付列
                  if (item.column_type === 'date') {
                    return (
                      <td
                        key={item.id}
                        className={`px-2 py-1.5 text-center text-xs ${!readOnly ? 'cursor-pointer' : ''}`}
                      >
                        {!readOnly ? (
                          <input
                            type="date"
                            className="w-[100px] text-xs border-0 bg-transparent cursor-pointer text-center"
                            value={app?.date_value || ''}
                            onChange={(e) =>
                              postUpdate(student.id, item.id, 'date', e.target.value || null)
                            }
                          />
                        ) : app?.date_value ? (
                          new Date(app.date_value + 'T00:00:00').toLocaleDateString('ja-JP', {
                            month: 'short',
                            day: 'numeric',
                          })
                        ) : (
                          '-'
                        )}
                      </td>
                    );
                  }

                  // チェック列
                  const status = app?.status || null;
                  return (
                    <td
                      key={item.id}
                      className={`px-2 py-1.5 text-center text-sm ${getStatusStyle(status)} ${!readOnly ? 'cursor-pointer hover:bg-blue-50 select-none transition-colors duration-150' : ''} ${isSaving ? 'opacity-50' : ''}`}
                      onClick={() => handleCheckClick(student.id, item.id, status)}
                    >
                      {status ? STATUS_SYMBOLS[status] || '' : ''}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* フッター */}
      <div className="text-center text-[10px] text-gray-400 py-2">
        {refreshMinutes > 0 && `${refreshMinutes}分ごとに自動更新`}
        {!readOnly && ' ・ クリックで編集可能'}
      </div>
    </div>
  );
}
