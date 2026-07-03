'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Eye, EyeOff, FileText, Plus, RefreshCw, Send, Settings2 } from 'lucide-react';
import {
  getStudentProgress,
  updateStudentProgress,
  upsertStudentProgress,
  upsertStudentProgressLesson,
} from '@/lib/api/progress';
import SessionRecordingPanel from '@/components/progress/SessionRecordingPanel';
import type { SessionRecordingPanelHandle } from '@/components/progress/SessionRecordingPanel';
import { syncProgressToSession, submitDirectInput } from '@/lib/api/progress-sessions';
import { createExamRange, deleteExamRange, getExamRanges } from '@/lib/api/exam-ranges';
import type {
  ActionGoal,
  CurriculumItemWithProgress,
  ExamType,
  StudentTextbookExamRange,
  StudentTextbookWithDetails,
} from '@/types/database';
import {
  INTENT_TAGS,
  activeExamOf,
  isIntentTag,
  itemNo,
  type IntentTag,
  type ViewMode,
} from './newProgress.shared';
import { ActionGoalsSection } from './ActionGoalsSection';
import { TextbookSettingsInline } from './TextbookSettingsInline';
import { ExamRangesInline } from './ExamRangesInline';
import { ProgressRow } from './ProgressRow';
import { ExamGoalEditModal } from './ExamGoalEditModal';
import { NextGoalModal } from './NextGoalModal';
import { ExamRangeModal } from './ExamRangeModal';

