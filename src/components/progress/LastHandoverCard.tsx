'use client';

/**
 * LastHandoverCard — 「前回の引継ぎ」を常時表示するカード
 *
 * 授業記録モードに関係なく（＝「授業を記録」を押していなくても）進行表に出しっぱなしにする。
 * 表示情報は室長の進行表確認カード（SessionFeed）と同じ情報量:
 *  - 日付 / 講師（講師ロールは苗字のみ）
 *  - 宿題未提出 / 遅刻フラグ
 *  - 指導単元（学校進度がある単元は校マーカー付き）
 *  - 引継ぎ本文
 *
 * refreshKey を変えると再取得する（記入完了のたびに親から更新するため）。
 *
 * カードの下に「これまでの引継ぎをまとめる」を置く（AI・教室ごとの栓は student_digest）。
 * ここに置く理由は、前回1回ぶんを読んだ人がそのまま「その前はどうだったのか」に進めるから。
 * 別画面に切ると、授業の直前に開かれない。
 */

import { useEffect, useState } from 'react';
import { MessageSquare, AlertTriangle, BookOpen, GraduationCap, Sparkles, X } from 'lucide-react';
import { getLastSessionDetail } from '@/lib/api/progress-sessions';
import type { ProgressSessionWithDetails } from '@/types/database';
import { toSurnameOnly } from '@/lib/utils/teacherName';
import { fetchWithAuth } from '@/lib/api/auth';
import { STUDENT_DIGEST_FEATURE_KEY } from '@/lib/ai/features';
import type { HandoverDigest } from '@/lib/ai/handoverDigest';

interface Props {
  studentTextbookId: string;
  /** 教室ごとのAIの入切に使う。空文字ならまとめるボタンを出さない */
  schoolId: string;
  /** 講師ロールなら苗字のみ表示 */
  isTeacher: boolean;
  /** 値が変わると再取得する（記入完了後の最新化用） */
  refreshKey?: number;
}

interface DigestResponse {
  digest: HandoverDigest | null;
  count: number;
  degraded: boolean;
  disabled: boolean;
}

