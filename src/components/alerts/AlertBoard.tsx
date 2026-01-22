'use client';

import { useState, useEffect, useCallback } from 'react';
import { AlertItem } from './AlertItem';
import { getAlerts } from '@/lib/api/alerts';
import type { StudentAlerts, Alert } from '@/types/alerts';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/useToast';
import { GRADE_LABELS } from '@/types/database';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { dismissAlert } from '@/lib/api/alerts';

interface AlertBoardProps {
  className?: string;
}

export function AlertBoard({ className = '' }: AlertBoardProps) {
  const { getSelectedSchoolIds, profile } = useAuth();
  const { success, error: toastError } = useToast();
  const [studentAlerts, setStudentAlerts] = useState<StudentAlerts[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isExpanded, setIsExpanded] = useState(true);
  
  // 対応済み操作はmanager以上のみ
  const canDismiss = profile?.role === 'admin' || profile?.role === 'owner' || profile?.role === 'manager';

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
      <div 
        className="flex items-center justify-between p-4 bg-[#eff0f3] border-b border-[#0d0d0d] cursor-pointer hover:bg-[#0d0d0d]/5 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          <span className="text-lg">⚠️</span>
          <span className="font-semibold text-[#0d0d0d]">
            アラート（{totalAlerts}件）
          </span>
        </div>
        <button className="text-[#2a2a2a] hover:text-[#0d0d0d] transition-colors">
          {isExpanded ? (
            <ChevronUp className="w-5 h-5" />
          ) : (
            <ChevronDown className="w-5 h-5" />
          )}
        </button>
      </div>

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