// ─────────────────────────────────────────────
// テーブルビュー（Phase 1: 最低限の編集機能 + Phase 2a: 面談モード行可視化）
// ─────────────────────────────────────────────
export function TableView({
  textbook,
  progress,
  setProgress,
  examTypes,
  actionGoalsByExam,
  setActionGoalsByExam,
  examRanges,
  setExamRangesForTextbook,
  textbookTabs,
  onSelectTab,
  role,
  viewMode,
  studentId,
  studentName,
  selfName,
  onBack,
  onRefresh,
  success,
  toastError,
  onTogglePublish,
}: {
  textbook: StudentTextbookWithDetails;
  progress: CurriculumItemWithProgress[];
  setProgress: React.Dispatch<React.SetStateAction<CurriculumItemWithProgress[]>>;
  examTypes: ExamType[];
  actionGoalsByExam: Record<string, ActionGoal[]>;
  setActionGoalsByExam: React.Dispatch<React.SetStateAction<Record<string, ActionGoal[]>>>;
  examRanges: StudentTextbookExamRange[];
  setExamRangesForTextbook: (ranges: StudentTextbookExamRange[]) => void;
  textbookTabs: StudentTextbookWithDetails[];
  onSelectTab: (id: string) => void;
  role: 'teacher' | 'manager';
  viewMode: ViewMode;
  studentId: string;
  studentName: string;
  selfName: string;
  onBack: () => void;
  onRefresh: () => Promise<void>;
  success: (m: string) => void;
  toastError: (m: string) => void;
  onTogglePublish?: (id: string) => void;
}) {
  const isMeeting = viewMode === 'meeting';
  const activeExam = activeExamOf(textbook, examTypes);
  const activeExamGoals = activeExam ? (actionGoalsByExam[activeExam.id] ?? []) : [];
  // 試験日を過ぎている（daysLeft が負）かどうか。過ぎている場合は「次の目標へ」の導線を強調する。
  const isExpired = activeExam?.daysLeft != null && activeExam.daysLeft < 0;
  // 目標設定編集モーダル
  const [goalModalOpen, setGoalModalOpen] = useState(false);
  const [goalModalEditingId, setGoalModalEditingId] = useState<string | null>(null);
  // 「次の目標へ」モーダル（前回結果の記録→次の目標作成→行動目標引き継ぎを1フローで行う）
  const [nextGoalOpen, setNextGoalOpen] = useState(false);
  const [rangeModalOpen, setRangeModalOpen] = useState(false);
  /** 編集中の試験範囲 (rangeId) と対象試験 (examTypeId)。新規の場合は rangeId=null */
  const [rangeModalEditing, setRangeModalEditing] = useState<{
    rangeId: string | null;
    examTypeId: string | null;
  }>({ rangeId: null, examTypeId: null });

  // 列可視化: 管理モード / 面談モード共通の1つの設定として保存。
  // 申込・引継ぎ・講師名は面談モードでは列設定に関係なく常時非表示（内部情報のため）。
  type MeetingCol =
    | 'proposal'
    | 'application'
    | 'examRange'
    | 'schoolProgress'
    | 'lesson1'
    | 'lesson2'
    | 'lesson3'
    | 'handover'
    | 'homeworkNotDone'
    | 'tardy'
    | 'teacherName';
  const colsKey = `progress-cols:${studentId}:${textbook.id}`;
  // デフォルトは「試験範囲・学校進度・1回目・2回目・引継ぎ・宿題未・遅刻・講師名」を表示
  // 提案コマ数／申込コマ数／3回目はデフォルトでは非表示
  const DEFAULT_COLS: Record<MeetingCol, boolean> = {
    proposal: false,
    application: true,
    examRange: true,
    schoolProgress: true,
    lesson1: true,
    lesson2: true,
    lesson3: false,
    handover: true,
    homeworkNotDone: true,
    tardy: true,
    teacherName: true,
  };
  const [meetingCols, setMeetingCols] = useState<Record<MeetingCol, boolean>>(DEFAULT_COLS);
  const [colMenuOpen, setColMenuOpen] = useState(false);

  // ESC で列設定ドロップダウンを閉じる
  useEffect(() => {
    if (!colMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setColMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [colMenuOpen]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const stored = window.localStorage.getItem(colsKey);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<Record<MeetingCol, boolean>>;
        setMeetingCols({ ...DEFAULT_COLS, ...parsed });
      } else {
        setMeetingCols(DEFAULT_COLS);
      }
    } catch {
      setMeetingCols(DEFAULT_COLS);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colsKey]);

  const toggleCol = (col: MeetingCol) => {
    setMeetingCols((prev) => {
      const next = { ...prev, [col]: !prev[col] };
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(colsKey, JSON.stringify(next));
      }
      return next;
    });
  };
  const resetCols = () => {
    setMeetingCols(DEFAULT_COLS);
    if (typeof window !== 'undefined') window.localStorage.removeItem(colsKey);
  };

  // メニュー選択肢: 全9列（管理モードで設定・面談モードにも反映）
  const colOptions: { key: MeetingCol; label: string; meetingOnlyHidden?: boolean }[] = [
    { key: 'proposal', label: '提案コマ数' },
    { key: 'application', label: '申込コマ数', meetingOnlyHidden: true },
    { key: 'examRange', label: '試験範囲' },
    { key: 'schoolProgress', label: '学校進度' },
    { key: 'lesson1', label: '1回目' },
    { key: 'lesson2', label: '2回目' },
    { key: 'lesson3', label: '3回目' },
    { key: 'handover', label: '引継ぎ', meetingOnlyHidden: true },
    { key: 'homeworkNotDone', label: '宿題未実施', meetingOnlyHidden: true },
    { key: 'tardy', label: '遅刻', meetingOnlyHidden: true },
    { key: 'teacherName', label: '講師名', meetingOnlyHidden: true },
  ];
  const hiddenColCount = colOptions.filter((o) => !meetingCols[o.key]).length;

  // ─── 一括塗りモード ───
  // 試験範囲 or 指導意図を範囲選択で一括適用する UI
  type PaintMode = null | 'examRange' | 'intent';
  const [paintMode, setPaintMode] = useState<PaintMode>(null);
  const [paintValue, setPaintValue] = useState<string>('');
  // 開始位置は row.id で持つ（item_number が無い行も選択可能にするため）
  const [paintStart, setPaintStart] = useState<string | null>(null);

  useEffect(() => {
    // モード / 値変更時は開始位置をリセット
    setPaintStart(null);
  }, [paintMode, paintValue]);

  // 一括塗りを適用: progress 配列のインデックス [lo..hi] の行に paintValue を設定
  const applyPaint = useCallback(
    async (startRowId: string, endRowId: string) => {
      if (!paintMode || !paintValue) return;
      const sIdx = progress.findIndex((r) => String(r.id) === startRowId);
      const eIdx = progress.findIndex((r) => String(r.id) === endRowId);
      if (sIdx < 0 || eIdx < 0) return;
      const lo = Math.min(sIdx, eIdx);
      const hi = Math.max(sIdx, eIdx);
      const sliceIds = new Set(progress.slice(lo, hi + 1).map((r) => String(r.id)));
      try {
        if (paintMode === 'examRange') {
          // 独立テーブル登録用: スライスの中で item_number を持つ行から min/max を算出
          const nums = progress
            .slice(lo, hi + 1)
            .map((r) => itemNo(r))
            .filter((n): n is number => n != null);
          if (nums.length > 0) {
            const loN = Math.min(...nums);
            const hiN = Math.max(...nums);
            // 新規セグメントとして追加（複数区間対応: 既存セグメントは保持）
            await createExamRange({
              student_textbook_id: textbook.id,
              exam_type_id: paintValue,
              range_start_item_number: loN,
              range_end_item_number: hiN,
            });
          }
          // per-row 同期: スライス内は付与のみ。スライス外は他セグメントを保護するため解除しない
          await Promise.all(
            progress.map(async (row) => {
              const inSlice = sliceIds.has(String(row.id));
              if (!inSlice) return;
              const hasThis = row.progress?.exam_range_exam_type_id === paintValue;
              if (hasThis) return;
              if (row.progress?.id) {
                await updateStudentProgress(row.progress.id, {
                  exam_range_exam_type_id: paintValue,
                });
              } else {
                await upsertStudentProgress({
                  student_textbook_id: textbook.id,
                  curriculum_item_id: row.id,
                  exam_range_exam_type_id: paintValue,
                });
              }
            })
          );
          const newRanges = await getExamRanges(textbook.id);
          setExamRangesForTextbook(newRanges);
        } else if (paintMode === 'intent') {
          await Promise.all(
            progress.slice(lo, hi + 1).map(async (row) => {
              if (row.progress?.id) {
                await updateStudentProgress(row.progress.id, { intent_tag: paintValue });
              } else {
                await upsertStudentProgress({
                  student_textbook_id: textbook.id,
                  curriculum_item_id: row.id,
                  intent_tag: paintValue,
                });
              }
            })
          );
        }
        // progress 再取得
        const rows = await getStudentProgress(textbook.id);
        setProgress(rows || []);
        success(`${hi - lo + 1}件に一括適用しました`);
        // 適用後は自動でモードを解除
        setPaintMode(null);
        setPaintValue('');
        setPaintStart(null);
      } catch (e) {
        console.error(e);
        toastError('一括適用に失敗しました');
        setPaintStart(null);
      }
    },
    [
      paintMode,
      paintValue,
      progress,
      textbook.id,
      setProgress,
      setExamRangesForTextbook,
      success,
      toastError,
    ]
  );

  // 行クリック時: paint モード中なら開始→終了の2クリックで適用
  const handlePaintRowClick = useCallback(
    (rowId: string) => {
      if (!paintMode || !paintValue) return false;
      if (paintStart == null) {
        setPaintStart(rowId);
      } else {
        applyPaint(paintStart, rowId);
      }
      return true;
    },
    [paintMode, paintValue, paintStart, applyPaint]
  );

  // ─── セッション記録モード（新UI）───
  const [sessionMode, setSessionMode] = useState(false);
  const sessionPanelRef = useRef<SessionRecordingPanelHandle | null>(null);
  // セッション選択状態（テーブル行ハイライト用）
  const [sessionSelection, setSessionSelection] = useState<{
    unitActions: Record<number, 1 | 2 | 3>;
    schoolUnits: Set<number>;
  } | null>(null);

  // セッション保存後にデータ再読込
  const handleSessionSaved = useCallback(async () => {
    try {
      const rows = await getStudentProgress(textbook.id);
      setProgress(rows || []);
      success('セッションを保存しました');
    } catch {
      // noop
    }
  }, [textbook.id, setProgress, success]);

  // ─── 直接入力 dirty tracking（提出ボタン用） ───
  // セッション記録モード以外で編集された行を追跡
  const [dirtyRows, setDirtyRows] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  // 編集してから提出せず長時間放置されたら true に。ボタンをパルスで注意喚起。
  const [idleAlert, setIdleAlert] = useState(false);

  // テキスト切替時に dirty をリセット
  useEffect(() => {
    setDirtyRows(new Set());
    setIdleAlert(false);
  }, [textbook.id]);

  const markDirty = useCallback(
    (rowId: string) => {
      if (sessionMode) return; // セッション記録モード中は追跡しない
      setIdleAlert(false); // 編集が入ったらアラートを解除
      setDirtyRows((prev) => {
        if (prev.has(rowId)) return prev;
        const next = new Set(prev);
        next.add(rowId);
        return next;
      });
    },
    [sessionMode]
  );

  // 編集が1件以上ある状態で 1時間 (3,600,000ms) 提出されなかったら idleAlert を立てる。
  // markDirty で再編集された場合は idleAlert=false に戻り、タイマーも貼り直し。
  useEffect(() => {
    if (dirtyRows.size === 0) {
      setIdleAlert(false);
      return;
    }
    const ONE_HOUR_MS = 60 * 60 * 1000;
    const timer = setTimeout(() => setIdleAlert(true), ONE_HOUR_MS);
    return () => clearTimeout(timer);
  }, [dirtyRows]);

  // 提出: 直接入力からセッションを生成
  const handleSubmit = useCallback(async () => {
    setSubmitting(true);
    try {
      const result = await submitDirectInput({
        studentTextbookId: textbook.id,
        teacherName: selfName,
        teacherId: null,
      });
      if (result) {
        success(`${result.linkedCount}件の指導記録を提出しました`);
        setDirtyRows(new Set());
        setIdleAlert(false);
        const rows = await getStudentProgress(textbook.id);
        setProgress(rows || []);
      } else {
        toastError('提出対象の指導記録がありません（指導日を入力してください）');
      }
    } catch (e) {
      console.error(e);
      toastError('提出に失敗しました');
    } finally {
      setSubmitting(false);
    }
  }, [textbook.id, selfName, setProgress, success, toastError]);

  // 編集ハンドラ（既存API呼出し、楽観的更新）
  // progress が null の場合も shell を作って UI を即反映できるようにする
  const updateLocal = (itemId: string, patch: Partial<CurriculumItemWithProgress['progress']>) => {
    setProgress(
      progress.map((row) =>
        String(row.id) === itemId
          ? {
              ...row,
              progress: row.progress
                ? { ...row.progress, ...patch }
                : ({
                    ...(patch as object),
                    curriculum_item_id: row.id,
                  } as unknown as CurriculumItemWithProgress['progress']),
            }
          : row
      )
    );
  };

  const saveProgressField = useCallback(
    async (row: CurriculumItemWithProgress, patch: Record<string, unknown>) => {
      try {
        let saved;
        if (row.progress?.id) {
          saved = await updateStudentProgress(row.progress.id, patch);
        } else {
          saved = await upsertStudentProgress({
            student_textbook_id: textbook.id,
            curriculum_item_id: row.id,
            ...patch,
          });
        }
        // 保存結果を local state に反映（id や null→record への昇格を確定させる）
        if (saved) {
          setProgress((prev: CurriculumItemWithProgress[]) =>
            prev.map((r) =>
              r.id === row.id
                ? {
                    ...r,
                    progress: {
                      ...(r.progress || {}),
                      ...(saved as object),
                    } as CurriculumItemWithProgress['progress'],
                  }
                : r
            )
          );
        }
        // セッション共有フィールドが変更されたら progress_sessions にも同期（フィード反映）
        const progressId = row.progress?.id || (saved as { id?: string })?.id;
        if (progressId) {
          syncProgressToSession(progressId, patch).catch(console.error);
        }
        markDirty(String(row.id));
      } catch (e) {
        console.error(e);
        toastError('保存に失敗しました');
      }
    },
    [textbook.id, toastError, setProgress, markDirty]
  );

  const saveLessonField = useCallback(
    async (row: CurriculumItemWithProgress, lessonNumber: 1 | 2 | 3, date: string | null) => {
      if (!row.progress?.id) {
        toastError('先に他の項目を埋めて進捗レコードを作成してください');
        return;
      }
      try {
        await upsertStudentProgressLesson({
          student_progress_id: row.progress.id,
          lesson_number: lessonNumber,
          lesson_date: date,
        });
        markDirty(String(row.id));
      } catch (e) {
        console.error(e);
        toastError('指導日の保存に失敗しました');
      }
    },
    [toastError, markDirty]
  );

  return (
    <div>
      {/* ヘッダ */}
      <div className="mb-4 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={onBack} className="text-sm text-[#4b5563] hover:text-[#1f2937]">
            ← テキスト一覧
          </button>
          <h2 className="text-base font-semibold text-[#1f2937]">
            {textbook.textbook?.name ?? '教科書'}
          </h2>
          {textbook.is_draft && (
            <span className="px-2 py-0.5 bg-gray-200 text-gray-700 rounded text-[11px] font-bold border border-gray-400">
              非公開
            </span>
          )}
          {isMeeting && (
            <span className="px-2 py-0.5 bg-[#fef3c7] text-[#92400e] rounded-full text-[11px] font-semibold uppercase tracking-wider">
              面談用・プラン表示
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onTogglePublish && !isMeeting && (
            <button
              onClick={() => onTogglePublish(textbook.id)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-[background-color,color,border-color] duration-150 ease-out active:scale-[0.97] inline-flex items-center gap-1.5 ${
                textbook.is_draft
                  ? 'bg-gray-100 text-gray-700 border-gray-300 hover:bg-gray-200'
                  : 'bg-white text-[#1e40af] border-[#bfdbfe] hover:bg-[#eff6ff]'
              }`}
              title={textbook.is_draft ? '講師に公開する' : '講師に非公開にする'}
            >
              {textbook.is_draft ? (
                <EyeOff className="w-3.5 h-3.5" />
              ) : (
                <Eye className="w-3.5 h-3.5" />
              )}
              {textbook.is_draft ? '講師非公開中' : '講師に公開中'}
            </button>
          )}
          {/* 列設定ドロップダウン（面談/通常 両モードで使用可能） */}
          <div className="relative">
            <button
              onClick={() => setColMenuOpen((v) => !v)}
              aria-expanded={colMenuOpen}
              aria-haspopup="menu"
              aria-label={`列設定${hiddenColCount > 0 ? `（${hiddenColCount}列非表示中）` : ''}`}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:text-gray-800 active:scale-[0.97] transition-[background-color,transform,color] duration-150 ease-out flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1e3a5f]/40"
            >
              <Settings2 className="w-3.5 h-3.5" />
              列設定
              {hiddenColCount > 0 && (
                <span className="px-1 py-0.5 text-[11px] bg-gray-200 text-gray-700 rounded font-medium">
                  {hiddenColCount}
                </span>
              )}
            </button>
            {colMenuOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setColMenuOpen(false)} />
                <div
                  role="menu"
                  className="dropdown-enter absolute right-0 top-full mt-1 w-56 bg-white border border-[#e5e7eb] rounded-lg shadow-lg z-40 overflow-hidden"
                >
                  <div className="px-3 py-2 text-[11px] text-[#6b7280] uppercase tracking-wider border-b border-[#f3f4f6] bg-[#f9fafb] flex items-center justify-between">
                    <span>{isMeeting ? '保護者に見せる列を選択' : '表示する列を選択'}</span>
                    {hiddenColCount > 0 && (
                      <button
                        onClick={resetCols}
                        className="text-[11px] text-[#1e40af] hover:underline normal-case"
                      >
                        全表示
                      </button>
                    )}
                  </div>
                  {colOptions.map((c) => (
                    <label
                      key={c.key}
                      className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-[#f9fafb] cursor-pointer transition-[background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]"
                    >
                      <input
                        type="checkbox"
                        checked={meetingCols[c.key]}
                        onChange={() => toggleCol(c.key)}
                        className="w-4 h-4 accent-[#1e3a5f]"
                      />
                      <span className={meetingCols[c.key] ? 'text-[#1f2937]' : 'text-[#9ca3af]'}>
                        {c.label}
                      </span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
          {!isMeeting && (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => {
                  setSessionMode((v) => {
                    if (v) setSessionSelection(null);
                    return !v;
                  });
                }}
                disabled={!activeExam && !sessionMode && role === 'teacher'}
                title={!activeExam && role === 'teacher' ? '目標を設定してください' : undefined}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-[background-color,transform] duration-150 ease-out ${
                  sessionMode
                    ? 'bg-[#dc2626] text-white hover:bg-[#b91c1c] active:scale-[0.97]'
                    : !activeExam && role === 'teacher'
                      ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                      : 'bg-[#1e3a5f] text-white hover:bg-[#2a4d7a] active:scale-[0.97]'
                }`}
              >
                {sessionMode ? 'セッション終了' : '授業を記録'}
              </button>
              <Link
                href={`/students/${studentId}/proposals`}
                className="px-2.5 py-1.5 rounded-lg text-xs font-medium border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 transition-[background-color] duration-150 ease-out active:scale-[0.97] flex items-center gap-1"
              >
                <FileText className="w-3.5 h-3.5" />
                提案書一覧
              </Link>
              <Link
                href={`/students/${studentId}/proposals/new?stbId=${textbook.id}&textbookId=${textbook.textbook_id}&season=${textbook.season || 'summer'}&year=${new Date().getFullYear()}`}
                className="px-2.5 py-1.5 rounded-lg text-xs font-medium border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 transition-[background-color] duration-150 ease-out active:scale-[0.97] flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                提案書作成
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* 教科書タブ（横並び・サクッと切替） */}
      {textbookTabs.length > 1 && (
        <div className="mb-3 flex gap-1 overflow-x-auto pb-1">
          {textbookTabs.map((tb) => (
            <button
              key={tb.id}
              onClick={() => onSelectTab(tb.id)}
              className={`px-3 py-1.5 text-xs rounded-lg whitespace-nowrap transition-[background-color,color] duration-150 ease-out ${
                tb.id === textbook.id
                  ? 'bg-[#1e3a5f] text-white'
                  : 'bg-white text-[#4b5563] border border-[#e5e7eb] hover:bg-[#f3f4f6]'
              }`}
            >
              {tb.textbook?.name ?? '—'}
            </button>
          ))}
        </div>
      )}

      {/* ── 試験・設定エリア（コンパクト） ── */}
      <div className="mb-3 space-y-2">
        {/* 目標設定 */}
        {activeExam ? (
          <div className="bg-gradient-to-r from-[#eff6ff] to-[#dbeafe]/50 border border-[#1e40af]/20 rounded-lg px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-[#1e3a5f]">{activeExam.name}</span>
                {activeExam.date && (
                  <span className="text-[11px] text-[#6b7280]">{activeExam.date}</span>
                )}
                {isExpired && (
                  <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-800 border border-amber-300 rounded font-bold">
                    終了
                  </span>
                )}
              </div>
              {!isMeeting && (
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setNextGoalOpen(true)}
                    className={`px-2 py-0.5 text-[11px] rounded transition-[background-color,color] duration-150 ease-out active:scale-[0.97] ${
                      isExpired
                        ? 'bg-amber-500 text-white hover:bg-amber-600 font-bold'
                        : 'bg-white border border-[#1e40af]/20 text-[#1e40af] hover:bg-[#1e40af] hover:text-white'
                    }`}
                  >
                    次の目標へ
                  </button>
                  <button
                    onClick={() => {
                      setGoalModalEditingId(activeExam.id);
                      setGoalModalOpen(true);
                    }}
                    className="px-2 py-0.5 text-[11px] bg-white border border-[#1e40af]/20 rounded text-[#1e40af] hover:bg-[#1e40af] hover:text-white transition-[background-color,color] duration-150 ease-out active:scale-[0.97]"
                  >
                    編集
                  </button>
                </div>
              )}
            </div>
            <div className="flex items-center gap-4">
              <div className="text-center">
                <div className="text-[9px] text-[#6b7280] font-semibold uppercase">残り</div>
                {isExpired ? (
                  <span className="text-sm font-bold text-amber-600">終了</span>
                ) : (
                  <>
                    <span className="text-lg font-bold text-[#1e3a5f]">
                      {activeExam.daysLeft ?? '—'}
                    </span>
                    {activeExam.daysLeft != null && (
                      <span className="text-[11px] text-[#6b7280]">日</span>
                    )}
                  </>
                )}
              </div>
              <div className="text-center">
                <div className="text-[9px] text-[#6b7280] font-semibold uppercase">目標</div>
                <span className="text-lg font-bold text-[#1e3a5f]">
                  {activeExam.targetScore ?? '—'}
                </span>
                {activeExam.targetScore != null && (
                  <span className="text-[11px] text-[#6b7280]">点</span>
                )}
              </div>
              {(() => {
                // 目標の隣に前回結果を表示（result_score は元の exam レコードにのみ存在する）
                const currentExam = (textbook.exams || []).find((e) => e.id === activeExam.id);
                if (currentExam?.result_score == null) return null;
                return (
                  <div className="text-center">
                    <div className="text-[9px] text-[#6b7280] font-semibold uppercase">結果</div>
                    <span className="text-lg font-bold text-[#1e3a5f]">
                      {currentExam.result_score}
                    </span>
                    <span className="text-[11px] text-[#6b7280]">点</span>
                  </div>
                );
              })()}
              <div className="text-center">
                <div className="text-[9px] text-[#6b7280] font-semibold uppercase">行動目標</div>
                <span className="text-lg font-bold text-[#1e3a5f]">
                  {activeExamGoals.filter((g) => g.achieved).length}
                </span>
                <span className="text-xs text-[#6b7280]">/{activeExamGoals.length}</span>
              </div>
            </div>
            <ActionGoalsSection
              examId={activeExam.id}
              goals={activeExamGoals}
              allExams={textbook.exams || []}
              examTypes={examTypes}
              isMeeting={isMeeting}
              toastError={toastError}
              success={success}
              onChange={(next) => {
                setActionGoalsByExam((prev) => ({ ...prev, [activeExam.id]: next }));
              }}
            />
          </div>
        ) : (
          <div className="bg-amber-50 border-2 border-amber-400 rounded-lg px-4 py-3 flex items-center justify-between">
            <div>
              <div className="text-sm font-bold text-amber-800">目標が設定されていません</div>
              <div className="text-[11px] text-amber-600 mt-0.5">
                目標を設定しないと進捗の入力・記録ができません。先に目標を設定してください。
              </div>
            </div>
            {!isMeeting && (
              <button
                onClick={() => {
                  setGoalModalEditingId(null);
                  setGoalModalOpen(true);
                }}
                className="px-4 py-2 bg-amber-500 text-white text-xs font-bold rounded-lg hover:bg-amber-600 transition-[background-color] duration-150 ease-out active:scale-[0.97] whitespace-nowrap"
              >
                目標を設定する
              </button>
            )}
          </div>
        )}

        {/* 進め方 / 宿題 / 試験範囲 — 1つのカードにまとめる */}
        {!isMeeting && (
          <div className="bg-white border border-[#e5e7eb] rounded-lg p-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
              {/* key={textbook.id} でテキスト切り替え時に再マウントし、保存済みの初期値を入れ直す */}
              <TextbookSettingsInline
                key={textbook.id}
                textbookId={textbook.id}
                approach={textbook.settings?.approach}
                homeworkStyle={textbook.settings?.homework_style}
                toastError={toastError}
              />
            </div>
            <ExamRangesInline
              textbookId={textbook.id}
              examTypes={examTypes}
              ranges={examRanges}
              progress={progress}
              isMeeting={isMeeting}
              onOpenEdit={(rangeId, examTypeId) => {
                setRangeModalEditing({ rangeId, examTypeId });
                setRangeModalOpen(true);
              }}
              onDelete={async (rangeId) => {
                if (!window.confirm('この試験範囲を削除しますか？')) return;
                try {
                  const target = examRanges.find((r) => r.id === rangeId);
                  await deleteExamRange(rangeId);
                  if (target) {
                    const others = examRanges.filter(
                      (r) => r.id !== rangeId && r.exam_type_id === target.exam_type_id
                    );
                    const inOther = (n: number | null): boolean => {
                      if (n == null) return false;
                      return others.some(
                        (r) => n >= r.range_start_item_number && n <= r.range_end_item_number
                      );
                    };
                    await Promise.all(
                      progress.map(async (row) => {
                        const n = itemNo(row);
                        const hasThis =
                          row.progress?.exam_range_exam_type_id === target.exam_type_id;
                        if (!hasThis) return;
                        const inDeleted =
                          n != null &&
                          n >= target.range_start_item_number &&
                          n <= target.range_end_item_number;
                        if (inDeleted && !inOther(n) && row.progress?.id) {
                          await updateStudentProgress(row.progress.id, {
                            exam_range_exam_type_id: null,
                          });
                        }
                      })
                    );
                    const rows = await getStudentProgress(textbook.id);
                    setProgress(rows || []);
                  }
                  setExamRangesForTextbook(examRanges.filter((r) => r.id !== rangeId));
                  success('試験範囲を削除しました');
                } catch (e) {
                  console.error(e);
                  toastError('削除に失敗しました');
                }
              }}
            />
          </div>
        )}
        {/* 面談モードでも試験範囲は表示 */}
        {isMeeting && examRanges.length > 0 && (
          <ExamRangesInline
            textbookId={textbook.id}
            examTypes={examTypes}
            ranges={examRanges}
            progress={progress}
            isMeeting={isMeeting}
            onOpenEdit={() => {}}
            onDelete={() => {}}
          />
        )}
      </div>

      {/* セッション記録モード（新UI） */}
      {sessionMode && !isMeeting && (
        <SessionRecordingPanel
          ref={sessionPanelRef}
          studentTextbookId={textbook.id}
          studentName={studentName}
          textbookName={textbook.textbook?.name ?? '教科書'}
          curriculumItems={progress}
          onSessionSaved={handleSessionSaved}
          onSelectionChange={setSessionSelection}
          canEditSaved={true}
          onComplete={() => {
            // 全セッションが保存済みになったら授業記録モードを終了しセレクションをクリア
            setSessionMode(false);
            setSessionSelection(null);
          }}
        />
      )}

      {/* 進捗テーブル */}
      <div className="bg-white rounded-xl border border-[#e5e7eb] overflow-hidden shadow-sm overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead className="bg-[#f9fafb] border-b border-[#e5e7eb] text-[#6b7280] text-xs">
            <tr>
              <th className="px-3 py-2 text-left w-10">#</th>
              <th className="px-3 py-2 text-left min-w-[180px]">単元名</th>
              {meetingCols.proposal && <th className="px-3 py-2 text-left w-20">提案</th>}
              {!isMeeting && meetingCols.application && (
                <th className="px-3 py-2 text-left w-20">申込</th>
              )}
              {meetingCols.examRange && (
                <th className="px-3 py-2 text-left min-w-[140px] whitespace-nowrap">試験範囲</th>
              )}
              {meetingCols.schoolProgress && <th className="px-3 py-2 text-left w-28">学校進度</th>}
              {meetingCols.lesson1 && <th className="px-3 py-2 text-left w-28">1回目</th>}
              {meetingCols.lesson2 && <th className="px-3 py-2 text-left w-28">2回目</th>}
              {meetingCols.lesson3 && <th className="px-3 py-2 text-left w-28">3回目</th>}
              {!isMeeting && meetingCols.handover && (
                <th className="px-3 py-2 text-left min-w-[160px]">引継ぎ</th>
              )}
              {!isMeeting && meetingCols.homeworkNotDone && (
                <th className="px-3 py-2 text-center w-16">宿題未</th>
              )}
              {!isMeeting && meetingCols.tardy && (
                <th className="px-3 py-2 text-center w-16">遅刻</th>
              )}
              {!isMeeting && meetingCols.teacherName && (
                <th className="px-3 py-2 text-left w-24">講師名</th>
              )}
            </tr>
          </thead>
          <tbody>
            {(() => {
              // グループ先頭行を前から走査し、group ごとの指導意図タグを集める
              const groupIntentMap = new Map<number, IntentTag | null>();
              for (let i = 0; i < progress.length; i++) {
                const r = progress[i];
                const g = r.progress?.group_number;
                if (g == null) continue;
                if (!groupIntentMap.has(g)) {
                  const t = r.progress?.intent_tag;
                  groupIntentMap.set(g, isIntentTag(t) ? (t as IntentTag) : null);
                }
              }
              return progress.map((row, idx) => {
                const prev = idx > 0 ? progress[idx - 1] : null;
                const curGroup = row.progress?.group_number ?? null;
                const prevGroup = prev?.progress?.group_number ?? null;
                const groupStart = curGroup == null || prevGroup == null || prevGroup !== curGroup;
                // 申込結合(applied_group_number)も提案結合とは独立に先頭行を判定する。
                // 結合グループは sort_order 連続なので、前行と番号が変われば先頭。
                const curApplied = row.progress?.applied_group_number ?? null;
                const prevApplied = prev?.progress?.applied_group_number ?? null;
                const appliedGroupStart =
                  curApplied == null || prevApplied == null || prevApplied !== curApplied;
                // 結合グループの先頭行は、提案/申込セルを後続行ぶん縦結合(rowSpan)して合計を中央表示する。
                // グループ行は sort_order 連続なので、同番号が続く限り数える。
                let proposalGroupSpan = 1;
                if (curGroup != null && groupStart) {
                  for (
                    let j = idx + 1;
                    j < progress.length &&
                    (progress[j].progress?.group_number ?? null) === curGroup;
                    j++
                  )
                    proposalGroupSpan++;
                }
                let appliedGroupSpan = 1;
                if (curApplied != null && appliedGroupStart) {
                  for (
                    let j = idx + 1;
                    j < progress.length &&
                    (progress[j].progress?.applied_group_number ?? null) === curApplied;
                    j++
                  )
                    appliedGroupSpan++;
                }
                // 非先頭行でも同グループの指導意図を継承表示
                const inheritedTag: IntentTag | null =
                  !groupStart && curGroup != null ? (groupIntentMap.get(curGroup) ?? null) : null;
                const paintActive = !!paintMode && !!paintValue;
                const rowIdStr = String(row.id);
                const isPaintStart = paintStart != null && rowIdStr === paintStart;
                const isPaintCandidate = paintActive && paintStart != null;
                return (
                  <ProgressRow
                    key={row.id}
                    row={row}
                    examTypes={examTypes}
                    isMeeting={isMeeting}
                    meetingCols={meetingCols}
                    groupStart={groupStart}
                    appliedGroupStart={appliedGroupStart}
                    proposalGroupSpan={proposalGroupSpan}
                    appliedGroupSpan={appliedGroupSpan}
                    inheritedIntentTag={inheritedTag}
                    selfName={selfName}
                    isTeacher={role === 'teacher'}
                    paintActive={paintActive}
                    paintMode={paintMode}
                    isPaintStart={isPaintStart}
                    isPaintCandidate={isPaintCandidate}
                    sessionMode={sessionMode && !isMeeting}
                    sessionSelection={sessionMode && !isMeeting ? sessionSelection : null}
                    hasGoal={!!activeExam || role === 'manager'}
                    onPaintRowClick={() => handlePaintRowClick(rowIdStr)}
                    onLocalPatch={(patch) => updateLocal(rowIdStr, patch)}
                    onSaveProgress={(patch) => saveProgressField(row, patch)}
                    onSaveLesson={(n, date) => saveLessonField(row, n, date)}
                    onSessionCellToggle={
                      sessionMode
                        ? (cid, col) => sessionPanelRef.current?.handleCellToggle(cid, col)
                        : undefined
                    }
                  />
                );
              });
            })()}
          </tbody>
        </table>
      </div>

      {/* 目標設定 編集/新規モーダル */}
      {goalModalOpen && (
        <ExamGoalEditModal
          textbookId={textbook.id}
          examTypes={examTypes}
          editing={
            goalModalEditingId
              ? ((textbook.exams || []).find((e) => e.id === goalModalEditingId) ?? null)
              : null
          }
          onClose={() => setGoalModalOpen(false)}
          onSaved={async () => {
            setGoalModalOpen(false);
            success('目標を保存しました');
            await onRefresh();
          }}
          onDeleted={async () => {
            setGoalModalOpen(false);
            success('目標を削除しました');
            await onRefresh();
          }}
          toastError={toastError}
        />
      )}

      {/* 「次の目標へ」モーダル：前回の試験（activeExam）を振り返りつつ次の目標を作成する */}
      {nextGoalOpen &&
        activeExam &&
        (() => {
          const prev = (textbook.exams || []).find((e) => e.id === activeExam.id);
          return prev ? (
            <NextGoalModal
              textbookId={textbook.id}
              prevExam={prev}
              prevExamName={activeExam.name}
              examTypes={examTypes}
              onClose={() => setNextGoalOpen(false)}
              onSaved={async () => {
                setNextGoalOpen(false);
                success('次の目標を設定しました');
                await onRefresh();
              }}
              toastError={toastError}
            />
          ) : null;
        })()}

      {/* 試験範囲スライダーモーダル（独立セクションから呼び出し） */}
      {rangeModalOpen && (
        <ExamRangeModal
          textbookId={textbook.id}
          progress={progress}
          examTypes={examTypes}
          existingRanges={examRanges}
          initialExamTypeId={rangeModalEditing.examTypeId}
          initialRangeId={rangeModalEditing.rangeId}
          onClose={() => setRangeModalOpen(false)}
          onSaved={async (savedRange) => {
            setRangeModalOpen(false);
            success('試験範囲を保存しました');
            // 独立テーブルの state を更新
            setExamRangesForTextbook(
              examRanges.some((r) => r.id === savedRange.id)
                ? examRanges.map((r) => (r.id === savedRange.id ? savedRange : r))
                : [...examRanges, savedRange]
            );
            // 互換性のため per-row exam_range_exam_type_id も同期更新
            try {
              const rows = await getStudentProgress(textbook.id);
              setProgress(rows || []);
            } catch {
              /* noop */
            }
          }}
          toastError={toastError}
        />
      )}

      {/* 提出フッター: 一括設定 + 入力完了後の提出ボタン
       * - 一括設定（試験範囲/指導意図の塗りつぶしモード）を左に
       * - 編集が1件もない時は提出ボタンが disabled
       * - 提出中はスピナーを表示
       * - 1時間放置されたら submit-idle-pulse で注意喚起
       * - 登場時は下からスライドアップ（submit-footer-enter）
       */}
      {!isMeeting && !sessionMode && (
        <div className="submit-footer-enter sticky bottom-0 z-20 border-t border-gray-200 bg-white px-4 py-2.5 flex items-center gap-3 flex-wrap shadow-[0_-2px_8px_rgba(0,0,0,0.06)]">
          {/* 一括設定: 試験範囲・指導意図の連続塗りつぶし */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-medium text-gray-600">一括:</span>
            <div className="inline-flex rounded overflow-hidden border border-gray-200 text-[11px]">
              {[
                { key: null, label: 'OFF' },
                { key: 'examRange' as const, label: '試験範囲' },
                { key: 'intent' as const, label: '指導意図' },
              ].map((m) => (
                <button
                  key={m.label}
                  onClick={() => {
                    setPaintMode(m.key);
                    setPaintValue('');
                    setPaintStart(null);
                  }}
                  className={`px-2 py-0.5 transition-[background-color,color] duration-150 ease-out ${
                    paintMode === m.key
                      ? 'bg-[#1e3a5f] text-white'
                      : 'bg-white text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            {paintMode === 'examRange' && (
              <select
                value={paintValue}
                onChange={(e) => {
                  setPaintValue(e.target.value);
                  setPaintStart(null);
                }}
                className="px-1.5 py-0.5 text-[11px] border border-gray-200 rounded bg-white"
              >
                <option value="">試験を選択</option>
                {examTypes.map((et) => (
                  <option key={et.id} value={et.id}>
                    {et.name}
                  </option>
                ))}
              </select>
            )}
            {paintMode === 'intent' && (
              <select
                value={paintValue}
                onChange={(e) => {
                  setPaintValue(e.target.value);
                  setPaintStart(null);
                }}
                className="px-1.5 py-0.5 text-[11px] border border-gray-200 rounded bg-white"
              >
                <option value="">意図を選択</option>
                {INTENT_TAGS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            )}
            {paintMode &&
              paintValue &&
              (() => {
                const startRow = paintStart
                  ? progress.find((r) => String(r.id) === paintStart)
                  : null;
                const startLabel = startRow
                  ? itemNo(startRow) != null
                    ? `項目${itemNo(startRow)}`
                    : (startRow.title ?? '行')
                  : null;
                return (
                  <span className="text-[11px] text-[#1e40af] font-medium">
                    {paintStart == null ? '開始行をクリック' : `${startLabel} → 終了行をクリック`}
                  </span>
                );
              })()}
            {paintStart != null && (
              <button
                onClick={() => setPaintStart(null)}
                className="text-[11px] text-gray-500 hover:text-gray-800 underline"
              >
                リセット
              </button>
            )}
          </div>

          {/* スペーサー */}
          <div className="ml-auto flex items-center gap-3">
            <span
              aria-live="polite"
              className={`text-xs ${
                idleAlert
                  ? 'text-[#dc2626] font-semibold'
                  : dirtyRows.size > 0
                    ? 'text-gray-700 font-medium'
                    : 'text-gray-500'
              }`}
            >
              {idleAlert
                ? '未提出の入力があります'
                : dirtyRows.size > 0
                  ? `${dirtyRows.size}件の編集があります`
                  : '入力完了後 提出'}
            </span>
            <button
              onClick={handleSubmit}
              disabled={submitting || dirtyRows.size === 0}
              aria-label={
                dirtyRows.size > 0 ? `${dirtyRows.size}件の編集を提出` : '提出（編集なし）'
              }
              className={`inline-flex items-center gap-1.5 px-5 py-2 rounded-lg text-sm font-semibold transition-[background-color,transform] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1e3a5f]/40 ${
                dirtyRows.size > 0
                  ? 'bg-[#1e3a5f] text-white hover:bg-[#2a4d7a] active:scale-[0.97] shadow-sm'
                  : 'bg-gray-100 text-gray-400 cursor-not-allowed'
              } ${idleAlert && dirtyRows.size > 0 ? 'submit-idle-pulse' : ''}`}
            >
              {submitting ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              {submitting ? '提出中…' : '提出'}
              {!submitting && dirtyRows.size > 0 && (
                <span className="ml-1 px-1.5 py-0.5 bg-white/20 rounded text-[11px] font-medium">
                  {dirtyRows.size}
                </span>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
