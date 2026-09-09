'use client';

/**
 * 面談ワークスペース 左カラム: 「報告事項」カード（AI・教室ごとの栓は student_digest）
 * ------------------------------------------------------------------
 * 「前回の申し送り」の直下に置く。面談の直前に、その生徒についてシステムに溜まっている
 * ものを1枚で読ませるためのカード。
 *
 * ★現状の行はここ（システム）が組む。AIが書くのは「見えること」「つなげて見えること」
 *   「話す項目」だけ。数字をAIに触らせないのは、書き写しの1字違いに面談の場で誰も
 *   気づけないため。集計は interview.shared.ts の関数をそのまま使い、同じ画面の
 *   成績・進行表・宿題と遅刻の各パネルと数字がずれないようにする。
 *
 * ★「授業の様子」（進行表の引継ぎ）と「保護者と」（チャット）だけは面談画面が読んでいない。
 *   この2つはサーバー（/api/ai/interview/brief）が足す。
 *
 * ★保存しない。押すたびにその場で作り、画面を離れると消える。
 *   保存すると「いつ作ったまとめか」が分からないまま次の面談で読まれる。
 *
 * 正典: docs/interview-brief-ai-plan.md
 */

import { useEffect, useMemo, useState } from 'react';
import { Sparkles, RefreshCw } from 'lucide-react';
import { fetchWithAuth } from '@/lib/api/auth';
import { STUDENT_DIGEST_FEATURE_KEY } from '@/lib/ai/features';
import { recordAiFeedback } from '@/lib/ai/feedback';
import { DigestVerdictChips } from '@/components/ai/DigestVerdictChips';
import type { BriefSectionKey, BriefSign, BriefTalk } from '@/lib/ai/interviewBrief';
import { briefSectionLabel } from '@/lib/ai/interviewBrief';
import type { AssessmentWithScores, Student, StudentInterview } from '@/types/database';
import type { DisciplineSessionRow } from '@/lib/api/progress-sessions';
import type { KoushuEnrollment } from '@/lib/api/seasonalCourses';
import type { TextbookProgressData } from './ProgressPanel';
import {
  computeDisciplineMonthly,
  computeScoreSummary,
  daysSince,
  extractHandover,
  fmtDateJa,
  formatKoushuEnrollments,
  summarizeTextbookDetail,
  type AssessmentCategory,
} from './interview.shared';

/** 画面に出す1セクション（APIの戻り） */
export interface BriefSectionView {
  key: BriefSectionKey;
  label: string;
  current: string[];
  seen: string;
  sign: BriefSign;
}

/** 印刷シートにも渡す結果。★親（InterviewWorkspace）が持つ */
export interface BriefView {
  sections: BriefSectionView[];
  thread: string;
  talk: BriefTalk[];
}

interface BriefResponse extends BriefView {
  degraded: boolean;
  disabled: boolean;
}

interface Props {
  student: Student;
  /** 成績（ScorePanel と同じもの） */
  assessments: AssessmentWithScores[];
  /** 面談記録。タスク種別を含んでいてよい（中で除く） */
  interviews: StudentInterview[];
  /** 進行表の生データ（ProgressPanel と同じもの） */
  textbookData: TextbookProgressData[];
  /** 宿題・遅刻の生セッション行（DisciplinePanel と同じもの） */
  disciplineSessions: DisciplineSessionRow[];
  koushuEnrollments: KoushuEnrollment[];
  /** 材料の読み込み中はボタンを押させない（半端な材料でまとめても作り直しになる） */
  loading?: boolean;
  /** 結果を親へ上げる。印刷シートが同じ内容を出すため */
  onResult: (view: BriefView | null) => void;
}

/** 進度に載せるテキストの数。並べすぎると読まれない */
const MAX_PROGRESS_LINES = 4;
/** 宿題・遅刻をさかのぼる月数 */
const DISCIPLINE_MONTHS = 3;

/** 現状の行を組む1セクションぶん（行が0本なら送らない） */
interface CurrentSection {
  key: BriefSectionKey;
  current: string[];
}

/** 「英語 72（前回 65）」を科目ぶん並べた1行を作る。値が1つも無ければ null */
function scoreLine(
  assessments: AssessmentWithScores[],
  category: AssessmentCategory,
  heading: string
): string | null {
  // 直近2件（今回・前回）だけ見る。推移そのものは右カラムの成績パネルが出している
  const summary = computeScoreSummary(assessments, category, 2);
  if (summary.testLabels.length === 0) return null;

  const last = summary.testLabels.length - 1;
  const prev = last - 1;
  const parts: string[] = [];
  for (const row of summary.rows) {
    const curr = row.values[last];
    if (curr == null) continue;
    const before = prev >= 0 ? row.values[prev] : null;
    parts.push(before == null ? `${row.label} ${curr}` : `${row.label} ${curr}（前回 ${before}）`);
  }
  if (parts.length === 0) return null;
  return `${heading} ${summary.testLabels[last]}: ${parts.join('／')}`;
}

