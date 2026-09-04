'use client';

/**
 * テスト対策提案書のモックプレビュー（デザイン確認用・ダミーデータ）。
 *
 * 紙面そのものは公開ページ `/test-prep/[token]` と同じ `ProposalSheet` を描画する。
 * 以前はこのファイルに紙面のマークアップを複製していたため、公開ページだけ直すと
 * モックが古い見た目のまま取り残されていた。データの形だけここで用意する。
 */
import {
  ProposalSheet,
  ProposalApplyCard,
  type ProposalSheetData,
} from '@/components/test-prep/ProposalSheet';

const ASSESSMENT_LABELS: Record<string, string> = {
  '◎': 'よくできる',
  '○': 'できる',
  '△': 'やや不安',
  '×': '苦手',
};

const MOCK_SHEET: ProposalSheetData = {
  schoolName: '本校',
  title: '1学期 中間テスト対策',
  teacherName: '田中',
  studentName: '山田 太郎',
  studentGrade: '中2',
  examName: '中間テスト',
  notes: '英語と数学を重点的に対策しましょう。前回のテストで苦手だった分野を中心に組んでいます。',
  assessmentLabels: ASSESSMENT_LABELS,
  subjects: [
    {
      id: 'en',
      name: '英語',
      targetScore: 80,
      units: [
        { id: 'en1', name: 'Unit 3 接続詞 that', assessment: '△', koma: 2, groupId: null },
        { id: 'en2', name: 'Unit 4 不定詞', assessment: '×', koma: 3, groupId: 'g1' },
        { id: 'en3', name: 'Unit 4 動名詞', assessment: '△', koma: 3, groupId: 'g1' },
      ],
    },
    {
      id: 'ma',
      name: '数学',
      targetScore: 75,
      units: [
        { id: 'ma1', name: '式の計算（多項式）', assessment: '○', koma: 1, groupId: null },
        { id: 'ma2', name: '連立方程式（加減法）', assessment: '△', koma: 2, groupId: null },
        { id: 'ma3', name: '連立方程式（代入法）', assessment: '×', koma: 3, groupId: null },
        { id: 'ma4', name: '連立方程式の利用', assessment: '×', koma: 2, groupId: null },
      ],
    },
    {
      id: 'jp',
      name: '国語',
      targetScore: 70,
      units: [
        { id: 'jp1', name: '枕草子', assessment: '○', koma: 1, groupId: null },
        { id: 'jp2', name: '文法（助動詞）', assessment: '△', koma: 2, groupId: null },
      ],
    },
    {
      id: 'sc',
      name: '理科',
      targetScore: 85,
      units: [
        { id: 'sc1', name: '化学変化と原子・分子', assessment: '△', koma: 2, groupId: null },
        { id: 'sc2', name: '化学変化と質量', assessment: '○', koma: 1, groupId: null },
      ],
    },
    {
      id: 'so',
      name: '社会',
      targetScore: 70,
      units: [
        { id: 'so1', name: '日本の地域的特色', assessment: '△', koma: 2, groupId: null },
        { id: 'so2', name: '世界と日本の結びつき', assessment: '○', koma: 1, groupId: null },
      ],
    },
  ],
};

export default function TestPrepProposalMock() {
  const subjectKoma = MOCK_SHEET.subjects.map((s) => ({
    name: s.name,
    koma: s.units.reduce((sum, u) => sum + u.koma, 0),
  }));

  return (
    <div className="min-h-screen bg-[#f3f4f6] print:bg-white print:min-h-0">
      {/* 印刷時に非表示のナビバー */}
      <div className="print:hidden bg-white border-b border-[#e5e7eb] px-4 py-2 text-xs text-[#9ca3af] text-center">
        モックプレビュー — 実際の公開ページではこのバーは表示されません
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 print:px-0 print:py-0 print:max-w-none">
        <ProposalSheet
          data={MOCK_SHEET}
          printUrl="https://example.com/test-prep/abc123xyz"
          hasApplyLink
        />

        <div className="mt-4">
          {/* モックなのでリンク先はダミー。本番は /portal/[schoolCode]/zoukoma に飛ぶ */}
          <ProposalApplyCard subjectKoma={subjectKoma} applyUrl="#" />
        </div>

        {/* 講師作成画面への導線（モック用） */}
        <div className="print:hidden mt-6 text-center">
          <a
            href="/test-prep/mock/create"
            className="text-sm text-[#9ca3af] hover:text-[#4b5563] underline"
          >
            講師作成画面モックを見る →
          </a>
        </div>
      </div>

      {/* 印刷用スタイル（公開ページと同じ設定） */}
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 8mm 10mm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>
    </div>
  );
}
