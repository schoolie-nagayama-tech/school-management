'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  Link2,
  Unlink,
  Minus,
  PackageOpen,
  X,
  Plus,
  Printer,
  Save,
  Search,
  Trash2,
} from 'lucide-react';
import {
  Button,
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
  ToastContainer,
  Loading,
} from '@/components/ui';
import { useToast } from '@/hooks/useToast';
import {
  getProposal,
  getTextbookUnitsWithProgress,
  upsertProposal,
  deleteProposal,
  updateProposal,
  saveProposalUnits,
  publishProposal,
  calcTotalKoma,
  calcTotalAppliedKoma,
} from '@/lib/api/proposals';
import type { ProposalUnitInput } from '@/lib/api/proposals';
import { getTextbooks } from '@/lib/api/textbooks';
import { getCourseCurriculum } from '@/lib/api/seasonalCourses';
import { supabase } from '@/lib/supabase';
import type {
  CurriculumItem,
  ProposalStatus,
  SeasonalCourse,
  SeasonalProposalWithDetails,
  SeasonType,
  StudentProgress,
  Textbook,
} from '@/types/database';
import { SEASON_LABELS, PROPOSAL_STATUS_LABELS } from '@/types/database';
import { ProposalPrintView } from './ProposalPrintView';

interface UnitDraft {
  curriculum_item_id: number;
  koma_count: number;
  applied_koma: number;
  reason: string;
  selected: boolean;
  group_id: number;
  intent_tag: string | null;
}

const INTENT_TAGS = [
  '苦手補強',
  '既習の定着',
  '未習の先取り',
  '学校進度に合わせる',
  '直前演習',
  '応用発展',
] as const;
type IntentTag = typeof INTENT_TAGS[number];

const INTENT_TAG_COLOR: Record<IntentTag, string> = {
  '苦手補強': 'text-red-700 border-red-200',
  '既習の定着': 'text-blue-700 border-blue-200',
  '未習の先取り': 'text-purple-700 border-purple-200',
  '学校進度に合わせる': 'text-emerald-700 border-emerald-200',
  '直前演習': 'text-amber-700 border-amber-200',
  '応用発展': 'text-indigo-700 border-indigo-200',
};

const STATUS_FLOW: ProposalStatus[] = ['draft', 'sent', 'approved'];

const STATUS_COLORS: Record<string, { active: string; inactive: string }> = {
  draft: {
    active: 'bg-text-muted text-white',
    inactive: 'bg-surface-hover text-text-muted hover:bg-border-default',
  },
  sent: {
    active: 'bg-info text-white',
    inactive: 'bg-info-subtle text-info hover:bg-info/15',
  },
  approved: {
    active: 'bg-emerald-600 text-white',
    inactive: 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
  },
};

