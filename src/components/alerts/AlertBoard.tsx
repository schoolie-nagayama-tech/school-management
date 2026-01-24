'use client';

import { useState, useEffect, useCallback } from 'react';
import { AlertItem } from './AlertItem';
import { getAlerts } from '@/lib/api/alerts';
import type { StudentAlerts, Alert } from '@/types/alerts';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/useToast';
import { GRADE_LABELS } from '@/types/database';
import { ChevronDown, ChevronUp, Info } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { dismissAlert } from '@/lib/api/alerts';
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

  const fetchAlerts = useCallback(async () => {
    setIsLoading(true);
    try {
      const schoolIds = getSelectedSchoolIds();
      if (schoolIds.length === 0) {
        setStudentAlerts([]);
        return;
      }
      const alerts = await getAlerts(schoolIds);
      setStudentAlerts(alerts);
    } catch (error) {
      console.error('Error fetching alerts:', error);
      toastError('アラートの取得に失敗しました');
    } finally {
      setIsLoading(false);
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
      
      // 生徒のschool_idを取得
      const { data: student, error: studentError } = await supabase
        .from('students')
        .select('school_id')
        .eq('id', alert.student_id)
        .single();
      
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
      // アラートを再取得
      await fetchAlerts();
    } catch (error) {
      console.error('Error dismissing alert:', error);
      toastError('対応済みの記録に失敗しました');
    }
  }, [canDismiss, getSelectedSchoolIds, profile?.id, success, toastError, fetchAlerts]);

  const totalAlerts = studentAlerts.reduce((sum, sa) => sum + sa.alerts.length, 0);

  if (isLoading) {
    return (
      <div className={`bg-[#fffffe] rounded-xl border border-[#0d0d0d] p-4 ${className}`}>
        <div className="flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-[#ff8e3c] border-t-transparent rounded-full animate-spin"></div>
          <span className="ml-2 text-sm text-[#2a2a2a]">アラートを読み込み中...</span>
        </div>
      </div>
    );
  }

  if (totalAlerts === 0) {
    return (
      <div className={`bg-[#fffffe] rounded-xl border border-[#0d0d0d] p-4 ${className}`}>
        <div className="text-center text-sm text-[#2a2a2a]">
          対応が必要な項目はありません
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-[#fffffe] rounded-xl border border-[#0d0d0d] overflow-hidden ${className}`}>
      {/* ヘッダー */}
      <div className="flex items-center justify-between p-4 bg-[#eff0f3] border-b border-[#0d0d0d]">
        <div className="flex items-center gap-2">
          <span className="text-lg">⚠️</span>
          <span className="font-semibold text-[#0d0d0d]">
            アラート（{totalAlerts}件）
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowInfoPopup(!showInfoPopup);
            }}
            className="ml-2 text-[#2a2a2a] hover:text-[#0d0d0d] transition-colors"
            title="アラート内容の説明"
          >
            <Info className="w-4 h-4" />
          </button>
        </div>
        <button 
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-[#2a2a2a] hover:text-[#0d0d0d] transition-colors"
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
          <div className="absolute top-2 left-4 z-10 bg-[#fffffe] border-2 border-[#0d0d0d] rounded-lg shadow-lg p-4 min-w-[300px]">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-[#0d0d0d]">アラート内容一覧</h3>
              <button
                onClick={() => setShowInfoPopup(false)}
                className="text-[#2a2a2a] hover:text-[#0d0d0d] transition-colors"
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
                  <span className="text-sm text-[#2a2a2a] flex-1">
                    {alertTypeDescriptions[type]}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* アラート一覧 */}
      {isExpanded && (
        <div className="p-4 space-y-4">
          {studentAlerts.map((studentAlert) => (
            <div key={studentAlert.student_id} className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-[#0d0d0d]">
                  {studentAlert.student_name}
                </span>
                <span className="text-xs text-[#2a2a2a]/70">
                  （{GRADE_LABELS[studentAlert.grade] || studentAlert.grade}）
                </span>
              </div>
              <div className="space-y-2 ml-4">
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
          ))}
        </div>
      )}
    </div>
  );
}
