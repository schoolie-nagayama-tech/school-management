'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AdminLayout } from '@/components/layouts';
import { Button, ToastContainer, Modal, Select } from '@/components/ui';
import { useToast } from '@/hooks/useToast';
import {
  getStudentTextbooks,
  createStudentTextbook,
  updateStudentTextbook,
  deleteStudentTextbook,
  getStudentTextbookSettings,
  upsertStudentTextbookSettings,
  getStudentTextbookExams,
  createStudentTextbookExam,
  updateStudentTextbookExam,
  deleteStudentTextbookExam,
  getStudentProgress,
  upsertStudentProgress,
  updateStudentProgress,
  upsertStudentProgressLesson,
  deleteStudentProgressLesson,
  groupProgressItems,
  ungroupProgressItems,
  updateGroupCounts,
  convertToDisplayRows,
} from '@/lib/api/progress';
import { getTextbooks } from '@/lib/api/textbooks';
import { getExamTypes } from '@/lib/api/textbooks';
import { getStudent } from '@/lib/api/students';
import { getDefaultSchoolId } from '@/lib/api/schools';
import { exportProgressToPDF } from '@/lib/utils/pdfExport';
import ParentProgressTable from '@/components/students/ParentProgressTable';
import {
  getSeasonalCourses,
  applyCoursesToStudents,
} from '@/lib/api/seasonalCourses';
import type {
  Student,
  StudentTextbookWithDetails,
  CurriculumItemWithProgress,
  Textbook,
  ExamType,
  StudentTextbookSetting,
  StudentTextbookExam,
  StudentProgress,
  StudentProgressLesson,
  CurriculumItem,
  ProgressRowDisplay,
  StudentProgressWithDetails,
  SeasonalCourseWithDetails,
} from '@/types/database';
import { GRADE_LABELS, SEASON_LABELS } from '@/types/database';
import { useAuth } from '@/contexts/AuthContext';