/**
 * 面談画面が持っているデータから「現状の行」を組む。
 *
 * ★lessons（授業の様子）と parent（保護者と）はここでは組まない。面談画面が読んでいない
 *   材料なので、サーバーが足す（クライアントから送っても捨てられる）。
 */
function buildCurrentSections(props: {
  assessments: AssessmentWithScores[];
  interviews: StudentInterview[];
  textbookData: TextbookProgressData[];
  disciplineSessions: DisciplineSessionRow[];
  koushuEnrollments: KoushuEnrollment[];
}): CurrentSection[] {
  const sections: CurrentSection[] = [];

  // 成績: 直近の定期テストと通知表を各1行
  const scoreLines: string[] = [];
  const regular = scoreLine(props.assessments, 'regular_test', '定期テスト');
  if (regular) scoreLines.push(regular);
  const report = scoreLine(props.assessments, 'report_card', '通知表');
  if (report) scoreLines.push(report);
  if (scoreLines.length > 0) sections.push({ key: 'score', current: scoreLines });

  // 宿題・遅刻: 直近3か月。授業記録が無い月は行にしない（「0回」を並べない）
  const months = computeDisciplineMonthly(props.disciplineSessions, DISCIPLINE_MONTHS, new Date());
  const disciplineLines = months
    .filter((m) => m.lessonDays > 0)
    .map(
      (m) =>
        `${m.label}（授業${m.lessonDays}日）: 宿題未提出 ${m.homeworkMissedDays}回／遅刻 ${m.tardyDays}回`
    );
  if (disciplineLines.length > 0) sections.push({ key: 'discipline', current: disciplineLines });

  // 進度: テキストごとに「◯%・次: 単元」
  const progressLines = props.textbookData
    .slice(0, MAX_PROGRESS_LINES)
    .map(({ textbook, rows }) => {
      const detail = summarizeTextbookDetail(textbook, rows);
      const next = detail.nextUnitTitles[0];
      const stalled = detail.stalled ? '・停滞' : '';
      return `${detail.name}: ${detail.progressPct}%${stalled}${next ? `・次: ${next}` : ''}`;
    });
  if (progressLines.length > 0) sections.push({ key: 'progress', current: progressLines });

  // 講習: 季節ごとの合計コマ数。申込が無ければ行にしない
  if (props.koushuEnrollments.length > 0) {
    sections.push({
      key: 'koushu',
      current: [`申込 ${formatKoushuEnrollments(props.koushuEnrollments)}`],
    });
  }

  // 前回の面談から: 日付と経過日数、申し送り
  const latest = props.interviews.filter((i) => i.interview_type !== 'task')[0];
  if (latest) {
    const lines = [
      `${fmtDateJa(latest.interview_date)}（${daysSince(latest.interview_date)}日前）`,
    ];
    const handover = extractHandover(latest.content) ?? latest.content;
    const text = handover.replace(/\s+/g, ' ').trim();
    if (text) lines.push(`申し送り: ${text}`);
    sections.push({ key: 'lastInterview', current: lines });
  }

  return sections;
}

/** sign ごとの色線。warn=注意して話す / good=伝えたい良い話 */
const SIGN_STYLE: Record<Exclude<BriefSign, ''>, string> = {
  warn: 'border-l-warning bg-warning-subtle',
  good: 'border-l-success bg-success-subtle',
};

