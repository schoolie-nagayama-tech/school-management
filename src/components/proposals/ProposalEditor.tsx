'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  Link2,
  Minus,
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
  syncProposalToProgress,
  calcTotalKoma,
  calcTotalAppliedKoma,
} from '@/lib/api/proposals';
import type { ProposalUnitInput } from '@/lib/api/proposals';
import { getTextbooks } from '@/lib/api/textbooks';
import { supabase } from '@/lib/supabase';
import type {
  CurriculumItem,
  ProposalStatus,
  SeasonalProposalWithDetails,
  SeasonType,
  StudentProgress,
  Textbook,
} from '@/types/database';
import { SEASON_LABELS, PROPOSAL_STATUS_LABELS } from '@/types/database';

interface UnitDraft {
  curriculum_item_id: number;
  koma_count: number;
  applied_koma: number;
  reason: string;
  selected: boolean;
  group_id: number;
}

const STATUS_FLOW: ProposalStatus[] = ['draft', 'sent'];

const STATUS_COLORS: Record<string, { active: string; inactive: string }> = {
  draft: {
    active: 'bg-text-muted text-white',
    inactive: 'bg-surface-hover text-text-muted hover:bg-border-default',
  },
  sent: {
    active: 'bg-info text-white',
    inactive: 'bg-info-subtle text-info hover:bg-info/15',
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
  const [syncing, setSyncing] = useState(false);
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
  const [textbookName, setTextbookName] = useState('');
  const [textbookSubject, setTextbookSubject] = useState('');

  const [previewMode, setPreviewMode] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // ── 初期読み込み ──
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: student } = await supabase
        .from('students')
        .select('last_name, first_name')
        .eq('id', studentId)
        .single();
      if (student) {
        setStudentName(`${student.last_name} ${student.first_name}`);
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
    } catch (e) {
      console.error(e);
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

  const groupSelected = () => {
    const ungrouped = Array.from(unitDrafts.values()).filter((d) => d.selected && d.koma_count > 0 && d.group_id === 0);
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
        if (d) next.set(s.curriculum_item_id, { ...d, group_id: gid });
      }
      return next;
    });
  };

  const ungroupUnit = (ciId: number) => {
    updateUnit(ciId, { group_id: 0 });
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
      }));

      const result = await upsertProposal({
        id: isNew ? undefined : proposalId,
        studentId,
        textbookId: selectedTextbookId,
        studentTextbookId: studentTextbookId,
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
    } catch (e) {
      console.error(e);
      addToast('保存に失敗しました', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (newStatus: ProposalStatus) => {
    if (isNew || !proposalId) return;
    try {
      if (newStatus === 'sent') {
        const updated = new Map(unitDrafts);
        Array.from(updated.entries()).forEach(([ciId, d]) => {
          if (d.koma_count > 0) {
            updated.set(ciId, { ...d, applied_koma: d.koma_count });
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
          }));
        await saveProposalUnits(proposalId, unitInputs);

        const totalApplied = calcTotalAppliedKoma(unitInputs);
        await updateProposal(proposalId, { status: newStatus, applied_koma: totalApplied });
      } else {
        await updateProposal(proposalId, { status: newStatus });
      }

      setProposal((prev) => prev ? { ...prev, status: newStatus } : prev);
      addToast(`ステータスを「${PROPOSAL_STATUS_LABELS[newStatus]}」に変更しました`, 'success');
    } catch (e) {
      console.error(e);
      addToast('ステータス変更に失敗しました', 'error');
    }
  };

  const handleDelete = async () => {
    if (isNew || !proposalId) return;
    try {
      await deleteProposal(proposalId);
      addToast('提案書を削除しました', 'success');
      router.replace(`/students/${studentId}/proposals`);
    } catch (e) {
      console.error(e);
      addToast('削除に失敗しました', 'error');
    }
  };

  const handleSyncToProgress = async () => {
    if (isNew || !proposalId) return;
    setSyncing(true);
    try {
      const { studentTextbookId: stbId } = await syncProposalToProgress(proposalId);
      setStudentTextbookId(stbId);
      addToast('進行表に反映しました', 'success');
    } catch (e) {
      console.error(e);
      addToast('進行表への反映に失敗しました', 'error');
    } finally {
      setSyncing(false);
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
      <div className="max-w-2xl mx-auto">
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
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <Link
            href={`/students/${studentId}/proposals`}
            className="text-sm text-text-muted hover:text-text-heading inline-flex items-center gap-1 mb-2 transition-colors duration-150"
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
              className="text-xs text-text-muted hover:text-text-heading transition-colors duration-150"
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
              className="w-full text-left px-4 py-3 bg-surface-raised rounded-lg border border-border-default hover:border-accent-ink/30 hover:bg-accent-ink-subtle transition-colors duration-150"
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
          className="text-sm text-text-muted hover:text-text-heading inline-flex items-center gap-1 mb-2 transition-colors duration-150"
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
            <div className="flex items-center gap-1.5">
              {STATUS_FLOW.map((s) => (
                <button
                  key={s}
                  onClick={() => handleStatusChange(s)}
                  className={`px-2.5 py-1 text-[11px] font-bold rounded-full transition-colors duration-150 ${
                    currentStatus === s ? STATUS_COLORS[s].active : STATUS_COLORS[s].inactive
                  }`}
                >
                  {PROPOSAL_STATUS_LABELS[s]}
                </button>
              ))}
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
                      className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors duration-150 ${
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
              <button
                onClick={groupSelected}
                className="px-2 py-1 text-[11px] bg-surface-hover text-text-muted rounded-md hover:bg-border-default flex items-center gap-1 transition-colors duration-150"
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

        {/* 進行表反映 + 削除 */}
        {!isNew && (
          <div className="flex gap-2 pt-2 border-t border-border-subtle">
            <Button
              variant="outline"
              className="flex-1 !border-success/40 !text-success hover:!bg-success-subtle"
              onClick={handleSyncToProgress}
              disabled={syncing}
              isLoading={syncing}
            >
              <ArrowRight className="w-4 h-4 mr-1.5" />
              進行表に反映
            </Button>
            <Button variant="danger" onClick={() => setShowDeleteConfirm(true)}>
              <Trash2 className="w-4 h-4 mr-1.5" />
              削除
            </Button>
          </div>
        )}
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
}: {
  item: CurriculumItem;
  draft: UnitDraft;
  done: boolean;
  groupMembers?: UnitDraft[];
  onToggle: () => void;
  onUpdate: (patch: Partial<UnitDraft>) => void;
  onUngroup: () => void;
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
    <div className={`rounded-lg border transition-colors duration-150 ${rowColor}`}>
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          onClick={onToggle}
          className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors duration-150 ${checkColor}`}
          aria-label={draft.selected ? `${item.title} を選択解除` : `${item.title} を選択`}
        >
          {draft.selected && <Check className="w-3 h-3" />}
        </button>

        <button
          type="button"
          onClick={handleCardClick}
          className="flex-1 min-w-0 text-left cursor-pointer group"
        >
          <span
            className={`text-sm transition-colors duration-150 ${
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
          {isGrouped && (
            <span className="ml-1.5 text-[10px] text-info font-medium">
              G{draft.group_id}
            </span>
          )}
        </button>

        {isActive && (!isGrouped || isGroupHead) && (
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => onUpdate({ koma_count: Math.max(0, draft.koma_count - 1) })}
                className="w-5 h-5 flex items-center justify-center text-text-faint hover:text-text-body rounded hover:bg-surface-hover transition-colors duration-150"
                aria-label="提案コマ数を減らす"
              >
                <Minus className="w-3 h-3" />
              </button>
              <span className="w-6 text-center text-sm font-bold text-accent-ink">
                {draft.koma_count}
              </span>
              <button
                onClick={() => onUpdate({ koma_count: draft.koma_count + 1 })}
                className="w-5 h-5 flex items-center justify-center text-text-faint hover:text-text-body rounded hover:bg-surface-hover transition-colors duration-150"
                aria-label="提案コマ数を増やす"
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>

            <div className="w-px h-4 bg-border-default" />

            <div className="flex items-center gap-0.5">
              <button
                onClick={() => onUpdate({ applied_koma: Math.max(0, draft.applied_koma - 1) })}
                className="w-5 h-5 flex items-center justify-center text-text-faint hover:text-text-body rounded hover:bg-surface-hover transition-colors duration-150"
                aria-label="申込コマ数を減らす"
              >
                <Minus className="w-3 h-3" />
              </button>
              <span className={`w-6 text-center text-sm font-bold ${hasApplied ? 'text-success' : 'text-text-faint'}`}>
                {draft.applied_koma}
              </span>
              <button
                onClick={() => onUpdate({ applied_koma: draft.applied_koma + 1 })}
                className="w-5 h-5 flex items-center justify-center text-text-faint hover:text-text-body rounded hover:bg-surface-hover transition-colors duration-150"
                aria-label="申込コマ数を増やす"
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}

        {isGrouped && isActive && (
          <button
            onClick={onUngroup}
            className="p-1 text-info/60 hover:text-info rounded hover:bg-info/10 transition-colors duration-150"
            title="グループから外す"
            aria-label="グループから外す"
          >
            <Link2 className="w-3.5 h-3.5" />
          </button>
        )}

        {isActive && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1 text-text-faint hover:text-text-body rounded hover:bg-surface-hover transition-colors duration-150"
            aria-label={expanded ? '理由を閉じる' : '理由を入力'}
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        )}
      </div>

      {isActive && expanded && (
        <div className="px-3 pb-2.5 pt-0">
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

// ─── 印刷プレビュー ───

function ProposalPrintView({
  studentName,
  textbookName,
  seasonLabel,
  year,
  theme,
  allItems,
  activeUnits,
  progressMap,
  totalKoma,
  groupMap,
}: {
  studentName: string;
  textbookName: string;
  seasonLabel: string;
  year: number;
  theme: string;
  allItems: CurriculumItem[];
  activeUnits: UnitDraft[];
  progressMap: Map<number, StudentProgress>;
  totalKoma: number;
  groupMap: Map<number, UnitDraft[]>;
}) {
  const selectedIds = new Set(activeUnits.map((u) => u.curriculum_item_id));
  const unitMap = new Map(activeUnits.map((u) => [u.curriculum_item_id, u]));
  const doneCount = allItems.filter((item) => !!progressMap.get(item.id)?.school_progress_date).length;

  return (
    <div className="space-y-5 print:space-y-4">
      <div className="p-5 bg-ink text-text-on-primary rounded-2xl print:rounded-none print:bg-white print:text-text-heading print:border-b-2 print:border-ink">
        <div className="text-lg font-bold">{year}年 {seasonLabel}講習のご提案</div>
        <div className="text-sm mt-1 opacity-90 print:opacity-100">
          {studentName} さま / {textbookName}
        </div>
      </div>

      {theme && (
        <section className="p-4 bg-surface-raised rounded-xl border border-border-default print:border-border-strong">
          <h2 className="text-sm font-bold text-text-heading mb-1">講習テーマ</h2>
          <p className="text-sm text-text-body">{theme}</p>
        </section>
      )}

      <section className="p-4 bg-surface-raised rounded-xl border border-border-default print:border-border-strong">
        <h2 className="text-sm font-bold text-text-heading mb-2">現在の進捗</h2>
        <div className="flex items-center gap-3">
          <div className="flex-1 h-2 bg-surface-hover rounded-full overflow-hidden print:border print:border-border-strong">
            <div
              className="h-full bg-ink rounded-full"
              style={{ width: allItems.length ? `${(doneCount / allItems.length) * 100}%` : '0%' }}
            />
          </div>
          <span className="text-sm font-bold text-text-heading shrink-0">
            {doneCount}
            <span className="text-xs font-normal text-text-muted">/{allItems.length}単元</span>
          </span>
        </div>
      </section>

      <section className="p-4 bg-surface-raised rounded-xl border border-border-default print:border-border-strong">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-text-heading">テキスト全単元と講習対象</h2>
          <span className="text-sm font-bold text-accent-ink print:text-text-heading">
            講習 {totalKoma}コマ / {activeUnits.length}単元
          </span>
        </div>
        <table className="w-full text-xs">
          <thead className="border-b border-border-default">
            <tr>
              <th className="py-2 text-left font-semibold text-text-muted">単元</th>
              <th className="py-2 text-center w-14 font-semibold text-text-muted">状況</th>
              <th className="py-2 text-center w-12 font-semibold text-text-muted">コマ</th>
              <th className="py-2 text-left font-semibold text-text-muted">講習で扱う理由</th>
            </tr>
          </thead>
          <tbody>
            {allItems.map((item) => {
              const isTarget = selectedIds.has(item.id);
              const progress = progressMap.get(item.id);
              const itemDone = !!progress?.school_progress_date;
              const unit = unitMap.get(item.id);
              const isGrouped = unit && unit.group_id > 0;
              const members = isGrouped ? groupMap.get(unit.group_id) : undefined;
              const isGroupHead = members && members[0]?.curriculum_item_id === item.id;

              return (
                <tr
                  key={item.id}
                  className={
                    isTarget
                      ? 'bg-accent-ink-subtle border-b border-accent-ink/10 print:bg-surface'
                      : 'border-b border-border-subtle'
                  }
                >
                  <td
                    className={`py-2 ${
                      isTarget
                        ? 'font-bold text-accent-ink print:text-text-heading'
                        : itemDone
                          ? 'text-text-faint line-through'
                          : 'text-text-body'
                    }`}
                  >
                    {item.title}
                    {isGrouped && (
                      <span className="ml-1 text-[9px] text-info">G{unit.group_id}</span>
                    )}
                  </td>
                  <td className="py-2 text-center">
                    {itemDone ? (
                      <span className="inline-flex items-center gap-0.5 text-[10px] text-text-faint">
                        <Check className="w-3 h-3" />済
                      </span>
                    ) : isTarget ? (
                      <span className="px-1.5 py-0.5 bg-ink text-text-on-primary text-[10px] font-bold rounded">
                        講習
                      </span>
                    ) : (
                      <span className="text-[10px] text-text-faint">--</span>
                    )}
                  </td>
                  <td className="py-2 text-center font-bold text-accent-ink print:text-text-heading">
                    {isTarget && (!isGrouped || isGroupHead) ? unit?.koma_count : ''}
                  </td>
                  <td className={`py-2 ${isTarget ? 'text-text-body' : 'text-text-faint'}`}>
                    {isTarget ? unit?.reason : ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="p-4 bg-surface rounded-xl border border-border-default print:border-border-strong">
        <div className="flex items-center gap-3">
          <div className="text-sm text-text-muted">講習内容:</div>
          <div className="text-sm font-bold text-accent-ink print:text-text-heading">
            {activeUnits.length}単元 / {totalKoma}コマ
          </div>
        </div>
      </section>
    </div>
  );
}

function getCurrentSeason(): SeasonType {
  const month = new Date().getMonth() + 1;
  if (month >= 2 && month <= 4) return 'spring';
  if (month >= 5 && month <= 9) return 'summer';
  return 'winter';
}
