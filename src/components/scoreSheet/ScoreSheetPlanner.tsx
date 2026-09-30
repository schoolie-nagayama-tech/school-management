'use client';

/**
 * 成績表から講習提案書を作る画面。
 * 正典: docs/score-sheet-plan-draft.md ／ モック: https://claude.ai/artifact/R7jXEeWKUVtmdqobazNnia
 *
 * 流れ：成績表（PDF）を入れる → 読み取り・検算 → 規則で下書き → いつもの単元一覧で直す → 保存（提案書N件・下書き）
 *
 * ★下書きの見た目と操作は提案書の作成画面と同じ部品を使う（決定7。見た目が似ているほうが操作しやすい）。
 *   ProposalEditor.tsx は改造しない（複数教科を持たせると壊しやすいので、部品を借りて別ページにする）。
 * ★読み取った結果は保存しない（決定15）。残るのは提案書と、単元ごとの根拠の文字列（reason）だけ。
 * ★「組み直す」と、手で直したところは消える（規則の結果に戻す）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, RefreshCw } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { fetchWithAuth } from '@/lib/api/auth';
import { ToastContainer } from '@/components/ui';
import { useToast } from '@/hooks/useToast';
import { SEASON_LABELS, type CurriculumItem, type SeasonType } from '@/types/database';
import {
  getTermProposals,
  mergeUnitsIntoProposal,
  upsertProposal,
  calcTotalKoma,
  type ProposalUnitInput,
} from '@/lib/api/proposals';
import { UnitList } from '@/components/koushu-plan/UnitList';
import { EditorBottomBar } from '@/components/koushu-plan/EditorBottomBar';
import { ProposalBookTabs } from '@/components/proposals/ProposalBookTabs';
import { getPreparingSeason, type UnitDraft } from '@/components/proposals/proposalEditor.shared';
import {
  buildGroupMap,
  groupSelectedUnits,
  setSelectionRange,
  ungroupAllInGroup,
  type DraftMap,
} from '@/components/koushu-plan/unitDraftLogic';
import {
  buildProposalSaveBlockers,
  summarizeBookSaves,
  type BookSaveOutcome,
} from '@/components/proposals/proposalMultiBook';
import { canUseAiFeature, SCORE_SHEET_FEATURE_KEY } from '@/lib/ai/features';
import { normalizeName } from '@/lib/scores/mockImportParse';
import type { MapCandidate, MapQuestion } from '@/lib/ai/scoreSheet';
import { parsePcs } from '@/lib/scoreSheet/pcsParse';
import { pickWrongItems, type WrongItem } from '@/lib/scoreSheet/mockSheet';
import { PCS_TEXTBOOK_MAPPINGS, defaultPcsMapping } from '@/lib/scoreSheet/pcsMappings';
import {
  PLAN_RULE_TEXT,
  TARGET_KOMA_G2,
  UPPER_BASE_SS,
  chooseTier,
  planCourse,
  planEnglish,
  planMath,
  type CourseTier,
} from '@/lib/scoreSheet/planRules';
import {
  addMockEvidence,
  addPcsEvidence,
  courseMockEvidence,
  emptyEvidence,
  mockQuestions,
  type UnmappedEvidence,
} from '@/lib/scoreSheet/buildEvidence';
import {
  findTorituCourses,
  indexByNo,
  loadCourseBooks,
  loadMappedTextbook,
  type CourseOption,
} from '@/lib/scoreSheet/planData';
import type { DraftUnit, MockResult, ScoreSubject } from '@/lib/scoreSheet/types';
import { SCORE_SUBJECT_LABEL } from '@/lib/scoreSheet/types';
import { HARD_RATE, HARD_SS } from '@/lib/scoreSheet/mockSheet';
import { ScoreFilesPanel, type ScoreFileEntry } from './ScoreFilesPanel';

const SUBJECTS: ScoreSubject[] = ['math', 'eng'];

interface BookState {
  subject: ScoreSubject;
  textbookId: number;
  label: string;
  items: CurriculumItem[];
  drafts: DraftMap;
}

interface SubjectPlan {
  mode: 'textbook' | 'course';
  /** 中1・中2：PCS_TEXTBOOK_MAPPINGS の添字 */
  mappingIndex: number | null;
  /** 中3 */
  tier: CourseTier | null;
  courseId: string | null;
  courseOptions: CourseOption[];
  droppedBooks: string[];
  /** 模試の×の当てはめ（AI が選び、教室長が直せる） */
  mapping: Record<string, number | null>;
  questions: MapQuestion[];
  candidates: MapCandidate[];
  unmapped: UnmappedEvidence[];
  skippedHard: WrongItem[];
  unchecked: string[];
  note: string | null;
}

const emptySubjectPlan = (): SubjectPlan => ({
  mode: 'textbook',
  mappingIndex: null,
  tier: null,
  courseId: null,
  courseOptions: [],
  droppedBooks: [],
  mapping: {},
  questions: [],
  candidates: [],
  unmapped: [],
  skippedHard: [],
  unchecked: [],
  note: null,
});