export function InterviewBriefCard({
  student,
  assessments,
  interviews,
  textbookData,
  disciplineSessions,
  koushuEnrollments,
  loading,
  onResult,
}: Props) {
  /** この教室でAIを使えるか。null=まだ分からない */
  const [available, setAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<BriefView | null>(null);
  const [madeAt, setMadeAt] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  /**
   * この画面でもう答えたか。★押し直させないためだけの印で、保存はしない。
   *   「もう一度作る」を押せば別のまとめになるので、また聞く。
   */
  const [rated, setRated] = useState(false);

  useEffect(() => {
    if (!student.school_id) {
      setAvailable(false);
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const res = await fetchWithAuth(
          `/api/ai/feature-setting?school_id=${student.school_id}&feature=${STUDENT_DIGEST_FEATURE_KEY}`
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
  }, [student.school_id]);

  // 生徒を切り替えたら結果を捨てる（前の生徒の報告事項が残ると読み違える）
  useEffect(() => {
    setView(null);
    setMadeAt(null);
    setMessage(null);
    setRated(false);
    onResult(null);
    // onResult は親で useCallback 済みだが、依存に入れると親の再描画で結果が消えるため入れない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student.id]);

  const currentSections = useMemo(
    () =>
      buildCurrentSections({
        assessments,
        interviews,
        textbookData,
        disciplineSessions,
        koushuEnrollments,
      }),
    [assessments, interviews, textbookData, disciplineSessions, koushuEnrollments]
  );

  const apply = (next: BriefView | null) => {
    setView(next);
    onResult(next);
  };

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetchWithAuth('/api/ai/interview/brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schoolId: student.school_id,
          studentId: student.id,
          sections: currentSections,
        }),
      });
      if (!res.ok) throw new Error('failed');
      const json = (await res.json()) as BriefResponse;

      if (json.disabled) return setAvailable(false);
      // ★材料が無いのは故障ではない。degraded より先に見て、言い方を分ける
      if (json.sections.length === 0) {
        return setMessage('報告事項にできる記録がまだありません');
      }
      if (json.degraded) {
        return setMessage('いまは作れませんでした');
      }
      apply({ sections: json.sections, thread: json.thread, talk: json.talk });
      setMadeAt(new Date().toISOString().slice(0, 10));
      setRated(false);
    } catch {
      setMessage('いまは作れませんでした');
    } finally {
      setBusy(false);
    }
  };

  /** 「見えること」の手直し。★直したものがそのまま印刷シートにも出る */
  const editSeen = (key: BriefSectionKey, seen: string) => {
    if (!view) return;
    apply({
      ...view,
      sections: view.sections.map((s) => (s.key === key ? { ...s, seen } : s)),
    });
  };

  // ★オフ・未確定のあいだは何も出さない（押せる形にしない＝送信が起きない）
  if (available !== true) return null;

  return (
    <div className="rounded-lg border border-ink/25 bg-ink-subtle p-3">
      <div className="flex items-center gap-1.5">
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-ink" aria-hidden="true" />
        <span className="text-xs font-semibold text-text-heading">報告事項</span>
        <span className="ml-auto shrink-0 text-[11px] text-text-faint">
          {madeAt ? `${madeAt.slice(5).replace('-', '/')} に作成 ・ ` : ''}保存されません
        </span>
      </div>

      {!view && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void run()}
            disabled={busy || loading === true}
            className="inline-flex items-center gap-1.5 rounded-full bg-ink px-3 py-1 text-[11px] font-medium text-white transition-opacity disabled:opacity-40"
          >
            <Sparkles className="h-3 w-3" aria-hidden="true" />
            {busy ? '作っています…' : '報告事項を作る'}
          </button>
          {message && <span className="text-[11px] text-text-muted">{message}</span>}
        </div>
      )}

      {view && (
        <div className="mt-2 flex flex-col gap-2.5">
          {view.sections.map((s) => (
            <div key={s.key} className="flex flex-col gap-1">
              <span className="text-[11px] font-bold text-text-heading">{s.label}</span>
              {/* 現状（システムの記録）。最大2行で、超えたぶんは「…」で畳む */}
              <p className="line-clamp-2 text-[11px] leading-snug text-text-muted">
                {s.current.join(' ／ ')}
              </p>
              {/* 見えること（AIが読んだもの・直せる）。左の色線が sign */}
              <textarea
                value={s.seen}
                onChange={(e) => editSeen(s.key, e.target.value)}
                rows={s.seen.length > 24 ? 2 : 1}
                placeholder="（見えることはありませんでした）"
                aria-label={`${s.label}から見えること`}
                className={`w-full resize-none rounded-r-md border-l-4 bg-surface px-2 py-1 text-xs leading-snug text-text-heading ${
                  s.sign ? SIGN_STYLE[s.sign] : 'border-l-border-subtle'
                }`}
              />
            </div>
          ))}

          {/* 空の見出しは出さない（無いものを見出しだけ立てると「抜けている」に見える） */}
          {view.thread && (
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-bold text-text-heading">つなげて見えること</span>
              <p className="text-xs leading-snug text-text-heading">{view.thread}</p>
            </div>
          )}

          {view.talk.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-bold text-text-heading">話す項目</span>
              <ol className="flex flex-col gap-0.5">
                {view.talk.map((t, i) => (
                  <li key={i} className="flex items-baseline gap-1.5 text-xs text-text-heading">
                    <span className="shrink-0 font-mono text-[10px] text-text-faint">{i + 1}.</span>
                    <span className="min-w-0">{t.text}</span>
                    {t.basis && (
                      <span className="ml-auto shrink-0 text-[10px] text-text-faint">
                        {briefSectionLabel(t.basis)}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void run()}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-full border border-ink/25 bg-surface px-2.5 py-1 text-[11px] text-ink transition-opacity disabled:opacity-40"
            >
              <RefreshCw className="h-3 w-3" aria-hidden="true" />
              {busy ? '作っています…' : 'もう一度作る'}
            </button>
            {message && <span className="text-[11px] text-text-muted">{message}</span>}
          </div>

          <span className="text-[11px] leading-snug text-text-muted">
            現状の行はシステムの記録です。「見えること」「話す項目」はAIが読んだもので、直せます
          </span>

          {/* ★答え合わせ。現状の行も「見えること」も記録しない（成績と引継ぎが混ざる）。
              残すのはセクション数と話す項目の数だけ */}
          <DigestVerdictChips
            rated={rated}
            onRate={(verdict) => {
              setRated(true);
              void recordAiFeedback({
                schoolId: student.school_id ?? '',
                feature: STUDENT_DIGEST_FEATURE_KEY,
                targetKind: 'student',
                targetId: student.id,
                verdict,
                aiOutput: { sectionCount: view.sections.length, talkCount: view.talk.length },
              });
            }}
          />
        </div>
      )}
    </div>
  );
}
