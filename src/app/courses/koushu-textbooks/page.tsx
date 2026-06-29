'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Printer, Search } from 'lucide-react';
import { AdminLayout } from '@/components/layouts';
import { Loading } from '@/components/ui';
import AccessDenied from '@/components/AccessDenied';
import { useAuth } from '@/contexts/AuthContext';
import { useRequirePermission } from '@/hooks/usePermissions';
import { useLocalSchoolId } from '@/hooks/useLocalSchoolId';
import { SchoolSwitcher } from '@/components/SchoolSwitcher';
import { SeasonYearSelector } from '@/components/course-shared/SeasonYearSelector';
import { getProposalsBySchool } from '@/lib/api/proposals';
import { getCurrentSeason } from '@/components/proposals/proposalEditor.shared';
import type { SeasonalProposalWithDetails, SeasonType, Student } from '@/types/database';
import { SEASON_LABELS, GRADE_LABELS } from '@/types/database';

interface TextbookRow {
  textbookId: number;
  subject: string;
  // テキストの対象学年（学校種別＋学年）。例: 中学3年
  grade: string;
  name: string;
}

// テキストの対象学年表示（学校種別＋学年）
function textbookGradeLabel(schoolType?: string | null, grade?: string | null): string {
  return [schoolType ?? '', grade ?? ''].join('').trim() || '—';
}

interface StudentRoster {
  student: Student;
  gradeLabel: string;
  textbooks: TextbookRow[];
}

// 提案書を生徒ごとにまとめ、使用テキストを重複排除して並べる
function buildRoster(proposals: SeasonalProposalWithDetails[]): StudentRoster[] {
  const map = new Map<string, StudentRoster>();
  for (const p of proposals) {
    const student = p.student;
    if (!student || !p.textbook) continue;
    let r = map.get(student.id);
    if (!r) {
      r = {
        student,
        gradeLabel:
          student.grade != null ? (GRADE_LABELS[student.grade] ?? `${student.grade}`) : '—',
        textbooks: [],
      };
      map.set(student.id, r);
    }
    if (r.textbooks.some((t) => t.textbookId === p.textbook_id)) continue;
    r.textbooks.push({
      textbookId: p.textbook_id,
      subject: p.textbook.subject ?? '—',
      grade: textbookGradeLabel(p.textbook.school_type, p.textbook.grade),
      name: p.textbook.name ?? '（名称未設定）',
    });
  }

  // 生徒内は 科目 → テキスト名
  for (const r of Array.from(map.values())) {
    r.textbooks.sort(
      (a, b) => a.subject.localeCompare(b.subject, 'ja') || a.name.localeCompare(b.name, 'ja')
    );
  }

  // 生徒は 学年 → ふりがな → 氏名 で並べる
  return Array.from(map.values()).sort((a, b) => {
    const ga = a.student.grade ?? 99;
    const gb = b.student.grade ?? 99;
    if (ga !== gb) return ga - gb;
    const ka = a.student.last_name_kana ?? a.student.last_name ?? '';
    const kb = b.student.last_name_kana ?? b.student.last_name ?? '';
    return ka.localeCompare(kb, 'ja');
  });
}

