'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { FileText, Filter } from 'lucide-react';
import { AdminLayout } from '@/components/layouts';
import { useAuth } from '@/contexts/AuthContext';
import { useRequirePermission } from '@/hooks/usePermissions';
import AccessDenied from '@/components/AccessDenied';
import { getProposalsBySchool, calcTotalKoma } from '@/lib/api/proposals';
import type { SeasonalProposalWithDetails, SeasonType, ProposalStatus } from '@/types/database';
import { SEASON_LABELS, PROPOSAL_STATUS_LABELS } from '@/types/database';
import { useLocalSchoolId } from '@/hooks/useLocalSchoolId';
import { SchoolSwitcher } from '@/components/SchoolSwitcher';

const STATUS_BADGE: Record<ProposalStatus, string> = {
  draft: 'bg-surface-hover text-text-muted',
  sent: 'bg-info-subtle text-info',
  approved: 'bg-success-subtle text-success',
};

const STATUS_FILTER_ACTIVE: Record<ProposalStatus, string> = {
  draft: 'bg-text-muted text-white',
  sent: 'bg-info text-white',
  approved: 'bg-success text-white',
};

const STATUS_FILTER_INACTIVE: Record<ProposalStatus, string> = {
  draft: 'bg-surface-hover text-text-muted hover:bg-border-default',
  sent: 'bg-info-subtle text-info hover:bg-info/15',
  approved: 'bg-success-subtle text-success hover:bg-success/15',
};

export default function CourseProposalsPage() {
  const { hasPermission, isLoading: permissionLoading } = useRequirePermission(
    (p) => p.canAccessCourses
  );
  const { getSelectedSchoolIds } = useAuth();
  const { localSchoolId, setLocalSchoolId, isAllSelected, availableSchools } = useLocalSchoolId();

  const [proposals, setProposals] = useState<SeasonalProposalWithDetails[]>([]);
  const [loading, setLoading] = useState(true);

  const currentYear = new Date().getFullYear();
  const [filterYear, setFilterYear] = useState<number>(currentYear);
  const [filterSeason, setFilterSeason] = useState<SeasonType | ''>('');
  const [filterStatus, setFilterStatus] = useState<ProposalStatus | ''>('');

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
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [localSchoolId, filterYear, filterSeason, getSelectedSchoolIds]);

  useEffect(() => {
    if (hasPermission) load();
  }, [hasPermission, load]);

  if (permissionLoading) {
    return (
      <AdminLayout headerTitle="提案書">
        <div className="p-8 text-sm text-text-faint">読み込み中...</div>
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

  const filtered = filterStatus
    ? proposals.filter((p) => p.status === filterStatus)
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

  const statusCounts = { draft: 0, sent: 0, approved: 0 };
  for (const p of proposals) {
    statusCounts[p.status]++;
  }

  return (
    <AdminLayout headerTitle="提案書">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-lg font-bold text-text-heading">講習提案書</h1>
          {isAllSelected && (
            <SchoolSwitcher
              schools={availableSchools}
              selectedSchoolId={localSchoolId}
              onChange={setLocalSchoolId}
            />
          )}
        </div>

        <div className="flex gap-2 mb-4">
          {(Object.entries(statusCounts) as [ProposalStatus, number][]).map(([status, count]) => (
            <button
              key={status}
              onClick={() => setFilterStatus(filterStatus === status ? '' : status)}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors duration-150 ${
                filterStatus === status
                  ? STATUS_FILTER_ACTIVE[status]
                  : STATUS_FILTER_INACTIVE[status]
              }`}
            >
              {PROPOSAL_STATUS_LABELS[status]} {count}
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
          <div className="py-12 text-center text-sm text-text-faint">読み込み中...</div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-text-faint">
            該当する提案書はありません
          </div>
        ) : (
          <div className="space-y-4">
            {Array.from(byStudent.values()).map(({ name, studentId, proposals: studentProposals }) => (
              <div key={studentId} className="bg-surface-raised rounded-xl border border-border-default overflow-hidden">
                <div className="px-4 py-2.5 border-b border-border-subtle bg-surface-hover/50">
                  <Link
                    href={`/students/${studentId}/proposals`}
                    className="font-semibold text-sm text-text-heading hover:text-accent-ink transition-colors duration-150"
                  >
                    {name}
                  </Link>
                </div>
                <div className="divide-y divide-border-subtle">
                  {studentProposals.map((p) => {
                    const koma = calcTotalKoma(p.units);
                    return (
                      <Link
                        key={p.id}
                        href={`/students/${studentId}/proposals/${p.id}`}
                        className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-hover transition-colors duration-150"
                      >
                        <FileText className="w-4 h-4 text-text-faint shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-text-heading truncate">
                            {p.textbook?.name ?? '不明'}
                          </div>
                          <div className="text-xs text-text-muted flex gap-2">
                            <span>{p.theme || `${p.year}年 ${SEASON_LABELS[p.season]}`}</span>
                            <span>{p.units.length}単元 / {koma}コマ</span>
                            {p.applied_koma != null && (
                              <span className="text-info">申込 {p.applied_koma}コマ</span>
                            )}
                          </div>
                        </div>
                        <span
                          className={`px-2 py-0.5 text-[10px] font-bold rounded ${STATUS_BADGE[p.status]}`}
                        >
                          {PROPOSAL_STATUS_LABELS[p.status]}
                        </span>
                      </Link>
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
