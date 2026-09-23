'use client';

/**
 * 面談ワークスペース: 面談記録カードと、未完了の約束・タスクカード
 * ------------------------------------------------------------------
 * 2026-09の組み替えで、この2枚は別の段に置かれるようになった（正典:
 * docs/interview-workspace-layout-2026-09.md）。
 *
 * - 面談記録（InterviewRecordsCard）＝「材料（記録）」の段・成績の隣
 * - 未完了の約束・タスク（InterviewTasksCard）＝最下段・全幅
 *   （ほとんど使われていないのに最上段を占めていたため下げた）
 *
 * 「前回の申し送り」は独立カードを持たず、面談記録カードの先頭にピン留めする
 * （申し送りは面談記録の最新1件から抜き出したものであり、同じデータを2枚のカードに
 * 分けて出すと同じ内容が並んで見えるため）。
 *
 * ★以前はこのカードが「面談で話すこと」カードを briefSlot として抱えていたが、
 *   台本は最上段・全幅に出す形になったので抱えるのをやめた。
 *
 * タスクの完了/未完了は楽観更新し、失敗時はロールバックする。
 * タイムラインの編集は既存の InterviewModal をそのまま再利用する。
 * 約束・宿題は入力するとその場で createInterview を1件呼んで即登録する
 *（下書きを溜めて後でまとめて保存する設計にはしない）。
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  InlineLoading,
  Input,
  Button,
} from '@/components/ui';
import { InterviewModal } from '@/components/students/InterviewModal';
import { ImportNottaModal } from '@/components/students/ImportNottaModal';
import { useAuth } from '@/contexts/AuthContext';
import { completeTask, uncompleteTask, createInterview } from '@/lib/api/interviews';
import { useToast } from '@/hooks/useToast';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';
import {
  INTERVIEW_TYPE_COLORS,
  INTERVIEW_TYPE_LABELS,
  type StudentInterview,
} from '@/types/database';
import {
  fmtDateJa,
  matchesSearch,
  parseNottaSummary,
  splitForHighlight,
  type NottaSummary,
} from './interview.shared';
import {
  CheckCircle2,
  Circle,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  History,
  Mic,
  Pin,
  Plus,
  Search,
  X,
} from 'lucide-react';

export interface HandoverInfo {
  date: string;
  /** 「## 次回への申し送り」が取れたらその本文。無ければメタを落とした受け皿の文 */
  text: string;
  /** text が受け皿（＝申し送りの見出しが無かった）かどうか */
  isFallback: boolean;
  /** 元の面談記録の本文。受け皿のときに構造化して出すために使う */
  content: string;
}

/* ============================================================
 * 未完了の約束・タスク（最下段・全幅）
 * ========================================================== */

interface TasksCardProps {
  studentId: string;
  schoolId: string;
  interviews: StudentInterview[];
  loading: boolean;
  /** タスク完了操作・追加の後に呼ぶ。親側で面談記録を再取得する。 */
  onChanged: () => void;
}