/** 教材の全単元ぶんの空の下書き（提案書エディタの emptyDraftsFor と同じ形） */
function draftsFrom(items: CurriculumItem[], drafts: DraftUnit[]): DraftMap {
  const byId = new Map(drafts.map((d) => [d.curriculum_item_id, d]));
  const m: DraftMap = new Map();
  for (const it of items) {
    const d = byId.get(it.id);
    m.set(it.id, {
      curriculum_item_id: it.id,
      koma_count: d?.koma_count ?? 0,
      applied_koma: 0,
      reason: d?.reason ?? '',
      selected: false,
      group_id: d?.group_id ?? 0,
      applied_group_id: 0,
      intent_tag: d?.intent_tag ?? null,
    });
  }
  return m;
}

const activeOf = (b: BookState) =>
  b.items.map((i) => b.drafts.get(i.id)).filter((d): d is UnitDraft => !!d && d.koma_count > 0);
const bookKoma = (b: BookState) => calcTotalKoma(activeOf(b));

export function ScoreSheetPlanner() {
  const params = useParams();
  const router = useRouter();
  const studentId = params?.studentId as string;
  const { profile } = useAuth();
  const { toasts, addToast, removeToast } = useToast();
  const canUse = canUseAiFeature(profile?.role, SCORE_SHEET_FEATURE_KEY);

  const [student, setStudent] = useState<{
    name: string;
    schoolId: string;
    grade: number | null;
  } | null>(null);
  const [season, setSeason] = useState<SeasonType>(getPreparingSeason());
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [theme, setTheme] = useState('');
  const [files, setFiles] = useState<ScoreFileEntry[]>([]);
  const [confirmedAreas, setConfirmedAreas] = useState<Record<ScoreSubject, Set<string>>>({
    math: new Set(),
    eng: new Set(),
  });
  const [plans, setPlans] = useState<Record<ScoreSubject, SubjectPlan>>({
    math: emptySubjectPlan(),
    eng: emptySubjectPlan(),
  });
  const [books, setBooks] = useState<BookState[]>([]);
  const [subject, setSubject] = useState<ScoreSubject>('math');
  const [activeBookId, setActiveBookId] = useState<number | null>(null);
  const [building, setBuilding] = useState(false);
  const [saving, setSaving] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const lastToggledRef = useRef<{ id: number; state: boolean } | null>(null);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from('students')
        .select('last_name, first_name, school_id, grade')
        .eq('id', studentId)
        .single();
      if (data) {
        setStudent({
          name: `${data.last_name} ${data.first_name}`,
          schoolId: data.school_id as string,
          grade: (data.grade as number | null) ?? null,
        });
      }
    })();
  }, [studentId]);

  // ─── 読み取り ───
  const addFiles = useCallback(
    async (list: File[]) => {
      if (!student) return;
      const { openPdf, pageTextItems, mockSheetImages } =
        await import('@/lib/scoreSheet/pdfClient');
      for (const file of list) {
        const id = `${file.name}-${file.size}-${Date.now()}`;
        setFiles((prev) => [...prev, { id, name: file.name, status: 'reading' }]);
        const update = (patch: Partial<ScoreFileEntry>) =>
          setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
        try {
          const doc = await openPdf(file);
          const items = await pageTextItems(doc, 1);
          const pcs = parsePcs(items);
          if (pcs) {
            // 氏名はページ上部の文字にある。★照合にだけ使い、どこにも残さない
            const target = normalizeName(student.name);
            const nameMismatch = !items.some((i) => normalizeName(i.str) === target);
            update({ status: 'ok', kind: 'pcs', pcs, nameMismatch });
            continue;
          }
          // 模試：1・2ページ目を画像にして AI に書き写させる
          const images = await mockSheetImages(doc);
          const res = await fetchWithAuth('/api/ai/score-sheet/read', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ schoolId: student.schoolId, images }),
          });
          const json = (await res.json()) as {
            sheet?: ScoreFileEntry['mock'] | null;
            disabled?: boolean;
            degraded?: boolean;
            error?: string;
          };
          if (!res.ok) throw new Error(json.error ?? '読み取りに失敗しました');
          if (json.disabled) {
            update({
              status: 'error',
              kind: 'mock',
              message:
                '教室の設定で「成績表の読み取り」がオフのため、模試は読み取れません（PCS は読めます）',
            });
            continue;
          }
          if (!json.sheet) {
            update({
              status: 'error',
              kind: 'mock',
              message: 'AI が帳票を読み取れませんでした。もう一度入れ直してください',
            });
            continue;
          }
          const nameMismatch =
            !!json.sheet.studentName &&
            normalizeName(json.sheet.studentName) !== normalizeName(student.name);
          // ★氏名は照合が済んだら捨てる（画面にも残さない）
          update({
            status: 'ok',
            kind: 'mock',
            mock: { ...json.sheet, studentName: null },
            nameMismatch,
          });
        } catch (e) {
          update({
            status: 'error',
            message: e instanceof Error ? e.message : '読み取れませんでした',
          });
        }
      }
    },
    [student]
  );

  const pcsFor = (s: ScoreSubject) =>
    files.find((f) => f.status === 'ok' && f.pcs?.subject === s)?.pcs ?? null;
  const mockSheet = files.find((f) => f.status === 'ok' && f.mock)?.mock ?? null;
  const readingCount = files.filter((f) => f.status === 'reading').length;

  const askMapping = useCallback(
    async (
      questions: MapQuestion[],
      candidates: MapCandidate[]
    ): Promise<{ mapping: Record<string, number | null>; note: string | null }> => {
      if (!student || questions.length === 0) return { mapping: {}, note: null };
      try {
        const res = await fetchWithAuth('/api/ai/score-sheet/map', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ schoolId: student.schoolId, questions, candidates }),
        });
        const json = (await res.json()) as {
          mapping?: Record<string, number | null>;
          disabled?: boolean;
          degraded?: boolean;
        };
        if (json.disabled)
          return {
            mapping: {},
            note: '「成績表の読み取り」がオフのため、模試の×を単元に当てられませんでした。下の当てはめ表で選べます',
          };
        if (json.degraded)
          return {
            mapping: json.mapping ?? {},
            note: 'AI が当てはめを返せませんでした。下の当てはめ表で選べます',
          };
        return { mapping: json.mapping ?? {}, note: null };
      } catch {
        return { mapping: {}, note: '当てはめを取得できませんでした。下の当てはめ表で選べます' };
      }
    },
    [student]
  );

  // ─── 規則で下書きを組む（教科ごと） ───
  const buildSubject = useCallback(
    async (
      s: ScoreSubject,
      override: Partial<SubjectPlan> = {}
    ): Promise<{ plan: SubjectPlan; books: BookState[] } | null> => {
      if (!student) return null;
      const pcs = pcsFor(s);
      const mock = mockSheet && mockSheet.subjects[s] ? mockSheet : null;
      if (!pcs && !mock) return null;
      const plan: SubjectPlan = { ...emptySubjectPlan(), ...override };
      const picked = mock
        ? pickWrongItems(mock, s, confirmedAreas[s])
        : { wrong: [], skippedHard: [], unchecked: [] };
      plan.skippedHard = picked.skippedHard;
      plan.unchecked = picked.unchecked;
      const questions = mockQuestions(picked.wrong);
      plan.questions = questions;

      // 中3でVもぎ → 講習一覧の都立対策コースに当てる。それ以外 → 教材の単元に当てる
      if (student.grade === 9 && mock?.docType === 'vmogi_tokyo') {
        plan.mode = 'course';
        plan.courseOptions = await findTorituCourses(student.schoolId, s);
        plan.tier = override.tier ?? chooseTier(mock.firstChoice?.baseSs);
        plan.courseId =
          override.courseId ??
          plan.courseOptions.find((c) => c.tier === plan.tier)?.id ??
          plan.courseOptions[0]?.id ??
          null;
        if (!plan.courseId) {
          plan.note = 'この教室の講習一覧に「都立入試対策」のコース（冬期・中3）が見つかりません';
          return { plan, books: [] };
        }
        const courseBooks = await loadCourseBooks(plan.courseId, s);
        plan.candidates = courseBooks.flatMap((b) =>
          b.units
            .filter((u) => u.tplKoma != null)
            .map((u) => ({ id: u.id, label: `${b.label} ${u.no ?? ''} ${u.title}`.trim() }))
        );
        // 当てはめ表で選び直したときは、その選び方をそのまま使う（AI に聞き直さない）
        const asked = override.mapping
          ? { mapping: override.mapping, note: null }
          : await askMapping(questions, plan.candidates);
        plan.mapping = asked.mapping;
        plan.note = asked.note;
        const { byBook, unmapped } = courseMockEvidence(
          picked.wrong,
          plan.mapping,
          courseBooks,
          mock.docType
        );
        plan.unmapped = unmapped;
        const result = planCourse(courseBooks, byBook);
        plan.droppedBooks = result.droppedBooks;
        const next: BookState[] = result.books.map((rb) => {
          const cb = courseBooks.find((b) => b.textbookId === rb.textbookId)!;
          return {
            subject: s,
            textbookId: rb.textbookId,
            label: rb.label,
            items: cb.items,
            drafts: draftsFrom(cb.items, rb.drafts),
          };
        });
        return { plan, books: next };
      }

      plan.mode = 'textbook';
      const options = PCS_TEXTBOOK_MAPPINGS.map((m, i) => ({ m, i })).filter(
        (x) => x.m.subject === s
      );
      const def = defaultPcsMapping(s, student.grade);
      plan.mappingIndex =
        override.mappingIndex ??
        (def ? PCS_TEXTBOOK_MAPPINGS.indexOf(def) : (options[0]?.i ?? null));
      if (plan.mappingIndex == null) return { plan, books: [] };
      const mapping = PCS_TEXTBOOK_MAPPINGS[plan.mappingIndex];
      const tb = await loadMappedTextbook(mapping);
      if (!tb) {
        plan.note = `教材「${mapping.textbook.grade} ${mapping.textbook.subject} ${mapping.textbook.name}」が教材マスタに見つかりません`;
        return { plan, books: [] };
      }
      const ev = emptyEvidence();
      if (pcs) addPcsEvidence(ev, pcs, mapping.map, indexByNo(tb.units));
      if (mock && questions.length > 0) {
        plan.candidates = tb.units.map((u) => ({
          id: u.id,
          label: `${tb.label} ${u.no ?? ''} ${u.title}`.trim(),
        }));
        const asked = override.mapping
          ? { mapping: override.mapping, note: null }
          : await askMapping(questions, plan.candidates);
        plan.mapping = asked.mapping;
        plan.note = asked.note;
        addMockEvidence(ev, picked.wrong, plan.mapping, tb.units, mock.docType);
      }
      plan.unmapped = ev.unmapped;
      const input = { evidence: ev.evidence, goodPcs: ev.goodPcs };
      const drafts =
        s === 'math'
          ? planMath(tb.units, input, mapping.calcRange ?? { chapters: [], extra: [] })
          : planEnglish(tb.units, input);
      return {
        plan,
        books: [
          {
            subject: s,
            textbookId: tb.textbookId,
            label: tb.label,
            items: tb.items,
            drafts: draftsFrom(tb.items, drafts),
          },
        ],
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [student, files, confirmedAreas, askMapping]
  );

  const rebuild = useCallback(
    async (only?: ScoreSubject, override: Partial<SubjectPlan> = {}) => {
      setBuilding(true);
      try {
        const targets = only ? [only] : SUBJECTS;
        const results = await Promise.all(
          targets.map((s) => buildSubject(s, only ? override : {}))
        );
        setPlans((prev) => {
          const next = { ...prev };
          targets.forEach((s, i) => {
            next[s] = results[i]?.plan ?? emptySubjectPlan();
          });
          return next;
        });
        setBooks((prev) => {
          const kept = prev.filter((b) => !targets.includes(b.subject));
          const added = results.flatMap((r) => r?.books ?? []);
          return [...kept, ...added].sort(
            (a, b) => SUBJECTS.indexOf(a.subject) - SUBJECTS.indexOf(b.subject)
          );
        });
      } finally {
        setBuilding(false);
      }
    },
    [buildSubject]
  );

  // 読み取りが全部終わったら組む（ファイルを足したときも組み直す）
  const readSignature = files.map((f) => `${f.id}:${f.status}`).join('|');
  useEffect(() => {
    if (!student || readingCount > 0 || !files.some((f) => f.status === 'ok')) return;
    void rebuild();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readSignature, student]);

  // 教科の最初の冊を開く
  const subjectBooks = books.filter((b) => b.subject === subject);
  const activeBook =
    subjectBooks.find((b) => b.textbookId === activeBookId) ?? subjectBooks[0] ?? null;

  // ─── 単元の操作（提案書エディタと同じ動き） ───
  const setDrafts = (textbookId: number, fn: (d: DraftMap) => DraftMap) =>
    setBooks((prev) =>
      prev.map((b) =>
        b.textbookId === textbookId && b.subject === subject ? { ...b, drafts: fn(b.drafts) } : b
      )
    );
  const orderedIds = activeBook ? activeBook.items.map((i) => i.id) : [];
  const toggle = (id: number, shift: boolean) => {
    if (!activeBook) return;
    setDrafts(activeBook.textbookId, (drafts) => {
      const cur = drafts.get(id);
      if (!cur) return drafts;
      const target = !cur.selected;
      if (shift && lastToggledRef.current) {
        return setSelectionRange(
          drafts,
          orderedIds,
          lastToggledRef.current.id,
          id,
          lastToggledRef.current.state
        );
      }
      lastToggledRef.current = { id, state: target };
      const next = new Map(drafts);
      next.set(id, { ...cur, selected: target });
      return next;
    });
  };
  const update = (id: number, patch: Partial<UnitDraft>) => {
    if (!activeBook) return;
    setDrafts(activeBook.textbookId, (drafts) => {
      const cur = drafts.get(id);
      if (!cur) return drafts;
      const next = new Map(drafts);
      next.set(id, { ...cur, ...patch });
      return next;
    });
  };
  const ungroupOne = (id: number) => {
    if (!activeBook) return;
    setDrafts(activeBook.textbookId, (drafts) => {
      const cur = drafts.get(id);
      if (!cur || cur.group_id === 0) return drafts;
      const gid = cur.group_id;
      const next = new Map(drafts);
      next.set(id, { ...cur, group_id: 0 });
      const rest = Array.from(next.values()).filter((d) => d.group_id === gid);
      if (rest.length === 1) next.set(rest[0].curriculum_item_id, { ...rest[0], group_id: 0 });
      return next;
    });
  };
  const groupSelected = () => {
    if (!activeBook) return;
    const maxGid = Math.max(0, ...Array.from(activeBook.drafts.values()).map((d) => d.group_id));
    const r = groupSelectedUnits(activeBook.drafts, orderedIds, maxGid + 1, 'proposal');
    if (!r.ok) {
      addToast(
        r.reason === 'too-few' ? '2つ以上選んでください' : '隣り合う単元だけまとめられます',
        'error'
      );
      return;
    }
    setDrafts(activeBook.textbookId, () => r.drafts);
  };

  const activeUnits = useMemo(() => (activeBook ? activeOf(activeBook) : []), [activeBook]);
  const groupMap = useMemo(() => buildGroupMap(activeUnits, 'proposal'), [activeUnits]);
  const selection = activeBook
    ? Array.from(activeBook.drafts.values()).filter((d) => d.selected)
    : [];
  const contiguous = (() => {
    const idx = selection
      .map((d) => orderedIds.indexOf(d.curriculum_item_id))
      .sort((a, b) => a - b);
    return idx.length >= 2 && idx.every((v, i) => i === 0 || v === idx[i - 1] + 1);
  })();

  // ─── 保存（いまの新規作成と同じ：1冊＝提案書1件、同じ期にあれば足す） ───
  const perBook = books.map((b, i) => ({
    name: b.label,
    koma: bookKoma(b),
    order: i + 1,
    textbookId: b.textbookId,
  }));
  const saveBlockers = [
    ...buildProposalSaveBlockers({
      theme,
      books: perBook.map((b) => ({ name: b.name, koma: b.koma })),
    }),
    ...(readingCount > 0 ? ['成績表を読み取っています'] : []),
  ];
  const handleSave = async () => {
    if (saveBlockers.length > 0 || !student) {
      addToast(saveBlockers[0] ?? '保存できません', 'error');
      return;
    }
    setSaving(true);
    try {
      const term = await getTermProposals(studentId, season, year);
      const outcomes: BookSaveOutcome[] = [];
      // ★並列にしない。created_at の順＝進める順・印刷でまとめる順（ProposalEditor と同じ理由）
      for (const b of books) {
        const units: ProposalUnitInput[] = activeOf(b).map((d) => ({
          curriculum_item_id: d.curriculum_item_id,
          koma_count: d.koma_count,
          applied_koma: null,
          reason: d.reason,
          group_id: d.group_id,
          applied_group_id: 0,
          intent_tag: d.intent_tag,
        }));
        try {
          const existing = term.find((p) => p.textbook_id === b.textbookId);
          if (existing?.status === 'approved') {
            // 公開済みの提案書には、ここから単元を足さない（進行表と同期済みでずれるため）
            outcomes.push({ textbookId: b.textbookId, name: b.label, proposalId: null });
            continue;
          }
          const proposalId = existing
            ? await mergeUnitsIntoProposal(existing.id, units)
            : (
                await upsertProposal({
                  studentId,
                  textbookId: b.textbookId,
                  studentTextbookId: null,
                  schoolId: student.schoolId,
                  season,
                  year,
                  theme,
                  notes: null,
                  units,
                })
              ).id;
          outcomes.push({ textbookId: b.textbookId, name: b.label, proposalId });
        } catch (e) {
          console.error('提案書の保存に失敗:', e);
          outcomes.push({ textbookId: b.textbookId, name: b.label, proposalId: null });
        }
      }
      const summary = summarizeBookSaves(outcomes);
      addToast(summary.message, summary.tone);
      if (summary.allSucceeded) router.push(`/students/${studentId}/proposals`);
      else setBooks((prev) => prev.filter((b) => !summary.savedTextbookIds.includes(b.textbookId)));
    } finally {
      setSaving(false);
    }
  };

  // ─── 表示 ───
  if (!canUse) {
    return (
      <div className="p-6 text-sm text-text-muted">
        成績表から作るのは教室長以上です。
        <Link href={`/students/${studentId}/proposals`} className="ml-2 underline">
          提案書一覧に戻る
        </Link>
      </div>
    );
  }

  const totalKoma = perBook.reduce((a, b) => a + b.koma, 0);
  const subjectKoma = (s: ScoreSubject) =>
    books.filter((b) => b.subject === s).reduce((a, b) => a + bookKoma(b), 0);
  const plan = plans[subject];
  const hasAny = files.some((f) => f.status === 'ok');

  return (
    <div className="pb-24 space-y-5">
      <div>
        <Link
          href={`/students/${studentId}/proposals`}
          className="text-sm text-text-muted hover:text-text-heading inline-flex items-center gap-1"
        >
          <ArrowLeft className="w-4 h-4" />
          提案書一覧に戻る
        </Link>
        <h1 className="mt-2 text-lg font-bold text-text-heading">成績表から講習提案書を作る</h1>
        <p className="text-sm text-text-muted mt-0.5">
          {student?.name ?? ''} / {year}年 {SEASON_LABELS[season]}講習
        </p>
      </div>

      <ScoreFilesPanel
        files={files}
        confirmedAreas={confirmedAreas}
        onAddFiles={(list) => void addFiles(list)}
        onFlipResult={(fileId, s, area, itemIndex, next: MockResult) =>
          setFiles((prev) =>
            prev.map((f) => {
              if (f.id !== fileId || !f.mock) return f;
              const subjects = { ...f.mock.subjects };
              subjects[s] = (subjects[s] ?? []).map((a) =>
                a.name !== area
                  ? a
                  : {
                      ...a,
                      items: a.items.map((it, i) =>
                        i === itemIndex ? { ...it, result: next } : it
                      ),
                    }
              );
              return { ...f, mock: { ...f.mock, subjects } };
            })
          )
        }
        onConfirmArea={(s, area) => {
          setConfirmedAreas((prev) => ({ ...prev, [s]: new Set([...Array.from(prev[s]), area]) }));
          addToast(
            '確かめた領域を下書きに入れるには「成績表から組み直す」を押してください',
            'success'
          );
        }}
      />

      {hasAny && (
        <>
          <OriginBand
            grade={student?.grade ?? null}
            plans={plans}
            mockFirstChoice={mockSheet?.firstChoice ?? null}
            ss={mockSheet?.ss ?? {}}
            subjectKoma={subjectKoma}
            total={totalKoma}
            building={building}
            onRebuild={() => void rebuild()}
          />

          <section className="p-4 bg-surface-raised rounded-xl border border-border">
            <div className="flex gap-4 flex-wrap">
              <div>
                <label className="text-xs font-bold text-text-muted block mb-1.5">シーズン</label>
                <div className="flex gap-1">
                  {(['spring', 'summer', 'winter'] as SeasonType[]).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setSeason(s)}
                      className={`px-3 py-1.5 text-xs rounded-lg font-medium ${
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
                <label
                  htmlFor="score-year"
                  className="text-xs font-bold text-text-muted block mb-1.5"
                >
                  年度
                </label>
                <input
                  id="score-year"
                  type="number"
                  value={year}
                  onChange={(e) => setYear(Number(e.target.value))}
                  className="w-24 px-3 py-1.5 text-sm border border-border rounded-lg bg-surface-raised"
                />
              </div>
            </div>
          </section>

          <section className="p-4 bg-surface-raised rounded-xl border border-border space-y-3">
            <div className="flex gap-1 flex-wrap items-center">
              <span className="text-xs font-bold text-text-muted mr-1">教科</span>
              {SUBJECTS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setSubject(s);
                    setActiveBookId(null);
                  }}
                  aria-pressed={subject === s}
                  className={`px-3 py-1.5 text-xs rounded-lg font-medium ${
                    subject === s
                      ? 'bg-ink text-text-on-primary'
                      : 'bg-surface-hover text-text-body hover:bg-border-default'
                  }`}
                >
                  {SCORE_SUBJECT_LABEL[s]}（{books.filter((b) => b.subject === s).length}冊・
                  {subjectKoma(s)}コマ）
                </button>
              ))}
            </div>

            {subjectBooks.length > 0 ? (
              <ProposalBookTabs
                books={subjectBooks.map((b) => ({
                  textbookId: b.textbookId,
                  label: b.label,
                  koma: bookKoma(b),
                }))}
                selectedTextbookId={activeBook?.textbookId ?? null}
                onSwitch={(id) => setActiveBookId(id)}
                onRemove={(id) =>
                  setBooks((prev) =>
                    prev.filter((b) => !(b.subject === subject && b.textbookId === id))
                  )
                }
                onReorder={(ids) =>
                  setBooks((prev) => {
                    const others = prev.filter((b) => b.subject !== subject);
                    const mine = ids
                      .map((id) => prev.find((b) => b.subject === subject && b.textbookId === id))
                      .filter((b): b is BookState => !!b);
                    return [...others, ...mine].sort(
                      (a, b) => SUBJECTS.indexOf(a.subject) - SUBJECTS.indexOf(b.subject)
                    );
                  })
                }
                alwaysRemovable
              />
            ) : (
              <p className="text-xs text-text-muted">
                {building ? '組んでいます…' : (plan.note ?? 'この教科の成績表がありません')}
              </p>
            )}

            <SubjectControls
              plan={plan}
              subject={subject}
              building={building}
              onPickMapping={(i) => void rebuild(subject, { mappingIndex: i })}
              onPickCourse={(courseId, tier) => void rebuild(subject, { courseId, tier })}
            />
          </section>

          <section className="p-4 bg-surface-raised rounded-xl border border-border space-y-2">
            <label htmlFor="score-theme" className="text-sm font-bold text-text-heading block">
              講習テーマ<span className="ml-1.5 text-[10px] font-bold text-red-600">必須</span>
            </label>
            <input
              id="score-theme"
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              className={`w-full px-3 py-2 text-sm border rounded-lg bg-surface-raised ${theme.trim() ? 'border-border' : 'border-red-300'}`}
              placeholder="例: 1年生の総復習 / 都立入試対策"
            />
            <p className="text-[11px] text-text-faint">
              テーマは全冊に共通で入ります。保存後は、いつもの編集画面の「書き足す」で根拠をもとにふくらませられます
            </p>
          </section>

          {activeBook && (
            <section className="p-4 bg-surface-raised rounded-xl border border-border">
              <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
                <h2 className="text-sm font-bold text-text-heading">対象単元を選択</h2>
                <span className="text-sm font-bold text-accent-ink">
                  {activeUnits.length}単元 / {bookKoma(activeBook)}コマ
                </span>
              </div>
              <UnitList
                items={activeBook.items}
                drafts={activeBook.drafts}
                isDone={() => false}
                appliedMode={false}
                groupMap={groupMap}
                appliedGroupMap={new Map()}
                dragging={false}
                listRef={listRef}
                showColumnHeader={false}
                showApplied={false}
                renderExtra={(id) => (
                  <ReasonChips
                    reason={activeBook.drafts.get(id)?.reason ?? ''}
                    course={plan.mode === 'course'}
                  />
                )}
                onToggle={toggle}
                onSelectStart={(idx, shift) => toggle(orderedIds[idx], shift)}
                onSelectEnter={() => {}}
                onUpdate={update}
                onUngroup={ungroupOne}
                onUngroupAll={(gid) =>
                  setDrafts(activeBook.textbookId, (d) => ungroupAllInGroup(d, gid, 'proposal'))
                }
                onUngroupApplied={() => {}}
                onUngroupAllApplied={() => {}}
              />
              <MappingTable
                plan={plan}
                onChange={(key, unitId) =>
                  void rebuild(subject, { ...plan, mapping: { ...plan.mapping, [key]: unitId } })
                }
              />
            </section>
          )}
        </>
      )}

      <EditorBottomBar
        unitCount={activeUnits.length}
        totalKoma={activeBook ? bookKoma(activeBook) : 0}
        totalAppliedKoma={null}
        selectedCount={selection.length}
        contiguous={contiguous}
        appliedMode={false}
        onGroup={groupSelected}
        onGroupApplied={() => {}}
        onSave={() => void handleSave()}
        saving={saving}
        saveBlockers={saveBlockers}
        saveLabel={`保存（提案書${books.length}件）`}
        saveHint={
          <span className="text-[11px] text-text-muted tabular-nums">
            {SUBJECTS.map((s) => `${SCORE_SUBJECT_LABEL[s]} ${subjectKoma(s)}コマ`).join(' / ')}
            <span className="ml-2 font-bold text-text-heading">合計 {totalKoma}コマ</span>
          </span>
        }
      />
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}

/** 上の帯：なぜこう組んだか（数字と理由はシステムが出す） */
function OriginBand({
  grade,
  plans,
  mockFirstChoice,
  ss,
  subjectKoma,
  total,
  building,
  onRebuild,
}: {
  grade: number | null;
  plans: Record<ScoreSubject, SubjectPlan>;
  mockFirstChoice: { name: string; baseSs: number | null } | null;
  ss: Partial<Record<ScoreSubject, number>>;
  subjectKoma: (s: ScoreSubject) => number;
  total: number;
  building: boolean;
  onRebuild: () => void;
}) {
  const isCourse = SUBJECTS.some((s) => plans[s].mode === 'course');
  const [lo, hi] = TARGET_KOMA_G2;
  const judge = total < lo ? '少なめ' : total > hi ? '多め' : '目安どおり';
  return (
    <div className="rounded-xl border border-border bg-info-subtle px-4 py-3 space-y-1.5 text-xs text-text-body">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-sm font-bold text-text-heading">
          成績表から作った下書き　
          {SUBJECTS.map((s) => `${SCORE_SUBJECT_LABEL[s]} ${subjectKoma(s)}コマ`).join(
            '・'
          )}（合計 {total}コマ）
        </span>
        <button
          type="button"
          onClick={onRebuild}
          disabled={building}
          className="inline-flex items-center gap-1 rounded-md bg-accent-ink-subtle px-2 py-1 text-[11px] text-accent-ink disabled:opacity-50"
          title="手で直したところは消えて、規則の結果に戻ります"
        >
          {building ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <RefreshCw className="w-3 h-3" />
          )}
          成績表から組み直す
        </button>
      </div>
      {grade === 8 && !isCourse && (
        <p>
          2教科の目安は {lo}〜{hi}コマ（30前後）：<b>{judge}</b>
        </p>
      )}
      {isCourse ? (
        <>
          <p>
            <b>使う教材</b>：第1志望 {mockFirstChoice?.name ?? '（読めず）'} の合格基準は偏差値
            {mockFirstChoice?.baseSs ?? '（読めず）'} →{' '}
            {chooseTier(mockFirstChoice?.baseSs) === 'upper' ? '上位校' : '中堅校'}
            の組み合わせ（基準{UPPER_BASE_SS}以上で上位校）
          </p>
          <p>
            ×が当たった単元を、講習一覧のコースのまとまりごと入れます（基本のコマはコースの設定どおり・根拠2つ以上で＋1）。過去問は全員5年度分。
            難問を2コマにするかは教室長が決めます
          </p>
        </>
      ) : (
        SUBJECTS.map((s) => (
          <p key={s}>
            <b>{SCORE_SUBJECT_LABEL[s]}</b>：{PLAN_RULE_TEXT[s]}
          </p>
        ))
      )}
      <p>
        <b>難問</b>（全体正答率{HARD_RATE}%未満の×）：
        {SUBJECTS.map((s) => {
          const v = ss[s];
          if (v == null) return `${SCORE_SUBJECT_LABEL[s]} 偏差値なし`;
          return `${SCORE_SUBJECT_LABEL[s]} 偏差値${v}${v >= HARD_SS ? '→入れる' : '→入れない'}`;
        }).join('／')}
      </p>
      {SUBJECTS.some((s) => plans[s].skippedHard.length > 0) && (
        <p className="text-text-muted">
          入れなかった難問：
          {SUBJECTS.flatMap((s) =>
            plans[s].skippedHard.map(
              (w) => `${SCORE_SUBJECT_LABEL[s]} ${w.q} ${w.content}（${w.rate}%）`
            )
          ).join('、')}
        </p>
      )}
      {SUBJECTS.some((s) => plans[s].unchecked.length > 0) && (
        <p className="font-bold text-danger">
          検算が合わず下書きに使っていない領域：
          {SUBJECTS.flatMap((s) =>
            plans[s].unchecked.map((a) => `${SCORE_SUBJECT_LABEL[s]}／${a}`)
          ).join('、')}
          （成績表の欄で○×を直してください）
        </p>
      )}
      {SUBJECTS.some((s) => plans[s].droppedBooks.length > 0) && (
        <p className="text-text-muted">
          コースにはあるが、今回は当てる×が無かった冊（入れていない）：
          {SUBJECTS.flatMap((s) => plans[s].droppedBooks).join('、')}
        </p>
      )}
    </div>
  );
}

/** 教科ごとの切り替え：中1・中2はテキスト、中3はコース（中堅校・上位校） */
function SubjectControls({
  plan,
  subject,
  building,
  onPickMapping,
  onPickCourse,
}: {
  plan: SubjectPlan;
  subject: ScoreSubject;
  building: boolean;
  onPickMapping: (index: number) => void;
  onPickCourse: (courseId: string, tier: CourseTier | null) => void;
}) {
  if (plan.mode === 'course') {
    if (plan.courseOptions.length === 0) return null;
    return (
      <div className="flex items-center gap-2 flex-wrap text-xs text-text-muted border-t border-dashed border-border-subtle pt-2">
        <label htmlFor={`course-${subject}`}>教材の組み合わせを変える</label>
        <select
          id={`course-${subject}`}
          value={plan.courseId ?? ''}
          disabled={building}
          onChange={(e) => {
            const c = plan.courseOptions.find((o) => o.id === e.target.value);
            if (c) onPickCourse(c.id, c.tier);
          }}
          className="px-2 py-1 text-sm border border-border rounded-lg bg-surface-raised text-text-heading"
        >
          {plan.courseOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <span>変えると、模試の×をそのコースの単元に当て直します</span>
      </div>
    );
  }
  const options = PCS_TEXTBOOK_MAPPINGS.map((m, i) => ({ m, i })).filter(
    (x) => x.m.subject === subject
  );
  if (options.length === 0 || plan.mappingIndex == null) return null;
  return (
    <div className="flex items-center gap-2 flex-wrap text-xs text-text-muted border-t border-dashed border-border-subtle pt-2">
      <label htmlFor={`tb-${subject}`}>この教科のテキストを差し替える</label>
      <select
        id={`tb-${subject}`}
        value={plan.mappingIndex}
        disabled={building}
        onChange={(e) => onPickMapping(Number(e.target.value))}
        className="px-2 py-1 text-sm border border-border rounded-lg bg-surface-raised text-text-heading"
      >
        {options.map(({ m, i }) => (
          <option key={i} value={i}>
            {m.textbook.grade} {m.textbook.subject} {m.textbook.name}
          </option>
        ))}
      </select>
      <span>差し替えると、成績表からこの教科の単元とコマを組み直します</span>
    </div>
  );
}

/** 単元行の下の根拠の札。reason（保存される文字列）をそのまま割って出す */
function ReasonChips({ reason, course }: { reason: string; course: boolean }) {
  if (!reason) return null;
  const parts = reason.split('／').filter(Boolean);
  const hard = reason.includes('（難問）');
  return (
    <div className="flex flex-wrap gap-1">
      {parts.map((p, i) => {
        const [src, ...rest] = p.split(' ');
        const known =
          src === 'PCS' || src === '進研' || src === 'Vもぎ' || src === '前後：弱い単元のあいだ';
        return (
          <span
            key={i}
            className={`text-[10.5px] rounded border px-1.5 ${
              p.startsWith('食い違い')
                ? 'border-danger text-danger'
                : 'border-border text-text-body bg-surface-raised'
            }`}
          >
            {known && rest.length > 0 ? (
              <>
                <b className={src === 'PCS' ? 'text-purple-700 mr-1' : 'text-teal-700 mr-1'}>
                  {src}
                </b>
                {rest.join(' ')}
              </>
            ) : (
              p
            )}
          </span>
        );
      })}
      {course && hard && (
        <span className="text-[10.5px] rounded border border-warning text-warning px-1.5">
          難問を含む。2コマにするかは教室長が判断
        </span>
      )}
    </div>
  );
}

/** 模試の×の当てはめ表（AI が選んだものを、教室長が選び直せる） */
function MappingTable({
  plan,
  onChange,
}: {
  plan: SubjectPlan;
  onChange: (key: string, unitId: number | null) => void;
}) {
  if (plan.questions.length === 0 && plan.unmapped.length === 0) return null;
  return (
    <div className="mt-3 space-y-2 border-t border-border-subtle pt-3">
      {plan.note && <p className="text-xs font-bold text-warning">{plan.note}</p>}
      {plan.unmapped.length > 0 && (
        <div className="text-xs">
          <p className="font-bold text-text-heading">
            テキストに当てはまる単元が無いもの（{plan.unmapped.length}件）
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {plan.unmapped.map((u, i) => (
              <span
                key={i}
                className="rounded border border-border bg-surface-raised px-1.5 text-[10.5px]"
              >
                <b className="mr-1">{u.srcLabel}</b>
                {u.label} {u.mark}
              </span>
            ))}
          </div>
          <p className="mt-1 text-text-faint">
            別のテキストを足して補うか、見送るかを決めてください。
          </p>
        </div>
      )}
      {plan.questions.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer font-bold text-accent-ink">
            当てはめを見る・直す（模試の×の設問 → 単元）
          </summary>
          <table className="mt-2 w-full">
            <tbody>
              {plan.questions.map((q) => (
                <tr key={q.key} className="border-b border-border-subtle">
                  <td className="py-1 pr-2 whitespace-nowrap text-text-muted">{q.q}</td>
                  <td className="py-1 pr-2">{q.content}</td>
                  <td className="py-1">
                    <select
                      value={plan.mapping[q.key] ?? ''}
                      onChange={(e) =>
                        onChange(q.key, e.target.value ? Number(e.target.value) : null)
                      }
                      className="w-full max-w-xs px-1 py-0.5 border border-border rounded bg-surface-raised"
                      aria-label={`${q.q} ${q.content} の当てはめ`}
                    >
                      <option value="">当てない</option>
                      {plan.candidates.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-text-faint">
            選び直すと、この教科を組み直します（手で直したところは消えます）。
          </p>
        </details>
      )}
    </div>
  );
}
