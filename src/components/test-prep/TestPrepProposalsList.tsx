'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Search } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { fetchAllPaged } from '@/lib/utils/supabasePaging';
import { getTestPrepProposalsForList } from '@/lib/api/test-prep-proposals';
import type { TestPrepProposalListRow } from '@/lib/api/test-prep-proposals';
import type { TestPrepStatus } from '@/types/test-prep';
import { TEST_PREP_STATUS_LABELS } from '@/types/test-prep';
import { Spinner } from '@/components/ui';
import { GRADE_LABELS } from '@/types/database';
import { formatGradeLabel } from '@/lib/utils/gradeLabel';

type ProposalRow = TestPrepProposalListRow;

/** 提案書1件の合計コマ数（科目ごとの提案コマの合計） */
function totalKoma(p: ProposalRow): number {
  return p.subjects.reduce((sum, s) => sum + (s.proposed_koma || 0), 0);
}

/**
 * 実際に提案した科目（コマが1以上）だけを返す。
 * 提案書は学年テンプレートで英数国理社を先に作るので、使わない科目が 0 コマのまま残る。
 * それも並べると1行に5個のバッジが出て、どの科目を提案したのか読み取れなくなる。
 */
function proposedSubjects(p: ProposalRow): ProposalRow['subjects'] {
  return p.subjects.filter((s) => (s.proposed_koma || 0) > 0);
}

interface StudentOption {
  id: string;
  last_name: string;
  first_name: string;
  last_name_kana: string | null;
  first_name_kana: string | null;
  grade: number | null;
}

const STATUS_STYLES: Record<TestPrepStatus, string> = {
  draft: 'bg-surface-hover text-text-muted',
  sent: 'bg-warning-subtle text-yellow-700',
  published: 'bg-success-subtle text-green-700',
};

