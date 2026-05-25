'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/useToast';
import { ToastContainer } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import {
  createTestPrepProposal,
  getTestPrepProposalWithDetails,
  updateTestPrepProposal,
  replaceTestPrepSubjects,
  deleteTestPrepProposal,
} from '@/lib/api/test-prep-proposals';
import { getExamTypes } from '@/lib/api/textbooks';
import type { Student, ExamType, CurriculumItem } from '@/types/database';
import type {
  TestPrepProposalWithDetails,
  TestPrepStatus,
  SelfAssessment,
} from '@/types/test-prep';
import {
  SELF_ASSESSMENTS,
  GRADE_SUBJECT_TEMPLATES,
} from '@/types/test-prep';

// 科目エディタの1行
interface UnitDraft {
  tempId: string;
  curriculum_item_id: number | null;
  unit_name: string;
  self_assessment: SelfAssessment | null;
  koma_count: number;
  fromMaster: boolean;
}

interface SubjectDraft {
  tempId: string;
  subject_name: string;
  target_score: number | null;
  units: UnitDraft[];
}

// 学年カテゴリ判定
function gradeCategory(grade: number): 'middle' | 'high' | 'elementary' {
  if (grade >= 10) return 'high';
  if (grade >= 7) return 'middle';
  return 'elementary';
}

