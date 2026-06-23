'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import type { TestPrepProposalWithDetails, TestPrepProposalUnit } from '@/types/test-prep';
import { SELF_ASSESSMENT_LABELS } from '@/types/test-prep';
import { getTestPrepProposalByToken } from '@/lib/api/test-prep-proposals';
import { toSurnameOnly } from '@/lib/utils/teacherName';
import { Spinner } from '@/components/ui';
import { ArrowRight } from 'lucide-react';

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
  const [proposal, setProposal] = useState<
    | (TestPrepProposalWithDetails & {
        school?: { name: string; code: string | null; logo_url: string | null };
      })
    | null
  >(null);
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
        <Spinner size="md" />
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
  const schoolObj = (proposal as unknown as Record<string, unknown>).school as
    | { name: string; code: string | null }
    | undefined;
  const schoolName = schoolObj?.name || '';
  const schoolCode = schoolObj?.code || null;
  // 保護者向けの書面では講師は姓のみ表示（個人情報配慮・社内の慣習に合わせる）
  const teacherName = toSurnameOnly(proposal.teacher?.display_name) || '';
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
          {/* ヘッダー
              画面・カラー印刷では赤のグラデーション。白黒印刷だと赤ベタが真っ黒に潰れるため、
              print: では背景を白に落とし、赤は下線（細線）だけ残して文字を黒系にする。 */}
          <div className="bg-gradient-to-r from-red-600 to-red-500 px-6 py-5 print:py-4 print:bg-none print:bg-white print:border-b-4 print:border-red-600">
            <div className="flex items-center justify-between">
              <div>
                {schoolName && (
                  <p className="text-red-100 text-sm print:text-gray-500">{schoolName}</p>
                )}
                <h1 className="text-xl font-bold text-white mt-0.5 print:text-gray-900">
                  {proposal.title}
                </h1>
              </div>
              {teacherName && (
                <div className="text-right text-sm text-red-100 print:text-gray-600">
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
              <p className="text-2xl font-bold text-red-600 print:text-gray-900">
                {totalKoma}
                <span className="text-sm font-normal text-gray-500 ml-1">コマ</span>
              </p>
            </div>
          </div>

          {/* 保護者向けの案内（この書面が何かの説明＋増コマ受講のおすすめ）。
              テスト対策の提案書が保護者にとって唐突／不親切だったため、目的を明記する。 */}
          <div className="mx-6 mt-4 p-3.5 rounded-lg bg-amber-50 border border-amber-100 print:bg-white print:border-gray-300 text-sm text-gray-700 leading-relaxed">
            <p className="font-bold text-gray-900 mb-1">保護者の皆様へ — テスト対策のご提案</p>
            <p>
              本書は、次回の定期テストに向けて、担当講師がお子様の現在の到達状況をもとに作成した対策プランです。
              下記の科目・単元ごとに、目標点の達成に必要と考えられる対策コマ数の目安をまとめています。
              テストでの得点アップに向けて、ぜひ追加の対策コマ（増コマ）の受講をご検討ください。
              お申し込みは{schoolCode ? 'ページ下部（印刷の場合はQRコード）の' : '末尾の'}
              増コマ申込フォームから承ります。
            </p>
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
              <div
                className={`grid grid-cols-1 gap-4 mb-4 ${topSubjects.length >= 3 ? 'md:grid-cols-3 print:grid-cols-3' : topSubjects.length === 2 ? 'md:grid-cols-2 print:grid-cols-2' : ''}`}
              >
                {topSubjects.map((subject) => (
                  <SubjectBlock key={subject.id} subject={subject} />
                ))}
              </div>
            )}
            {bottomSubjects.length > 0 && (
              <div
                className={`grid grid-cols-1 gap-4 ${bottomSubjects.length >= 2 ? 'md:grid-cols-2 print:grid-cols-2' : ''}`}
              >
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
          <ZoukomaSection
            proposal={proposal}
            schoolCode={schoolCode}
            studentName={studentName}
            studentGrade={studentGrade}
            totalKoma={totalKoma}
          />
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

// グループ情報を付与した表示用行データを構築
function buildGroupedRows(units: TestPrepProposalUnit[]) {
  const rows: Array<{
    unit: TestPrepProposalUnit;
    isGroupStart: boolean;
    isGroupMember: boolean;
    groupSize: number;
  }> = [];
  const list = units || [];
  let i = 0;
  while (i < list.length) {
    const u = list[i];
    if (u.group_id) {
      const gid = u.group_id;
      const start = i;
      while (i < list.length && list[i].group_id === gid) i++;
      const size = i - start;
      for (let j = start; j < i; j++) {
        rows.push({
          unit: list[j],
          isGroupStart: j === start,
          isGroupMember: true,
          groupSize: size,
        });
      }
    } else {
      rows.push({ unit: u, isGroupStart: false, isGroupMember: false, groupSize: 1 });
      i++;
    }
  }
  return rows;
}

// 科目ブロック
function SubjectBlock({ subject }: { subject: TestPrepProposalWithDetails['subjects'][number] }) {
  const totalKoma = (subject.units || []).reduce((sum, u) => sum + u.koma_count, 0);
  const rows = buildGroupedRows(subject.units || []);

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
          {rows.map((row) => (
            <tr
              key={row.unit.id}
              className={`border-t border-gray-100 ${row.isGroupMember ? 'bg-blue-50/30' : ''}`}
            >
              <td className="px-2 py-1.5 text-gray-700">{row.unit.unit_name}</td>
              <td className="text-center">
                {row.unit.self_assessment && (
                  <span className={ASSESSMENT_STYLES[row.unit.self_assessment] || ''}>
                    {row.unit.self_assessment}
                  </span>
                )}
              </td>
              {row.isGroupMember ? (
                row.isGroupStart ? (
                  <td
                    className="text-center font-medium text-gray-800 bg-blue-50/50"
                    rowSpan={row.groupSize}
                  >
                    {row.unit.koma_count}
                  </td>
                ) : null
              ) : (
                <td className="text-center font-medium text-gray-800">{row.unit.koma_count}</td>
              )}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-gray-200 bg-gray-50 font-bold">
            <td className="px-2 py-1.5 text-gray-600">合計</td>
            <td />
            <td className="text-center text-red-600 print:text-gray-900">{totalKoma}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// 増コマ申込セクション — ポータルの増コマフォームへリンク
// schoolCode があればリンクを表示（期間の有効判定はポータル側で行う）
function ZoukomaSection({
  proposal,
  schoolCode,
  studentName,
  studentGrade,
  totalKoma,
}: {
  proposal: TestPrepProposalWithDetails;
  schoolCode: string | null;
  studentName: string;
  studentGrade: string;
  totalKoma: number;
}) {
  if (!schoolCode) return null;

  // 科目別コマ数
  const subjectKoma = proposal.subjects.map((s) => ({
    name: s.subject_name,
    koma: (s.units || []).reduce((sum, u) => sum + u.koma_count, 0),
  }));

  // 増コマフォームURL（生徒名・学年・科目別コマ数をクエリパラメータで渡す）
  const params = new URLSearchParams({ name: studentName, grade: studentGrade });
  for (const sk of subjectKoma) {
    if (sk.koma > 0) params.set(`s_${sk.name}`, String(sk.koma));
  }
  const zoukomaUrl = `/portal/${schoolCode}/zoukoma?${params.toString()}`;

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <div className="px-6 py-5 bg-gradient-to-r from-blue-50 to-white">
        <h2 className="font-bold text-gray-900 text-lg">テスト対策 増コマ申し込み</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          提案内容をもとに増コマをお申し込みいただけます
        </p>
      </div>

      <div className="px-6 py-4 border-t border-gray-100">
        {/* 提案内容サマリー */}
        <div className="flex items-center gap-6 mb-4 text-sm">
          <div>
            <span className="text-gray-400 text-xs">生徒</span>
            <p className="font-medium text-gray-900">
              {studentName} ({studentGrade})
            </p>
          </div>
          <div>
            <span className="text-gray-400 text-xs">提案コマ数</span>
            <p className="font-bold text-red-600 text-lg">
              {totalKoma}
              <span className="text-sm font-normal text-gray-500 ml-0.5">コマ</span>
            </p>
          </div>
        </div>

        {/* 科目別内訳 */}
        <div className="flex flex-wrap gap-2 mb-5">
          {subjectKoma.map((sk) => (
            <span
              key={sk.name}
              className="px-2.5 py-1 bg-gray-100 rounded-lg text-xs text-gray-700"
            >
              {sk.name} <span className="font-bold">{sk.koma}</span>コマ
            </span>
          ))}
        </div>

        {/* 増コマフォームへのリンク
            「申し込む」だと、この場で申込確定するように見えてしまう。実際は申込フォームへ遷移するだけなので、
            文言・矢印アイコン・補足テキストで「フォームに移動する」ことを明示する。 */}
        <a
          href={zoukomaUrl}
          className="flex items-center justify-center gap-1.5 w-full py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 transition-[colors,transform] active:scale-[0.97] text-sm text-center"
        >
          増コマ申込フォームへ進む
          <ArrowRight className="w-4 h-4" />
        </a>
        <p className="text-xs text-gray-500 mt-2 text-center">
          ボタンを押すと、お申し込みフォームに移動します。日時の選択・送信はフォーム上で行います。
        </p>
      </div>
    </div>
  );
}