export default function StudentProgressPage() {
  const params = useParams();
  const router = useRouter();
  const studentId = params?.studentId as string;
  const { toasts, removeToast, success, error } = useToast();
  const { profile } = useAuth();
  
  // 講師かどうかを判定（講師は下書きを見られない）
  const isTeacher = profile?.role === 'teacher';

  const [student, setStudent] = useState<Student | null>(null);
  const [studentTextbooks, setStudentTextbooks] = useState<StudentTextbookWithDetails[]>([]);
  const [allTextbooks, setAllTextbooks] = useState<Textbook[]>([]);
  const [examTypes, setExamTypes] = useState<ExamType[]>([]);
  const [selectedTextbookId, setSelectedTextbookId] = useState<string | null>(null);
  const [progressData, setProgressData] = useState<CurriculumItemWithProgress[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [showProposalCount, setShowProposalCount] = useState(false);
  const [showApplicationCount, setShowApplicationCount] = useState(false);
  const [showLesson2, setShowLesson2] = useState(false);
  const [showLesson3, setShowLesson3] = useState(false);
  const [showExamRange, setShowExamRange] = useState(true);
  const [showSchoolProgress, setShowSchoolProgress] = useState(true);
  const [showLesson1, setShowLesson1] = useState(true);
  const [showHandover, setShowHandover] = useState(true);
  const [isAddTextbookModalOpen, setIsAddTextbookModalOpen] = useState(false);
  const [selectedGradeCategory, setSelectedGradeCategory] = useState<'elementary' | 'middle' | 'high' | ''>('');
  const [selectedSubject, setSelectedSubject] = useState<string>('');
  const [isAddExamModalOpen, setIsAddExamModalOpen] = useState(false);
  const [newExamTypeId, setNewExamTypeId] = useState<string>('');
  const [newExamDate, setNewExamDate] = useState<string>('');
  const [newExamTargetScore, setNewExamTargetScore] = useState<string>('');
  const [newExamRange, setNewExamRange] = useState<string>('');
  const [newCustomExamName, setNewCustomExamName] = useState<string>('');
  const [isCustomExamName, setIsCustomExamName] = useState(false);
  const [isArchiveModalOpen, setIsArchiveModalOpen] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Set<number>>(new Set());
  const [isSaving, setIsSaving] = useState(false);
  const [viewMode, setViewMode] = useState<'admin' | 'parent'>('admin');
  const [isApplyCourseModalOpen, setIsApplyCourseModalOpen] = useState(false);
  const [availableCourses, setAvailableCourses] = useState<SeasonalCourseWithDetails[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState<string>('');
  const [courseApplyMode, setCourseApplyMode] = useState<'overwrite' | 'add'>('overwrite');

  // 生徒情報を取得
  const fetchStudent = useCallback(async () => {
    if (!studentId) return;
    try {
      const data = await getStudent(studentId);
      if (data) {
        setStudent(data);
      } else {
        setErrorMessage('生徒が見つかりません');
      }
    } catch (err) {
      console.error('Error fetching student:', err);
      setErrorMessage(err instanceof Error ? err.message : '生徒情報の取得に失敗しました');
    }
  }, [studentId]);

  // 生徒テキスト一覧を取得
  const fetchStudentTextbooks = useCallback(async () => {
    if (!studentId) return;
    try {
      const data = await getStudentTextbooks(studentId, true);
      // 講師の場合は下書きを除外
      const filtered = isTeacher 
        ? data.filter(st => !st.is_draft)
        : data;
      // sort_orderでソート
      const sorted = [...filtered].sort((a, b) => {
        const orderA = a.sort_order ?? 0;
        const orderB = b.sort_order ?? 0;
        if (orderA !== orderB) return orderA - orderB;
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      });
      setStudentTextbooks(sorted);
      if (sorted.length > 0 && !selectedTextbookId) {
        setSelectedTextbookId(sorted[0].id);
      }
    } catch (err) {
      console.error('Error fetching student textbooks:', err);
      error(err instanceof Error ? err.message : 'テキスト一覧の取得に失敗しました');
    }
  }, [studentId, selectedTextbookId, error, isTeacher]);

  // テキストマスタを取得
  const fetchTextbooks = useCallback(async () => {
    try {
      const data = await getTextbooks();
      setAllTextbooks(data);
    } catch (err) {
      console.error('Error fetching textbooks:', err);
    }
  }, []);

  // テスト名マスタを取得
  const fetchExamTypes = useCallback(async () => {
    try {
      const data = await getExamTypes();
      setExamTypes(data);
    } catch (err) {
      console.error('Error fetching exam types:', err);
    }
  }, []);

  // 進行記録を取得
  const fetchProgress = useCallback(async () => {
    if (!selectedTextbookId) return;
    try {
      const data = await getStudentProgress(selectedTextbookId);
      setProgressData(data);
    } catch (err) {
      console.error('Error fetching progress:', err);
      error(err instanceof Error ? err.message : '進行記録の取得に失敗しました');
      setProgressData([]);
    }
  }, [selectedTextbookId, error]);

  // 表示用データ変換（グループ化対応）
  const displayRows = useMemo(() => {
    if (progressData.length === 0) return [];
    
    const curriculumItems: CurriculumItem[] = progressData.map(item => ({
      id: item.id,
      textbook_id: item.textbook_id,
      sort_order: item.sort_order,
      item_number: item.item_number,
      title: item.title,
      item_type: item.item_type,
      created_at: item.created_at,
    }));
    
    const progressList: StudentProgress[] = progressData
      .filter(item => item.progress)
      .map(item => {
        const { lessons, ...progressWithoutLessons } = item.progress!;
        return {
          ...progressWithoutLessons,
          curriculum_item_id: item.id,
        } as StudentProgress;
      });
    
    const displayRowsResult = convertToDisplayRows(curriculumItems, progressList);
    
    // lessonsを復元
    const progressWithLessonsMap = new Map<number, StudentProgressWithDetails>();
    progressData.forEach(item => {
      if (item.progress) {
        progressWithLessonsMap.set(item.id, item.progress);
      }
    });
    
    return displayRowsResult.map(row => {
      const progressWithLessons = progressWithLessonsMap.get(row.curriculumItem.id);
      if (progressWithLessons && row.progress) {
        return {
          ...row,
          progress: {
            ...row.progress,
            lessons: progressWithLessons.lessons,
          } as StudentProgress & { lessons?: StudentProgressLesson[] },
        };
      }
      return row;
    });
  }, [progressData]);

  // 合計計算
  const totalProposalCount = useMemo(() => {
    return displayRows
      .filter(row => row.isGroupStart)
      .reduce((sum, row) => sum + row.groupProposalCount, 0);
  }, [displayRows]);

  const totalApplicationCount = useMemo(() => {
    return displayRows
      .filter(row => row.isGroupStart)
      .reduce((sum, row) => sum + row.groupApplicationCount, 0);
  }, [displayRows]);

  // PDF出力（単一テキスト）
  const handleExportPDF = async () => {
    try {
      const textbookName = selectedTextbook?.textbook.name || 'テキスト';
      const studentNameStr = student ? `${student.last_name} ${student.first_name}` : '生徒';
      const filename = `進行表_${studentNameStr}_${textbookName}_${new Date().toISOString().slice(0, 10)}.pdf`;
      
      await exportProgressToPDF('progress-table-container', filename, {
        fitToPage: true, // 1ページに収める
        orientation: 'portrait', // 縦向き
      });
      success('PDFを出力しました');
    } catch (err) {
      console.error('PDF出力エラー:', err);
      error(err instanceof Error ? err.message : 'PDF出力に失敗しました');
    }
  };

  // 講習ごとにPDF出力（テキストごとに1ページ）
  const handleExportPDFBySeason = async () => {
    if (!student || !selectedTextbook) {
      error('テキストを選択してください');
      return;
    }
    
    try {
      const studentNameStr = `${student.last_name} ${student.first_name}`;
      
      // 現在選択されているテキストの季節を取得
      const currentSeason = selectedTextbook.season;
      
      if (!currentSeason) {
        error('選択中のテキストに季節が設定されていません');
        return;
      }

      // 同じ季節のテキストをフィルター
      const textbooksInSeason = studentTextbooks
        .filter(st => st.is_active && st.season === currentSeason);

      if (textbooksInSeason.length === 0) {
        error('同じ季節のテキストが見つかりません');
        return;
      }

      // 季節名を取得
      const seasonLabel = ['spring', 'summer', 'winter'].includes(currentSeason)
        ? SEASON_LABELS[currentSeason as 'spring' | 'summer' | 'winter']
        : currentSeason;

      // html2canvas と jspdf を動的インポート
      const [html2canvasModule, jsPDFModule] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ]);
      
      const html2canvas = html2canvasModule.default;
      const { jsPDF } = jsPDFModule;

      // PDFインスタンスを作成
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageWidth = 210; // A4縦向き幅（mm）
      const pageHeight = 297; // A4縦向き高さ（mm）
      const imgWidth = pageWidth - 10; // マージン5mm x 2
      let isFirstPage = true;

      // 同じ季節の各テキストごとに1ページのPDFを生成して結合
      for (const st of textbooksInSeason) {
          // 各テキスト用の一時コンテナを作成
          const tempContainer = document.createElement('div');
          tempContainer.id = `temp-pdf-container-${currentSeason}-${st.id}`;
          tempContainer.style.position = 'absolute';
          tempContainer.style.left = '-9999px';
          tempContainer.style.width = '800px';
          document.body.appendChild(tempContainer);

          try {
            // 進行表データを取得
            const progressData = await getStudentProgress(st.id);
            const curriculumItems: CurriculumItem[] = progressData.map(item => ({
              id: item.id,
              textbook_id: item.textbook_id,
              sort_order: item.sort_order,
              item_number: item.item_number,
              title: item.title,
              item_type: item.item_type,
              created_at: item.created_at,
            }));
            
            // progressListを作成（lessons情報を保持）
            const progressListWithLessons: Array<StudentProgress & { lessons?: StudentProgressLesson[] }> = progressData
              .filter(item => item.progress)
              .map(item => {
                const progress = item.progress!;
                return {
                  id: progress.id,
                  student_textbook_id: progress.student_textbook_id,
                  curriculum_item_id: item.id,
                  proposal_count: progress.proposal_count,
                  application_count: progress.application_count,
                  exam_range_exam_type_id: progress.exam_range_exam_type_id,
                  school_progress_date: progress.school_progress_date,
                  handover: progress.handover,
                  group_number: progress.group_number,
                  created_at: progress.created_at,
                  updated_at: progress.updated_at,
                  lessons: progress.lessons,
                };
              });
            
            // convertToDisplayRows用にlessonsを除外
            const progressListForDisplay: StudentProgress[] = progressListWithLessons.map(p => {
              const { lessons, ...withoutLessons } = p;
              return withoutLessons;
            });
            
            const displayRowsForTextbook = convertToDisplayRows(curriculumItems, progressListForDisplay);
            
            // lessons情報を復元
            const progressWithLessonsMap = new Map<number, StudentProgressWithDetails>();
            progressData.forEach(item => {
              if (item.progress) {
                progressWithLessonsMap.set(item.id, item.progress);
              }
            });
            
            const displayRowsWithLessons = displayRowsForTextbook.map(row => {
              const progressWithLessons = progressWithLessonsMap.get(row.curriculumItem.id);
              if (progressWithLessons && row.progress) {
                return {
                  ...row,
                  progress: {
                    ...row.progress,
                    lessons: progressWithLessons.lessons,
                  } as StudentProgress & { lessons?: StudentProgressLesson[] },
                };
              }
              return row;
            });
            
            // HTMLを生成（1テキスト分）
            tempContainer.innerHTML = `
              <div class="print-container" style="padding: 20px;">
                <h2 style="text-align: center; font-size: 20px; font-weight: bold; margin-bottom: 20px;">
                  学習進行表（ご提案内容）
                </h2>
                <div style="display: flex; justify-content: space-between; margin-bottom: 20px; font-size: 14px;">
                  <div>生徒名: ${studentNameStr}</div>
                  <div>教材: ${st.textbook.name}</div>
                </div>
                ${renderProgressTableHTML(displayRowsWithLessons, {
                  showProposalCount,
                  showApplicationCount,
                  showExamRange,
                  showSchoolProgress,
                  showLesson1,
                  showLesson2,
                  showLesson3,
                  showHandover,
                })}
              </div>
            `;

            // フォントサイズを小さくして1ページに収める
            const tables = tempContainer.querySelectorAll('table');
            tables.forEach(table => {
              table.style.fontSize = '10px';
              const cells = table.querySelectorAll('th, td');
              cells.forEach(cell => {
                (cell as HTMLElement).style.fontSize = '10px';
                (cell as HTMLElement).style.padding = '4px 6px';
              });
            });

            // HTML要素をCanvasに変換
            const canvas = await html2canvas(tempContainer, {
              scale: 1.5,
              useCORS: true,
              logging: false,
              backgroundColor: '#ffffff',
            });

            // Canvas画像のサイズを計算
            const imgHeight = (canvas.height * imgWidth) / canvas.width;

            // 新しいページを追加（最初のページ以外）
            if (!isFirstPage) {
              pdf.addPage();
            } else {
              isFirstPage = false;
            }

            // 1ページに収まるようにスケール調整
            let finalWidth = imgWidth;
            let finalHeight = imgHeight;
            let xOffset = 5;
            let yOffset = 5;

            if (imgHeight > pageHeight - 10) {
              // 1ページに収まらない場合、スケールを調整
              const scale = (pageHeight - 10) / imgHeight;
              finalWidth = imgWidth * scale;
              finalHeight = imgHeight * scale;
              xOffset = (pageWidth - finalWidth) / 2;
              yOffset = (pageHeight - finalHeight) / 2;
            }

            // PDFに画像を追加
            pdf.addImage(
              canvas.toDataURL('image/png'),
              'PNG',
              xOffset,
              yOffset,
              finalWidth,
              finalHeight
            );
          } finally {
            document.body.removeChild(tempContainer);
          }
        }

      // 現在の季節のテキストをまとめたPDFをダウンロード
      const filename = `進行表_${studentNameStr}_${seasonLabel}_${new Date().toISOString().slice(0, 10)}.pdf`;
      pdf.save(filename);

      success(`${seasonLabel}のPDFを出力しました`);
    } catch (err) {
      console.error('PDF出力エラー:', err);
      error(err instanceof Error ? err.message : 'PDF出力に失敗しました');
    }
  };

  // 進行表のHTMLを生成（ヘルパー関数）
  const renderProgressTableHTML = (
    displayRows: Array<ProgressRowDisplay & { progress?: (StudentProgress & { lessons?: StudentProgressLesson[] }) | null }>,
    columnVisibility: {
      showProposalCount: boolean;
      showApplicationCount: boolean;
      showExamRange: boolean;
      showSchoolProgress: boolean;
      showLesson1: boolean;
      showLesson2: boolean;
      showLesson3: boolean;
      showHandover: boolean;
    }
  ): string => {
    const totalProposal = displayRows
      .filter(row => row.isGroupStart)
      .reduce((sum, row) => sum + row.groupProposalCount, 0);
    
    const totalApplication = displayRows
      .filter(row => row.isGroupStart)
      .reduce((sum, row) => sum + row.groupApplicationCount, 0);

    let html = `
      <table style="width: 100%; border-collapse: collapse; border: 1px solid #000;">
        <thead>
          <tr style="background-color: #f5f5f5;">
            <th style="border: 1px solid #000; padding: 8px; text-align: left; font-weight: bold;">単元名</th>
            ${columnVisibility.showProposalCount ? '<th style="border: 1px solid #000; padding: 8px; text-align: center; font-weight: bold;">ご提案<br/>コマ数</th>' : ''}
            ${columnVisibility.showApplicationCount ? '<th style="border: 1px solid #000; padding: 8px; text-align: center; font-weight: bold;">申込<br/>コマ数</th>' : ''}
            ${columnVisibility.showExamRange ? '<th style="border: 1px solid #000; padding: 8px; text-align: center; font-weight: bold;">試験範囲</th>' : ''}
            ${columnVisibility.showSchoolProgress ? '<th style="border: 1px solid #000; padding: 8px; text-align: center; font-weight: bold;">学校進度</th>' : ''}
            ${columnVisibility.showLesson1 ? '<th style="border: 1px solid #000; padding: 8px; text-align: center; font-weight: bold;">指導日①</th>' : ''}
            ${columnVisibility.showLesson2 ? '<th style="border: 1px solid #000; padding: 8px; text-align: center; font-weight: bold;">指導日②</th>' : ''}
            ${columnVisibility.showLesson3 ? '<th style="border: 1px solid #000; padding: 8px; text-align: center; font-weight: bold;">指導日③</th>' : ''}
            ${columnVisibility.showHandover ? '<th style="border: 1px solid #000; padding: 8px; text-align: center; font-weight: bold;">引継ぎ</th>' : ''}
          </tr>
        </thead>
        <tbody>
    `;

    displayRows.forEach((row, index) => {
      const groupNumber = row.progress?.group_number;
      const nextRow = displayRows[index + 1];
      const isLastInGroup = groupNumber != null && (!nextRow || nextRow.progress?.group_number !== groupNumber);
      const borderBottom = isLastInGroup || groupNumber == null ? 'border-bottom: 2px solid #000;' : 'border-bottom: 1px solid #ccc;';

      html += `
        <tr>
          <td style="border: 1px solid #000; padding: 8px; ${borderBottom}">
            ${groupNumber != null && row.isGroupStart ? '<div style="display: inline-block; width: 4px; height: 24px; background-color: #666; margin-right: 8px; vertical-align: middle;"></div>' : ''}
            ${row.curriculumItem.item_number ? `<span style="color: #666; margin-right: 8px;">${row.curriculumItem.item_number}</span>` : ''}
            ${row.curriculumItem.title}
          </td>
          ${columnVisibility.showProposalCount && row.isGroupStart ? `
            <td style="border: 1px solid #000; padding: 8px; text-align: center; ${borderBottom}" rowspan="${row.groupRowSpan}">
              ${row.groupProposalCount > 0 ? row.groupProposalCount : '-'}
            </td>
          ` : ''}
          ${columnVisibility.showApplicationCount && row.isGroupStart ? `
            <td style="border: 1px solid #000; padding: 8px; text-align: center; ${borderBottom}" rowspan="${row.groupRowSpan}">
              ${row.groupApplicationCount > 0 ? row.groupApplicationCount : '-'}
            </td>
          ` : ''}
          ${columnVisibility.showExamRange ? `
            <td style="border: 1px solid #000; padding: 8px; text-align: center; ${borderBottom}">
              ${(row.progress as any)?.exam_range_exam_type_id || '-'}
            </td>
          ` : ''}
          ${columnVisibility.showSchoolProgress ? `
            <td style="border: 1px solid #000; padding: 8px; text-align: center; ${borderBottom}">
              ${row.progress?.school_progress_date || '-'}
            </td>
          ` : ''}
          ${columnVisibility.showLesson1 ? `
            <td style="border: 1px solid #000; padding: 8px; text-align: center; ${borderBottom}">
              ${(row.progress as any)?.lessons && (row.progress as any).lessons[0]?.lesson_date || '-'}
            </td>
          ` : ''}
          ${columnVisibility.showLesson2 ? `
            <td style="border: 1px solid #000; padding: 8px; text-align: center; ${borderBottom}">
              ${(row.progress as any)?.lessons && (row.progress as any).lessons[1]?.lesson_date || '-'}
            </td>
          ` : ''}
          ${columnVisibility.showLesson3 ? `
            <td style="border: 1px solid #000; padding: 8px; text-align: center; ${borderBottom}">
              ${(row.progress as any)?.lessons && (row.progress as any).lessons[2]?.lesson_date || '-'}
            </td>
          ` : ''}
          ${columnVisibility.showHandover ? `
            <td style="border: 1px solid #000; padding: 8px; ${borderBottom}">
              ${row.progress?.handover || '-'}
            </td>
          ` : ''}
        </tr>
      `;
    });

    html += `
        </tbody>
        <tfoot>
          <tr style="font-weight: bold;">
            <td style="border: 1px solid #000; padding: 8px; text-align: right;">合計</td>
            ${columnVisibility.showProposalCount ? `<td style="border: 1px solid #000; padding: 8px; text-align: center;">${totalProposal}コマ</td>` : ''}
            ${columnVisibility.showApplicationCount ? `<td style="border: 1px solid #000; padding: 8px; text-align: center;">${totalApplication}コマ</td>` : ''}
            ${columnVisibility.showExamRange ? '<td style="border: 1px solid #000; padding: 8px;"></td>' : ''}
            ${columnVisibility.showSchoolProgress ? '<td style="border: 1px solid #000; padding: 8px;"></td>' : ''}
            ${columnVisibility.showLesson1 ? '<td style="border: 1px solid #000; padding: 8px;"></td>' : ''}
            ${columnVisibility.showLesson2 ? '<td style="border: 1px solid #000; padding: 8px;"></td>' : ''}
            ${columnVisibility.showLesson3 ? '<td style="border: 1px solid #000; padding: 8px;"></td>' : ''}
            ${columnVisibility.showHandover ? '<td style="border: 1px solid #000; padding: 8px;"></td>' : ''}
          </tr>
        </tfoot>
      </table>
      <div style="margin-top: 20px; font-size: 12px; color: #666;">
        ※ 同じ背景色でまとまっている単元は、まとめて1コマで授業を行います。
      </div>
    `;

    return html;
  };

  // 利用可能なコース一覧を取得
  const fetchAvailableCourses = useCallback(async () => {
    if (!student) return;
    try {
      const schoolId = getDefaultSchoolId();
      const courses = await getSeasonalCourses(schoolId);
      // 生徒の学年に対応するコースのみフィルター
      const filtered = courses.filter(c => c.target_grades.includes(student.grade));
      setAvailableCourses(filtered);
    } catch (err) {
      console.error('Error fetching courses:', err);
    }
  }, [student]);

  // モーダルを開くときにコース一覧を取得
  const handleOpenApplyCourseModal = () => {
    fetchAvailableCourses();
    setIsApplyCourseModalOpen(true);
  };

  // コースを適用
  const handleApplyCourse = async () => {
    if (!selectedCourseId || !studentId) return;
    try {
      await applyCoursesToStudents(selectedCourseId, [studentId], courseApplyMode);
      await fetchStudentTextbooks();
      await fetchProgress();
      setIsApplyCourseModalOpen(false);
      setSelectedCourseId('');
      success('コースを適用しました');
    } catch (err) {
      console.error('Error applying course:', err);
      error(err instanceof Error ? err.message : 'コースの適用に失敗しました');
    }
  };

  // 生徒の学年から学年カテゴリを自動設定
  useEffect(() => {
    if (student) {
      let category: 'elementary' | 'middle' | 'high' | '' = '';
      if (student.grade >= 1 && student.grade <= 6) {
        category = 'elementary';
      } else if (student.grade >= 7 && student.grade <= 9) {
        category = 'middle';
      } else if (student.grade >= 10 && student.grade <= 13) {
        category = 'high';
      }
      if (category && !selectedGradeCategory) {
        setSelectedGradeCategory(category);
      }
    }
  }, [student, selectedGradeCategory]);

  // 初回読み込み
  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      await Promise.all([
        fetchStudent(),
        fetchStudentTextbooks(),
        fetchTextbooks(),
        fetchExamTypes(),
      ]);
      setIsLoading(false);
    };
    load();
  }, [fetchStudent, fetchStudentTextbooks, fetchTextbooks, fetchExamTypes]);

  // 選択テキストが変更されたら進行記録を取得
  useEffect(() => {
    if (selectedTextbookId) {
      fetchProgress();
    }
  }, [selectedTextbookId, fetchProgress]);

  // フィルター済みテキスト一覧
  const filteredTextbooks = useMemo(() => {
    return allTextbooks.filter((tb) => {
      if (selectedGradeCategory && tb.grade_category !== selectedGradeCategory) {
        return false;
      }
      if (selectedSubject && tb.subject !== selectedSubject) {
        return false;
      }
      // 既に追加されているテキストは除外
      return !studentTextbooks.some((st) => st.textbook_id === tb.id);
    });
  }, [allTextbooks, selectedGradeCategory, selectedSubject, studentTextbooks]);

  // 利用可能な科目一覧
  const availableSubjects = useMemo(() => {
    const subjects = new Set<string>();
    allTextbooks.forEach((tb) => {
      if (tb.subject) {
        subjects.add(tb.subject);
      }
    });
    return Array.from(subjects).sort();
  }, [allTextbooks]);

  // テキストを追加
  const handleAddTextbook = async (textbookId: number) => {
    if (!studentId || !student) return;
    try {
      await createStudentTextbook({
        school_id: student.school_id,
        student_id: studentId,
        textbook_id: textbookId,
        is_active: true,
      });
      await fetchStudentTextbooks();
      setIsAddTextbookModalOpen(false);
      setSelectedGradeCategory('');
      setSelectedSubject('');
      success('テキストを追加しました');
    } catch (err) {
      console.error('Error adding textbook:', err);
      error(err instanceof Error ? err.message : 'テキストの追加に失敗しました');
    }
  };

  // 次回テストまでの日数を計算
  const getDaysUntilNextExam = (exams: StudentTextbookExam[]): number | null => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const futureExams = exams
      .filter((e) => {
        const examDate = new Date(e.exam_date);
        examDate.setHours(0, 0, 0, 0);
        return examDate >= today;
      })
      .sort((a, b) => new Date(a.exam_date).getTime() - new Date(b.exam_date).getTime());
    
    if (futureExams.length === 0) return null;
    
    const nextExamDate = new Date(futureExams[0].exam_date);
    nextExamDate.setHours(0, 0, 0, 0);
    const diffTime = nextExamDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  const selectedTextbook = studentTextbooks.find((st) => st.id === selectedTextbookId);
  
  // 各テストの次回テストまでの日数を計算する関数
  const calculateDaysUntilExam = (examDate: string): number => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const exam = new Date(examDate + 'T00:00:00');
    const diff = Math.ceil((exam.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return diff;
  };

  if (isLoading) {
    return (
      <AdminLayout headerTitle="進行表">
        <div className="flex items-center justify-center py-12">
          <div className="text-[#2a2a2a]">読み込み中...</div>
        </div>
      </AdminLayout>
    );
  }

  if (!student) {
    return (
      <AdminLayout headerTitle="進行表">
        <div className="flex items-center justify-center py-12">
          <div className="text-[#d9376e]">生徒が見つかりません</div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <div>
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <AdminLayout headerTitle={`進行表 - ${student.last_name} ${student.first_name}`}>
        {errorMessage && (
          <div className="mb-4 p-4 bg-[#d9376e]/20 border border-[#d9376e] rounded-lg">
            <p className="text-sm text-[#d9376e]">{errorMessage}</p>
          </div>
        )}

        {/* 生徒情報 */}
        <div className="mb-6 p-4 bg-[#fffffe] rounded-xl border border-[#0d0d0d]">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-[#0d0d0d]">
                {student.last_name} {student.first_name} ({GRADE_LABELS[student.grade] || student.grade})
              </h2>
              {student.school_name && (
                <p className="text-sm text-[#2a2a2a] mt-1">{student.school_name}</p>
              )}
            </div>
            <Button
              onClick={() => router.push('/students')}
              variant="secondary"
              size="sm"
            >
              一覧に戻る
            </Button>
          </div>
        </div>

        {/* テキスト選択タブ */}
        <div className="mb-6">
          <div className="flex items-center gap-2 overflow-x-auto pb-2">
            {studentTextbooks
              .filter((st) => st.is_active && (!isTeacher || !st.is_draft))
              .map((st) => {
                const seasonColors = {
                  spring: selectedTextbookId === st.id ? 'bg-[#ffeb3b] text-[#0d0d0d] border-2 border-[#ffc107]' : 'bg-[#fff9e5] text-[#2a2a2a] hover:bg-[#ffeb3b]',
                  summer: selectedTextbookId === st.id ? 'bg-[#ffb3b3] text-[#0d0d0d] border-2 border-[#ff8e8e]' : 'bg-[#ffe5e5] text-[#2a2a2a] hover:bg-[#ffb3b3]',
                  winter: selectedTextbookId === st.id ? 'bg-[#bae1ff] text-[#0d0d0d] border-2 border-[#8ec5ff]' : 'bg-[#e5f3ff] text-[#2a2a2a] hover:bg-[#bae1ff]',
                  default: selectedTextbookId === st.id ? 'bg-[#ff8e3c] text-[#0d0d0d]' : 'bg-[#eff0f3] text-[#2a2a2a] hover:bg-[#0d0d0d]/10',
                };
                const colorClass = st.season ? seasonColors[st.season] : seasonColors.default;
                return (
                  <button
                    key={st.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', st.id);
                      (e.target as HTMLElement).style.opacity = '0.5';
                    }}
                    onDragEnd={(e) => {
                      (e.target as HTMLElement).style.opacity = '1';
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                    }}
                    onDrop={async (e) => {
                      e.preventDefault();
                      const draggedId = e.dataTransfer.getData('text/plain');
                      if (draggedId === st.id) return;
                      
                      const draggedIndex = studentTextbooks.findIndex((s) => s.id === draggedId);
                      const targetIndex = studentTextbooks.findIndex((s) => s.id === st.id);
                      
                      if (draggedIndex === -1 || targetIndex === -1) return;
                      
                      // sort_orderを更新
                      const newTextbooks = [...studentTextbooks];
                      const [dragged] = newTextbooks.splice(draggedIndex, 1);
                      newTextbooks.splice(targetIndex, 0, dragged);
                      
                      // sort_orderを再計算
                      try {
                        await Promise.all(
                          newTextbooks
                            .filter((s) => s.is_active)
                            .map((s, index) =>
                              updateStudentTextbook(s.id, { sort_order: index })
                            )
                        );
                        await fetchStudentTextbooks();
                      } catch (err) {
                        error(err instanceof Error ? err.message : '並べ替えに失敗しました');
                      }
                    }}
                    onClick={() => setSelectedTextbookId(st.id)}
                    className={`px-3 py-2 rounded-lg transition-colors cursor-move ${colorClass} ${st.is_draft ? 'opacity-60 border-dashed' : ''}`}
                  >
                    <div className="flex flex-col items-center gap-0.5">
                      <div className="text-sm font-medium leading-tight">
                        {st.textbook.name}
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px] leading-tight">
                        {st.textbook.subject && (
                          <span className="font-normal opacity-90">
                            [{st.textbook.subject}]
                          </span>
                        )}
                        {st.textbook.grade && (
                          <span className="opacity-75">
                            ({st.textbook.grade})
                          </span>
                        )}
                        {st.is_draft && !isTeacher && (
                          <span className="opacity-75">
                            (下書き)
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            <button
              onClick={() => setIsAddTextbookModalOpen(true)}
              className="px-4 py-2 rounded-lg font-medium whitespace-nowrap bg-[#eff0f3] text-[#2a2a2a] hover:bg-[#0d0d0d]/10"
            >
              + テキスト追加
            </button>
            <button
              onClick={handleOpenApplyCourseModal}
              className="px-4 py-2 rounded-lg font-medium whitespace-nowrap bg-[#ff8e3c] text-[#0d0d0d] hover:bg-[#ff7a1f]"
            >
              📋 コース適用
            </button>
            {/* 非表示テキスト（アーカイブ置き場） */}
            {studentTextbooks.filter((st) => !st.is_active).length > 0 && (
              <button
                onClick={() => setIsArchiveModalOpen(true)}
                className="ml-auto px-3 py-2 rounded text-sm text-[#2a2a2a]/40 hover:text-[#2a2a2a] hover:bg-[#eff0f3] transition-colors flex items-center gap-1"
                title={`アーカイブ (${studentTextbooks.filter((st) => !st.is_active).length}件)`}
              >
                <span>📦</span>
                <span className="text-xs">({studentTextbooks.filter((st) => !st.is_active).length})</span>
              </button>
            )}
          </div>
        </div>

        {selectedTextbook && (
          <>
            {/* ヘッダー情報 */}
            <div
              className={`mb-6 p-6 rounded-xl border-2 shadow-lg ${
                selectedTextbook.season === 'spring'
                  ? 'bg-[#fff9e5] border-[#ffeb3b]'
                  : selectedTextbook.season === 'summer'
                  ? 'bg-[#ffe5e5] border-[#ffb3b3]'
                  : selectedTextbook.season === 'winter'
                  ? 'bg-[#e5f3ff] border-[#bae1ff]'
                  : 'bg-[#fffffe] border-[#ff8e3c]'
              }`}
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-[#0d0d0d]">授業の進め方</h3>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={async () => {
                        try {
                          await updateStudentTextbook(selectedTextbook.id, {
                            season: selectedTextbook.season === 'spring' ? null : 'spring',
                          });
                          await fetchStudentTextbooks();
                          success('春期に設定しました');
                        } catch (err) {
                          error(err instanceof Error ? err.message : '操作に失敗しました');
                        }
                      }}
                      className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                        selectedTextbook.season === 'spring'
                          ? 'bg-[#ffeb3b] text-[#0d0d0d] border-2 border-[#ffc107]'
                          : 'bg-[#eff0f3] text-[#2a2a2a] hover:bg-[#ffeb3b]'
                      }`}
                    >
                      春期
                    </button>
                    <button
                      onClick={async () => {
                        try {
                          await updateStudentTextbook(selectedTextbook.id, {
                            season: selectedTextbook.season === 'summer' ? null : 'summer',
                          });
                          await fetchStudentTextbooks();
                          success('夏期に設定しました');
                        } catch (err) {
                          error(err instanceof Error ? err.message : '操作に失敗しました');
                        }
                      }}
                      className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                        selectedTextbook.season === 'summer'
                          ? 'bg-[#ffb3b3] text-[#0d0d0d] border-2 border-[#ff8e8e]'
                          : 'bg-[#eff0f3] text-[#2a2a2a] hover:bg-[#ffb3b3]'
                      }`}
                    >
                      夏期
                    </button>
                    <button
                      onClick={async () => {
                        try {
                          await updateStudentTextbook(selectedTextbook.id, {
                            season: selectedTextbook.season === 'winter' ? null : 'winter',
                          });
                          await fetchStudentTextbooks();
                          success('冬期に設定しました');
                        } catch (err) {
                          error(err instanceof Error ? err.message : '操作に失敗しました');
                        }
                      }}
                      className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                        selectedTextbook.season === 'winter'
                          ? 'bg-[#bae1ff] text-[#0d0d0d] border-2 border-[#8ec5ff]'
                          : 'bg-[#eff0f3] text-[#2a2a2a] hover:bg-[#bae1ff]'
                      }`}
                    >
                      冬期
                    </button>
                  </div>
                  {!isTeacher && (
                    <Button
                      onClick={async () => {
                        if (window.confirm(`${selectedTextbook.textbook.name}を${selectedTextbook.is_draft ? '公開' : '下書き'}にしますか？`)) {
                          try {
                            await updateStudentTextbook(selectedTextbook.id, {
                              is_draft: !selectedTextbook.is_draft,
                            });
                            await fetchStudentTextbooks();
                            success(selectedTextbook.is_draft ? 'テキストを公開しました' : 'テキストを下書きにしました');
                          } catch (err) {
                            error(err instanceof Error ? err.message : '操作に失敗しました');
                          }
                        }
                      }}
                      variant="secondary"
                      size="sm"
                      className={selectedTextbook.is_draft ? 'bg-[#ff8e3c] text-[#0d0d0d]' : ''}
                    >
                      {selectedTextbook.is_draft ? '公開' : '下書き'}
                    </Button>
                  )}
                  <Button
                    onClick={async () => {
                      if (window.confirm(`${selectedTextbook.textbook.name}を${selectedTextbook.is_active ? '非表示' : '表示'}にしますか？`)) {
                        try {
                          await updateStudentTextbook(selectedTextbook.id, {
                            is_active: !selectedTextbook.is_active,
                          });
                          await fetchStudentTextbooks();
                          success(selectedTextbook.is_active ? 'テキストを非表示にしました' : 'テキストを表示しました');
                        } catch (err) {
                          error(err instanceof Error ? err.message : '操作に失敗しました');
                        }
                      }
                    }}
                    variant="secondary"
                    size="sm"
                  >
                    {selectedTextbook.is_active ? '非表示' : '表示'}
                  </Button>
                  <Button
                    onClick={async () => {
                      if (window.confirm(`${selectedTextbook.textbook.name}を削除しますか？\nこの操作は取り消せません。`)) {
                        try {
                          await deleteStudentTextbook(selectedTextbook.id);
                          await fetchStudentTextbooks();
                          setSelectedTextbookId(null);
                          success('テキストを削除しました');
                        } catch (err) {
                          error(err instanceof Error ? err.message : '削除に失敗しました');
                        }
                      }
                    }}
                    variant="danger"
                    size="sm"
                  >
                    削除
                  </Button>
                </div>
              </div>
              {selectedTextbook.exams && selectedTextbook.exams.length > 0 ? (
                <div className="space-y-4 mb-4">
                  {selectedTextbook.exams.map((exam) => {
                    const examType = examTypes.find((et) => et.id === exam.exam_type_id);
                    const examName = examType?.name || exam.custom_exam_name || '-';
                    const examDate = new Date(exam.exam_date + 'T00:00:00');
                    const formattedDate = examDate.toLocaleDateString('ja-JP', {
                      month: '2-digit',
                      day: '2-digit',
                    });
                    const daysUntil = calculateDaysUntilExam(exam.exam_date);
                    return (
                      <div
                        key={exam.id}
                        className="p-6 bg-[#eff0f3] rounded-lg border-2 border-[#0d0d0d]"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <div className="font-bold text-[#0d0d0d] text-2xl mb-3">
                              {examName}
                            </div>
                            <div className="flex items-center gap-6 mb-2">
                              <div className="flex items-center gap-2">
                                <span className="text-lg font-semibold text-[#2a2a2a]">テスト日:</span>
                                <span className="text-2xl font-bold text-[#ff8e3c]">{formattedDate}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-lg font-semibold text-[#2a2a2a]">目標点:</span>
                                <span className="text-2xl font-bold text-[#ff8e3c]">{exam.target_score || '-'}点</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-lg font-semibold text-[#2a2a2a]">次回テストまで:</span>
                                <span className="text-2xl font-bold text-[#ff8e3c]">{daysUntil}日</span>
                              </div>
                            </div>
                            {exam.exam_range && (
                              <div className="text-sm text-[#2a2a2a] mt-2">
                                試験範囲: {exam.exam_range}
                              </div>
                            )}
                          </div>
                          <Button
                            onClick={async () => {
                              await deleteStudentTextbookExam(exam.id);
                              await fetchStudentTextbooks();
                              success('テスト設定を削除しました');
                            }}
                            variant="danger"
                            size="sm"
                          >
                            削除
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-[#2a2a2a] mb-4">テスト設定がありません</p>
              )}
              <Button
                onClick={() => {
                  setIsAddExamModalOpen(true);
                  setNewExamTypeId('');
                  setNewExamDate('');
                  setNewExamTargetScore('');
                  setNewExamRange('');
                  setNewCustomExamName('');
                }}
                variant="primary"
                size="sm"
              >
                + テスト設定を追加
              </Button>

              {/* 進め方・宿題の出し方 */}
              <div className="mt-6 pt-6 border-t border-[#0d0d0d]">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-[#2a2a2a] mb-1">
                      進め方
                    </label>
                    <textarea
                      defaultValue={selectedTextbook.settings?.approach || ''}
                      onBlur={async (e) => {
                        if (selectedTextbookId) {
                          await upsertStudentTextbookSettings(selectedTextbookId, {
                            approach: e.target.value || null,
                          });
                          await fetchStudentTextbooks();
                        }
                      }}
                      rows={3}
                      className="w-full px-3 py-2 border border-[#0d0d0d] rounded-lg"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-[#2a2a2a] mb-1">
                      宿題の出し方
                    </label>
                    <textarea
                      defaultValue={selectedTextbook.settings?.homework_style || ''}
                      onBlur={async (e) => {
                        if (selectedTextbookId) {
                          await upsertStudentTextbookSettings(selectedTextbookId, {
                            homework_style: e.target.value || null,
                          });
                          await fetchStudentTextbooks();
                        }
                      }}
                      rows={3}
                      className="w-full px-3 py-2 border border-[#0d0d0d] rounded-lg"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* コントロールパネル */}
            <div className="mb-6 p-4 bg-[#fffffe] rounded-xl border border-[#0d0d0d]">
              <div className="flex flex-col gap-4">
                {/* 上段: モード切替とアクションボタン */}
                <div className="flex items-center justify-between flex-wrap gap-4">
                  {/* 左側: 表示モード切替 */}
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-[#2a2a2a]">表示:</span>
                    <div className="flex rounded-lg overflow-hidden border border-[#0d0d0d]">
                      <button
                        onClick={() => setViewMode('admin')}
                        className={`px-4 py-2 text-sm font-medium transition-colors ${
                          viewMode === 'admin'
                            ? 'bg-[#ff8e3c] text-[#0d0d0d]'
                            : 'bg-[#fffffe] text-[#2a2a2a] hover:bg-[#eff0f3]'
                        }`}
                      >
                        管理モード
                      </button>
                      <button
                        onClick={() => setViewMode('parent')}
                        className={`px-4 py-2 text-sm font-medium transition-colors ${
                          viewMode === 'parent'
                            ? 'bg-[#ff8e3c] text-[#0d0d0d]'
                            : 'bg-[#fffffe] text-[#2a2a2a] hover:bg-[#eff0f3]'
                        }`}
                      >
                        保護者向け
                      </button>
                    </div>
                  </div>

                  {/* 右側: アクションボタン */}
                  <div className="flex items-center gap-2">
                    {/* PDF出力ボタン（保護者向けモード時） */}
                    {viewMode === 'parent' && (
                      <>
                        <Button
                          onClick={handleExportPDF}
                          variant="primary"
                          size="sm"
                          className="flex items-center gap-2"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          PDF出力
                        </Button>
                        <Button
                          onClick={handleExportPDFBySeason}
                          variant="secondary"
                          size="sm"
                          className="flex items-center gap-2"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          講習ごとPDF出力
                        </Button>
                      </>
                    )}
                    
                    {/* グループ化ボタン（管理モードのみ） */}
                    {viewMode === 'admin' && (
                      <>
                        <Button
                          onClick={async () => {
                            if (selectedItems.size < 2) {
                              error('グループ化には2つ以上の単元を選択してください');
                              return;
                            }
                            if (!selectedTextbookId) return;
                            setIsSaving(true);
                            try {
                              await groupProgressItems(selectedTextbookId, Array.from(selectedItems));
                              await fetchProgress();
                              setSelectedItems(new Set());
                              success('グループ化しました');
                            } catch (err) {
                              error(err instanceof Error ? err.message : 'グループ化に失敗しました');
                            } finally {
                              setIsSaving(false);
                            }
                          }}
                          variant="primary"
                          size="sm"
                          disabled={isSaving || selectedItems.size < 2}
                        >
                          グループ化 ({selectedItems.size})
                        </Button>
                        <Button
                          onClick={async () => {
                            if (selectedItems.size === 0) {
                              error('解除する単元を選択してください');
                              return;
                            }
                            if (!selectedTextbookId) return;
                            setIsSaving(true);
                            try {
                              await ungroupProgressItems(selectedTextbookId, Array.from(selectedItems));
                              await fetchProgress();
                              setSelectedItems(new Set());
                              success('グループ解除しました');
                            } catch (err) {
                              error(err instanceof Error ? err.message : 'グループ解除に失敗しました');
                            } finally {
                              setIsSaving(false);
                            }
                          }}
                          variant="secondary"
                          size="sm"
                          disabled={isSaving || selectedItems.size === 0}
                        >
                          グループ解除
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {/* 下段: 表示列切替 */}
                {(viewMode === 'admin' || viewMode === 'parent') && (
                  <div className="flex items-center gap-4 flex-wrap pt-3 border-t border-[#eff0f3]">
                    <span className="text-sm font-medium text-[#2a2a2a]">表示列:</span>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showProposalCount}
                        onChange={(e) => setShowProposalCount(e.target.checked)}
                        className="w-4 h-4 rounded border-[#0d0d0d]"
                      />
                      <span className="text-sm text-[#2a2a2a]">提案回数</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showApplicationCount}
                        onChange={(e) => setShowApplicationCount(e.target.checked)}
                        className="w-4 h-4 rounded border-[#0d0d0d]"
                      />
                      <span className="text-sm text-[#2a2a2a]">申込回数</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showExamRange}
                        onChange={(e) => setShowExamRange(e.target.checked)}
                        className="w-4 h-4 rounded border-[#0d0d0d]"
                      />
                      <span className="text-sm text-[#2a2a2a]">試験範囲</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showSchoolProgress}
                        onChange={(e) => setShowSchoolProgress(e.target.checked)}
                        className="w-4 h-4 rounded border-[#0d0d0d]"
                      />
                      <span className="text-sm text-[#2a2a2a]">学校進度</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showLesson1}
                        onChange={(e) => setShowLesson1(e.target.checked)}
                        className="w-4 h-4 rounded border-[#0d0d0d]"
                      />
                      <span className="text-sm text-[#2a2a2a]">指導日①</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showLesson2}
                        onChange={(e) => setShowLesson2(e.target.checked)}
                        className="w-4 h-4 rounded border-[#0d0d0d]"
                      />
                      <span className="text-sm text-[#2a2a2a]">指導日②</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showLesson3}
                        onChange={(e) => setShowLesson3(e.target.checked)}
                        className="w-4 h-4 rounded border-[#0d0d0d]"
                      />
                      <span className="text-sm text-[#2a2a2a]">指導日③</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showHandover}
                        onChange={(e) => setShowHandover(e.target.checked)}
                        className="w-4 h-4 rounded border-[#0d0d0d]"
                      />
                      <span className="text-sm text-[#2a2a2a]">引継ぎ</span>
                    </label>
                  </div>
                )}
              </div>
            </div>

            {/* 進行表 */}
            <div className="bg-[#fffffe] rounded-xl border border-[#0d0d0d] overflow-hidden">
              <div className="p-4 bg-[#eff0f3] border-b border-[#0d0d0d]">
                <h3 className="text-lg font-bold text-[#0d0d0d]">進行表</h3>
              </div>
              <div id="progress-table-container" className="overflow-x-auto">
                {viewMode === 'admin' ? (
                  <table className="w-full border-collapse progress-table">
                    <thead>
                      <tr className="bg-[#eff0f3] border-b border-[#0d0d0d]">
                        {viewMode === 'admin' && (
                          <th className="px-4 py-3 text-center text-xs font-semibold text-[#0d0d0d] border-r border-[#0d0d0d] w-10">
                            <input
                              type="checkbox"
                              checked={progressData.length > 0 && selectedItems.size === progressData.length}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedItems(new Set(progressData.map(item => item.id)));
                                } else {
                                  setSelectedItems(new Set());
                                }
                              }}
                              className="w-4 h-4"
                            />
                          </th>
                        )}
                        <th className="px-4 py-3 text-left text-xs font-semibold text-[#0d0d0d] border-r border-[#0d0d0d]">
                          単元名
                        </th>
                      {showProposalCount && (
                        <th className="px-4 py-3 text-left text-xs font-semibold text-[#0d0d0d] border-r border-[#0d0d0d]">
                          提案回数
                        </th>
                      )}
                      {showApplicationCount && (
                        <th className="px-4 py-3 text-left text-xs font-semibold text-[#0d0d0d] border-r border-[#0d0d0d]">
                          申込回数
                        </th>
                      )}
                      {showExamRange && (
                        <th className="px-4 py-3 text-left text-xs font-semibold text-[#0d0d0d] border-r border-[#0d0d0d]">
                          試験範囲
                        </th>
                      )}
                      {showSchoolProgress && (
                        <th className="px-4 py-3 text-left text-xs font-semibold text-[#0d0d0d] border-r border-[#0d0d0d]">
                          学校進度
                        </th>
                      )}
                      {showLesson1 && (
                        <th className="px-4 py-3 text-left text-xs font-semibold text-[#0d0d0d] border-r border-[#0d0d0d]">
                          指導日①
                        </th>
                      )}
                      {showLesson2 && (
                        <th className="px-4 py-3 text-left text-xs font-semibold text-[#0d0d0d] border-r border-[#0d0d0d]">
                          指導日②
                        </th>
                      )}
                      {showLesson3 && (
                        <th className="px-4 py-3 text-left text-xs font-semibold text-[#0d0d0d] border-r border-[#0d0d0d]">
                          指導日③
                        </th>
                      )}
                      {showHandover && (
                        <th className="px-4 py-3 text-left text-xs font-semibold text-[#0d0d0d]">
                          引継ぎ
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {displayRows.length === 0 ? (
                      <tr>
                        <td colSpan={viewMode === 'admin' ? 10 : 3} className="px-4 py-8 text-center text-sm text-[#2a2a2a]">
                          目次項目が登録されていません
                        </td>
                      </tr>
                    ) : (
                      displayRows.map((row) => {
                        const progress = row.progress as (StudentProgress & { lessons?: StudentProgressLesson[] }) | null;
                        const lessons = progress?.lessons || [];
                        // 指導日に日付が入っているかチェック
                        const hasLessonDate = lessons.some((l) => l.lesson_date);
                        const rowBgColor = hasLessonDate ? 'bg-[#d1fae5]' : 'bg-[#fffffe]';
                        // グループの背景色を取得
                        const getGroupColor = (groupNumber: number | null | undefined): string => {
                          if (groupNumber == null) return '';
                          const colors = [
                            'bg-blue-50',
                            'bg-green-50', 
                            'bg-yellow-50',
                            'bg-purple-50',
                            'bg-pink-50',
                            'bg-orange-50',
                          ];
                          return colors[(groupNumber - 1) % colors.length];
                        };
                        const groupColor = getGroupColor(progress?.group_number);
                        const isChecked = selectedItems.has(row.curriculumItem.id);
                        return (
                          <tr
                            key={row.curriculumItem.id}
                            className={`border-b border-[#0d0d0d] hover:bg-[#eff0f3] ${rowBgColor} ${groupColor}`}
                          >
                            {/* チェックボックス（管理モードのみ） */}
                            {viewMode === 'admin' && (
                              <td className="px-4 py-3 text-center border-r border-[#0d0d0d]">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={(e) => {
                                    const newSet = new Set(selectedItems);
                                    if (e.target.checked) {
                                      newSet.add(row.curriculumItem.id);
                                    } else {
                                      newSet.delete(row.curriculumItem.id);
                                    }
                                    setSelectedItems(newSet);
                                  }}
                                  className="w-4 h-4"
                                />
                              </td>
                            )}
                            {/* 単元名 */}
                            <td className="px-4 py-3 text-sm text-[#0d0d0d] border-r border-[#0d0d0d] font-medium">
                              {row.curriculumItem.title || `単元ID: ${row.curriculumItem.id}`}
                            </td>
                          {/* 提案回数（セル結合） */}
                          {showProposalCount && row.isGroupStart && (
                            <td 
                              className="px-4 py-3 text-sm text-[#2a2a2a] border-r border-[#0d0d0d]"
                              rowSpan={row.groupRowSpan}
                            >
                              <input
                                type="number"
                                min="0"
                                value={row.groupProposalCount}
                                onChange={async (e) => {
                                  if (!selectedTextbookId) return;
                                  const value = parseInt(e.target.value, 10) || 0;
                                  const groupNumber = progress?.group_number;
                                  
                                  if (groupNumber != null && row.isGroupStart) {
                                    // グループの先頭行 → グループ全体の回数を更新（提案回数に連動して申込回数も更新）
                                    await updateGroupCounts(
                                      selectedTextbookId,
                                      groupNumber,
                                      value,
                                      value, // 申込回数も提案回数と同じ値に設定
                                      row.curriculumItem.id
                                    );
                                  } else {
                                    // 単独行 → その行だけ更新（提案回数に連動して申込回数も更新）
                                    if (progress) {
                                      await updateStudentProgress(progress.id, {
                                        proposal_count: value,
                                        application_count: value, // 申込回数も提案回数と同じ値に設定
                                      });
                                    } else {
                                      await upsertStudentProgress({
                                        student_textbook_id: selectedTextbookId,
                                        curriculum_item_id: row.curriculumItem.id,
                                        proposal_count: value,
                                        application_count: value, // 申込回数も提案回数と同じ値に設定
                                      });
                                    }
                                  }
                                  await fetchProgress();
                                }}
                                className="w-16 px-2 py-1 border border-[#0d0d0d] rounded"
                              />
                            </td>
                          )}
                          {/* 申込回数（セル結合） */}
                          {showApplicationCount && row.isGroupStart && (
                            <td 
                              className="px-4 py-3 text-sm text-[#2a2a2a] border-r border-[#0d0d0d]"
                              rowSpan={row.groupRowSpan}
                            >
                              <input
                                type="number"
                                min="0"
                                value={row.groupApplicationCount}
                                onChange={async (e) => {
                                  if (!selectedTextbookId) return;
                                  const value = parseInt(e.target.value, 10) || 0;
                                  const groupNumber = progress?.group_number;
                                  
                                  if (groupNumber != null && row.isGroupStart) {
                                    // グループの先頭行 → グループ全体の回数を更新
                                    await updateGroupCounts(
                                      selectedTextbookId,
                                      groupNumber,
                                      row.groupProposalCount,
                                      value,
                                      row.curriculumItem.id
                                    );
                                  } else {
                                    // 単独行 → その行だけ更新
                                    if (progress) {
                                      await updateStudentProgress(progress.id, {
                                        application_count: value,
                                      });
                                    } else {
                                      await upsertStudentProgress({
                                        student_textbook_id: selectedTextbookId,
                                        curriculum_item_id: row.curriculumItem.id,
                                        application_count: value,
                                      });
                                    }
                                  }
                                  await fetchProgress();
                                }}
                                className="w-16 px-2 py-1 border border-[#0d0d0d] rounded"
                              />
                            </td>
                          )}
                          {showExamRange && (
                            <td className="px-4 py-3 text-sm text-[#2a2a2a] border-r border-[#0d0d0d]">
                              <select
                                value={progress?.exam_range_exam_type_id || ''}
                                onChange={async (e) => {
                                  if (selectedTextbookId && progress) {
                                    await updateStudentProgress(progress.id, {
                                      exam_range_exam_type_id: e.target.value || null,
                                    });
                                    await fetchProgress();
                                  } else if (selectedTextbookId) {
                                    await upsertStudentProgress({
                                      student_textbook_id: selectedTextbookId,
                                      curriculum_item_id: row.curriculumItem.id,
                                      exam_range_exam_type_id: e.target.value || null,
                                    });
                                    await fetchProgress();
                                  }
                                }}
                                className="w-full px-2 py-1 border border-[#0d0d0d] rounded"
                              >
                                <option value="">-</option>
                                {examTypes.map((et) => (
                                  <option key={et.id} value={et.id}>
                                    {et.name}
                                  </option>
                                ))}
                              </select>
                            </td>
                          )}
                          {showSchoolProgress && (
                            <td className="px-4 py-3 text-sm text-[#2a2a2a] border-r border-[#0d0d0d]">
                              <input
                                type="date"
                                value={progress?.school_progress_date || ''}
                                onChange={async (e) => {
                                  if (selectedTextbookId && progress) {
                                    await updateStudentProgress(progress.id, {
                                      school_progress_date: e.target.value || null,
                                    });
                                    await fetchProgress();
                                  } else if (selectedTextbookId) {
                                    await upsertStudentProgress({
                                      student_textbook_id: selectedTextbookId,
                                      curriculum_item_id: row.curriculumItem.id,
                                      school_progress_date: e.target.value || null,
                                    });
                                    await fetchProgress();
                                  }
                                }}
                                className="w-32 px-2 py-1 border border-[#0d0d0d] rounded text-xs"
                              />
                            </td>
                          )}
                          {showLesson1 && (
                            <td className="px-4 py-3 text-sm text-[#2a2a2a] border-r border-[#0d0d0d]">
                              <input
                                type="date"
                                value={lessons.find((l) => l.lesson_number === 1)?.lesson_date || ''}
                                onChange={async (e) => {
                                  if (selectedTextbookId) {
                                    let currentProgress = progress;
                                    // progressが存在しない場合は先に作成
                                    if (!currentProgress) {
                                      currentProgress = await upsertStudentProgress({
                                        student_textbook_id: selectedTextbookId,
                                        curriculum_item_id: row.curriculumItem.id,
                                      });
                                    }
                                    const lesson = lessons.find((l) => l.lesson_number === 1);
                                    await upsertStudentProgressLesson({
                                      student_progress_id: currentProgress.id,
                                      lesson_number: 1,
                                      lesson_date: e.target.value || null,
                                      teacher_name: lesson?.teacher_name || null,
                                    });
                                    await fetchProgress();
                                  }
                                }}
                                className="w-32 px-2 py-1 border border-[#0d0d0d] rounded text-xs"
                              />
                            </td>
                          )}
                          {showLesson2 && (
                            <td className="px-4 py-3 text-sm text-[#2a2a2a] border-r border-[#0d0d0d]">
                              <input
                                type="date"
                                value={lessons.find((l) => l.lesson_number === 2)?.lesson_date || ''}
                                onChange={async (e) => {
                                  if (selectedTextbookId) {
                                    let currentProgress = progress;
                                    // progressが存在しない場合は先に作成
                                    if (!currentProgress) {
                                      currentProgress = await upsertStudentProgress({
                                        student_textbook_id: selectedTextbookId,
                                        curriculum_item_id: row.curriculumItem.id,
                                      });
                                    }
                                    const lesson = lessons.find((l) => l.lesson_number === 2);
                                    await upsertStudentProgressLesson({
                                      student_progress_id: currentProgress.id,
                                      lesson_number: 2,
                                      lesson_date: e.target.value || null,
                                      teacher_name: lesson?.teacher_name || null,
                                    });
                                    await fetchProgress();
                                  }
                                }}
                                className="w-32 px-2 py-1 border border-[#0d0d0d] rounded text-xs"
                              />
                            </td>
                          )}
                          {showLesson3 && (
                            <td className="px-4 py-3 text-sm text-[#2a2a2a] border-r border-[#0d0d0d]">
                              <input
                                type="date"
                                value={lessons.find((l) => l.lesson_number === 3)?.lesson_date || ''}
                                onChange={async (e) => {
                                  if (selectedTextbookId) {
                                    let currentProgress = progress;
                                    // progressが存在しない場合は先に作成
                                    if (!currentProgress) {
                                      currentProgress = await upsertStudentProgress({
                                        student_textbook_id: selectedTextbookId,
                                        curriculum_item_id: row.curriculumItem.id,
                                      });
                                    }
                                    const lesson = lessons.find((l) => l.lesson_number === 3);
                                    await upsertStudentProgressLesson({
                                      student_progress_id: currentProgress.id,
                                      lesson_number: 3,
                                      lesson_date: e.target.value || null,
                                      teacher_name: lesson?.teacher_name || null,
                                    });
                                    await fetchProgress();
                                  }
                                }}
                                className="w-32 px-2 py-1 border border-[#0d0d0d] rounded text-xs"
                              />
                            </td>
                          )}
                          {showHandover && (
                            <td className="px-4 py-3 text-sm text-[#2a2a2a]">
                              <textarea
                                value={progress?.handover || ''}
                                onChange={async (e) => {
                                  if (selectedTextbookId && progress) {
                                    await updateStudentProgress(progress.id, {
                                      handover: e.target.value || null,
                                    });
                                    await fetchProgress();
                                  } else if (selectedTextbookId) {
                                    await upsertStudentProgress({
                                      student_textbook_id: selectedTextbookId,
                                      curriculum_item_id: row.curriculumItem.id,
                                      handover: e.target.value || null,
                                    });
                                    await fetchProgress();
                                  }
                                }}
                                rows={2}
                                className="w-full px-2 py-1 border border-[#0d0d0d] rounded"
                              />
                            </td>
                          )}
                        </tr>
                      );
                    })
                    )}
                    {/* 合計行 */}
                    {displayRows.length > 0 && (showProposalCount || showApplicationCount) && (
                      <tr className="border-t-2 border-[#0d0d0d] bg-[#eff0f3] font-bold">
                        <td colSpan={2} className="px-4 py-3 text-sm text-[#0d0d0d] border-r border-[#0d0d0d]">
                          合計
                        </td>
                        {showProposalCount && (
                          <td className="px-4 py-3 text-sm text-[#0d0d0d] border-r border-[#0d0d0d]">
                            {displayRows
                              .filter(row => row.isGroupStart)
                              .reduce((sum, row) => sum + row.groupProposalCount, 0)}
                          </td>
                        )}
                        {showApplicationCount && (
                          <td className="px-4 py-3 text-sm text-[#0d0d0d] border-r border-[#0d0d0d]">
                            {displayRows
                              .filter(row => row.isGroupStart)
                              .reduce((sum, row) => sum + row.groupApplicationCount, 0)}
                          </td>
                        )}
                        <td colSpan={
                          (showExamRange ? 1 : 0) + // 試験範囲
                          (showSchoolProgress ? 1 : 0) + // 学校進度
                          (showLesson1 ? 1 : 0) + // 指導日①
                          (showLesson2 ? 1 : 0) + // 指導日②
                          (showLesson3 ? 1 : 0) + // 指導日③
                          (showHandover ? 1 : 0) // 引継ぎ
                        } className="px-4 py-3 text-sm text-[#0d0d0d]">
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
                ) : (
                  <ParentProgressTable
                    displayRows={displayRows}
                    studentName={student ? `${student.last_name} ${student.first_name}` : '生徒'}
                    textbookName={selectedTextbook?.textbook.name || 'テキスト'}
                    showProposalCount={showProposalCount}
                    showApplicationCount={showApplicationCount}
                    showExamRange={showExamRange}
                    showSchoolProgress={showSchoolProgress}
                    showLesson1={showLesson1}
                    showLesson2={showLesson2}
                    showLesson3={showLesson3}
                    showHandover={showHandover}
                  />
                )}
              </div>
              {/* 合計表示（保護者モードのみ） */}
              {viewMode === 'parent' && (
                <div className="p-4 bg-[#eff0f3] border-t border-[#0d0d0d]">
                  <div className="flex justify-end text-lg font-medium">
                    <div>
                      提案コマ数合計: <span className="text-[#ff8e3c]">{totalProposalCount}コマ</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* テキスト追加モーダル */}
        <Modal
          isOpen={isAddTextbookModalOpen}
          onClose={() => {
            setIsAddTextbookModalOpen(false);
            setSelectedGradeCategory('');
            setSelectedSubject('');
          }}
          title="テキストを追加"
          size="lg"
        >
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Select
                label="学年カテゴリ"
                value={selectedGradeCategory}
                onChange={(e) => {
                  setSelectedGradeCategory(e.target.value as 'elementary' | 'middle' | 'high' | '');
                  setSelectedSubject(''); // 学年が変わったら科目をリセット
                }}
                options={[
                  { value: '', label: 'すべて' },
                  { value: 'elementary', label: '小学生' },
                  { value: 'middle', label: '中学生' },
                  { value: 'high', label: '高校生' },
                ]}
              />
              <Select
                label="科目"
                value={selectedSubject}
                onChange={(e) => setSelectedSubject(e.target.value)}
                options={[
                  { value: '', label: 'すべて' },
                  ...availableSubjects.map((subject) => ({
                    value: subject,
                    label: subject,
                  })),
                ]}
                disabled={!selectedGradeCategory}
              />
            </div>

            <div className="border-t border-[#0d0d0d] pt-4">
              <h4 className="text-sm font-semibold text-[#0d0d0d] mb-3">テキスト一覧</h4>
              {filteredTextbooks.length === 0 ? (
                <p className="text-sm text-[#2a2a2a] py-4 text-center">
                  {selectedGradeCategory || selectedSubject
                    ? '条件に一致するテキストがありません'
                    : '学年カテゴリまたは科目を選択してください'}
                </p>
              ) : (
                <div className="max-h-64 overflow-y-auto space-y-2">
                  {filteredTextbooks.map((textbook) => (
                    <div
                      key={textbook.id}
                      className="p-3 bg-[#eff0f3] rounded-lg border border-[#0d0d0d] hover:bg-[#0d0d0d]/5 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="font-medium text-[#0d0d0d]">{textbook.name}</div>
                          <div className="text-sm text-[#2a2a2a] mt-1">
                            {textbook.publisher && <span>出版社: {textbook.publisher}</span>}
                            {textbook.subject && (
                              <span className={textbook.publisher ? ' ml-2' : ''}>
                                科目: {textbook.subject}
                              </span>
                            )}
                            {textbook.grade && (
                              <span className="ml-2">
                                学年: {textbook.grade}
                              </span>
                            )}
                            {textbook.grade_category && (
                              <span className="ml-2">
                                {textbook.grade_category === 'elementary'
                                  ? '小学生'
                                  : textbook.grade_category === 'middle'
                                  ? '中学生'
                                  : '高校生'}
                              </span>
                            )}
                          </div>
                        </div>
                        <Button
                          onClick={() => handleAddTextbook(textbook.id)}
                          variant="primary"
                          size="sm"
                        >
                          追加
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Modal>

        {/* コース適用モーダル */}
        <Modal
          isOpen={isApplyCourseModalOpen}
          onClose={() => {
            setIsApplyCourseModalOpen(false);
            setSelectedCourseId('');
          }}
          title="コースを適用"
          size="md"
        >
          <div className="space-y-4">
            {availableCourses.length === 0 ? (
              <p className="text-[#2a2a2a] text-center py-4">
                この学年に対応するコースがありません
              </p>
            ) : (
              <>
                {/* コース選択 */}
                <div>
                  <label className="block text-sm font-medium text-[#0d0d0d] mb-2">
                    適用するコース
                  </label>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {availableCourses.map(course => (
                      <label
                        key={course.id}
                        className={`flex items-center p-3 rounded-lg border-2 cursor-pointer transition-colors ${
                          selectedCourseId === course.id
                            ? 'border-[#ff8e3c] bg-[#ff8e3c]/10'
                            : 'border-[#eff0f3] hover:border-[#ff8e3c]'
                        }`}
                      >
                        <input
                          type="radio"
                          name="courseSelect"
                          value={course.id}
                          checked={selectedCourseId === course.id}
                          onChange={() => setSelectedCourseId(course.id)}
                          className="hidden"
                        />
                        <div className="flex-1">
                          <div className="font-medium text-[#0d0d0d]">{course.name}</div>
                          <div className="text-sm text-[#2a2a2a]">
                            {SEASON_LABELS[course.season]} / {course.textbooks?.length || 0}冊 / {course.total_koma}コマ
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                {/* 適用モード */}
                <div>
                  <label className="block text-sm font-medium text-[#0d0d0d] mb-2">
                    適用モード
                  </label>
                  <div className="flex gap-2">
                    <label
                      className={`flex-1 p-3 rounded-lg border-2 cursor-pointer text-center transition-colors ${
                        courseApplyMode === 'overwrite'
                          ? 'border-[#ff8e3c] bg-[#ff8e3c]/10'
                          : 'border-[#eff0f3] hover:border-[#ff8e3c]'
                      }`}
                    >
                      <input
                        type="radio"
                        name="applyMode"
                        value="overwrite"
                        checked={courseApplyMode === 'overwrite'}
                        onChange={() => setCourseApplyMode('overwrite')}
                        className="hidden"
                      />
                      <div className="font-medium text-[#0d0d0d]">上書き</div>
                      <div className="text-xs text-[#2a2a2a]">既存を置き換え</div>
                    </label>
                    <label
                      className={`flex-1 p-3 rounded-lg border-2 cursor-pointer text-center transition-colors ${
                        courseApplyMode === 'add'
                          ? 'border-[#ff8e3c] bg-[#ff8e3c]/10'
                          : 'border-[#eff0f3] hover:border-[#ff8e3c]'
                      }`}
                    >
                      <input
                        type="radio"
                        name="applyMode"
                        value="add"
                        checked={courseApplyMode === 'add'}
                        onChange={() => setCourseApplyMode('add')}
                        className="hidden"
                      />
                      <div className="font-medium text-[#0d0d0d]">加算</div>
                      <div className="text-xs text-[#2a2a2a]">既存に追加</div>
                    </label>
                  </div>
                </div>
              </>
            )}

            <div className="flex justify-end gap-2 pt-4 border-t border-[#0d0d0d]">
              <Button
                variant="secondary"
                onClick={() => {
                  setIsApplyCourseModalOpen(false);
                  setSelectedCourseId('');
                }}
              >
                キャンセル
              </Button>
              <Button
                variant="primary"
                onClick={handleApplyCourse}
                disabled={!selectedCourseId}
              >
                適用
              </Button>
            </div>
          </div>
        </Modal>

        {/* テスト設定追加モーダル */}
        <Modal
          isOpen={isAddExamModalOpen}
          onClose={() => {
            setIsAddExamModalOpen(false);
            setNewExamTypeId('');
            setNewExamDate('');
            setNewExamTargetScore('');
            setNewExamRange('');
            setNewCustomExamName('');
            setIsCustomExamName(false);
          }}
          title="テスト設定を追加"
          size="md"
        >
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[#0d0d0d] mb-2">
                テスト名 <span className="text-[#d9376e]">*</span>
              </label>
              <Select
                value={isCustomExamName ? 'custom' : newExamTypeId}
                onChange={(e) => {
                  if (e.target.value === 'custom') {
                    setIsCustomExamName(true);
                    setNewExamTypeId('');
                  } else {
                    setIsCustomExamName(false);
                    setNewExamTypeId(e.target.value);
                  }
                }}
                options={[
                  { value: '', label: '選択してください' },
                  { value: 'mogi', label: '模試' },
                  ...examTypes.map((et) => ({
                    value: et.id,
                    label: et.name,
                  })),
                  { value: 'custom', label: 'その他' },
                ]}
                required
              />
              {isCustomExamName && (
                <input
                  type="text"
                  value={newCustomExamName}
                  onChange={(e) => setNewCustomExamName(e.target.value)}
                  placeholder="テスト名を入力してください"
                  className="w-full mt-2 px-3 py-2 border border-[#0d0d0d] rounded-lg"
                  required
                />
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-[#0d0d0d] mb-1">
                テスト日 <span className="text-[#d9376e]">*</span>
              </label>
              <input
                type="date"
                value={newExamDate}
                onChange={(e) => setNewExamDate(e.target.value)}
                className="w-full px-3 py-2 border border-[#0d0d0d] rounded-lg"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#0d0d0d] mb-1">
                目標点
              </label>
              <input
                type="number"
                value={newExamTargetScore}
                onChange={(e) => setNewExamTargetScore(e.target.value)}
                className="w-full px-3 py-2 border border-[#0d0d0d] rounded-lg"
                placeholder="例: 80"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#0d0d0d] mb-1">
                試験範囲
              </label>
              <textarea
                value={newExamRange}
                onChange={(e) => setNewExamRange(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-[#0d0d0d] rounded-lg"
                placeholder="試験範囲を入力してください"
              />
            </div>
            <div className="flex justify-end gap-2 pt-4 border-t border-[#0d0d0d]">
              <Button
                onClick={() => {
                  setIsAddExamModalOpen(false);
                  setNewExamTypeId('');
                  setNewExamDate('');
                  setNewExamTargetScore('');
                  setNewExamRange('');
                }}
                variant="secondary"
                size="sm"
              >
                キャンセル
              </Button>
              <Button
                onClick={async () => {
                  if (!newExamDate || !selectedTextbookId) {
                    error('テスト日は必須です');
                    return;
                  }
                  if (!isCustomExamName && !newExamTypeId) {
                    error('テスト名を選択してください');
                    return;
                  }
                  if (isCustomExamName && !newCustomExamName) {
                    error('テスト名を入力してください');
                    return;
                  }
                  try {
                    let examTypeId: string | null = null;
                    let customExamName: string | null = null;
                    
                    if (isCustomExamName) {
                      customExamName = newCustomExamName;
                    } else if (newExamTypeId === 'mogi') {
                      // 模試の場合はexam_type_idをnullにしてcustom_exam_nameに「模試」を設定
                      customExamName = '模試';
                    } else {
                      examTypeId = newExamTypeId;
                    }
                    
                    await createStudentTextbookExam({
                      student_textbook_id: selectedTextbookId,
                      exam_type_id: examTypeId,
                      custom_exam_name: customExamName,
                      exam_date: newExamDate,
                      target_score: newExamTargetScore ? parseInt(newExamTargetScore, 10) : null,
                      exam_range: newExamRange || null,
                    });
                    await fetchStudentTextbooks();
                    setIsAddExamModalOpen(false);
                    setNewExamTypeId('');
                    setNewExamDate('');
                    setNewExamTargetScore('');
                    setNewExamRange('');
                    setNewCustomExamName('');
                    setIsCustomExamName(false);
                    success('テスト設定を追加しました');
                  } catch (err) {
                    console.error('Error adding exam:', err);
                    error(err instanceof Error ? err.message : 'テスト設定の追加に失敗しました');
                  }
                }}
                variant="primary"
                size="sm"
              >
                追加
              </Button>
            </div>
          </div>
        </Modal>

        {/* アーカイブモーダル */}
        <Modal
          isOpen={isArchiveModalOpen}
          onClose={() => setIsArchiveModalOpen(false)}
          title="アーカイブ置き場"
          size="md"
        >
          <div className="space-y-3">
            {studentTextbooks.filter((st) => !st.is_active).length === 0 ? (
              <p className="text-sm text-[#2a2a2a] py-4 text-center">
                非表示のテキストはありません
              </p>
            ) : (
              studentTextbooks
                .filter((st) => !st.is_active)
                .map((st) => (
                  <div
                    key={st.id}
                    className="flex items-center justify-between p-3 border border-[#0d0d0d] rounded-lg"
                  >
                    <div className="flex-1">
                      <div className="font-medium text-[#0d0d0d]">{st.textbook.name}</div>
                      {st.textbook.publisher && (
                        <div className="text-xs text-[#2a2a2a] mt-1">
                          出版社: {st.textbook.publisher}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        onClick={async () => {
                          try {
                            await updateStudentTextbook(st.id, {
                              is_active: true,
                            });
                            await fetchStudentTextbooks();
                            success('テキストを表示しました');
                            if (studentTextbooks.filter((st) => !st.is_active).length === 1) {
                              setIsArchiveModalOpen(false);
                            }
                          } catch (err) {
                            error(err instanceof Error ? err.message : '操作に失敗しました');
                          }
                        }}
                        variant="secondary"
                        size="sm"
                      >
                        表示する
                      </Button>
                      <Button
                        onClick={async () => {
                          if (window.confirm(`${st.textbook.name}を削除しますか？\nこの操作は取り消せません。`)) {
                            try {
                              await deleteStudentTextbook(st.id);
                              await fetchStudentTextbooks();
                              success('テキストを削除しました');
                              if (studentTextbooks.filter((st) => !st.is_active).length === 1) {
                                setIsArchiveModalOpen(false);
                              }
                            } catch (err) {
                              error(err instanceof Error ? err.message : '削除に失敗しました');
                            }
                          }
                        }}
                        variant="danger"
                        size="sm"
                      >
                        削除
                      </Button>
                    </div>
                  </div>
                ))
            )}
          </div>
        </Modal>
      </AdminLayout>
    </div>
  );
}
