'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, FileText, Filter, Plus, Printer, Search, Trash2 } from 'lucide-react';
import { AdminLayout } from '@/components/layouts';
import { InlineLoading, Loading } from '@/components/ui';
import { useAuth } from '@/contexts/AuthContext';
import { useRequirePermission } from '@/hooks/usePermissions';
import AccessDenied from '@/components/AccessDenied';
import { getProposalsBySchool, getTextbookUnitsWithProgress, calcTotalKoma, calcTotalAppliedKoma, deleteProposal } from '@/lib/api/proposals';
import { supabase } from '@/lib/supabase';
import type { SeasonalProposalWithDetails, SeasonType, ProposalStatus } from '@/types/database';
import { SEASON_LABELS, PROPOSAL_STATUS_LABELS } from '@/types/database';
import { useLocalSchoolId } from '@/hooks/useLocalSchoolId';
import { SchoolSwitcher } from '@/components/SchoolSwitcher';
import { ProposalPrintView } from '@/components/proposals/ProposalPrintView';
import type { PrintUnitDraft, ProposalPrintData } from '@/components/proposals/ProposalPrintView';

const STATUS_BADGE: Record<ProposalStatus, string> = {
  draft: 'bg-surface-hover text-text-muted',
  sent: 'bg-info-subtle text-info',
  approved: 'bg-info-subtle text-info',
};

const VISIBLE_STATUSES: ProposalStatus[] = ['draft', 'sent'];

const STATUS_FILTER_ACTIVE: Record<string, string> = {
  draft: 'bg-text-muted text-white',
  sent: 'bg-info text-white',
};

const STATUS_FILTER_INACTIVE: Record<string, string> = {
  draft: 'bg-surface-hover text-text-muted hover:bg-border-default',
  sent: 'bg-info-subtle text-info hover:bg-info/15',
};

const SUBJECT_BADGE_COLORS: Record<string, { bg: string; text: string }> = {
  '英語': { bg: 'bg-blue-50', text: 'text-blue-700' },
  '数学': { bg: 'bg-red-50', text: 'text-red-700' },
  '算数': { bg: 'bg-red-50', text: 'text-red-700' },
  '国語': { bg: 'bg-green-50', text: 'text-green-700' },
  '理科': { bg: 'bg-amber-50', text: 'text-amber-700' },
  '社会': { bg: 'bg-purple-50', text: 'text-purple-700' },
};
const DEFAULT_BADGE_COLOR = { bg: 'bg-gray-100', text: 'text-gray-600' };

interface StudentOption {
  id: string;
  last_name: string;
  first_name: string;
}

function getCurrentSeason(): SeasonType {
  const month = new Date().getMonth() + 1;
  if (month >= 2 && month <= 4) return 'spring';
  if (month >= 5 && month <= 9) return 'summer';
  return 'winter';
}