export default function KoushuTextbookRosterPage() {
  const { hasPermission, isLoading: permLoading } = useRequirePermission((p) => p.canAccessCourses);
  const { getSelectedSchoolIds } = useAuth();
  const { localSchoolId, setLocalSchoolId, isAllSelected, availableSchools } = useLocalSchoolId();

  const [season, setSeason] = useState<SeasonType>(() => getCurrentSeason());
  const [year, setYear] = useState<number>(() => new Date().getFullYear());
  const [proposals, setProposals] = useState<SeasonalProposalWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const schoolIds = getSelectedSchoolIds();
      const data = await getProposalsBySchool(schoolIds, season, year);
      setProposals(data);
    } catch (e) {
      console.error('使用テキスト一覧の取得に失敗:', e);
      setProposals([]);
    } finally {
      setLoading(false);
    }
  }, [getSelectedSchoolIds, season, year, localSchoolId]);

  useEffect(() => {
    if (hasPermission) load();
  }, [hasPermission, load]);

  const roster = useMemo(() => buildRoster(proposals), [proposals]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return roster;
    return roster.filter((r) => {
      const name = `${r.student.last_name ?? ''}${r.student.first_name ?? ''}`.toLowerCase();
      const kana =
        `${r.student.last_name_kana ?? ''}${r.student.first_name_kana ?? ''}`.toLowerCase();
      return name.includes(q) || kana.includes(q);
    });
  }, [roster, search]);

  const totalBooks = useMemo(
    () => filtered.reduce((a, r) => a + r.textbooks.length, 0),
    [filtered]
  );

  if (permLoading) {
    return (
      <AdminLayout headerTitle="講習 使用テキスト一覧">
        <Loading className="min-h-[60vh]" />
      </AdminLayout>
    );
  }
  if (!hasPermission) {
    return (
      <AdminLayout headerTitle="講習 使用テキスト一覧">
        <AccessDenied />
      </AdminLayout>
    );
  }

  return (
    <AdminLayout headerTitle="講習 使用テキスト一覧">
      <div className="koushu-textbook-print">
        {/* ヘッダー（印刷では操作系を隠す） */}
        <div className="mb-4 print:hidden">
          <Link
            href="/courses/proposals"
            className="text-xs text-text-muted hover:text-text-heading inline-flex items-center gap-1 transition-colors duration-150"
          >
            <ArrowLeft className="w-3 h-3" />
            提案書一覧
          </Link>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2 print:hidden">
            <SeasonYearSelector
              season={season}
              year={year}
              onSeasonChange={setSeason}
              onYearChange={setYear}
            />
            {isAllSelected && (
              <SchoolSwitcher
                schools={availableSchools}
                selectedSchoolId={localSchoolId}
                onChange={setLocalSchoolId}
              />
            )}
          </div>
          {/* 印刷時の見出し（画面では h1 を別途出す） */}
          <h1 className="hidden print:block text-sm font-bold text-text-heading">
            {year} {SEASON_LABELS[season]}講習 使用テキスト一覧
          </h1>
          <div className="flex items-center gap-2 print:hidden">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-faint" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="生徒名で検索..."
                className="pl-8 pr-3 py-1.5 text-xs border border-border-default rounded-lg bg-surface-raised w-48 focus:outline-none focus:ring-1 focus:ring-ink/30"
              />
            </div>
            {filtered.length > 0 && (
              <button
                onClick={() => window.print()}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium border border-border-default text-text-body rounded-lg hover:bg-surface-hover active:scale-[0.97] transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]"
              >
                <Printer className="w-3 h-3" />
                印刷
              </button>
            )}
          </div>
        </div>

        {!loading && filtered.length > 0 && (
          <p className="text-xs text-text-muted mb-2 print:text-[10px]">
            {filtered.length}名 / {totalBooks}冊
          </p>
        )}

        {loading ? (
          <Loading className="min-h-[40vh]" label="使用テキストを読み込み中..." />
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-text-faint border border-border-default rounded-xl">
            {year} {SEASON_LABELS[season]}講習の提案書がありません
          </div>
        ) : (
          <div className="rounded-xl border border-border-default overflow-hidden">
            <table className="w-full text-sm print:text-[11px]">
              <thead>
                <tr className="bg-surface text-text-muted border-b border-border-default print:bg-white">
                  <th className="text-left font-semibold px-4 py-2 w-44 print:py-1">生徒名</th>
                  <th className="text-left font-semibold px-4 py-2 w-20 print:py-1">学年</th>
                  <th className="text-left font-semibold px-4 py-2 w-24 print:py-1">科目</th>
                  <th className="text-left font-semibold px-4 py-2 w-24 print:py-1">
                    テキスト学年
                  </th>
                  <th className="text-left font-semibold px-4 py-2 print:py-1">テキスト名</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  // 1生徒 = 複数テキスト行。氏名・学年は先頭行に rowspan で1回だけ表示。
                  <Fragment key={r.student.id}>
                    {r.textbooks.map((t, idx) => (
                      <tr
                        key={`${r.student.id}-${t.textbookId}`}
                        className="border-b border-border-subtle last:border-0 print:break-inside-avoid"
                      >
                        {idx === 0 && (
                          <>
                            <td
                              rowSpan={r.textbooks.length}
                              className="px-4 py-2 align-top text-text-heading font-medium border-r border-border-subtle print:py-1"
                            >
                              {r.student.last_name} {r.student.first_name}
                            </td>
                            <td
                              rowSpan={r.textbooks.length}
                              className="px-4 py-2 align-top text-text-body border-r border-border-subtle print:py-1"
                            >
                              {r.gradeLabel}
                            </td>
                          </>
                        )}
                        <td className="px-4 py-2 print:py-1">
                          <span className="inline-block px-1.5 py-0.5 rounded bg-info-subtle text-info text-xs print:bg-white print:px-0 print:text-text-heading">
                            {t.subject}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-text-body print:py-1">{t.grade}</td>
                        <td className="px-4 py-2 text-text-heading print:py-1">{t.name}</td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
