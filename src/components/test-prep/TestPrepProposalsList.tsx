'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Search } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { fetchAllPaged } from '@/lib/utils/supabasePaging';
import { getTestPrepProposalsWithStudent } from '@/lib/api/test-prep-proposals';
import type { TestPrepProposal, TestPrepStatus } from '@/types/test-prep';
import { TEST_PREP_STATUS_LABELS } from '@/types/test-prep';
import { Spinner } from '@/components/ui';
import { GRADE_LABELS } from '@/types/database';

type ProposalRow = TestPrepProposal & {
  student: { last_name: string; first_name: string; grade: number } | null;
  exam_type: { name: string } | null;
};

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

function gradeName(grade: number): string {
  if (grade >= 10) return `高${grade - 9}`;
  if (grade >= 7) return `中${grade - 6}`;
  return `小${grade}`;
}

export default function TestPrepProposalsList() {
  const router = useRouter();
  const { schoolIds, selectedSchoolId, getSelectedSchoolIds } = useAuth();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [proposals, setProposals] = useState<ProposalRow[]>([]);
  const [filter, setFilter] = useState<TestPrepStatus | 'all'>('all');

  // 生徒ピッカー
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadData = useCallback(async () => {
    if (!schoolIds || schoolIds.length === 0) return;
    try {
      const data = await getTestPrepProposalsWithStudent(
        schoolIds.length === 1 ? schoolIds[0] : schoolIds
      );
      setProposals(data);
      setLoadError(false);
    } catch (e) {
      console.error(e);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [schoolIds]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // 生徒一覧の取得（ふりがな昇順）
  const loadStudents = useCallback(async () => {
    setStudentsLoading(true);
    try {
      const ids = selectedSchoolId && selectedSchoolId !== 'all'
        ? [selectedSchoolId]
        : getSelectedSchoolIds();
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
  }, [schoolIds, selectedSchoolId, getSelectedSchoolIds]);

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

  const filtered = filter === 'all'
    ? proposals
    : proposals.filter((p) => p.status === filter);

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
    <div className="max-w-4xl mx-auto">
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
          {pickerOpen && (
            <div className="absolute right-0 top-full mt-1 w-80 bg-surface-raised border border-border-default rounded-xl shadow-lg z-50 overflow-hidden">
              <div className="p-2 border-b border-border-subtle">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-faint" />
                  <input
                    ref={inputRef}
                    type="text"
                    value={pickerQuery}
                    onChange={(e) => setPickerQuery(e.target.value)}
                    placeholder="氏名・ふりがなで検索..."
                    className="w-full pl-8 pr-3 py-1.5 text-xs border border-border-default rounded-lg bg-surface-raised text-text-body placeholder:text-text-faint focus:outline-none focus:ring-1 focus:ring-ink/30"
                  />
                </div>
              </div>
              <div className="max-h-96 overflow-y-auto">
                {studentsLoading ? (
                  <div className="py-4 text-center text-xs text-text-faint">読み込み中...</div>
                ) : filteredStudents.length === 0 ? (
                  <div className="py-4 text-center text-xs text-text-faint">該当する生徒がいません</div>
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
                          <span className="truncate">{s.last_name} {s.first_name}</span>
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

      {/* ステータスフィルタ */}
      <div className="flex items-center gap-1.5 mb-4">
        {(['all', 'draft', 'sent', 'published'] as const).map((s) => {
          const count = s === 'all'
            ? proposals.length
            : proposals.filter((p) => p.status === s).length;
          return (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-lg transition-colors ${
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
      </div>

      {/* 一覧 */}
      {filtered.length === 0 ? (
        <div className="bg-surface-raised rounded-xl border border-border p-12 text-center">
          <p className="text-text-muted">
            {proposals.length === 0
              ? 'テスト対策提案書はまだありません'
              : '該当する提案書はありません'}
          </p>
        </div>
      ) : (
        <div className="bg-surface-raised rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-hover text-text-muted text-xs">
                <th className="text-left px-4 py-2.5 font-medium">生徒</th>
                <th className="text-left px-4 py-2.5 font-medium">タイトル</th>
                <th className="text-left px-4 py-2.5 font-medium">試験</th>
                <th className="text-center px-4 py-2.5 font-medium">ステータス</th>
                <th className="text-right px-4 py-2.5 font-medium">更新日</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr
                  key={p.id}
                  onClick={() => router.push(`/students/${p.student_id}/test-prep/${p.id}`)}
                  className="border-t border-border hover:bg-surface-hover cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3">
                    {p.student ? (
                      <div>
                        <span className="font-medium text-text-heading">
                          {p.student.last_name} {p.student.first_name}
                        </span>
                        <span className="text-xs text-text-muted ml-2">
                          {gradeName(p.student.grade)}
                        </span>
                      </div>
                    ) : (
                      <span className="text-text-muted">---</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-text-body">
                    {p.title || '無題の提案書'}
                  </td>
                  <td className="px-4 py-3 text-text-muted text-xs">
                    {p.exam_type?.name || '---'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_STYLES[p.status]}`}>
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
      )}
    </div>
  );
}
