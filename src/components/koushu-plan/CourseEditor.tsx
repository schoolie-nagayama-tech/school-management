'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Plus, Trash2, Users, X } from 'lucide-react';
import { Loading, ToastContainer } from '@/components/ui';
import { useToast } from '@/hooks/useToast';
import { useConfirm } from '@/hooks/useConfirm';
import {
  addTextbookToCourse,
  createSeasonalCourse,
  deleteSeasonalCourse,
  getCachedSeasonalCourses,
  getCourseCurriculum,
  getSeasonalCourse,
  removeTextbookFromCourse,
  replaceCourseCurriculum,
  updateSeasonalCourse,
} from '@/lib/api/seasonalCourses';
import { calcTotalKoma, getTextbookUnitsWithProgress } from '@/lib/api/proposals';
import { getTextbooks } from '@/lib/api/textbooks';
import {
  addFavoriteTextbook,
  getFavoriteTextbookIds,
  removeFavoriteTextbook,
} from '@/lib/api/textbook-favorites';
import type { CurriculumItem, SeasonType, Textbook } from '@/types/database';
import { GRADE_LABELS, SEASON_LABELS } from '@/types/database';
import type { UnitDraft } from '@/components/proposals/proposalEditor.shared';
import {
  applyDragRange as applyDragRangeTo,
  buildGroupMap,
  clearSelection as clearSelectionIn,
  getSelectionInfo,
  groupSelectedUnits,
  selectionSnapshot,
  setSelectionRange,
  ungroupAllInGroup,
  type DraftMap,
} from './unitDraftLogic';
import { courseSettingsToDrafts, draftsToCourseSettings } from './courseSettingAdapter';
import { TextbookPickerScreen } from './TextbookPickerScreen';
import { UnitList } from './UnitList';
import { SelectionPill } from './SelectionPill';
import { EditorBottomBar } from './EditorBottomBar';
import { usePillPosition } from './usePillPosition';

/** テキスト1冊ぶんの編集内容。単元の並び（items）と入力中のコマ数・結合（drafts）を対にして持つ */
interface TextbookUnits {
  items: CurriculumItem[];
  drafts: DraftMap;
}

/** タブに出すテキスト。textbook_id と表示用のマスタをまとめて持つ */
interface CourseTextbook {
  textbook_id: number;
  textbook: Textbook;
}

const MAX_TEXTBOOKS = 3;
const GRADES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const SEASONS: SeasonType[] = ['spring', 'summer', 'winter'];

/** 未読み込みタブ用の空マップ。毎回新しい Map を作ると useMemo が無駄に走るので定数にする */
const EMPTY_DRAFTS: DraftMap = new Map();
const EMPTY_ITEMS: CurriculumItem[] = [];
/** テンプレートに「申込」は無いので、申込結合のグループは常に空 */
const EMPTY_APPLIED_GROUP_MAP: Map<number, UnitDraft[]> = new Map();

/** 単元1件ぶんの初期ドラフト。申込・指導意図はテンプレートでは使わないが型を満たすため0/nullで埋める */
function emptyDraft(curriculumItemId: number): UnitDraft {
  return {
    curriculum_item_id: curriculumItemId,
    koma_count: 0,
    applied_koma: 0,
    reason: '',
    selected: false,
    group_id: 0,
    applied_group_id: 0,
    intent_tag: null,
  };
}

/**
 * 講習テンプレート（seasonal_courses）の編集画面。
 *
 * 生徒ごとの提案書エディタ（ProposalEditor）と同じ部品・同じ手つきで作れるようにする。
 * 教室長が覚える操作を1種類にするのが目的なので、選択・なぞりドラッグ・結合・保存の作法は
 * ProposalEditor に合わせてある（純粋ロジックは unitDraftLogic を共有）。
 *
 * `courseId` が無ければ新規作成。保存を押して初めて `seasonal_courses` の行ができる
 * （「作成 → 一覧 → 詳細で設定」の2段構えをやめ、中身の無いテンプレが量産されるのを防ぐ）。
 */
