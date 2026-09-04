'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import type { TestPrepProposalWithDetails } from '@/types/test-prep';
import { SELF_ASSESSMENT_LABELS } from '@/types/test-prep';
import { getTestPrepProposalByToken } from '@/lib/api/test-prep-proposals';
import { toSurnameOnly } from '@/lib/utils/teacherName';
import { formatGradeLabel } from '@/lib/utils/gradeLabel';
import { Spinner } from '@/components/ui';
import {
  ProposalSheet,
  ProposalApplyCard,
  type ProposalSheetData,
} from '@/components/test-prep/ProposalSheet';

/**
 * テスト対策提案書の公開ページ（保護者がQR/URLから開く）。
 *
 * 紙面の中身は `ProposalSheet` に集約している（モック /test-prep/mock と共用。
 * 以前は同じマークアップを2ファイルに複製していて、片方だけ直ると見た目がずれていた）。
 * このページの責務はトークンからの取得と、増コマ申込フォームへの引き継ぎだけ。
 */
export default function TestPrepPublicPage() {
  const params = useParams();
  const token = params?.token as string;
  const [loading, setLoading] = useState(true);
  const [proposal, setProposal] = useState<
    | (TestPrepProposalWithDetails & {
        school?: { name: string; code: string | null; logo_url: string | null };
      })
    | null
  >(null);
  const [error, setError] = useState('');
  // 印刷用QRは自分自身のURL。SSR時は window が無いのでマウント後に入れる
  const [pageUrl, setPageUrl] = useState<string | null>(null);

  useEffect(() => {
    setPageUrl(window.location.href);
  }, []);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const data = await getTestPrepProposalByToken(token);
        setProposal(data as typeof proposal);
      } catch {
        setError('提案書の取得に失敗しました');
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f3f4f6] flex items-center justify-center">
        <Spinner size="md" />
      </div>
    );
  }

  if (error || !proposal) {
    return (
      <div className="min-h-screen bg-[#f3f4f6] flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl border border-[#e5e7eb] p-8 text-center max-w-md">
          <h1 className="text-xl font-bold text-[#1a1a1a] mb-2">提案書が見つかりません</h1>
          <p className="text-[#6b7280] text-sm">
            {error || 'このURLは無効か、まだ公開されていません。'}
          </p>
        </div>
      </div>
    );
  }

  const studentName = proposal.student
    ? `${proposal.student.last_name} ${proposal.student.first_name}`
    : '---';
  const studentGrade = proposal.student ? formatGradeLabel(proposal.student.grade) : '---';
  const schoolObj = (proposal as unknown as Record<string, unknown>).school as
    | { name: string; code: string | null }
    | undefined;
  const schoolCode = schoolObj?.code || null;

  const sheet: ProposalSheetData = {
    schoolName: schoolObj?.name || '',
    title: proposal.title,
    // 保護者向けの書面では講師は姓のみ表示（個人情報配慮・社内の慣習に合わせる）
    teacherName: toSurnameOnly(proposal.teacher?.display_name) || '',
    studentName,
    studentGrade,
    examName: proposal.exam_type?.name || '',
    notes: proposal.notes || null,
    subjects: proposal.subjects.map((s) => ({
      id: s.id,
      name: s.subject_name,
      targetScore: s.target_score ?? null,
      units: (s.units || []).map((u) => ({
        id: u.id,
        name: u.unit_name,
        assessment: u.self_assessment ?? null,
        koma: u.koma_count,
        groupId: u.group_id ?? null,
      })),
    })),
    assessmentLabels: SELF_ASSESSMENT_LABELS,
  };

  // 科目別コマ数（申込フォームへクエリで引き継ぐ）
  const subjectKoma = sheet.subjects
    .map((s) => ({ name: s.name, koma: s.units.reduce((sum, u) => sum + u.koma, 0) }))
    .filter((sk) => sk.koma > 0);

  // 増コマフォームURL（生徒名・学年・科目別コマ数をクエリパラメータで渡す）
  let applyUrl: string | null = null;
  if (schoolCode) {
    const query = new URLSearchParams({ name: studentName, grade: studentGrade });
    for (const sk of subjectKoma) query.set(`s_${sk.name}`, String(sk.koma));
    applyUrl = `/portal/${schoolCode}/zoukoma?${query.toString()}`;
  }

  return (
    <div className="min-h-screen bg-[#f3f4f6] print:bg-white print:min-h-0">
      <div className="max-w-2xl mx-auto px-4 py-6 print:px-0 print:py-0 print:max-w-none">
        <ProposalSheet data={sheet} printUrl={pageUrl} hasApplyLink={!!applyUrl} />

        {applyUrl && (
          <div className="mt-4">
            <ProposalApplyCard subjectKoma={subjectKoma} applyUrl={applyUrl} />
          </div>
        )}
      </div>

      {/* 印刷はA4縦1枚が前提。紙面側の圧縮は ProposalSheet の print: 修飾で行う */}
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 8mm 10mm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>
    </div>
  );
}
