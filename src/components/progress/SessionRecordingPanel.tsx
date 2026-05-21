'use client';

/**
 * SessionRecordingPanel — 講師UI: セッション単位の指導記録パネル
 *
 * 1コマ = 1セッション。講師が授業ごとに以下を記録:
 * - 指導日, 講師名
 * - 学校進度（下の進行表で学校列をクリック → 自動反映）
 * - 指導単元（下の進行表でlesson列をクリック → 自動反映）
 * - 引継ぎ（次の講師への申し送り）
 * - 宿題未提出 / 遅刻フラグ
 *
 * 進行表との連携は親コンポーネント経由で行う。
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from 'react';
import {
  Check, AlertTriangle, ChevronDown, ChevronUp,
  MessageSquare, Plus,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import {
  getLastSession,
  recordSession,
  type SessionUnitAction,
} from '@/lib/api/progress-sessions';
import type { ProgressSession, CurriculumItem } from '@/types/database';

// ─── 型定義 ───
export interface SessionDraft {
  id: string;       // ローカルID（未保存時は temp-xxx）
  date: string;
  teacherName: string;
  handover: string;
  homeworkNotDone: boolean;
  tardy: boolean;
  /** unitId → lesson column (lesson_number) */
  unitActions: Record<number, 1 | 2 | 3>;
  /** 学校進度としてマークした単元ID */
  schoolUnits: Set<number>;
  saved: boolean;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

function createDraft(teacherName = ''): SessionDraft {
  return {
    id: `temp-${Date.now()}`,
    date: todayIso(),
    teacherName,
    handover: '',
    homeworkNotDone: false,
    tardy: false,
    unitActions: {},
    schoolUnits: new Set(),
    saved: false,
  };
}

/** セッション選択状態（親に通知用） */
export interface SessionSelection {
  unitActions: Record<number, 1 | 2 | 3>;
  schoolUnits: Set<number>;
}

// ─── Props ───
interface Props {
  studentTextbookId: string;
  studentName: string;
  textbookName: string;
  /** 目次項目一覧（単元名の表示用） */
  curriculumItems: CurriculumItem[];
  /** セッション保存後に呼ばれる（進行表データを再取得するため） */
  onSessionSaved: () => void;
  /** 選択状態が変わるたびに呼ばれる（テーブル行ハイライト用） */
  onSelectionChange?: (sel: SessionSelection) => void;
  /** 教室長以上: 保存済みセッションを再編集可能にする */
  canEditSaved?: boolean;
}

export interface SessionRecordingPanelHandle {
  handleCellToggle: SessionCellToggleHandler;
}