export default function LastHandoverCard({
  studentTextbookId,
  schoolId,
  isTeacher,
  refreshKey,
}: Props) {
  const [lastSession, setLastSession] = useState<ProgressSessionWithDetails | null>(null);

  useEffect(() => {
    if (!studentTextbookId) return;
    let cancelled = false;
    getLastSessionDetail(studentTextbookId)
      .then((s) => {
        if (!cancelled) setLastSession(s);
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [studentTextbookId, refreshKey]);

  if (!lastSession) return null;

  // 指導単元（学校進度マーカー付き）を室長フィードと同じ形で組み立てる
  const lessonUnits = (lastSession.lessons ?? [])
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

  const hasIssue = !!(lastSession.homework_not_done || lastSession.tardy);
  // 引継ぎ本文が無くても、単元やフラグがあれば前回情報として表示する
  const hasContent = !!(lastSession.handover || lessonUnits.length > 0 || hasIssue);
  if (!hasContent) return null;

  const dateTeacher = `${lastSession.session_date?.replace(/-/g, '/') ?? ''} ${
    isTeacher ? toSurnameOnly(lastSession.teacher_name) : lastSession.teacher_name
  }`.trim();

  return (
    <div
      className={`rounded-xl border-l-4 shadow-sm px-4 py-3 ${
        hasIssue
          ? 'border-l-amber-400 border border-amber-200 bg-amber-50/60'
          : 'border-l-[#1e3a5f] border border-[#dbe3ee] bg-[#eef2f7]'
      }`}
    >
      {/* 横に広く読めるよう2カラム構成: 左=メタ（狭い固定幅）/ 右=単元＋本文（全幅）。
          狭い画面では縦積みにフォールバックする。 */}
      <div className="flex flex-col sm:flex-row sm:gap-4">
        {/* 左: メタ情報（三次情報として小さめ・グレー） */}
        <div className="mb-2 sm:mb-0 sm:w-40 sm:shrink-0">
          <div className="flex items-center gap-1.5">
            <MessageSquare className="w-4 h-4 text-[#1e3a5f]" />
            <span className="text-xs font-bold text-[#1e3a5f]">前回の引継ぎ</span>
          </div>
          <div className="mt-0.5 text-[11px] text-gray-500">{dateTeacher}</div>
          {/* フラグ（宿題未提出・遅刻） */}
          {hasIssue && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
              {lastSession.homework_not_done && (
                <span className="px-1.5 py-0.5 text-[11px] bg-amber-200 text-amber-900 rounded font-medium">
                  宿題未提出
                </span>
              )}
              {lastSession.tardy && (
                <span className="px-1.5 py-0.5 text-[11px] bg-amber-200 text-amber-900 rounded font-medium">
                  遅刻
                </span>
              )}
            </div>
          )}
        </div>

        {/* 右: 指導単元＋引継ぎ本文（横幅いっぱいに広げる） */}
        <div className="min-w-0 flex-1">
          {/* 指導単元（学校進度がある単元には校マーカー） */}
          {lessonUnits.length > 0 && (
            <div className="mb-2 flex items-start gap-1.5">
              <BookOpen className="w-3.5 h-3.5 text-gray-400 mt-0.5 shrink-0" />
              <div className="flex flex-wrap gap-1">
                {lessonUnits.map((u, i) => (
                  <span
                    key={i}
                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded ${
                      u.schoolProgressDate
                        ? 'bg-blue-50 text-blue-800 border border-blue-200'
                        : 'bg-white text-gray-700 border border-gray-200'
                    }`}
                    title={u.schoolProgressDate ? `学校進度: ${u.schoolProgressDate}` : undefined}
                  >
                    {u.schoolProgressDate && (
                      <GraduationCap className="w-3 h-3 text-blue-500" aria-label="学校進度あり" />
                    )}
                    {u.label}{' '}
                    <span className={u.schoolProgressDate ? 'text-blue-400' : 'text-gray-400'}>
                      ({u.lessonNumber}回目)
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 引継ぎ本文。目標パネルを主役にするため控えめ（text-sm）にしつつ、
              「次回:」「確認テスト:」等の既知ラベル前で改行して読みやすさは保つ（表示のみ）。 */}
          {lastSession.handover && (
            <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
              {formatHandover(lastSession.handover)}
            </p>
          )}
        </div>
      </div>

      {/* これまでの引継ぎをまとめる（AI）。教室でオフなら中で何も描かない */}
      <HandoverDigestPanel
        studentTextbookId={studentTextbookId}
        schoolId={schoolId}
        isTeacher={isTeacher}
      />
    </div>
  );
}

/**
 * 「これまでの引継ぎをまとめる」ボタンとその結果。
 *
 * ★親（カード）は引継ぎが無ければ早期returnするので、フックを持つこちらを別に切る。
 *
 * ★機能がオフの教室では、ボタンごと出さない（押せる形にしない＝送信が起きない）。
 *   これは AiWriteBar と同じ約束。
 */
function HandoverDigestPanel({
  studentTextbookId,
  schoolId,
  isTeacher,
}: {
  studentTextbookId: string;
  schoolId: string;
  isTeacher: boolean;
}) {
  /** この教室でAIを使えるか。null=まだ分からない */
  const [available, setAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [digest, setDigest] = useState<HandoverDigest | null>(null);
  const [count, setCount] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!schoolId) {
      setAvailable(false);
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const res = await fetchWithAuth(
          `/api/ai/feature-setting?school_id=${schoolId}&feature=${STUDENT_DIGEST_FEATURE_KEY}`
        );
        if (!alive) return;
        if (!res.ok) return setAvailable(false);
        const json = (await res.json()) as { enabled: boolean };
        setAvailable(json.enabled);
      } catch {
        setAvailable(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [schoolId]);

  // テキストを切り替えたら結果を捨てる（前の生徒のまとめが残ると読み違える）
  useEffect(() => {
    setDigest(null);
    setCount(0);
    setMessage(null);
  }, [studentTextbookId]);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetchWithAuth('/api/ai/handover/digest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schoolId, studentTextbookId }),
      });
      if (!res.ok) throw new Error('failed');
      const json = (await res.json()) as DigestResponse;

      if (json.disabled) return setAvailable(false);
      // ★材料が無いのは故障ではない。degraded より先に見て、言い方を分ける
      if (json.count === 0) {
        return setMessage('まとめられる引継ぎがまだありません');
      }
      if (json.degraded || !json.digest) {
        return setMessage('いまはまとめられませんでした');
      }
      setDigest(json.digest);
      setCount(json.count);
    } catch {
      setMessage('いまはまとめられませんでした');
    } finally {
      setBusy(false);
    }
  };

  // ★オフ・未確定のあいだは何も出さない
  if (available !== true) return null;

  return (
    <div className="mt-2 border-t border-black/5 pt-2">
      {!digest && (
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-full border border-ink/25 bg-surface px-3 py-1 text-[11px] font-medium text-ink transition-opacity disabled:opacity-40"
        >
          <Sparkles className="h-3 w-3" aria-hidden="true" />
          {busy ? 'まとめています…' : 'これまでの引継ぎをまとめる'}
        </button>
      )}

      {message && <span className="pl-1 text-[11px] text-text-muted">{message}</span>}

      {digest && (
        <div className="flex flex-col gap-2.5 rounded-lg border border-ink/25 bg-ink-subtle px-3 py-2.5">
          <div className="flex items-start justify-between gap-2">
            <span className="text-xs font-bold text-text-heading">経緯（直近{count}回）</span>
            <button
              type="button"
              onClick={() => setDigest(null)}
              className="inline-flex shrink-0 items-center gap-1 text-[11px] text-text-muted"
            >
              <X className="h-3 w-3" aria-hidden="true" />
              閉じる
            </button>
          </div>

          {/* 時系列のまま1回1行。★まとめて1文にすると「いつからそうなったか」が消える */}
          <ul className="flex flex-col gap-1">
            {digest.timeline.map((t, i) => {
              // ★講師ロールには他の講師を苗字だけで見せる（カード上部の表示と同じ約束）
              const teacher = isTeacher ? toSurnameOnly(t.teacher) : (t.teacher ?? '');
              return (
                <li key={`${t.date}-${i}`} className="flex items-baseline gap-2 text-xs">
                  <span className="shrink-0 font-mono text-[10px] text-text-faint">
                    {t.date.replace(/-/g, '/').slice(5)}
                  </span>
                  <span className="min-w-0 text-text-heading">{t.line}</span>
                  {teacher && (
                    <span className="ml-auto shrink-0 text-[10px] text-text-faint">{teacher}</span>
                  )}
                </li>
              );
            })}
          </ul>

          {/* 空の見出しは出さない（無いものを見出しだけ立てると「抜けている」に見える） */}
          {digest.ongoing.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-bold text-text-heading">ずっとある課題</span>
              <ul className="flex flex-col gap-0.5">
                {digest.ongoing.map((o, i) => (
                  <li key={i} className="text-xs text-text-heading">
                    ・{o}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {digest.nextCare.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-bold text-text-heading">次に気をつけること</span>
              <ul className="flex flex-col gap-0.5">
                {digest.nextCare.map((n, i) => (
                  <li key={i} className="text-xs text-text-heading">
                    ・{n}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <span className="text-[11px] text-text-muted">
            AIが引継ぎを1回1行に畳んだものです。書かれていないことは足していません
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * 引継ぎ本文を読みやすく整形する（表示のみ・データは変更しない）。
 * 「次回:」「確認テスト:」「宿題:」等の既知ラベルの直前で改行し、意味の区切りを立てる。
 */
function formatHandover(text: string): string {
  return text
    .replace(/\s*(次回|確認テスト|宿題|補足|備考|連絡)\s*[:：]/g, '\n$1：')
    .replace(/^\n+/, '')
    .trim();
}
