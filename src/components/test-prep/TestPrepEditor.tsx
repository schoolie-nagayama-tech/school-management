'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Printer, Copy, Check, ChevronDown } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/useToast';
import { ToastContainer, Spinner } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import {
  createTestPrepProposal,
  getTestPrepProposalWithDetails,
  updateTestPrepProposal,
  replaceTestPrepSubjects,
  deleteTestPrepProposal,
} from '@/lib/api/test-prep-proposals';
import { getExamTypes } from '@/lib/api/textbooks';
import { getSubjects } from '@/lib/api/subjects';
import type { Student, ExamType, CurriculumItem, Subject } from '@/types/database';
import { GRADE_LABELS } from '@/types/database';
import type {
  TestPrepProposalWithDetails,
  TestPrepStatus,
  SelfAssessment,
} from '@/types/test-prep';
import {
  SELF_ASSESSMENTS,
  GRADE_SUBJECT_TEMPLATES,
} from '@/types/test-prep';

interface UnitDraft {
  tempId: string;
  curriculum_item_id: number | null;
  unit_name: string;
  self_assessment: SelfAssessment | null;
  koma_count: number;
  group_id: string | null;
  fromMaster: boolean;
}

interface SubjectDraft {
  tempId: string;
  subject_name: string;
  target_score: number | null;
  units: UnitDraft[];
}