function genId() {
  return `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function TestPrepEditor() {
  const params = useParams();
  const router = useRouter();
  const { user, profile, getSelectedSchoolIds } = useAuth();
  const { toasts, removeToast, success, error: showError } = useToast();

  const studentId = params?.studentId as string;
  const proposalId = params?.proposalId as string | undefined;
  const isNew = !proposalId;

  // データ
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [student, setStudent] = useState<Student | null>(null);
  const [examTypes, setExamTypes] = useState<ExamType[]>([]);
  const [proposal, setProposal] = useState<TestPrepProposalWithDetails | null>(null);

  // フォーム
  const [title, setTitle] = useState('');
  const [examTypeId, setExamTypeId] = useState<string>('');
  const [zoukomaPeriodId, setZoukomaPeriodId] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [subjects, setSubjects] = useState<SubjectDraft[]>([]);
  const [status, setStatus] = useState<TestPrepStatus>('draft');

  // 増コマ期間候補
  const [zoukomaPeriods, setZoukomaPeriods] = useState<Array<{ id: string; title: string; period_key: string }>>([]);

  // テキストマスタの単元候補（科目名 → 単元名[]）
  const [masterUnits, setMasterUnits] = useState<Map<string, CurriculumItem[]>>(new Map());

  // 初期データロード
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const schoolIds = getSelectedSchoolIds();
      const schoolId = schoolIds[0];

      // 生徒情報
      const { data: rawStudent } = await supabase
        .from('students')
        .select('*')
        .eq('id', studentId)
        .single();
      const studentData = rawStudent as Student | null;
      if (studentData) setStudent(studentData);

      // 試験種別
      if (schoolId) {
        const types = await getExamTypes(schoolId);
        setExamTypes(types);
      }

      // 増コマ期間
      if (schoolId) {
        const { data: periods } = await supabase
          .from('form_periods')
          .select('id, title, period_key')
          .eq('school_id', schoolId)
          .eq('form_type', 'zoukoma')
          .eq('is_active', true)
          .order('publish_start', { ascending: false });
        setZoukomaPeriods((periods || []) as Array<{ id: string; title: string; period_key: string }>);
      }

      // 既存提案書のロード
      if (!isNew && proposalId) {
        const detail = await getTestPrepProposalWithDetails(proposalId);
        if (detail) {
          setProposal(detail);
          setTitle(detail.title);
          setExamTypeId(detail.exam_type_id || '');
          setZoukomaPeriodId(detail.zoukoma_period_id || '');
          setNotes(detail.notes || '');
          setStatus(detail.status);
          // 科目・単元をドラフトに変換
          setSubjects(
            detail.subjects.map((s) => ({
              tempId: s.id,
              subject_name: s.subject_name,
              target_score: s.target_score,
              units: (s.units || []).map((u) => ({
                tempId: u.id,
                curriculum_item_id: u.curriculum_item_id,
                unit_name: u.unit_name,
                self_assessment: u.self_assessment,
                koma_count: u.koma_count,
                fromMaster: !!u.curriculum_item_id,
              })),
            }))
          );
        }
      } else if (studentData) {
        // 新規: 学年テンプレートから科目を自動生成
        const cat = gradeCategory(studentData.grade);
        if (cat === 'middle') {
          setSubjects(
            GRADE_SUBJECT_TEMPLATES.middle.map((name, i) => ({
              tempId: genId(),
              subject_name: name,
              target_score: null,
              units: [],
            }))
          );
        } else if (cat === 'high') {
          // 高校: 生徒の教科書から科目を取得
          const { data: stbs } = await supabase
            .from('student_textbooks')
            .select('textbook:textbooks(subject)')
            .eq('student_id', studentId)
            .eq('is_active', true);
          const subjectSet = new Set<string>();
          for (const s of (stbs || []) as Array<Record<string, unknown>>) {
            const tb = s.textbook as { subject: string | null } | null;
            if (tb?.subject) subjectSet.add(tb.subject);
          }
          const subjectNames = Array.from(subjectSet);
          setSubjects(
            (subjectNames.length > 0 ? subjectNames : ['英語', '数学', '国語']).map((name) => ({
              tempId: genId(),
              subject_name: name,
              target_score: null,
              units: [],
            }))
          );
        }
        // タイトル自動生成
        const examTypeName = '';
        setTitle('テスト対策');
      }

      // テキストマスタ単元候補をロード
      if (studentData) {
        await loadMasterUnits(studentId);
      }
    } catch (e) {
      console.error(e);
      showError('データの読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  }, [studentId, proposalId, isNew, getSelectedSchoolIds, showError]);

  // テキストマスタから単元候補を取得（科目名→CurriculumItem[] のマップ）
  const loadMasterUnits = async (sid: string) => {
    const { data: stbsFull } = await supabase
      .from('student_textbooks')
      .select('id, textbook_id, textbook:textbooks(id, subject)')
      .eq('student_id', sid)
      .eq('is_active', true);

    const map = new Map<string, CurriculumItem[]>();
    for (const stb of (stbsFull || []) as Array<{ id: string; textbook_id: number; textbook: { id: number; subject: string | null } | null }>) {
      const subject = stb.textbook?.subject;
      const tbId = stb.textbook?.id;
      if (!subject || !tbId) continue;

      const { data: items } = await supabase
        .from('curriculum_items')
        .select('*')
        .eq('textbook_id', tbId)
        .order('item_number');

      if (items && items.length > 0) {
        const existing = map.get(subject) || [];
        map.set(subject, [...existing, ...(items as CurriculumItem[])]);
      }
    }

    setMasterUnits(map);
  };

  useEffect(() => {
    loadData();
  }, [loadData]);

  // タイトル自動更新
  useEffect(() => {
    if (isNew && student && examTypeId) {
      const et = examTypes.find((t) => t.id === examTypeId);
      if (et) {
        setTitle(`${et.name} 対策`);
      }
    }
  }, [isNew, student, examTypeId, examTypes]);

  // 保存
  const handleSave = async (newStatus?: TestPrepStatus) => {
    if (!student) return;
    const schoolIds = getSelectedSchoolIds();
    const schoolId = schoolIds[0];
    if (!schoolId) { showError('教室が選択されていません'); return; }

    setSaving(true);
    try {
      const subjectsPayload = subjects.map((s, i) => ({
        subject_name: s.subject_name,
        target_score: s.target_score,
        sort_order: i,
        units: s.units.map((u, ui) => ({
          curriculum_item_id: u.curriculum_item_id,
          unit_name: u.unit_name,
          self_assessment: u.self_assessment,
          koma_count: u.koma_count,
          sort_order: ui,
        })),
      }));

      const targetStatus = newStatus || status;

      if (isNew) {
        const created = await createTestPrepProposal(
          {
            school_id: schoolId,
            student_id: studentId,
            exam_type_id: examTypeId || null,
            teacher_user_id: user?.id || null,
            title,
            status: targetStatus,
            zoukoma_period_id: zoukomaPeriodId || null,
            notes: notes || null,
          },
          subjectsPayload
        );
        success('提案書を作成しました');
        router.replace(`/students/${studentId}/test-prep/${created.id}`);
      } else {
        await updateTestPrepProposal(proposalId!, {
          title,
          status: targetStatus,
          notes: notes || null,
          exam_type_id: examTypeId || null,
          zoukoma_period_id: zoukomaPeriodId || null,
        });
        await replaceTestPrepSubjects(proposalId!, subjectsPayload);
        setStatus(targetStatus);
        success('保存しました');
      }
    } catch (e) {
      console.error(e);
      showError('保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  // 削除
  const handleDelete = async () => {
    if (!proposalId) return;
    if (!window.confirm('この提案書を削除しますか？')) return;
    try {
      await deleteTestPrepProposal(proposalId);
      success('削除しました');
      router.replace(`/students/${studentId}/proposals`);
    } catch {
      showError('削除に失敗しました');
    }
  };

  // 科目操作
  const addSubject = () => {
    const name = prompt('科目名を入力してください');
    if (!name?.trim()) return;
    setSubjects((prev) => [...prev, { tempId: genId(), subject_name: name.trim(), target_score: null, units: [] }]);
  };

  const removeSubject = (tempId: string) => {
    setSubjects((prev) => prev.filter((s) => s.tempId !== tempId));
  };

  const updateSubject = (tempId: string, patch: Partial<SubjectDraft>) => {
    setSubjects((prev) => prev.map((s) => (s.tempId === tempId ? { ...s, ...patch } : s)));
  };

  // 単元操作
  const addUnit = (subjectTempId: string, unit: Omit<UnitDraft, 'tempId'>) => {
    setSubjects((prev) =>
      prev.map((s) =>
        s.tempId === subjectTempId
          ? { ...s, units: [...s.units, { ...unit, tempId: genId() }] }
          : s
      )
    );
  };

  const updateUnit = (subjectTempId: string, unitTempId: string, patch: Partial<UnitDraft>) => {
    setSubjects((prev) =>
      prev.map((s) =>
        s.tempId === subjectTempId
          ? { ...s, units: s.units.map((u) => (u.tempId === unitTempId ? { ...u, ...patch } : u)) }
          : s
      )
    );
  };

  const removeUnit = (subjectTempId: string, unitTempId: string) => {
    setSubjects((prev) =>
      prev.map((s) =>
        s.tempId === subjectTempId
          ? { ...s, units: s.units.filter((u) => u.tempId !== unitTempId) }
          : s
      )
    );
  };

  const totalKoma = subjects.reduce(
    (sum, s) => sum + s.units.reduce((us, u) => us + u.koma_count, 0),
    0
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!student) {
    return <div className="p-8 text-center text-text-muted">生徒が見つかりません</div>;
  }

  return (
    <div className="max-w-5xl mx-auto">
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      {/* ヘッダー */}
      <div className="sticky top-0 z-30 bg-surface-raised/90 backdrop-blur border-b border-border px-6 py-3 -mx-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.back()}
              className="text-sm text-text-muted hover:text-text-body"
            >
              ← 戻る
            </button>
            <span className="text-border">|</span>
            <h1 className="font-bold text-text-heading">
              {isNew ? 'テスト対策提案書 作成' : 'テスト対策提案書 編集'}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={status} />
            {!isNew && (
              <button
                onClick={handleDelete}
                className="px-3 py-1.5 text-xs text-text-muted hover:text-red-600 border border-border rounded-lg"
              >
                削除
              </button>
            )}
            <button
              onClick={() => handleSave('draft')}
              disabled={saving}
              className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-surface-hover transition-colors disabled:opacity-50"
            >
              下書き保存
            </button>
            <button
              onClick={() => handleSave('published')}
              disabled={saving}
              className="px-4 py-2 text-sm bg-primary text-primary-contrast font-medium rounded-lg hover:bg-primary-dark transition-colors disabled:opacity-50"
            >
              保存して公開
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-6 py-6">
        {/* 基本情報 */}
        <section className="bg-surface-raised rounded-xl border border-border p-6">
          <h2 className="text-sm font-bold text-text-muted uppercase tracking-wide mb-4">基本情報</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-body mb-1">生徒</label>
              <div className="px-3 py-2 bg-surface rounded-lg border border-border text-sm">
                {student.last_name} {student.first_name}
                <span className="text-text-muted ml-2">
                  {student.grade >= 10 ? `高${student.grade - 9}` : student.grade >= 7 ? `中${student.grade - 6}` : `小${student.grade}`}
                </span>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-text-body mb-1">試験種別</label>
              <select
                value={examTypeId}
                onChange={(e) => setExamTypeId(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface-raised"
              >
                <option value="">選択してください</option>
                {examTypes.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-text-body mb-1">増コマ申込期間</label>
              <select
                value={zoukomaPeriodId}
                onChange={(e) => setZoukomaPeriodId(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface-raised"
              >
                <option value="">紐づけなし</option>
                {zoukomaPeriods.map((p) => (
                  <option key={p.id} value={p.id}>{p.title}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-4">
            <label className="block text-sm font-medium text-text-body mb-1">タイトル</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="1学期 中間テスト対策"
              className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface-raised"
            />
          </div>
        </section>

        {/* 科目・単元 */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-text-muted uppercase tracking-wide">科目・単元</h2>
            <div className="text-sm text-text-muted">
              合計: <span className="font-bold text-primary text-lg">{totalKoma}</span> コマ
            </div>
          </div>

          {subjects.map((subject) => (
            <SubjectEditor
              key={subject.tempId}
              subject={subject}
              masterUnits={masterUnits.get(subject.subject_name) || []}
              onUpdateSubject={(patch) => updateSubject(subject.tempId, patch)}
              onAddUnit={(unit) => addUnit(subject.tempId, unit)}
              onUpdateUnit={(unitId, patch) => updateUnit(subject.tempId, unitId, patch)}
              onRemoveUnit={(unitId) => removeUnit(subject.tempId, unitId)}
              onRemoveSubject={() => removeSubject(subject.tempId)}
            />
          ))}

          <button
            onClick={addSubject}
            className="w-full py-3 border-2 border-dashed border-border rounded-xl text-sm text-text-muted hover:border-text-faint hover:text-text-body transition-colors"
          >
            + 科目を追加
          </button>
        </section>

        {/* メモ */}
        <section className="bg-surface-raised rounded-xl border border-border p-6">
          <h2 className="text-sm font-bold text-text-muted uppercase tracking-wide mb-3">講師メモ</h2>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="保護者・生徒へのメッセージ（公開ページに表示されます）"
            className="w-full px-3 py-2 border border-border rounded-lg text-sm resize-none bg-surface-raised"
          />
        </section>

        {/* 共有URL（公開済みの場合） */}
        {!isNew && proposal?.token && status !== 'draft' && (
          <section className="bg-surface-raised rounded-xl border border-border p-6">
            <h2 className="text-sm font-bold text-text-muted uppercase tracking-wide mb-3">共有URL</h2>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={`${typeof window !== 'undefined' ? window.location.origin : ''}/test-prep/${proposal.token}`}
                className="flex-1 px-3 py-2 border border-border rounded-lg text-sm bg-surface font-mono text-text-body"
              />
              <button
                onClick={() => {
                  navigator.clipboard.writeText(
                    `${window.location.origin}/test-prep/${proposal.token}`
                  );
                  success('URLをコピーしました');
                }}
                className="px-4 py-2 text-sm bg-primary text-primary-contrast rounded-lg hover:bg-primary-dark"
              >
                コピー
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

// === サブコンポーネント ===

function StatusBadge({ status }: { status: TestPrepStatus }) {
  const styles: Record<TestPrepStatus, string> = {
    draft: 'bg-surface text-text-muted',
    sent: 'bg-warning-subtle text-yellow-700',
    published: 'bg-success-subtle text-green-700',
  };
  const labels: Record<TestPrepStatus, string> = {
    draft: '下書き',
    sent: '提案済',
    published: '公開中',
  };
  return (
    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

function SubjectEditor({
  subject,
  masterUnits,
  onUpdateSubject,
  onAddUnit,
  onUpdateUnit,
  onRemoveUnit,
  onRemoveSubject,
}: {
  subject: SubjectDraft;
  masterUnits: CurriculumItem[];
  onUpdateSubject: (patch: Partial<SubjectDraft>) => void;
  onAddUnit: (unit: Omit<UnitDraft, 'tempId'>) => void;
  onUpdateUnit: (unitId: string, patch: Partial<UnitDraft>) => void;
  onRemoveUnit: (unitId: string) => void;
  onRemoveSubject: () => void;
}) {
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [freeInput, setFreeInput] = useState('');
  const totalKoma = subject.units.reduce((sum, u) => sum + u.koma_count, 0);

  // 既に追加済みの単元を除外
  const addedItemIds = new Set(subject.units.map((u) => u.curriculum_item_id).filter(Boolean));
  const availableMaster = masterUnits.filter((m) => !addedItemIds.has(m.id));

  return (
    <div className="bg-surface-raised rounded-xl border border-border overflow-hidden">
      {/* 科目ヘッダー */}
      <div className="px-4 py-3 bg-text-heading flex items-center justify-between">
        <span className="font-bold text-primary-contrast">{subject.subject_name}</span>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-300">目標点</span>
            <input
              type="number"
              value={subject.target_score ?? ''}
              onChange={(e) =>
                onUpdateSubject({ target_score: e.target.value ? Number(e.target.value) : null })
              }
              placeholder="--"
              min={0}
              max={100}
              className="w-16 px-2 py-1 text-sm text-center rounded border border-gray-600 bg-gray-700 text-white placeholder-gray-400"
            />
          </div>
          <div className="text-sm text-gray-300">
            計 <span className="text-yellow-300 font-bold">{totalKoma}</span> コマ
          </div>
          <button
            onClick={onRemoveSubject}
            className="text-gray-400 hover:text-red-400 text-xs ml-2"
            title="科目を削除"
          >
            ×
          </button>
        </div>
      </div>

      {/* 単元テーブル */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-surface text-text-muted text-xs">
              <th className="text-left px-4 py-2 font-medium w-1/2">単元名</th>
              <th className="text-center px-2 py-2 font-medium w-24">自己評価</th>
              <th className="text-center px-2 py-2 font-medium w-24">コマ数</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {subject.units.map((unit) => (
              <tr key={unit.tempId} className="border-t border-border hover:bg-surface-hover/50">
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2">
                    {unit.fromMaster && (
                      <span className="shrink-0 px-1.5 py-0.5 text-[10px] bg-blue-100 text-blue-700 rounded">
                        マスタ
                      </span>
                    )}
                    <span className="text-text-body">{unit.unit_name}</span>
                  </div>
                </td>
                <td className="text-center px-2 py-2">
                  <select
                    value={unit.self_assessment || ''}
                    onChange={(e) =>
                      onUpdateUnit(unit.tempId, {
                        self_assessment: (e.target.value || null) as SelfAssessment | null,
                      })
                    }
                    className="px-2 py-1 border border-border rounded text-sm text-center bg-surface-raised"
                  >
                    <option value="">-</option>
                    {SELF_ASSESSMENTS.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="text-center px-2 py-2">
                  <input
                    type="number"
                    value={unit.koma_count}
                    onChange={(e) =>
                      onUpdateUnit(unit.tempId, { koma_count: Math.max(0, Number(e.target.value)) })
                    }
                    min={0}
                    className="w-16 px-2 py-1 border border-border rounded text-sm text-center bg-surface-raised"
                  />
                </td>
                <td className="px-2 py-2 text-center">
                  <button
                    onClick={() => onRemoveUnit(unit.tempId)}
                    className="text-text-faint hover:text-red-500 transition-colors"
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
            {subject.units.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-4 text-center text-text-faint text-xs">
                  単元を追加してください
                </td>
              </tr>
            )}
          </tbody>
          {subject.units.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-border bg-surface font-bold text-sm">
                <td className="px-4 py-2 text-text-muted">合計</td>
                <td />
                <td className="text-center text-primary">{totalKoma}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* 単元追加 */}
      <div className="px-4 py-3 border-t border-border bg-surface/50">
        {showAddMenu ? (
          <div className="space-y-2">
            {availableMaster.length > 0 && (
              <div>
                <p className="text-xs text-text-faint mb-1">テキストマスタの単元</p>
                <div className="flex flex-wrap gap-1.5">
                  {availableMaster.map((item) => (
                    <button
                      key={item.id}
                      onClick={() =>
                        onAddUnit({
                          curriculum_item_id: item.id,
                          unit_name: item.title,
                          self_assessment: null,
                          koma_count: 1,
                          fromMaster: true,
                        })
                      }
                      className="px-2.5 py-1 text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors"
                    >
                      + {item.title}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex items-center gap-2 mt-2">
              <input
                type="text"
                value={freeInput}
                onChange={(e) => setFreeInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && freeInput.trim()) {
                    onAddUnit({
                      curriculum_item_id: null,
                      unit_name: freeInput.trim(),
                      self_assessment: null,
                      koma_count: 1,
                      fromMaster: false,
                    });
                    setFreeInput('');
                  }
                }}
                placeholder="手入力で単元名を追加（Enter で追加）"
                className="flex-1 px-3 py-1.5 border border-border rounded-lg text-sm bg-surface-raised"
              />
              <button
                onClick={() => {
                  if (freeInput.trim()) {
                    onAddUnit({
                      curriculum_item_id: null,
                      unit_name: freeInput.trim(),
                      self_assessment: null,
                      koma_count: 1,
                      fromMaster: false,
                    });
                    setFreeInput('');
                  }
                }}
                className="px-3 py-1.5 text-xs bg-surface text-text-body rounded-lg hover:bg-surface-hover border border-border"
              >
                追加
              </button>
              <button
                onClick={() => setShowAddMenu(false)}
                className="px-3 py-1.5 text-xs text-text-faint hover:text-text-body"
              >
                閉じる
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowAddMenu(true)}
            className="text-sm text-primary hover:text-primary-dark font-medium"
          >
            + 単元を追加
          </button>
        )}
      </div>
    </div>
  );
}
