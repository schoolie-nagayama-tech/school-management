'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowUp,
  BookPlus,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  FileText,
  Link2,
  PackageOpen,
  Printer,
  Save,
  Search,
  Star,
  Tag,
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
import { useAuth } from '@/contexts/AuthContext';
import {
  getProposal,
  getTextbookUnitsWithProgress,
  upsertProposal,
  deleteProposal,
  updateProposal,
  saveProposalUnits,
  publishProposal,
  clearProposalProgressTracking,
  calcTotalKoma,
  calcTotalAppliedKoma,
  promoteProposalToCourse,
} from '@/lib/api/proposals';
import type { ProposalUnitInput } from '@/lib/api/proposals';
import { getProposalOrderCandidates, type OrderCandidate } from '@/lib/api/ordering';
import { PublishOrderDialog } from './PublishOrderDialog';
import { getTextbooks } from '@/lib/api/textbooks';
import {
  addFavoriteTextbook,
  getFavoriteTextbookIds,
  removeFavoriteTextbook,
} from '@/lib/api/textbook-favorites';
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
import { SEASON_LABELS, PROPOSAL_STATUS_LABELS, GRADE_LABELS } from '@/types/database';
import { ProposalPrintView } from './ProposalPrintView';

import { UnitRow } from './UnitRow';
import {
  DEFAULT_SUBJECT_BADGE,
  INTENT_TAG_COLOR,
  INTENT_TAGS,
  STATUS_COLORS,
  STATUS_FLOW,
  STATUS_INACTIVE,
  SUBJECT_BADGE_COLORS,
  getCurrentSeason,
  type IntentTag,
  type UnitDraft,
} from './proposalEditor.shared';
// 単元の選択・結合の純粋ロジック。講習テンプレートの編集画面と共有する（挙動を1か所に集約）
import {
  applyDragRange as applyDragRangeTo,
  buildGroupMap,
  clearSelection as clearSelectionIn,
  getSelectionInfo,
  groupSelectedUnits,
  selectionSnapshot,
  setSelectionRange,
  ungroupAllInGroup,
  type GroupKind,
} from '@/components/koushu-plan/unitDraftLogic';
import { courseSettingsToDrafts } from '@/components/koushu-plan/courseSettingAdapter';
import {
  filterAndSortTextbooks,
  textbookFilterOptions,
} from '@/components/koushu-plan/textbookPicker';

