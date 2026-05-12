'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, FileText, Plus } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { getProposalsByStudent, calcTotalKoma, calcTotalAppliedKoma } from '@/lib/api/proposals';
import type { SeasonalProposalWithDetails, SeasonType, ProposalStatus } from '@/types/database';
import { SEASON_LABELS, PROPOSAL_STATUS_LABELS } from '@/types/database';

const STATUS_BADGE: Record<ProposalStatus, string> = {
  draft: 'bg-surface-hover text-text-muted',
  sent: 'bg-info-subtle text-info',
  approved: 'bg-info-subtle text-info',
};

export default function ProposalList() {
  const params = useParams();
  const studentId = params?.studentId as string;

  const [loading, setLoading] = useState(true);
  const [studentName, setStudentName] = useState('');
  const [proposals, setProposals] = useState<SeasonalProposalWithDetails[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: student } = await supabase
        .from('students')
        .select('last_name, first_name')
        .eq('id', studentId)
        .single();

      if (student) {
        setStudentName(`${student.last_name} ${student.first_name}`);
      }

      const list = await getProposalsByStudent(studentId);
      setProposals(list);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    load();
  }, [load]);

  const currentYear = new Date().getFullYear();
  const currentSeason = getCurrentSeason();

  const byTextbook = new Map<number, { name: string; subject: string; proposals: SeasonalProposalWithDetails[] }>();
  for (const p of proposals) {
    const tbId = p.textbook_id;
    const tbName = p.textbook?.name ?? '不明なテキスト';
    const tbSubject = p.textbook?.subject ?? '';
    if (!byTextbook.has(tbId)) {
      byTextbook.set(tbId, { name: tbName, subject: tbSubject, proposals: [] });
    }
    byTextbook.get(tbId)!.proposals.push(p);
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <Link
          href={`/students/${studentId}/progress`}
          className="text-sm text-text-muted hover:text-text-heading inline-flex items-center gap-1 mb-2 transition-colors duration-150"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          進行表に戻る
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-text-heading">講習提案書</h1>
            <p className="text-sm text-text-muted mt-0.5">{studentName}</p>
          </div>
          <Link
            href={`/students/${studentId}/proposals/new?season=${currentSeason}&year=${currentYear}`}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-ink text-text-on-primary rounded-lg hover:brightness-[0.85] transition-[filter] duration-150"
          >
            <Plus className="w-3 h-3" />
            新規作成
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-text-faint">読み込み中...</div>
      ) : proposals.length === 0 ? (
        <div className="py-12 text-center text-sm text-text-faint">
          提案書はまだありません
        </div>
      ) : (
        <div className="space-y-6">
          {Array.from(byTextbook.entries()).map(([tbId, { name, subject, proposals: tbProposals }]) => (
            <div key={tbId} className="bg-surface-raised rounded-xl border border-border-default overflow-hidden">
              <div className="px-4 py-3 border-b border-border-subtle">
                <div className="font-semibold text-sm text-text-heading">
                  {subject && <span className="text-text-muted font-normal mr-1.5">{subject}</span>}
                  {name}
                </div>
              </div>

              <div className="divide-y divide-border-subtle">
                {tbProposals.map((p) => {
                  const koma = calcTotalKoma(p.units);
                  const appliedKoma = calcTotalAppliedKoma(p.units);
                  return (
                    <Link
                      key={p.id}
                      href={`/students/${studentId}/proposals/${p.id}`}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-surface-hover transition-colors duration-150"
                    >
                      <FileText className="w-4 h-4 text-text-faint shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-text-heading truncate">
                          {p.theme || `${p.year}年 ${SEASON_LABELS[p.season as SeasonType]}講習`}
                        </div>
                        <div className="text-xs text-text-muted flex gap-2">
                          <span>{p.year}年 {SEASON_LABELS[p.season as SeasonType]}</span>
                          <span>{p.units.length}単元 / {koma}コマ</span>
                          {appliedKoma != null && (
                            <span className="text-info">申込 {appliedKoma}コマ</span>
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
  );
}

function getCurrentSeason(): SeasonType {
  const month = new Date().getMonth() + 1;
  if (month >= 2 && month <= 4) return 'spring';
  if (month >= 5 && month <= 9) return 'summer';
  return 'winter';
}
