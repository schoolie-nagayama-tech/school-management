'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import type { TestPrepProposalWithDetails } from '@/types/test-prep';
import { SELF_ASSESSMENT_LABELS } from '@/types/test-prep';
import { getTestPrepProposalByToken } from '@/lib/api/test-prep-proposals';

const ASSESSMENT_STYLES: Record<string, string> = {
  '◎': 'text-blue-600 font-bold',
  '○': 'text-green-600 font-bold',
  '△': 'text-yellow-600 font-bold',
  '×': 'text-red-600 font-bold',
};

// 学年番号 → 表示名
function gradeName(grade: number): string {
  if (grade >= 10) return `高${grade - 9}`;
  if (grade >= 7) return `中${grade - 6}`;
  return `小${grade}`;
}

export default function TestPrepPublicPage() {
  const params = useParams();
  const token = params?.token as string;
  const [loading, setLoading] = useState(true);
  const [proposal, setProposal] = useState<(TestPrepProposalWithDetails & { school?: { name: string; logo_url: string | null }; zoukoma_period?: Record<string, unknown> | null }) | null>(null);
  const [error, setError] = useState('');

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
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-600" />
      </div>
    );
  }

  if (error || !proposal) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center max-w-md">
          <h1 className="text-xl font-bold text-gray-900 mb-2">提案書が見つかりません</h1>
          <p className="text-gray-500 text-sm">
            {error || 'このURLは無効か、まだ公開されていません。'}
          </p>
        </div>
      </div>
    );
  }

  const studentName = proposal.student
    ? `${proposal.student.last_name} ${proposal.student.first_name}`
    : '---';
  const studentGrade = proposal.student ? gradeName(proposal.student.grade) : '---';
  const schoolObj = (proposal as unknown as Record<string, unknown>).school as { name: string } | undefined;
  const schoolName = schoolObj?.name || '';
  const teacherName = proposal.teacher?.display_name || '';
  const examName = proposal.exam_type?.name || '';

  const totalKoma = proposal.subjects.reduce(
    (sum, s) => sum + (s.units || []).reduce((us, u) => us + u.koma_count, 0),
    0
  );

  // 上段/下段の分割（5科目なら 3+2、それ以外はそのまま）
  const topSubjects = proposal.subjects.slice(0, Math.min(3, proposal.subjects.length));
  const bottomSubjects = proposal.subjects.length > 3 ? proposal.subjects.slice(3) : [];

  return (
    <div className="min-h-screen bg-gray-50 print:bg-white print:min-h-0">
      <div className="max-w-3xl mx-auto px-4 py-8 print:px-0 print:py-0 print:max-w-none">
        {/* 提案書本体 */}
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden print:rounded-none print:border-none">
          {/* ヘッダー */}
          <div className="bg-gradient-to-r from-red-600 to-red-500 px-6 py-5 print:py-4">
            <div className="flex items-center justify-between">
              <div>
                {schoolName && <p className="text-red-100 text-sm">{schoolName}</p>}
                <h1 className="text-xl font-bold text-white mt-0.5">{proposal.title}</h1>
              </div>
              {teacherName && (
                <div className="text-right text-sm text-red-100">
                  <p>担当: {teacherName}</p>
                </div>
              )}
            </div>
          </div>

          {/* 生徒情報 */}
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
            <div className="flex items-center gap-6">
              <div>
                <span className="text-xs text-gray-400">生徒名</span>
                <p className="font-bold text-gray-900 text-lg">{studentName}</p>
              </div>
              <div>
                <span className="text-xs text-gray-400">学年</span>
                <p className="font-medium text-gray-700">{studentGrade}</p>
              </div>
              {examName && (
                <div>
                  <span className="text-xs text-gray-400">試験</span>
                  <p className="font-medium text-gray-700">{examName}</p>
                </div>
              )}
            </div>
            <div className="text-right">
              <span className="text-xs text-gray-400">提案コマ数合計</span>
              <p className="text-2xl font-bold text-red-600">
                {totalKoma}
                <span className="text-sm font-normal text-gray-500 ml-1">コマ</span>
              </p>
            </div>
          </div>

          {/* 自己評価の凡例 */}
          <div className="px-6 pt-4 pb-2 flex items-center gap-4 text-xs text-gray-500">
            <span className="text-gray-400">自己評価:</span>
            {Object.entries(SELF_ASSESSMENT_LABELS).map(([mark, label]) => (
              <span key={mark} className="flex items-center gap-1">
                <span className={ASSESSMENT_STYLES[mark]}>{mark}</span>
                <span>{label}</span>
              </span>
            ))}
          </div>

          {/* メッセージ */}
          {proposal.notes && (
            <div className="mx-6 mt-2 mb-4 p-3 bg-blue-50 rounded-lg border border-blue-100 text-sm text-blue-800 whitespace-pre-line">
              {proposal.notes}
            </div>
          )}

          {/* 科目ブロック群 */}
          <div className="px-6 pb-6">
            {topSubjects.length > 0 && (
              <div className={`grid grid-cols-1 gap-4 mb-4 ${topSubjects.length >= 3 ? 'md:grid-cols-3 print:grid-cols-3' : topSubjects.length === 2 ? 'md:grid-cols-2 print:grid-cols-2' : ''}`}>
                {topSubjects.map((subject) => (
                  <SubjectBlock key={subject.id} subject={subject} />
                ))}
              </div>
            )}
            {bottomSubjects.length > 0 && (
              <div className={`grid grid-cols-1 gap-4 ${bottomSubjects.length >= 2 ? 'md:grid-cols-2 print:grid-cols-2' : ''}`}>
                {bottomSubjects.map((subject) => (
                  <SubjectBlock key={subject.id} subject={subject} />
                ))}
              </div>
            )}
          </div>

          {/* QRコード（印刷用） */}
          <div className="hidden print:block border-t-2 border-dashed border-gray-300 mx-6 pt-4 pb-6">
            <div className="flex items-center gap-6">
              <div className="w-24 h-24 bg-gray-200 border border-gray-300 rounded-lg flex items-center justify-center text-xs text-gray-400">
                QR Code
              </div>
              <div>
                <p className="font-bold text-gray-900">テスト対策 増コマ申し込み</p>
                <p className="text-sm text-gray-600 mt-1">
                  上のQRコードを読み取るか、以下のURLからお申し込みください。
                </p>
                <p className="text-sm text-blue-600 mt-1 font-mono">
                  {typeof window !== 'undefined' ? window.location.href : ''}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* 増コマ申込セクション（印刷時非表示） */}
        <div className="print:hidden mt-8">
          <ZoukomaSection proposal={proposal} />
        </div>
      </div>

      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 10mm 12mm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>
    </div>
  );
}

