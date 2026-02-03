import { supabase } from '../supabase';
import { getDefaultSchoolId } from './schools';
import { listAssessments } from './assessments';
import { getStudentInterviews, getPendingTasks } from './interviews';
import { getApplicationItems, getStudentApplications } from './applications';
import { getStudents } from './students';
import { getStudentTextbooks } from './progress';
import type { Alert, AlertDismissal, StudentAlerts, AlertType } from '@/types/alerts';
import { SUBJECT_LABELS } from '@/types/database';

/**
 * 対応済み記録を取得
 */
export async function getAlertDismissals(schoolIds: string[]): Promise<AlertDismissal[]> {
  const { data, error } = await supabase
    .from('alert_dismissals')
    .select('*')
    .in('school_id', schoolIds);

  // テーブルが存在しない場合は空配列を返す（マイグレーション未実行）
  if (error) {
    if (error.code === 'PGRST116' || error.message.includes('schema cache')) {
      console.warn('alert_dismissalsテーブルが見つかりません。マイグレーションを実行してください:', error);
      return [];
    }
    throw new Error(`対応済み記録の取得に失敗しました: ${error.message}`);
  }

  return (data || []) as AlertDismissal[];
}

/**
 * アラートを対応済みにする
 */
export async function dismissAlert(
  schoolId: string,
  studentId: string,
  alertType: AlertType,
  alertKey: string,
  userId?: string,
  note?: string
): Promise<AlertDismissal> {
  const { data, error } = await supabase
    .from('alert_dismissals')
    .insert({
      school_id: schoolId,
      student_id: studentId,
      alert_type: alertType,
      alert_key: alertKey,
      dismissed_by: userId || null,
      note: note || null,
    })
    .select()
    .single();

  if (error) {
    // RLSエラーの場合は詳細なメッセージを表示
    if (error.code === '42501') {
      throw new Error(`対応済み記録の作成に失敗しました: RLSポリシー違反。マイグレーションを確認してください。${error.message}`);
    }
    throw new Error(`対応済み記録の作成に失敗しました: ${error.message}`);
  }

  return data as AlertDismissal;
}

/**
 * 対応済みを取り消す
 */
export async function undismissAlert(
  schoolId: string,
  studentId: string,
  alertType: AlertType,
  alertKey: string
): Promise<void> {
  const { error } = await supabase
    .from('alert_dismissals')
    .delete()
    .eq('school_id', schoolId)
    .eq('student_id', studentId)
    .eq('alert_type', alertType)
    .eq('alert_key', alertKey);

  if (error) {
    throw new Error(`対応済み記録の削除に失敗しました: ${error.message}`);
  }
}

/**
 * 成績低下アラートを計算
 */
async function calculateScoreDropAlerts(
  schoolIds: string[],
  dismissedSet: Set<string>
): Promise<Alert[]> {
  const alerts: Alert[] = [];
  
  try {
    // 全生徒を取得
    const students = await getStudents(undefined, schoolIds);
    
    for (const student of students) {
      // 各カテゴリ（regular_test, report_card, mock）ごとに判定
      const categories: Array<'regular_test' | 'report_card' | 'mock'> = ['regular_test', 'report_card', 'mock'];
      
      for (const category of categories) {
        const assessments = await listAssessments(student.id, category);
        
        // exam_month降順でソート
        const sorted = assessments.sort((a, b) => {
          if (!a.exam_month || !b.exam_month) return 0;
          return b.exam_month.localeCompare(a.exam_month);
        });
        
        if (sorted.length < 2) continue; // 2件以上ないと比較できない
        
        const latest = sorted[0];
        const previous = sorted[1];
        
        // 各科目を比較
        const latestScores = new Map(
          latest.scores.map(s => [s.subject_code, s.score])
        );
        const previousScores = new Map(
          previous.scores.map(s => [s.subject_code, s.score])
        );
        
        for (const [subjectCode, latestScore] of latestScores.entries()) {
          if (latestScore == null) continue;
          
          const previousScore = previousScores.get(subjectCode);
          if (previousScore == null) continue;
          
          const diff = latestScore - previousScore;
          if (diff <= -10) {
            const alertKey = `${category}:${subjectCode}:${latest.exam_month || latest.id}`;
            const alertId = `${student.id}:score_drop:${alertKey}`;
            
            if (dismissedSet.has(alertId)) continue;
            
            alerts.push({
              id: alertId,
              student_id: student.id,
              student_name: `${student.last_name} ${student.first_name}`,
              grade: student.grade,
              alert_type: 'score_drop',
              alert_key: alertKey,
              message: `${SUBJECT_LABELS[subjectCode] || subjectCode} ${diff}点`,
              details: {
                subject: subjectCode,
                previous_value: previousScore,
                current_value: latestScore,
                diff,
              },
            });
          }
        }
      }
    }
  } catch (error) {
    console.error('Error calculating score drop alerts:', error);
  }
  
  return alerts;
}

