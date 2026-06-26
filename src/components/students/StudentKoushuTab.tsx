'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { BookOpen, ExternalLink } from 'lucide-react';
import { Loading } from '@/components/ui';
import { useMasterData } from '@/contexts/MasterDataContext';
import { getProposalsByStudent } from '@/lib/api/proposals';
import { getKoushuEnrollmentsByStudent } from '@/lib/api/seasonalCourses';
import { groupStudentKoushu, type StudentKoushuPeriodGroup } from '@/lib/studentKoushuSummary';
import { PROPOSAL_STATUS_LABELS, type ProposalStatus } from '@/types/database';

interface StudentKoushuTabProps {
  studentId: string;
}

// ステータス別のバッジ色（下書き=グレー / 提案済=アンバー / 公開=グリーン）
const STATUS_BADGE: Record<ProposalStatus, string> = {
  draft: 'bg-gray-100 text-gray-600',
  sent: 'bg-amber-100 text-amber-700',
  approved: 'bg-green-100 text-green-700',
};

const FORMATION_LABEL: Record<string, string> = {
  individual: '個別',
  group: '集団',
};

export function StudentKoushuTab({ studentId }: StudentKoushuTabProps) {
  const { subjects } = useMasterData();
  const [groups, setGroups] = useState<StudentKoushuPeriodGroup[]>([]);
  const [loading, setLoading] = useState(true);

  // 科目ID → 科目名
  const subjectName = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of subjects) map.set(s.id, s.name);
    return (id: string) => map.get(id) ?? id;
  }, [subjects]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([getProposalsByStudent(studentId), getKoushuEnrollmentsByStudent(studentId)])
      .then(([proposals, enrollments]) => {
        if (!active) return;
        setGroups(groupStudentKoushu(proposals, enrollments));
      })
      .catch(() => {
        if (active) setGroups([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [studentId]);

  if (loading) {
    return <Loading size="md" label="講習情報を読み込み中..." />;
  }

  if (groups.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-[#9ca3af]">
        この生徒の講習データはまだありません
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Link
          href={`/students/${studentId}/proposals`}
          className="inline-flex items-center gap-1 text-xs text-[#3b82f6] hover:underline"
        >
          講習提案書を開く
          <ExternalLink className="w-3 h-3" />
        </Link>
      </div>

      {groups.map((g) => (
        <div key={g.key} className="rounded-xl border border-[#e5e7eb] overflow-hidden">
          {/* 期ヘッダー: ラベル + 提案→申込コマ合計 */}
          <div className="flex items-center justify-between bg-[#f9fafb] px-4 py-2.5 border-b border-[#e5e7eb]">
            <span className="text-sm font-bold text-[#1f2937]">{g.label}</span>
            {g.proposals.length > 0 && (
              <span className="text-xs text-[#4b5563]">
                提案 <span className="font-medium">{g.totalProposedKoma}</span> → 申込{' '}
                <span className="font-medium text-[#3b82f6]">{g.totalAppliedKoma}</span> コマ
              </span>
            )}
          </div>

          <div className="p-4 space-y-4">
            {/* 使用テキスト / 提案 vs 申込 */}
            {g.proposals.length > 0 && (
              <div className="space-y-2">
                <div className="text-[11px] font-medium text-[#9ca3af]">
                  使用テキスト / 提案状況
                </div>
                {g.proposals.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-[#f3f4f6] px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <BookOpen className="w-3.5 h-3.5 text-[#9ca3af] shrink-0" />
                        <span className="text-sm text-[#1f2937] truncate">{p.textbookName}</span>
                        {p.subject && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#eff6ff] text-[#1d4ed8] shrink-0">
                            {p.subject}
                          </span>
                        )}
                      </div>
                      {p.theme && (
                        <div className="text-[11px] text-[#9ca3af] truncate mt-0.5 ml-5">
                          {p.theme}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-[#4b5563] whitespace-nowrap">
                        {p.proposedKoma}
                        <span className="text-[#9ca3af]"> → </span>
                        <span className="font-medium text-[#3b82f6]">{p.appliedKoma ?? '—'}</span>
                        コマ
                      </span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded font-medium whitespace-nowrap ${STATUS_BADGE[p.status]}`}
                      >
                        {PROPOSAL_STATUS_LABELS[p.status]}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 講習申込（座席表ベース・科目別コマ） */}
            {g.enrollments.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[11px] font-medium text-[#9ca3af]">申込（科目別コマ）</div>
                {g.enrollments.map((e, idx) => {
                  const entries = Object.entries(e.komaBySubject).filter(([, n]) => n > 0);
                  return (
                    <div
                      key={`${e.formation}-${idx}`}
                      className="flex flex-wrap items-center gap-2 text-xs"
                    >
                      <span className="px-1.5 py-0.5 rounded bg-[#f3f4f6] text-[#4b5563] font-medium">
                        {FORMATION_LABEL[e.formation] ?? e.formation}
                      </span>
                      {entries.length > 0 ? (
                        entries.map(([sid, n]) => (
                          <span key={sid} className="text-[#4b5563]">
                            {subjectName(sid)}
                            <span className="text-[#1f2937] font-medium"> {n}</span>
                          </span>
                        ))
                      ) : (
                        <span className="text-[#9ca3af]">科目内訳なし</span>
                      )}
                      <span className="ml-auto text-[#4b5563]">
                        計 <span className="font-medium text-[#1f2937]">{e.komaCount}</span> コマ
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
