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
  Unlink,
  Minus,
  PackageOpen,
  X,
  Plus,
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

interface UnitDraft {
  curriculum_item_id: number;
  koma_count: number;
  applied_koma: number;
  reason: string;
  selected: boolean;
  group_id: number;
  // 申込専用の結合グループ（提案結合 group_id とは独立）
  applied_group_id: number;
  intent_tag: string | null;
}

const INTENT_TAGS = [
  '予習',
  '復習',
  '苦手克服',
  '苦手補強',
  '定着',
  '直前演習',
  '応用発展',
] as const;
type IntentTag = typeof INTENT_TAGS[number];

const INTENT_TAG_COLOR: Record<IntentTag, string> = {
  '予習': 'text-purple-700 border-purple-200',
  '復習': 'text-blue-700 border-blue-200',
  '苦手克服': 'text-rose-700 border-rose-200',
  '苦手補強': 'text-red-700 border-red-200',
  '定着': 'text-emerald-700 border-emerald-200',
  '直前演習': 'text-amber-700 border-amber-200',
  '応用発展': 'text-indigo-700 border-indigo-200',
};

const STATUS_FLOW: ProposalStatus[] = ['draft', 'sent', 'approved'];

const GROUP_COLORS = [
  'border-l-blue-500',
  'border-l-purple-500',
  'border-l-amber-500',
  'border-l-emerald-500',
  'border-l-rose-500',
  'border-l-cyan-500',
];

const _GROUP_BG_COLORS = [
  'bg-blue-500',
  'bg-purple-500',
  'bg-amber-500',
  'bg-emerald-500',
  'bg-rose-500',
  'bg-cyan-500',
];

const GROUP_TEXT_COLORS = [
  'text-blue-600',
  'text-purple-600',
  'text-amber-600',
  'text-emerald-600',
  'text-rose-600',
  'text-cyan-600',
];

const GROUP_CIRCLE_NUMS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];

const GROUP_BG = [
  'bg-blue-50',
  'bg-purple-50',
  'bg-amber-50',
  'bg-emerald-50',
  'bg-rose-50',
  'bg-cyan-50',
];

// アクティブ（現在の状態）のみ塗りつぶし＋リング＋チェックで強調。
// 非アクティブは色を持たないゴースト表示にして「今どれが選択中か」を一目で分かるようにする。
const STATUS_COLORS: Record<string, { active: string }> = {
  draft: { active: 'bg-text-muted text-white ring-2 ring-text-muted/30' },
  sent: { active: 'bg-info text-white ring-2 ring-info/30' },
  approved: { active: 'bg-emerald-600 text-white ring-2 ring-emerald-600/30' },
};
const STATUS_INACTIVE = 'bg-transparent text-text-faint border border-border-default hover:bg-surface-hover hover:text-text-muted';

// 科目バッジ配色（提案書一覧・講習一覧と統一）
const SUBJECT_BADGE_COLORS: Record<string, { bg: string; text: string }> = {
  '英語': { bg: 'bg-blue-50', text: 'text-blue-700' },
  '数学': { bg: 'bg-red-50', text: 'text-red-700' },
  '算数': { bg: 'bg-red-50', text: 'text-red-700' },
  '国語': { bg: 'bg-green-50', text: 'text-green-700' },
  '理科': { bg: 'bg-amber-50', text: 'text-amber-700' },
  '社会': { bg: 'bg-purple-50', text: 'text-purple-700' },
};
const DEFAULT_SUBJECT_BADGE = { bg: 'bg-gray-100', text: 'text-gray-600' };

