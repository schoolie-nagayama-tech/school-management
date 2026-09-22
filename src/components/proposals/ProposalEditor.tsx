'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowUp,
  BookPlus,
  Check,
  Download,
  FileText,
  PackageOpen,
  Plus,
  Printer,
  Trash2,
  X,
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
import { useConfirm } from '@/hooks/useConfirm';
import { useAuth } from '@/contexts/AuthContext';
import {
  getProposal,
  getProposalsByStudent,
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
import { ConceptBar } from './ConceptBar';
import {
  getProposalOrderCandidates,
  isRelevantOrderCandidate,
  type OrderCandidate,
} from '@/lib/api/ordering';
import { PublishOrderDialog } from './PublishOrderDialog';
import { getTextbooks } from '@/lib/api/textbooks';
import {
  addFavoriteTextbook,
  getFavoriteTextbookIds,
  removeFavoriteTextbook,
} from '@/lib/api/textbook-favorites';
import {
  getCourseCurriculum,
  getSeasonalCourse,
  getSeasonalCourses,
} from '@/lib/api/seasonalCourses';
import { supabase } from '@/lib/supabase';
import type {
  CurriculumItem,
  ProposalStatus,
  SeasonalCourse,
  SeasonalCourseListItem,
  SeasonalProposalWithDetails,
  SeasonType,
  StudentProgress,
  Textbook,
} from '@/types/database';
import { SEASON_LABELS, PROPOSAL_STATUS_LABELS, GRADE_LABELS } from '@/types/database';
import { ProposalPrintView } from './ProposalPrintView';
import type { PrintBook, ProposalPrintData } from './ProposalPrintView';
import { buildPrintBook } from '@/lib/proposals/buildPrintSheets';
// プレビューのまとめ方は印刷と同じ純関数を通す（見え方がズレると「印刷したら違った」になる）
import {
  groupProposalsForPrint,
  type PrintProposalSource,
} from '@/lib/proposals/printSheetGrouping';
// 複数冊（最大3冊）を1画面で作るための純粋ロジック。テストで固定してある
import {
  buildProposalSaveBlockers,
  calcBookKomaSummary,
  formatBookTitles,
  summarizeBookSaves,
  type BookSaveOutcome,
} from './proposalMultiBook';

import {
  MAX_TEXTBOOKS,
  STATUS_COLORS,
  STATUS_FLOW,
  STATUS_INACTIVE,
  getPreparingSeason,
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
  CreateMethodScreen,
  TemplatePickerScreen,
} from '@/components/proposals/NewProposalStartScreen';
// 単元編集まわりのUI部品。講習テンプレートの編集画面と見た目・操作を共有する
import { TextbookPickerScreen } from '@/components/koushu-plan/TextbookPickerScreen';
import { UnitList } from '@/components/koushu-plan/UnitList';
import { SelectionPill } from '@/components/koushu-plan/SelectionPill';
import { EditorBottomBar } from '@/components/koushu-plan/EditorBottomBar';
import { usePillPosition } from '@/components/koushu-plan/usePillPosition';

/**
 * 新規作成でタブに並べるテキスト1冊ぶんの見出し情報。
 * 実体（単元・入力中のコマ数）はアクティブなタブだけ既存の state に載り、
 * 離れているタブは bookStash に退避する。
 */
interface ProposalBook {
  textbookId: number;
  name: string;
  subject: string;
  grade: string;
}

/** タブを離れている冊の作業状態。切り替えで丸ごと入れ替える */
interface StashedBook {
  items: CurriculumItem[];
  drafts: Map<number, UnitDraft>;
  /** 学校の進度。1冊目が生徒の所持テキストから開かれた場合だけ中身がある */
  progressMap: Map<number, StudentProgress>;
  nextGroupId: number;
  nextAppliedGroupId: number;
}

/** テキスト1冊ぶんの空ドラフト（単元は全部0コマ・未選択） */
function emptyDraftsFor(items: CurriculumItem[]): Map<number, UnitDraft> {
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
  return drafts;
}

/** 表示用のテキスト名（学年 科目 書名） */
function bookLabel(book: { grade: string; subject: string; name: string }): string {
  return [book.grade, book.subject, book.name].filter(Boolean).join(' ');
}

export default function ProposalEditor() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { toasts, addToast, removeToast } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
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
  // 提案書は実施の数か月前に作るので、既定は「今のシーズン」ではなく「次に作るシーズン」。
  // 9月に新規作成すると冬期になる（URLで指定があればそちらが優先）
  const [season, setSeason] = useState<SeasonType>(qSeason || getPreparingSeason());
  const [year, setYear] = useState(qYear);
  const [theme, setTheme] = useState('');
  const [notes, setNotes] = useState('');

  const [selectedTextbookId, setSelectedTextbookId] = useState<number>(qTextbookId);
  /**
   * 新規作成で選んだテキスト（最大3冊）。タブの並び順＝上から進める順。
   * 保存すると1冊につき提案書1件になる（DBは 生徒×テキスト×期 で1件のまま）。
   * 既存の提案書を編集しているときは使わない（1件＝1冊で固定）。
   */
  const [books, setBooks] = useState<ProposalBook[]>([]);
  /** アクティブでない冊の作業状態。アクティブな冊は allItems / unitDrafts 側が正 */
  const [bookStash, setBookStash] = useState<Map<number, StashedBook>>(new Map());
  const [allTextbooks, setAllTextbooks] = useState<Textbook[]>([]);
  const [showTextbookPicker, setShowTextbookPicker] = useState(false);
  /**
   * 新規作成の入口。テキストから作るか、テンプレートから作るかを先に選ばせる。
   * ★URLでテキストが決まっている導線（教材マスタから）は選ばせても意味が無いので飛ばす。
   */
  const [newStartMode, setNewStartMode] = useState<'choose' | 'textbook' | 'template'>(
    isNew && !qTextbookId ? 'choose' : 'textbook'
  );
  const [templates, setTemplates] = useState<SeasonalCourseListItem[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  /** テンプレ一覧の絞り込み（既定は準備中の季節＋その生徒の学年）。外すと全件 */
  const [templateFiltered, setTemplateFiltered] = useState(true);
  const [applyingTemplate, setApplyingTemplate] = useState(false);
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
  // 「まとめる」ピルを出す基準行＝最後にチェック操作した単元。下部バーへ往復せず、今クリックした真横ですぐまとめられるようにする。
  const [pillAnchorId, setPillAnchorId] = useState<number | null>(null);

  const [studentName, setStudentName] = useState('');
  const [studentSchoolId, setStudentSchoolId] = useState<string | null>(null);
  /**
   * テーマの書き足しに使うID。★新規作成中は null。
   *   まだ保存されていないので、単元も成績もサーバー側から引けない。
   *   バーは出さず、ConceptBar が「保存すると書き足せます」の1行に切り替わる。
   */
  const conceptTargetId = isNew ? null : proposalId;
  const conceptSchoolId = studentSchoolId;
  const [textbookName, setTextbookName] = useState('');
  const [textbookSubject, setTextbookSubject] = useState('');
  const [textbookGrade, setTextbookGrade] = useState('');

  const [previewMode, setPreviewMode] = useState(false);
  // プレビューで出す紙。同じ生徒×期×科目の他の提案書も同じ1枚にまとめるため、開くときに組み立てる。
  // 過去問のように1冊で複数科目を扱う教材では、編集中の1件が科目ごとの紙に分かれて複数枚になる。
  const [previewSheets, setPreviewSheets] = useState<ProposalPrintData[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
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

  /**
   * このテキストを取り込めるひな形（講習）を読み直す。
   * アクティブなタブのテキストに対して効かせたいので、タブを切り替えるたびに呼ぶ。
   */
  const loadAvailableCourses = useCallback(async (tbId: number, schoolId: string | null) => {
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
  }, []);

  /**
   * ★新規作成では初期読み込みを1回きりにするためのフラグ。
   *
   * loadData の依存に selectedTextbookId が入っているので、タブを切り替える（＝アクティブな
   * テキストを変える）だけでこの useEffect が再実行され、他タブぶんも含めて作業中の入力が
   * 作り直されてしまう。新規作成ではテキストの読み込みを追加・切替のハンドラ側が担当するので、
   * ここは生徒情報・テキストマスタを1回取れば足りる。
   * 既存の提案書を編集するときの挙動は従来どおり（このフラグは効かせない）。
   */
  const newLoadDoneRef = useRef(false);
  /** URL で指定されて最初に読み込んだテキスト。所持テキストの紐付けを渡す先の判定に使う */
  const initialTextbookIdRef = useRef(0);

  // ── 初期読み込み ──
  const loadData = useCallback(async () => {
    if (isNew) {
      if (newLoadDoneRef.current) return;
      newLoadDoneRef.current = true;
    }
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
      // タブに出す書名。state は同一実行内では読めないのでローカルにも持つ
      const tbMeta = { name: '', subject: '', grade: '' };

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
        tbMeta.name = data.textbook?.name ?? '';
        tbMeta.subject = data.textbook?.subject ?? '';
        tbMeta.grade = ((data.textbook as Record<string, unknown>)?.grade as string) ?? '';
        setTextbookName(tbMeta.name);
        setTextbookSubject(tbMeta.subject);
        setTextbookGrade(tbMeta.grade);
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
          tbMeta.name = textbook?.name ?? '';
          tbMeta.subject = textbook?.subject ?? '';
          tbMeta.grade = textbook?.grade ?? '';
          setSelectedTextbookId(tbId);
          setTextbookName(tbMeta.name);
          setTextbookSubject(tbMeta.subject);
          setTextbookGrade(tbMeta.grade);
        }
      } else if (tbId) {
        const { data: tb } = await supabase
          .from('textbooks')
          .select('name, subject, grade')
          .eq('id', tbId)
          .single();
        if (tb) {
          const t = tb as { name: string; subject: string | null; grade: string | null };
          tbMeta.name = t.name;
          tbMeta.subject = t.subject ?? '';
          tbMeta.grade = t.grade ?? '';
          setTextbookName(tbMeta.name);
          setTextbookSubject(tbMeta.subject);
          setTextbookGrade(tbMeta.grade);
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

      // URL でテキストが指定された新規作成は、その1冊を最初のタブとして登録する
      if (isNew) {
        initialTextbookIdRef.current = tbId;
        setBooks([{ textbookId: tbId, ...tbMeta }]);
      }

      // このテキストを含む講習コースを取得
      await loadAvailableCourses(tbId, schoolId);
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

  /** 今アクティブなタブの作業状態（退避用のかたまり） */
  const snapshotActiveBook = (): StashedBook => ({
    items: allItems,
    drafts: unitDrafts,
    progressMap,
    nextGroupId,
    nextAppliedGroupId,
  });

  /** 退避してあった冊をアクティブに戻す */
  const restoreBook = (book: ProposalBook, entry: StashedBook | undefined) => {
    setSelectedTextbookId(book.textbookId);
    setTextbookName(book.name);
    setTextbookSubject(book.subject);
    setTextbookGrade(book.grade);
    setAllItems(entry?.items ?? []);
    setUnitDrafts(entry?.drafts ?? new Map());
    setNextGroupId(entry?.nextGroupId ?? 1);
    setNextAppliedGroupId(entry?.nextAppliedGroupId ?? 1);
    // 単元の選択・ピルの基準はテキストが変われば意味を持たないので持ち越さない
    lastToggleIdRef.current = null;
    setPillAnchorId(null);
    // 進捗は生徒の所持テキスト（student_textbook）に紐づく。2冊目以降は紐付けが無いので空になる。
    setProgressMap(entry?.progressMap ?? new Map());
    void loadAvailableCourses(book.textbookId, studentSchoolId);
  };

  /**
   * タブの切り替え。今の入力を退避してから、切替先の入力を復元する。
   * ★DBには触らない。保存するまでは全冊ぶんの入力がブラウザ内にだけある。
   */
  const switchBook = (textbookId: number) => {
    if (textbookId === selectedTextbookId) return;
    const target = books.find((b) => b.textbookId === textbookId);
    if (!target) return;
    const entry = bookStash.get(textbookId);
    setBookStash((prev) => {
      const next = new Map(prev);
      next.set(selectedTextbookId, snapshotActiveBook());
      next.delete(textbookId);
      return next;
    });
    restoreBook(target, entry);
  };

  /**
   * 指定の冊をタブから外す。アクティブな冊を外したときは残った先頭の冊へ移る。
   * 保存が途中で失敗したときの「保存できた冊だけ外す」にも使う。
   */
  const dropBooks = (removeIds: number[]) => {
    const remaining = books.filter((b) => !removeIds.includes(b.textbookId));
    const nextStash = new Map(bookStash);
    for (const id of removeIds) nextStash.delete(id);

    if (removeIds.includes(selectedTextbookId)) {
      const next = remaining[0];
      if (next) {
        const entry = nextStash.get(next.textbookId);
        nextStash.delete(next.textbookId);
        restoreBook(next, entry);
      } else {
        // 1冊も残らなければテキスト選択画面に戻る
        setSelectedTextbookId(0);
        setTextbookName('');
        setTextbookSubject('');
        setTextbookGrade('');
        setAllItems([]);
        setUnitDrafts(new Map());
        setNextGroupId(1);
        setNextAppliedGroupId(1);
        setAvailableCourses([]);
      }
    }
    setBooks(remaining);
    setBookStash(nextStash);
  };

  const handleRemoveBook = async (book: ProposalBook) => {
    const ok = await confirm({
      title: 'テキストを外す',
      description: `「${bookLabel(book)}」をこの提案書から外しますか？\n単元の設定も一緒に消えます（まだ保存していない入力です）。`,
      confirmLabel: '外す',
      variant: 'danger',
    });
    if (!ok) return;
    dropBooks([book.textbookId]);
  };

  /** 2冊目以降を足すときは、1冊目と同じ科目・学年で絞った状態で選択画面を開く（解除はできる） */
  const openAddBookPicker = () => {
    const first = books[0];
    if (first) {
      setTbFilterSubject(first.subject || '');
      setTbFilterGrade(first.grade || '');
    }
    setShowTextbookPicker(true);
  };

  const handleSelectTextbook = async (tb: Textbook) => {
    if (books.some((b) => b.textbookId === tb.id)) {
      addToast('このテキストはすでに追加されています', 'error');
      return;
    }
    if (books.length >= MAX_TEXTBOOKS) {
      addToast(`テキストは最大${MAX_TEXTBOOKS}冊までです`, 'error');
      return;
    }

    const { items } = await getTextbookUnitsWithProgress(null, tb.id);
    const drafts = emptyDraftsFor(items);

    // 今のタブの入力を退避してから新しいタブへ移る（切り替えで入力が消えないように）
    if (books.length > 0 && selectedTextbookId) {
      setBookStash((prev) => {
        const next = new Map(prev);
        next.set(selectedTextbookId, snapshotActiveBook());
        return next;
      });
    }

    const book: ProposalBook = {
      textbookId: tb.id,
      name: tb.name,
      subject: tb.subject ?? '',
      grade: tb.grade ?? '',
    };
    setBooks((prev) => [...prev, book]);
    restoreBook(book, {
      items,
      drafts,
      progressMap: new Map(),
      nextGroupId: 1,
      nextAppliedGroupId: 1,
    });
    setShowTextbookPicker(false);
  };

  /**
   * テンプレート候補を読む。
   * ★既定は「準備中の季節 ＋ その生徒の学年」。教室のテンプレは本番で1,265件あり、
   *   全部並べると選べない。ただし0件になりやすいので、外す道を画面側に出している。
   * ★単元ゼロのテンプレは出さない（本番の33%が空殻）。選んでも何も入らない。
   */
  const loadTemplates = async (useFilter: boolean) => {
    if (!studentSchoolId) return;
    setTemplatesLoading(true);
    try {
      const all = await getSeasonalCourses(studentSchoolId);
      const withUnits = all.filter((c) => c.curriculum_count > 0);
      const list = useFilter
        ? withUnits.filter((c) => {
            if (c.season !== season) return false;
            const grades = c.target_grades ?? [];
            // 対象学年が空のテンプレは「学年を問わない」扱いにする（絞りで消さない）
            return grades.length === 0 || studentGrade == null || grades.includes(studentGrade);
          })
        : withUnits;
      setTemplates(list);
    } catch (_e) {
      addToast('テンプレートの読み込みに失敗しました', 'error');
      setTemplates([]);
    } finally {
      setTemplatesLoading(false);
    }
  };

  /**
   * テンプレートを1つ選んで、その内容で新規作成を始める。
   *
   * ★テンプレが複数テキストを持つときは、そのまま複数冊のタブとして開く（冬期の実態）。
   *   1冊目をアクティブにし、残りは bookStash に入れる＝タブ切替と同じ形にしておく。
   * ★単元の取り込み規約（0コマの結合メンバーを残す・グループ番号の振り直し）は
   *   courseSettingsToDrafts に集約してある。ここで独自に判定しない。
   */
  const handleSelectTemplate = async (courseId: string) => {
    if (applyingTemplate) return;
    setApplyingTemplate(true);
    try {
      const course = await getSeasonalCourse(courseId);
      if (!course || course.textbooks.length === 0) {
        addToast('このテンプレートにはテキストがありません', 'error');
        return;
      }

      const targets = course.textbooks.slice(0, MAX_TEXTBOOKS);
      const prepared: { book: ProposalBook; stash: StashedBook }[] = [];
      for (const ct of targets) {
        const { items } = await getTextbookUnitsWithProgress(null, ct.textbook_id);
        const settings = course.curriculum
          .filter((c) => c.textbook_id === ct.textbook_id)
          .map((c) => ({
            curriculum_item_id: c.curriculum_item_id,
            proposal_count: c.proposal_count,
            group_number: c.group_number,
          }));
        const { drafts, nextGroupId } = courseSettingsToDrafts(emptyDraftsFor(items), settings, 1);
        prepared.push({
          book: {
            textbookId: ct.textbook_id,
            name: ct.textbook?.name ?? '',
            subject: ct.textbook?.subject ?? '',
            grade: ct.textbook?.grade ?? '',
          },
          stash: { items, drafts, progressMap: new Map(), nextGroupId, nextAppliedGroupId: 1 },
        });
      }

      setBooks(prepared.map((p) => p.book));
      setBookStash(new Map(prepared.slice(1).map((p) => [p.book.textbookId, p.stash])));
      initialTextbookIdRef.current = prepared[0].book.textbookId;
      restoreBook(prepared[0].book, prepared[0].stash);
      // テーマはテンプレ名を初期値に入れる（「生徒に登録」で配ったときと同じ）
      setTheme(course.name);
      setNewStartMode('textbook');

      if (course.textbooks.length > MAX_TEXTBOOKS) {
        addToast(
          `テキストは最大${MAX_TEXTBOOKS}冊までのため、先頭${MAX_TEXTBOOKS}冊だけ取り込みました`,
          'error'
        );
      } else {
        addToast(`「${course.name}」から作ります`, 'success');
      }
    } catch (_e) {
      addToast('テンプレートの取り込みに失敗しました', 'error');
    } finally {
      setApplyingTemplate(false);
    }
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
    if (count > 0) {
      addToast(
        tag ? `${count}単元に「${tag}」を設定` : `${count}単元の指導意図をクリア`,
        'success'
      );
    }
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

  /**
   * タブに並ぶ全冊ぶんの「有効な単元」。
   * アクティブなタブは画面の入力（activeUnits）、離れているタブは退避した入力から取る。
   * 並びはタブの順＝1冊目・2冊目…＝保存する順。
   */
  const booksWithUnits = useMemo(() => {
    return books.map((b) => ({
      book: b,
      label: bookLabel(b),
      units:
        b.textbookId === selectedTextbookId
          ? activeUnits
          : Array.from(bookStash.get(b.textbookId)?.drafts.values() ?? []).filter(
              (d) => d.koma_count > 0 || d.applied_koma > 0
            ),
    }));
  }, [books, bookStash, selectedTextbookId, activeUnits]);

  // 冊ごとのコマ数と合計（保存ボタン脇に出す内訳）
  const bookSummary = useMemo(
    () =>
      calcBookKomaSummary(
        booksWithUnits.map((e) => ({
          textbookId: e.book.textbookId,
          name: e.label,
          units: e.units,
        }))
      ),
    [booksWithUnits]
  );

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

  // フローティング「まとめる」ピルの位置（最後にチェックした行の真横・スクロール追従）
  const pillPos = usePillPosition({
    listRef,
    items: allItems,
    drafts: unitDrafts,
    selectionCount: selectionInfo.count,
    selectionLastIdx: selectionInfo.lastIdx,
    pillAnchorId,
  });

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

  /** 単元ドラフト → 保存用の入力 */
  const toUnitInputs = (units: UnitDraft[], appliedFallback: number | null): ProposalUnitInput[] =>
    units.map((u) => ({
      curriculum_item_id: u.curriculum_item_id,
      koma_count: u.koma_count,
      applied_koma: u.applied_koma > 0 ? u.applied_koma : appliedFallback,
      reason: u.reason,
      group_id: u.group_id,
      applied_group_id: u.applied_group_id,
      intent_tag: u.intent_tag,
    }));

  const handleSave = async () => {
    // 保存できない場合は理由を明示してユーザーに知らせる
    if (saveBlockers.length > 0) {
      addToast(saveBlockers[0], 'error');
      return;
    }
    setSaving(true);
    try {
      // 申込コマの 0 の扱い: 提案済み/公開済みでは 0（＝申込なし）を確定値として保存する。
      // 下書き中のみ「未確定」を表す null にして、直接公開時に提案回数で初期化できるようにする。
      // （null のまま保存すると一括公開などで提案回数に巻き戻るため）
      const appliedFallback = isNew || proposal?.status === 'draft' ? null : 0;

      if (!isNew) {
        // 既存の提案書の編集は従来どおり1件だけを上書きする
        const result = await upsertProposal({
          id: proposalId,
          studentId,
          textbookId: selectedTextbookId,
          studentTextbookId: studentTextbookId,
          schoolId: studentSchoolId,
          season,
          year,
          theme,
          notes: notes || null,
          units: toUnitInputs(activeUnits, appliedFallback),
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

        setProposal(result);
        return;
      }

      // ── 新規作成: タブの順に1冊ずつ保存する（1冊＝提案書1件） ──
      // ★並列にしない。created_at の昇順がそのまま「上から進める順」になり、
      //   印刷で同じ科目を1枚にまとめるときの並び順にも使われる。
      //   Promise.all で投げると採番の順番が保証されず、紙の上で順番が入れ替わる。
      const outcomes: BookSaveOutcome[] = [];
      for (const entry of booksWithUnits) {
        try {
          const result = await upsertProposal({
            studentId,
            textbookId: entry.book.textbookId,
            // 所持テキストの紐付け（student_textbook_id）があるのは、URLで指定されて開いた冊だけ。
            // 画面で足した2冊目以降はまだ生徒に紐づいていないので null で作る。
            studentTextbookId:
              entry.book.textbookId === initialTextbookIdRef.current ? studentTextbookId : null,
            schoolId: studentSchoolId,
            season,
            year,
            theme,
            notes: notes || null,
            units: toUnitInputs(entry.units, appliedFallback),
          });
          outcomes.push({
            textbookId: entry.book.textbookId,
            name: entry.label,
            proposalId: result.id,
          });
        } catch (e) {
          console.error('提案書の保存に失敗:', e);
          outcomes.push({ textbookId: entry.book.textbookId, name: entry.label, proposalId: null });
        }
      }

      const summary = summarizeBookSaves(outcomes);
      addToast(summary.message, summary.tone);

      if (!summary.allSucceeded) {
        // 保存できた冊はタブから外し、失敗した冊だけを残して再保存できる状態で画面に留まる
        dropBooks(summary.savedTextbookIds);
        return;
      }

      if (summary.savedProposalIds.length === 1) {
        router.replace(`/students/${studentId}/proposals/${summary.savedProposalIds[0]}`);
      } else {
        // 複数件できたときは、どれか1件を開くより一覧で並べて見せるほうが分かりやすい
        router.push(`/students/${studentId}/proposals`);
      }
    } catch (_e) {
      addToast('保存に失敗しました', 'error');
    } finally {
      setSaving(false);
    }
  };

  // 保存できない理由（保存ボタン横に表示してユーザーに知らせる）。
  // 新規作成は冊ごとに判定し、原因の冊は書名を添える。
  const saveBlockers: string[] = isNew
    ? buildProposalSaveBlockers({
        theme,
        books: bookSummary.perBook.map((b) => ({ name: b.name, koma: b.koma })),
      })
    : (() => {
        const blockers: string[] = [];
        if (!theme.trim()) blockers.push('テーマを入力してください');
        if (!selectedTextbookId) blockers.push('テキストを選択してください');
        return blockers;
      })();

  /**
   * プレビューの紙を組み立てる。
   *
   * 1枚＝同じ生徒×期×科目。編集中の冊は画面の未保存の状態をそのまま使い、
   * 同じ科目の他の提案書はDBから取って同じ紙に並べる（印刷したときと同じ見え方にする）。
   * 新規の複数冊作成中は、まだDBに無いので全タブの今の状態を並べる。
   *
   * ★まとめ方は印刷と同じ純関数（groupProposalsForPrint）に通す。過去問のように1冊で複数科目を
   *   扱う教材は、編集中の1件が科目ごとの紙に分かれる（紙が複数枚になる）。
   */
  const handleOpenPreview = async () => {
    setPreviewLoading(true);
    try {
      if (isNew) {
        // 新規作成は保存前でDBに無いため、タブの今の状態をそのまま1枚に並べる
        const printBooks: PrintBook[] = booksWithUnits.map((e) => ({
          textbookName: e.label,
          theme,
          allItems:
            e.book.textbookId === selectedTextbookId
              ? allItems
              : (bookStash.get(e.book.textbookId)?.items ?? []),
          activeUnits: e.units,
          progressMap:
            e.book.textbookId === selectedTextbookId
              ? progressMap
              : (bookStash.get(e.book.textbookId)?.progressMap ?? new Map()),
          totalKoma: bookSummary.perBook.find((b) => b.textbookId === e.book.textbookId)?.koma ?? 0,
        }));
        setPreviewSheets([
          {
            studentName,
            seasonLabel: SEASON_LABELS[season] ?? season,
            year,
            subject: books[0]?.subject ?? textbookSubject,
            books: printBooks,
          },
        ]);
        setPreviewMode(true);
        return;
      }

      // 編集中の1件を、未保存の入力そのままで「提案書1件」として扱う
      const editingId = proposalId ?? 'editing';
      const editingSource: PrintProposalSource = {
        proposal: {
          id: editingId,
          student_id: studentId,
          textbook_id: selectedTextbookId ?? 0,
          season,
          year,
          created_at: proposal?.created_at ?? '',
          theme,
          units: activeUnits,
          textbook: { name: textbookName, subject: textbookSubject || null },
        } as unknown as SeasonalProposalWithDetails,
        items: allItems,
      };

      // 同じ生徒・同じ期の他の提案書。どれと同じ紙になるかは科目（単元の科目）が決めるので、
      // ここでは科目で絞り込まない（過去問は教材の科目が空でも英語の紙に合流する）。
      const siblings = (await getProposalsByStudent(studentId)).filter(
        (p) => p.id !== editingId && p.season === season && p.year === year
      );
      const loaded = await Promise.all(
        siblings.map((p) =>
          getTextbookUnitsWithProgress(p.student_textbook_id ?? null, p.textbook_id)
        )
      );
      const progressBySibling = new Map(siblings.map((p, i) => [p.id, loaded[i].progressMap]));

      const sheets = groupProposalsForPrint([
        ...siblings.map((p, i) => ({ proposal: p, items: loaded[i].items })),
        editingSource,
      ])
        // 編集中の冊が載っていない紙（他科目の既存提案書だけの紙）は出さない
        .filter((sheet) => sheet.blocks.some((b) => b.proposal.id === editingId))
        .map((sheet) => ({
          studentName,
          seasonLabel: SEASON_LABELS[season] ?? season,
          year,
          subject: sheet.subject,
          books: sheet.blocks.map((block) => {
            const isEditing = block.proposal.id === editingId;
            const book = buildPrintBook(
              block,
              isEditing ? progressMap : (progressBySibling.get(block.proposal.id) ?? new Map())
            );
            // 編集中の冊だけは画面と同じ書名（学年つき）にする
            if (isEditing) {
              book.textbookName =
                [textbookGrade, block.subject || textbookSubject, textbookName]
                  .filter(Boolean)
                  .join(' ') || textbookName;
            }
            return book;
          }),
        }));

      setPreviewSheets(sheets);
      setPreviewMode(true);
    } catch (_e) {
      addToast('プレビューの作成に失敗しました', 'error');
    } finally {
      setPreviewLoading(false);
    }
  };

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
        const relevant = candidates.filter(isRelevantOrderCandidate);
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
  if (previewMode && previewSheets.length > 0) {
    return (
      <div className="proposal-print-root max-w-5xl mx-auto">
        <div className="mb-4 flex items-center gap-2 print:hidden">
          <Button variant="outline" size="sm" onClick={() => setPreviewMode(false)}>
            <ArrowLeft className="w-4 h-4 mr-1.5" />
            編集に戻る
          </Button>
          <Button size="sm" onClick={() => window.print()}>
            <Printer className="w-4 h-4 mr-1.5" />
            印刷
          </Button>
          {previewSheets.length > 1 ? (
            // 1冊で複数科目を扱う教材（過去問）は科目ごとに紙が分かれる
            <span className="text-xs text-text-muted ml-1">
              科目ごとに{previewSheets.length}枚に分かれます
            </span>
          ) : (
            previewSheets[0].books.length > 1 && (
              <span className="text-xs text-text-muted ml-1">
                同じ科目の{previewSheets[0].books.length}冊を1枚にまとめています
              </span>
            )
          )}
        </div>

        {previewSheets.map((sheet, i) => (
          <div
            key={i}
            className="print:break-before-page first:print:break-before-auto [&:not(:first-child)]:mt-8 [&:not(:first-child)]:print:mt-0"
          >
            <ProposalPrintView {...sheet} />
          </div>
        ))}
        <ToastContainer toasts={toasts} onRemove={removeToast} />
      </div>
    );
  }

  // ════════════════════════════════════════
  // 新規作成の入口（テキストから / テンプレートから）
  // ════════════════════════════════════════
  if (isNew && books.length === 0 && newStartMode !== 'textbook') {
    return (
      <>
        {newStartMode === 'choose' ? (
          <CreateMethodScreen
            studentName={studentName}
            backHref={`/students/${studentId}/proposals`}
            onPickTextbook={() => setNewStartMode('textbook')}
            onPickTemplate={() => {
              setNewStartMode('template');
              setTemplateFiltered(true);
              void loadTemplates(true);
            }}
          />
        ) : (
          <TemplatePickerScreen
            studentName={studentName}
            templates={templates}
            loading={templatesLoading}
            season={season}
            grade={studentGrade}
            filtered={templateFiltered}
            applying={applyingTemplate}
            onSelect={(courseId) => void handleSelectTemplate(courseId)}
            onClearFilters={() => {
              setTemplateFiltered(false);
              void loadTemplates(false);
            }}
            onBack={() => setNewStartMode('choose')}
          />
        )}
        <ToastContainer toasts={toasts} onRemove={removeToast} />
        {ConfirmDialog}
      </>
    );
  }

  // ════════════════════════════════════════
  // テキスト選択ピッカー
  // ════════════════════════════════════════
  if (showTextbookPicker || (isNew && books.length === 0)) {
    // 外枠の <div> は TextbookPickerScreen 側が持つので、ここではトーストと並べるだけ
    return (
      <>
        <TextbookPickerScreen
          textbooks={allTextbooks}
          search={textbookSearch}
          onSearchChange={setTextbookSearch}
          schoolType={tbFilterSchoolType}
          onSchoolTypeChange={(v) => {
            setTbFilterSchoolType(v);
            // 学校種別を変えると選べる学年が変わるので、学年の絞り込みは外す
            setTbFilterGrade('');
          }}
          subject={tbFilterSubject}
          onSubjectChange={setTbFilterSubject}
          grade={tbFilterGrade}
          onGradeChange={setTbFilterGrade}
          onClearFilters={() => {
            setTbFilterSchoolType('');
            setTbFilterSubject('');
            setTbFilterGrade('');
          }}
          favoriteIds={favoriteTextbookIds}
          favoritePendingId={favoriteTogglePending}
          onToggleFavorite={handleToggleFavoriteTextbook}
          onSelect={handleSelectTextbook}
          backHref={`/students/${studentId}/proposals`}
          backLabel="提案書一覧に戻る"
          subtitle={
            books.length > 0
              ? `${studentName} の講習提案書（${books.length + 1}冊目 / 最大${MAX_TEXTBOOKS}冊）`
              : `${studentName} の講習提案書${textbookSubject ? ` (${textbookSubject})` : ''}`
          }
        />
        <ToastContainer toasts={toasts} onRemove={removeToast} />
        {ConfirmDialog}
      </>
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
            {/* 複数冊のときは書名を並べる。3冊以上は「ほかn冊」に畳んで1行に収める */}
            <p className="text-sm text-text-muted mt-0.5">
              {studentName} /{' '}
              {isNew && books.length > 0
                ? formatBookTitles(books.map((b) => bookLabel(b)))
                : [textbookGrade, textbookSubject, textbookName].filter(Boolean).join(' ')}{' '}
              / {year}年 {seasonLabel}講習
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
          <section className="p-4 bg-surface-raised rounded-xl border border-border">
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
                  className="w-24 px-3 py-1.5 text-sm border border-border rounded-lg bg-surface-raised focus:ring-2 focus:ring-primary/20 focus:border-primary"
                />
              </div>
            </div>
          </section>
        )}

        {/* テキストのタブ（新規作成のみ・最大3冊）。
            切り替えても未保存の入力は保持される（離れているタブは bookStash に退避）。
            保存すると1冊につき提案書1件になる（まとめて1件にはしない）。 */}
        {isNew && (
          <section className="p-4 bg-surface-raised rounded-xl border border-border">
            <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
              <div className="text-xs font-bold text-text-muted">
                テキスト（{books.length}/{MAX_TEXTBOOKS}）
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-text-faint">上から順に進めます</span>
                {books.length < MAX_TEXTBOOKS && (
                  <button
                    type="button"
                    onClick={openAddBookPicker}
                    className="px-2.5 py-1 text-[11px] font-medium bg-ink text-text-on-primary rounded-md hover:brightness-[0.85] transition-[filter] duration-150 inline-flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" />
                    テキストを追加
                  </button>
                )}
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              {books.map((b, i) => {
                const isActive = selectedTextbookId === b.textbookId;
                const koma = bookSummary.perBook.find((r) => r.textbookId === b.textbookId)?.koma;
                return (
                  // タブ本体と「外す」は別のボタンにする。
                  // 入れ子のボタンはHTMLとして不正で、キーボードから「外す」に到達できなくなる。
                  <div
                    key={b.textbookId}
                    className={`flex items-center rounded-lg text-sm font-medium transition-[background-color,color] duration-150 ${
                      isActive
                        ? 'bg-ink text-text-on-primary'
                        : 'bg-surface-hover text-text-body hover:bg-border-default'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => switchBook(b.textbookId)}
                      aria-pressed={isActive}
                      className="pl-3 pr-2 py-1.5 rounded-l-lg"
                    >
                      <span
                        className={`mr-1.5 text-[11px] tabular-nums ${
                          isActive ? 'text-text-on-primary/70' : 'text-text-faint'
                        }`}
                      >
                        {i + 1}冊目
                      </span>
                      {bookLabel(b)}
                      <span
                        className={`ml-1.5 text-[11px] tabular-nums ${
                          isActive ? 'text-text-on-primary/70' : 'text-text-muted'
                        }`}
                      >
                        {koma ?? 0}コマ
                      </span>
                    </button>
                    {/* 1冊しか無いときは外すボタンを出さない（外しても作れないため） */}
                    {books.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveBook(b)}
                        aria-label={`${bookLabel(b)} を提案書から外す`}
                        title="このテキストを外す"
                        className={`pr-2.5 pl-1 py-1.5 rounded-r-lg transition-[color] duration-150 ${
                          isActive
                            ? 'text-text-on-primary/60 hover:text-text-on-primary'
                            : 'text-text-faint hover:text-danger'
                        }`}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* テーマ */}
        <section className="p-4 bg-surface-raised rounded-xl border border-border">
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
              theme.trim() ? 'border-border' : 'border-red-300'
            }`}
            placeholder="例: 英検3級対策 / 1年生の総復習 / 2学期の先取り"
          />

          {/* 複数冊のときはテーマが全冊に入る。あとで冊ごとに直せることを先に言っておく */}
          {isNew && books.length > 1 && (
            <p className="mt-1.5 text-[11px] text-text-faint">
              テーマは全冊に共通で入ります。保存後は提案書ごとに直せます
            </p>
          )}

          {/* テーマ欄に書いた一言を、その生徒の単元と成績で書き足す。
              ★教室の設定がオフならバー自体が出ない（成績の外部送信が起きない）。
              ★新規作成中（conceptTargetId が null）でも置く。バーの代わりに
                「保存すると書き足せます」の1行になる。出さないと存在に気付けない。 */}
          {conceptSchoolId && (
            <ConceptBar
              className="mt-2"
              proposalId={conceptTargetId}
              hasUnits={activeUnits.length > 0}
              schoolId={conceptSchoolId}
              value={theme}
              onChange={setTheme}
            />
          )}
        </section>

        {/* 単元選択 */}
        <section className="p-4 bg-surface-raised rounded-xl border border-border">
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
                      <div className="absolute right-0 top-full mt-1 w-56 bg-surface-raised border border-border rounded-lg shadow-lg z-20 overflow-hidden">
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

          <UnitList
            items={allItems}
            drafts={unitDrafts}
            isDone={isDone}
            appliedMode={appliedMode}
            groupMap={groupMap}
            appliedGroupMap={appliedGroupMap}
            dragging={dragging}
            listRef={listRef}
            showColumnHeader={activeUnits.length > 0}
            onToggle={toggleUnit}
            onSelectStart={startSelectDrag}
            onSelectEnter={onSelectEnter}
            onUpdate={updateUnit}
            onUngroup={ungroupUnit}
            onUngroupAll={ungroupAll}
            onUngroupApplied={ungroupAppliedUnit}
            onUngroupAllApplied={ungroupAllApplied}
          />
        </section>

        {/* メモ */}
        <section className="p-4 bg-surface-raised rounded-xl border border-border">
          <label className="text-sm font-bold text-text-heading block mb-2">
            備考（内部メモ・印刷には出ません）
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-surface-raised focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none"
            placeholder="内部メモ"
          />
        </section>
      </div>

      {/* 選択脇のフローティング「まとめる」ピル。最後にチェックした行のチェックボックスの真横（縦中央）に出し、下部バーへの往復をなくす。 */}
      <SelectionPill
        pos={pillPos}
        count={selectionInfo.count}
        contiguous={selectionInfo.contiguous}
        dragging={dragging}
        appliedMode={appliedMode}
        onGroup={groupSelected}
        onGroupApplied={groupAppliedSelected}
        onApplyIntent={applyIntentToSelected}
      />

      <EditorBottomBar
        unitCount={activeUnits.length}
        totalKoma={totalKoma}
        totalAppliedKoma={totalAppliedKoma}
        selectedCount={selectionInfo.count}
        contiguous={selectionInfo.contiguous}
        appliedMode={appliedMode}
        onGroup={groupSelected}
        onGroupApplied={groupAppliedSelected}
        onSave={handleSave}
        saving={saving}
        saveBlockers={saveBlockers}
        saveLabel={isNew && books.length > 1 ? `保存（提案書${books.length}件）` : '保存'}
        saveHint={
          // 冊ごとのコマ数と合計。どの冊にどれだけ入っているかを保存前に確かめられるように出す
          isNew && books.length > 1 ? (
            <span className="text-[11px] text-text-muted tabular-nums">
              {bookSummary.perBook.map((b) => `${b.order}冊目 ${b.koma}コマ`).join(' / ')}
              <span className="ml-2 font-bold text-text-heading">
                合計 {bookSummary.totalKoma}コマ
              </span>
            </span>
          ) : undefined
        }
        extraActions={
          <>
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
            <Button
              variant="outline"
              size="sm"
              onClick={handleOpenPreview}
              disabled={previewLoading}
            >
              <Printer className="w-3.5 h-3.5 mr-1" />
              {previewLoading ? '準備中...' : 'プレビュー'}
            </Button>
          </>
        }
      />

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
      {ConfirmDialog}
    </div>
  );
}
