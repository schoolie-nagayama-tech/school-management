'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Printer, BookOpen } from 'lucide-react';
import { Loading } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { getProposalsByStudent } from '@/lib/api/proposals';
import type { SeasonalProposalWithDetails, SeasonType } from '@/types/database';
import { SEASON_LABELS } from '@/types/database';

interface TextbookRow {
  textbookId: number;
  subject: string;
  grade: string;
  name: string;
  // 生徒がそのテキストを既に所持しているか（student_textbooks.is_owned）
  owned: boolean;
}

interface SeasonGroup {
  key: string;
  season: SeasonType;
  year: number;
  label: string;
  rows: TextbookRow[];
}

const SEASON_ORDER: Record<string, number> = { spring: 1, summer: 2, winter: 3 };

// テキストの対象学年表示（学校種別＋学年）。例: 中学3年
function gradeLabel(schoolType?: string | null, grade?: string | null): string {
  return [schoolType ?? '', grade ?? ''].join('').trim() || '—';
}

// 提案書を期(season+year)ごとにまとめ、使用テキストを重複排除して並べる。
// ownedTextbookIds: その生徒が所持済み(is_owned)のテキストID集合。
function groupTextbooks(
  proposals: SeasonalProposalWithDetails[],
  ownedTextbookIds: Set<number>
): SeasonGroup[] {
  const groups = new Map<string, SeasonGroup>();
  for (const p of proposals) {
    const key = `${p.year}-${p.season}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        season: p.season,
        year: p.year,
        label: `${p.year} ${SEASON_LABELS[p.season] ?? p.season}講習`,
        rows: [],
      };
      groups.set(key, g);
    }
    // テキスト未設定や重複（同一テキストの複数提案）は1行に集約
    if (!p.textbook) continue;
    if (g.rows.some((r) => r.textbookId === p.textbook_id)) continue;
    g.rows.push({
      textbookId: p.textbook_id,
      subject: p.textbook.subject ?? '—',
      grade: gradeLabel(p.textbook.school_type, p.textbook.grade),
      name: p.textbook.name ?? '（名称未設定）',
      owned: ownedTextbookIds.has(p.textbook_id),
    });
  }

  // 各期内は 科目 → 学年 → テキスト名 で並べる
  for (const g of Array.from(groups.values())) {
    g.rows.sort(
      (a, b) =>
        a.subject.localeCompare(b.subject, 'ja') ||
        a.grade.localeCompare(b.grade, 'ja') ||
        a.name.localeCompare(b.name, 'ja')
    );
  }

  // 期は新しい順（年度降順 → 冬→夏→春）
  return Array.from(groups.values()).sort(
    (a, b) => b.year - a.year || (SEASON_ORDER[b.season] ?? 0) - (SEASON_ORDER[a.season] ?? 0)
  );
}

export default function KoushuTextbookList() {
  const params = useParams();
  const studentId = params?.studentId as string;
  const [loading, setLoading] = useState(true);
  const [studentName, setStudentName] = useState('');
  const [proposals, setProposals] = useState<SeasonalProposalWithDetails[]>([]);
  // 所持済み(is_owned)テキストID
  const [ownedIds, setOwnedIds] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: student }, list, { data: ownedRows }] = await Promise.all([
        supabase.from('students').select('last_name, first_name').eq('id', studentId).single(),
        // 単元は使わないので取得しない（includeUnits=false で軽量化）
        getProposalsByStudent(studentId, false),
        supabase
          .from('student_textbooks')
          .select('textbook_id')
          .eq('student_id', studentId)
          .eq('is_owned', true),
      ]);
      if (student) {
        const s = student as { last_name: string; first_name: string };
        setStudentName(`${s.last_name} ${s.first_name}`);
      }
      // 使用テキスト一覧は「実際に使うことが確定したテキスト」を示す一覧のため、
      // 公開済み(approved)の提案書のみを対象にする（下書き・提案済のテキストは含めない）
      setProposals(list.filter((p) => p.status === 'approved'));
      setOwnedIds(
        new Set(((ownedRows ?? []) as { textbook_id: number }[]).map((r) => r.textbook_id))
      );
    } catch (e) {
      console.error('使用テキストの取得に失敗:', e);
      setProposals([]);
      setOwnedIds(new Set());
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    if (studentId) load();
  }, [studentId, load]);

  const groups = useMemo(() => groupTextbooks(proposals, ownedIds), [proposals, ownedIds]);
  const totalTextbooks = useMemo(() => groups.reduce((a, g) => a + g.rows.length, 0), [groups]);

  if (loading) {
    return <Loading className="min-h-[40vh]" label="使用テキストを読み込み中..." />;
  }

  return (
    <div className="koushu-textbook-print">
      {/* ヘッダー（印刷では戻る/印刷ボタンを隠す） */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3 print:hidden">
          <Link
            href={`/students/${studentId}/proposals`}
            className="text-xs text-text-muted hover:text-text-heading inline-flex items-center gap-1 transition-colors duration-150"
          >
            <ArrowLeft className="w-3 h-3" />
            講習提案書
          </Link>
          <span className="text-xs text-text-faint">/</span>
          <span className="text-xs text-text-muted">{studentName}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-text-heading">
              {studentName} さん / 講習 使用テキスト
            </h1>
            <p className="text-xs text-text-muted print:hidden">全{totalTextbooks}冊</p>
          </div>
          {totalTextbooks > 0 && (
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium border border-border-default text-text-body rounded-lg hover:bg-surface-hover active:scale-[0.97] transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] print:hidden"
            >
              <Printer className="w-3 h-3" />
              印刷
            </button>
          )}
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="py-12 text-center text-sm text-text-faint border border-border-default rounded-xl">
          公開済みの講習提案書がまだありません
        </div>
      ) : (
        <div className="space-y-6 print:space-y-3">
          {groups.map((g) => (
            <section
              key={g.key}
              className="rounded-xl border border-border-default overflow-hidden print:break-inside-avoid"
            >
              <div className="flex items-center justify-between bg-surface px-4 py-2 border-b border-border-default print:bg-white">
                <span className="text-sm font-bold text-text-heading print:text-[11px]">
                  {g.label}
                </span>
                <span className="text-xs text-text-muted print:text-[10px]">{g.rows.length}冊</span>
              </div>
              <table className="w-full text-sm print:text-[11px]">
                <thead>
                  <tr className="bg-surface/60 text-text-muted border-b border-border-subtle print:bg-white">
                    <th className="text-left font-semibold px-4 py-2 w-24 print:py-1">科目</th>
                    <th className="text-left font-semibold px-4 py-2 w-28 print:py-1">学年</th>
                    <th className="text-left font-semibold px-4 py-2 print:py-1">テキスト名</th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((r) => (
                    <tr
                      key={r.textbookId}
                      className="border-b border-border-subtle last:border-0 print:break-inside-avoid"
                    >
                      <td className="px-4 py-2 print:py-1">
                        <span className="inline-block px-1.5 py-0.5 rounded bg-info-subtle text-info text-xs print:bg-white print:px-0 print:text-text-heading">
                          {r.subject}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-text-body print:py-1">{r.grade}</td>
                      <td className="px-4 py-2 text-text-heading font-medium print:py-1">
                        <span className="inline-flex items-center gap-1.5">
                          <BookOpen className="w-3.5 h-3.5 text-text-faint shrink-0 print:hidden" />
                          {r.name}
                          {r.owned && (
                            <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-100 text-emerald-700 border border-emerald-200 print:border print:border-text-heading print:bg-white print:text-text-heading">
                              所持
                            </span>
                          )}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