// テキスト選択肢（全テキストから条件フィルタ）
interface TextbookOption {
  textbook_id: number;
  textbook_name: string;
  subject: string | null;
  publisher: string | null;
  grade: string | null;
}

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
  const { user, getSelectedSchoolIds } = useAuth();
  const { toasts, removeToast, success, error: showError } = useToast();

  const studentId = params?.studentId as string;
  const proposalId = params?.proposalId as string | undefined;
  const isNew = !proposalId;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [student, setStudent] = useState<Student | null>(null);
  const [examTypes, setExamTypes] = useState<ExamType[]>([]);
  const [proposal, setProposal] = useState<TestPrepProposalWithDetails | null>(null);

  const [title, setTitle] = useState('');
  const [examTypeId, setExamTypeId] = useState<string>('');
  const [zoukomaPeriodId, setZoukomaPeriodId] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [subjects, setSubjects] = useState<SubjectDraft[]>([]);
  const [status, setStatus] = useState<TestPrepStatus>('draft');
  const [zoukomaPeriods, setZoukomaPeriods] = useState<Array<{ id: string; title: string; period_key: string }>>([]);

  // テキスト→単元選択用（全テキストから条件フィルタ）
  const [allTextbooks, setAllTextbooks] = useState<TextbookOption[]>([]);
  const [masterUnits, setMasterUnits] = useState<Map<number, CurriculumItem[]>>(new Map());

  // 科目追加用（DB登録済み科目一覧）
  const [availableSubjects, setAvailableSubjects] = useState<Subject[]>([]);
  const [teacherName, setTeacherName] = useState('');

  // 公開後のフィードバック表示
  const [justPublished, setJustPublished] = useState(false);
  const [copied, setCopied] = useState(false);
  const urlSectionRef = useRef<HTMLElement>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const schoolIds = getSelectedSchoolIds();
      const schoolId = schoolIds[0];

      const { data: rawStudent } = await supabase
        .from('students')
        .select('*')
        .eq('id', studentId)
        .single();
      const studentData = rawStudent as Student | null;
      if (studentData) setStudent(studentData);

      if (schoolId) {
        const types = await getExamTypes(schoolId);
        setExamTypes(types);
      }

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

      // テキスト一覧を取得（科目・学年・準拠でフィルタ）+ 科目マスタ
      if (studentData) {
        const cat = gradeCategory(studentData.grade);
        await loadTextbooks(studentData);
        const subs = await getSubjects(cat);
        setAvailableSubjects(subs);
      }

      // 講師名（印刷用）
      if (user?.id) {
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('display_name')
          .eq('id', user.id)
          .single();
        if (profile?.display_name) setTeacherName(profile.display_name);
      }

      if (!isNew && proposalId) {
        const detail = await getTestPrepProposalWithDetails(proposalId);
        if (detail) {
          setProposal(detail);
          setTitle(detail.title);
          setExamTypeId(detail.exam_type_id || '');
          setZoukomaPeriodId(detail.zoukoma_period_id || '');
          setNotes(detail.notes || '');
          setStatus(detail.status);
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
                group_id: u.group_id ?? null,
                fromMaster: !!u.curriculum_item_id,
              })),
            }))
          );
        }
      } else if (studentData) {
        const cat = gradeCategory(studentData.grade);
        if (cat === 'middle') {
          setSubjects(
            GRADE_SUBJECT_TEMPLATES.middle.map((name) => ({
              tempId: genId(),
              subject_name: name,
              target_score: null,
              units: [],
            }))
          );
        } else if (cat === 'high') {
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
        setTitle('テスト対策');
      }
    } catch {
      showError('データの読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  }, [studentId, proposalId, isNew, getSelectedSchoolIds, showError]);

  // 科目・学年・準拠条件でテキスト全体から検索
  // 中学以下: 同科目 + 同学年 + 準拠あり(publisher非null)
  // 高校: 同科目のみ（全テキスト）
  const loadTextbooks = async (studentData: Student) => {
    const cat = gradeCategory(studentData.grade);
    const isHighSchool = cat === 'high';

    // 生徒の学年をテキストのgrade形式に変換（'1年','2年','3年'）
    // 中学: grade 7→1年, 8→2年, 9→3年  小学: grade 1→1年 ... 6→6年
    const textbookGrade = cat === 'middle'
      ? `${studentData.grade - 6}年`
      : cat === 'elementary'
        ? `${studentData.grade}年`
        : null;

    let query = supabase
      .from('textbooks')
      .select('id, name, subject, publisher, grade, grade_category')
      // 無効化された教材はピッカーから除外（教材マスタで非表示にしたもの）
      .eq('is_active', true)
      .order('subject')
      .order('name');

    if (isHighSchool) {
      query = query.eq('grade_category', 'high');
    } else {
      query = query
        .eq('grade_category', cat)
        .not('publisher', 'is', null);
      if (textbookGrade) {
        query = query.eq('grade', textbookGrade);
      }
    }

    const { data: textbooks } = await query;

    const tbOptions: TextbookOption[] = [];
    for (const tb of (textbooks || []) as Array<{ id: number; name: string; subject: string | null; publisher: string | null; grade: string | null }>) {
      tbOptions.push({
        textbook_id: tb.id,
        textbook_name: tb.name,
        subject: tb.subject,
        publisher: tb.publisher,
        grade: tb.grade,
      });
    }

    setAllTextbooks(tbOptions);
  };

  // テキスト選択時に単元をオンデマンドでロード
  const loadUnitsForTextbook = async (textbookId: number) => {
    if (masterUnits.has(textbookId)) return;
    const { data: items } = await supabase
      .from('curriculum_items')
      .select('*')
      .eq('textbook_id', textbookId)
      .order('item_number');
    if (items && items.length > 0) {
      setMasterUnits((prev) => new Map(prev).set(textbookId, items as CurriculumItem[]));
    }
  };

  useEffect(() => {
    loadData();
  }, [loadData]);

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
          group_id: u.group_id,
          sort_order: ui,
        })),
      }));

      const targetStatus = newStatus || status;
      const isPublishing = targetStatus === 'published';

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
        if (isPublishing) {
          setJustPublished(true);
        }
        success(isPublishing ? '提案書を公開しました' : '提案書を作成しました');
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

        if (isPublishing && status !== 'published') {
          setJustPublished(true);
          // 再取得してtokenを取得
          const updated = await getTestPrepProposalWithDetails(proposalId!);
          if (updated) setProposal(updated);
          success('提案書を公開しました');
          // URL欄へスクロール
          setTimeout(() => {
            urlSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 200);
        } else {
          success('保存しました');
        }
      }
    } catch (e) {
      console.error(e);
      showError(e instanceof Error ? e.message : '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!proposalId) return;
    if (!window.confirm('この提案書を削除しますか？')) return;
    try {
      await deleteTestPrepProposal(proposalId);
      success('削除しました');
      router.replace('/test-prep-proposals');
    } catch (e) {
      console.error(e);
      showError(e instanceof Error ? e.message : '削除に失敗しました');
    }
  };

  // 科目操作
  // 既に追加済みの科目名を除いた選択肢
  const addedSubjectNames = new Set(subjects.map((s) => s.subject_name));
  const subjectOptions = availableSubjects.filter((s) => !addedSubjectNames.has(s.name));

  const addSubject = (name: string) => {
    if (!name.trim() || addedSubjectNames.has(name.trim())) return;
    setSubjects((prev) => [...prev, { tempId: genId(), subject_name: name.trim(), target_score: null, units: [] }]);
  };

  const removeSubject = (tempId: string) => {
    setSubjects((prev) => prev.filter((s) => s.tempId !== tempId));
  };

  const updateSubject = (tempId: string, patch: Partial<SubjectDraft>) => {
    setSubjects((prev) => prev.map((s) => (s.tempId === tempId ? { ...s, ...patch } : s)));
  };

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
      prev.map((s) => {
        if (s.tempId !== subjectTempId) return s;
        const removing = s.units.find((u) => u.tempId === unitTempId);
        let newUnits = s.units.filter((u) => u.tempId !== unitTempId);

        // グループ内の単元削除時: リーダー移管 or 自動解除
        if (removing?.group_id) {
          const remaining = newUnits.filter((u) => u.group_id === removing.group_id);
          if (remaining.length === 1) {
            const koma = removing.koma_count > 0 ? removing.koma_count : remaining[0].koma_count;
            newUnits = newUnits.map((u) =>
              u.group_id === removing.group_id ? { ...u, group_id: null, koma_count: koma || 1 } : u
            );
          } else if (remaining.length > 1 && removing.koma_count > 0) {
            newUnits = newUnits.map((u) =>
              u.tempId === remaining[0].tempId ? { ...u, koma_count: removing.koma_count } : u
            );
          }
        }

        return { ...s, units: newUnits };
      })
    );
  };

  // 複数単元を1コマにまとめる
  const groupUnits = (subjectTempId: string, unitTempIds: string[]) => {
    if (unitTempIds.length < 2) return;
    const gid = genId();
    setSubjects((prev) =>
      prev.map((s) => {
        if (s.tempId !== subjectTempId) return s;
        const targetSet = new Set(unitTempIds);
        const grouped = s.units.filter((u) => targetSet.has(u.tempId));
        const newUnits: UnitDraft[] = [];
        let inserted = false;
        for (const u of s.units) {
          if (targetSet.has(u.tempId)) {
            if (!inserted) {
              grouped.forEach((gu, idx) => {
                newUnits.push({ ...gu, group_id: gid, koma_count: idx === 0 ? 1 : 0 });
              });
              inserted = true;
            }
          } else {
            newUnits.push(u);
          }
        }
        return { ...s, units: newUnits };
      })
    );
  };

  // まとめを解除（各単元を個別コマ=1に戻す）
  const ungroupUnits = (subjectTempId: string, groupId: string) => {
    setSubjects((prev) =>
      prev.map((s) =>
        s.tempId !== subjectTempId
          ? s
          : { ...s, units: s.units.map((u) => (u.group_id === groupId ? { ...u, group_id: null, koma_count: 1 } : u)) }
      )
    );
  };

  const handleCopyUrl = () => {
    if (!proposal?.token) return;
    navigator.clipboard.writeText(`${window.location.origin}/test-prep/${proposal.token}`);
    setCopied(true);
    success('URLをコピーしました');
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePrint = () => {
    window.print();
  };

  const totalKoma = subjects.reduce(
    (sum, s) => sum + s.units.reduce((us, u) => us + u.koma_count, 0),
    0
  );

  const publicUrl = proposal?.token
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/test-prep/${proposal.token}`
    : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner size="md" />
      </div>
    );
  }

  if (!student) {
    return <div className="p-8 text-center text-text-muted">生徒が見つかりません</div>;
  }

  return (
    <div className="max-w-5xl mx-auto print:max-w-none">
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      {/* 印刷用ヘッダー */}
      <div className="hidden print:block mb-4">
        <h1 className="text-lg font-bold text-gray-900">{title || 'テスト対策提案書'}</h1>
        <div className="flex items-center gap-4 mt-1 text-sm text-gray-600">
          <span>生徒: <span className="font-medium text-gray-900">{student.last_name} {student.first_name}</span></span>
          <span>{GRADE_LABELS[student.grade] || `${student.grade}年`}</span>
          {teacherName && <span>担当: {teacherName}</span>}
          <span>合計 {totalKoma} コマ</span>
        </div>
      </div>

      {/* ヘッダー（タイトルのみ、ボタンは下へ移動） */}
      <div className="flex items-center gap-3 mb-6 print:hidden">
        <button
          onClick={() => router.back()}
          className="text-sm text-text-muted hover:text-text-body transition-colors"
        >
          ← 戻る
        </button>
        <span className="text-border">|</span>
        <h1 className="font-bold text-text-heading">
          {isNew ? 'テスト対策提案書 作成' : 'テスト対策提案書 編集'}
        </h1>
        <StatusBadge status={status} />
      </div>

      <div className="space-y-6">
        {/* 基本情報 */}
        <section className="bg-surface-raised rounded-xl border border-border p-6 print:border-none print:p-0 print:rounded-none">
          <h2 className="text-sm font-bold text-text-muted uppercase tracking-wide mb-4 print:hidden">基本情報</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 print:hidden">
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
          <div className="mt-4 print:hidden">
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
          <div className="flex items-center justify-between print:hidden">
            <h2 className="text-sm font-bold text-text-muted uppercase tracking-wide">科目・単元</h2>
            <div className="text-sm text-text-muted">
              合計: <span className="font-bold text-primary text-lg">{totalKoma}</span> コマ
            </div>
          </div>

          {subjects.map((subject) => (
            <SubjectEditor
              key={subject.tempId}
              subject={subject}
              allTextbooks={allTextbooks}
              masterUnits={masterUnits}
              onLoadUnits={loadUnitsForTextbook}
              onUpdateSubject={(patch) => updateSubject(subject.tempId, patch)}
              onAddUnit={(unit) => addUnit(subject.tempId, unit)}
              onUpdateUnit={(unitId, patch) => updateUnit(subject.tempId, unitId, patch)}
              onRemoveUnit={(unitId) => removeUnit(subject.tempId, unitId)}
              onRemoveSubject={() => removeSubject(subject.tempId)}
              onGroupUnits={(unitIds) => groupUnits(subject.tempId, unitIds)}
              onUngroupUnits={(groupId) => ungroupUnits(subject.tempId, groupId)}
            />
          ))}

          {subjectOptions.length > 0 ? (
            <div className="flex items-center gap-2 print:hidden">
              <select
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) {
                    addSubject(e.target.value);
                    e.target.value = '';
                  }
                }}
                className="flex-1 py-2.5 px-3 border-2 border-dashed border-border rounded-xl text-sm text-text-muted bg-transparent hover:border-text-faint focus:border-primary"
              >
                <option value="" disabled>+ 科目を追加...</option>
                {subjectOptions.map((s) => (
                  <option key={s.id} value={s.name}>{s.name}</option>
                ))}
              </select>
            </div>
          ) : (
            <p className="text-xs text-text-faint text-center py-2 print:hidden">追加可能な科目はありません</p>
          )}
        </section>

        {/* メモ */}
        <section className="bg-surface-raised rounded-xl border border-border p-6 print:hidden">
          <h2 className="text-sm font-bold text-text-muted uppercase tracking-wide mb-3">講師メモ</h2>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="保護者・生徒へのメッセージ（公開ページに表示されます）"
            className="w-full px-3 py-2 border border-border rounded-lg text-sm resize-none bg-surface-raised"
          />
        </section>

        {/* 共有URL + 印刷（公開済みの場合） */}
        {!isNew && proposal?.token && status !== 'draft' && (
          <section
            ref={urlSectionRef}
            className={`rounded-xl border overflow-hidden print:hidden transition-all duration-500 ${
              justPublished
                ? 'bg-success-subtle border-green-300 ring-2 ring-green-200'
                : 'bg-surface-raised border-border'
            }`}
          >
            {justPublished && (
              <div className="px-6 py-3 bg-green-100 border-b border-green-200 flex items-center gap-2">
                <Check className="w-4 h-4 text-green-600" />
                <span className="text-sm font-medium text-green-800">提案書が公開されました</span>
              </div>
            )}
            <div className="p-6">
              <h2 className="text-sm font-bold text-text-muted uppercase tracking-wide mb-3">共有URL</h2>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={publicUrl || ''}
                  className="flex-1 px-3 py-2 border border-border rounded-lg text-sm bg-surface font-mono text-text-body"
                />
                <button
                  onClick={handleCopyUrl}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm bg-primary text-primary-contrast rounded-lg hover:bg-primary-dark transition-[colors,transform] active:scale-[0.97]"
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'コピー済' : 'コピー'}
                </button>
                <button
                  onClick={handlePrint}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm border border-border rounded-lg hover:bg-surface-hover transition-[colors,transform] active:scale-[0.97]"
                >
                  <Printer className="w-3.5 h-3.5" />
                  印刷
                </button>
              </div>
            </div>
          </section>
        )}

        {/* 操作ボタン（下部スティッキー） */}
        <section className="sticky bottom-0 z-30 flex items-center justify-between py-3 px-6 -mx-6 border-t border-border bg-surface-raised/95 backdrop-blur print:hidden">
          <div className="flex items-center gap-2">
            {!isNew && (
              <button
                onClick={handleDelete}
                className="px-3 py-2 text-sm text-text-muted hover:text-red-600 border border-border rounded-lg transition-colors"
              >
                削除
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleSave('draft')}
              disabled={saving}
              className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-surface-hover transition-[colors,transform] active:scale-[0.97] disabled:opacity-50"
            >
              下書き保存
            </button>
            <button
              onClick={() => handleSave('published')}
              disabled={saving}
              className="px-4 py-2 text-sm bg-primary text-primary-contrast font-medium rounded-lg hover:bg-primary-dark transition-[colors,transform] active:scale-[0.97] disabled:opacity-50"
            >
              保存して公開
            </button>
          </div>
        </section>
      </div>

      {/* 印刷用QRコード */}
      {publicUrl && (
        <div className="hidden print:block mt-8 border-t-2 border-dashed border-gray-300 pt-6">
          <div className="flex items-center gap-6">
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(publicUrl)}`}
              alt="QR Code"
              className="w-28 h-28"
            />
            <div>
              <p className="font-bold text-gray-900">テスト対策 提案書</p>
              <p className="text-sm text-gray-600 mt-1">
                上のQRコードを読み取るか、以下のURLからご確認ください。
              </p>
              <p className="text-sm text-blue-600 mt-1 font-mono break-all">{publicUrl}</p>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 10mm 12mm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; font-size: 11px; }
          /* A4 1枚に収めるためコンパクト化 */
          table { font-size: 10px; }
          td, th { padding: 2px 6px !important; }
          .space-y-6 > * + * { margin-top: 8px !important; }
          .space-y-4 > * + * { margin-top: 6px !important; }
        }
      `}</style>
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
  allTextbooks,
  masterUnits,
  onLoadUnits,
  onUpdateSubject,
  onAddUnit,
  onUpdateUnit,
  onRemoveUnit,
  onRemoveSubject,
  onGroupUnits,
  onUngroupUnits,
}: {
  subject: SubjectDraft;
  allTextbooks: TextbookOption[];
  masterUnits: Map<number, CurriculumItem[]>;
  onLoadUnits: (textbookId: number) => Promise<void>;
  onUpdateSubject: (patch: Partial<SubjectDraft>) => void;
  onAddUnit: (unit: Omit<UnitDraft, 'tempId'>) => void;
  onUpdateUnit: (unitId: string, patch: Partial<UnitDraft>) => void;
  onRemoveUnit: (unitId: string) => void;
  onRemoveSubject: () => void;
  onGroupUnits: (unitIds: string[]) => void;
  onUngroupUnits: (groupId: string) => void;
}) {
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [selectedTextbookId, setSelectedTextbookId] = useState<number | null>(null);
  const [freeInput, setFreeInput] = useState('');
  const [selectedUnitIds, setSelectedUnitIds] = useState<Set<string>>(new Set());
  const totalKoma = subject.units.reduce((sum, u) => sum + u.koma_count, 0);

  // この科目に一致するテキストを抽出
  const availableTextbooks = allTextbooks.filter(
    (tb) => tb.subject === subject.subject_name
  );

  // 選択中テキストの単元一覧（既に追加済みを除外）
  const addedItemIds = new Set(subject.units.map((u) => u.curriculum_item_id).filter(Boolean));
  const textbookUnits = selectedTextbookId
    ? (masterUnits.get(selectedTextbookId) || []).filter((m) => !addedItemIds.has(m.id))
    : [];

  // テキスト選択時に単元をオンデマンドロード
  const handleSelectTextbook = async (tbId: number) => {
    const next = selectedTextbookId === tbId ? null : tbId;
    setSelectedTextbookId(next);
    if (next) await onLoadUnits(next);
  };

  // グループ情報を付与した表示用行データ
  const renderRows = useMemo(() => {
    const rows: Array<{
      unit: UnitDraft;
      isGroupStart: boolean;
      isGroupMember: boolean;
      groupSize: number;
    }> = [];
    let i = 0;
    while (i < subject.units.length) {
      const u = subject.units[i];
      if (u.group_id) {
        const gid = u.group_id;
        const start = i;
        while (i < subject.units.length && subject.units[i].group_id === gid) i++;
        const size = i - start;
        for (let j = start; j < i; j++) {
          rows.push({
            unit: subject.units[j],
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
  }, [subject.units]);

  const handleGroup = () => {
    onGroupUnits(Array.from(selectedUnitIds));
    setSelectedUnitIds(new Set());
  };

  return (
    <div className="bg-surface-raised rounded-xl border border-border overflow-hidden print:break-inside-avoid">
      {/* 科目ヘッダー */}
      <div className="px-4 py-3 bg-text-heading flex items-center justify-between">
        <span className="font-bold text-primary-contrast">{subject.subject_name}</span>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 print:hidden">
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
          {subject.target_score != null && (
            <span className="hidden print:inline text-xs text-gray-300">
              目標 <span className="text-yellow-300 font-bold">{subject.target_score}</span>点
            </span>
          )}
          <div className="text-sm text-gray-300">
            計 <span className="text-yellow-300 font-bold">{totalKoma}</span> コマ
          </div>
          <button
            onClick={onRemoveSubject}
            className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-red-400 text-sm rounded transition-colors print:hidden"
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
              <th className="w-8 print:hidden" />
              <th className="text-left px-4 py-2 font-medium w-1/2">単元名</th>
              <th className="text-center px-2 py-2 font-medium w-24">自己評価</th>
              <th className="text-center px-2 py-2 font-medium w-24">コマ数</th>
              <th className="w-10 print:hidden" />
            </tr>
          </thead>
          <tbody>
            {renderRows.map((row) => (
              <tr
                key={row.unit.tempId}
                className={`border-t border-border hover:bg-surface-hover/50 ${
                  row.isGroupMember ? 'bg-blue-50/40 border-l-2 border-l-blue-400' : ''
                }`}
              >
                {/* チェックボックス（未グループのみ） */}
                <td className="w-8 text-center px-1 py-2 print:hidden">
                  {!row.isGroupMember && (
                    <input
                      type="checkbox"
                      checked={selectedUnitIds.has(row.unit.tempId)}
                      onChange={(e) => {
                        const next = new Set(selectedUnitIds);
                        if (e.target.checked) next.add(row.unit.tempId);
                        else next.delete(row.unit.tempId);
                        setSelectedUnitIds(next);
                      }}
                      className="w-3.5 h-3.5 rounded border-gray-300 text-primary accent-primary"
                    />
                  )}
                </td>

                {/* 単元名 */}
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2">
                    {row.unit.fromMaster && (
                      <span className="shrink-0 px-1.5 py-0.5 text-[10px] bg-blue-100 text-blue-700 rounded print:hidden">
                        マスタ
                      </span>
                    )}
                    <span className="text-text-body">{row.unit.unit_name}</span>
                  </div>
                </td>

                {/* 自己評価 */}
                <td className="text-center px-2 py-2">
                  <select
                    value={row.unit.self_assessment || ''}
                    onChange={(e) =>
                      onUpdateUnit(row.unit.tempId, {
                        self_assessment: (e.target.value || null) as SelfAssessment | null,
                      })
                    }
                    className="px-2 py-1 border border-border rounded text-sm text-center bg-surface-raised print:border-none print:bg-transparent print:appearance-none"
                  >
                    <option value="">-</option>
                    {SELF_ASSESSMENTS.map((a) => (
                      <option key={a} value={a}>{a}</option>
                    ))}
                  </select>
                </td>

                {/* コマ数 — グループ先頭は rowSpan、グループ内は省略 */}
                {row.isGroupMember ? (
                  row.isGroupStart ? (
                    <td className="text-center px-2 py-2 bg-blue-50/60" rowSpan={row.groupSize}>
                      <div className="flex flex-col items-center gap-1">
                        <input
                          type="number"
                          value={row.unit.koma_count}
                          onChange={(e) =>
                            onUpdateUnit(row.unit.tempId, { koma_count: Math.max(0, Number(e.target.value)) })
                          }
                          min={0}
                          className="w-16 px-2 py-1 border border-blue-200 rounded text-sm text-center bg-white"
                        />
                        <button
                          onClick={() => onUngroupUnits(row.unit.group_id!)}
                          className="text-[10px] text-blue-500 hover:text-blue-700 transition-colors print:hidden"
                        >
                          解除
                        </button>
                      </div>
                    </td>
                  ) : null
                ) : (
                  <td className="text-center px-2 py-2">
                    <input
                      type="number"
                      value={row.unit.koma_count}
                      onChange={(e) =>
                        onUpdateUnit(row.unit.tempId, { koma_count: Math.max(0, Number(e.target.value)) })
                      }
                      min={0}
                      className="w-16 px-2 py-1 border border-border rounded text-sm text-center bg-surface-raised print:border-none print:bg-transparent"
                    />
                  </td>
                )}

                {/* 削除 */}
                <td className="px-2 py-2 text-center print:hidden">
                  <button
                    onClick={() => onRemoveUnit(row.unit.tempId)}
                    className="text-text-faint hover:text-red-500 transition-colors"
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
            {subject.units.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-4 text-center text-text-faint text-xs">
                  単元を追加してください
                </td>
              </tr>
            )}
          </tbody>
          {subject.units.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-border bg-surface font-bold text-sm">
                <td className="print:hidden" />
                <td className="px-4 py-2 text-text-muted">合計</td>
                <td />
                <td className="text-center text-primary">{totalKoma}</td>
                <td className="print:hidden" />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* まとめるバー（2件以上選択時に表示） */}
      {selectedUnitIds.size >= 2 && (
        <div className="px-4 py-2 bg-blue-50 border-t border-blue-100 flex items-center justify-between print:hidden">
          <span className="text-xs text-blue-700">{selectedUnitIds.size}件の単元を選択中</span>
          <button
            onClick={handleGroup}
            className="px-3 py-1 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-[colors,transform] active:scale-[0.97]"
          >
            まとめる
          </button>
        </div>
      )}

      {/* 単元追加（テキスト選択→単元選択） */}
      <div className="px-4 py-3 border-t border-border bg-surface/50 print:hidden">
        {showAddMenu ? (
          <div className="space-y-3">
            {/* テキスト選択 */}
            {availableTextbooks.length > 0 && (
              <div>
                <p className="text-xs text-text-faint mb-1.5">テキストを選択</p>
                <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
                  {availableTextbooks.map((tb) => (
                    <button
                      key={tb.textbook_id}
                      onClick={() => handleSelectTextbook(tb.textbook_id)}
                      className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg border transition-colors ${
                        selectedTextbookId === tb.textbook_id
                          ? 'bg-blue-50 text-blue-700 border-blue-300 font-medium'
                          : 'bg-surface-raised text-text-body border-border hover:bg-surface-hover'
                      }`}
                    >
                      {tb.publisher && (
                        <span className="text-[10px] text-text-faint">{tb.publisher}</span>
                      )}
                      {tb.textbook_name}
                      <ChevronDown className={`w-3 h-3 transition-transform ${selectedTextbookId === tb.textbook_id ? 'rotate-180' : ''}`} />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 選択したテキストの単元一覧 */}
            {selectedTextbookId && textbookUnits.length > 0 && (
              <div>
                <p className="text-xs text-text-faint mb-1.5">単元を追加</p>
                <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto">
                  {textbookUnits.map((item) => (
                    <button
                      key={item.id}
                      onClick={() =>
                        onAddUnit({
                          curriculum_item_id: item.id,
                          unit_name: item.title,
                          self_assessment: null,
                          koma_count: 1,
                          group_id: null,
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
            {selectedTextbookId && textbookUnits.length === 0 && (
              <p className="text-xs text-text-faint">
                このテキストの単元はすべて追加済みです
              </p>
            )}

            {/* 手入力 */}
            <div className="flex items-center gap-2">
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
                      group_id: null,
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
                      group_id: null,
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
                onClick={() => { setShowAddMenu(false); setSelectedTextbookId(null); }}
                className="px-3 py-1.5 text-xs text-text-faint hover:text-text-body transition-colors"
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
