'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Award, ChevronDown, ClipboardCheck, PencilLine } from 'lucide-react';
import { formatGradeLabel } from '@/lib/utils/gradeLabel';
import {
  ASSESSMENT_NAME_LABELS,
  ASSESSMENT_NAME_OPTIONS,
  SUBJECT_CODES,
  SUBJECT_LABELS,
} from '@/types/database';
import { ScoreSubmitModal } from './ScoreSubmitModal';
import { PortalScoreChart, type ChartDataPoint } from './PortalScoreChart';
import type { PortalAssessment, PortalScoreSubmission } from '@/types/portal-scores';

/**
 * 成績（保護者の入力＋閲覧）— 保護者側（§7-5）。
 *
 * 正典: docs/portal-v2-requirements.md §7-5「Stage 5 詳細仕様: 成績の保護者入力＋閲覧」。
 *
 * 構成（既存 /mypage 配下のデザイン言語に合わせる。ReportsView/ScheduleView と同型）:
 *   兄弟切替タブ → 自分の申請の状態（あれば） → 「成績を入力」ボタン →
 *   成績一覧（カテゴリ別・新しい順・案B: 科目×テストのマトリクス表＋推移グラフのアコーディオン）。
 *
 * ★ 模試は入力対象外（§7-5 三本柱の1）だが、閲覧はスタッフ入力分も含めて全カテゴリ出す
 *   （「スタッフが入れた成績も保護者に見せる」設計判断）。カテゴリの絞り込みは
 *   一覧側にはかけず、入力できるカテゴリだけをモーダル側（ScoreSubmitModal）で絞る。
 */

/** 兄弟切替に使う生徒（親から渡す）。 */
export interface GradesStudent {
  id: string;
  name: string;
  grade: number | null;
}

/**
 * 保護者向けのカテゴリ名。
 * ★ スタッフ用の ASSESSMENT_CATEGORY_LABELS（'学校定期テスト' / '学校内申' / 'COM・模試'）は
 *   内部・ブランド寄りの語（「COM」は模試提供元の略）なので保護者面には出さない。
 *   入力モーダル（ScoreSubmitModal）の「定期テスト / 内申」とも語を揃える。
 */
const PORTAL_CATEGORY_LABELS: Record<PortalAssessment['category'], string> = {
  regular_test: '定期テスト',
  report_card: '内申',
  mock: '模試',
};

/** 科目コードの表示順（5教科＋実技4科＝COMMON_9_SUBJECTS）。未知の科目は末尾に回す。 */
const SUBJECT_ORDER = [
  SUBJECT_CODES.ENGLISH,
  SUBJECT_CODES.MATH,
  SUBJECT_CODES.JAPANESE,
  SUBJECT_CODES.SOCIAL,
  SUBJECT_CODES.SCIENCE,
  SUBJECT_CODES.MUSIC,
  SUBJECT_CODES.ART,
  SUBJECT_CODES.TECH_HOME,
  SUBJECT_CODES.PE,
] as const;

