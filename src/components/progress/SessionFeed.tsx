'use client';

/**
 * SessionFeed — 教室長UI: 進行セッションの確認フィード
 *
 * 機能:
 * - 未確認カードをスワイプ（or ボタン）で確認 → 右の書類トレイへ飛ぶアニメーション
 * - インライン編集（引継ぎ・宿題/遅刻フラグ）
 * - フィルタ（すべて / 要注意 / 未確認 / 確認済）+ 日付レンジ + 生徒絞り込み
 * - 生徒名クリック → その生徒だけのフィード表示
 * - スマートアラート
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Archive,
  Calendar,
  Check,
  ChevronDown,
  ChevronUp,
  Circle,
  CircleCheck,
  GraduationCap,
  Pencil,
  RefreshCw,
  Search,
  Target,
  X,
} from 'lucide-react';
import { Loading } from '@/components/ui';
import { useAuth } from '@/contexts/AuthContext';
import {
  getSessionFeed,
  getSmartAlerts,
  confirmProgressSession,
  unconfirmProgressSession,
  updateProgressSession,
  syncSessionToProgress,
} from '@/lib/api/progress-sessions';
import type {
  SmartAlert,
  SessionFeedFilter,
  FeedGoalSummary,
  SchoolProgressUnit,
} from '@/lib/api/progress-sessions';
import {
  getFeedGoalsByTextbooks,
  getSchoolProgressUnitsByTextbooks,
} from '@/lib/api/progress-sessions';
import type { ProgressSessionWithDetails } from '@/types/database';
import { toSurnameOnly } from '@/lib/utils/teacherName';

// ─── 定数 ───

type TabKey = 'unconfirmed' | 'all' | 'alerts' | 'confirmed';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'unconfirmed', label: '未確認' },
  { key: 'all', label: 'すべて' },
  { key: 'alerts', label: '要注意' },
  { key: 'confirmed', label: '確認済' },
];

// 確認アニメーションのタイムライン（globals.css の session-* keyframes と一致させること）:
// 折りたたみ 0–380ms / 放物線飛行 300–980ms（60ms 重ねて畳み終わりから滑らかに射出）/
// 980ms で着地 → トレイの受け止めバウンド + カード除去。
const CONFIRM_FLY_TOTAL_MS = 980;

// ─── メインコンポーネント ───

interface Props {
  schoolIds?: string[];
}

export default function SessionFeed({ schoolIds: propSchoolIds }: Props) {
  const { schoolIds: allSchoolIds, selectedSchoolId, profile } = useAuth();
  const isTeacher = profile?.role === 'teacher';

  const schoolIds = useMemo(() => {
    if (propSchoolIds) return propSchoolIds;
    if (selectedSchoolId === 'all' || !selectedSchoolId) return allSchoolIds;
    return [selectedSchoolId];
  }, [propSchoolIds, allSchoolIds, selectedSchoolId]);
  const schoolIdsKey = schoolIds.join(',');

  // ── State ──
  const [sessions, setSessions] = useState<ProgressSessionWithDetails[]>([]);
  const [smartAlerts, setSmartAlerts] = useState<SmartAlert[]>([]);
  // 目標 / 行動目標サマリ: student_textbook_id をキーに表示用情報を保持
  const [goalMap, setGoalMap] = useState<Record<string, FeedGoalSummary>>({});
  // 学校進度がついている単元: student_textbook_id をキーに保持（確認カードの学校単元行に使う）
  const [schoolUnitMap, setSchoolUnitMap] = useState<Record<string, SchoolProgressUnit[]>>({});
  const [tab, setTab] = useState<TabKey>('unconfirmed');
  const [loading, setLoading] = useState(true);
  const [alertsExpanded, setAlertsExpanded] = useState(true);

  // フィルタ
  const [studentFilter, setStudentFilter] = useState<string | null>(null);
  const [studentFilterName, setStudentFilterName] = useState<string>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // 確認済みトレイに飛んだカードID（アニメーション制御）
  const [flyingIds, setFlyingIds] = useState<Set<string>>(new Set());
  // 確認済みトレイの展開
  const [trayOpen, setTrayOpen] = useState(false);
  // カードがトレイに着地した回数（トレイの受け止めバウンド + カウント即時反映のトリガー）
  const [trayCatchSignal, setTrayCatchSignal] = useState(0);

  // ── スマートアラート取得（タブ・フィルタと独立、schoolIds 変更時のみ再取得） ──
  useEffect(() => {
    if (schoolIds.length === 0) {
      setSmartAlerts([]);
      return;
    }
    getSmartAlerts(schoolIds).then(setSmartAlerts).catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolIdsKey]);

  // ── セッション取得（タブ・フィルタ変更時に再取得） ──
  const loadSessions = useCallback(async () => {
    if (schoolIds.length === 0) {
      setSessions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const filter: SessionFeedFilter = {};
      if (tab === 'alerts') filter.alertsOnly = true;
      if (tab === 'confirmed') filter.confirmedOnly = true;
      if (tab === 'unconfirmed') filter.unconfirmedOnly = true;
      if (studentFilter) filter.studentId = studentFilter;
      if (dateFrom) filter.dateFrom = dateFrom;
      if (dateTo) filter.dateTo = dateTo;

      const data = await getSessionFeed(schoolIds, filter);
      setSessions(data);

      // 目標 / 行動目標を一括取得（student_textbook_id 単位、重複除外）
      const textbookIds = Array.from(
        new Set(data.map((s) => s.student_textbook?.id).filter((v): v is string => !!v))
      );
      if (textbookIds.length > 0) {
        getFeedGoalsByTextbooks(textbookIds)
          .then(setGoalMap)
          .catch((e) => {
            console.error('Failed to fetch feed goals:', e);
            setGoalMap({});
          });
        getSchoolProgressUnitsByTextbooks(textbookIds)
          .then(setSchoolUnitMap)
          .catch((e) => {
            console.error('Failed to fetch school progress units:', e);
            setSchoolUnitMap({});
          });
      } else {
        setGoalMap({});
        setSchoolUnitMap({});
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolIdsKey, tab, studentFilter, dateFrom, dateTo]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // ── 全データ更新（更新ボタン用） ──
  const refreshAll = useCallback(() => {
    if (schoolIds.length === 0) return;
    getSmartAlerts(schoolIds).then(setSmartAlerts).catch(console.error);
    loadSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolIdsKey, loadSessions]);

  // ── 確認ハンドラ ──
  const handleConfirm = useCallback(
    async (sessionId: string) => {
      if (!profile?.id) return;
      setFlyingIds((prev) => new Set(prev).add(sessionId));

      try {
        await confirmProgressSession(sessionId, profile.id);
      } catch (e) {
        console.error(e);
      }

      // 着地のタイミングでリストから除去し、トレイに受け止めさせる
      setTimeout(() => {
        setSessions((prev) => prev.filter((s) => s.id !== sessionId));
        setFlyingIds((prev) => {
          const next = new Set(prev);
          next.delete(sessionId);
          return next;
        });
        setTrayCatchSignal((n) => n + 1);
      }, CONFIRM_FLY_TOTAL_MS);
    },
    [profile?.id]
  );

  const handleUnconfirm = useCallback(async (sessionId: string) => {
    try {
      await unconfirmProgressSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    } catch (e) {
      console.error(e);
    }
  }, []);

  // ── インライン編集 ──
  const handleInlineUpdate = useCallback(
    async (
      sessionId: string,
      patch: { handover?: string | null; homework_not_done?: boolean; tardy?: boolean }
    ) => {
      try {
        await updateProgressSession(sessionId, patch);
        // student_progress 側にも逆方向同期
        syncSessionToProgress(sessionId, patch).catch(console.error);
        // local state 更新
        setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, ...patch } : s)));
      } catch (e) {
        console.error(e);
      }
    },
    []
  );

  // ── 生徒クリック → フィルタ ──
  const handleStudentClick = useCallback(
    (studentId: string, name: string) => {
      if (studentFilter === studentId) {
        setStudentFilter(null);
        setStudentFilterName('');
      } else {
        setStudentFilter(studentId);
        setStudentFilterName(name);
      }
    },
    [studentFilter]
  );

  // トレイの参照位置（アニメーション先）
  const trayRef = useRef<HTMLDivElement>(null);

  return (
    <div className="space-y-4">
      {/* スマートアラート */}
      {smartAlerts.length > 0 && (
        <SmartAlertBoard
          alerts={smartAlerts}
          expanded={alertsExpanded}
          onToggle={() => setAlertsExpanded((v) => !v)}
        />
      )}

      {/* フィルタバー */}
      <div className="space-y-2">
        {/* タブ + 更新 */}
        <div className="flex items-center justify-between">
          <div className="flex gap-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-3 py-1.5 text-sm rounded-lg transition-[background-color,color] duration-150 ease-out active:scale-[0.97] ${
                  tab === t.key
                    ? 'bg-[#1e3a5f] text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button
            onClick={refreshAll}
            disabled={loading}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50"
            title="更新"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* 日付 + 生徒フィルタ */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5 text-gray-400" />
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="px-2 py-1 text-xs border border-gray-200 rounded-lg bg-white"
              placeholder="開始日"
            />
            <span className="text-xs text-gray-400">〜</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="px-2 py-1 text-xs border border-gray-200 rounded-lg bg-white"
              placeholder="終了日"
            />
          </div>
          {studentFilter && (
            <button
              onClick={() => {
                setStudentFilter(null);
                setStudentFilterName('');
              }}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-[#1e3a5f] text-white rounded-lg active:scale-[0.97]"
            >
              <Search className="w-3 h-3" />
              {studentFilterName}
              <X className="w-3 h-3 hover:bg-white/20 rounded-full" />
            </button>
          )}
          {(dateFrom || dateTo) && (
            <button
              onClick={() => {
                setDateFrom('');
                setDateTo('');
              }}
              className="px-2 py-1 text-xs text-gray-400 hover:text-gray-600 hover:underline rounded"
            >
              日付クリア
            </button>
          )}
        </div>
      </div>

      {/* 2カラム: フィード + 確認済トレイ（常時表示で統一レイアウト） */}
      <div className="flex gap-4">
        {/* 左: フィードリスト */}
        <div className="flex-1 min-w-0">
          {loading && sessions.length === 0 ? (
            <Loading size="md" />
          ) : sessions.length === 0 ? (
            <div className="py-16 text-center">
              <Archive className="w-8 h-8 text-gray-300 mx-auto mb-3" />
              <p className="text-sm text-gray-500">
                {tab === 'alerts'
                  ? '要注意のセッションはありません'
                  : tab === 'confirmed'
                    ? '確認済みのセッションはありません'
                    : tab === 'unconfirmed'
                      ? '未確認のセッションはありません'
                      : 'セッションがありません'}
              </p>
              <p className="text-xs text-gray-400 mt-1">条件を変更して再検索してください</p>
            </div>
          ) : (
            <div className="space-y-2">
              {sessions.map((session, index) => (
                <SwipeableCard
                  key={session.id}
                  session={session}
                  staggerIndex={index}
                  isTeacher={isTeacher}
                  isFlying={flyingIds.has(session.id)}
                  showConfirmAction={tab !== 'confirmed'}
                  showUnconfirmAction={tab === 'confirmed'}
                  onConfirm={() => handleConfirm(session.id)}
                  onUnconfirm={() => handleUnconfirm(session.id)}
                  onInlineUpdate={(patch) => handleInlineUpdate(session.id, patch)}
                  onStudentClick={handleStudentClick}
                  trayRef={trayRef}
                  goal={
                    session.student_textbook?.id ? goalMap[session.student_textbook.id] : undefined
                  }
                  schoolUnits={
                    session.student_textbook?.id
                      ? schoolUnitMap[session.student_textbook.id]
                      : undefined
                  }
                />
              ))}
            </div>
          )}
        </div>

        {/* 右: 確認済みトレイ（全タブ共通） */}
        <ConfirmedTray
          ref={trayRef}
          schoolIds={schoolIds}
          open={trayOpen}
          onToggle={() => setTrayOpen((v) => !v)}
          catchSignal={trayCatchSignal}
        />
      </div>
    </div>
  );
}