export default function ProposalEditor() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { toasts, addToast, removeToast } = useToast();
  const { profile } = useAuth();
  // 公開・削除・講習登録は教室長以上(manager/owner/admin)のみ許可
  const isManagerOrAbove =
    profile?.role === 'manager' || profile?.role === 'owner' || profile?.role === 'admin';

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
  // テキスト選択画面で上位表示するためのお気に入り集合。ユーザー個人ごと（DB保存）
  const [favoriteTextbookIds, setFavoriteTextbookIds] = useState<Set<number>>(new Set());
  const [favoriteTogglePending, setFavoriteTogglePending] = useState<number | null>(null);
  const [tbFilterSchoolType, setTbFilterSchoolType] = useState('');
  const [tbFilterSubject, setTbFilterSubject] = useState('');
  const [tbFilterGrade, setTbFilterGrade] = useState('');

  const [allItems, setAllItems] = useState<CurriculumItem[]>([]);
  // 画面に出ている順の curriculum_item_id。選択・結合の純粋ロジックへ並び順を渡すのに使う
  const orderedIds = useMemo(() => allItems.map((i) => i.id), [allItems]);
  const [progressMap, setProgressMap] = useState<Map<number, StudentProgress>>(new Map());
  const [unitDrafts, setUnitDrafts] = useState<Map<number, UnitDraft>>(new Map());
  const [nextGroupId, setNextGroupId] = useState(1);
  // 申込結合グループの採番（提案結合 nextGroupId とは独立）
  const [nextAppliedGroupId, setNextAppliedGroupId] = useState(1);
  const lastToggleIdRef = useRef<number | null>(null);

  // ── 単元の範囲選択（ドラッグでなぞって選択）＋ 選択脇のフローティング「まとめる」 ──
  // チェックを1個ずつ付けて下部バーまで往復する手間を減らすためのUI。
  const [dragging, setDragging] = useState(false);
  const dragAnchorIdxRef = useRef<number | null>(null); // ドラッグ開始行のindex
  const dragModeRef = useRef<boolean>(true); // true=選択 / false=解除（開始行の状態で決まる）
  const dragSnapshotRef = useRef<Set<number>>(new Set()); // ドラッグ開始時点の選択集合（ラバーバンドの基準）
  const draggingRef = useRef(false); // 高速クリック時のリスナ取りこぼしを防ぐため ref でも保持
  const listRef = useRef<HTMLDivElement>(null);
  const [pillPos, setPillPos] = useState<{ top: number; left: number } | null>(null);
  // 「まとめる」ピルを出す基準行＝最後にチェック操作した単元。下部バーへ往復せず、今クリックした真横ですぐまとめられるようにする。
  const [pillAnchorId, setPillAnchorId] = useState<number | null>(null);
  // 指導意図の一括設定メニュー（選択中の単元へまとめて適用。行ごとの個別クリックを無くす）
  const [intentMenuOpen, setIntentMenuOpen] = useState(false);
  const intentMenuRef = useRef<HTMLDivElement>(null);

  const [studentName, setStudentName] = useState('');
  const [studentSchoolId, setStudentSchoolId] = useState<string | null>(null);
  const [textbookName, setTextbookName] = useState('');
  const [textbookSubject, setTextbookSubject] = useState('');
  const [textbookGrade, setTextbookGrade] = useState('');

  const [previewMode, setPreviewMode] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showOrderAlert, setShowOrderAlert] = useState(false);

  // ひな形取り込み
  const [availableCourses, setAvailableCourses] = useState<SeasonalCourse[]>([]);
  const [showCourseImport, setShowCourseImport] = useState(false);
  const [importingCourse, setImportingCourse] = useState(false);

  // コースとして登録
  const [showPromoteConfirm, setShowPromoteConfirm] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [studentGrade, setStudentGrade] = useState<number | null>(null);

  const topRef = useRef<HTMLDivElement>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);

  useEffect(() => {
    const onScroll = () => setShowScrollTop(window.scrollY > 400);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // ── 初期読み込み ──
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // テキスト一覧・お気に入りは student/proposal に依存しないので先に起動し、
      // 下の student+proposal フェッチと並走させる（直列待ちを削減）。
      const textbooksPromise = getTextbooks();
      const favIdsPromise = getFavoriteTextbookIds().catch(() => null);

      const { data: student } = await supabase
        .from('students')
        .select('last_name, first_name, school_id, grade')
        .eq('id', studentId)
        .single();
      if (student) {
        setStudentName(`${student.last_name} ${student.first_name}`);
        setStudentSchoolId((student as { school_id: string }).school_id);
        setStudentGrade((student as { grade: number }).grade);
      }
      // ひな形の絞り込みに使う教室ID。state は非同期で同一実行内では使えないためローカルで保持。
      const schoolId = student ? (student as { school_id: string }).school_id : null;

      let tbId = selectedTextbookId;
      let stbId = studentTextbookId;
      // フェッチした提案書を関数スコープで保持して、後段のユニット復元で参照する。
      // React state の `proposal` をクロージャ越しに参照すると、setProposal(data) は
      // 非同期で同一実行コンテキスト内では古い値のままに見えるため、保存直後の遷移後に
      // koma_count が復元されず空のドラフトで UI が描画されてしまう。
      // 直後にもう一度保存を押すと空ユニットで DB が上書きされ、未設定表示と
      // 進捗集計欠落のデータ消失バグになっていた。
      let fetchedProposal: SeasonalProposalWithDetails | null = null;

      if (!isNew && proposalId) {
        const data = await getProposal(proposalId);
        if (!data) {
          addToast('提案書が見つかりません', 'error');
          return;
        }
        fetchedProposal = data;
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
        setTextbookGrade(((data.textbook as Record<string, unknown>)?.grade as string) ?? '');
      } else if (stbId) {
        const { data: stb } = await supabase
          .from('student_textbooks')
          .select('*, textbook:textbooks(*)')
          .eq('id', stbId)
          .single();

        if (stb) {
          const st = stb as Record<string, unknown>;
          const textbook = st.textbook as {
            id: number;
            name: string;
            subject?: string | null;
            grade?: string | null;
          } | null;
          tbId = textbook?.id ?? 0;
          setSelectedTextbookId(tbId);
          setTextbookName(textbook?.name ?? '');
          setTextbookSubject(textbook?.subject ?? '');
          setTextbookGrade(textbook?.grade ?? '');
        }
      } else if (tbId) {
        const { data: tb } = await supabase
          .from('textbooks')
          .select('name, subject, grade')
          .eq('id', tbId)
          .single();
        if (tb) {
          const t = tb as { name: string; subject: string | null; grade: string | null };
          setTextbookName(t.name);
          setTextbookSubject(t.subject ?? '');
          setTextbookGrade(t.grade ?? '');
        }
      }

      // 先頭で起動済みの並走フェッチを回収
      const textbooks = await textbooksPromise;
      setAllTextbooks(textbooks);

      // お気に入り集合（テキスト選択画面で上位表示用）。失敗しても通常動作は可能なので無視
      const favIds = await favIdsPromise;
      if (favIds) setFavoriteTextbookIds(favIds);

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
      let maxAppliedGroup = 0;
      for (const item of items) {
        drafts.set(item.id, {
          curriculum_item_id: item.id,
          koma_count: 0,
          applied_koma: 0,
          reason: '',
          selected: false,
          group_id: 0,
          applied_group_id: 0,
          intent_tag: null,
        });
      }

      if (!isNew && fetchedProposal) {
        // 保存済みデータの復元: koma_count / applied_koma / reason は復元するが、
        // selected（左チェックボックス）は意図的に false のままにする。
        // 「保存後はチェックボックスを空にしておきたい」というユーザー要望のため、
        // 保存状態の可視化は行のハイライト（isActive = koma_count > 0）で行い、
        // チェックボックスはシフトクリックなどの選択操作専用とする。
        for (const u of fetchedProposal.units) {
          const d = drafts.get(u.curriculum_item_id);
          if (d) {
            d.koma_count = u.koma_count;
            d.applied_koma = u.applied_koma ?? 0;
            d.reason = u.reason;
            d.group_id = u.group_id;
            d.applied_group_id = u.applied_group_id ?? 0;
            d.intent_tag = u.intent_tag ?? null;
            if (u.group_id > maxGroup) maxGroup = u.group_id;
            if ((u.applied_group_id ?? 0) > maxAppliedGroup)
              maxAppliedGroup = u.applied_group_id ?? 0;
          }
        }
      }

      setUnitDrafts(drafts);
      setNextGroupId(maxGroup + 1);
      setNextAppliedGroupId(maxAppliedGroup + 1);

      // このテキストを含む講習コースを取得
      try {
        const { data: courseTextbooks } = await supabase
          .from('seasonal_course_textbooks')
          .select('course_id')
          .eq('textbook_id', tbId);
        if (courseTextbooks && courseTextbooks.length > 0) {
          const courseIds = (courseTextbooks as { course_id: string }[]).map((ct) => ct.course_id);
          // 同名のひな形が複数教室に存在するため、この生徒の教室のものだけに絞る。
          // school_id で絞らないと他教室のコピーが重複表示されてしまう。
          let q = supabase
            .from('seasonal_courses')
            .select('id, name, season')
            .in('id', courseIds)
            .eq('is_active', true);
          if (schoolId) q = q.eq('school_id', schoolId);
          const { data: courses } = await q;
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

  // テキストのお気に入り切り替え。楽観的更新でクリック反応を即時にし、失敗時のみロールバック。
  const handleToggleFavoriteTextbook = async (textbookId: number) => {
    if (favoriteTogglePending === textbookId) return;
    const isFav = favoriteTextbookIds.has(textbookId);
    setFavoriteTogglePending(textbookId);
    // 楽観的更新
    setFavoriteTextbookIds((prev) => {
      const next = new Set(prev);
      if (isFav) next.delete(textbookId);
      else next.add(textbookId);
      return next;
    });
    try {
      if (isFav) await removeFavoriteTextbook(textbookId);
      else await addFavoriteTextbook(textbookId);
    } catch {
      // 失敗時はロールバック
      setFavoriteTextbookIds((prev) => {
        const next = new Set(prev);
        if (isFav) next.add(textbookId);
        else next.delete(textbookId);
        return next;
      });
      addToast('お気に入りの更新に失敗しました', 'error');
    } finally {
      setFavoriteTogglePending(null);
    }
  };

  const handleSelectTextbook = async (tb: Textbook) => {
    setSelectedTextbookId(tb.id);
    setTextbookName(tb.name);
    setTextbookSubject(tb.subject ?? '');
    setTextbookGrade(tb.grade ?? '');
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
        applied_group_id: 0,
        intent_tag: null,
      });
    }
    setUnitDrafts(drafts);
  };

  const lastToggleStateRef = useRef<boolean>(true);

  const toggleUnit = (ciId: number, shiftKey = false) => {
    if (shiftKey && lastToggleIdRef.current != null && lastToggleIdRef.current !== ciId) {
      const fromId = lastToggleIdRef.current;
      if (orderedIds.includes(fromId) && orderedIds.includes(ciId)) {
        const targetState = lastToggleStateRef.current;
        setUnitDrafts((prev) => setSelectionRange(prev, orderedIds, fromId, ciId, targetState));
        lastToggleIdRef.current = ciId;
        setPillAnchorId(ciId);
        return;
      }
    }
    const prev = unitDrafts.get(ciId);
    const newState = prev ? !prev.selected : true;
    lastToggleIdRef.current = ciId;
    lastToggleStateRef.current = newState;
    setPillAnchorId(ciId);
    setUnitDrafts((p) => {
      const next = new Map(p);
      const d = next.get(ciId);
      if (d) next.set(ciId, { ...d, selected: newState });
      return next;
    });
  };

  // ドラッグ範囲選択: 開始〜現在の連続行を、開始時のスナップショットを基準に塗り替える（ラバーバンド）
  const applyDragRange = (a: number, b: number, mode: boolean) => {
    const snap = dragSnapshotRef.current;
    setUnitDrafts((prev) => applyDragRangeTo(prev, orderedIds, a, b, mode, snap));
  };

  // チェックボックスを押した瞬間（ドラッグ開始）。Shift同時押しは従来の範囲トグルを維持。
  const startSelectDrag = (idx: number, shiftKey: boolean) => {
    const id = allItems[idx]?.id;
    if (id == null) return;
    if (shiftKey) {
      toggleUnit(id, true);
      return;
    }
    dragSnapshotRef.current = selectionSnapshot(unitDrafts);
    dragAnchorIdxRef.current = idx;
    const mode = !(unitDrafts.get(id)?.selected ?? false); // 未選択行から始めたら「選択」、選択済みなら「解除」
    dragModeRef.current = mode;
    lastToggleIdRef.current = id;
    lastToggleStateRef.current = mode;
    setPillAnchorId(id);
    draggingRef.current = true;
    setDragging(true);
    applyDragRange(idx, idx, mode);
  };

  // ドラッグ中に別の行へ入ったら範囲を伸縮。ピルは指を離した（＝最後になぞった）行の横へ追従させる。
  const onSelectEnter = (idx: number) => {
    if (dragAnchorIdxRef.current == null) return;
    applyDragRange(dragAnchorIdxRef.current, idx, dragModeRef.current);
    const id = allItems[idx]?.id;
    if (id != null) setPillAnchorId(id);
  };

  const clearSelection = () => {
    setUnitDrafts((prev) => clearSelectionIn(prev));
  };

  // 選択中の単元すべてに指導意図を一括設定。チェック→1回選ぶだけで済ませ、行ごとの個別クリックを無くす。
  // バルク編集の慣例にならい選択は維持（続けて別の意図に変えたり、グループ化もできる）。
  const applyIntentToSelected = (tag: IntentTag | null) => {
    let count = 0;
    setUnitDrafts((prev) => {
      const next = new Map(prev);
      next.forEach((d, id) => {
        if (d.selected) {
          count += 1;
          if (d.intent_tag !== tag) next.set(id, { ...d, intent_tag: tag });
        }
      });
      return next;
    });
    setIntentMenuOpen(false);
    if (count > 0) {
      addToast(
        tag ? `${count}単元に「${tag}」を設定` : `${count}単元の指導意図をクリア`,
        'success'
      );
    }
  };

  // メニュー外クリックで閉じる
  useEffect(() => {
    if (!intentMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (intentMenuRef.current && !intentMenuRef.current.contains(e.target as Node)) {
        setIntentMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [intentMenuOpen]);

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

      // 採番は updater の外で済ませる（updater は複数回呼ばれ得るため）。
      // 取り込みの規約（0コマの扱い・グループ番号の振り直し）は adapter 側に集約している。
      const { drafts, nextGroupId: newNextGroupId } = courseSettingsToDrafts(
        unitDrafts,
        settings,
        nextGroupId
      );
      setUnitDrafts(drafts);
      setNextGroupId(newNextGroupId);
      setShowCourseImport(false);
      addToast('ひな形を取り込みました', 'success');
    } catch (_e) {
      addToast('取り込みに失敗しました', 'error');
    } finally {
      setImportingCourse(false);
    }
  };

  /**
   * 選択中の単元をまとめる。提案結合(group_id)と申込結合(applied_group_id)は
   * 触る列が違うだけで操作は同じなので、種類を引数にして1本にしている。
   * 判定と片割れグループの解散は unitDraftLogic 側に持たせ、ここは採番とトーストだけ。
   */
  const groupSelectedBy = (kind: GroupKind) => {
    const label = kind === 'proposal' ? 'グループ化' : '申込結合';
    const gid = kind === 'proposal' ? nextGroupId : nextAppliedGroupId;
    const result = groupSelectedUnits(unitDrafts, orderedIds, gid, kind);
    if (!result.ok) {
      addToast(
        result.reason === 'too-few'
          ? `${label}には2つ以上の単元を選択してください`
          : `隣接する単元のみ${kind === 'proposal' ? 'グループ化' : '結合'}できます`,
        'error'
      );
      return;
    }
    // 採番は updater の外で行う（updater が複数回呼ばれてもIDが飛ばないように）
    if (kind === 'proposal') setNextGroupId(gid + 1);
    else setNextAppliedGroupId(gid + 1);
    setUnitDrafts(result.drafts);
  };

  const groupSelected = () => groupSelectedBy('proposal');
  const groupAppliedSelected = () => groupSelectedBy('applied');

  const ungroupUnit = (ciId: number) => {
    updateUnit(ciId, { group_id: 0 });
  };

  const ungroupAll = (groupId: number) => {
    setUnitDrafts((prev) => ungroupAllInGroup(prev, groupId, 'proposal'));
  };

  const ungroupAppliedUnit = (ciId: number) => {
    updateUnit(ciId, { applied_group_id: 0 });
  };

  const ungroupAllApplied = (groupId: number) => {
    setUnitDrafts((prev) => ungroupAllInGroup(prev, groupId, 'applied'));
  };

  // 提案コマ・申込コマのどちらかが入っていれば「有効な単元」。
  // 提案0でも申込のある単元（提案していないが取ったコマ）を保存・表示対象に含める。
  const activeUnits = useMemo(() => {
    return Array.from(unitDrafts.values()).filter((d) => d.koma_count > 0 || d.applied_koma > 0);
  }, [unitDrafts]);

  const totalKoma = useMemo(() => {
    return calcTotalKoma(activeUnits);
  }, [activeUnits]);

  const totalAppliedKoma = useMemo(() => {
    return calcTotalAppliedKoma(activeUnits);
  }, [activeUnits]);

  const groupMap = useMemo(() => buildGroupMap(activeUnits, 'proposal'), [activeUnits]);

  // 申込結合グループ（applied_group_id ごと）。申込コマのある単元のみ対象。
  const appliedGroupMap = useMemo(() => buildGroupMap(activeUnits, 'applied'), [activeUnits]);

  // 選択中の単元情報。フローティングボタン表示・隣接判定・Gキーで使う。
  // グループ化済みの単元も対象に含める（再選択して「まとめ直し」や指導意図の一括設定ができるように）。
  const selectionInfo = useMemo(
    () => getSelectionInfo(orderedIds, unitDrafts),
    [orderedIds, unitDrafts]
  );

  // ドラッグ中: どこで指を離しても選択を確定。ビューポート端では自動スクロール。
  // リスナは常設し draggingRef でガード（pointerdown直後の高速リリースでも取りこぼさない）。
  useEffect(() => {
    const endDrag = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      dragAnchorIdxRef.current = null;
      setDragging(false);
    };
    const onMove = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      const margin = 72;
      const speed = 14;
      if (e.clientY < margin) window.scrollBy(0, -speed);
      else if (e.clientY > window.innerHeight - margin) window.scrollBy(0, speed);
    };
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    window.addEventListener('pointermove', onMove);
    return () => {
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
      window.removeEventListener('pointermove', onMove);
    };
  }, []);

  // ピルを出す行のindex。最後に操作した行が選択中ならそこ、無効なら選択ブロック末尾行にフォールバック。
  const pillAnchorIdx = useMemo(() => {
    if (pillAnchorId != null) {
      const d = unitDrafts.get(pillAnchorId);
      if (d?.selected) {
        const idx = allItems.findIndex((i) => i.id === pillAnchorId);
        if (idx >= 0) return idx;
      }
    }
    return selectionInfo.lastIdx;
  }, [pillAnchorId, unitDrafts, allItems, selectionInfo.lastIdx]);

  // フローティング「まとめる」ピルの位置を、最後にチェックした行のチェックボックスの真横に合わせる（スクロール追従）。
  useEffect(() => {
    if (selectionInfo.count < 2 || pillAnchorIdx < 0) {
      setPillPos(null);
      return;
    }
    const update = () => {
      const cont = listRef.current;
      const el = cont?.querySelector(`[data-unit-idx="${pillAnchorIdx}"]`) as HTMLElement | null;
      if (!cont || !el) {
        setPillPos(null);
        return;
      }
      // 行内の先頭ボタン＝チェックボックス。その右隣・縦中央に出す。
      const checkbox = el.querySelector('button');
      const r = (checkbox ?? el).getBoundingClientRect();
      setPillPos({ top: r.top + r.height / 2, left: r.right + 8 });
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [selectionInfo.count, pillAnchorIdx]);

  // キーボード: G で選択中の隣接単元をまとめる / Esc で選択解除。入力中は無効。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if ((e.key === 'g' || e.key === 'G') && selectionInfo.contiguous) {
        e.preventDefault();
        groupSelected();
      } else if (e.key === 'Escape' && selectionInfo.count > 0) {
        clearSelection();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // groupSelected/clearSelection は選択変化で作り直されるため selectionInfo を依存に含めれば十分
  }, [selectionInfo.contiguous, selectionInfo.count]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    // 保存できない場合は理由を明示してユーザーに知らせる
    if (!theme.trim()) {
      addToast('テーマを入力してください', 'error');
      return;
    }
    if (!selectedTextbookId) {
      addToast('テキストを選択してください', 'error');
      return;
    }
    setSaving(true);
    try {
      // 申込コマの 0 の扱い: 提案済み/公開済みでは 0（＝申込なし）を確定値として保存する。
      // 下書き中のみ「未確定」を表す null にして、直接公開時に提案回数で初期化できるようにする。
      // （null のまま保存すると一括公開などで提案回数に巻き戻るため）
      const appliedFallback = isNew || proposal?.status === 'draft' ? null : 0;
      const unitInputs: ProposalUnitInput[] = activeUnits.map((u) => ({
        curriculum_item_id: u.curriculum_item_id,
        koma_count: u.koma_count,
        applied_koma: u.applied_koma > 0 ? u.applied_koma : appliedFallback,
        reason: u.reason,
        group_id: u.group_id,
        applied_group_id: u.applied_group_id,
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

      // 保存後はチェックボックスを空状態に戻す（要望）。
      // 保存内容は koma_count > 0 でハイライト表示されるため、選択状態をクリアしても可視性は保たれる。
      setUnitDrafts((prev) => {
        const next = new Map(prev);
        Array.from(next.entries()).forEach(([k, d]) => {
          if (d.selected) next.set(k, { ...d, selected: false });
        });
        return next;
      });

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

  // 保存できない理由（保存ボタン横に表示してユーザーに知らせる）
  const saveBlockers: string[] = [];
  if (!theme.trim()) saveBlockers.push('テーマを入力してください');
  if (!selectedTextbookId) saveBlockers.push('テキストを選択してください');

  const [statusChanging, setStatusChanging] = useState(false);
  // 公開後の教材発注ダイアログ（公開前に算出した候補スナップショット）
  const [orderDialog, setOrderDialog] = useState<OrderCandidate[] | null>(null);

  const handleStatusChange = async (newStatus: ProposalStatus) => {
    if (isNew || !proposalId || statusChanging) return;

    // 公開(approved)は教室長以上のみ許可。講師が直接呼び出した場合も弾く
    if (newStatus === 'approved' && !isManagerOrAbove) {
      addToast('公開は教室長以上のみ可能です', 'error');
      return;
    }

    // 下書きから直接公開は禁止（必ず「提案済み」を経由させる）。
    // 申込コマの確認・調整ステップを飛ばして進行表へ転記されるのを防ぐ。
    if (newStatus === 'approved' && proposal?.status === 'draft') {
      addToast('下書きからは直接公開できません。先に「提案済み」にしてください', 'error');
      return;
    }

    // 公開は確認ダイアログ
    if (newStatus === 'approved') {
      if (
        !window.confirm(
          '提案書を公開しますか？\n\n以下が実行されます:\n・申込コマ数が生徒の進行表に反映されます\n・テキストが進行表に表示されるようになります\n・講師ビューに公開されます'
        )
      )
        return;
    }

    setStatusChanging(true);
    try {
      if (newStatus === 'sent') {
        // 提案済みへ移行。
        // 下書き(draft)からの初回移行のみ、申込コマが未確定なので提案回数(koma_count)で初期化する。
        // 公開済み(approved)から提案済みに戻す場合は、ユーザーが確定した申込コマ数(0=申込なしを含む)を
        // そのまま保持する（初期化すると編集した申込コマが提案回数へ巻き戻ってしまうため）。
        // 申込結合(applied_group_id)は未設定なら提案結合(group_id)に合わせる
        // ——そうしないとグループ単元の申込コマが per-unit で二重計上され、申込>提案になる。
        const initializeApplied = proposal?.status !== 'approved';

        let working = unitDrafts;
        if (initializeApplied) {
          const updated = new Map(unitDrafts);
          Array.from(updated.entries()).forEach(([, d]) => {
            if (d.koma_count > 0) {
              updated.set(d.curriculum_item_id, {
                ...d,
                applied_koma: d.koma_count,
                applied_group_id: d.applied_group_id > 0 ? d.applied_group_id : d.group_id,
              });
            }
          });
          setUnitDrafts(updated);
          working = updated;
        }

        const unitInputs = Array.from(working.values())
          .filter((d) => d.koma_count > 0 || d.applied_koma > 0)
          .map((u) => ({
            curriculum_item_id: u.curriculum_item_id,
            koma_count: u.koma_count,
            applied_koma: initializeApplied
              ? u.koma_count > 0
                ? u.koma_count
                : u.applied_koma
              : u.applied_koma, // 公開済み→提案済み: 確定値(0含む)を保持
            reason: u.reason,
            group_id: u.group_id,
            applied_group_id: u.applied_group_id > 0 ? u.applied_group_id : u.group_id,
            intent_tag: u.intent_tag,
          }));
        await saveProposalUnits(proposalId, unitInputs);

        const totalApplied = calcTotalAppliedKoma(unitInputs);
        await updateProposal(proposalId, { status: newStatus, applied_koma: totalApplied });
      } else if (newStatus === 'approved') {
        // 公開: 未保存の申込コマ数を先に保存してから公開。
        // 提案済み(sent)からの公開では、ユーザーが確定した申込コマ数（0＝申込なしを含む）を
        // そのまま保存する。以前は applied_koma>0 でない単元を提案回数(koma_count)に戻していたため、
        // 申込を0や減らした単元が公開時に提案回数へ巻き戻る不具合があった。
        // 下書き(draft)から直接公開する場合のみ、申込が未確定なので提案回数で初期化する（従来どおり）。
        const publishingFromSent = proposal?.status === 'sent';
        const unitInputs = Array.from(unitDrafts.values())
          .filter((d) => d.koma_count > 0 || d.applied_koma > 0)
          .map((u) => ({
            curriculum_item_id: u.curriculum_item_id,
            koma_count: u.koma_count,
            applied_koma: publishingFromSent
              ? u.applied_koma
              : u.applied_koma > 0
                ? u.applied_koma
                : u.koma_count,
            reason: u.reason,
            group_id: u.group_id,
            applied_group_id: u.applied_group_id > 0 ? u.applied_group_id : u.group_id,
            intent_tag: u.intent_tag,
          }));
        await saveProposalUnits(proposalId, unitInputs);

        // 提案レベルの申込コマ合計も更新する。保存(handleSave)を経由せず編集後に直接公開した場合でも
        // 一覧などに表示される合計が古い値のまま（＝ロールバックして見える）にならないようにする。
        await updateProposal(proposalId, { applied_koma: calcTotalAppliedKoma(unitInputs) });

        // 公開前に発注候補をスナップショット（所持判定は is_draft=false 化の前に取る必要がある）
        let candidates: OrderCandidate[] = [];
        if (selectedTextbookId) {
          const tb = allTextbooks.find((t) => t.id === selectedTextbookId);
          try {
            candidates = await getProposalOrderCandidates([
              {
                proposalId,
                studentId,
                studentName,
                schoolId: studentSchoolId,
                textbookId: selectedTextbookId,
                textbookName:
                  [textbookSubject, textbookName].filter(Boolean).join(' ') || textbookName,
                materialId: tb?.material_id ?? null,
              },
            ]);
          } catch (e) {
            console.error('発注候補の取得に失敗:', e);
          }
        }

        await publishProposal(proposalId);

        // 発注が要りそうな候補があればダイアログを開く
        const relevant = candidates.filter(
          (c) => c.needsOrder || (!c.alreadyOwned && !c.materialId)
        );
        if (relevant.length > 0) setOrderDialog(candidates);
      } else if (newStatus === 'draft') {
        // 下書きに戻す: 申込コマ数は未確定に戻す（提案済で入れた申込を0クリア）。
        // 提案回数(koma_count)は保持し、再度提案済にした時に申込が再初期化される。
        const updated = new Map(unitDrafts);
        Array.from(updated.entries()).forEach(([, d]) => {
          updated.set(d.curriculum_item_id, { ...d, applied_koma: 0 });
        });
        setUnitDrafts(updated);

        const unitInputs = Array.from(updated.values())
          .filter((d) => d.koma_count > 0)
          .map((u) => ({
            curriculum_item_id: u.curriculum_item_id,
            koma_count: u.koma_count,
            applied_koma: 0,
            reason: u.reason,
            group_id: u.group_id,
            applied_group_id: u.applied_group_id,
            intent_tag: u.intent_tag,
          }));
        await saveProposalUnits(proposalId, unitInputs);
        await updateProposal(proposalId, { status: newStatus, applied_koma: 0 });
        // 公開を取り消して下書きに戻すので、紐付くテキストを進行表から外す
        // （未公開の提案を生徒の進行表に残さない）。所持・提案書本体には触れない。
        await clearProposalProgressTracking(proposalId);
      } else {
        await updateProposal(proposalId, { status: newStatus });
      }

      setProposal((prev) => (prev ? { ...prev, status: newStatus } : prev));
      addToast(`ステータスを「${PROPOSAL_STATUS_LABELS[newStatus]}」に変更しました`, 'success');
    } catch (_e) {
      addToast('ステータス変更に失敗しました', 'error');
    } finally {
      setStatusChanging(false);
    }
  };

  const handleDelete = async () => {
    if (isNew || !proposalId) return;
    // 削除は教室長以上のみ許可
    if (!isManagerOrAbove) return;
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
    return (
      <div className="p-8">
        <Loading size="md" />
      </div>
    );
  }

  const currentStatus = proposal?.status ?? 'draft';
  // 申込編集フェーズ: 提案済み/公開済みでは、行クリックで申込コマを足せるようにする
  // （提案していないが取ったコマを後から記録できる）。下書き中は従来どおり提案コマを足す。
  const appliedMode = currentStatus === 'sent' || currentStatus === 'approved';
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
          textbookName={[textbookGrade, textbookSubject, textbookName].filter(Boolean).join(' ')}
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
    // 絞り込みと並び順（お気に入り→教科→学年→名前）は講習テンプレートの編集画面と共有する
    const { schoolTypes, subjects, grades } = textbookFilterOptions(
      allTextbooks,
      tbFilterSchoolType || undefined
    );

    const filtered = filterAndSortTextbooks(
      allTextbooks,
      {
        schoolType: tbFilterSchoolType || undefined,
        subject: tbFilterSubject || undefined,
        grade: tbFilterGrade || undefined,
        search: textbookSearch || undefined,
      },
      favoriteTextbookIds
    );

    // お気に入りとそれ以外の境界 index（区切り線を入れるため）
    const favoriteEndIdx = filtered.findIndex((tb) => !favoriteTextbookIds.has(tb.id));

    return (
      <div>
        <div className="mb-6">
          <Link
            href={`/students/${studentId}/proposals`}
            className="text-sm text-text-muted hover:text-text-heading inline-flex items-center gap-1 mb-2 transition-[color] duration-150 ease-out"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            提案書一覧に戻る
          </Link>
          <h1 className="text-lg font-bold text-text-heading">テキストを選択</h1>
          <p className="text-sm text-text-muted mt-0.5">
            {studentName} の講習提案書{textbookSubject ? ` (${textbookSubject})` : ''}
          </p>
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
            onChange={(e) => {
              setTbFilterSchoolType(e.target.value);
              setTbFilterGrade('');
            }}
            className="px-2 py-1 border border-border-default rounded-lg text-xs bg-surface-raised text-text-body"
          >
            <option value="">学校種別</option>
            {schoolTypes.map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>
          <select
            value={tbFilterSubject}
            onChange={(e) => setTbFilterSubject(e.target.value)}
            className="px-2 py-1 border border-border-default rounded-lg text-xs bg-surface-raised text-text-body"
          >
            <option value="">教科</option>
            {subjects.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            value={tbFilterGrade}
            onChange={(e) => setTbFilterGrade(e.target.value)}
            className="px-2 py-1 border border-border-default rounded-lg text-xs bg-surface-raised text-text-body"
          >
            <option value="">学年</option>
            {grades.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
          {(tbFilterSchoolType || tbFilterSubject || tbFilterGrade) && (
            <button
              onClick={() => {
                setTbFilterSchoolType('');
                setTbFilterSubject('');
                setTbFilterGrade('');
              }}
              className="text-xs text-text-muted hover:text-text-heading transition-[color] duration-150 ease-out"
            >
              クリア
            </button>
          )}
          <span className="text-xs text-text-faint ml-auto">{filtered.length}件</span>
        </div>

        <div className="space-y-1 max-h-[60vh] overflow-y-auto">
          {filtered.map((tb, idx) => {
            const isFav = favoriteTextbookIds.has(tb.id);
            // お気に入り群の最後と通常群の境目に区切り線を出す（お気に入りが1件以上ありかつ非お気に入りも存在する場合のみ）
            const showDivider = favoriteEndIdx > 0 && idx === favoriteEndIdx;
            return (
              <div key={tb.id}>
                {showDivider && (
                  <div className="my-2 border-t border-border-subtle" aria-hidden="true" />
                )}
                <div className="relative">
                  <button
                    onClick={() => handleSelectTextbook(tb)}
                    className="w-full text-left pl-4 pr-12 py-3 bg-surface-raised rounded-lg border border-border-default hover:border-accent-ink/30 hover:bg-accent-ink-subtle active:scale-[0.99] transition-[background-color,border-color,transform] duration-150 ease-out"
                  >
                    <div className="flex items-center gap-1.5">
                      {tb.subject &&
                        (() => {
                          const c = SUBJECT_BADGE_COLORS[tb.subject] ?? DEFAULT_SUBJECT_BADGE;
                          return (
                            <span
                              className={`inline-flex px-1.5 py-0.5 text-[10px] font-bold rounded shrink-0 ${c.bg} ${c.text}`}
                            >
                              {tb.subject}
                            </span>
                          );
                        })()}
                      <span className="text-sm font-medium text-text-heading">{tb.name}</span>
                    </div>
                    <div className="text-xs text-text-muted mt-0.5">
                      {[tb.publisher, tb.grade].filter(Boolean).join(' / ')}
                    </div>
                  </button>
                  {/* お気に入りトグル。row 本体の onClick とは独立させたいので絶対配置の別ボタンにする */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleFavoriteTextbook(tb.id);
                    }}
                    disabled={favoriteTogglePending === tb.id}
                    aria-label={isFav ? 'お気に入りを解除' : 'お気に入りに追加'}
                    title={isFav ? 'お気に入りを解除' : 'お気に入りに追加'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md hover:bg-surface-hover active:scale-90 transition-[background-color,transform] duration-150 disabled:opacity-50"
                  >
                    <Star
                      className={`w-4 h-4 transition-colors duration-150 ${
                        isFav
                          ? 'fill-amber-400 text-amber-400'
                          : 'text-text-faint hover:text-amber-400'
                      }`}
                    />
                  </button>
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="py-8 text-center text-sm text-text-faint">
              該当するテキストがありません
            </div>
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
    <div className="pb-20" ref={topRef}>
      {/* ヘッダー */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <Link
            href="/courses/proposals"
            className="text-sm text-text-muted hover:text-text-heading inline-flex items-center gap-1 transition-[color] duration-150 ease-out"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            提案書一覧（全体）
          </Link>
          <span className="w-px h-3.5 bg-border-default" />
          <Link
            href={`/students/${studentId}/proposals`}
            className="text-sm text-text-muted hover:text-text-heading inline-flex items-center gap-1 transition-[color] duration-150 ease-out"
          >
            <FileText className="w-3.5 h-3.5" />
            この生徒の他の提案書
          </Link>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-text-heading">
              {isNew ? '講習提案書を作成' : '講習提案書を編集'}
            </h1>
            <p className="text-sm text-text-muted mt-0.5">
              {studentName} /{' '}
              {[textbookGrade, textbookSubject, textbookName].filter(Boolean).join(' ')} / {year}年{' '}
              {seasonLabel}講習
            </p>
          </div>

          {!isNew && (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1 rounded-full bg-surface-hover/60 p-1">
                <span className="pl-2 pr-1 text-[10px] font-medium text-text-faint">状態</span>
                {STATUS_FLOW.map((s) => {
                  const isCurrent = currentStatus === s;
                  // approved への変更は教室長以上のみ操作可能
                  const isApprovedRestricted = s === 'approved' && !isManagerOrAbove;
                  // 下書きからは直接公開不可（提案済みを経由させる）
                  const isApprovedFromDraft = s === 'approved' && currentStatus === 'draft';
                  return (
                    <button
                      key={s}
                      onClick={() => handleStatusChange(s)}
                      disabled={statusChanging || isApprovedRestricted || isApprovedFromDraft}
                      title={
                        isApprovedRestricted
                          ? '公開は教室長以上のみ可能です'
                          : isApprovedFromDraft
                            ? '下書きからは直接公開できません。先に「提案済み」にしてください'
                            : undefined
                      }
                      aria-pressed={isCurrent}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded-full active:scale-95 transition-[background-color,color,box-shadow,transform] duration-150 ease-out disabled:opacity-40 disabled:cursor-not-allowed ${
                        isCurrent ? STATUS_COLORS[s].active : STATUS_INACTIVE
                      }`}
                    >
                      {isCurrent && <Check className="w-3 h-3" strokeWidth={3} />}
                      {statusChanging && s === currentStatus ? '...' : PROPOSAL_STATUS_LABELS[s]}
                    </button>
                  );
                })}
              </div>
              {/* 削除ボタン: 教室長以上のみ表示 */}
              {isManagerOrAbove && (
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="p-1.5 text-text-faint hover:text-danger rounded-lg hover:bg-surface-hover transition-[background-color,color] duration-150 ease-out"
                  title="削除"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
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
              <div className="text-sm font-medium text-text-heading">
                {[textbookGrade, textbookSubject, textbookName].filter(Boolean).join(' ')}
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setShowTextbookPicker(true)}>
              変更
            </Button>
          </section>
        )}

        {/* テーマ */}
        <section className="p-4 bg-surface-raised rounded-xl border border-border-default">
          <label className="text-sm font-bold text-text-heading block mb-2">
            講習テーマ
            <span className="ml-1 text-red-600" aria-hidden="true">
              *
            </span>
            <span className="ml-1.5 align-middle text-[10px] font-bold text-red-600">必須</span>
          </label>
          <input
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            aria-required="true"
            className={`w-full px-3 py-2 text-sm border rounded-lg bg-surface-raised focus:ring-2 focus:ring-primary/20 focus:border-primary ${
              theme.trim() ? 'border-border-default' : 'border-red-300'
            }`}
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
                      <div
                        className="fixed inset-0 z-10"
                        onClick={() => setShowCourseImport(false)}
                      />
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
              <div className="text-sm font-bold">
                <span className="text-accent-ink">
                  {activeUnits.length}単元 / {totalKoma}コマ
                </span>
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

          <div ref={listRef} className={`space-y-1 ${dragging ? 'select-none' : ''}`}>
            {allItems.map((item, idx) => {
              const draft = unitDrafts.get(item.id);
              if (!draft) return null;
              const done = isDone(item.id);
              const groupMembers = draft.group_id > 0 ? groupMap.get(draft.group_id) : undefined;
              const appliedGroupMembers =
                draft.applied_group_id > 0
                  ? appliedGroupMap.get(draft.applied_group_id)
                  : undefined;

              return (
                <UnitRow
                  key={item.id}
                  index={idx}
                  item={item}
                  draft={draft}
                  done={done}
                  appliedMode={appliedMode}
                  groupMembers={groupMembers}
                  appliedGroupMembers={appliedGroupMembers}
                  onToggle={(shiftKey) => toggleUnit(item.id, shiftKey)}
                  onSelectStart={(shiftKey) => startSelectDrag(idx, shiftKey)}
                  onSelectEnter={() => onSelectEnter(idx)}
                  onUpdate={(patch) => updateUnit(item.id, patch)}
                  onUngroup={() => ungroupUnit(item.id)}
                  onUngroupAll={() => draft.group_id > 0 && ungroupAll(draft.group_id)}
                  onUngroupApplied={() => ungroupAppliedUnit(item.id)}
                  onUngroupAllApplied={() =>
                    draft.applied_group_id > 0 && ungroupAllApplied(draft.applied_group_id)
                  }
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
      </div>

      {/* 選択脇のフローティング「まとめる」ピル。最後にチェックした行のチェックボックスの真横（縦中央）に出し、下部バーへの往復をなくす。 */}
      {/* ドラッグ中はピルがポインタ操作を奪わないよう pointer-events を切る。 */}
      {pillPos && selectionInfo.count >= 2 && (
        <div
          className={`fixed z-40 -translate-y-1/2 print:hidden flex items-center gap-1.5 ${dragging ? 'pointer-events-none' : ''}`}
          style={{ top: pillPos.top, left: pillPos.left }}
        >
          {selectionInfo.contiguous ? (
            <button
              type="button"
              onClick={groupSelected}
              className="flex items-center gap-1.5 rounded-full bg-primary text-white text-xs font-bold pl-3 pr-2.5 py-1.5 shadow-lg ring-1 ring-black/5 hover:bg-primary/90 active:scale-95 transition-[transform,background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] origin-left animate-[popover-enter_150ms_cubic-bezier(0.23,1,0.32,1)]"
            >
              <Link2 className="w-3.5 h-3.5" />
              {selectionInfo.count}単元をまとめる
              <kbd className="ml-0.5 rounded bg-white/20 px-1 text-[10px] font-semibold leading-tight">
                G
              </kbd>
            </button>
          ) : (
            <div className="flex items-center gap-1.5 rounded-full bg-surface-raised text-text-muted text-[11px] font-medium px-3 py-1.5 shadow-lg ring-1 ring-border-default origin-left animate-[popover-enter_150ms_cubic-bezier(0.23,1,0.32,1)]">
              隣接する単元のみまとめられます
            </div>
          )}

          {/* 申込編集フェーズ（提案済み/公開済み）では「申込結合」も提示。提案結合とは別系統で申込コマを1コマにまとめる。 */}
          {appliedMode && selectionInfo.contiguous && (
            <button
              type="button"
              onClick={groupAppliedSelected}
              className="flex items-center gap-1.5 rounded-full bg-success text-white text-xs font-bold pl-3 pr-3 py-1.5 shadow-lg ring-1 ring-black/5 hover:bg-success/90 active:scale-95 transition-[transform,background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] origin-left animate-[popover-enter_150ms_cubic-bezier(0.23,1,0.32,1)]"
              title="選択中の単元を申込1コマにまとめる（提案結合とは別）"
            >
              <Link2 className="w-3.5 h-3.5" />
              申込結合
            </button>
          )}

          {/* グループ化ピルの隣に「指導意図」一括設定。選択した場所のすぐ横でまとめて設定できる。 */}
          <div className="relative" ref={intentMenuRef}>
            <button
              type="button"
              onClick={() => setIntentMenuOpen((o) => !o)}
              className="flex items-center gap-1 rounded-full bg-surface-raised text-text-body text-xs font-medium pl-2.5 pr-2 py-1.5 shadow-lg ring-1 ring-border-default hover:bg-surface-hover active:scale-95 transition-[transform,background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] origin-left animate-[popover-enter_150ms_cubic-bezier(0.23,1,0.32,1)]"
              title="選択中の単元へ指導意図を一括設定"
            >
              <Tag className="w-3.5 h-3.5" />
              指導意図
              {intentMenuOpen ? (
                <ChevronUp className="w-3 h-3" />
              ) : (
                <ChevronDown className="w-3 h-3" />
              )}
            </button>
            {intentMenuOpen && (
              <div className="absolute top-full left-0 mt-2 w-56 p-2 bg-surface-raised border border-border-default rounded-xl shadow-lg origin-top-left animate-[popover-enter_150ms_cubic-bezier(0.23,1,0.32,1)]">
                <div className="px-1 pb-1.5 text-[10px] font-bold text-text-faint">
                  選択中の{selectionInfo.count}単元に設定
                </div>
                <div className="flex flex-wrap gap-1">
                  {INTENT_TAGS.map((tag) => (
                    <button
                      key={tag}
                      onClick={() => applyIntentToSelected(tag)}
                      className={`px-1.5 py-0.5 text-[10px] font-medium border rounded-full bg-white border-current hover:brightness-95 active:scale-95 transition-[transform,filter] duration-100 ease-out ${INTENT_TAG_COLOR[tag]}`}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => applyIntentToSelected(null)}
                  className="mt-1.5 w-full text-left px-1.5 py-1 text-[10px] text-text-faint hover:text-text-muted rounded transition-[color] duration-100"
                >
                  指導意図をクリア
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* スティッキーボトムバー（コンテンツ幅 max-w-[1600px] に合わせる） */}
      <div className="fixed bottom-0 left-0 right-0 z-30 bg-surface-raised/95 backdrop-blur-sm border-t border-border-default print:hidden">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-2.5 flex items-center gap-3">
          <div className="text-xs font-bold text-text-muted shrink-0">
            <span className="text-accent-ink">
              {activeUnits.length}単元 / {totalKoma}コマ
            </span>
            {totalAppliedKoma != null && totalAppliedKoma > 0 && (
              <span className="text-info ml-2">申込 {totalAppliedKoma}</span>
            )}
          </div>
          <div className="flex-1" />
          {selectionInfo.count > 0 && (
            <span className="text-[11px] font-medium text-text-muted shrink-0">
              {selectionInfo.count}単元 選択中
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={groupSelected}
            disabled={!selectionInfo.contiguous}
            title="選択中の単元を1コマにまとめる（グループ化済みは新しいグループで上書き / ショートカット: G）"
          >
            <Link2 className="w-3.5 h-3.5 mr-1" />
            グループ化
          </Button>
          {/* 申込編集フェーズでは申込専用の結合も可能（提案結合とは別系統） */}
          {appliedMode && (
            <Button
              variant="outline"
              size="sm"
              onClick={groupAppliedSelected}
              disabled={!selectionInfo.contiguous}
              title="選択中の単元を申込1コマにまとめる（提案結合とは独立）"
            >
              <Link2 className="w-3.5 h-3.5 mr-1 text-success" />
              申込結合
            </Button>
          )}
          {/* 講習に登録ボタン: 教室長以上のみ表示 */}
          {!isNew && proposal && isManagerOrAbove && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowPromoteConfirm(true)}
              disabled={promoting || !theme.trim() || !selectedTextbookId}
            >
              <BookPlus className="w-3.5 h-3.5 mr-1" />
              講習に登録
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setPreviewMode(true)}>
            <Printer className="w-3.5 h-3.5 mr-1" />
            プレビュー
          </Button>
          <div className="flex flex-col items-end gap-1">
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving || saveBlockers.length > 0}
              isLoading={saving}
              title={saveBlockers.length > 0 ? saveBlockers.join(' / ') : undefined}
            >
              <Save className="w-3.5 h-3.5 mr-1" />
              保存
            </Button>
            {/* 保存できない理由を明示（ボタンが disabled でも理由が分かるようにする） */}
            {saveBlockers.length > 0 && (
              <p className="text-[11px] font-medium text-red-600 text-right leading-tight">
                {saveBlockers.join(' / ')}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* トップに戻るボタン */}
      {showScrollTop && (
        <button
          onClick={() => topRef.current?.scrollIntoView({ behavior: 'smooth' })}
          className="fixed bottom-16 right-4 z-30 w-10 h-10 bg-ink text-text-on-primary rounded-full shadow-lg flex items-center justify-center hover:brightness-[0.85] active:scale-90 transition-[filter,transform] duration-150 print:hidden"
          aria-label="トップに戻る"
        >
          <ArrowUp className="w-5 h-5" />
        </button>
      )}

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

      {/* コースとして登録確認 */}
      <AlertDialog open={showPromoteConfirm} onOpenChange={setShowPromoteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <BookPlus className="w-5 h-5 text-primary" />
              講習一覧に登録しますか？
            </AlertDialogTitle>
            <AlertDialogDescription>
              この提案書の内容をもとに講習一覧にコースを作成します。作成後は他の生徒にも展開できます。
            </AlertDialogDescription>
            <div className="mt-2 bg-surface-hover rounded-lg p-3 space-y-1 text-sm">
              <p>
                <span className="text-text-muted">コース名:</span> {theme}
              </p>
              <p>
                <span className="text-text-muted">テキスト:</span>{' '}
                {[textbookGrade, textbookSubject, textbookName].filter(Boolean).join(' ')}
              </p>
              <p>
                <span className="text-text-muted">対象学年:</span>{' '}
                {studentGrade ? (GRADE_LABELS[studentGrade] ?? `学年${studentGrade}`) : '不明'}
              </p>
              <p>
                <span className="text-text-muted">内容:</span> {activeUnits.length}単元 /{' '}
                {totalKoma}コマ
              </p>
            </div>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setShowPromoteConfirm(false)}>
              キャンセル
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={promoting}
              onClick={async () => {
                // 講習登録は教室長以上のみ許可
                if (!isManagerOrAbove) return;
                setPromoting(true);
                try {
                  await handleSave();
                  const { courseId } = await promoteProposalToCourse(proposalId);
                  addToast('講習一覧に登録しました', 'success');
                  setShowPromoteConfirm(false);
                  router.push(`/courses/${courseId}`);
                } catch (err) {
                  addToast(err instanceof Error ? err.message : '登録に失敗しました', 'error');
                } finally {
                  setPromoting(false);
                }
              }}
            >
              {promoting ? '登録中...' : '登録する'}
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
              {studentName} さんの進行表に「{textbookSubject ? `${textbookSubject} ` : ''}
              {textbookName}」を新しく追加しました。テキストの発注を忘れずに行ってください。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setShowOrderAlert(false)}>
              確認しました
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 公開後の教材発注ダイアログ */}
      {orderDialog && (
        <PublishOrderDialog candidates={orderDialog} onClose={() => setOrderDialog(null)} />
      )}

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}
