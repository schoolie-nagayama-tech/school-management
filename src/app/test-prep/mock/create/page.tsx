'use client';

import { useState } from 'react';

// ダミー生徒リスト
const MOCK_STUDENTS = [
  { id: '1', name: '山田 太郎', grade: 8, gradeName: '中2' },
  { id: '2', name: '鈴木 花子', grade: 9, gradeName: '中3' },
  { id: '3', name: '佐藤 健太', grade: 10, gradeName: '高1' },
  { id: '4', name: '田中 美咲', grade: 7, gradeName: '中1' },
];

// 学年別デフォルト科目
const GRADE_SUBJECTS: Record<string, string[]> = {
  中学: ['英語', '数学', '国語', '理科', '社会'],
  高校: ['英語C', '英語R', '数学Ⅰ', '数学A', '現代文', '化学基礎', '歴史総合'],
};

// ダミー単元候補（テキストマスタから取得する想定）
const MOCK_UNITS: Record<string, string[]> = {
  英語: ['Unit 3 接続詞 that', 'Unit 4 不定詞', 'Unit 4 動名詞', 'Unit 5 比較', 'Unit 5 最上級'],
  数学: ['式の計算（多項式）', '連立方程式（加減法）', '連立方程式（代入法）', '連立方程式の利用', '1次関数'],
  国語: ['枕草子', '文法（助動詞）', '古文読解', '漢字・語句'],
  理科: ['化学変化と原子・分子', '化学変化と質量', '電流と回路', 'オームの法則'],
  社会: ['日本の地域的特色', '世界と日本の結びつき', '日本の産業', '地形図の読み取り'],
};

const ASSESSMENTS = ['◎', '○', '△', '×'] as const;

interface UnitRow {
  id: string;
  name: string;
  assessment: string;
  koma: number;
  fromMaster: boolean;
}

interface SubjectBlock {
  id: string;
  name: string;
  targetScore: number | null;
  units: UnitRow[];
}