// ─── スワイプ可能カード ───

interface SwipeableCardProps {
  session: ProgressSessionWithDetails;
  isTeacher: boolean;
  isFlying: boolean;
  showConfirmAction: boolean;
  showUnconfirmAction: boolean;
  onConfirm: () => void;
  onUnconfirm: () => void;
  onInlineUpdate: (patch: {
    handover?: string | null;
    homework_not_done?: boolean;
    tardy?: boolean;
  }) => void;
  onStudentClick: (studentId: string, name: string) => void;
  trayRef: React.RefObject<HTMLDivElement | null>;
  /** 目標 / 行動目標サマリ（カード表示用、未取得時 undefined） */
  goal?: FeedGoalSummary;
  /** 学校進度がついている単元（学校単元行に表示） */
  schoolUnits?: SchoolProgressUnit[];
  /** stagger animation index */
  staggerIndex?: number;
}

function SwipeableCard({
  session,
  isTeacher,
  isFlying,
  showConfirmAction,
  showUnconfirmAction,
  onConfirm,
  onUnconfirm,
  onInlineUpdate,
  onStudentClick,
  trayRef,
  goal,
  schoolUnits,
  staggerIndex = 0,
}: SwipeableCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [dragX, setDragX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const startX = useRef(0);
  const dragStartTime = useRef<number>(0);

  // ── スワイプジェスチャー ──
  const handlePointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('[data-no-swipe]')) return;
    startX.current = e.clientX;
    dragStartTime.current = Date.now();
    setIsDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - startX.current;
    setDragX(dx);
  };

  const handlePointerUp = () => {
    if (!isDragging) return;
    setIsDragging(false);
    // 距離閾値 or velocity 閾値（素早いフリック対応）
    const elapsed = Date.now() - dragStartTime.current;
    const velocity = Math.abs(dragX) / elapsed;
    if (dragX > 0 && (dragX > 150 || velocity > 0.11) && showConfirmAction) {
      onConfirm();
    }
    setDragX(0);
  };

  // スワイプ方向に応じた背景色のヒント
  const swipeHintOpacity = Math.min(Math.abs(dragX) / 200, 0.5);
  const swipeIsRight = dragX > 0;
  const rotation = isDragging ? dragX * 0.02 : 0;

  // 飛行ジオメトリ: isFlying に切り替わったレンダー中に「fixed 化される前の」
  // DOM からカード位置とトレイ位置を測る（レンダー中の getBoundingClientRect は
  // コミット前の旧レイアウトを読める、という性質を意図的に使うパターン）。
  const flyGeom = useMemo(() => {
    if (!isFlying) return null;
    const rect = cardRef.current?.getBoundingClientRect();
    if (!rect) return null;
    // フォールバック軌道（トレイ非表示 = スマホ幅など）: 右上へ放り投げる
    let dx = 320;
    let dy = -40;
    const trayRect = trayRef.current?.getBoundingClientRect();
    if (trayRect && trayRect.width > 0) {
      // 着地点はトレイヘッダー（Archive アイコン付近）
      dx = trayRect.left + trayRect.width / 2 - (rect.left + rect.width / 2);
      dy = trayRect.top + 32 - (rect.top + rect.height / 2);
    }
    // 放物線の頂点: 始点・着地点の高い方からさらに持ち上げる（飛距離に応じて 90〜170px）。
    // ただし画面上端付近のカードで弧が画面外へ突き抜けないよう、上方向の余白でクランプ。
    const higherEndY = rect.top + rect.height / 2 + Math.min(dy, 0);
    const headroom = Math.max(32, higherEndY - 16);
    const lift = Math.min(Math.max(90, Math.min(170, Math.abs(dx) * 0.2)), headroom);
    const peak = Math.min(dy, 0) - lift;
    return { rect, dx, dy, peak };
  }, [isFlying, trayRef]);

  // ── 飛行中: fixed のゴーストが折りたたみ → 放物線でトレイへ。
  // レイアウト上の行は .session-slot が高さを閉じて下のカードを詰める。
  // 軸ごとに要素を分離: Y(放物線) > X(直線) > 縮小回転 > 折りたたみ の入れ子で、
  // translate 距離がスケールの影響を受けず、回転が非等方スケールで歪まない。
  if (isFlying && flyGeom) {
    const { rect, dx, dy, peak } = flyGeom;
    return (
      <div
        className="session-slot"
        style={{ height: rect.height, ['--slot-h' as string]: `${rect.height}px` }}
      >
        <div
          className="session-ghost"
          style={{
            left: rect.left,
            top: rect.top,
            width: rect.width,
            ['--fly-dx' as string]: `${dx}px`,
            ['--fly-dy' as string]: `${dy}px`,
            ['--fly-peak' as string]: `${peak}px`,
          }}
        >
          <div className="session-fly-y">
            <div className="session-fly-x">
              <div className="session-shrink">
                <div className="session-fold">
                  <FeedCard
                    session={session}
                    isTeacher={isTeacher}
                    showConfirmAction={showConfirmAction}
                    showUnconfirmAction={showUnconfirmAction}
                    onConfirm={onConfirm}
                    onUnconfirm={onUnconfirm}
                    onInlineUpdate={onInlineUpdate}
                    onStudentClick={onStudentClick}
                    goal={goal}
                    schoolUnits={schoolUnits}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={cardRef}
      className="relative feed-card-enter"
      style={{
        transform: isDragging ? `translateX(${dragX}px) rotate(${rotation}deg)` : undefined,
        transition: isDragging ? 'none' : 'transform 200ms cubic-bezier(0.23, 1, 0.32, 1)',
        // stagger: 最初の10枚のみ（それ以降は delay 不要）
        animationDelay: staggerIndex < 10 ? `${staggerIndex * 40}ms` : undefined,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {/* スワイプヒント背景 */}
      {isDragging && swipeIsRight && (
        <div
          className="absolute inset-0 rounded-xl bg-green-500/80 backdrop-blur-sm flex items-center justify-start pl-6"
          style={{ opacity: swipeHintOpacity }}
        >
          <Check className="w-8 h-8 text-white" />
          <span className="ml-2 text-white font-bold text-sm">確認</span>
        </div>
      )}

      <FeedCard
        session={session}
        isTeacher={isTeacher}
        showConfirmAction={showConfirmAction}
        showUnconfirmAction={showUnconfirmAction}
        onConfirm={onConfirm}
        onUnconfirm={onUnconfirm}
        onInlineUpdate={onInlineUpdate}
        onStudentClick={onStudentClick}
        goal={goal}
        schoolUnits={schoolUnits}
      />
    </div>
  );
}

// ─── フィードカード（表示 + インライン編集） ───

interface FeedCardProps {
  session: ProgressSessionWithDetails;
  isTeacher: boolean;
  showConfirmAction: boolean;
  showUnconfirmAction: boolean;
  onConfirm: () => void;
  onUnconfirm: () => void;
  onInlineUpdate: (patch: {
    handover?: string | null;
    homework_not_done?: boolean;
    tardy?: boolean;
  }) => void;
  onStudentClick: (studentId: string, name: string) => void;
  /** コンパクト表示（ミニフィード用） */
  compact?: boolean;
  /** 目標 / 行動目標サマリ */
  goal?: FeedGoalSummary;
  /** 学校進度がついている単元（進行表の学校進度列由来）。学校単元行に表示 */
  schoolUnits?: SchoolProgressUnit[];
}

function FeedCard({
  session,
  isTeacher,
  showConfirmAction,
  showUnconfirmAction,
  onConfirm,
  onUnconfirm,
  onInlineUpdate,
  onStudentClick,
  compact,
  goal,
  schoolUnits = [],
}: FeedCardProps) {
  const hasIssue = session.homework_not_done || session.tardy;
  const [editing, setEditing] = useState(false);
  const [editHandover, setEditHandover] = useState(session.handover || '');

  const st = session.student_textbook;
  const studentName = st?.student ? `${st.student.last_name} ${st.student.first_name}` : '—';
  const studentId = st?.student?.id;
  const textbookName = st?.textbook?.name || '—';

  const displayTeacher = session.teacher_name
    ? isTeacher
      ? toSurnameOnly(session.teacher_name)
      : session.teacher_name
    : null;

  const lessonUnits = useMemo(() => {
    if (!session.lessons || session.lessons.length === 0) return [];
    return session.lessons
      .filter((l) => l.student_progress?.curriculum_item)
      .sort((a, b) => (a.lesson_number ?? 0) - (b.lesson_number ?? 0))
      .map((l) => {
        const sp = l.student_progress!;
        const ci = sp.curriculum_item!;
        return {
          label: `${ci.item_number ?? ''} ${ci.title ?? ''}`.trim(),
          lessonNumber: l.lesson_number,
          schoolProgressDate: sp.school_progress_date ?? null,
        };
      });
  }, [session.lessons]);

  // 指導単元の回数（1回目/2回目…）。全単元が同じ回なら見出しに1回だけ出し、
  // 混在するときだけ各単元に「（N回目）」を付ける（②の仕様）
  const uniformLesson = useMemo(() => {
    const nums = new Set(lessonUnits.map((u) => u.lessonNumber));
    return nums.size === 1 ? (lessonUnits[0]?.lessonNumber ?? null) : null;
  }, [lessonUnits]);

  const isConfirmed = !!session.confirmed_at;

  const handleSaveEdit = () => {
    onInlineUpdate({ handover: editHandover || null });
    setEditing(false);
  };

  // 左ラベル列付きの行（ラベル / 内容）。案A の見出し行に共通で使う
  const labelCls = 'w-16 shrink-0 text-[11px] text-gray-400 pt-0.5';

  // 本文セクション（目標＋行動目標 / 指導＋学校単元 / 引継ぎ）。存在するものだけを並べ、
  // 各セクションの上に細い罫線を引いてヘッダーと区切る（案A: 線で仕切る）。
  const sections: React.ReactNode[] = [];

  if (!compact && (goal?.exam || (goal && goal.totalCount > 0))) {
    sections.push(
      <div key="goal" className="flex flex-col gap-2">
        {goal?.exam && (
          <div className="flex gap-3">
            <div className={labelCls}>目標</div>
            <div className="flex-1 text-[13px] text-gray-800">
              {goal.exam.label}
              {goal.exam.examDate && (
                <span className="text-gray-400"> ({goal.exam.examDate.replace(/-/g, '/')})</span>
              )}
              {goal.exam.targetScore != null && <span> · 目標 {goal.exam.targetScore}点</span>}
            </div>
          </div>
        )}
        {goal && goal.totalCount > 0 && (
          <div className="flex gap-3">
            <div className={labelCls}>
              行動目標{' '}
              <span className="text-gray-400">
                {goal.achievedCount}/{goal.totalCount}
              </span>
            </div>
            <div className="flex-1 flex flex-col gap-0.5 text-[13px] text-gray-800">
              {goal.actionGoals.map((g) => (
                <div key={g.id} className="flex items-start gap-1.5">
                  {g.achieved ? (
                    <CircleCheck className="w-3.5 h-3.5 text-green-600 mt-0.5 shrink-0" />
                  ) : (
                    <Circle className="w-3.5 h-3.5 text-gray-300 mt-0.5 shrink-0" />
                  )}
                  <span className={g.achieved ? 'text-gray-400 line-through' : ''}>{g.title}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (lessonUnits.length > 0) {
    sections.push(
      <div key="units" className="flex flex-col gap-2">
        <div className="flex gap-3">
          <div className={labelCls}>
            指導単元
            {uniformLesson != null && <span className="text-gray-400"> {uniformLesson}回目</span>}
          </div>
          <div className="flex-1 text-[13px] text-gray-800 leading-relaxed">
            {lessonUnits.map((u, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span className="text-gray-300"> · </span>}
                {u.label}
                {uniformLesson == null && (
                  <span className="text-gray-400">（{u.lessonNumber}回目）</span>
                )}
              </React.Fragment>
            ))}
          </div>
        </div>
        {!compact && (
          <div className="flex gap-3">
            <div className="w-16 shrink-0 pt-0.5 text-[11px] text-[#1e40af] flex items-center gap-1">
              <GraduationCap className="w-3 h-3" aria-hidden="true" /> 学校
            </div>
            <div className="flex-1 text-[13px] leading-relaxed">
              {schoolUnits.length > 0 ? (
                schoolUnits.map((u, i) => (
                  <React.Fragment key={u.curriculumItemId}>
                    {i > 0 && <span className="text-gray-300"> · </span>}
                    <span className="text-gray-800">{u.label}</span>
                  </React.Fragment>
                ))
              ) : (
                <span className="text-gray-400">なし</span>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  sections.push(
    editing ? (
      <div key="handover" className="flex gap-3" data-no-swipe>
        <div className="w-16 shrink-0 pt-1 text-[11px] text-gray-400">引継ぎ</div>
        <div className="flex-1 space-y-2">
          <textarea
            value={editHandover}
            onChange={(e) => setEditHandover(e.target.value)}
            rows={2}
            className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg resize-none focus:border-[#1e3a5f] outline-none"
            placeholder="引継ぎ..."
          />
          <div className="flex gap-1 justify-end">
            <button
              onClick={() => setEditing(false)}
              className="px-3 py-1 text-xs text-gray-500 hover:bg-gray-100 rounded-lg active:scale-[0.97]"
            >
              キャンセル
            </button>
            <button
              onClick={handleSaveEdit}
              className="px-3 py-1 text-xs bg-[#1e3a5f] text-white rounded-lg hover:bg-[#2a4a6f] active:scale-[0.97]"
            >
              保存
            </button>
          </div>
        </div>
      </div>
    ) : (
      <div key="handover" className="flex gap-3">
        <div className={labelCls}>引継ぎ</div>
        <div className="flex-1 text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
          {session.handover || <span className="text-gray-400">—</span>}
        </div>
      </div>
    )
  );

  return (
    <div
      className={`rounded-xl border p-4 ${
        isConfirmed ? 'border-green-200 bg-green-50/30' : 'border-gray-200 bg-white'
      } ${compact ? 'p-3' : ''}`}
    >
      {/* ヘッダー: 生徒名 / 教材 / 日付・講師 / アクション */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {studentId ? (
            <button
              data-no-swipe
              onClick={(e) => {
                e.stopPropagation();
                onStudentClick(studentId, studentName);
              }}
              className="text-sm font-semibold text-[#1e3a5f] hover:underline cursor-pointer"
            >
              {studentName}
            </button>
          ) : (
            <div className="text-sm font-semibold text-gray-900">{studentName}</div>
          )}
          <div className="text-xs text-gray-500">{textbookName}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="text-xs text-gray-500 whitespace-nowrap">
            {session.session_date?.replace(/-/g, '/')}
            {displayTeacher ? ` ${displayTeacher}` : ''}
          </div>
          {/* アクションボタン */}
          <div className="flex items-center gap-1" data-no-swipe>
            {!editing && !compact && (
              <button
                onClick={() => {
                  setEditing(true);
                  setEditHandover(session.handover || '');
                }}
                className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded active:scale-95"
                title="編集"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            )}
            {showConfirmAction && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onConfirm();
                }}
                className="p-1.5 text-green-500 hover:text-green-700 hover:bg-green-50 rounded-lg transition-[background-color,color] duration-150 ease-out active:scale-95"
                title="確認"
              >
                <Check className="w-4 h-4" />
              </button>
            )}
            {showUnconfirmAction && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onUnconfirm();
                }}
                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-[background-color,color] duration-150 ease-out active:scale-95"
                title="確認を戻す"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 要注意（宿題未提出・遅刻）。編集中はチェックで切替、通常時は琥珀の注意バーだけ目立たせる */}
      {editing ? (
        <div className="flex items-center gap-2 mt-2" data-no-swipe>
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
          <label className="flex items-center gap-1 text-[11px] cursor-pointer">
            <input
              type="checkbox"
              checked={session.homework_not_done}
              onChange={(e) => onInlineUpdate({ homework_not_done: e.target.checked })}
              className="w-3 h-3 accent-amber-600 rounded"
            />
            宿題未提出
          </label>
          <label className="flex items-center gap-1 text-[11px] cursor-pointer">
            <input
              type="checkbox"
              checked={session.tardy}
              onChange={(e) => onInlineUpdate({ tardy: e.target.checked })}
              className="w-3 h-3 accent-amber-600 rounded"
            />
            遅刻
          </label>
        </div>
      ) : hasIssue ? (
        <div className="flex items-center gap-1.5 mt-2 px-2.5 py-1.5 bg-amber-50 border border-amber-300 rounded-lg">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
          <span className="text-[13px] font-medium text-amber-800">
            {[session.homework_not_done && '宿題未提出', session.tardy && '遅刻']
              .filter(Boolean)
              .join(' · ')}
          </span>
        </div>
      ) : null}

      {/* 本文セクション（各セクション上に罫線を引いて仕切る） */}
      <div>
        {sections.map((s, i) => (
          <div key={i} className="border-t border-gray-200 pt-2.5 mt-2.5">
            {s}
          </div>
        ))}
      </div>

      {/* 確認済みバッジ */}
      {isConfirmed && (
        <div className="mt-2 flex items-center gap-1 text-[10px] text-green-600">
          <Check className="w-3 h-3" />
          確認済み
        </div>
      )}

      {/* 詳細リンク */}
      {studentId && !compact && (
        <Link
          href={`/students/${studentId}/progress`}
          className="block mt-2 text-[11px] text-gray-400 hover:text-[#1e3a5f]"
          data-no-swipe
        >
          進行表を開く →
        </Link>
      )}
    </div>
  );
}

// ─── 確認済みトレイ ───

const ConfirmedTray = React.forwardRef<
  HTMLDivElement,
  {
    schoolIds: string[];
    open: boolean;
    onToggle: () => void;
    /** カード着地のたびにインクリメントされる（受け止めバウンドのトリガー） */
    catchSignal: number;
  }
>(function ConfirmedTray({ schoolIds, open, onToggle, catchSignal }, ref) {
  const [sessions, setSessions] = useState<ProgressSessionWithDetails[]>([]);
  const [count, setCount] = useState(0);
  const [catching, setCatching] = useState(false);

  // カードが着地したら: カウントを即時反映し、トレイを沈み込ませて受け止める。
  // 展開中なら中身も取り直して、投げ込んだカードがトレイ内に現れるようにする。
  useEffect(() => {
    if (catchSignal === 0) return;
    setCount((c) => c + 1);
    setCatching(true);
    const timer = setTimeout(() => setCatching(false), 450);
    if (open && schoolIds.length > 0) {
      getSessionFeed(schoolIds, { confirmedOnly: true }, 20).then(setSessions).catch(console.error);
    }
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catchSignal]);

  useEffect(() => {
    if (!open || schoolIds.length === 0) return;
    getSessionFeed(schoolIds, { confirmedOnly: true }, 20)
      .then((data) => {
        setSessions(data);
        setCount(data.length);
      })
      .catch(console.error);
  }, [open, schoolIds]);

  // 未展開時もカウントだけ取得
  useEffect(() => {
    if (schoolIds.length === 0) return;
    getSessionFeed(schoolIds, { confirmedOnly: true }, 1)
      .then((data) => {
        // ヘッダー用のカウントはフルフェッチせず概算
        if (data.length > 0) setCount(data.length);
      })
      .catch(console.error);
  }, [schoolIds]);

  return (
    <div ref={ref} className="w-64 shrink-0 hidden lg:block">
      <div className={`sticky top-4 ${catching ? 'tray-catch' : ''}`}>
        {/* トレイヘッダー */}
        <button
          onClick={onToggle}
          className="w-full flex items-center justify-between px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-t-xl hover:bg-gray-100 transition-[background-color] duration-150 ease-out active:scale-[0.99]"
        >
          <div className="flex items-center gap-2">
            <div className="relative">
              <Archive className="w-5 h-5 text-gray-500" />
              <div className="absolute -top-1 -right-1.5 min-w-[18px] h-[18px] bg-green-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center tabular-nums">
                {count || ''}
              </div>
            </div>
            <span className="text-sm font-medium text-gray-700">確認済み</span>
          </div>
          {open ? (
            <ChevronUp className="w-4 h-4 text-gray-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-400" />
          )}
        </button>

        {/* トレイ本体: CSS Grid で高さをアニメーション（max-height ハックより正確） */}
        <div
          className="border border-t-0 border-gray-200 rounded-b-xl bg-white grid transition-[grid-template-rows,opacity] duration-250 ease-out"
          style={{
            gridTemplateRows: open ? '1fr' : '0fr',
            opacity: open ? 1 : 0,
          }}
        >
          <div className="overflow-hidden min-h-0">
            {sessions.length === 0 ? (
              <div className="py-8 text-center text-xs text-gray-400">
                まだ確認済みのセッションはありません
              </div>
            ) : (
              <div className="p-2 space-y-1.5 max-h-[560px] overflow-y-auto">
                {sessions.map((s) => (
                  <TrayCard key={s.id} session={s} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

/** トレイ内のコンパクトカード */
function TrayCard({ session }: { session: ProgressSessionWithDetails }) {
  const st = session.student_textbook;
  const studentName = st?.student ? `${st.student.last_name} ${st.student.first_name}` : '—';
  const studentId = st?.student?.id;

  return (
    <Link
      href={studentId ? `/students/${studentId}/progress` : '#'}
      className="block px-2.5 py-2 rounded-lg border border-gray-100 bg-gray-50/50 hover:bg-white transition-[background-color] duration-150 ease-out"
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-gray-800 truncate">{studentName}</span>
        <span className="text-[10px] text-gray-400 shrink-0 ml-1">
          {session.session_date?.replace(/-/g, '/').slice(5)}
        </span>
      </div>
      {session.handover && (
        <p className="text-[10px] text-gray-500 truncate mt-0.5">{session.handover}</p>
      )}
      <div className="flex items-center gap-1 mt-0.5">
        <Check className="w-2.5 h-2.5 text-green-500" />
        <span className="text-[9px] text-green-600">確認済</span>
      </div>
    </Link>
  );
}

// ─── スマートアラートボード ───

const ALERT_CONFIG: Record<SmartAlert['type'], { icon: React.ReactNode; label: string }> = {
  school_catching_up: {
    icon: <GraduationCap className="w-4 h-4" />,
    label: '学校進度に追いつかれている',
  },
  exam_soon: {
    icon: <Calendar className="w-4 h-4" />,
    label: 'テストが近い',
  },
  no_exam_goal: {
    icon: <Target className="w-4 h-4" />,
    label: '目標未設定',
  },
};

function SmartAlertBoard({
  alerts,
  expanded,
  onToggle,
}: {
  alerts: SmartAlert[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const urgentCount = alerts.filter((a) => a.severity === 'urgent').length;

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/50 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-amber-50 transition-[background-color] duration-150 ease-out active:scale-[0.995]"
      >
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600" />
          <span className="text-sm font-semibold text-gray-900">注意事項</span>
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-amber-200 text-amber-900">
            {alerts.length}件
          </span>
          {urgentCount > 0 && (
            <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-red-200 text-red-900">
              緊急 {urgentCount}
            </span>
          )}
        </div>
        <span className="text-xs text-gray-400">{expanded ? '閉じる' : '開く'}</span>
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-1.5">
          {alerts.map((alert, i) => (
            <SmartAlertItem key={`${alert.type}-${alert.studentTextbookId}-${i}`} alert={alert} />
          ))}
        </div>
      )}
    </div>
  );
}

function SmartAlertItem({ alert }: { alert: SmartAlert }) {
  const config = ALERT_CONFIG[alert.type];
  const isUrgent = alert.severity === 'urgent';

  return (
    <Link href={`/students/${alert.studentId}/progress`} className="block">
      <div
        className={`flex items-start gap-3 px-3 py-2.5 rounded-lg transition-[background-color] duration-150 ease-out hover:bg-white ${
          isUrgent ? 'bg-red-50/60' : 'bg-white/60'
        }`}
      >
        <div
          className={`p-1.5 rounded shrink-0 mt-0.5 ${isUrgent ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'}`}
        >
          {config.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-gray-900">{alert.studentName}</span>
            <span className="text-[10px] text-gray-400">{alert.textbookName}</span>
          </div>
          <p className="text-xs text-gray-600 mt-0.5">{alert.detail}</p>
        </div>
        <span
          className={`px-1.5 py-0.5 text-[9px] font-bold rounded shrink-0 ${isUrgent ? 'bg-red-200 text-red-800' : 'bg-amber-200 text-amber-800'}`}
        >
          {config.label}
        </span>
      </div>
    </Link>
  );
}

// ─── Export: ミニフィード用の FeedCard ───

export { FeedCard };
export type { FeedCardProps };
