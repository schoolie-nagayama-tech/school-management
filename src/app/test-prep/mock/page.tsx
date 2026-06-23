'use client';

import { useState } from 'react';

// ダミーデータ
const MOCK_PROPOSAL = {
  title: '1学期 中間テスト対策',
  schoolName: '本校',
  studentName: '山田 太郎',
  grade: '中2',
  examType: '中間テスト',
  teacherName: '田中先生',
  notes: '英語と数学を重点的に対策しましょう。前回のテストで苦手だった分野を中心に組んでいます。',
  subjects: [
    {
      name: '英語',
      targetScore: 80,
      units: [
        { name: 'Unit 3 接続詞 that', assessment: '△' as const, koma: 2 },
        { name: 'Unit 4 不定詞', assessment: '×' as const, koma: 3 },
        { name: 'Unit 4 動名詞', assessment: '△' as const, koma: 2 },
      ],
    },
    {
      name: '数学',
      targetScore: 75,
      units: [
        { name: '式の計算（多項式）', assessment: '○' as const, koma: 1 },
        { name: '連立方程式（加減法）', assessment: '△' as const, koma: 2 },
        { name: '連立方程式（代入法）', assessment: '×' as const, koma: 3 },
        { name: '連立方程式の利用', assessment: '×' as const, koma: 2 },
      ],
    },
    {
      name: '国語',
      targetScore: 70,
      units: [
        { name: '枕草子', assessment: '○' as const, koma: 1 },
        { name: '文法（助動詞）', assessment: '△' as const, koma: 2 },
      ],
    },
    {
      name: '理科',
      targetScore: 85,
      units: [
        { name: '化学変化と原子・分子', assessment: '△' as const, koma: 2 },
        { name: '化学変化と質量', assessment: '○' as const, koma: 1 },
      ],
    },
    {
      name: '社会',
      targetScore: 70,
      units: [
        { name: '日本の地域的特色', assessment: '△' as const, koma: 2 },
        { name: '世界と日本の結びつき', assessment: '○' as const, koma: 1 },
      ],
    },
  ],
};

const ASSESSMENT_STYLES: Record<string, string> = {
  '◎': 'text-blue-600 font-bold',
  '○': 'text-green-600 font-bold',
  '△': 'text-yellow-600 font-bold',
  '×': 'text-red-600 font-bold',
};

const ASSESSMENT_LABELS: Record<string, string> = {
  '◎': 'よくできる',
  '○': 'できる',
  '△': 'やや不安',
  '×': '苦手',
};

export default function TestPrepProposalMock() {
  const [showForm, setShowForm] = useState(false);
  const p = MOCK_PROPOSAL;
  const totalKoma = p.subjects.reduce(
    (sum, s) => sum + s.units.reduce((us, u) => us + u.koma, 0),
    0
  );

  return (
    <div className="min-h-screen bg-gray-50 print:bg-white print:min-h-0">
      {/* 印刷時に非表示のナビバー */}
      <div className="print:hidden bg-white border-b border-gray-200 px-4 py-2 text-xs text-gray-400 text-center">
        モックプレビュー — 実際の公開ページではこのバーは表示されません
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8 print:px-0 print:py-0 print:max-w-none">
        {/* === 提案書本体 === */}
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden print:rounded-none print:border-none print:shadow-none">
          {/* ヘッダー */}
          <div className="bg-gradient-to-r from-red-600 to-red-500 px-6 py-5 print:from-red-700 print:to-red-700 print:py-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-red-100 text-sm">{p.schoolName}</p>
                <h1 className="text-xl font-bold text-white mt-0.5">{p.title}</h1>
              </div>
              <div className="text-right text-sm text-red-100">
                <p>担当: {p.teacherName}</p>
              </div>
            </div>
          </div>

          {/* 生徒情報 */}
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
            <div className="flex items-center gap-6">
              <div>
                <span className="text-xs text-gray-400">生徒名</span>
                <p className="font-bold text-gray-900 text-lg">{p.studentName}</p>
              </div>
              <div>
                <span className="text-xs text-gray-400">学年</span>
                <p className="font-medium text-gray-700">{p.grade}</p>
              </div>
              <div>
                <span className="text-xs text-gray-400">試験</span>
                <p className="font-medium text-gray-700">{p.examType}</p>
              </div>
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
            {Object.entries(ASSESSMENT_LABELS).map(([mark, label]) => (
              <span key={mark} className="flex items-center gap-1">
                <span className={ASSESSMENT_STYLES[mark]}>{mark}</span>
                <span>{label}</span>
              </span>
            ))}
          </div>

          {/* メッセージ */}
          {p.notes && (
            <div className="mx-6 mt-2 mb-4 p-3 bg-blue-50 rounded-lg border border-blue-100 text-sm text-blue-800">
              {p.notes}
            </div>
          )}

          {/* 科目ブロック群 */}
          <div className="px-6 pb-6">
            {/* 上段: 3科目 */}
            <div className="grid grid-cols-1 md:grid-cols-3 print:grid-cols-3 gap-4 mb-4">
              {p.subjects.slice(0, 3).map((subject) => (
                <SubjectBlock key={subject.name} subject={subject} />
              ))}
            </div>
            {/* 下段: 2科目 */}
            {p.subjects.length > 3 && (
              <div className="grid grid-cols-1 md:grid-cols-2 print:grid-cols-2 gap-4">
                {p.subjects.slice(3).map((subject) => (
                  <SubjectBlock key={subject.name} subject={subject} />
                ))}
              </div>
            )}
          </div>

          {/* QRコード・申込導線（印刷用） */}
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
                  https://example.com/test-prep/abc123xyz
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* === 増コマ申込セクション（画面表示のみ、印刷時非表示） === */}
        <div className="print:hidden mt-8">
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
                <MockZoukomaForm proposal={p} />
              </div>
            )}
          </div>
        </div>

        {/* 講師作成画面への導線（モック用） */}
        <div className="print:hidden mt-6 text-center">
          <a
            href="/test-prep/mock/create"
            className="text-sm text-gray-400 hover:text-gray-600 underline"
          >
            講師作成画面モックを見る →
          </a>
        </div>
      </div>

      {/* 印刷用スタイル */}
      <style>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 10mm 12mm;
          }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>
    </div>
  );
}

