'use client';

import { useState, useEffect, useCallback } from 'react';
import { AlertItem } from './AlertItem';
import { getAlertsLight, getAlertsHeavy, mergeStudentAlerts, invalidateAlertCache } from '@/lib/api/alerts';
import type { StudentAlerts, Alert } from '@/types/alerts';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/useToast';
import { GRADE_LABELS } from '@/types/database';
import { ChevronDown, ChevronUp, Info } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { dismissAlert } from '@/lib/api/alerts';
import { completeTask } from '@/lib/api/interviews';
import { ALERT_TYPE_LABELS, ALERT_TYPE_COLORS } from '@/types/alerts';

interface AlertBoardProps {
  className?: string;
}

export function AlertBoard({ className = '' }: AlertBoardProps) {
  const { getSelectedSchoolIds, profile } = useAuth();
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

  const totalAlerts = studentAlerts.reduce((sum, sa) => sum + sa.alerts.length, 0);

  if (isLoading) {
    return (
      <div className={`bg-[#f8f8f8] rounded-xl border border-gray-200 p-4 ${className}`}>
        <div className="flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-[#1e3a5f] border-t-transparent rounded-full animate-spin"></div>
          <span className="ml-2 text-sm text-gray-500">アラートを読み込み中...</span>
        </div>
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
        <div className="flex items-center gap-2">
          <span className="text-lg">⚠️</span>
          <span className="font-bold text-[#1a1a1a]">
            アラート（{totalAlerts}件）
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowInfoPopup(!showInfoPopup);
            }}
            className="ml-2 text-gray-500 hover:text-gray-700 transition-colors"
            title="アラート内容の説明"
          >
            <Info className="w-4 h-4" />
          </button>
        </div>
        <button 
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-gray-400 hover:text-gray-600 transition-colors"
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
          <div className="absolute top-2 left-4 z-10 bg-white border border-gray-200 rounded-xl shadow-xl p-4 min-w-[300px]">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-[#1a1a1a]">アラート内容一覧</h3>
              <button
                onClick={() => setShowInfoPopup(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
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
            className="px-3 py-1.5 text-sm font-medium text-amber-800 bg-amber-100 hover:bg-amber-200 rounded-md transition-colors"
          >
            再読み込み
          </button>
        </div>
      )}

      {/* Heavy アラート読み込み中表示 */}
      {heavyLoadState === 'loading' && (
        <div className="mx-4 mt-2 py-2 flex items-center gap-2 text-sm text-gray-500">
          <span className="w-4 h-4 border-2 border-gray-300 border-t-[#1e3a5f] rounded-full animate-spin" />
          成績・テスト関連のアラートを読み込み中...
        </div>
      )}

      {/* アラート一覧（生徒ごとにカードヘッダーで区切り） */}
      {isExpanded && (
        <div className="p-4 space-y-4">
          {studentAlerts.map((studentAlert) => (
            <div key={studentAlert.student_id} className="rounded-lg border border-gray-200 overflow-hidden bg-white">
              {/* カードヘッダー：生徒名・学年（統一感のあるセクション区切り） */}
              <div className="flex items-center gap-2 px-4 py-3 bg-gray-50 border-b border-gray-200">
                <span className="font-semibold text-[#1a1a1a]">
                  {studentAlert.student_name}
                </span>
                <span className="text-xs text-gray-500">
                  （{GRADE_LABELS[studentAlert.grade] || studentAlert.grade}）
                </span>
              </div>
              <div className="p-3 space-y-2">
                {studentAlert.alerts.map((alert, index) => (
                  <AlertItem
                    key={`${alert.id}-${index}`}
                    alert={alert}
                    onDismiss={handleDismiss}
                    canDismiss={canDismiss}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
