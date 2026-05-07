'use client';

/**
 * ProposalList — 生徒の講習提案書一覧
 *
 * URL: /students/[studentId]/proposals
 * テキストごとに提案書を表示。新規作成リンクあり。
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, FileText, Plus } from 'lucide-react';
import { AdminLayout } from '@/components/layouts';
import { supabase } from '@/lib/supabase';
import type { SeasonalProposal, SeasonType } from '@/types/database';
import { SEASON_LABELS, PROPOSAL_STATUS_LABELS } from '@/types/database';

interface TextbookInfo {
  id: string; // student_textbook_id
  textbook_id: number;
  textbook_name: string;
  proposals: SeasonalProposal[];
}

export default function ProposalList() {
  const params = useParams();
  const studentId = params?.studentId as string;

  const [loading, setLoading] = useState(true);
  const [studentName, setStudentName] = useState('');
  const [textbooks, setTextbooks] = useState<TextbookInfo[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // 生徒情報
      const { data: student } = await supabase
        .from('students')
        .select('last_name, first_name')
        .eq('id', studentId)
        .single();

      if (student) {
        setStudentName(`${student.last_name} ${student.first_name}`);
      }

      // 生徒のテキスト一覧
      const { data: stbs } = await supabase
        .from('student_textbooks')
        .select('id, textbook_id, textbook:textbooks(name)')
        .eq('student_id', studentId)
        .eq('is_active', true)
        .order('sort_order', { ascending: true });

      if (!stbs || stbs.length === 0) {
        setTextbooks([]);
        return;
      }

      const stbIds = stbs.map((s) => (s as { id: string }).id);

      // 提案書を取得
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: proposals } = await supabase
        .from('seasonal_proposals' as any)
        .select('*')
        .in('student_textbook_id', stbIds)
        .order('year', { ascending: false })
        .order('created_at', { ascending: false });

      const proposalsByStb = new Map<string, SeasonalProposal[]>();
      for (const p of (proposals ?? []) as unknown as SeasonalProposal[]) {
        const list = proposalsByStb.get(p.student_textbook_id) ?? [];
        list.push(p);
        proposalsByStb.set(p.student_textbook_id, list);
      }

      setTextbooks(
        (stbs as unknown as { id: string; textbook_id: number; textbook: { name: string } | null }[]).map((s) => ({
          id: s.id,
          textbook_id: s.textbook_id,
          textbook_name: s.textbook?.name ?? '',
          proposals: proposalsByStb.get(s.id) ?? [],
        }))
      );
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

  return (
    <AdminLayout>
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <Link
            href={`/students/${studentId}/progress`}
            className="text-sm text-gray-500 hover:text-gray-700 inline-flex items-center gap-1 mb-2"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            進行表に戻る
          </Link>
          <h1 className="text-lg font-bold text-gray-900">講習提案書</h1>
          <p className="text-sm text-gray-500 mt-0.5">{studentName}</p>
        </div>

        {loading ? (
          <div className="py-12 text-center text-sm text-gray-400">読み込み中...</div>
        ) : textbooks.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">
            テキストが登録されていません
          </div>
        ) : (
          <div className="space-y-6">
            {textbooks.map((tb) => (
              <div key={tb.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                  <div className="font-semibold text-sm text-gray-900">{tb.textbook_name}</div>
                  <Link
                    href={`/students/${studentId}/proposals/new?stbId=${tb.id}&season=${currentSeason}&year=${currentYear}`}
                    className="px-2.5 py-1 text-xs bg-[#1e3a5f] text-white rounded-lg hover:bg-[#2c4f7c] flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" />
                    新規作成
                  </Link>
                </div>

                {tb.proposals.length === 0 ? (
                  <div className="px-4 py-6 text-center text-sm text-gray-400">
                    提案書はまだありません
                  </div>
                ) : (
                  <div className="divide-y divide-gray-50">
                    {tb.proposals.map((p) => (
                      <Link
                        key={p.id}
                        href={`/students/${studentId}/proposals/${p.id}`}
                        className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors"
                      >
                        <FileText className="w-4 h-4 text-gray-400 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-900 truncate">
                            {p.theme || `${p.year}年 ${SEASON_LABELS[p.season as SeasonType]}講習`}
                          </div>
                          <div className="text-xs text-gray-500">
                            {p.year}年 {SEASON_LABELS[p.season as SeasonType]}
                          </div>
                        </div>
                        <span
                          className={`px-2 py-0.5 text-[10px] font-bold rounded ${
                            p.status === 'approved'
                              ? 'bg-emerald-100 text-emerald-800'
                              : p.status === 'sent'
                                ? 'bg-blue-100 text-blue-800'
                                : 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {PROPOSAL_STATUS_LABELS[p.status as SeasonalProposal['status']]}
                        </span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}

function getCurrentSeason(): SeasonType {
  const month = new Date().getMonth() + 1;
  if (month >= 2 && month <= 4) return 'spring';
  if (month >= 5 && month <= 9) return 'summer';
  return 'winter';
}