export default function TestPrepProposalsList() {
  const router = useRouter();
  const { selectedSchoolId, getSelectedSchoolIds } = useAuth();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [proposals, setProposals] = useState<ProposalRow[]>([]);
  const [filter, setFilter] = useState<TestPrepStatus | 'all'>('all');
  // 試験・提案者の絞り込み（'all' は絞らない）。試験は exam_type_id、提案者は teacher_user_id で持つ
  const [examFilter, setExamFilter] = useState<string>('all');
  const [teacherFilter, setTeacherFilter] = useState<string>('all');

  // 生徒ピッカー
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadData = useCallback(async () => {
    // ★教室スコープはヘッダーの教室切替（getSelectedSchoolIds）に必ず従う。
    // アクセスできる教室すべて（schoolIds）で引くと、システム管理者・オーナーは全教室、
    // 掛け持ちの教室長は勤務先以外の提案書まで一覧に混ざる（生徒名が他教室に漏れる）。
    // selectedSchoolId が未確定（null）のうちは getSelectedSchoolIds が schoolIds を
    // そのまま返すため、決まるまで引かない。
    if (!selectedSchoolId) return;
    const ids = getSelectedSchoolIds();
    if (ids.length === 0) {
      setProposals([]);
      setLoading(false);
      return;
    }
    try {
      const data = await getTestPrepProposalsForList(ids);
      setProposals(data);
      setLoadError(false);
    } catch (e) {
      console.error(e);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [selectedSchoolId, getSelectedSchoolIds]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // 生徒一覧の取得（ふりがな昇順）
  const loadStudents = useCallback(async () => {
    setStudentsLoading(true);
    try {
      // 一覧と同じスコープで引く（'all' のときのデモ教室除外も getSelectedSchoolIds が担う）
      const ids = selectedSchoolId ? getSelectedSchoolIds() : [];
      if (ids.length === 0) {
        setStudents([]);
        return;
      }
      // 複数教室選択時は合計が 1000 名を超えうるため全件ページング取得（kana は一意でないので id を加えて安定化）。
      const data = await fetchAllPaged<StudentOption>((from, to) =>
        supabase
          .from('students')
          .select('id, last_name, first_name, last_name_kana, first_name_kana, grade')
          .in('school_id', ids)
          .eq('status', 'active')
          .is('deleted_at', null)
          .order('last_name_kana', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to)
      );
      setStudents(data);
    } catch {
      setStudents([]);
    } finally {
      setStudentsLoading(false);
    }
  }, [selectedSchoolId, getSelectedSchoolIds]);

  const openPicker = useCallback(() => {
    setPickerOpen(true);
    setPickerQuery('');
    loadStudents();
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [loadStudents]);

  // ピッカー外クリックで閉じる
  useEffect(() => {
    if (!pickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [pickerOpen]);

  // 氏名・ふりがな両方で検索
  const filteredStudents = pickerQuery
    ? students.filter((s) => {
        const haystack = `${s.last_name}${s.first_name}${s.last_name_kana ?? ''}${s.first_name_kana ?? ''}`;
        return haystack.includes(pickerQuery);
      })
    : students;

  // 学年グループ化（上位学年から降順、未設定は末尾）
  const groupedByGrade = useMemo(() => {
    const groups = new Map<number | null, StudentOption[]>();
    for (const s of filteredStudents) {
      const key = s.grade ?? null;
      const list = groups.get(key) ?? [];
      list.push(s);
      groups.set(key, list);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => {
      if (a === null) return 1;
      if (b === null) return -1;
      return b - a;
    });
  }, [filteredStudents]);

  const handleSelectStudent = (studentId: string) => {
    setPickerOpen(false);
    router.push(`/students/${studentId}/test-prep/new`);
  };

  // 試験・提案者の選択肢は「いま読み込んでいる提案書に実際にあるもの」だけを出す。
  // 教室のマスタ全件を並べると、この教室で使っていない試験まで候補に出て選びにくい。
  const examOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of proposals) {
      if (p.exam_type?.id) map.set(p.exam_type.id, p.exam_type.name);
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1], 'ja'));
  }, [proposals]);

  const teacherOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of proposals) {
      if (p.teacher_user_id) map.set(p.teacher_user_id, p.teacher_surname || '(不明)');
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1], 'ja'));
  }, [proposals]);

  // ステータス以外の絞り込みを当てた集合。ステータスチップの件数はこれを母数にする
  // （試験で絞ったら、チップの数字もその試験の中の内訳になる）
  const scoped = useMemo(
    () =>
      proposals.filter(
        (p) =>
          (examFilter === 'all' || p.exam_type?.id === examFilter) &&
          (teacherFilter === 'all' || p.teacher_user_id === teacherFilter)
      ),
    [proposals, examFilter, teacherFilter]
  );

  const filtered = filter === 'all' ? scoped : scoped.filter((p) => p.status === filter);

  // 集計は「いま表に出ている行」の数字。絞り込むと集計も一緒に動く
  const summary = useMemo(() => {
    const students = new Set(filtered.map((p) => p.student_id));
    const teachers = new Set(filtered.map((p) => p.teacher_user_id).filter(Boolean));
    return {
      count: filtered.length,
      koma: filtered.reduce((sum, p) => sum + totalKoma(p), 0),
      students: students.size,
      teachers: teachers.size,
    };
  }, [filtered]);

  const selectClass =
    'px-2.5 py-1 text-[11px] border border-border rounded-lg bg-surface-raised text-text-body focus:outline-none focus:ring-1 focus:ring-ink/30';

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="md" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-sm text-red-600">読み込みに失敗しました</p>
      </div>
    );
  }

  return (
    /* 列が科目・コマ・提案者と増えたので 4xl では詰まる */
    <div className="max-w-6xl mx-auto">
      {/* ヘッダー */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-text-heading">テスト対策提案書</h2>
        <div className="relative" ref={pickerRef}>
          <button
            onClick={openPicker}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-ink text-text-on-primary rounded-lg hover:brightness-[0.85] active:scale-[0.97] transition-[filter,transform] duration-150 ease-out"
          >
            <Plus className="w-3 h-3" />
            新規作成
          </button>
          {/* dropdown-menu-right: origin top-right で scale(0.95) から出現 */}
          {pickerOpen && (
            <div className="dropdown-menu dropdown-menu-right absolute right-0 top-full mt-1 w-80 bg-surface-raised border border-border rounded-xl shadow-lg z-50 overflow-hidden">
              <div className="p-2 border-b border-border-subtle">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-faint" />
                  <input
                    ref={inputRef}
                    type="text"
                    value={pickerQuery}
                    onChange={(e) => setPickerQuery(e.target.value)}
                    placeholder="氏名・ふりがなで検索..."
                    className="w-full pl-8 pr-3 py-1.5 text-xs border border-border rounded-lg bg-surface-raised text-text-body placeholder:text-text-faint focus:outline-none focus:ring-1 focus:ring-ink/30"
                  />
                </div>
              </div>
              <div className="max-h-96 overflow-y-auto">
                {studentsLoading ? (
                  <div className="py-4 text-center text-xs text-text-faint">読み込み中...</div>
                ) : filteredStudents.length === 0 ? (
                  <div className="py-4 text-center text-xs text-text-faint">
                    該当する生徒がいません
                  </div>
                ) : (
                  groupedByGrade.map(([grade, list]) => (
                    <div key={grade ?? 'unknown'}>
                      <div className="sticky top-0 px-3 py-1 bg-surface-hover/95 backdrop-blur text-[10px] font-bold text-text-muted border-b border-border-subtle">
                        {grade != null ? (GRADE_LABELS[grade] ?? `${grade}年`) : '学年未設定'}
                        <span className="ml-1 font-normal text-text-faint">{list.length}名</span>
                      </div>
                      {list.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => handleSelectStudent(s.id)}
                          className="w-full text-left px-3 py-2 text-sm text-text-body hover:bg-surface-hover transition-colors duration-150 flex items-center gap-2"
                        >
                          <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-gray-100 text-gray-500 shrink-0">
                            {s.grade != null ? (GRADE_LABELS[s.grade] ?? `${s.grade}年`) : '—'}
                          </span>
                          <span className="truncate">
                            {s.last_name} {s.first_name}
                          </span>
                        </button>
                      ))}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 集計。絞り込みを当てたあとの数字を出す */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        {[
          { label: '提案書', value: summary.count, unit: '件' },
          { label: '提案コマ', value: summary.koma, unit: 'コマ' },
          { label: '提案した生徒', value: summary.students, unit: '名' },
          { label: '提案者', value: summary.teachers, unit: '名' },
        ].map((s) => (
          <div key={s.label} className="bg-surface-hover rounded-lg px-3 py-2">
            <div className="text-[11px] text-text-muted">{s.label}</div>
            <div className="text-lg font-medium text-text-heading tabular-nums">
              {s.value}
              <span className="ml-1 text-[11px] font-normal text-text-muted">{s.unit}</span>
            </div>
          </div>
        ))}
      </div>

      {/* 絞り込み: ステータス（チップ）＋ 試験・提案者（プルダウン） */}
      <div className="flex items-center gap-1.5 mb-4 flex-wrap">
        {(['all', 'draft', 'sent', 'published'] as const).map((s) => {
          const count = s === 'all' ? scoped.length : scoped.filter((p) => p.status === s).length;
          return (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-lg transition-[background-color,color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] ${
                filter === s
                  ? 'bg-primary text-primary-contrast'
                  : 'bg-surface-hover text-text-muted hover:text-text-body'
              }`}
            >
              {s === 'all' ? 'すべて' : TEST_PREP_STATUS_LABELS[s]}
              <span className="ml-1 tabular-nums">{count}</span>
            </button>
          );
        })}
        {/* 選択肢が1つしか無いなら絞る意味が無いので出さない */}
        {examOptions.length > 1 && (
          <select
            value={examFilter}
            onChange={(e) => setExamFilter(e.target.value)}
            className={`ml-2 ${selectClass}`}
            aria-label="試験で絞り込む"
          >
            <option value="all">試験: すべて</option>
            {examOptions.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        )}
        {teacherOptions.length > 1 && (
          <select
            value={teacherFilter}
            onChange={(e) => setTeacherFilter(e.target.value)}
            className={selectClass}
            aria-label="提案者で絞り込む"
          >
            <option value="all">提案者: すべて</option>
            {teacherOptions.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        )}
        {(examFilter !== 'all' || teacherFilter !== 'all') && (
          <button
            onClick={() => {
              setExamFilter('all');
              setTeacherFilter('all');
            }}
            className="px-2 py-1 text-[11px] text-text-muted hover:text-text-body underline"
          >
            絞り込みを解除
          </button>
        )}
      </div>

      {/* 一覧 */}
      {filtered.length === 0 ? (
        <div
          className="stagger-item bg-surface-raised rounded-xl border border-border p-12 text-center"
          style={{ '--stagger-index': 0 } as React.CSSProperties}
        >
          <p className="text-text-muted">
            {proposals.length === 0
              ? 'テスト対策提案書はまだありません'
              : '該当する提案書はありません'}
          </p>
        </div>
      ) : (
        <div className="bg-surface-raised rounded-xl border border-border overflow-hidden">
          {/* 列が増えたぶん、狭い画面では表だけを横スクロールさせる（ページ全体は横に流さない） */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[46rem]">
              <thead>
                <tr className="bg-surface-hover text-text-muted text-xs">
                  <th className="text-left px-4 py-2.5 font-medium">生徒</th>
                  <th className="text-left px-4 py-2.5 font-medium">試験</th>
                  <th className="text-left px-4 py-2.5 font-medium">科目</th>
                  <th className="text-right px-3 py-2.5 font-medium">コマ</th>
                  <th className="text-left px-3 py-2.5 font-medium">提案者</th>
                  <th className="text-center px-4 py-2.5 font-medium">ステータス</th>
                  <th className="text-right px-4 py-2.5 font-medium">更新日</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p, i) => (
                  <tr
                    key={p.id}
                    onClick={() => router.push(`/students/${p.student_id}/test-prep/${p.id}`)}
                    // stagger-item: 初回表示の行に40ms刻みのフェードイン（最大8件でクランプ）
                    className="stagger-item border-t border-border hover:bg-surface-hover cursor-pointer transition-colors"
                    style={{ '--stagger-index': Math.min(i, 7) } as React.CSSProperties}
                  >
                    <td className="px-4 py-3">
                      {p.student ? (
                        <div>
                          <span className="font-medium text-text-heading">
                            {p.student.last_name} {p.student.first_name}
                          </span>
                          <span className="text-xs text-text-muted ml-2">
                            {formatGradeLabel(p.student.grade)}
                          </span>
                        </div>
                      ) : (
                        <span className="text-text-muted">---</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <div className="text-text-body">{p.exam_type?.name || '---'}</div>
                      {/* タイトルは試験名と重なることが多いので、違うときだけ小さく添える */}
                      {p.title && p.title !== p.exam_type?.name && (
                        <div className="text-text-faint truncate max-w-[14rem]">{p.title}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {proposedSubjects(p).length === 0 ? (
                        <span className="text-xs text-text-faint">
                          {p.subjects.length === 0 ? '科目なし' : 'コマ未入力'}
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {proposedSubjects(p).map((s, si) => (
                            <span
                              key={`${p.id}-${si}`}
                              title={`${s.subject_name} ${s.proposed_koma}コマ`}
                              className="px-1.5 py-0.5 text-[10px] rounded bg-surface-hover text-text-body"
                            >
                              {s.subject_name.slice(0, 1)}
                              <span className="ml-0.5 tabular-nums">{s.proposed_koma}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right text-sm tabular-nums">
                      {totalKoma(p) > 0 ? (
                        <span className="font-medium text-text-heading">{totalKoma(p)}</span>
                      ) : (
                        <span className="text-text-faint">0</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-xs text-text-muted">
                      {p.teacher_surname || (p.teacher_user_id ? '(不明)' : '---')}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_STYLES[p.status]}`}
                      >
                        {TEST_PREP_STATUS_LABELS[p.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-text-muted">
                      {new Date(p.updated_at).toLocaleDateString('ja-JP')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