export function CourseEditor({ courseId, schoolId }: { courseId?: string; schoolId: string }) {
  const router = useRouter();
  const { toasts, removeToast, success, error } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();

  // 新規作成時は保存で採番されるので、以後の保存先として保持する
  const [savedCourseId, setSavedCourseId] = useState<string | null>(courseId ?? null);
  const isNew = !courseId;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);
  // 未保存の変更があるか。離脱ガード（beforeunload）の判定に使う
  const [dirty, setDirty] = useState(false);

  // ── メタ情報 ──
  const [name, setName] = useState('');
  const [season, setSeason] = useState<SeasonType>('summer');
  const [targetGrades, setTargetGrades] = useState<number[]>([]);
  const [comment, setComment] = useState('');

  // ── テキストのタブ ──
  const [textbooks, setTextbooks] = useState<CourseTextbook[]>([]);
  const [selectedTextbookId, setSelectedTextbookId] = useState<number | null>(null);
  // 読み込み時点でコースに紐づいていたテキスト。保存時の追加・削除の差分をここから取る
  const initialTextbookIdsRef = useRef<number[]>([]);

  /**
   * テキストごとの編集内容をすべてメモリに持つ。
   * 旧実装はタブを切り替えるたびに入力値を破棄していて、未保存のコマ数が警告なく消えていた。
   * 全タブぶん保持すれば、切り替えても保存前の入力がそのまま残る。
   */
  const [unitsByTextbook, setUnitsByTextbook] = useState<Map<number, TextbookUnits>>(new Map());

  /**
   * 結合グループの採番。★コース全体で通し番号にする。
   * テキストごとに1から振り直すと、別テキストのグループと番号が衝突して
   * 表示色や G{n} ラベルが混ざる（旧実装のサーバー側採番もコース単位で一意だった）。
   */
  const [nextGroupId, setNextGroupId] = useState(1);

  // ── テキストピッカー ──
  const [showTextbookPicker, setShowTextbookPicker] = useState(false);
  const [allTextbooks, setAllTextbooks] = useState<Textbook[]>([]);
  const [textbookSearch, setTextbookSearch] = useState('');
  const [favoriteTextbookIds, setFavoriteTextbookIds] = useState<Set<number>>(new Set());
  const [favoriteTogglePending, setFavoriteTogglePending] = useState<number | null>(null);
  const [tbFilterSchoolType, setTbFilterSchoolType] = useState('');
  const [tbFilterSubject, setTbFilterSubject] = useState('');
  const [tbFilterGrade, setTbFilterGrade] = useState('');

  // ── 選択・なぞりドラッグ（ProposalEditor と同じ作り） ──
  const [dragging, setDragging] = useState(false);
  const dragAnchorIdxRef = useRef<number | null>(null); // ドラッグ開始行のindex
  const dragModeRef = useRef<boolean>(true); // true=選択 / false=解除（開始行の状態で決まる）
  const dragSnapshotRef = useRef<Set<number>>(new Set()); // ドラッグ開始時点の選択集合（ラバーバンドの基準）
  const draggingRef = useRef(false); // 高速クリック時のリスナ取りこぼしを防ぐため ref でも保持
  const listRef = useRef<HTMLDivElement>(null);
  const lastToggleIdRef = useRef<number | null>(null);
  const lastToggleStateRef = useRef<boolean>(true);
  // 「まとめる」ピルを出す基準行＝最後にチェック操作した単元
  const [pillAnchorId, setPillAnchorId] = useState<number | null>(null);

  // ── 読み込み ──
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        // テキストマスタとお気に入りはコースに依存しないので並走させる
        const textbooksPromise = getTextbooks();
        const favIdsPromise = getFavoriteTextbookIds().catch(() => null);

        if (courseId) {
          const course = await getSeasonalCourse(courseId);
          if (!course) {
            if (!cancelled) {
              error('講習が見つかりません');
              router.replace('/courses');
            }
            return;
          }

          const courseTextbooks: CourseTextbook[] = (course.textbooks ?? [])
            .filter((ct) => !!ct.textbook)
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((ct) => ({ textbook_id: ct.textbook_id, textbook: ct.textbook as Textbook }));

          // 全テキストぶんの単元をまとめて読み込む。最大3冊なので往復は高々3回で済み、
          // タブを切り替えるたびに取りに行く作りをやめられる（切替が即時になる）。
          const loaded = await Promise.all(
            courseTextbooks.map(async (ct) => ({
              textbookId: ct.textbook_id,
              ...(await getCourseCurriculum(courseId, ct.textbook_id)),
            }))
          );

          if (cancelled) return;

          // グループ番号はコース全体で通しにするため、テキストを跨いで採番を引き継ぐ
          let runningGroupId = 1;
          const map = new Map<number, TextbookUnits>();
          for (const entry of loaded) {
            const base: DraftMap = new Map();
            for (const item of entry.items) base.set(item.id, emptyDraft(item.id));
            const converted = courseSettingsToDrafts(base, entry.settings, runningGroupId);
            runningGroupId = converted.nextGroupId;
            map.set(entry.textbookId, { items: entry.items, drafts: converted.drafts });
          }

          setName(course.name);
          setSeason(course.season);
          setTargetGrades(course.target_grades ?? []);
          setComment(course.comment ?? '');
          setTextbooks(courseTextbooks);
          initialTextbookIdsRef.current = courseTextbooks.map((ct) => ct.textbook_id);
          setUnitsByTextbook(map);
          setNextGroupId(runningGroupId);
          setSelectedTextbookId(courseTextbooks[0]?.textbook_id ?? null);
        }

        const [tbs, favIds] = await Promise.all([textbooksPromise, favIdsPromise]);
        if (cancelled) return;
        setAllTextbooks(tbs);
        if (favIds) setFavoriteTextbookIds(favIds);
      } catch (err) {
        if (!cancelled) {
          error(err instanceof Error ? err.message : '読み込みに失敗しました');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
    // error/router は毎描画で作り直され得るため依存から外す（読み込みは courseId 単位で1回）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  // 離脱ガード。未保存の入力を残したままタブを閉じる・戻るのを止める
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // 一部ブラウザは returnValue を見るため、両方を満たしておく
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  // ── 現在のタブ ──
  const current = selectedTextbookId != null ? unitsByTextbook.get(selectedTextbookId) : undefined;
  const items = current?.items ?? EMPTY_ITEMS;
  const drafts = current?.drafts ?? EMPTY_DRAFTS;
  // 画面に出ている順の curriculum_item_id。選択・結合の純粋ロジックへ並び順を渡すのに使う
  const orderedIds = useMemo(() => items.map((i) => i.id), [items]);

  /** 現在のタブのドラフトだけを差し替える。他タブの入力は触らない */
  const updateDrafts = useCallback(
    (updater: (prev: DraftMap) => DraftMap) => {
      if (selectedTextbookId == null) return;
      setUnitsByTextbook((prev) => {
        const entry = prev.get(selectedTextbookId);
        if (!entry) return prev;
        const nextDrafts = updater(entry.drafts);
        if (nextDrafts === entry.drafts) return prev;
        const next = new Map(prev);
        next.set(selectedTextbookId, { items: entry.items, drafts: nextDrafts });
        return next;
      });
    },
    [selectedTextbookId]
  );

  // ── お気に入り（提案書エディタと同じ楽観更新） ──
  const handleToggleFavoriteTextbook = async (textbookId: number) => {
    if (favoriteTogglePending === textbookId) return;
    const isFav = favoriteTextbookIds.has(textbookId);
    setFavoriteTogglePending(textbookId);
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
      error('お気に入りの更新に失敗しました');
    } finally {
      setFavoriteTogglePending(null);
    }
  };

  // ── テキストの追加・削除 ──
  const handleSelectTextbook = async (tb: Textbook) => {
    if (textbooks.some((t) => t.textbook_id === tb.id)) {
      error('このテキストはすでに追加されています');
      return;
    }
    if (textbooks.length >= MAX_TEXTBOOKS) {
      error(`テキストは最大${MAX_TEXTBOOKS}冊までです`);
      return;
    }
    try {
      // 新しいタブぶんの単元を読み込む。DBにはまだ何も書かず、保存でまとめて反映する。
      // 生徒に紐づかないので進捗は取らない（第1引数 null）。
      const { items: newItems } = await getTextbookUnitsWithProgress(null, tb.id);
      const base: DraftMap = new Map();
      for (const item of newItems) base.set(item.id, emptyDraft(item.id));

      setUnitsByTextbook((prev) => {
        const next = new Map(prev);
        next.set(tb.id, { items: newItems, drafts: base });
        return next;
      });
      setTextbooks((prev) => [...prev, { textbook_id: tb.id, textbook: tb }]);
      setSelectedTextbookId(tb.id);
      setShowTextbookPicker(false);
      setDirty(true);
    } catch (err) {
      error(err instanceof Error ? err.message : 'テキストの読み込みに失敗しました');
    }
  };

  const handleRemoveTextbook = async (textbookId: number, textbookName: string) => {
    const ok = await confirm({
      title: 'テキストを外す',
      description: `「${textbookName}」をこの講習から外しますか？\n単元の設定も一緒に消えます（保存したときに反映されます）。`,
      confirmLabel: '外す',
      variant: 'danger',
    });
    if (!ok) return;

    setTextbooks((prev) => prev.filter((t) => t.textbook_id !== textbookId));
    setUnitsByTextbook((prev) => {
      const next = new Map(prev);
      next.delete(textbookId);
      return next;
    });
    if (selectedTextbookId === textbookId) {
      const rest = textbooks.filter((t) => t.textbook_id !== textbookId);
      setSelectedTextbookId(rest[0]?.textbook_id ?? null);
    }
    setDirty(true);
  };

  // ── 単元の選択・編集（ProposalEditor と同じ挙動） ──
  const toggleUnit = (ciId: number, shiftKey = false) => {
    if (shiftKey && lastToggleIdRef.current != null && lastToggleIdRef.current !== ciId) {
      const fromId = lastToggleIdRef.current;
      if (orderedIds.includes(fromId) && orderedIds.includes(ciId)) {
        const targetState = lastToggleStateRef.current;
        updateDrafts((prev) => setSelectionRange(prev, orderedIds, fromId, ciId, targetState));
        lastToggleIdRef.current = ciId;
        setPillAnchorId(ciId);
        return;
      }
    }
    const prev = drafts.get(ciId);
    const newState = prev ? !prev.selected : true;
    lastToggleIdRef.current = ciId;
    lastToggleStateRef.current = newState;
    setPillAnchorId(ciId);
    updateDrafts((p) => {
      const next = new Map(p);
      const d = next.get(ciId);
      if (d) next.set(ciId, { ...d, selected: newState });
      return next;
    });
  };

  // ドラッグ範囲選択: 開始〜現在の連続行を、開始時のスナップショットを基準に塗り替える（ラバーバンド）
  const applyDragRange = (a: number, b: number, mode: boolean) => {
    const snap = dragSnapshotRef.current;
    updateDrafts((prev) => applyDragRangeTo(prev, orderedIds, a, b, mode, snap));
  };

  // チェックボックスを押した瞬間（ドラッグ開始）。Shift同時押しは従来の範囲トグルを維持。
  const startSelectDrag = (idx: number, shiftKey: boolean) => {
    const id = items[idx]?.id;
    if (id == null) return;
    if (shiftKey) {
      toggleUnit(id, true);
      return;
    }
    dragSnapshotRef.current = selectionSnapshot(drafts);
    dragAnchorIdxRef.current = idx;
    const mode = !(drafts.get(id)?.selected ?? false); // 未選択行から始めたら「選択」、選択済みなら「解除」
    dragModeRef.current = mode;
    lastToggleIdRef.current = id;
    lastToggleStateRef.current = mode;
    setPillAnchorId(id);
    draggingRef.current = true;
    setDragging(true);
    applyDragRange(idx, idx, mode);
  };

  // ドラッグ中に別の行へ入ったら範囲を伸縮。ピルは最後になぞった行の横へ追従させる。
  const onSelectEnter = (idx: number) => {
    if (dragAnchorIdxRef.current == null) return;
    applyDragRange(dragAnchorIdxRef.current, idx, dragModeRef.current);
    const id = items[idx]?.id;
    if (id != null) setPillAnchorId(id);
  };

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

  const clearSelection = () => {
    updateDrafts((prev) => clearSelectionIn(prev));
  };

  const updateUnit = (ciId: number, patch: Partial<UnitDraft>) => {
    updateDrafts((prev) => {
      const next = new Map(prev);
      const d = next.get(ciId);
      if (d) next.set(ciId, { ...d, ...patch });
      return next;
    });
    setDirty(true);
  };

  /**
   * 選択中の単元をまとめる。判定と片割れグループの解散は unitDraftLogic 側が持つので、
   * ここは採番（コース全体で通し）とトーストだけを担当する。
   */
  const groupSelected = () => {
    const result = groupSelectedUnits(drafts, orderedIds, nextGroupId, 'proposal');
    if (!result.ok) {
      error(
        result.reason === 'too-few'
          ? 'グループ化には2つ以上の単元を選択してください'
          : '隣接する単元のみグループ化できます'
      );
      return;
    }
    // 採番は updater の外で行う（updater が複数回呼ばれてもIDが飛ばないように）
    setNextGroupId(nextGroupId + 1);
    updateDrafts(() => result.drafts);
    setDirty(true);
  };

  const ungroupUnit = (ciId: number) => updateUnit(ciId, { group_id: 0 });

  const ungroupAll = (groupId: number) => {
    updateDrafts((prev) => ungroupAllInGroup(prev, groupId, 'proposal'));
    setDirty(true);
  };

  // ── 集計 ──
  // 現在のタブでコマ数が入っている単元
  const activeUnits = useMemo(
    () => Array.from(drafts.values()).filter((d) => d.koma_count > 0),
    [drafts]
  );

  // コース全体（全テキスト）の合計。保存する total_koma と同じ数え方にする
  const totals = useMemo(() => {
    let koma = 0;
    let unitCount = 0;
    const perTextbook = new Map<number, number>();
    unitsByTextbook.forEach((entry, tbId) => {
      const active = Array.from(entry.drafts.values()).filter((d) => d.koma_count > 0);
      const k = calcTotalKoma(active);
      perTextbook.set(tbId, k);
      koma += k;
      unitCount += active.length;
    });
    return { koma, unitCount, perTextbook };
  }, [unitsByTextbook]);

  const groupMap = useMemo(() => buildGroupMap(activeUnits, 'proposal'), [activeUnits]);

  const selectionInfo = useMemo(() => getSelectionInfo(orderedIds, drafts), [orderedIds, drafts]);

  // フローティング「まとめる」ピルの位置（最後にチェックした行の真横・スクロール追従）
  const pillPos = usePillPosition({
    listRef,
    items,
    drafts,
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

  // ── 保存 ──
  const saveBlockers: string[] = [];
  if (!name.trim()) saveBlockers.push('講習名を入力してください');
  if (textbooks.length === 0) saveBlockers.push('テキストを選択してください');

  /**
   * 保存は下部バーのボタン1本に集約する。書き込みの順番には理由がある:
   *
   *   1. 本体（新規なら作成）… 単元もテキストも course_id を要るので必ず先
   *   2. テキストの差分     … 外したテキストの単元行も removeTextbookFromCourse が消す。
   *                            3 の前にやらないと、消したはずの単元を書き戻してしまう
   *   3. 単元設定           … テキストごとに replaceCourseCurriculum で丸ごと置き換える。
   *                            ★upsert の saveBulkCourseCurriculum は使えない。コマ数を0に戻した
   *                            単元は書き出し対象から外れるため、古い行がDBに残って復活する
   *   4. total_koma         … 3 の結果と一致させるため、全テキストの合計で最後に書く
   */
  // 講習をアーカイブして一覧へ戻る。
  // このシステムの「削除」は is_active を落とす論理削除なので、文言もアーカイブで揃える。
  const handleArchive = async () => {
    if (!savedCourseId) return;
    const ok = await confirm({
      title: '講習をアーカイブ',
      description: `「${name.trim() || 'この講習'}」をアーカイブしますか？ 一覧のアーカイブ表示から元に戻せます。`,
      confirmLabel: 'アーカイブ',
      variant: 'danger',
    });
    if (!ok) return;
    setArchiving(true);
    try {
      await deleteSeasonalCourse(savedCourseId);
      getCachedSeasonalCourses.invalidate();
      // 未保存の変更があっても離脱ガードで止めない（アーカイブしたものを編集し続ける意味が無い）
      setDirty(false);
      router.push('/courses');
    } catch (err) {
      error(err instanceof Error ? err.message : 'アーカイブに失敗しました');
      setArchiving(false);
    }
  };

  const handleSave = async () => {
    if (saveBlockers.length > 0) {
      error(saveBlockers.join(' / '));
      return;
    }
    setSaving(true);
    try {
      const meta = {
        name: name.trim(),
        season,
        target_grades: targetGrades,
        comment: comment.trim() || null,
        total_koma: totals.koma,
      };

      let targetCourseId = savedCourseId;
      if (!targetCourseId) {
        const created = await createSeasonalCourse(schoolId, {
          name: meta.name,
          season: meta.season,
          target_grades: meta.target_grades,
          comment: meta.comment ?? undefined,
          total_koma: meta.total_koma,
        });
        targetCourseId = created.id;
      } else {
        await updateSeasonalCourse(targetCourseId, meta);
      }

      // テキストの差分（読み込み時点との比較）。新規作成では初期リストが空なので全冊が追加になる
      const currentIds = textbooks.map((t) => t.textbook_id);
      const initialIds = initialTextbookIdsRef.current;
      const removed = initialIds.filter((id) => !currentIds.includes(id));
      for (const id of removed) {
        await removeTextbookFromCourse(targetCourseId, id);
      }
      for (let i = 0; i < currentIds.length; i++) {
        if (!initialIds.includes(currentIds[i])) {
          await addTextbookToCourse(targetCourseId, currentIds[i], i);
        }
      }

      // 単元設定。読み込み済みのタブだけを対象にする（＝画面に出ている全タブ）
      for (const tbId of currentIds) {
        const entry = unitsByTextbook.get(tbId);
        if (!entry) continue;
        const settings = draftsToCourseSettings(
          Array.from(entry.drafts.values()),
          entry.items.map((i) => i.id)
        );
        await replaceCourseCurriculum(targetCourseId, tbId, settings);
      }

      // total_koma は上の作成/更新で meta に含めて書いてある。
      // 単元の保存後に書き直す必要は無い（保存中に合計は変わらないため）。

      initialTextbookIdsRef.current = currentIds;
      setSavedCourseId(targetCourseId);
      setDirty(false);
      // 保存後はチェックを空に戻す（提案書エディタと同じ。保存内容は行のハイライトで分かる）
      updateDrafts((prev) => clearSelectionIn(prev));
      success('保存しました');

      if (isNew) router.replace(`/courses/${targetCourseId}`);
    } catch (err) {
      error(err instanceof Error ? err.message : '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const toggleGrade = (grade: number) => {
    setTargetGrades((prev) =>
      prev.includes(grade)
        ? prev.filter((g) => g !== grade)
        : [...prev, grade].sort((a, b) => a - b)
    );
    setDirty(true);
  };

  if (loading) {
    return <Loading className="min-h-[60vh]" />;
  }

  // ════════════════════════════════════════
  // テキスト選択（1冊も無いときは必ずここから始まる）
  // ════════════════════════════════════════
  if (showTextbookPicker || textbooks.length === 0) {
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
          backHref="/courses"
          backLabel="講習一覧に戻る"
          title="テキストを選択"
          subtitle={name.trim() || '新しい講習'}
        />
        <ToastContainer toasts={toasts} onRemove={removeToast} />
        {ConfirmDialog}
      </>
    );
  }

  // ════════════════════════════════════════
  // 編集
  // ════════════════════════════════════════
  return (
    <div className="pb-20">
      {/* ヘッダー（テンプレ名・季節・対象学年・コメント）。
          旧実装の「編集モード」は作らない。切り替えるたびに下の単元表が丸ごと消える作りだったので、
          常に編集できる形にして、保存は下部バーの1本に集約する。 */}
      <div className="mb-5">
        <div className="flex items-center justify-between mb-2">
          <Link
            href="/courses"
            className="text-sm text-text-muted hover:text-text-heading inline-flex items-center gap-1 transition-[color] duration-150 ease-out"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            講習一覧
          </Link>
          {/* 開いてみて不要と分かった講習をその場で片付けられるようにする。
              一覧まで戻って探し直させない。削除は論理削除なので文言も「アーカイブ」に揃える。 */}
          {savedCourseId && (
            <button
              onClick={handleArchive}
              disabled={archiving}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs text-text-faint hover:text-danger transition-colors duration-150 ease-out disabled:opacity-50"
              title="この講習をアーカイブ"
            >
              <Trash2 className="w-3.5 h-3.5" />
              アーカイブ
            </button>
          )}
        </div>

        <section className="p-4 bg-surface-raised rounded-xl border border-border-default space-y-3">
          <div>
            <label htmlFor="course-name" className="text-xs font-bold text-text-muted block mb-1.5">
              講習名
              <span className="ml-1 text-red-600" aria-hidden="true">
                *
              </span>
              <span className="ml-1.5 align-middle text-[10px] font-bold text-red-600">必須</span>
            </label>
            <input
              id="course-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setDirty(true);
              }}
              aria-required="true"
              className={`w-full px-3 py-2 text-sm border rounded-lg bg-surface-raised focus:ring-2 focus:ring-primary/20 focus:border-primary ${
                name.trim() ? 'border-border-default' : 'border-red-300'
              }`}
              placeholder="例: 春期講習 中1数学"
            />
          </div>

          <div className="flex gap-4 flex-wrap">
            <div>
              <span className="text-xs font-bold text-text-muted block mb-1.5">季節</span>
              <div className="flex gap-1">
                {SEASONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      setSeason(s);
                      setDirty(true);
                    }}
                    aria-pressed={season === s}
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
            <div className="flex-1 min-w-[240px]">
              <span className="text-xs font-bold text-text-muted block mb-1.5">対象学年</span>
              <div className="flex flex-wrap gap-1">
                {GRADES.map((grade) => (
                  <button
                    key={grade}
                    type="button"
                    onClick={() => toggleGrade(grade)}
                    aria-pressed={targetGrades.includes(grade)}
                    className={`px-2 py-1 text-[11px] rounded-md active:scale-[0.97] transition-[background-color,color,transform] duration-150 ease-out ${
                      targetGrades.includes(grade)
                        ? 'bg-ink text-text-on-primary font-bold'
                        : 'bg-surface-hover text-text-muted hover:bg-border-default'
                    }`}
                  >
                    {GRADE_LABELS[grade]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label
              htmlFor="course-comment"
              className="text-xs font-bold text-text-muted block mb-1.5"
            >
              コメント
            </label>
            <input
              id="course-comment"
              value={comment}
              onChange={(e) => {
                setComment(e.target.value);
                setDirty(true);
              }}
              className="w-full px-3 py-2 text-sm border border-border-default rounded-lg bg-surface-raised focus:ring-2 focus:ring-primary/20 focus:border-primary"
              placeholder="講習に関するメモ"
            />
          </div>
        </section>
      </div>

      <div className="space-y-5">
        {/* テキストのタブ。切り替えても未保存の入力は保持される（unitsByTextbook に全冊ぶん持っている） */}
        <section className="p-4 bg-surface-raised rounded-xl border border-border-default">
          <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
            <div className="text-xs font-bold text-text-muted">
              テキスト（{textbooks.length}/{MAX_TEXTBOOKS}）
            </div>
            <button
              type="button"
              onClick={() => setShowTextbookPicker(true)}
              disabled={textbooks.length >= MAX_TEXTBOOKS}
              className="px-2.5 py-1 text-[11px] font-medium bg-ink text-text-on-primary rounded-md hover:brightness-[0.85] transition-[filter] duration-150 disabled:opacity-40 inline-flex items-center gap-1"
              title={
                textbooks.length >= MAX_TEXTBOOKS
                  ? `テキストは最大${MAX_TEXTBOOKS}冊までです`
                  : undefined
              }
            >
              <Plus className="w-3 h-3" />
              テキスト追加
            </button>
          </div>
          <div className="flex gap-2 flex-wrap">
            {textbooks.map((ct) => {
              const isActive = selectedTextbookId === ct.textbook_id;
              const koma = totals.perTextbook.get(ct.textbook_id) ?? 0;
              return (
                // タブ本体と「外す」は別のボタンにする。
                // 入れ子のボタンはHTMLとして不正で、キーボードから「外す」に到達できなくなる。
                <div
                  key={ct.textbook_id}
                  className={`flex items-center rounded-lg text-sm font-medium transition-[background-color,color] duration-150 ${
                    isActive
                      ? 'bg-ink text-text-on-primary'
                      : 'bg-surface-hover text-text-body hover:bg-border-default'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedTextbookId(ct.textbook_id)}
                    aria-pressed={isActive}
                    className="pl-3 pr-2 py-1.5 rounded-l-lg"
                  >
                    {ct.textbook.name}
                    <span
                      className={`ml-1.5 text-[11px] tabular-nums ${
                        isActive ? 'text-text-on-primary/70' : 'text-text-muted'
                      }`}
                    >
                      {koma}コマ
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemoveTextbook(ct.textbook_id, ct.textbook.name)}
                    aria-label={`${ct.textbook.name} を講習から外す`}
                    title="このテキストを外す"
                    className={`pr-2.5 pl-1 py-1.5 rounded-r-lg transition-[color] duration-150 ${
                      isActive
                        ? 'text-text-on-primary/60 hover:text-text-on-primary'
                        : 'text-text-faint hover:text-danger'
                    }`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        {/* 単元。行クリックで+1、なぞりドラッグで範囲選択、G で結合（提案書エディタと同じ） */}
        <section className="p-4 bg-surface-raised rounded-xl border border-border-default">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-text-heading">対象単元を設定</h2>
            <div className="text-sm font-bold text-accent-ink">
              このテキスト {activeUnits.length}単元 /{' '}
              {totals.perTextbook.get(selectedTextbookId ?? -1) ?? 0}コマ
            </div>
          </div>

          {items.length === 0 ? (
            <p className="py-8 text-center text-sm text-text-faint">
              このテキストには単元が登録されていません
            </p>
          ) : (
            <UnitList
              items={items}
              drafts={drafts}
              // テンプレートは特定の生徒に紐づかないので、進度による消化済み判定は無い
              isDone={() => false}
              appliedMode={false}
              groupMap={groupMap}
              appliedGroupMap={EMPTY_APPLIED_GROUP_MAP}
              dragging={dragging}
              listRef={listRef}
              showColumnHeader={activeUnits.length > 0}
              // 申込コマと指導意図はテンプレートには無い（申込は生徒の話、意図は生徒ごとに決める）
              showApplied={false}
              showIntent={false}
              onToggle={toggleUnit}
              onSelectStart={startSelectDrag}
              onSelectEnter={onSelectEnter}
              onUpdate={updateUnit}
              onUngroup={ungroupUnit}
              onUngroupAll={ungroupAll}
              // 申込結合はテンプレートでは起きないので、解除も何もしない
              onUngroupApplied={() => {}}
              onUngroupAllApplied={() => {}}
            />
          )}
        </section>
      </div>

      <SelectionPill
        pos={pillPos}
        count={selectionInfo.count}
        contiguous={selectionInfo.contiguous}
        dragging={dragging}
        appliedMode={false}
        showIntent={false}
        onGroup={groupSelected}
        onGroupApplied={() => {}}
        onApplyIntent={() => {}}
      />

      <EditorBottomBar
        unitCount={totals.unitCount}
        totalKoma={totals.koma}
        totalAppliedKoma={null}
        selectedCount={selectionInfo.count}
        contiguous={selectionInfo.contiguous}
        appliedMode={false}
        onGroup={groupSelected}
        onGroupApplied={() => {}}
        onSave={handleSave}
        saving={saving}
        saveBlockers={saveBlockers}
        extraActions={
          // 生徒への登録は保存済みの講習にしかできない（新規はまだ行が無い）
          savedCourseId ? (
            <Link
              href={`/courses/${savedCourseId}/apply`}
              title="生徒ごとに下書きの提案書を作成します"
              className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-text-body border border-border-default rounded-lg hover:bg-surface-hover active:scale-[0.97] transition-[background-color,transform] duration-150 ease-out"
            >
              <Users className="w-3.5 h-3.5 mr-1" />
              生徒に登録
            </Link>
          ) : undefined
        }
      />

      <ToastContainer toasts={toasts} onRemove={removeToast} />
      {ConfirmDialog}
    </div>
  );
}