/* ------------------------------------------------------------------
   科目ブロック
   ------------------------------------------------------------------ */
function SubjectBlock({ subject }: { subject: (typeof MOCK_PROPOSAL)['subjects'][number] }) {
  const totalKoma = subject.units.reduce((sum, u) => sum + u.koma, 0);

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      {/* 科目ヘッダー */}
      <div className="px-3 py-2 bg-gray-800 text-white flex items-center justify-between">
        <span className="font-bold text-sm">{subject.name}</span>
        {subject.targetScore != null && (
          <span className="text-xs text-gray-300">
            目標 <span className="text-yellow-300 font-bold">{subject.targetScore}</span>点
          </span>
        )}
      </div>
      {/* 単元テーブル */}
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-gray-50 text-gray-500">
            <th className="text-left px-2 py-1.5 font-medium">単元</th>
            <th className="w-10 text-center px-1 py-1.5 font-medium">評価</th>
            <th className="w-12 text-center px-1 py-1.5 font-medium">コマ</th>
          </tr>
        </thead>
        <tbody>
          {subject.units.map((unit, i) => (
            <tr key={i} className="border-t border-gray-100">
              <td className="px-2 py-1.5 text-gray-700">{unit.name}</td>
              <td className="text-center">
                {unit.assessment && (
                  <span className={ASSESSMENT_STYLES[unit.assessment]}>{unit.assessment}</span>
                )}
              </td>
              <td className="text-center font-medium text-gray-800">{unit.koma}</td>
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

/* ------------------------------------------------------------------
   増コマ申込フォーム（モック版・プレフィル済み）
   ------------------------------------------------------------------ */
function MockZoukomaForm({ proposal }: { proposal: typeof MOCK_PROPOSAL }) {
  const subjectKoma = proposal.subjects.map((s) => ({
    name: s.name,
    koma: s.units.reduce((sum, u) => sum + u.koma, 0),
  }));
  const totalKoma = subjectKoma.reduce((s, sk) => s + sk.koma, 0);
  const unitPrice = 3980;
  const totalFee = totalKoma * unitPrice;

  return (
    <div className="space-y-6">
      {/* プレフィル済みフィールド */}
      <div className="p-4 bg-blue-50 rounded-lg border border-blue-100">
        <p className="text-xs text-blue-600 font-medium mb-2">提案書から自動入力済み</p>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-gray-500 text-xs">生徒名</span>
            <p className="font-medium text-gray-900">{proposal.studentName}</p>
          </div>
          <div>
            <span className="text-gray-500 text-xs">学年</span>
            <p className="font-medium text-gray-900">{proposal.grade}</p>
          </div>
        </div>
      </div>

      {/* 科目コマ数（プレフィル、編集可能） */}
      <div>
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

      {/* 料金 */}
      <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
        <div className="flex justify-between text-sm mb-1">
          <span className="text-gray-600">合計コマ数</span>
          <span className="font-bold">{totalKoma} コマ</span>
        </div>
        <div className="flex justify-between text-sm mb-1">
          <span className="text-gray-600">単価（{proposal.grade}）</span>
          <span>{unitPrice.toLocaleString()} 円</span>
        </div>
        <div className="flex justify-between text-base font-bold border-t border-gray-200 pt-2 mt-2">
          <span>合計金額</span>
          <span className="text-red-600">{totalFee.toLocaleString()} 円（税込）</span>
        </div>
      </div>

      {/* メールアドレス */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">保護者メールアドレス</label>
        <input
          type="email"
          placeholder="example@email.com"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
        />
      </div>

      {/* 備考 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">備考</label>
        <textarea
          rows={2}
          placeholder="ご質問やご要望があればお書きください"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none"
        />
      </div>

      {/* 送信ボタン */}
      <button
        type="button"
        onClick={() => alert('モックのため送信できません')}
        className="w-full py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 transition-colors text-sm"
      >
        増コマを申し込む
      </button>
    </div>
  );
}