export default function ProposalEditor() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { toasts, addToast, removeToast } = useToast();

  const studentId = params?.studentId as string;
  const proposalId = params?.proposalId as string;
  const isNew = proposalId === 'new';

  const qStbId = searchParams?.get('stbId') ?? '';
  const qSeason = (searchParams?.get('season') ?? '') as SeasonType | '';
  const qYear = Number(searchParams?.get('year') ?? new Date().getFullYear());
  const qTextbookId = Number(searchParams?.get('textbookId') ?? 0);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [proposal, setProposal] = useState<SeasonalProposalWithDetails | null>(null);
  const [studentTextbookId, setStudentTextbookId] = useState<string | null>(qStbId || null);
  const [season, setSeason] = useState<SeasonType>(qSeason || getCurrentSeason());
  const [year, setYear] = useState(qYear);
  const [theme, setTheme] = useState('');
  const [notes, setNotes] = useState('');

  const [selectedTextbookId, setSelectedTextbookId] = useState<number>(qTextbookId);
  const [allTextbooks, setAllTextbooks] = useState<Textbook[]>([]);
  const [showTextbookPicker, setShowTextbookPicker] = useState(false);
  const [textbookSearch, setTextbookSearch] = useState('');
  const [tbFilterSchoolType, setTbFilterSchoolType] = useState('');
  const [tbFilterSubject, setTbFilterSubject] = useState('');
  const [tbFilterGrade, setTbFilterGrade] = useState('');

  const [allItems, setAllItems] = useState<CurriculumItem[]>([]);
  const [progressMap, setProgressMap] = useState<Map<number, StudentProgress>>(new Map());
  const [unitDrafts, setUnitDrafts] = useState<Map<number, UnitDraft>>(new Map());
  const [nextGroupId, setNextGroupId] = useState(1);

  const [studentName, setStudentName] = useState('');
  const [studentSchoolId, setStudentSchoolId] = useState<string | null>(null);
  const [textbookName, setTextbookName] = useState('');
  const [textbookSubject, setTextbookSubject] = useState('');

  const [previewMode, setPreviewMode] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showOrderAlert, setShowOrderAlert] = useState(false);

  // ひな形取り込み
  const [availableCourses, setAvailableCourses] = useState<SeasonalCourse[]>([]);
  const [showCourseImport, setShowCourseImport] = useState(false);
  const [importingCourse, setImportingCourse] = useState(false);

  // ── 初期読み込み ──
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: student } = await supabase
        .from('students')
        .select('last_name, first_name, school_id')
        .eq('id', studentId)
        .single();
      if (student) {
        setStudentName(`${student.last_name} ${student.first_name}`);
        setStudentSchoolId((student as { school_id: string }).school_id);
      }

      let tbId = selectedTextbookId;
      let stbId = studentTextbookId;

      if (!isNew && proposalId) {
        const data = await getProposal(proposalId);
        if (!data) {
          addToast('提案書が見つかりません', 'error');
          return;
        }
        setProposal(data);
        stbId = data.student_textbook_id;
        setStudentTextbookId(stbId);
        setSeason(data.season);
        setYear(data.year);
        setTheme(data.theme);
        setNotes(data.notes ?? '');
        tbId = data.textbook_id;
        setSelectedTextbookId(tbId);
        setTextbookName(data.textbook?.name ?? '');
        setTextbookSubject(data.textbook?.subject ?? '');
      } else if (stbId) {
        const { data: stb } = await supabase
          .from('student_textbooks')
          .select('*, textbook:textbooks(*)')
          .eq('id', stbId)
          .single();

        if (stb) {
          const st = stb as Record<string, unknown>;
          const textbook = st.textbook as { id: number; name: string; subject?: string | null } | null;
          tbId = textbook?.id ?? 0;
          setSelectedTextbookId(tbId);
          setTextbookName(textbook?.name ?? '');
          setTextbookSubject(textbook?.subject ?? '');
        }
      } else if (tbId) {
        const { data: tb } = await supabase
          .from('textbooks')
          .select('name, subject')
          .eq('id', tbId)
          .single();
        if (tb) {
          const t = tb as { name: string; subject: string | null };
          setTextbookName(t.name);
          setTextbookSubject(t.subject ?? '');
        }
      }

      const textbooks = await getTextbooks();
      setAllTextbooks(textbooks);

      if (!tbId) {
        setLoading(false);
        if (isNew) setShowTextbookPicker(true);
        return;
      }

      const { items, progressMap: pm } = await getTextbookUnitsWithProgress(stbId, tbId);
      setAllItems(items);
      setProgressMap(pm);

      const drafts = new Map<number, UnitDraft>();
      let maxGroup = 0;
      for (const item of items) {
        drafts.set(item.id, {
          curriculum_item_id: item.id,
          koma_count: 0,
          applied_koma: 0,
          reason: '',
          selected: false,
          group_id: 0,
          intent_tag: null,
        });
      }

      if (!isNew && proposal) {
        for (const u of proposal.units) {
          const d = drafts.get(u.curriculum_item_id);
          if (d) {
            d.selected = true;
            d.koma_count = u.koma_count;
            d.applied_koma = u.applied_koma ?? 0;
            d.reason = u.reason;
            d.group_id = u.group_id;
            d.intent_tag = u.intent_tag ?? null;
            if (u.group_id > maxGroup) maxGroup = u.group_id;
          }
        }
      }

      if (isNew) {
        pm.forEach((prog, ciId) => {
          if (prog.proposal_count > 0) {
            const d = drafts.get(ciId);
            if (d) {
              d.selected = true;
              d.koma_count = prog.proposal_count;
            }
          }
        });
      }

      setUnitDrafts(drafts);
      setNextGroupId(maxGroup + 1);

      // このテキストを含む講習コースを取得
      try {
        const { data: courseTextbooks } = await supabase
          .from('seasonal_course_textbooks')
          .select('course_id')
          .eq('textbook_id', tbId);
        if (courseTextbooks && courseTextbooks.length > 0) {
          const courseIds = (courseTextbooks as { course_id: string }[]).map((ct) => ct.course_id);
          const { data: courses } = await supabase
            .from('seasonal_courses')
            .select('id, name, season')
            .in('id', courseIds)
            .eq('is_active', true);
          setAvailableCourses((courses ?? []) as SeasonalCourse[]);
        } else {
          setAvailableCourses([]);
        }
      } catch {
        setAvailableCourses([]);
      }
    } catch (_e) {
      addToast('データの読み込みに失敗しました', 'error');
    } finally {
      setLoading(false);
    }
  }, [proposalId, isNew, studentTextbookId, selectedTextbookId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSelectTextbook = async (tb: Textbook) => {
    setSelectedTextbookId(tb.id);
    setTextbookName(tb.name);
    setTextbookSubject(tb.subject ?? '');
    setShowTextbookPicker(false);

    const { items } = await getTextbookUnitsWithProgress(null, tb.id);
    setAllItems(items);
    setProgressMap(new Map());

    const drafts = new Map<number, UnitDraft>();
    for (const item of items) {
      drafts.set(item.id, {
        curriculum_item_id: item.id,
        koma_count: 0,
        applied_koma: 0,
        reason: '',
        selected: false,
        group_id: 0,
        intent_tag: null,
      });
    }
    setUnitDrafts(drafts);
  };

  const toggleUnit = (ciId: number) => {
    setUnitDrafts((prev) => {
      const next = new Map(prev);
      const d = next.get(ciId);
      if (d) next.set(ciId, { ...d, selected: !d.selected });
      return next;
    });
  };

  const updateUnit = (ciId: number, patch: Partial<UnitDraft>) => {
    setUnitDrafts((prev) => {
      const next = new Map(prev);
      const d = next.get(ciId);
      if (d) next.set(ciId, { ...d, ...patch });
      return next;
    });
  };

  const handleImportCourse = async (courseId: string) => {
    if (!selectedTextbookId) return;
    setImportingCourse(true);
    try {
      const { settings } = await getCourseCurriculum(courseId, selectedTextbookId);
      if (settings.length === 0) {
        addToast('このコースにはカリキュラム設定がありません', 'error');
        return;
      }

      let maxGroup = nextGroupId;
      // group_number → 新しい group_id のマッピング
      const groupRemap = new Map<number, number>();

      setUnitDrafts((prev) => {
        const next = new Map(prev);
        for (const s of settings) {
          if (s.proposal_count <= 0) continue;
          const d = next.get(s.curriculum_item_id);
          if (!d) continue;

          let newGroupId = 0;
          if (s.group_number != null && s.group_number > 0) {
            if (!groupRemap.has(s.group_number)) {
              groupRemap.set(s.group_number, maxGroup);
              maxGroup++;
            }
            newGroupId = groupRemap.get(s.group_number)!;
          }

          next.set(s.curriculum_item_id, {
            ...d,
            koma_count: s.proposal_count,
            group_id: newGroupId,
            selected: d.selected,
          });
        }
        return next;
      });

      setNextGroupId(maxGroup);
      setShowCourseImport(false);
      addToast('ひな形を取り込みました', 'success');
    } catch (_e) {
      addToast('取り込みに失敗しました', 'error');
    } finally {
      setImportingCourse(false);
    }
  };

  const groupSelected = () => {
    const ungrouped = Array.from(unitDrafts.values()).filter((d) => d.selected && d.group_id === 0);
    if (ungrouped.length < 2) {
      addToast('グルーピングには2つ以上の未グループ単元を選択してください', 'error');
      return;
    }
    const gid = nextGroupId;
    setNextGroupId(gid + 1);
    setUnitDrafts((prev) => {
      const next = new Map(prev);
      for (const s of ungrouped) {
        const d = next.get(s.curriculum_item_id);
        if (d) next.set(s.curriculum_item_id, {
          ...d,
          group_id: gid,
          koma_count: d.koma_count || 1,
          selected: false,
        });
      }
      return next;
    });
  };

  const ungroupUnit = (ciId: number) => {
    updateUnit(ciId, { group_id: 0 });
  };

  const ungroupAll = (groupId: number) => {
    setUnitDrafts((prev) => {
      const next = new Map(prev);
      Array.from(next.entries()).forEach(([key, d]) => {
        if (d.group_id === groupId) {
          next.set(key, { ...d, group_id: 0 });
        }
      });
      return next;
    });
  };

  const activeUnits = useMemo(() => {
    return Array.from(unitDrafts.values()).filter((d) => d.koma_count > 0);
  }, [unitDrafts]);

  const totalKoma = useMemo(() => {
    return calcTotalKoma(activeUnits);
  }, [activeUnits]);

  const totalAppliedKoma = useMemo(() => {
    return calcTotalAppliedKoma(activeUnits);
  }, [activeUnits]);

  const groupMap = useMemo(() => {
    const map = new Map<number, UnitDraft[]>();
    for (const u of activeUnits) {
      if (u.group_id === 0) continue;
      const list = map.get(u.group_id) ?? [];
      list.push(u);
      map.set(u.group_id, list);
    }
    return map;
  }, [activeUnits]);

  const handleSave = async () => {
    if (!selectedTextbookId) {
      addToast('テキストを選択してください', 'error');
      return;
    }
    setSaving(true);
    try {
      const unitInputs: ProposalUnitInput[] = activeUnits.map((u) => ({
        curriculum_item_id: u.curriculum_item_id,
        koma_count: u.koma_count,
        applied_koma: u.applied_koma > 0 ? u.applied_koma : null,
        reason: u.reason,
        group_id: u.group_id,
        intent_tag: u.intent_tag,
      }));

      const result = await upsertProposal({
        id: isNew ? undefined : proposalId,
        studentId,
        textbookId: selectedTextbookId,
        studentTextbookId: studentTextbookId,
        schoolId: studentSchoolId,
        season,
        year,
        theme,
        notes: notes || null,
        units: unitInputs,
      });

      addToast('保存しました', 'success');

      if (isNew) {
        router.replace(`/students/${studentId}/proposals/${result.id}`);
      } else {
        setProposal(result);
      }
    } catch (_e) {
      addToast('保存に失敗しました', 'error');
    } finally {
      setSaving(false);
    }
  };

  const [statusChanging, setStatusChanging] = useState(false);

  const handleStatusChange = async (newStatus: ProposalStatus) => {
    if (isNew || !proposalId || statusChanging) return;

    // 公開は確認ダイアログ
    if (newStatus === 'approved') {
      if (!window.confirm('提案書を公開しますか？\n\n申込コマ数が進行表に反映され、講師に公開されます。')) return;
    }

    setStatusChanging(true);
    try {
      if (newStatus === 'sent') {
        // 提案済み: applied_koma を koma_count で初期化
        const updated = new Map(unitDrafts);
        Array.from(updated.entries()).forEach(([, d]) => {
          if (d.koma_count > 0) {
            updated.set(d.curriculum_item_id, { ...d, applied_koma: d.koma_count });
          }
        });
        setUnitDrafts(updated);

        const unitInputs = Array.from(updated.values())
          .filter((d) => d.koma_count > 0)
          .map((u) => ({
            curriculum_item_id: u.curriculum_item_id,
            koma_count: u.koma_count,
            applied_koma: u.koma_count,
            reason: u.reason,
            group_id: u.group_id,
            intent_tag: u.intent_tag,
          }));
        await saveProposalUnits(proposalId, unitInputs);

        const totalApplied = calcTotalAppliedKoma(unitInputs);
        await updateProposal(proposalId, { status: newStatus, applied_koma: totalApplied });
      } else if (newStatus === 'approved') {
        // 公開: 未保存の申込コマ数を先に保存してから公開
        const unitInputs = Array.from(unitDrafts.values())
          .filter((d) => d.koma_count > 0)
          .map((u) => ({
            curriculum_item_id: u.curriculum_item_id,
            koma_count: u.koma_count,
            applied_koma: u.applied_koma,
            reason: u.reason,
            group_id: u.group_id,
            intent_tag: u.intent_tag,
          }));
        await saveProposalUnits(proposalId, unitInputs);
        await publishProposal(proposalId);
      } else {
        await updateProposal(proposalId, { status: newStatus });
      }

      setProposal((prev) => prev ? { ...prev, status: newStatus } : prev);
      addToast(`ステータスを「${PROPOSAL_STATUS_LABELS[newStatus]}」に変更しました`, 'success');
    } catch (_e) {
      addToast('ステータス変更に失敗しました', 'error');
    } finally {
      setStatusChanging(false);
    }
  };

  const handleDelete = async () => {
    if (isNew || !proposalId) return;
    try {
      await deleteProposal(proposalId);
      addToast('提案書を削除しました', 'success');
      router.replace(`/students/${studentId}/proposals`);
    } catch (_e) {
      addToast('削除に失敗しました', 'error');
    }
  };

  const isDone = (ciId: number): boolean => {
    const p = progressMap.get(ciId);
    return !!p?.school_progress_date;
  };

  if (loading) {
    return <div className="p-8"><Loading size="md" /></div>;
  }

  const currentStatus = proposal?.status ?? 'draft';
  const seasonLabel = SEASON_LABELS[season] ?? season;

  // ════════════════════════════════════════
  // プレビューモード
  // ════════════════════════════════════════
  if (previewMode) {
    return (
      <div className="max-w-5xl mx-auto">
        <div className="mb-4 flex gap-2 print:hidden">
          <Button variant="outline" size="sm" onClick={() => setPreviewMode(false)}>
            <ArrowLeft className="w-4 h-4 mr-1.5" />
            編集に戻る
          </Button>
          <Button size="sm" onClick={() => window.print()}>
            <Printer className="w-4 h-4 mr-1.5" />
            印刷
          </Button>
        </div>

        <ProposalPrintView
          studentName={studentName}
          textbookName={textbookSubject ? `${textbookSubject} ${textbookName}` : textbookName}
          seasonLabel={seasonLabel}
          year={year}
          theme={theme}
          allItems={allItems}
          activeUnits={activeUnits}
          progressMap={progressMap}
          totalKoma={totalKoma}
          groupMap={groupMap}
        />
        <ToastContainer toasts={toasts} onRemove={removeToast} />
      </div>
    );
  }

  // ════════════════════════════════════════
  // テキスト選択ピッカー
  // ════════════════════════════════════════
  if (showTextbookPicker || (!selectedTextbookId && isNew)) {
    const schoolTypes = Array.from(new Set(allTextbooks.map((t) => t.school_type).filter((v): v is string => !!v))).sort();
    const subjects = Array.from(new Set(allTextbooks.map((t) => t.subject).filter((v): v is string => !!v))).sort();
    const grades = Array.from(
      new Set(
        allTextbooks
          .filter((t) => !tbFilterSchoolType || t.school_type === tbFilterSchoolType)
          .map((t) => t.grade)
          .filter((v): v is string => !!v)
      )
    ).sort();

    const SUBJECT_ORDER = ['英語', '数学', '算数', '国語', '理科', '社会'];
    const GRADE_ORDER = ['1年', '2年', '3年', '4年', '5年', '6年', '共通'];

    const filtered = allTextbooks
      .filter((tb) => {
        if (tbFilterSchoolType && tb.school_type !== tbFilterSchoolType) return false;
        if (tbFilterSubject && tb.subject !== tbFilterSubject) return false;
        if (tbFilterGrade && tb.grade !== tbFilterGrade) return false;
        if (textbookSearch) {
          const q = textbookSearch.toLowerCase();
          if (
            !tb.name.toLowerCase().includes(q) &&
            !tb.subject?.toLowerCase().includes(q) &&
            !tb.publisher?.toLowerCase().includes(q)
          ) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const subjA = SUBJECT_ORDER.indexOf(a.subject || '');
        const subjB = SUBJECT_ORDER.indexOf(b.subject || '');
        if (subjA !== subjB) return (subjA === -1 ? 999 : subjA) - (subjB === -1 ? 999 : subjB);
        const grA = GRADE_ORDER.indexOf(a.grade || '');
        const grB = GRADE_ORDER.indexOf(b.grade || '');
        if (grA !== grB) return (grA === -1 ? 999 : grA) - (grB === -1 ? 999 : grB);
        return a.name.localeCompare(b.name, 'ja');
      });

    return (
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <Link
            href={`/students/${studentId}/proposals`}
            className="text-sm text-text-muted hover:text-text-heading inline-flex items-center gap-1 mb-2 transition-[color] duration-150 ease-out"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            提案書一覧に戻る
          </Link>
          <h1 className="text-lg font-bold text-text-heading">テキストを選択</h1>
          <p className="text-sm text-text-muted mt-0.5">{studentName} の講習提案書{textbookSubject ? ` (${textbookSubject})` : ''}</p>
        </div>

        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-faint" />
          <input
            value={textbookSearch}
            onChange={(e) => setTextbookSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-border-default rounded-lg bg-surface-raised focus:ring-2 focus:ring-primary/20 focus:border-primary"
            placeholder="テキスト名・教科・出版社で検索"
            autoFocus
          />
        </div>

        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <select
            value={tbFilterSchoolType}
            onChange={(e) => { setTbFilterSchoolType(e.target.value); setTbFilterGrade(''); }}
            className="px-2 py-1 border border-border-default rounded-lg text-xs bg-surface-raised text-text-body"
          >
            <option value="">学校種別</option>
            {schoolTypes.map((st) => <option key={st} value={st}>{st}</option>)}
          </select>
          <select
            value={tbFilterSubject}
            onChange={(e) => setTbFilterSubject(e.target.value)}
            className="px-2 py-1 border border-border-default rounded-lg text-xs bg-surface-raised text-text-body"
          >
            <option value="">教科</option>
            {subjects.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select
            value={tbFilterGrade}
            onChange={(e) => setTbFilterGrade(e.target.value)}
            className="px-2 py-1 border border-border-default rounded-lg text-xs bg-surface-raised text-text-body"
          >
            <option value="">学年</option>
            {grades.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          {(tbFilterSchoolType || tbFilterSubject || tbFilterGrade) && (
            <button
              onClick={() => { setTbFilterSchoolType(''); setTbFilterSubject(''); setTbFilterGrade(''); }}
              className="text-xs text-text-muted hover:text-text-heading transition-[color] duration-150 ease-out"
            >
              クリア
            </button>
          )}
          <span className="text-xs text-text-faint ml-auto">{filtered.length}件</span>
        </div>

        <div className="space-y-1 max-h-[60vh] overflow-y-auto">
          {filtered.map((tb) => (
            <button
              key={tb.id}
              onClick={() => handleSelectTextbook(tb)}
              className="w-full text-left px-4 py-3 bg-surface-raised rounded-lg border border-border-default hover:border-accent-ink/30 hover:bg-accent-ink-subtle active:scale-[0.99] transition-[background-color,border-color,transform] duration-150 ease-out"
            >
              <div className="text-sm font-medium text-text-heading">{tb.name}</div>
              <div className="text-xs text-text-muted mt-0.5">
                {[tb.subject, tb.publisher, tb.grade].filter(Boolean).join(' / ')}
              </div>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="py-8 text-center text-sm text-text-faint">該当するテキストがありません</div>
          )}
        </div>
        <ToastContainer toasts={toasts} onRemove={removeToast} />
      </div>
    );
  }

  // ════════════════════════════════════════
  // 編集モード
  // ════════════════════════════════════════
  return (
    <div className="max-w-3xl mx-auto">
      {/* ヘッダー */}
      <div className="mb-6">
        <Link
          href={`/students/${studentId}/proposals`}
          className="text-sm text-text-muted hover:text-text-heading inline-flex items-center gap-1 mb-2 transition-[color] duration-150 ease-out"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          提案書一覧
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-text-heading">
              {isNew ? '講習提案書を作成' : '講習提案書を編集'}
            </h1>
            <p className="text-sm text-text-muted mt-0.5">
              {studentName} / {textbookSubject ? `${textbookSubject} ` : ''}{textbookName} / {year}年 {seasonLabel}講習
            </p>
          </div>

          {!isNew && (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-0.5">
                {STATUS_FLOW.map((s, i) => {
                  const isCurrent = currentStatus === s;
                  const currentIdx = STATUS_FLOW.indexOf(currentStatus);
                  const isPast = STATUS_FLOW.indexOf(s) < currentIdx;
                  return (
                    <div key={s} className="flex items-center">
                      {i > 0 && (
                        <div className={`w-3 h-px mx-0.5 ${isPast || isCurrent ? 'bg-text-muted' : 'bg-border-default'}`} />
                      )}
                      <button
                        onClick={() => handleStatusChange(s)}
                        disabled={statusChanging}
                        className={`px-2.5 py-1 text-[11px] font-bold rounded-full active:scale-95 transition-[background-color,color,transform] duration-150 ease-out disabled:opacity-40 disabled:cursor-not-allowed ${
                          isCurrent ? STATUS_COLORS[s].active : STATUS_COLORS[s].inactive
                        }`}
                      >
                        {statusChanging && s === currentStatus ? '...' : PROPOSAL_STATUS_LABELS[s]}
                      </button>
                    </div>
                  );
                })}
              </div>
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="p-1.5 text-text-faint hover:text-danger rounded-lg hover:bg-surface-hover transition-[background-color,color] duration-150 ease-out"
                title="削除"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-5">
        {/* シーズン・年 */}
        {isNew && (
          <section className="p-4 bg-surface-raised rounded-xl border border-border-default">
            <div className="flex gap-4">
              <div>
                <label className="text-xs font-bold text-text-muted block mb-1.5">シーズン</label>
                <div className="flex gap-1">
                  {(['spring', 'summer', 'winter'] as SeasonType[]).map((s) => (
                    <button
                      key={s}
                      onClick={() => setSeason(s)}
                      className={`px-3 py-1.5 text-xs rounded-lg font-medium active:scale-[0.97] transition-[background-color,color,transform] duration-150 ease-out ${
                        season === s
                          ? 'bg-ink text-text-on-primary'
                          : 'bg-surface-hover text-text-body hover:bg-border-default'
                      }`}
                    >
                      {SEASON_LABELS[s]}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-text-muted block mb-1.5">年度</label>
                <input
                  type="number"
                  value={year}
                  onChange={(e) => setYear(Number(e.target.value))}
                  className="w-24 px-3 py-1.5 text-sm border border-border-default rounded-lg bg-surface-raised focus:ring-2 focus:ring-primary/20 focus:border-primary"
                />
              </div>
            </div>
          </section>
        )}

        {/* テキスト変更 */}
        {isNew && (
          <section className="p-4 bg-surface-raised rounded-xl border border-border-default flex items-center justify-between">
            <div>
              <div className="text-xs font-bold text-text-muted mb-0.5">テキスト</div>
              <div className="text-sm font-medium text-text-heading">{textbookName}</div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setShowTextbookPicker(true)}>
              変更
            </Button>
          </section>
        )}

        {/* テーマ */}
        <section className="p-4 bg-surface-raised rounded-xl border border-border-default">
          <label className="text-sm font-bold text-text-heading block mb-2">講習テーマ</label>
          <input
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-border-default rounded-lg bg-surface-raised focus:ring-2 focus:ring-primary/20 focus:border-primary"
            placeholder="例: 英検3級対策 / 1年生の総復習 / 2学期の先取り"
          />
        </section>

        {/* 単元選択 */}
        <section className="p-4 bg-surface-raised rounded-xl border border-border-default">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-text-heading">対象単元を選択</h2>
            <div className="flex items-center gap-3">
              {availableCourses.length > 0 && (
                <div className="relative">
                  <button
                    onClick={() => setShowCourseImport(!showCourseImport)}
                    disabled={importingCourse}
                    className="px-2 py-1 text-[11px] bg-accent-ink-subtle text-accent-ink rounded-md hover:bg-accent-ink/20 flex items-center gap-1 transition-[background-color,color,transform] duration-150 ease-out active:scale-95 disabled:opacity-50"
                    title="講習一覧のひな形を取り込む"
                  >
                    <Download className="w-3 h-3" />
                    ひな形取込
                  </button>
                  {showCourseImport && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setShowCourseImport(false)} />
                      <div className="absolute right-0 top-full mt-1 w-56 bg-surface-raised border border-border-default rounded-lg shadow-lg z-20 overflow-hidden">
                        <div className="px-3 py-1.5 text-[10px] text-text-faint uppercase tracking-wider border-b border-border-subtle">
                          講習ひな形を選択
                        </div>
                        {availableCourses.map((c) => (
                          <button
                            key={c.id}
                            onClick={() => handleImportCourse(c.id)}
                            className="w-full px-3 py-2 text-left text-xs text-text-body hover:bg-surface-hover transition-[background-color] duration-100 ease-out"
                          >
                            <div className="font-medium text-text-heading">{c.name}</div>
                            <div className="text-[10px] text-text-muted mt-0.5">
                              {SEASON_LABELS[c.season as SeasonType]}
                            </div>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
              <button
                onClick={groupSelected}
                className="px-2 py-1 text-[11px] bg-surface-hover text-text-muted rounded-md hover:bg-border-default flex items-center gap-1 active:scale-95 transition-[background-color,color,transform] duration-150 ease-out"
                title="選択中の未グループ単元を1コマにまとめる"
              >
                <Link2 className="w-3 h-3" />
                グループ化
              </button>
              <div className="text-sm font-bold">
                <span className="text-accent-ink">{activeUnits.length}単元 / {totalKoma}コマ</span>
                {totalAppliedKoma != null && (
                  <span className="text-info ml-2">申込 {totalAppliedKoma}コマ</span>
                )}
              </div>
            </div>
          </div>

          {activeUnits.length > 0 && (
            <div className="flex items-center justify-end gap-1 mb-1 pr-8 text-[10px] text-text-faint font-medium">
              <span className="w-[88px] text-center">提案</span>
              <span className="w-[88px] text-center">申込</span>
            </div>
          )}

          <div className="space-y-1">
            {allItems.map((item) => {
              const draft = unitDrafts.get(item.id);
              if (!draft) return null;
              const done = isDone(item.id);
              const groupMembers = draft.group_id > 0 ? groupMap.get(draft.group_id) : undefined;

              return (
                <UnitRow
                  key={item.id}
                  item={item}
                  draft={draft}
                  done={done}
                  groupMembers={groupMembers}
                  onToggle={() => toggleUnit(item.id)}
                  onUpdate={(patch) => updateUnit(item.id, patch)}
                  onUngroup={() => ungroupUnit(item.id)}
                  onUngroupAll={() => draft.group_id > 0 && ungroupAll(draft.group_id)}
                />
              );
            })}
          </div>
        </section>

        {/* メモ */}
        <section className="p-4 bg-surface-raised rounded-xl border border-border-default">
          <label className="text-sm font-bold text-text-heading block mb-2">
            備考（内部メモ・印刷には出ません）
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 text-sm border border-border-default rounded-lg bg-surface-raised focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none"
            placeholder="内部メモ"
          />
        </section>

        {/* アクション */}
        <div className="flex gap-2">
          <Button
            className="flex-1"
            onClick={handleSave}
            disabled={saving || !theme.trim() || !selectedTextbookId}
            isLoading={saving}
          >
            <Save className="w-4 h-4 mr-1.5" />
            保存
          </Button>
          <Button variant="outline" onClick={() => setPreviewMode(true)}>
            <Printer className="w-4 h-4 mr-1.5" />
            プレビュー
          </Button>
        </div>

      </div>

      {/* 削除確認 */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>提案書を削除しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              「{theme || `${year}年 ${seasonLabel}講習`}」を削除します。この操作は取り消せません。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setShowDeleteConfirm(false)}>
              キャンセル
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-danger text-white hover:bg-red-700"
            >
              削除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* テキスト発注アラート */}
      <AlertDialog open={showOrderAlert} onOpenChange={setShowOrderAlert}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <PackageOpen className="w-5 h-5 text-warning" />
              テキスト発注が必要です
            </AlertDialogTitle>
            <AlertDialogDescription>
              {studentName} さんの進行表に「{textbookSubject ? `${textbookSubject} ` : ''}{textbookName}」を新しく追加しました。テキストの発注を忘れずに行ってください。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setShowOrderAlert(false)}>
              確認しました
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}

// ─── 単元行 ───

function UnitRow({
  item,
  draft,
  done,
  groupMembers,
  onToggle,
  onUpdate,
  onUngroup,
  onUngroupAll,
}: {
  item: CurriculumItem;
  draft: UnitDraft;
  done: boolean;
  groupMembers?: UnitDraft[];
  onToggle: () => void;
  onUpdate: (patch: Partial<UnitDraft>) => void;
  onUngroup: () => void;
  onUngroupAll: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isGroupHead = groupMembers && groupMembers[0]?.curriculum_item_id === draft.curriculum_item_id;
  const isGrouped = draft.group_id > 0;
  const hasApplied = draft.applied_koma > 0;

  const handleCardClick = () => {
    onUpdate({ koma_count: draft.koma_count + 1 });
  };

  const isActive = draft.koma_count > 0;

  const rowColor = !isActive
    ? draft.selected
      ? 'border-primary/30 bg-primary/5'
      : 'border-border-subtle bg-surface-raised'
    : hasApplied
      ? 'border-success/30 bg-success-subtle'
      : isGrouped
        ? 'border-info/30 bg-info-subtle'
        : 'border-accent-ink/20 bg-accent-ink-subtle';

  const checkColor = !draft.selected
    ? 'border-border-strong hover:border-text-muted'
    : 'bg-primary border-primary text-white';

  return (
    <div className={`rounded-lg border transition-[background-color,border-color] duration-150 ease-out ${rowColor}`}>
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          onClick={onToggle}
          className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-90 ${checkColor}`}
          aria-label={draft.selected ? `${item.title} を選択解除` : `${item.title} を選択`}
        >
          {draft.selected && <Check className="w-3 h-3" />}
        </button>

        <button
          type="button"
          onClick={handleCardClick}
          className="flex-1 min-w-0 text-left cursor-pointer group active:opacity-70 transition-opacity duration-100"
        >
          <span
            className={`text-sm transition-[color] duration-150 ease-out ${
              done
                ? 'text-text-faint line-through'
                : isActive
                  ? 'font-medium text-text-heading group-hover:text-accent-ink'
                  : 'text-text-body group-hover:text-text-heading'
            }`}
          >
            {item.title}
          </span>
          {done && (
            <span className="ml-1.5 text-[10px] text-text-faint">指導済</span>
          )}
          {isGrouped && !isActive && (
            <span className="ml-1.5 text-[10px] text-info font-medium">
              G{draft.group_id}
            </span>
          )}
          {isActive && draft.intent_tag && (
            <span
              className={`ml-1.5 inline-block px-1.5 py-0 border rounded-full text-[9px] font-medium ${INTENT_TAG_COLOR[draft.intent_tag as IntentTag] ?? 'text-text-muted border-border-default'}`}
            >
              {draft.intent_tag}
            </span>
          )}
        </button>

        {isActive && (!isGrouped || isGroupHead) && (
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => onUpdate({ koma_count: Math.max(0, draft.koma_count - 1) })}
                className="w-5 h-5 flex items-center justify-center text-text-faint hover:text-text-body rounded hover:bg-surface-hover active:bg-border-default transition-[background-color,color] duration-100 ease-out"
                aria-label="提案コマ数を減らす"
              >
                <Minus className="w-3 h-3" />
              </button>
              <span className="w-6 text-center text-sm font-bold text-accent-ink">
                {draft.koma_count}
              </span>
              <button
                onClick={() => onUpdate({ koma_count: draft.koma_count + 1 })}
                className="w-5 h-5 flex items-center justify-center text-text-faint hover:text-text-body rounded hover:bg-surface-hover active:bg-border-default transition-[background-color,color] duration-100 ease-out"
                aria-label="提案コマ数を増やす"
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>

            <div className="w-px h-4 bg-border-default" />

            <div className="flex items-center gap-0.5">
              <button
                onClick={() => onUpdate({ applied_koma: Math.max(0, draft.applied_koma - 1) })}
                className="w-5 h-5 flex items-center justify-center text-text-faint hover:text-text-body rounded hover:bg-surface-hover active:bg-border-default transition-[background-color,color] duration-100 ease-out"
                aria-label="申込コマ数を減らす"
              >
                <Minus className="w-3 h-3" />
              </button>
              <span className={`w-6 text-center text-sm font-bold ${hasApplied ? 'text-success' : 'text-text-faint'}`}>
                {draft.applied_koma}
              </span>
              <button
                onClick={() => onUpdate({ applied_koma: draft.applied_koma + 1 })}
                className="w-5 h-5 flex items-center justify-center text-text-faint hover:text-text-body rounded hover:bg-surface-hover active:bg-border-default transition-[background-color,color] duration-100 ease-out"
                aria-label="申込コマ数を増やす"
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}

        {isGrouped && isActive && (
          <div className="flex items-center gap-1 shrink-0">
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-bold text-info bg-info/10 rounded">
              <Link2 className="w-2.5 h-2.5" />
              G{draft.group_id}
            </span>
            {isGroupHead ? (
              <button
                onClick={onUngroupAll}
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium text-error bg-error/10 rounded hover:bg-error/20 active:scale-95 transition-[background-color,color,transform] duration-100 ease-out"
                title="グループを全解除"
                aria-label="グループを全解除"
              >
                <Unlink className="w-2.5 h-2.5" />
                全解除
              </button>
            ) : (
              <button
                onClick={onUngroup}
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium text-text-muted bg-surface-hover rounded hover:bg-border-default active:scale-95 transition-[background-color,color,transform] duration-100 ease-out"
                title="グループから外す"
                aria-label="グループから外す"
              >
                <X className="w-2.5 h-2.5" />
                外す
              </button>
            )}
          </div>
        )}

        {isActive && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1 text-text-faint hover:text-text-body rounded hover:bg-surface-hover active:bg-border-default transition-[background-color,color] duration-100 ease-out"
            aria-label={expanded ? '理由を閉じる' : '理由を入力'}
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        )}
      </div>

      {isActive && expanded && (
        <div className="px-3 pb-2.5 pt-0 space-y-1.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] text-text-muted shrink-0">指導意図:</span>
            {INTENT_TAGS.map((tag) => {
              const active = draft.intent_tag === tag;
              const color = INTENT_TAG_COLOR[tag];
              return (
                <button
                  key={tag}
                  onClick={() => onUpdate({ intent_tag: active ? null : tag })}
                  className={`px-1.5 py-0.5 text-[10px] font-medium border rounded-full transition-[background-color,border-color,color,transform] duration-100 ease-out active:scale-95 ${
                    active
                      ? `${color} bg-white border-current`
                      : 'text-text-faint border-border-default hover:border-text-muted hover:text-text-muted'
                  }`}
                >
                  {tag}
                </button>
              );
            })}
          </div>
          <input
            value={draft.reason}
            onChange={(e) => onUpdate({ reason: e.target.value })}
            className="w-full px-2.5 py-1.5 text-xs border border-border-default rounded-lg bg-surface-raised focus:ring-1 focus:ring-primary/20 focus:border-primary"
            placeholder="この単元を講習で扱う理由（保護者に表示されます）"
          />
        </div>
      )}
    </div>
  );
}

function getCurrentSeason(): SeasonType {
  const month = new Date().getMonth() + 1;
  if (month >= 2 && month <= 4) return 'spring';
  if (month >= 5 && month <= 9) return 'summer';
  return 'winter';
}