/**
 * 成績未入力アラートを計算
 */
async function calculateScoreMissingAlerts(
  schoolIds: string[],
  dismissedSet: Set<string>
): Promise<Alert[]> {
  const alerts: Alert[] = [];
  
  try {
    const students = await getStudents(undefined, schoolIds);
    
    for (const student of students) {
      const categories: Array<'regular_test' | 'report_card' | 'mock'> = ['regular_test', 'report_card', 'mock'];
      
      for (const category of categories) {
        const assessments = await listAssessments(student.id, category);
        
        if (assessments.length === 0) continue;
        
        // 最新のassessmentを取得
        const sorted = assessments.sort((a, b) => {
          if (!a.exam_month || !b.exam_month) return 0;
          return b.exam_month.localeCompare(a.exam_month);
        });
        
        const latest = sorted[0];
        
        // 期待される科目リストを取得
        const expectedSubjects = category === 'mock'
          ? ['english', 'math', 'japanese', 'social', 'science', 'conv_5', 'conv_4', 'conv_total']
          : ['english', 'math', 'japanese', 'social', 'science', 'music', 'art', 'tech_home', 'pe'];
        
        // 空欄科目をチェック
        const missingSubjects: string[] = [];
        for (const subjectCode of expectedSubjects) {
          const score = latest.scores.find(s => s.subject_code === subjectCode);
          if (!score || score.score == null) {
            missingSubjects.push(subjectCode);
          }
        }
        
        if (missingSubjects.length > 0) {
          const examMonthStr = latest.exam_month 
            ? new Date(latest.exam_month).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long' })
            : '最新';
          const alertKey = `${category}:${latest.exam_month || latest.id}`;
          const alertId = `${student.id}:score_missing:${alertKey}`;
          
          if (dismissedSet.has(alertId)) continue;
          
          alerts.push({
            id: alertId,
            student_id: student.id,
            student_name: `${student.last_name} ${student.first_name}`,
            grade: student.grade,
            alert_type: 'score_missing',
            alert_key: alertKey,
            message: `${examMonthStr} ${missingSubjects.map(s => SUBJECT_LABELS[s] || s).join('・')}`,
            details: {
              subject: missingSubjects.join(','),
            },
          });
        }
      }
    }
  } catch (error) {
    console.error('Error calculating score missing alerts:', error);
  }
  
  return alerts;
}

/**
 * 面談未更新アラートを計算
 */
async function calculateInterviewOverdueAlerts(
  schoolIds: string[],
  dismissedSet: Set<string>
): Promise<Alert[]> {
  const alerts: Alert[] = [];
  
  try {
    const students = await getStudents(undefined, schoolIds);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    for (const student of students) {
      try {
        const interviews = await getStudentInterviews(student.id);
        
        let lastInterviewDate: Date | null = null;
        if (interviews.length > 0) {
          lastInterviewDate = new Date(interviews[0].interview_date);
          lastInterviewDate.setHours(0, 0, 0, 0);
        }
        
        const daysDiff = lastInterviewDate
          ? Math.floor((today.getTime() - lastInterviewDate.getTime()) / (1000 * 60 * 60 * 24))
          : Infinity;
        
        if (daysDiff > 30) {
          const alertKey = `interview:${lastInterviewDate ? lastInterviewDate.toISOString().split('T')[0] : 'never'}`;
          const alertId = `${student.id}:interview_overdue:${alertKey}`;
          
          if (dismissedSet.has(alertId)) continue;
          
          alerts.push({
            id: alertId,
            student_id: student.id,
            student_name: `${student.last_name} ${student.first_name}`,
            grade: student.grade,
            alert_type: 'interview_overdue',
            alert_key: alertKey,
            message: lastInterviewDate ? `${daysDiff}日経過` : '面談記録なし',
            details: {
              days_overdue: daysDiff,
            },
          });
        }
      } catch (err) {
        // 面談記録取得エラーは無視（テーブルが存在しない場合など）
        console.warn(`Failed to get interviews for student ${student.id}:`, err);
      }
    }
  } catch (error) {
    console.error('Error calculating interview overdue alerts:', error);
  }
  
  return alerts;
}

/**
 * 申込未提出アラートを計算
 */
