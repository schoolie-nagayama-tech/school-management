'use client';

/**
 * StudentSessionFeed — 生徒詳細ページ用のミニフィード
 *
 * 直近のセッションをコンパクト表示。進行表ページのカードビューに表示する。
 * FeedCard の compact モードを使い、インライン編集なしの読み取り専用。
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Clock, RefreshCw } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { getStudentSessionFeed } from '@/lib/api/progress-sessions';
import type { ProgressSessionWithDetails } from '@/types/database';
import { toSurnameOnly } from '@/lib/utils/teacherName';
import {
  SUBJECT_COLOR,
  categorizeSubject,
} from '@/app/students/[studentId]/progress/newProgress.shared';

interface Props {
  studentId: string;
  limit?: number;
}

export default function StudentSessionFeed({ studentId, limit = 5 }: Props) {
  const { profile } = useAuth();
  const isTeacher = profile?.role === 'teacher';

  const [sessions, setSessions] = useState<ProgressSessionWithDetails[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getStudentSessionFeed(studentId, limit);
      setSessions(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [studentId, limit]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && sessions.length === 0) {
    return (
      <div className="py-4 text-center text-xs text-gray-400">
        <RefreshCw className="w-3.5 h-3.5 inline-block animate-spin mr-1" />
        読み込み中...
      </div>
    );
  }

  if (sessions.length === 0) return null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      {/* ヘッダー */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-100">
        <div className="flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 text-gray-500" />
          <span className="text-xs font-semibold text-gray-700">最近の指導記録</span>
          <span className="px-1.5 py-0.5 text-[10px] bg-gray-200 text-gray-600 rounded font-medium">
            {sessions.length}件
          </span>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="p-1 text-gray-400 hover:text-gray-600 rounded hover:bg-gray-100 transition-colors disabled:opacity-50"
          title="更新"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* セッション一覧 */}
      <div className="divide-y divide-gray-100">
        {sessions.map((session) => (
          <MiniCard key={session.id} session={session} isTeacher={isTeacher} />
        ))}
      </div>

      {/* フルフィード遷移 */}
      <Link
        href="/progress-feed"
        className="block px-4 py-2 text-center text-[11px] text-gray-400 hover:text-[#1e3a5f] hover:bg-gray-50 transition-colors border-t border-gray-100"
      >
        フィード全体を見る →
      </Link>
    </div>
  );
}

/** ミニフィード用のコンパクトカード */
function MiniCard({
  session,
  isTeacher,
}: {
  session: ProgressSessionWithDetails;
  isTeacher: boolean;
}) {
  const hasIssue = session.homework_not_done || session.tardy;
  const st = session.student_textbook;
  const textbookName = st?.textbook?.name || '—';
  // 同じテキスト名が別科目にもある（例: フォレスタステップが数学と英語の両方）ため、
  // テキスト名だけでは何の授業か分からない。科目を先頭に出して見分けられるようにする。
  const subjectColumn = categorizeSubject(st?.textbook?.subject);
  const subjectLabel = st?.textbook?.subject || subjectColumn;
  const subjectTint = SUBJECT_COLOR[subjectColumn];

  const displayTeacher = session.teacher_name
    ? isTeacher
      ? toSurnameOnly(session.teacher_name)
      : session.teacher_name
    : null;

  // 指導単元ラベル
  const unitLabels = (session.lessons || [])
    .filter((l) => l.student_progress?.curriculum_item)
    .sort((a, b) => (a.lesson_number ?? 0) - (b.lesson_number ?? 0))
    .map((l) => {
      const ci = l.student_progress!.curriculum_item!;
      return `${ci.item_number ?? ''} ${ci.title ?? ''}`.trim();
    });

  return (
    <div className={`px-4 py-3 ${hasIssue ? 'bg-amber-50/40' : ''}`}>
      {/* 上段: 科目 / テキスト名 / 日付・講師（日付と講師は読み取れるサイズ・濃さにする） */}
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className={`shrink-0 px-1.5 py-0.5 rounded text-[11px] font-bold border ${subjectTint.bg} ${subjectTint.text} ${subjectTint.accent}`}
          >
            {subjectLabel}
          </span>
          <span className="text-sm font-medium text-gray-800 truncate">{textbookName}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs font-medium text-gray-600 tabular-nums">
            {session.session_date?.replace(/-/g, '/')}
          </span>
          {displayTeacher && (
            <span className="text-xs font-medium text-gray-700">{displayTeacher}</span>
          )}
        </div>
      </div>

      {/* フラグ */}
      {hasIssue && (
        <div className="flex items-center gap-1.5 mb-1">
          {session.homework_not_done && (
            <span className="px-1.5 py-0.5 text-[10px] bg-amber-200 text-amber-900 rounded font-medium">
              宿題未提出
            </span>
          )}
          {session.tardy && (
            <span className="px-1.5 py-0.5 text-[10px] bg-amber-200 text-amber-900 rounded font-medium">
              遅刻
            </span>
          )}
        </div>
      )}

      {/* 単元 */}
      {unitLabels.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1">
          {unitLabels.map((label, i) => (
            <span key={i} className="px-1.5 py-0.5 text-[10px] bg-gray-100 text-gray-600 rounded">
              {label}
            </span>
          ))}
        </div>
      )}

      {/* 引継ぎ */}
      {session.handover && <p className="text-xs text-gray-600 line-clamp-1">{session.handover}</p>}
    </div>
  );
}