export function GradesView({ students }: { students: GradesStudent[] }) {
  const [studentId, setStudentId] = useState<string | null>(students[0]?.id ?? null);
  const [assessments, setAssessments] = useState<PortalAssessment[]>([]);
  const [submissions, setSubmissions] = useState<PortalScoreSubmission[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const load = useCallback(async () => {
    if (!studentId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/mypage/scores?student_id=${encodeURIComponent(studentId)}`);
      const json = await res.json();
      if (res.ok) {
        setAssessments(json.assessments ?? []);
        setSubmissions(json.submissions ?? []);
      } else {
        setAssessments([]);
        setSubmissions([]);
      }
    } catch {
      setAssessments([]);
      setSubmissions([]);
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    load();
  }, [load]);

  const activeStudent = students.find((s) => s.id === studentId) ?? null;

  // 申請は新しい順。承認済みも含めて全部出す（§7-5「承認待ち/承認済み/差し戻し」の3状態）。
  const sortedSubmissions = useMemo(
    () => [...submissions].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [submissions]
  );

  // カテゴリ別にグルーピングし、各カテゴリ内は新しい順（試験日→実施年月の順で降順比較）。
  const groupedAssessments = useMemo(() => groupAndSort(assessments), [assessments]);

  if (students.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface-raised p-4 text-sm text-text-muted">
        表示できる生徒がいません。教室から届いた招待で生徒を紐づけてください。
      </div>
    );
  }

  return (
    <div>
      {/* 兄弟切替（1人なら出さない） */}
      {students.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {students.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setStudentId(s.id)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                s.id === studentId
                  ? 'border-text-heading bg-text-heading font-semibold text-surface-raised'
                  : 'border-border bg-surface-raised text-text-muted'
              }`}
            >
              {s.name}
              {s.grade != null && `（${formatGradeLabel(s.grade)}）`}
            </button>
          ))}
        </div>
      )}

      {/* 自分の申請の状態 */}
      {sortedSubmissions.length > 0 && (
        <section className="mb-3 rounded-xl border border-border-subtle bg-surface-raised px-3.5 py-3">
          <h2 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-text-muted">
            <ClipboardCheck className="h-[14px] w-[14px]" />
            ご入力いただいた成績
          </h2>
          <ul className="divide-y divide-border-subtle">
            {sortedSubmissions.map((s) => (
              <li key={s.id} className="py-2 first:pt-0 last:pb-0">
                <SubmissionRow submission={s} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 成績を入力ボタン */}
      <div className="mb-3 flex justify-end">
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          disabled={!studentId}
          className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3.5 py-2 text-[13px] font-bold text-surface-raised transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <PencilLine className="h-[14px] w-[14px]" />
          成績を入力
        </button>
      </div>

      {/* 成績一覧 */}
      {loading && assessments.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface-raised p-4 text-sm text-text-muted">
          読み込み中…
        </div>
      ) : groupedAssessments.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface-raised p-4 text-sm text-text-muted">
          まだ成績はありません。
        </div>
      ) : (
        <div className="space-y-4">
          {groupedAssessments.map((g) => (
            <section key={g.category}>
              <h2 className="mb-2 flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-text-muted">
                <Award className="h-[14px] w-[14px]" />
                {PORTAL_CATEGORY_LABELS[g.category]}
              </h2>
              <GradeMatrixCard category={g.category} items={g.items} />
            </section>
          ))}
        </div>
      )}

      {modalOpen && studentId && (
        <ScoreSubmitModal
          studentId={studentId}
          defaultGrade={activeStudent?.grade ?? null}
          onClose={() => setModalOpen(false)}
          onSubmitted={() => {
            setModalOpen(false);
            load();
          }}
        />
      )}
    </div>
  );
}

// ============================================================
// 自分の申請1件
// ============================================================

/**
 * 状態バッジ（装飾に色を使わない・状態のみ）: 確認中=warning／登録済み=success／修正のお願い=primary。
 * ★ 文言はスタッフ内部の「承認待ち/承認済み/差し戻し」を使わない（2026-07-21 FB「偉そう」）:
 *   保護者は手元の原本からわざわざ入力してくれている側。塾が上から「承認する」関係ではないので、
 *   保護者面は「教室が受け取って確認・登録する」目線の言葉に置き換える。
 *   （スタッフ側の承認キュー・バナーは内部ワークフロー用語のままでよい）
 */
const STATUS_BADGE: Record<PortalScoreSubmission['status'], { label: string; className: string }> =
  {
    submitted: { label: '教室で確認中', className: 'bg-warning-subtle text-warning' },
    approved: { label: '登録済み', className: 'bg-success-subtle text-success' },
    rejected: { label: '修正のお願い', className: 'bg-primary-subtle text-primary-dark' },
  };

function SubmissionRow({ submission }: { submission: PortalScoreSubmission }) {
  const badge = STATUS_BADGE[submission.status];
  const title = [
    PORTAL_CATEGORY_LABELS[submission.category],
    ASSESSMENT_NAME_LABELS[submission.nameCode] ?? submission.nameCode,
  ].join(' ・ ');

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[13px] font-semibold text-text-heading">{title}</span>
        <span className="text-[11px] text-text-muted">
          {formatGradeLabel(submission.grade)}
          {submission.examMonth && ` ・ ${formatExamMonth(submission.examMonth)}`}
        </span>
        <span className={`rounded-full px-2 py-[1.5px] text-[9.5px] font-bold ${badge.className}`}>
          {badge.label}
        </span>
      </div>
      {/* 差し戻し理由は保護者への返答そのものなので必ず表示する（§7-5）。 */}
      {submission.status === 'rejected' && submission.rejectedReason && (
        <p className="mt-1 rounded-lg bg-primary-subtle px-2.5 py-1.5 text-[12px] text-primary-dark">
          {submission.rejectedReason}
        </p>
      )}
    </div>
  );
}

// ============================================================
// 成績一覧（案B: 科目×テストのマトリクス表＋推移グラフのアコーディオン）
// ============================================================