async function calculateApplicationOverdueAlerts(
  schoolIds: string[],
  dismissedSet: Set<string>
): Promise<Alert[]> {
  const alerts: Alert[] = [];
  
  try {
    const items = await getApplicationItems(schoolIds, false);
    let applications: any[] = [];
    try {
      applications = await getStudentApplications(schoolIds);
    } catch (error: any) {
      // student_applicationsテーブルが存在しない、またはRLSエラーの場合は空配列を返す
      console.warn('申込状況の取得に失敗しました（無視します）:', error);
      applications = [];
    }
    const students = await getStudents(undefined, schoolIds);
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // 期日が過ぎているcheckタイプの項目を取得
    const overdueItems = items.filter(item => {
      if (item.column_type !== 'check') return false;
      if (!item.due_date) return false;
      const dueDate = new Date(item.due_date);
      dueDate.setHours(0, 0, 0, 0);
      return dueDate < today;
    });
    
    // 生徒ごとにチェック
    for (const student of students) {
      for (const item of overdueItems) {
        const app = applications.find(
          a => a.student_id === student.id && a.item_id === item.id
        );
        
        // statusが'completed'または'not_applicable'の場合は対象外
        if (app?.status === 'completed' || app?.status === 'not_applicable') {
          continue;
        }
        
        const alertKey = `application:${item.id}:${item.due_date}`;
        const alertId = `${student.id}:application_overdue:${alertKey}`;
        
        if (dismissedSet.has(alertId)) continue;
        
        const dueDateStr = item.due_date 
          ? new Date(item.due_date).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })
          : '';
        
        alerts.push({
          id: alertId,
          student_id: student.id,
          student_name: `${student.last_name} ${student.first_name}`,
          grade: student.grade,
          alert_type: 'application_overdue',
          alert_key: alertKey,
          message: `${item.name}（期日: ${dueDateStr}）`,
          details: {
            item_name: item.name,
            due_date: item.due_date || undefined,
          },
        });
      }
    }
  } catch (error) {
    console.error('Error calculating application overdue alerts:', error);
  }
  
  return alerts;
}

/**
 * 面談タスクアラートを計算（未完了のタスク）
 */
async function calculateInterviewTaskAlerts(
  schoolIds: string[],
  dismissedSet: Set<string>
): Promise<Alert[]> {
  const alerts: Alert[] = [];
  
  try {
    // 各教室の未完了タスクを取得
    for (const schoolId of schoolIds) {
      try {
        const pendingTasks = await getPendingTasks(schoolId);
        
        for (const task of pendingTasks) {
          const alertKey = `task:${task.id}`;
          const alertId = `${task.student_id}:interview_task:${alertKey}`;
          
          if (dismissedSet.has(alertId)) continue;
          
          // 生徒情報を取得
          const { data: student, error: studentError } = await supabase
            .from('students')
            .select('last_name, first_name, grade')
            .eq('id', task.student_id)
            .single();
          
          if (studentError || !student) {
            console.warn(`Student not found for task ${task.id}`);
            continue;
          }
          
          // タスクの日付をフォーマット
          const taskDateStr = task.interview_date
            ? new Date(task.interview_date).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })
            : '';
          
          // タスクの内容の最初の50文字を取得
          const contentPreview = task.content 
            ? (task.content.length > 50 ? task.content.substring(0, 50) + '...' : task.content)
            : '';
          
          alerts.push({
            id: alertId,
            student_id: task.student_id,
            student_name: `${student.last_name} ${student.first_name}`,
            grade: student.grade,
            alert_type: 'interview_task',
            alert_key: alertKey,
            message: taskDateStr ? `${taskDateStr}: ${contentPreview}` : contentPreview || 'タスク',
            details: {
              task_id: task.id,
              interview_date: task.interview_date,
              content: task.content || undefined,
            },
          });
        }
      } catch (error) {
        // テーブルが存在しない場合などは無視
        console.warn(`Failed to get pending tasks for school ${schoolId}:`, error);
      }
    }
  } catch (error) {
    console.error('Error calculating interview task alerts:', error);
  }
  
  return alerts;
}

/**
 * テスト未更新アラートを計算（テスト日が過ぎているのに更新されていないもの）
 */
