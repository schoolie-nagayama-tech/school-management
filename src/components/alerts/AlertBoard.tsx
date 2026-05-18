'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { AlertItem } from './AlertItem';
import { getAlertsLight, getAlertsHeavy, mergeStudentAlerts, invalidateAlertCache } from '@/lib/api/alerts';
import type { StudentAlerts, Alert } from '@/types/alerts';
import { useAuth } from '@/contexts/AuthContext';
import { useMasterData } from '@/contexts/MasterDataContext';
import { useToast } from '@/hooks/useToast';
import { GRADE_LABELS } from '@/types/database';
import { ChevronDown, ChevronUp, Info, AlertTriangle, X } from 'lucide-react';
import { InlineLoading } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { dismissAlert } from '@/lib/api/alerts';
import { completeTask } from '@/lib/api/interviews';
import { ALERT_TYPE_LABELS, ALERT_TYPE_COLORS } from '@/types/alerts';

interface AlertBoardProps {
  className?: string;
}

const SCHOOL_COLORS = [
  { bg: 'bg-sky-100', text: 'text-sky-700', border: 'border-sky-200' },
  { bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-emerald-200' },
  { bg: 'bg-violet-100', text: 'text-violet-700', border: 'border-violet-200' },
  { bg: 'bg-rose-100', text: 'text-rose-700', border: 'border-rose-200' },
  { bg: 'bg-indigo-100', text: 'text-indigo-700', border: 'border-indigo-200' },
  { bg: 'bg-teal-100', text: 'text-teal-700', border: 'border-teal-200' },
  { bg: 'bg-fuchsia-100', text: 'text-fuchsia-700', border: 'border-fuchsia-200' },
  { bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-200' },
] as const;

export function AlertBoard({ className = '' }: AlertBoardProps) {
  const { getSelectedSchoolIds, selectedSchoolId, profile } = useAuth();
  const { schools } = useMasterData();
  const { success, error: toastError } = useToast();
  const [studentAlerts, setStudentAlerts] = useState<StudentAlerts[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isExpanded, setIsExpanded] = useState(true);
  const [showInfoPopup, setShowInfoPopup] = useState(false);
  /** Heavy アラート（成績・テスト）の取得状態 */
  const [heavyLoadState, setHeavyLoadState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');

  // 対応済み操作はmanager以上のみ
  const canDismiss = profile?.role === 'admin' || profile?.role === 'owner' || profile?.role === 'manager';

  // アラートタイプの説明
  const alertTypeDescriptions: Record<string, string> = {
    score_drop: '前回と比較して10点以上低下した科目',
    score_missing: '最新の成績で未入力の科目がある',
    interview_overdue: '最後の面談から30日以上経過している',
    application_overdue: '期日が過ぎている申込項目がある',
    interview_task: '未完了の面談タスクがある',
    exam_overdue: 'テスト日が過ぎている目標設定がある',
  };

  const fetchAlerts = useCallback(async (skipCache = false) => {
    setIsLoading(true);
    setHeavyLoadState('idle');
    try {
      const schoolIds = getSelectedSchoolIds();
      if (schoolIds.length === 0) {
        setStudentAlerts([]);
        setHeavyLoadState('idle');
        setIsLoading(false);
        return;
      }
      if (skipCache) invalidateAlertCache(schoolIds);
      // Phase 2: Light を先に表示し、Heavy は裏で取得
      const lightAlerts = await getAlertsLight(schoolIds, { skipCache });
      setStudentAlerts(lightAlerts);
      setIsLoading(false);

      // Heavy を非同期で取得してマージ
      setHeavyLoadState('loading');
      getAlertsHeavy(schoolIds, { skipCache })
        .then((heavyAlerts) => {
          setStudentAlerts((prev) => mergeStudentAlerts(prev, heavyAlerts));
          setHeavyLoadState('done');
        })
        .catch((err) => {
          console.error('Error fetching heavy alerts:', err);
          setHeavyLoadState('error');
          toastError('成績・テスト関連のアラートの取得に失敗しました');
        });
    } catch (error) {
      console.error('Error fetching alerts:', error);
      toastError('アラートの取得に失敗しました');
      setHeavyLoadState('idle');
      setIsLoading(false);
    }
  }, [getSelectedSchoolIds, toastError]);

  const HEAVY_ALERT_TYPES = ['score_drop', 'score_missing', 'exam_overdue'] as const;

  /** Heavy アラートのみ再取得（成績・テスト関連） */
  const retryHeavyAlerts = useCallback(async () => {
    const schoolIds = getSelectedSchoolIds();
    if (schoolIds.length === 0) return;
    setHeavyLoadState('loading');
    invalidateAlertCache(schoolIds);
    try {
      const heavyAlerts = await getAlertsHeavy(schoolIds, { skipCache: true });
      setStudentAlerts((prev) => {
        const withoutHeavy = prev.map((sa) => ({
          ...sa,
          alerts: sa.alerts.filter((a) => !(HEAVY_ALERT_TYPES as readonly string[]).includes(a.alert_type)),
        })).filter((sa) => sa.alerts.length > 0);
        return mergeStudentAlerts(withoutHeavy, heavyAlerts);
      });
      setHeavyLoadState('done');
    } catch (err) {
      console.error('Error retrying heavy alerts:', err);
      setHeavyLoadState('error');
      toastError('成績・テスト関連のアラートの取得に失敗しました');
    }
  }, [getSelectedSchoolIds, toastError]);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  const handleDismiss = useCallback(async (alert: Alert) => {
    if (!canDismiss) return;

    try {
      const schoolIds = getSelectedSchoolIds();
      if (schoolIds.length === 0) {
        toastError('教室が選択されていません');
        return;
      }

      // 面談タスクの場合：面談記録のタスクを完了にしてから対応済み記録を付与（同期）
      if (alert.alert_type === 'interview_task') {
        const taskId = alert.details?.task_id ?? (alert.alert_key.startsWith('task:') ? alert.alert_key.slice(5) : null);
        if (taskId) {
          await completeTask(taskId);
        }
      }

      // 生徒のschool_idを取得
      const { data: student, error: studentError } = await supabase
        .from('students')
        .select('school_id')
        .eq('id', alert.student_id)
        .maybeSingle();

      if (studentError || !student) {
        toastError('生徒情報が見つかりません');
        return;
      }

      await dismissAlert(
        student.school_id,
        alert.student_id,
        alert.alert_type,
        alert.alert_key,
        profile?.id,
        undefined
      );

      success('対応済みにしました');
      // アラートを再取得（キャッシュをスキップ）
      await fetchAlerts(true);
    } catch (error) {
      console.error('Error dismissing alert:', error);
      toastError('対応済みの記録に失敗しました');
    }
  }, [canDismiss, getSelectedSchoolIds, profile?.id, success, toastError, fetchAlerts]);

  const totalAlerts = useMemo(
    () => studentAlerts.reduce((sum, sa) => sum + sa.alerts.length, 0),
    [studentAlerts]
  );

  const isMultiSchool = selectedSchoolId === 'all';

  const schoolNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const s of schools) map[s.id] = s.name;
    return map;
  }, [schools]);

  const schoolColorMap = useMemo(() => {
    const ids = Array.from(new Set(studentAlerts.map((sa) => sa.school_id).filter(Boolean) as string[]));
    const map: Record<string, typeof SCHOOL_COLORS[number]> = {};
    ids.forEach((id, i) => { map[id] = SCHOOL_COLORS[i % SCHOOL_COLORS.length]; });
    return map;
  }, [studentAlerts]);

  // 教室別にグルーピング（マルチ校時のみ）
  const alertsBySchool = useMemo(() => {
    if (!isMultiSchool) return null;
    const map = new Map<string, { name: string; alerts: StudentAlerts[]; count: number }>();
    for (const sa of studentAlerts) {
      const sid = sa.school_id || 'unknown';
      if (!map.has(sid)) {
        map.set(sid, { name: schoolNameMap[sid] || '不明', alerts: [], count: 0 });
      }
      const entry = map.get(sid)!;
      entry.alerts.push(sa);
      entry.count += sa.alerts.length;
    }
    return Array.from(map.entries()).sort((a, b) => b[1].count - a[1].count);
  }, [isMultiSchool, studentAlerts, schoolNameMap]);

  if (isLoading) {
    return (
      <div className={`bg-[#f8f8f8] rounded-xl border border-gray-200 p-4 ${className}`}>
        <InlineLoading label="アラートを読み込み中..." />
      </div>
    );
  }

  if (totalAlerts === 0) {
    return (
      <div className={`bg-[#f8f8f8] rounded-xl border border-gray-200 p-4 ${className}`}>
        <div className="text-center text-sm text-gray-500">
          対応が必要な項目はありません
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-[#f8f8f8] rounded-xl border border-gray-200 overflow-hidden ${className}`}>
      {/* ヘッダー */}
      <div className="flex items-center justify-between p-4 bg-[#ffebee] border-b border-[#ffcdd2]">
        <div className="flex items-center gap-2 flex-wrap">
          <AlertTriangle className="w-5 h-5 text-[#d32f2f]" />
          <span className="font-bold text-[#1a1a1a]">
            アラート（{totalAlerts}件）
          </span>
          {isMultiSchool && alertsBySchool && (
            <div className="flex items-center gap-1">
              {alertsBySchool.map(([sid, group]) => {
                const color = schoolColorMap[sid];
                return (
                  <span key={sid} className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${color?.bg || 'bg-gray-100'} ${color?.text || 'text-gray-700'}`}>
                    {group.name} {group.count}
                  </span>
                );
              })}
            </div>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowInfoPopup(!showInfoPopup);
            }}
            className="text-gray-500 hover:text-gray-700 transition-colors duration-150"
            title="アラート内容の説明"
          >
            <Info className="w-4 h-4" />
          </button>
        </div>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-gray-400 hover:text-gray-600 transition-colors duration-150"
        >
          {isExpanded ? (
            <ChevronUp className="w-5 h-5" />
          ) : (
            <ChevronDown className="w-5 h-5" />
          )}
        </button>
      </div>

      {/* アラート内容説明ポップアップ */}
      {showInfoPopup && (
        <div className="relative">
          <div className="absolute top-2 left-4 z-10 bg-white border border-gray-200 rounded-xl shadow-xl p-4 min-w-[300px] dropdown-menu">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-[#1a1a1a]">アラート内容一覧</h3>
              <button
                onClick={() => setShowInfoPopup(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors duration-150"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2">
              {Object.entries(ALERT_TYPE_LABELS).map(([type, label]) => (
                <div key={type} className="flex items-start gap-2">
                  <span className={`px-2 py-1 text-xs font-medium rounded ${ALERT_TYPE_COLORS[type as keyof typeof ALERT_TYPE_COLORS]}`}>
                    {label}
                  </span>
                  <span className="text-sm text-[#4b5563] flex-1">
                    {alertTypeDescriptions[type]}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Heavy アラート取得失敗時のバナー */}
      {heavyLoadState === 'error' && (
        <div className="mx-4 mt-2 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center justify-between gap-3">
          <span className="text-sm text-amber-800">
            成績・テスト関連のアラートを読み込めませんでした
          </span>
          <button
            type="button"
            onClick={retryHeavyAlerts}
            className="px-3 py-1.5 text-sm font-medium text-amber-800 bg-amber-100 hover:bg-amber-200 rounded-md transition-colors duration-150"
          >
            再読み込み
          </button>
        </div>
      )}

      {/* Heavy アラート読み込み中表示 */}
      {heavyLoadState === 'loading' && (
        <div className="mx-4 mt-2 py-2">
          <InlineLoading label="成績・テスト関連のアラートを読み込み中..." />
        </div>
      )}

      {/* アラート一覧 */}
      {isExpanded && (
        <div className="p-3 space-y-2 max-h-[640px] overflow-y-auto">
          {isMultiSchool && alertsBySchool ? (
            alertsBySchool.map(([schoolId, group]) => {
              const color = schoolColorMap[schoolId];
              return (
                <div key={schoolId}>
                  <div className={`flex items-center gap-2 px-2 py-1.5 mb-1.5 rounded-lg ${color?.bg || 'bg-gray-100'}`}>
                    <span className={`text-xs font-bold ${color?.text || 'text-gray-700'}`}>
                      {group.name}
                    </span>
                    <span className="text-[10px] text-gray-500">{group.count}件</span>
                  </div>
                  <div className="space-y-1.5 mb-3">
                    {group.alerts.map((studentAlert) => (
                      <StudentAlertCard
                        key={studentAlert.student_id}
                        studentAlert={studentAlert}
                        handleDismiss={handleDismiss}
                        canDismiss={canDismiss}
                      />
                    ))}
                  </div>
                </div>
              );
            })
          ) : (
            studentAlerts.map((studentAlert) => (
              <StudentAlertCard
                key={studentAlert.student_id}
                studentAlert={studentAlert}
                handleDismiss={handleDismiss}
                canDismiss={canDismiss}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function StudentAlertCard({
  studentAlert,
  handleDismiss,
  canDismiss,
}: {
  studentAlert: StudentAlerts;
  handleDismiss: (alert: Alert) => void;
  canDismiss: boolean;
}) {
  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden bg-white">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 border-b border-gray-200">
        <span className="font-semibold text-sm text-[#1a1a1a]">
          {studentAlert.student_name}
        </span>
        <span className="text-xs text-gray-500">
          ({GRADE_LABELS[studentAlert.grade] || studentAlert.grade})
        </span>
      </div>
      <div className="p-2 space-y-1">
        {studentAlert.alerts.map((alert) => (
          <AlertItem
            key={alert.id}
            alert={alert}
            onDismiss={handleDismiss}
            canDismiss={canDismiss}
          />
        ))}
      </div>
    </div>
  );
}