/**
 * カテゴリ1つぶんのマトリクス表カード。
 * 列=そのカテゴリのテスト（新しい順・左が最新）、行=登場する科目の和集合。
 * 定期テスト・内申には合計行を出す（模試は偏差値なので出さない）。
 * テストが2件以上あるときだけ、下に推移グラフのアコーディオンを付ける。
 */
function GradeMatrixCard({
  category,
  items,
}: {
  category: PortalAssessment['category'];
  items: PortalAssessment[];
}) {
  const subjectCodes = useMemo(() => unionSubjectCodes(items), [items]);
  // 模試は偏差値なので合計を出す意味がない（§仕様どおり定期テスト・内申のみ）。
  const showTotalRow = category === 'regular_test' || category === 'report_card';

  return (
    <div className="overflow-hidden rounded-xl border border-border-subtle bg-surface-raised">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {/* 左上コーナー。sticky列の一部として不透明な背景を必ず付ける（横スクロール時に下の内容が透けないように）。 */}
              <th className="sticky left-0 z-10 bg-surface-raised px-3 py-2" />
              {items.map((a) => {
                const period = formatShortPeriod(a.examMonth, a.examDate);
                return (
                  <th key={a.id} className="whitespace-nowrap px-3 py-2 text-right font-normal">
                    <div className="text-[11px] font-semibold text-text-heading">
                      {ASSESSMENT_NAME_LABELS[a.nameCode] ?? a.nameCode}
                    </div>
                    {period && <div className="text-[10px] text-text-muted">{period}</div>}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {subjectCodes.map((code) => (
              <tr key={code}>
                <td className="sticky left-0 z-10 whitespace-nowrap border-r border-border-subtle bg-surface-raised px-3 py-2 text-[12px] text-text-body">
                  {SUBJECT_LABELS[code] ?? code}
                </td>
                {items.map((a, index) => {
                  const value = a.scores[code];
                  const hasValue = value != null;
                  return (
                    <td
                      key={a.id}
                      className={`px-3 py-2 text-right text-sm tabular-nums ${
                        !hasValue
                          ? 'text-text-faint'
                          : index === 0
                            ? 'font-semibold text-text-heading'
                            : 'text-text-body'
                      }`}
                    >
                      {hasValue ? value : '–'}
                    </td>
                  );
                })}
              </tr>
            ))}
            {showTotalRow && (
              <tr>
                <td className="sticky left-0 z-10 whitespace-nowrap border-r border-t border-border bg-surface-raised px-3 py-2 text-[12px] font-bold text-text-body">
                  合計
                </td>
                {items.map((a, index) => {
                  // 合計はそのカテゴリの表に出している科目（subjectCodes）のぶんだけを足す。
                  const total = subjectCodes.reduce((sum, code) => {
                    const value = a.scores[code];
                    return value != null ? sum + value : sum;
                  }, 0);
                  return (
                    <td
                      key={a.id}
                      className={`border-t border-border px-3 py-2 text-right text-sm font-bold tabular-nums ${
                        index === 0 ? 'text-text-heading' : 'text-text-body'
                      }`}
                    >
                      {total}
                    </td>
                  );
                })}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {/* 推移が意味を持つのはテストが2件以上あるときだけ。1件では点が1つでグラフにならない。 */}
      {items.length >= 2 && <GraphAccordion category={category} items={items} />}
    </div>
  );
}

/**
 * マトリクス表の下に付く「グラフで推移を見る」アコーディオン。
 * ★ 開いたときだけ PortalScoreChart をマウントする理由:
 *   recharts の ResponsiveContainer は display:none（閉じた状態をCSSで隠すだけ）だと
 *   親要素の幅を0として計測してしまい、グラフが正しく描画されない。よって
 *   開閉は「マウントするかどうか」で行い、CSSで隠すだけの実装にしないこと。
 */
function GraphAccordion({
  category,
  items,
}: {
  category: PortalAssessment['category'];
  items: PortalAssessment[];
}) {
  const [open, setOpen] = useState(false);

  // 表は新しい順（左が最新）で並べるが、折れ線グラフは時系列の慣習（左→右で時間が進む）
  // に合わせるため、逆順にして古い→新しいで渡す。
  const chartData = useMemo<ChartDataPoint[]>(
    () =>
      [...items].reverse().map((a) => ({
        label: ASSESSMENT_NAME_LABELS[a.nameCode] ?? a.nameCode,
        english: a.scores[SUBJECT_CODES.ENGLISH] ?? null,
        math: a.scores[SUBJECT_CODES.MATH] ?? null,
        japanese: a.scores[SUBJECT_CODES.JAPANESE] ?? null,
        science: a.scores[SUBJECT_CODES.SCIENCE] ?? null,
        social: a.scores[SUBJECT_CODES.SOCIAL] ?? null,
      })),
    [items]
  );

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between border-t border-border-subtle px-3.5 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-surface-hover"
      >
        グラフで推移を見る
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-3.5 py-3">
          <PortalScoreChart data={chartData} category={category} />
        </div>
      )}
    </div>
  );
}

// ============================================================
// ヘルパー
// ============================================================

/** カテゴリごとにグルーピングし、各カテゴリ内を新しい順（試験日→実施年月）に並べる。 */
function groupAndSort(
  assessments: PortalAssessment[]
): { category: PortalAssessment['category']; items: PortalAssessment[] }[] {
  const order: PortalAssessment['category'][] = ['regular_test', 'report_card', 'mock'];
  const map = new Map<PortalAssessment['category'], PortalAssessment[]>();
  for (const a of assessments) {
    if (!map.has(a.category)) map.set(a.category, []);
    map.get(a.category)!.push(a);
  }
  // Map/Set の直接イテレーションは tsconfig の target/downlevelIteration の制約で使えないため
  // forEach で回す（このプロジェクトの既定設定に合わせる）。
  map.forEach((items) => {
    items.sort((a, b) => {
      const aKey = a.examDate ?? a.examMonth ?? '';
      const bKey = b.examDate ?? b.examMonth ?? '';
      if (aKey !== bKey) return bKey.localeCompare(aKey);
      // 内申（report_card）は年月を持たない運用があり、上の日付比較では並ばない。
      // テスト名の定義順（term1 → term2 → year_end …＝学年の進行順）を第2キーにして、
      // 後の学期ほど「新しい」＝左（先頭）に来るようにする。
      const ai = nameOrderIndex(a.category, a.nameCode);
      const bi = nameOrderIndex(b.category, b.nameCode);
      if (ai !== bi) return bi - ai;
      return b.grade - a.grade;
    });
  });
  return order.filter((c) => map.has(c)).map((c) => ({ category: c, items: map.get(c)! }));
}

/**
 * テスト名コードの、そのカテゴリの定義順（ASSESSMENT_NAME_OPTIONS）でのインデックス。
 * 定義は学年内の時系列（1学期中間→1学期期末→2学期…）に並んでいるので、
 * 大きいほど「後の時期＝新しい」とみなせる。未知コードは -1（末尾扱い）。
 */
function nameOrderIndex(category: PortalAssessment['category'], nameCode: string): number {
  const options = ASSESSMENT_NAME_OPTIONS[category] as readonly { code: string }[] | undefined;
  if (!options) return -1;
  return options.findIndex((o) => o.code === nameCode);
}

/**
 * カテゴリ内の全テストに登場する科目コードの和集合を、表示順（SUBJECT_ORDER→未知の科目）で返す。
 * マトリクス表の行（科目）を決めるために使う。
 */
function unionSubjectCodes(items: PortalAssessment[]): string[] {
  const seen = new Set<string>();
  items.forEach((item) => {
    Object.keys(item.scores).forEach((code) => seen.add(code));
  });
  const known = SUBJECT_ORDER.filter((code) => seen.has(code));
  const rest = Array.from(seen).filter(
    (code) => !(SUBJECT_ORDER as readonly string[]).includes(code)
  );
  return [...known, ...rest];
}

/** 'YYYY-MM' → '2026年7月'。null はそのまま null。 */
function formatExamMonth(examMonth: string | null): string | null {
  if (!examMonth) return null;
  const [y, m] = examMonth.split('-').map(Number);
  if (!y || !m) return examMonth;
  return `${y}年${m}月`;
}

/**
 * マトリクス表の列ヘッダー用に年月を短く整形する（例: '26/10）。
 * examDate（'YYYY-MM-DD'）があればそちらを優先し、無ければ examMonth（'YYYY-MM'）を使う。
 * 内申のように両方 null のときは null（＝列ヘッダーは名称のみになる）。
 */
function formatShortPeriod(
  examMonth: string | null,
  examDate: string | null | undefined
): string | null {
  const source = examDate ?? examMonth;
  if (!source) return null;
  const [y, m] = source.split('-').map(Number);
  if (!y || !m) return null;
  return `'${String(y).slice(-2)}/${m}`;
}