export default function TestPrepCreateMock() {
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [examType, setExamType] = useState('中間テスト');
  const [subjects, setSubjects] = useState<SubjectBlock[]>([]);
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<'draft' | 'sent' | 'published'>('draft');

  const selectedStudent = MOCK_STUDENTS.find((s) => s.id === selectedStudentId);
  const gradeCategory = selectedStudent
    ? selectedStudent.grade >= 10
      ? '高校'
      : '中学'
    : null;

  // 生徒選択時に科目テンプレートを自動生成
  const handleStudentSelect = (studentId: string) => {
    setSelectedStudentId(studentId);
    const student = MOCK_STUDENTS.find((s) => s.id === studentId);
    if (!student) return;
    const category = student.grade >= 10 ? '高校' : '中学';
    const subjectNames = GRADE_SUBJECTS[category] || [];
    setSubjects(
      subjectNames.map((name, i) => ({
        id: `subj-${i}`,
        name,
        targetScore: null,
        units: [],
      }))
    );
  };

  const addUnit = (subjectId: string, unitName: string, fromMaster: boolean) => {
    setSubjects((prev) =>
      prev.map((s) =>
        s.id === subjectId
          ? {
              ...s,
              units: [
                ...s.units,
                {
                  id: `unit-${Date.now()}-${Math.random()}`,
                  name: unitName,
                  assessment: '',
                  koma: 1,
                  fromMaster,
                },
              ],
            }
          : s
      )
    );
  };

  const updateUnit = (subjectId: string, unitId: string, patch: Partial<UnitRow>) => {
    setSubjects((prev) =>
      prev.map((s) =>
        s.id === subjectId
          ? { ...s, units: s.units.map((u) => (u.id === unitId ? { ...u, ...patch } : u)) }
          : s
      )
    );
  };

  const removeUnit = (subjectId: string, unitId: string) => {
    setSubjects((prev) =>
      prev.map((s) =>
        s.id === subjectId
          ? { ...s, units: s.units.filter((u) => u.id !== unitId) }
          : s
      )
    );
  };

  const updateSubjectScore = (subjectId: string, score: number | null) => {
    setSubjects((prev) =>
      prev.map((s) => (s.id === subjectId ? { ...s, targetScore: score } : s))
    );
  };

  const totalKoma = subjects.reduce(
    (sum, s) => sum + s.units.reduce((us, u) => us + u.koma, 0),
    0
  );

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      {/* トップバー */}
      <div className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-gray-200 px-6 py-3">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <a href="/test-prep/mock" className="text-sm text-gray-400 hover:text-gray-600">
              ← プレビューに戻る
            </a>
            <span className="text-gray-300">|</span>
            <h1 className="font-bold text-gray-900">テスト対策提案書 作成</h1>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={status} />
            <button
              onClick={() => { setStatus('draft'); alert('下書き保存しました（モック）'); }}
              className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              下書き保存
            </button>
            <button
              onClick={() => { setStatus('published'); alert('保存して公開URLを発行しました（モック）'); }}
              className="px-4 py-2 text-sm bg-red-600 text-white font-medium rounded-lg hover:bg-red-700 transition-colors"
            >
              保存して共有URL発行
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* 基本情報セクション */}
        <section className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-4">基本情報</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* 生徒選択 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">生徒</label>
              <select
                value={selectedStudentId}
                onChange={(e) => handleStudentSelect(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
              >
                <option value="">生徒を選択...</option>
                {MOCK_STUDENTS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}（{s.gradeName}）
                  </option>
                ))}
              </select>
            </div>
            {/* 試験種別 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">試験種別</label>
              <select
                value={examType}
                onChange={(e) => setExamType(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
              >
                <option>中間テスト</option>
                <option>期末テスト</option>
                <option>実力テスト</option>
              </select>
            </div>
            {/* 増コマ期間紐づけ */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">増コマ申込期間</label>
              <select className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                <option value="">紐づけなし</option>
                <option>2026年1学期中間テスト対策（5/20〜6/5）</option>
                <option>2026年1学期期末テスト対策（6/15〜7/1）</option>
              </select>
            </div>
          </div>
          {selectedStudent && (
            <div className="mt-4 flex items-center gap-4 p-3 bg-gray-50 rounded-lg text-sm">
              <span className="text-gray-500">選択中:</span>
              <span className="font-bold text-gray-900">{selectedStudent.name}</span>
              <span className="text-gray-500">{selectedStudent.gradeName}</span>
              <span className="text-gray-400">|</span>
              <span className="text-gray-500">科目テンプレート: {gradeCategory}（{subjects.length}科目）</span>
            </div>
          )}
        </section>

        {/* 科目ブロック */}
        {subjects.length > 0 && (
          <section className="space-y-4 mb-6">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide">科目・単元</h2>
              <div className="text-sm text-gray-500">
                合計: <span className="font-bold text-red-600 text-lg">{totalKoma}</span> コマ
              </div>
            </div>
            {subjects.map((subject) => (
              <SubjectEditor
                key={subject.id}
                subject={subject}
                gradeCategory={gradeCategory}
                onUpdateScore={(score) => updateSubjectScore(subject.id, score)}
                onAddUnit={(name, fromMaster) => addUnit(subject.id, name, fromMaster)}
                onUpdateUnit={(unitId, patch) => updateUnit(subject.id, unitId, patch)}
                onRemoveUnit={(unitId) => removeUnit(subject.id, unitId)}
              />
            ))}
            <button
              onClick={() => {
                const name = prompt('追加する科目名を入力');
                if (name) {
                  setSubjects((prev) => [
                    ...prev,
                    { id: `subj-${Date.now()}`, name, targetScore: null, units: [] },
                  ]);
                }
              }}
              className="w-full py-3 border-2 border-dashed border-gray-300 rounded-xl text-sm text-gray-400 hover:border-gray-400 hover:text-gray-600 transition-colors"
            >
              + 科目を追加
            </button>
          </section>
        )}

        {/* メモ */}
        <section className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">講師メモ</h2>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="保護者・生徒へのメッセージ（公開ページに表示されます）"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none"
          />
        </section>

        {/* 未選択状態 */}
        {!selectedStudentId && (
          <div className="text-center py-16 text-gray-400">
            <p className="text-lg">生徒を選択して提案書を作成してください</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------
   科目エディタ
   ------------------------------------------------------------------ */
function SubjectEditor({
  subject,
  gradeCategory,
  onUpdateScore,
  onAddUnit,
  onUpdateUnit,
  onRemoveUnit,
}: {
  subject: SubjectBlock;
  gradeCategory: string | null;
  onUpdateScore: (score: number | null) => void;
  onAddUnit: (name: string, fromMaster: boolean) => void;
  onUpdateUnit: (unitId: string, patch: Partial<UnitRow>) => void;
  onRemoveUnit: (unitId: string) => void;
}) {
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [freeInput, setFreeInput] = useState('');
  const totalKoma = subject.units.reduce((sum, u) => sum + u.koma, 0);
  const candidates = MOCK_UNITS[subject.name] || [];

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* 科目ヘッダー */}
      <div className="px-4 py-3 bg-gray-800 flex items-center justify-between">
        <span className="font-bold text-white">{subject.name}</span>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-300">目標点</span>
            <input
              type="number"
              value={subject.targetScore ?? ''}
              onChange={(e) => onUpdateScore(e.target.value ? Number(e.target.value) : null)}
              placeholder="--"
              min={0}
              max={100}
              className="w-16 px-2 py-1 text-sm text-center rounded border border-gray-600 bg-gray-700 text-white placeholder-gray-400"
            />
          </div>
          <div className="text-sm text-gray-300">
            計 <span className="text-yellow-300 font-bold">{totalKoma}</span> コマ
          </div>
        </div>
      </div>

      {/* 単元テーブル */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-gray-500 text-xs">
              <th className="text-left px-4 py-2 font-medium w-1/2">単元名</th>
              <th className="text-center px-2 py-2 font-medium w-24">自己評価</th>
              <th className="text-center px-2 py-2 font-medium w-24">コマ数</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {subject.units.map((unit) => (
              <tr key={unit.id} className="border-t border-gray-100 hover:bg-gray-50/50">
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2">
                    {unit.fromMaster && (
                      <span className="shrink-0 px-1.5 py-0.5 text-[10px] bg-blue-100 text-blue-700 rounded">
                        マスタ
                      </span>
                    )}
                    <span className="text-gray-800">{unit.name}</span>
                  </div>
                </td>
                <td className="text-center px-2 py-2">
                  <select
                    value={unit.assessment}
                    onChange={(e) => onUpdateUnit(unit.id, { assessment: e.target.value })}
                    className="px-2 py-1 border border-gray-200 rounded text-sm text-center bg-white"
                  >
                    <option value="">-</option>
                    {ASSESSMENTS.map((a) => (
                      <option key={a} value={a}>{a}</option>
                    ))}
                  </select>
                </td>
                <td className="text-center px-2 py-2">
                  <input
                    type="number"
                    value={unit.koma}
                    onChange={(e) => onUpdateUnit(unit.id, { koma: Math.max(0, Number(e.target.value)) })}
                    min={0}
                    className="w-16 px-2 py-1 border border-gray-200 rounded text-sm text-center"
                  />
                </td>
                <td className="px-2 py-2 text-center">
                  <button
                    onClick={() => onRemoveUnit(unit.id)}
                    className="text-gray-300 hover:text-red-500 transition-colors"
                    title="削除"
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
            {subject.units.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-4 text-center text-gray-400 text-xs">
                  単元を追加してください
                </td>
              </tr>
            )}
          </tbody>
          {subject.units.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-gray-200 bg-gray-50 font-bold text-sm">
                <td className="px-4 py-2 text-gray-600">合計</td>
                <td />
                <td className="text-center text-red-600">{totalKoma}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* 単元追加 */}
      <div className="px-4 py-3 border-t border-gray-100 bg-gray-50/50">
        {showAddMenu ? (
          <div className="space-y-2">
            {/* テキストマスタ候補 */}
            {candidates.length > 0 && (
              <div>
                <p className="text-xs text-gray-400 mb-1">試験範囲の単元（テキストマスタ）</p>
                <div className="flex flex-wrap gap-1.5">
                  {candidates.map((c) => (
                    <button
                      key={c}
                      onClick={() => { onAddUnit(c, true); }}
                      className="px-2.5 py-1 text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors"
                    >
                      + {c}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {/* 手入力 */}
            <div className="flex items-center gap-2 mt-2">
              <input
                type="text"
                value={freeInput}
                onChange={(e) => setFreeInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && freeInput.trim()) {
                    onAddUnit(freeInput.trim(), false);
                    setFreeInput('');
                  }
                }}
                placeholder="手入力で単元名を追加（Enter で追加）"
                className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
              />
              <button
                onClick={() => {
                  if (freeInput.trim()) {
                    onAddUnit(freeInput.trim(), false);
                    setFreeInput('');
                  }
                }}
                className="px-3 py-1.5 text-xs bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
              >
                追加
              </button>
              <button
                onClick={() => setShowAddMenu(false)}
                className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-600"
              >
                閉じる
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowAddMenu(true)}
            className="text-sm text-blue-600 hover:text-blue-800 font-medium"
          >
            + 単元を追加
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------
   ステータスバッジ
   ------------------------------------------------------------------ */
function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-600',
    sent: 'bg-yellow-100 text-yellow-700',
    published: 'bg-green-100 text-green-700',
  };
  const labels: Record<string, string> = {
    draft: '下書き',
    sent: '提案済',
    published: '公開中',
  };
  return (
    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${styles[status] || styles.draft}`}>
      {labels[status] || status}
    </span>
  );
}