export default function CourseProposalsPage() {
  const router = useRouter();
  const { hasPermission, isLoading: permissionLoading } = useRequirePermission(
    (p) => p.canAccessCourses
  );
  const { schoolIds, selectedSchoolId, getSelectedSchoolIds } = useAuth();
  const { localSchoolId, setLocalSchoolId, isAllSelected, availableSchools } = useLocalSchoolId();

  const [proposals, setProposals] = useState<SeasonalProposalWithDetails[]>([]);
  const [loading, setLoading] = useState(true);

  const currentYear = new Date().getFullYear();
  const [filterYear, setFilterYear] = useState<number>(currentYear);
  const [filterSeason, setFilterSeason] = useState<SeasonType | ''>('');
  const [filterStatus, setFilterStatus] = useState<ProposalStatus | ''>('');

  // Student picker
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const pickerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [printMode, setPrintMode] = useState(false);
  const [printLoading, setPrintLoading] = useState<string | null>(null);
  const [printData, setPrintData] = useState<ProposalPrintData[]>([]);
  const [printStudentName, setPrintStudentName] = useState('');

  const handlePrintStudent = async (studentId: string, studentName: string, studentProposals: SeasonalProposalWithDetails[]) => {
    if (studentProposals.length === 0) return;
    setPrintLoading(studentId);
    try {
      const results: ProposalPrintData[] = [];
      const sorted = [...studentProposals].sort((a, b) => {
        const sa = a.textbook?.subject ?? '';
        const sb = b.textbook?.subject ?? '';
        if (sa !== sb) return sa.localeCompare(sb, 'ja');
        const na = a.textbook?.name ?? '';
        const nb = b.textbook?.name ?? '';
        return na.localeCompare(nb, 'ja');
      });
      for (const p of sorted) {
        const { items, progressMap } = await getTextbookUnitsWithProgress(
          p.student_textbook_id ?? null,
          p.textbook_id
        );
        const activeUnits: PrintUnitDraft[] = p.units
          .filter((u) => u.koma_count > 0)
          .map((u) => ({
            curriculum_item_id: u.curriculum_item_id,
            koma_count: u.koma_count,
            applied_koma: u.applied_koma ?? 0,
            reason: u.reason,
            group_id: u.group_id,
            intent_tag: u.intent_tag ?? null,
          }));
        const groupMap = new Map<number, PrintUnitDraft[]>();
        for (const u of activeUnits) {
          if (u.group_id > 0) {
            const list = groupMap.get(u.group_id) ?? [];
            list.push(u);
            groupMap.set(u.group_id, list);
          }
        }
        const tbName = p.textbook?.subject
          ? `${p.textbook.subject} ${p.textbook.name}`
          : p.textbook?.name ?? '';
        results.push({
          studentName,
          textbookName: tbName,
          seasonLabel: SEASON_LABELS[p.season as SeasonType],
          year: p.year,
          theme: p.theme,
          allItems: items,
          activeUnits,
          progressMap,
          totalKoma: calcTotalKoma(p.units),
          groupMap,
        });
      }
      setPrintData(results);
      setPrintStudentName(studentName);
      setPrintMode(true);
      setTimeout(() => window.print(), 300);
    } catch {
      // print error
    } finally {
      setPrintLoading(null);
    }
  };

  const handleDelete = async (proposalId: string) => {
    if (!confirm('この提案書を削除しますか？')) return;
    setDeletingId(proposalId);
    try {
      await deleteProposal(proposalId);
      setProposals((prev) => prev.filter((p) => p.id !== proposalId));
    } catch {
      // handled by optimistic removal already
    } finally {
      setDeletingId(null);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const schoolIds = getSelectedSchoolIds();
      const data = await getProposalsBySchool(
        schoolIds,
        filterSeason || undefined,
        filterYear || undefined
      );
      setProposals(data);
    } catch {
      // load error — empty state shown
    } finally {
      setLoading(false);
    }
  }, [localSchoolId, filterYear, filterSeason, getSelectedSchoolIds]);

  useEffect(() => {
    if (hasPermission) load();
  }, [hasPermission, load]);

  const loadStudents = useCallback(async () => {
    setStudentsLoading(true);
    try {
      const ids = selectedSchoolId && selectedSchoolId !== 'all'
        ? [selectedSchoolId]
        : getSelectedSchoolIds();
      if (ids.length === 0) {
        setStudents([]);
        return;
      }
      const { data, error } = await supabase
        .from('students')
        .select('id, last_name, first_name')
        .in('school_id', ids)
        .eq('status', 'active')
        .is('deleted_at', null)
        .order('last_name');
      if (error) throw error;
      setStudents((data ?? []) as StudentOption[]);
    } catch {
      setStudents([]);
    } finally {
      setStudentsLoading(false);
    }
  }, [schoolIds, selectedSchoolId, getSelectedSchoolIds]);

  const openPicker = useCallback(() => {
    setPickerOpen(true);
    setPickerQuery('');
    loadStudents();
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [loadStudents]);

  useEffect(() => {
    if (!pickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [pickerOpen]);

  const filteredStudents = pickerQuery
    ? students.filter((s) =>
        `${s.last_name}${s.first_name}`.includes(pickerQuery)
      )
    : students;

  const handleSelectStudent = (studentId: string) => {
    setPickerOpen(false);
    const season = getCurrentSeason();
    router.push(`/students/${studentId}/proposals/new?season=${season}&year=${currentYear}`);
  };

  if (permissionLoading) {
    return (
      <AdminLayout headerTitle="提案書">
        <Loading />
      </AdminLayout>
    );
  }

  if (!hasPermission) {
    return (
      <AdminLayout headerTitle="提案書">
        <AccessDenied />
      </AdminLayout>
    );
  }

  if (printMode) {
    return (
      <AdminLayout headerTitle="提案書">
        <div className="max-w-5xl mx-auto">
          <div className="mb-4 flex gap-2 print:hidden">
            <button
              onClick={() => setPrintMode(false)}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium border border-border-default text-text-body rounded-lg hover:bg-surface-hover transition-colors duration-150"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              一覧に戻る
            </button>
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-ink text-text-on-primary rounded-lg hover:brightness-[0.85] transition-[filter] duration-150"
            >
              <Printer className="w-3.5 h-3.5" />
              印刷
            </button>
            <span className="text-sm text-text-muted self-center ml-2">{printStudentName} ({printData.length}件)</span>
          </div>
          <div className="space-y-8">
            {printData.map((data, i) => (
              <div key={i} className="print:break-before-page first:print:break-before-auto">
                <ProposalPrintView {...data} />
              </div>
            ))}
          </div>
        </div>
      </AdminLayout>
    );
  }

  const filtered = filterStatus
    ? proposals.filter((p) =>
        filterStatus === 'sent'
          ? p.status === 'sent' || p.status === 'approved'
          : p.status === filterStatus
      )
    : proposals;

  const byStudent = new Map<string, { name: string; studentId: string; proposals: SeasonalProposalWithDetails[] }>();
  for (const p of filtered) {
    const sid = p.student_id;
    const sName = p.student
      ? `${p.student.last_name} ${p.student.first_name}`
      : '不明';
    if (!byStudent.has(sid)) {
      byStudent.set(sid, { name: sName, studentId: sid, proposals: [] });
    }
    byStudent.get(sid)!.proposals.push(p);
  }

  const statusCounts: Record<string, number> = { draft: 0, sent: 0 };
  for (const p of proposals) {
    const key = p.status === 'approved' ? 'sent' : p.status;
    statusCounts[key] = (statusCounts[key] ?? 0) + 1;
  }

  return (
    <AdminLayout headerTitle="提案書">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-lg font-bold text-text-heading">講習提案書</h1>
            {!loading && filtered.length > 0 && (
              <p className="text-xs text-text-muted mt-0.5">
                {byStudent.size}名 / {filtered.length}件
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isAllSelected && (
              <SchoolSwitcher
                schools={availableSchools}
                selectedSchoolId={localSchoolId}
                onChange={setLocalSchoolId}
              />
            )}
            <div className="relative" ref={pickerRef}>
              <button
                onClick={openPicker}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-ink text-text-on-primary rounded-lg hover:brightness-[0.85] active:scale-[0.97] transition-[filter,transform] duration-150 ease-out"
              >
                <Plus className="w-3 h-3" />
                新規作成
              </button>
              {pickerOpen && (
                <div className="absolute right-0 top-full mt-1 w-64 bg-surface-raised border border-border-default rounded-xl shadow-lg z-50 overflow-hidden">
                  <div className="p-2 border-b border-border-subtle">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-faint" />
                      <input
                        ref={inputRef}
                        type="text"
                        value={pickerQuery}
                        onChange={(e) => setPickerQuery(e.target.value)}
                        placeholder="生徒を検索..."
                        className="w-full pl-8 pr-3 py-1.5 text-xs border border-border-default rounded-lg bg-surface-raised text-text-body placeholder:text-text-faint focus:outline-none focus:ring-1 focus:ring-ink/30"
                      />
                    </div>
                  </div>
                  <div className="max-h-60 overflow-y-auto">
                    {studentsLoading ? (
                      <div className="py-4 text-center text-xs text-text-faint">読み込み中...</div>
                    ) : filteredStudents.length === 0 ? (
                      <div className="py-4 text-center text-xs text-text-faint">該当する生徒がいません</div>
                    ) : (
                      filteredStudents.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => handleSelectStudent(s.id)}
                          className="w-full text-left px-3 py-2 text-sm text-text-body hover:bg-surface-hover transition-colors duration-150"
                        >
                          {s.last_name} {s.first_name}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex gap-2 mb-4">
          {VISIBLE_STATUSES.map((status) => (
            <button
              key={status}
              onClick={() => setFilterStatus(filterStatus === status ? '' : status)}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg active:scale-[0.97] transition-[background-color,color,transform] duration-150 ease-out ${
                filterStatus === status
                  ? STATUS_FILTER_ACTIVE[status]
                  : STATUS_FILTER_INACTIVE[status]
              }`}
            >
              {PROPOSAL_STATUS_LABELS[status]} {statusCounts[status] ?? 0}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3 mb-4 text-xs">
          <Filter className="w-3.5 h-3.5 text-text-faint" />
          <select
            value={filterYear}
            onChange={(e) => setFilterYear(Number(e.target.value))}
            className="px-2 py-1 border border-border-default rounded-lg text-xs bg-surface-raised text-text-body"
          >
            {[currentYear + 1, currentYear, currentYear - 1].map((y) => (
              <option key={y} value={y}>{y}年</option>
            ))}
          </select>
          <select
            value={filterSeason}
            onChange={(e) => setFilterSeason(e.target.value as SeasonType | '')}
            className="px-2 py-1 border border-border-default rounded-lg text-xs bg-surface-raised text-text-body"
          >
            <option value="">全シーズン</option>
            {(['spring', 'summer', 'winter'] as SeasonType[]).map((s) => (
              <option key={s} value={s}>{SEASON_LABELS[s]}</option>
            ))}
          </select>
        </div>

        {loading ? (
          <Loading size="md" />
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-text-faint">
            該当する提案書はありません
          </div>
        ) : (
          <div className="space-y-4">
            {Array.from(byStudent.values()).map(({ name, studentId, proposals: studentProposals }) => (
              <div key={studentId} className="bg-surface-raised rounded-xl border border-border-default overflow-hidden">
                <div className="px-4 py-2.5 border-b border-border-subtle bg-surface-hover/50 flex items-center justify-between">
                  <Link
                    href={`/students/${studentId}/proposals`}
                    className="font-semibold text-sm text-text-heading hover:text-accent-ink transition-colors duration-150"
                  >
                    {name}
                  </Link>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => handlePrintStudent(studentId, name, studentProposals)}
                      disabled={printLoading === studentId}
                      className="p-1 text-text-faint hover:text-text-heading transition-colors duration-150 disabled:opacity-50"
                      title="この生徒の提案書を印刷"
                    >
                      {printLoading === studentId ? (
                        <InlineLoading size="sm" />
                      ) : (
                        <Printer className="w-3.5 h-3.5" />
                      )}
                    </button>
                    <Link
                      href={`/students/${studentId}/proposals/new?season=${getCurrentSeason()}&year=${currentYear}`}
                      className="text-text-muted hover:text-text-heading transition-colors duration-150"
                      title="この生徒の提案書を作成"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                </div>
                <div className="divide-y divide-border-subtle">
                  {studentProposals.map((p) => {
                    const koma = calcTotalKoma(p.units);
                    const appliedKoma = calcTotalAppliedKoma(p.units);
                    return (
                      <div
                        key={p.id}
                        className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-hover transition-[background-color] duration-100 ease-out group"
                      >
                        <Link href={`/students/${studentId}/proposals/${p.id}`} className="flex items-center gap-3 flex-1 min-w-0">
                          <FileText className="w-4 h-4 text-text-faint shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-text-heading truncate flex items-center gap-1.5">
                              {p.textbook?.subject && (() => {
                                const colors = SUBJECT_BADGE_COLORS[p.textbook!.subject!] ?? DEFAULT_BADGE_COLOR;
                                return (
                                  <span className={`inline-flex px-1.5 py-0.5 text-[10px] font-bold rounded shrink-0 ${colors.bg} ${colors.text}`}>
                                    {p.textbook!.subject}
                                  </span>
                                );
                              })()}
                              <span className="truncate">{p.textbook?.name ?? '不明'}</span>
                            </div>
                            <div className="text-xs text-text-muted flex gap-2">
                              <span>{p.theme || `${p.year}年 ${SEASON_LABELS[p.season]}`}</span>
                              {p.units.length > 0 ? (
                                <>
                                  <span>{p.units.length}単元 / {koma}コマ</span>
                                  {appliedKoma != null && (
                                    <span className="text-info">申込 {appliedKoma}コマ</span>
                                  )}
                                </>
                              ) : (
                                <span className="text-text-faint">未設定</span>
                              )}
                            </div>
                          </div>
                        </Link>
                        <span
                          className={`px-2 py-0.5 text-[10px] font-bold rounded shrink-0 ${STATUS_BADGE[p.status]}`}
                        >
                          {PROPOSAL_STATUS_LABELS[p.status]}
                        </span>
                        <button
                          onClick={() => handleDelete(p.id)}
                          disabled={deletingId === p.id}
                          className="opacity-0 group-hover:opacity-100 p-1 text-text-faint hover:text-danger transition-[color,opacity] duration-150 ease-out shrink-0 disabled:opacity-50"
                          title="削除"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