export function InterviewTasksCard({
  studentId,
  schoolId,
  interviews,
  loading,
  onChanged,
}: TasksCardProps) {
  const { success, error: toastError } = useToast();
  const [newTaskLabel, setNewTaskLabel] = useState('');
  const [addingTask, setAddingTask] = useState(false);
  // タスク完了の楽観更新オーバーレイ（API確定後は親の再取得で自然に一覧から消える）
  const [taskOverrides, setTaskOverrides] = useState<Record<string, boolean>>({});

  const tasks = interviews.filter((i) => i.interview_type === 'task' && !i.is_completed);

  const handleToggleTask = async (task: StudentInterview) => {
    const next = !(taskOverrides[task.id] ?? false);
    setTaskOverrides((prev) => ({ ...prev, [task.id]: next }));
    try {
      if (next) {
        await completeTask(task.id);
      } else {
        await uncompleteTask(task.id);
      }
      onChanged();
    } catch (e) {
      // 失敗時はロールバック
      setTaskOverrides((prev) => ({ ...prev, [task.id]: !next }));
      toastError(getUserErrorMessage(e, 'タスクの更新に失敗しました'));
    }
  };

  const handleAddTask = async () => {
    const label = newTaskLabel.trim();
    if (!label || addingTask) return;
    setAddingTask(true);
    try {
      await createInterview(schoolId, studentId, {
        interview_date: new Date().toISOString().slice(0, 10),
        interview_type: 'task',
        title: null,
        content: label,
      });
      setNewTaskLabel('');
      success('約束・タスクを追加しました');
      onChanged();
    } catch (e) {
      toastError(getUserErrorMessage(e, 'タスクの追加に失敗しました'));
    } finally {
      setAddingTask(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 border-b-0 pb-0">
        <CheckCircle2 className="h-4 w-4 text-text-muted" />
        <CardTitle className="text-sm">未完了の約束・タスク</CardTitle>
      </CardHeader>
      <CardContent className="pt-2">
        {loading ? (
          <InlineLoading />
        ) : tasks.length === 0 ? (
          <p className="text-sm text-text-muted">未完了のタスクはありません</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {tasks.map((t) => {
              const done = taskOverrides[t.id] ?? false;
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => handleToggleTask(t)}
                    className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-surface-hover"
                  >
                    {done ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                    ) : (
                      <Circle className="h-4 w-4 shrink-0 text-text-faint" />
                    )}
                    <span
                      className={`text-sm ${done ? 'text-text-faint line-through' : 'text-text-body'}`}
                    >
                      {t.content}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {/* 追加欄（入力→追加ボタンで即登録） */}
        <div className="mt-3 flex gap-2 border-t border-border-subtle pt-3">
          <Input
            aria-label="約束・タスクを追加"
            value={newTaskLabel}
            onChange={(e) => setNewTaskLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAddTask();
              }
            }}
            placeholder="例：英語ワークP10まで"
            className="max-w-sm flex-1"
            disabled={addingTask}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={handleAddTask}
            disabled={addingTask || !newTaskLabel.trim()}
            className="shrink-0 gap-1"
          >
            <Plus className="h-3.5 w-3.5" />
            追加
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ============================================================
 * 面談記録（材料の段・成績の隣）
 * ========================================================== */

/** 構造化して出すとき、畳まずに最初から見せる節の数。残りは「すべて表示」で開く */
const NOTTA_VISIBLE_SECTIONS = 2;

/**
 * 検索語に当たった所を塗って出す。検索していないときは素の文字のまま。
 * ★色は warning-subtle（前回の申し送りのピンと同じ系統）。新しい色は足さない。
 */
function Hl({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  return (
    <>
      {splitForHighlight(text, query).map((part, i) =>
        part.hit ? (
          <mark key={i} className="rounded-sm bg-warning-subtle px-px text-inherit">
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        )
      )}
    </>
  );
}

/**
 * Notta取込を見出し＋箇条書きで出す。空だった見出しは末尾に1行でまとめる。
 * ★検索中は全部の節を出す（当たった箇所が「すべて表示」の奥に隠れると、件数だけ出て
 *   どこに当たったのか見えない）。
 */
function NottaBody({ summary, query }: { summary: NottaSummary; query: string }) {
  const [expanded, setExpanded] = useState(false);
  const searching = query.trim() !== '';
  const hasMore = summary.sections.length > NOTTA_VISIBLE_SECTIONS;
  const shown =
    expanded || searching ? summary.sections : summary.sections.slice(0, NOTTA_VISIBLE_SECTIONS);

  return (
    <div className="flex flex-col gap-1.5">
      {shown.map((section) => (
        <div key={section.heading}>
          <h5 className="text-[11px] font-bold text-text-heading">
            <Hl text={section.heading} query={query} />
          </h5>
          <ul className="mt-0.5 list-disc pl-4">
            {section.bullets.map((b, i) => (
              <li key={i} className="text-xs leading-relaxed text-text-body">
                <Hl text={b} query={query} />
              </li>
            ))}
          </ul>
        </div>
      ))}

      {hasMore && !searching && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex w-fit items-center gap-0.5 text-xs text-text-muted hover:text-primary"
        >
          {expanded ? (
            <>
              閉じる <ChevronUp className="h-3 w-3" />
            </>
          ) : (
            <>
              すべて表示 <ChevronDown className="h-3 w-3" />
            </>
          )}
        </button>
      )}

      {/* ★話題が出なかった見出しはNottaが必ず立てる。本文の半分を占めるので1行にまとめる */}
      {summary.omitted.length > 0 && (
        <p className="text-[11px] text-text-faint">記載なし：{summary.omitted.join('・')}</p>
      )}

      {summary.audioUrl && (
        <a
          href={summary.audioUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-fit items-center gap-1 text-[11px] text-text-muted hover:text-primary"
        >
          <ExternalLink className="h-3 w-3" />
          録音を開く
        </a>
      )}
    </div>
  );
}

/**
 * ピン留めの「前回の申し送り」の中身。
 *
 * ★出す順は3段構え。
 *   1. 「## 次回への申し送り」の見出しがあればその本文だけ（それが申し送りそのもの）
 *   2. 無ければ、タイムラインと同じ構造化を通す。★ここを素の本文のままにしていたため、
 *      ピン留めに「■ 前回の確認 ・…見つかりませんでした」が並び、面談で最初に読む場所が
 *      空の項目で埋まっていた
 *   3. Nottaでもなければ、メタ行を落とした受け皿の文（InterviewWorkspace が組む handover.text）
 * ★ピン留めは「最初に目に入る短い一枚」なので、タイムラインと違って
 *   「すべて表示」も「録音を開く」も出さない（同じ記録はすぐ下のタイムラインにある）。
 * ★検索中も絞り込まない（前回の申し送りは常に最初に読むもの）。当たった所は塗る。
 */
function HandoverBody({ handover, query }: { handover: HandoverInfo; query: string }) {
  const notta = handover.isFallback ? parseNottaSummary(handover.content) : null;

  if (!notta) {
    return (
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-body">
        <Hl text={handover.text} query={query} />
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {notta.sections.map((section) => (
        <div key={section.heading}>
          <h5 className="text-[11px] font-bold text-text-heading">
            <Hl text={section.heading} query={query} />
          </h5>
          <ul className="mt-0.5 list-disc pl-4">
            {section.bullets.map((b, i) => (
              <li key={i} className="text-xs leading-relaxed text-text-body">
                <Hl text={b} query={query} />
              </li>
            ))}
          </ul>
        </div>
      ))}
      {notta.omitted.length > 0 && (
        <p className="text-[11px] text-text-faint">記載なし：{notta.omitted.join('・')}</p>
      )}
    </div>
  );
}

/**
 * 構造化できない本文（手入力の短い記録など）。従来どおり3行で畳む。
 * ★検索中は畳まずに全文を出す（当たった箇所が4行目以降だと見えないため）。
 */
function PlainBody({ content, query }: { content: string; query: string }) {
  const [expanded, setExpanded] = useState(false);
  if (query.trim()) {
    return (
      <p className="whitespace-pre-wrap text-xs leading-relaxed text-text-body">
        <Hl text={content} query={query} />
      </p>
    );
  }
  return (
    <button type="button" onClick={() => setExpanded((v) => !v)} className="w-full text-left">
      <p
        className={`text-xs leading-relaxed text-text-body ${expanded ? 'whitespace-pre-wrap' : 'line-clamp-3'}`}
      >
        {content}
      </p>
      <span className="mt-1 inline-flex items-center gap-0.5 text-xs text-text-muted">
        {expanded ? (
          <>
            閉じる <ChevronUp className="h-3 w-3" />
          </>
        ) : (
          <>
            全文を見る <ChevronDown className="h-3 w-3" />
          </>
        )}
      </span>
    </button>
  );
}

interface RecordsCardProps {
  studentId: string;
  schoolId: string;
  interviews: StudentInterview[];
  loading: boolean;
  handover: HandoverInfo | null;
  /** 面談編集の保存後・Notta取り込みの後に呼ぶ。親側で面談記録を再取得する。 */
  onChanged: () => void;
}

export function InterviewRecordsCard({
  studentId,
  schoolId,
  interviews,
  loading,
  handover,
  onChanged,
}: RecordsCardProps) {
  const [editingInterview, setEditingInterview] = useState<StudentInterview | null>(null);
  /**
   * Nottaから取り込み。★生徒詳細「面談記録」タブ（InterviewList）と同じ栓
   * （permissions.canEditInterviews）で出し分ける。講師には出さない。
   * ★取り込みの中身（どの文字起こしをどの種別で入れるか）は既存のモーダルをそのまま使う。
   *   2か所で別々の取り込み画面を持つと、片方だけ直したときに挙動がずれる。
   */
  const { permissions } = useAuth();
  const canImportNotta = permissions?.canEditInterviews ?? false;
  const [nottaOpen, setNottaOpen] = useState(false);
  const { success } = useToast();
  /**
   * 面談記録の検索。★タイトルと本文の部分一致（全角半角・大文字小文字を区別しない）。
   * 保存しない（その場で探すためのもので、生徒を切り替えたら要らない）。
   */
  const [query, setQuery] = useState('');
  const searching = query.trim() !== '';

  const timeline = useMemo(
    () => interviews.filter((i) => i.interview_type !== 'task'),
    [interviews]
  );
  const shownTimeline = useMemo(
    () =>
      searching
        ? timeline.filter((iv) => {
            const title = iv.title ?? parseNottaSummary(iv.content)?.title ?? '';
            return matchesSearch(`${title}\n${iv.content}`, query);
          })
        : timeline,
    [timeline, query, searching]
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 border-b-0 pb-0">
        <History className="h-4 w-4 text-text-muted" />
        <CardTitle className="text-sm">面談記録</CardTitle>
        {canImportNotta && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setNottaOpen(true)}
            className="ml-auto h-7 shrink-0 gap-1 px-2 text-xs"
          >
            <Mic className="h-3.5 w-3.5" />
            Nottaから取り込み
          </Button>
        )}
      </CardHeader>
      <CardContent className="pt-2">
        {loading ? (
          <InlineLoading />
        ) : (
          <div className="flex flex-col gap-3">
            {/* 検索。★記録が1件も無いときは出さない（探すものが無い） */}
            {timeline.length > 0 && (
              <div className="flex items-center gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 focus-within:border-border-strong">
                  <Search className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden="true" />
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="面談記録を検索（例：推薦、英検）"
                    aria-label="面談記録を検索"
                    className="min-w-0 flex-1 bg-transparent text-xs text-text-heading outline-none placeholder:text-text-faint"
                  />
                  {searching && (
                    <button
                      type="button"
                      onClick={() => setQuery('')}
                      className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-text-muted hover:text-text-body"
                      aria-label="検索をクリア"
                    >
                      <X className="h-3 w-3" aria-hidden="true" />
                      クリア
                    </button>
                  )}
                </div>
                {searching && (
                  <span className="shrink-0 text-[11px] text-text-muted">
                    {shownTimeline.length}件
                  </span>
                )}
              </div>
            )}

            {/* 前回の申し送り。タイムライン最新1件から抜き出したものなので、同じ並びの先頭に置く */}
            {handover && (
              <div className="rounded-lg border-l-4 border-l-warning bg-warning-subtle p-3">
                <div className="mb-1 flex items-center gap-1.5">
                  <Pin className="h-3.5 w-3.5 shrink-0 text-warning" />
                  <span className="text-xs font-semibold text-warning">前回の申し送り</span>
                  <span className="ml-auto shrink-0 text-xs text-text-faint">
                    {fmtDateJa(handover.date)}
                  </span>
                </div>
                <HandoverBody handover={handover} query={query} />
              </div>
            )}

            {timeline.length === 0 ? (
              <p className="text-sm text-text-muted">面談記録はまだありません</p>
            ) : shownTimeline.length === 0 ? (
              <p className="text-sm text-text-muted">
                「{query.trim()}」を含む面談記録はありません
              </p>
            ) : (
              <div className="flex max-h-[560px] flex-col gap-3 overflow-y-auto">
                {shownTimeline.map((iv) => {
                  const notta = parseNottaSummary(iv.content);
                  const title = iv.title ?? notta?.title ?? null;
                  return (
                    <div
                      key={iv.id}
                      className="rounded-lg border border-border-subtle p-3 transition-colors hover:bg-surface-hover"
                    >
                      <div className="mb-1.5 flex items-center gap-2">
                        <span className="text-xs text-text-faint">
                          {fmtDateJa(iv.interview_date)}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${INTERVIEW_TYPE_COLORS[iv.interview_type]}`}
                        >
                          {INTERVIEW_TYPE_LABELS[iv.interview_type]}
                        </span>
                        {notta && (
                          <span className="inline-flex items-center rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] text-text-faint">
                            Notta
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => setEditingInterview(iv)}
                          className="ml-auto shrink-0 text-xs text-text-muted hover:text-primary"
                        >
                          編集
                        </button>
                      </div>
                      {title && (
                        <p className="mb-1 text-sm font-semibold text-text-heading">
                          <Hl text={title} query={query} />
                        </p>
                      )}
                      {notta ? (
                        <NottaBody summary={notta} query={query} />
                      ) : (
                        <PlainBody content={iv.content} query={query} />
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* 面談記録の一覧全体（フィルタ・削除等）は既存ページに残す */}
            <Link
              href={`/students/${studentId}/interviews`}
              target="_blank"
              className="inline-flex w-fit items-center gap-1.5 border-t border-border-subtle pt-2 text-xs text-text-muted hover:text-primary"
            >
              <ExternalLink className="h-3 w-3" />
              面談記録の全件一覧を開く
            </Link>
          </div>
        )}
      </CardContent>

      {editingInterview && (
        <InterviewModal
          studentId={studentId}
          schoolId={schoolId}
          interview={editingInterview}
          onClose={() => setEditingInterview(null)}
          onSaved={() => {
            setEditingInterview(null);
            onChanged();
          }}
        />
      )}

      {canImportNotta && (
        <ImportNottaModal
          isOpen={nottaOpen}
          onClose={() => setNottaOpen(false)}
          studentId={studentId}
          schoolId={schoolId}
          onSuccess={() => {
            setNottaOpen(false);
            // ★取り込んだ記録がすぐ台本（前回の要望・前回の言葉）にも効くよう、親で読み直す
            onChanged();
            success('Notta文字起こしを面談記録に取り込みました');
          }}
        />
      )}
    </Card>
  );
}