// 科目ブロック
function SubjectBlock({
  subject,
}: {
  subject: TestPrepProposalWithDetails['subjects'][number];
}) {
  const totalKoma = (subject.units || []).reduce((sum, u) => sum + u.koma_count, 0);

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-3 py-2 bg-gray-800 text-white flex items-center justify-between">
        <span className="font-bold text-sm">{subject.subject_name}</span>
        {subject.target_score != null && (
          <span className="text-xs text-gray-300">
            目標 <span className="text-yellow-300 font-bold">{subject.target_score}</span>点
          </span>
        )}
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-gray-50 text-gray-500">
            <th className="text-left px-2 py-1.5 font-medium">単元</th>
            <th className="w-10 text-center px-1 py-1.5 font-medium">評価</th>
            <th className="w-12 text-center px-1 py-1.5 font-medium">コマ</th>
          </tr>
        </thead>
        <tbody>
          {(subject.units || []).map((unit) => (
            <tr key={unit.id} className="border-t border-gray-100">
              <td className="px-2 py-1.5 text-gray-700">{unit.unit_name}</td>
              <td className="text-center">
                {unit.self_assessment && (
                  <span className={ASSESSMENT_STYLES[unit.self_assessment] || ''}>
                    {unit.self_assessment}
                  </span>
                )}
              </td>
              <td className="text-center font-medium text-gray-800">{unit.koma_count}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-gray-200 bg-gray-50 font-bold">
            <td className="px-2 py-1.5 text-gray-600">合計</td>
            <td />
            <td className="text-center text-red-600">{totalKoma}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// 増コマ申込セクション
function ZoukomaSection({
  proposal,
}: {
  proposal: TestPrepProposalWithDetails & { zoukoma_period?: Record<string, unknown> | null };
}) {
  const [showForm, setShowForm] = useState(false);
  const period = proposal.zoukoma_period;

  if (!period) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-6 text-center">
        <p className="text-gray-500">増コマ申込の受付期間外です</p>
      </div>
    );
  }

  // 科目別コマ数を計算
  const subjectKoma = proposal.subjects.map((s) => ({
    name: s.subject_name,
    koma: (s.units || []).reduce((sum, u) => sum + u.koma_count, 0),
  }));

  const studentName = proposal.student
    ? `${proposal.student.last_name} ${proposal.student.first_name}`
    : '';
  const studentGrade = proposal.student ? gradeName(proposal.student.grade) : '';

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-blue-50 to-white">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-bold text-gray-900 text-lg">テスト対策 増コマ申し込み</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              提案内容をもとに増コマをお申し込みいただけます
            </p>
          </div>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            {showForm ? '閉じる' : '申し込みフォームを開く'}
          </button>
        </div>
      </div>
      {showForm && (
        <div className="p-6">
          <div className="p-4 bg-blue-50 rounded-lg border border-blue-100 mb-4">
            <p className="text-xs text-blue-600 font-medium mb-2">提案書から自動入力済み</p>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-gray-500 text-xs">生徒名</span>
                <p className="font-medium text-gray-900">{studentName}</p>
              </div>
              <div>
                <span className="text-gray-500 text-xs">学年</span>
                <p className="font-medium text-gray-900">{studentGrade}</p>
              </div>
            </div>
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">科目ごとのコマ数</label>
            <div className="space-y-2">
              {subjectKoma.map((sk) => (
                <div key={sk.name} className="flex items-center gap-3">
                  <span className="w-20 text-sm text-gray-700">{sk.name}</span>
                  <input
                    type="number"
                    defaultValue={sk.koma}
                    min={0}
                    className="w-20 px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-center"
                  />
                  <span className="text-xs text-gray-400">コマ</span>
                </div>
              ))}
            </div>
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">保護者メールアドレス</label>
            <input
              type="email"
              placeholder="example@email.com"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">備考</label>
            <textarea
              rows={2}
              placeholder="ご質問やご要望があればお書きください"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none"
            />
          </div>
          <p className="text-xs text-gray-400 mb-4">
            ※ 実際の申込フォーム（日程選択・料金確認を含む）は増コマ申込ページで受け付けます。
            このフォームは提案内容をもとにした簡易申込です。
          </p>
          <button
            type="button"
            onClick={() => alert('申込機能は実装中です')}
            className="w-full py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 transition-colors text-sm"
          >
            増コマを申し込む
          </button>
        </div>
      )}
    </div>
  );
}