async function calculateExamOverdueAlerts(
  schoolIds: string[],
  dismissedSet: Set<string>
): Promise<Alert[]> {
  const alerts: Alert[] = [];
  
  try {
    const students = await getStudents(undefined, schoolIds);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    for (const student of students) {
      try {
        // 生徒のテキスト一覧を取得
        const studentTextbooks = await getStudentTextbooks(student.id, false);
        
        for (const studentTextbook of studentTextbooks) {
          // 各テキストのテスト設定を取得
          const { data: exams, error: examsError } = await supabase
            .from('student_textbook_exams')
            .select('*')
            .eq('student_textbook_id', studentTextbook.id)
            .order('exam_date', { ascending: true });
          
          if (examsError) {
            console.warn(`Failed to get exams for student_textbook ${studentTextbook.id}:`, examsError);
            continue;
          }
          
          if (!exams || exams.length === 0) continue;
          
          // テスト日が過ぎているものをチェック（「次回テストまで」がマイナスになっているもの）
          for (const exam of exams) {
            if (!exam.exam_date) continue;
            
            const examDate = new Date(exam.exam_date);
            examDate.setHours(0, 0, 0, 0);
            
            // 「次回テストまで」を計算（テスト日までの日数）
            const daysUntil = Math.ceil((examDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
            
            // 「次回テストまで」がマイナス（テスト日が過ぎている）場合のみアラート
            if (daysUntil < 0) {
              const alertKey = `exam:${exam.id}`;
              const alertId = `${student.id}:exam_overdue:${alertKey}`;
              
              if (dismissedSet.has(alertId)) continue;
              
              // テスト名を取得
              let examName = 'テスト';
              if (exam.custom_exam_name) {
                examName = exam.custom_exam_name;
              } else if (exam.exam_type_id) {
                const { data: examType } = await supabase
                  .from('exam_types')
                  .select('name')
                  .eq('id', exam.exam_type_id)
                  .single();
                if (examType) {
                  examName = examType.name;
                }
              }
              
              // テキスト名を取得
              const textbookName = studentTextbook.textbook?.name || 'テキスト';
              
              // 日付をフォーマット
              const examDateStr = examDate.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' });
              const daysDiff = Math.floor((today.getTime() - examDate.getTime()) / (1000 * 60 * 60 * 24));
              
              alerts.push({
                id: alertId,
                student_id: student.id,
                student_name: `${student.last_name} ${student.first_name}`,
                grade: student.grade,
                alert_type: 'exam_overdue',
                alert_key: alertKey,
                message: `${textbookName}: ${examName}（${examDateStr}、${daysDiff}日経過）`,
                details: {
                  exam_id: exam.id,
                  exam_date: exam.exam_date,
                  exam_name: examName,
                  textbook_name: textbookName,
                  days_overdue: daysDiff,
                },
              });
            }
          }
        }
      } catch (err) {
        // エラーは無視（テーブルが存在しない場合など）
        console.warn(`Failed to get exams for student ${student.id}:`, err);
      }
    }
  } catch (error) {
    console.error('Error calculating exam overdue alerts:', error);
  }
  
  return alerts;
}

/**
 * 全アラートを取得（リアルタイム計算）
 */
export async function getAlerts(schoolIds: string[]): Promise<StudentAlerts[]> {
  // 対応済み記録を取得
  const dismissals = await getAlertDismissals(schoolIds);
  const dismissedSet = new Set(
    dismissals.map(d => `${d.student_id}:${d.alert_type}:${d.alert_key}`)
  );
  
  // 各アラートタイプを計算
  const [
    scoreDropAlerts,
    scoreMissingAlerts,
    interviewOverdueAlerts,
    applicationOverdueAlerts,
    interviewTaskAlerts,
    examOverdueAlerts,
  ] = await Promise.all([
    calculateScoreDropAlerts(schoolIds, dismissedSet),
    calculateScoreMissingAlerts(schoolIds, dismissedSet),
    calculateInterviewOverdueAlerts(schoolIds, dismissedSet),
    calculateApplicationOverdueAlerts(schoolIds, dismissedSet),
    calculateInterviewTaskAlerts(schoolIds, dismissedSet),
    calculateExamOverdueAlerts(schoolIds, dismissedSet),
  ]);
  
  // 全アラートを結合
  const allAlerts = [
    ...scoreDropAlerts,
    ...scoreMissingAlerts,
    ...interviewOverdueAlerts,
    ...applicationOverdueAlerts,
    ...interviewTaskAlerts,
    ...examOverdueAlerts,
  ];
  
  // 生徒ごとにグループ化
  const studentAlertsMap = new Map<string, StudentAlerts>();
  
  for (const alert of allAlerts) {
    if (!studentAlertsMap.has(alert.student_id)) {
      studentAlertsMap.set(alert.student_id, {
        student_id: alert.student_id,
        student_name: alert.student_name,
        grade: alert.grade,
        alerts: [],
      });
    }
    studentAlertsMap.get(alert.student_id)!.alerts.push(alert);
  }
  
  // 配列に変換してソート（学年順、名前順）
  return Array.from(studentAlertsMap.values()).sort((a, b) => {
    if (a.grade !== b.grade) return a.grade - b.grade;
    return a.student_name.localeCompare(b.student_name, 'ja');
  });
}