export default function ProposalEditor() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { toasts, addToast, removeToast } = useToast();
  const { profile } = useAuth();
  // 公開・削除・講習登録は教室長以上(manager/owner/admin)のみ許可
  const isManagerOrAbove =
    profile?.role === 'manager' ||
    profile?.role === 'owner' ||
    profile?.role === 'admin';

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
        setTextbookGrade((data.textbook as Record<string, unknown>)?.grade as string ?? '');
      } else if (stbId) {
        const { data: stb } = await supabase
          .from('student_textbooks')
          .select('*, textbook:textbooks(*)')
          .eq('id', stbId)
          .single();

        if (stb) {
          const st = stb as Record<string, unknown>;
          const textbook = st.textbook as { id: number; name: string; subject?: string | null; grade?: string | null } | null;
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
            if ((u.applied_group_id ?? 0) > maxAppliedGroup) maxAppliedGroup = u.applied_group_id ?? 0;
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
      const startIdx = allItems.findIndex((i) => i.id === lastToggleIdRef.current);
      const endIdx = allItems.findIndex((i) => i.id === ciId);
      if (startIdx >= 0 && endIdx >= 0) {
        const [lo, hi] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
        const targetState = lastToggleStateRef.current;
        setUnitDrafts((prev) => {
          const next = new Map(prev);
          for (let idx = lo; idx <= hi; idx++) {
            const id = allItems[idx].id;
            const d = next.get(id);
            if (d && d.selected !== targetState) next.set(id, { ...d, selected: targetState });
          }
          return next;
        });
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
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    const snap = dragSnapshotRef.current;
    setUnitDrafts((prev) => {
      const next = new Map(prev);
      allItems.forEach((it, idx) => {
        const d = next.get(it.id);
        if (!d) return;
        // 範囲内は mode（選択/解除）、範囲外はドラッグ開始時の状態に戻す
        const sel = idx >= lo && idx <= hi ? mode : snap.has(it.id);
        if (d.selected !== sel) next.set(it.id, { ...d, selected: sel });
      });
      return next;
    });
  };

  // チェックボックスを押した瞬間（ドラッグ開始）。Shift同時押しは従来の範囲トグルを維持。
  const startSelectDrag = (idx: number, shiftKey: boolean) => {
    const id = allItems[idx]?.id;
    if (id == null) return;
    if (shiftKey) {
      toggleUnit(id, true);
      return;
    }
    const snap = new Set<number>();
    unitDrafts.forEach((d, did) => {
      if (d.selected) snap.add(did);
    });
    dragSnapshotRef.current = snap;
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
    setUnitDrafts((prev) => {
      const next = new Map(prev);
      let changed = false;
      next.forEach((d, id) => {
        if (d.selected) {
          next.set(id, { ...d, selected: false });
          changed = true;
        }
      });
      return changed ? next : prev;
    });
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
      addToast(tag ? `${count}単元に「${tag}」を設定` : `${count}単元の指導意図をクリア`, 'success');
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

      // group_number → 新しい group_id のマッピングを事前に割り当てる
      // （setUnitDrafts の updater は複数回呼ばれ得るため、採番の副作用を外に出す）。
      let maxGroup = nextGroupId;
      const groupRemap = new Map<number, number>();
      for (const s of settings) {
        const g = s.group_number;
        if (g != null && g > 0 && !groupRemap.has(g)) {
          groupRemap.set(g, maxGroup);
          maxGroup++;
        }
      }

      setUnitDrafts((prev) => {
        const next = new Map(prev);
        for (const s of settings) {
          const inGroup = s.group_number != null && s.group_number > 0;
          // 未グループかつ0コマの単元だけスキップ。グループ内の単元は0コマでも取り込む
          // ——捨てるとグループの片割れが欠けてグループが崩れる（取り込み時にグループ化が
          // 効かない不具合の原因だった）。
          if (s.proposal_count <= 0 && !inGroup) continue;
          const d = next.get(s.curriculum_item_id);
          if (!d) continue;

          const newGroupId = inGroup ? groupRemap.get(s.group_number!)! : 0;

          next.set(s.curriculum_item_id, {
            ...d,
            // グループ内は0コマでも1コマ扱いにして有効化（groupSelected と同じ挙動）。
            // グループ全体は calcTotalKoma で1回だけ計上されるため合計は増えない。
            koma_count: inGroup ? (s.proposal_count || 1) : s.proposal_count,
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
    // グループ化済みの単元も選択していれば対象に含め、新しいグループで「上書き」する。
    // （一度まとめた範囲を再チェック→まとめ直す運用に対応）
    const selected = Array.from(unitDrafts.values()).filter((d) => d.selected);
    if (selected.length < 2) {
      addToast('グループ化には2つ以上の単元を選択してください', 'error');
      return;
    }
    const selectedSet = new Set(selected.map((d) => d.curriculum_item_id));
    const indices = allItems
      .map((item, idx) => selectedSet.has(item.id) ? idx : -1)
      .filter((i) => i >= 0);
    for (let i = 1; i < indices.length; i++) {
      if (indices[i] !== indices[i - 1] + 1) {
        addToast('隣接する単元のみグループ化できます', 'error');
        return;
      }
    }
    const gid = nextGroupId;
    setNextGroupId(gid + 1);
    setUnitDrafts((prev) => {
      const next = new Map(prev);
      // 上書き前のグループID（再グループ対象が抜けた後に1件だけ残るグループは解散する）
      const affectedGroupIds = new Set(selected.map((d) => d.group_id).filter((g) => g > 0));
      for (const s of selected) {
        const d = next.get(s.curriculum_item_id);
        if (d) next.set(s.curriculum_item_id, {
          ...d,
          group_id: gid,
          koma_count: d.koma_count || 1,
          selected: false,
        });
      }
      // 上書きで片割れだけ残ったグループ（メンバー1件）は単独グループになってしまうため解散
      for (const oldGid of Array.from(affectedGroupIds)) {
        const remaining = Array.from(next.values()).filter((d) => d.group_id === oldGid);
        if (remaining.length === 1) {
          const lone = remaining[0];
          next.set(lone.curriculum_item_id, { ...lone, group_id: 0 });
        }
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

  // 申込結合: 選択中の隣接単元を applied_group_id でまとめる（申込コマは合計表示で1コマ扱い）。
  // 提案結合(groupSelected)と同じ操作系だが、申込側の結合だけを更新する。
  const groupAppliedSelected = () => {
    const selected = Array.from(unitDrafts.values()).filter((d) => d.selected);
    if (selected.length < 2) {
      addToast('申込結合には2つ以上の単元を選択してください', 'error');
      return;
    }
    const selectedSet = new Set(selected.map((d) => d.curriculum_item_id));
    const indices = allItems
      .map((item, idx) => selectedSet.has(item.id) ? idx : -1)
      .filter((i) => i >= 0);
    for (let i = 1; i < indices.length; i++) {
      if (indices[i] !== indices[i - 1] + 1) {
        addToast('隣接する単元のみ結合できます', 'error');
        return;
      }
    }
    const gid = nextAppliedGroupId;
    setNextAppliedGroupId(gid + 1);
    setUnitDrafts((prev) => {
      const next = new Map(prev);
      const affectedGroupIds = new Set(selected.map((d) => d.applied_group_id).filter((g) => g > 0));
      for (const s of selected) {
        const d = next.get(s.curriculum_item_id);
        // 申込コマが未入力の単元も結合対象なら申込1で有効化（合計は head 1件のみ計上）
        if (d) next.set(s.curriculum_item_id, {
          ...d,
          applied_group_id: gid,
          applied_koma: d.applied_koma || 1,
          selected: false,
        });
      }
      // 片割れ1件だけ残った申込グループは解散
      for (const oldGid of Array.from(affectedGroupIds)) {
        const remaining = Array.from(next.values()).filter((d) => d.applied_group_id === oldGid);
        if (remaining.length === 1) {
          const lone = remaining[0];
          next.set(lone.curriculum_item_id, { ...lone, applied_group_id: 0 });
        }
      }
      return next;
    });
  };

  const ungroupAppliedUnit = (ciId: number) => {
    updateUnit(ciId, { applied_group_id: 0 });
  };

  const ungroupAllApplied = (groupId: number) => {
    setUnitDrafts((prev) => {
      const next = new Map(prev);
      Array.from(next.entries()).forEach(([key, d]) => {
        if (d.applied_group_id === groupId) {
          next.set(key, { ...d, applied_group_id: 0 });
        }
      });
      return next;
    });
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

  // 申込結合グループ（applied_group_id ごと）。申込コマのある単元のみ対象。
  const appliedGroupMap = useMemo(() => {
    const map = new Map<number, UnitDraft[]>();
    for (const u of activeUnits) {
      if (u.applied_group_id === 0 || u.applied_koma <= 0) continue;
      const list = map.get(u.applied_group_id) ?? [];
      list.push(u);
      map.set(u.applied_group_id, list);
    }
    return map;
  }, [activeUnits]);

  // 選択中の単元情報。フローティングボタン表示・隣接判定・Gキーで使う。
  // グループ化済みの単元も対象に含める（再選択して「まとめ直し」や指導意図の一括設定ができるように）。
  const selectionInfo = useMemo(() => {
    const indices: number[] = [];
    allItems.forEach((it, idx) => {
      const d = unitDrafts.get(it.id);
      if (d?.selected) indices.push(idx);
    });
    const count = indices.length;
    let contiguous = count >= 2;
    for (let i = 1; i < indices.length; i++) {
      if (indices[i] !== indices[i - 1] + 1) contiguous = false;
    }
    return {
      count,
      contiguous,
      firstIdx: indices[0] ?? -1,
      lastIdx: indices[indices.length - 1] ?? -1,
    };
  }, [allItems, unitDrafts]);

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
      const el = cont?.querySelector(
        `[data-unit-idx="${pillAnchorIdx}"]`
      ) as HTMLElement | null;
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
      const unitInputs: ProposalUnitInput[] = activeUnits.map((u) => ({
        curriculum_item_id: u.curriculum_item_id,
        koma_count: u.koma_count,
        applied_koma: u.applied_koma > 0 ? u.applied_koma : null,
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

    // 公開は確認ダイアログ
    if (newStatus === 'approved') {
      if (!window.confirm('提案書を公開しますか？\n\n以下が実行されます:\n・申込コマ数が生徒の進行表に反映されます\n・テキストが進行表に表示されるようになります\n・講師ビューに公開されます')) return;
    }

    setStatusChanging(true);
    try {
      if (newStatus === 'sent') {
        // 提案済み: applied_koma を koma_count で初期化。
        // 申込結合(applied_group_id)は未設定なら提案結合(group_id)に合わせる
        // ——そうしないとグループ単元の申込コマが per-unit で二重計上され、申込>提案になる。
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

        const unitInputs = Array.from(updated.values())
          .filter((d) => d.koma_count > 0 || d.applied_koma > 0)
          .map((u) => ({
            curriculum_item_id: u.curriculum_item_id,
            koma_count: u.koma_count,
            applied_koma: u.koma_count > 0 ? u.koma_count : u.applied_koma,
            reason: u.reason,
            group_id: u.group_id,
            applied_group_id: u.applied_group_id > 0 ? u.applied_group_id : u.group_id,
            intent_tag: u.intent_tag,
          }));
        await saveProposalUnits(proposalId, unitInputs);

        const totalApplied = calcTotalAppliedKoma(unitInputs);
        await updateProposal(proposalId, { status: newStatus, applied_koma: totalApplied });
      } else if (newStatus === 'approved') {
        // 公開: 未保存の申込コマ数を先に保存してから公開
        // 下書きから直接公開した場合、申込が未確定(0)なら提案回数(koma_count)で初期化する
        const unitInputs = Array.from(unitDrafts.values())
          .filter((d) => d.koma_count > 0 || d.applied_koma > 0)
          .map((u) => ({
            curriculum_item_id: u.curriculum_item_id,
            koma_count: u.koma_count,
            applied_koma: u.applied_koma > 0 ? u.applied_koma : u.koma_count,
            reason: u.reason,
            group_id: u.group_id,
            applied_group_id: u.applied_group_id > 0 ? u.applied_group_id : u.group_id,
            intent_tag: u.intent_tag,
          }));
        await saveProposalUnits(proposalId, unitInputs);

        // 公開前に発注候補をスナップショット（所持判定は is_draft=false 化の前に取る必要がある）
        let candidates: OrderCandidate[] = [];
        if (selectedTextbookId) {
          const tb = allTextbooks.find((t) => t.id === selectedTextbookId);
          try {
            candidates = await getProposalOrderCandidates([{
              proposalId,
              studentId,
              studentName,
              schoolId: studentSchoolId,
              textbookId: selectedTextbookId,
              textbookName: [textbookSubject, textbookName].filter(Boolean).join(' ') || textbookName,
              materialId: tb?.material_id ?? null,
            }]);
          } catch (e) {
            console.error('発注候補の取得に失敗:', e);
          }
        }

        await publishProposal(proposalId);

        // 発注が要りそうな候補があればダイアログを開く
        const relevant = candidates.filter((c) => c.needsOrder || (!c.alreadyOwned && !c.materialId));
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
    return <div className="p-8"><Loading size="md" /></div>;
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
        // お気に入りを最優先で上位表示。テキスト数が多くて絞り込みが面倒という
        // 要望への対応で、よく使う教材を即座に拾えるようにする。
        const favA = favoriteTextbookIds.has(a.id) ? 0 : 1;
        const favB = favoriteTextbookIds.has(b.id) ? 0 : 1;
        if (favA !== favB) return favA - favB;
        const subjA = SUBJECT_ORDER.indexOf(a.subject || '');
        const subjB = SUBJECT_ORDER.indexOf(b.subject || '');
        if (subjA !== subjB) return (subjA === -1 ? 999 : subjA) - (subjB === -1 ? 999 : subjB);
        const grA = GRADE_ORDER.indexOf(a.grade || '');
        const grB = GRADE_ORDER.indexOf(b.grade || '');
        if (grA !== grB) return (grA === -1 ? 999 : grA) - (grB === -1 ? 999 : grB);
        return a.name.localeCompare(b.name, 'ja');
      });

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
                      {tb.subject && (() => {
                        const c = SUBJECT_BADGE_COLORS[tb.subject] ?? DEFAULT_SUBJECT_BADGE;
                        return (
                          <span className={`inline-flex px-1.5 py-0.5 text-[10px] font-bold rounded shrink-0 ${c.bg} ${c.text}`}>
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
              {studentName} / {[textbookGrade, textbookSubject, textbookName].filter(Boolean).join(' ')} / {year}年 {seasonLabel}講習
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
                  return (
                    <button
                      key={s}
                      onClick={() => handleStatusChange(s)}
                      disabled={statusChanging || isApprovedRestricted}
                      title={isApprovedRestricted ? '公開は教室長以上のみ可能です' : undefined}
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
              <div className="text-sm font-medium text-text-heading">{[textbookGrade, textbookSubject, textbookName].filter(Boolean).join(' ')}</div>
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
            <span className="ml-1 text-red-600" aria-hidden="true">*</span>
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

          <div ref={listRef} className={`space-y-1 ${dragging ? 'select-none' : ''}`}>
            {allItems.map((item, idx) => {
              const draft = unitDrafts.get(item.id);
              if (!draft) return null;
              const done = isDone(item.id);
              const groupMembers = draft.group_id > 0 ? groupMap.get(draft.group_id) : undefined;
              const appliedGroupMembers = draft.applied_group_id > 0 ? appliedGroupMap.get(draft.applied_group_id) : undefined;

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
                  onUngroupAllApplied={() => draft.applied_group_id > 0 && ungroupAllApplied(draft.applied_group_id)}
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
              <kbd className="ml-0.5 rounded bg-white/20 px-1 text-[10px] font-semibold leading-tight">G</kbd>
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
              {intentMenuOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
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
            <span className="text-accent-ink">{activeUnits.length}単元 / {totalKoma}コマ</span>
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
              <p><span className="text-text-muted">コース名:</span> {theme}</p>
              <p><span className="text-text-muted">テキスト:</span> {[textbookGrade, textbookSubject, textbookName].filter(Boolean).join(' ')}</p>
              <p><span className="text-text-muted">対象学年:</span> {studentGrade ? (GRADE_LABELS[studentGrade] ?? `学年${studentGrade}`) : '不明'}</p>
              <p><span className="text-text-muted">内容:</span> {activeUnits.length}単元 / {totalKoma}コマ</p>
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

      {/* 公開後の教材発注ダイアログ */}
      {orderDialog && (
        <PublishOrderDialog
          candidates={orderDialog}
          onClose={() => setOrderDialog(null)}
        />
      )}

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}

// ─── 単元行 ───

function UnitRow({
  index,
  item,
  draft,
  done,
  appliedMode,
  groupMembers,
  appliedGroupMembers,
  onToggle,
  onSelectStart,
  onSelectEnter,
  onUpdate,
  onUngroup,
  onUngroupAll,
  onUngroupApplied,
  onUngroupAllApplied,
}: {
  index: number;
  item: CurriculumItem;
  draft: UnitDraft;
  done: boolean;
  appliedMode: boolean;
  groupMembers?: UnitDraft[];
  appliedGroupMembers?: UnitDraft[];
  onToggle: (shiftKey: boolean) => void;
  onSelectStart: (shiftKey: boolean) => void;
  onSelectEnter: () => void;
  onUpdate: (patch: Partial<UnitDraft>) => void;
  onUngroup: () => void;
  onUngroupAll: () => void;
  onUngroupApplied: () => void;
  onUngroupAllApplied: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isGrouped = draft.group_id > 0;
  const isGroupHead = groupMembers && groupMembers[0]?.curriculum_item_id === draft.curriculum_item_id;
  const hasApplied = draft.applied_koma > 0;
  // 提案コマ・申込コマのどちらかが入っていれば有効（提案0・申込1の単元も操作可能に）
  const isActive = draft.koma_count > 0 || draft.applied_koma > 0;
  // 申込結合: applied_group_id でまとめた単元。head のみ申込±を出し、合計も head 1件で計上。
  const isAppliedGrouped = draft.applied_group_id > 0 && hasApplied;
  const isAppliedGroupHead = appliedGroupMembers && appliedGroupMembers[0]?.curriculum_item_id === draft.curriculum_item_id;

  const handleCardClick = () => {
    // 申込編集フェーズ（提案済み/公開済み）では行クリックで申込コマを足す。
    // 下書き中は従来どおり提案コマを足す。
    if (appliedMode) {
      onUpdate({ applied_koma: draft.applied_koma + 1 });
    } else {
      onUpdate({ koma_count: draft.koma_count + 1 });
    }
  };

  const groupColorIdx = isGrouped ? (draft.group_id - 1) % GROUP_COLORS.length : 0;

  const rowColor = !isActive
    ? draft.selected
      ? 'border border-primary/30 bg-primary/5'
      : 'border border-border-subtle bg-surface-raised'
    : hasApplied
      ? 'border border-success/30 bg-success-subtle'
      : isGrouped
        ? `border ${GROUP_BG[groupColorIdx]}`
        : 'border border-accent-ink/20 bg-accent-ink-subtle';

  const checkColor = !draft.selected
    ? 'border-border-strong hover:border-text-muted'
    : 'bg-primary border-primary text-white';

  return (
    <div
      data-unit-idx={index}
      onPointerEnter={onSelectEnter}
      className={`rounded-lg transition-[background-color,border-color] duration-150 ease-out ${rowColor} ${
        isGrouped && isActive ? `border-l-4 ${GROUP_COLORS[groupColorIdx]}` : ''
      }`}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        {/* チェック＝ドラッグハンドルも兼ねる。押した瞬間に選択開始し、そのままなぞると範囲選択。 */}
        <button
          onPointerDown={(e) => {
            if (e.button !== 0) return; // 左ボタンのみ
            e.preventDefault(); // テキスト選択・フォーカス暴れを防ぐ
            onSelectStart(e.shiftKey);
          }}
          onKeyDown={(e) => {
            if (e.key === ' ' || e.key === 'Enter') {
              e.preventDefault();
              onToggle(e.shiftKey);
            }
          }}
          className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 cursor-pointer touch-none transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-90 ${checkColor}`}
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
          {isGrouped && isActive && (
            <span className={`ml-1.5 text-[10px] font-bold ${GROUP_TEXT_COLORS[groupColorIdx]}`}>
              {GROUP_CIRCLE_NUMS[(draft.group_id - 1) % GROUP_CIRCLE_NUMS.length]}
            </span>
          )}
          {isAppliedGrouped && (
            <span className="ml-1.5 text-[10px] font-bold text-success" title="申込結合">
              申{GROUP_CIRCLE_NUMS[(draft.applied_group_id - 1) % GROUP_CIRCLE_NUMS.length]}
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

        {isActive && (
          <div className="flex items-center gap-2 shrink-0">
            {/* 提案コマ ±（提案結合はheadのみ表示。合計はhead1件で計上） */}
            {(!isGrouped || isGroupHead) && (
              <div className="flex items-center gap-0.5" title="提案コマ">
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
            )}

            {/* 提案±と申込±が両方出るときだけ区切り */}
            {(!isGrouped || isGroupHead) && (!isAppliedGrouped || isAppliedGroupHead) && (
              <div className="w-px h-4 bg-border-default" />
            )}

            {/* 申込コマ ±（申込結合はheadのみ表示。合計はhead1件で計上） */}
            {(!isAppliedGrouped || isAppliedGroupHead) && (
              <div className="flex items-center gap-0.5" title="申込コマ">
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
            )}
          </div>
        )}

        {/* 提案結合の解除 */}
        {isGrouped && isActive && !isGroupHead && (
          <button
            onClick={onUngroup}
            className="p-0.5 text-text-faint hover:text-text-muted rounded hover:bg-surface-hover active:scale-95 transition-[background-color,color,transform] duration-100 shrink-0"
            title="グループから外す"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}

        {isGrouped && isActive && isGroupHead && (
          <button
            onClick={onUngroupAll}
            className="p-0.5 text-text-faint hover:text-danger rounded hover:bg-surface-hover active:scale-95 transition-[background-color,color,transform] duration-100 shrink-0"
            title="グループ解除"
          >
            <Unlink className="w-3.5 h-3.5" />
          </button>
        )}

        {/* 申込結合の解除（success色で提案結合と区別） */}
        {isAppliedGrouped && !isAppliedGroupHead && (
          <button
            onClick={onUngroupApplied}
            className="p-0.5 text-success/70 hover:text-success rounded hover:bg-surface-hover active:scale-95 transition-[background-color,color,transform] duration-100 shrink-0"
            title="申込結合から外す"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}

        {isAppliedGrouped && isAppliedGroupHead && (
          <button
            onClick={onUngroupAllApplied}
            className="p-0.5 text-success/70 hover:text-success rounded hover:bg-surface-hover active:scale-95 transition-[background-color,color,transform] duration-100 shrink-0"
            title="申込結合を解除"
          >
            <Unlink className="w-3.5 h-3.5" />
          </button>
        )}

        {isActive && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1 text-text-faint hover:text-text-body rounded hover:bg-surface-hover active:bg-border-default transition-[background-color,color] duration-100 ease-out"
            aria-label={expanded ? '詳細を閉じる' : '詳細を開く'}
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        )}
      </div>

      {isActive && (
        <div className="px-3 pb-2 pt-0">
          <div className="flex items-center gap-1 flex-wrap">
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