const SessionRecordingPanel = forwardRef<SessionRecordingPanelHandle, Props>(function SessionRecordingPanel({
  studentTextbookId,
  studentName: _studentName,
  textbookName: _textbookName,
  curriculumItems,
  onSessionSaved,
  onSelectionChange,
  canEditSaved = false,
}, ref) {
  const { profile } = useAuth();
  const myName = profile?.display_name || '';

  // 前回の引継ぎ
  const [lastSession, setLastSession] = useState<ProgressSession | null>(null);

  // セッション一覧（複数コマ対応）
  const [sessions, setSessions] = useState<SessionDraft[]>(() => [createDraft(myName)]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 初回: 前回の引継ぎ取得
  useEffect(() => {
    if (!studentTextbookId) return;
    getLastSession(studentTextbookId).then(setLastSession).catch(console.error);
  }, [studentTextbookId]);

  // 初回: 初期セッションのexpand
  useEffect(() => {
    if (sessions.length > 0 && expandedId === null) {
      setExpandedId(sessions[0].id);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const activeSession = sessions[activeIdx] || null;

  // 選択状態が変わったら親に通知
  useEffect(() => {
    if (!activeSession || !onSelectionChange) return;
    onSelectionChange({
      unitActions: activeSession.unitActions,
      schoolUnits: activeSession.schoolUnits,
    });
  }, [activeSession?.unitActions, activeSession?.schoolUnits, activeSession?.saved, activeIdx, onSelectionChange]);

  // ─── 外部から呼ばれるAPI ───

  /**
   * 進行表の日付セルがクリックされたとき呼ばれる
   * - lesson列クリック: unitActions に追加/削除
   * - school列クリック: schoolUnits に追加/削除
   */
  // 教室長以上: 保存済みセッションを再編集可能にする
  const unlockSession = useCallback((idx: number) => {
    setSessions(prev => prev.map((s, i) => (i === idx ? { ...s, saved: false } : s)));
  }, []);

  const handleCellToggle = useCallback(
    (curriculumItemId: number, column: 'school' | 1 | 2 | 3) => {
      if (!activeSession || (activeSession.saved && !canEditSaved)) return;

      setSessions(prev => prev.map((s, i) => {
        if (i !== activeIdx) return s;
        if (column === 'school') {
          const next = new Set(s.schoolUnits);
          if (next.has(curriculumItemId)) {
            next.delete(curriculumItemId);
          } else {
            next.add(curriculumItemId);
          }
          return { ...s, schoolUnits: next };
        } else {
          const next = { ...s.unitActions };
          if (next[curriculumItemId] === column) {
            delete next[curriculumItemId];
          } else {
            next[curriculumItemId] = column;
          }
          return { ...s, unitActions: next };
        }
      }));
    },
    [activeIdx, activeSession, canEditSaved]
  );

  // Expose handleCellToggle to parent via ref
  useImperativeHandle(ref, () => ({ handleCellToggle }), [handleCellToggle]);

  // ─── セッション操作 ───

  const addSession = useCallback(() => {
    const draft = createDraft(myName);
    setSessions(prev => [...prev, draft]);
    setActiveIdx(sessions.length);
    setExpandedId(draft.id);
  }, [myName, sessions.length]);

  const updateField = useCallback(
    (idx: number, patch: Partial<SessionDraft>) => {
      setSessions(prev => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
    },
    []
  );

  // ─── 保存 ───

  const saveSession = useCallback(
    async (idx: number) => {
      const s = sessions[idx];
      if (!s || (s.saved && !canEditSaved)) return;

      // バリデーション
      if (!s.date || !s.teacherName || !s.handover) {
        alert('指導日・講師名・引継ぎは必須です');
        return;
      }

      setSaving(true);
      try {
        const unitActions: SessionUnitAction[] = Object.entries(s.unitActions).map(
          ([cid, ln]) => ({
            curriculumItemId: Number(cid),
            lessonNumber: ln,
          })
        );

        await recordSession({
          studentTextbookId,
          sessionDate: s.date,
          teacherId: profile?.id,
          teacherName: s.teacherName,
          handover: s.handover,
          homeworkNotDone: s.homeworkNotDone,
          tardy: s.tardy,
          unitActions,
          schoolProgressUnits: Array.from(s.schoolUnits),
        });

        setSessions(prev => prev.map((ss, i) => (i === idx ? { ...ss, saved: true } : ss)));
        onSessionSaved();
      } catch (e) {
        console.error(e);
        alert('保存に失敗しました');
      } finally {
        setSaving(false);
      }
    },
    [sessions, studentTextbookId, profile?.id, onSessionSaved, canEditSaved]
  );

  // ─── ヘルパー ───

  const schoolUnitsForSession = (s: SessionDraft) =>
    curriculumItems.filter(c => s.schoolUnits.has(c.id));

  const lessonUnitsForSession = (s: SessionDraft) =>
    Object.entries(s.unitActions).map(([cid, ln]) => ({
      item: curriculumItems.find(c => c.id === Number(cid)),
      lessonNumber: ln,
    })).filter((x): x is { item: CurriculumItem; lessonNumber: 1 | 2 | 3 } => !!x.item);

  // ─── Render ───

  return (
    <div className="space-y-3 mb-6">
      {/* 前回の引継ぎ */}
      {lastSession && lastSession.handover && (
        <div className="px-4 py-3 bg-white border border-gray-200 rounded-xl">
          <div className="flex items-center gap-2 mb-1">
            <MessageSquare className="w-3.5 h-3.5 text-gray-400" />
            <span className="text-[11px] font-semibold text-gray-500">前回の引継ぎ</span>
            <span className="text-[11px] text-gray-400">
              {lastSession.session_date?.replace(/-/g, '/')} {lastSession.teacher_name}
            </span>
          </div>
          <p className="text-sm text-gray-800">{lastSession.handover}</p>
        </div>
      )}

      {/* セッション一覧 */}
      <div className="space-y-2">
        {sessions.map((session, idx) => {
          const isExpanded = expandedId === session.id;
          const isActive = activeIdx === idx;
          const hasIssue = session.homeworkNotDone || session.tardy;
          const schoolItems = schoolUnitsForSession(session);
          const lessonItems = lessonUnitsForSession(session);
          const isFilled = session.teacherName && schoolItems.length > 0 && session.handover;
          // 教室長以上は保存済みでも再編集可能
          const isLocked = session.saved && !canEditSaved;

          return (
            <div
              key={session.id}
              className={`rounded-xl border overflow-hidden transition-colors ${
                isLocked
                  ? 'border-gray-200 bg-gray-50 opacity-75'
                  : hasIssue
                    ? 'border-amber-400 bg-amber-50/30'
                    : isActive
                      ? 'border-[#1e3a5f] ring-1 ring-[#1e3a5f]/20 bg-white'
                      : 'border-gray-200 bg-white'
              }`}
            >
              {/* アコーディオンヘッダー */}
              <button
                onClick={() => {
                  setExpandedId(isExpanded ? null : session.id);
                  setActiveIdx(idx);
                }}
                className="w-full px-4 py-3 flex items-center gap-3 hover:bg-gray-50/50 transition-colors"
              >
                <div
                  className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold ${
                    isLocked
                      ? 'bg-green-100 text-green-700'
                      : hasIssue
                        ? 'bg-amber-500 text-white'
                        : isActive
                          ? 'bg-[#1e3a5f] text-white'
                          : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {isLocked ? <Check className="w-4 h-4" /> : idx + 1}
                </div>
                <div className="flex-1 text-left">
                  <div className="text-sm font-medium">
                    {session.date.replace(/-/g, '/')}
                    {session.teacherName && (
                      <span className="ml-2 text-gray-500">{session.teacherName}</span>
                    )}
                    {session.saved && (
                      <span className={`ml-2 text-xs font-medium ${isLocked ? 'text-green-600' : 'text-blue-600'}`}>
                        {isLocked ? '保存済' : '保存済（編集中）'}
                      </span>
                    )}
                  </div>
                  {session.handover && (
                    <div className="text-xs text-gray-500 truncate max-w-md">
                      引継: {session.handover}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {session.homeworkNotDone && (
                    <span className="px-1.5 py-0.5 text-[10px] bg-amber-200 text-amber-900 rounded font-medium">
                      宿未
                    </span>
                  )}
                  {session.tardy && (
                    <span className="px-1.5 py-0.5 text-[10px] bg-amber-200 text-amber-900 rounded font-medium">
                      遅刻
                    </span>
                  )}
                  {isFilled ? (
                    <Check className="w-4 h-4 text-[#1e3a5f]" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-amber-500" />
                  )}
                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4 text-gray-400" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-gray-400" />
                  )}
                </div>
              </button>

              {/* 展開コンテンツ */}
              {isExpanded && (
                <div className="border-t border-gray-200 px-4 py-3 space-y-3 bg-white">
                  {/* 日付 / 講師名 */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-semibold text-gray-500">
                        指導日 <span className="text-amber-600">*</span>
                      </label>
                      <input
                        type="date"
                        value={session.date}
                        onChange={e => updateField(idx, { date: e.target.value })}
                        disabled={isLocked}
                        className="mt-1 w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg disabled:bg-gray-100"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-gray-500">
                        講師名 <span className="text-amber-600">*</span>
                      </label>
                      <div className="mt-1 flex gap-1">
                        <input
                          value={session.teacherName}
                          onChange={e => updateField(idx, { teacherName: e.target.value })}
                          placeholder="講師名"
                          disabled={isLocked}
                          className="flex-1 px-2 py-1.5 text-sm border border-gray-200 rounded-lg disabled:bg-gray-100"
                        />
                        <button
                          onClick={() => updateField(idx, { teacherName: myName })}
                          disabled={isLocked}
                          className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg border border-gray-200 whitespace-nowrap disabled:opacity-50"
                        >
                          自分
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* 学校進度（自動反映） */}
                  <div>
                    <label className="text-[10px] font-semibold text-gray-500">
                      学校進度 <span className="text-amber-600">*</span>
                      <span className="text-gray-400 font-normal ml-1">
                        下の表で学校列をクリック
                      </span>
                    </label>
                    <div className="mt-1 min-h-[32px] px-2 py-1.5 border border-gray-200 rounded-lg bg-gray-50 flex flex-wrap gap-1">
                      {schoolItems.length === 0 ? (
                        <span className="text-xs text-gray-400">
                          下の表で学校列をクリックすると反映されます
                        </span>
                      ) : (
                        schoolItems.map(u => (
                          <span
                            key={u.id}
                            className="px-2 py-0.5 text-[11px] bg-white border border-gray-200 rounded text-gray-700"
                          >
                            {u.item_number ?? ''} {u.title ?? ''}
                          </span>
                        ))
                      )}
                    </div>
                  </div>

                  {/* 指導単元（自動反映） */}
                  <div>
                    <label className="text-[10px] font-semibold text-gray-500">
                      指導単元
                      <span className="text-gray-400 font-normal ml-1">
                        下の表で指導列をクリック
                      </span>
                    </label>
                    <div className="mt-1 min-h-[32px] px-2 py-1.5 border border-gray-200 rounded-lg bg-gray-50 flex flex-wrap gap-1">
                      {lessonItems.length === 0 ? (
                        <span className="text-xs text-gray-400">
                          下の表で指導列をクリックすると反映されます
                        </span>
                      ) : (
                        lessonItems.map(({ item, lessonNumber }) => (
                          <span
                            key={item.id}
                            className="px-2 py-0.5 text-[11px] bg-white border border-gray-200 rounded text-gray-700"
                          >
                            {item.item_number ?? ''} {item.title ?? ''}{' '}
                            <span className="text-gray-400">({lessonNumber}回目)</span>
                          </span>
                        ))
                      )}
                    </div>
                  </div>

                  {/* 引継ぎ */}
                  <div>
                    <label className="text-[10px] font-semibold text-gray-500">
                      引継ぎ <span className="text-amber-600">*</span>
                    </label>
                    <textarea
                      value={session.handover}
                      onChange={e => updateField(idx, { handover: e.target.value })}
                      placeholder="次の講師への引継ぎを入力..."
                      disabled={isLocked}
                      rows={2}
                      className="mt-1 w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg resize-none disabled:bg-gray-100"
                    />
                  </div>

                  {/* フラグ */}
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={session.homeworkNotDone}
                        onChange={e => updateField(idx, { homeworkNotDone: e.target.checked })}
                        disabled={isLocked}
                        className="rounded border-gray-300"
                      />
                      <span className={session.homeworkNotDone ? 'text-amber-700 font-medium' : 'text-gray-600'}>
                        宿題未提出
                      </span>
                    </label>
                    <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={session.tardy}
                        onChange={e => updateField(idx, { tardy: e.target.checked })}
                        disabled={isLocked}
                        className="rounded border-gray-300"
                      />
                      <span className={session.tardy ? 'text-amber-700 font-medium' : 'text-gray-600'}>
                        遅刻
                      </span>
                    </label>
                  </div>

                  {/* 保存ボタン */}
                  {!isLocked && (
                    <button
                      onClick={() => saveSession(idx)}
                      disabled={saving}
                      className="w-full py-2 bg-[#1e3a5f] text-white text-sm font-medium rounded-lg hover:bg-[#2a4a6f] disabled:opacity-50 transition-colors"
                    >
                      {saving ? '保存中...' : session.saved ? '修正を保存' : 'セッションを保存'}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* コマ追加ボタン */}
      <button
        onClick={addSession}
        className="w-full py-2 border border-dashed border-gray-300 rounded-xl text-sm text-gray-500 hover:bg-gray-50 hover:border-gray-400 flex items-center justify-center gap-1.5 transition-colors"
      >
        <Plus className="w-4 h-4" />
        もう1コマ追加
      </button>
    </div>
  );
});

export default SessionRecordingPanel;

/**
 * 親コンポーネントから呼べるハンドラ型
 * 進行表セルクリック時に SessionRecordingPanel へイベントを伝播するため
 */
export type SessionCellToggleHandler = (
  curriculumItemId: number,
  column: 'school' | 1 | 2 | 3
) => void;
