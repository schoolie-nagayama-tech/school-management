'use client';

/**
 * 面談ワークスペース: 「面談で話すこと」カード（旧「報告事項」カード）
 * ------------------------------------------------------------------
 * ページ最上段・全幅に置く。データの種類順（成績／授業の様子…）ではなく
 * 面談の流れ順（①導入〜⑦クロージング）で並べる。
 *
 * ★2026-09の組み替えで、各シーンを2列にした（正典:
 *   docs/interview-workspace-layout-2026-09.md）。
 *   - 左＝話すこと（定型・聞く・AIの着眼点・つながり・見せる物・想定問答）
 *   - 右＝事実（システムが記録から組んだ数字の行）
 *   左を上から追えば面談が進み、右はその根拠になる。
 * ★シーンの開閉（旧 SCENE_OPEN_BY_DEFAULT）は廃止した。縦に全部出す並びに変えたので、
 *   畳んでおくと「左を追えば進む」が成立しない。
 *
 * 正典: docs/interview-script-ai-plan.md
 *
 * ★AIに投げる単位は従来どおり「セクション」のまま。シーンへの割り当ては
 *   src/lib/interview/scenes.ts の固定テーブルが決める（AIに順番を決めさせない）。
 * ★現状の行（tell）はここ（システム）が組む。AIが書くのは「見えること」（seen）
 *   「つなげて見えること」（thread）「④の課題と⑤のプランのつながり」（bridge）だけ。
 *   数字をAIに触らせないのは、書き写しの1字違いに面談の場で誰も気づけないため。
 * ★「聞く」（ask）はNESTに記録が無いので面談で確認する項目。チェックできるが保存しない
 *   （面談中の消し込み用。押した印は生徒を切り替えると消える）。
 * ★「見せる」（show）は手元に用意する物の固定リスト。PCS・ETSの回収状況やプラン表の
 *   実データ連携はまだ無いので、ここでは断定を避けた文言にしてある（scenes.ts の SHOW_LINES）。
 * ★保存しない。押すたびにその場で作り、画面を離れると消える。
 *
 * ★「授業の様子」（進行表の引継ぎ）と「保護者と」（チャット）だけは面談画面が読んでいない。
 *   この2つはサーバー（/api/ai/interview/brief）が足す。
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Sparkles, RefreshCw, FileText, ArrowRight, HelpCircle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { isOwnerOrAbove } from '@/lib/utils/roles';
import { fetchWithAuth } from '@/lib/api/auth';
import { STUDENT_DIGEST_FEATURE_KEY } from '@/lib/ai/features';
import { recordAiFeedback } from '@/lib/ai/feedback';
import { DigestVerdictChips } from '@/components/ai/DigestVerdictChips';
import {
  SELECTABLE_MODEL_KEY_LABELS as MODEL_LABELS,
  type BriefSectionKey,
  type BriefSign,
  type SelectableModelKey,
} from '@/lib/ai/interviewBrief';
import type { AssessmentWithScores, Student, StudentInterview } from '@/types/database';
import type { DisciplineSessionRow } from '@/lib/api/progress-sessions';
import type { KoushuEnrollment } from '@/lib/api/seasonalCourses';
import type { ScheduleRegularPattern } from '@/types/schedule';
import type { StudentExamGoalWithType } from '@/lib/api/progress';
import type { TargetSchoolRow } from '@/lib/api/targetSchools';
import { SEASON_LABELS } from '@/types/database';
import type { TextbookProgressData } from './ProgressPanel';
import {
  buildTellSections,
  buildGoalAchievementLines,
  buildMissingRecordAskLines,
  buildTargetSchoolGapLines,
  currentSeason,
  formatRegularPatternsSchedule,
  INTERVIEW_CARD_IDS,
} from './interview.shared';
import {
  SCENE_KEYS,
  SCENE_LABEL,
  SCENE_OF_SECTION,
  ASK_LINES,
  SHOW_LINES,
  INTRO_LINES,
  CLOSING_LINES,
  APPLY_LINES,
  timingLines,
  timingQa,
  planRationaleLines,
  isExamGrade,
  type SceneKey,
} from '@/lib/interview/scenes';
import { examCountdownLine, examApplicationLine } from '@/lib/interview/examDates';
import { regionOfSchool } from '@/lib/interview/region';

/** 画面に出す1セクション（APIの戻り） */
export interface ScriptSectionView {
  key: BriefSectionKey;
  label: string;
  current: string[];
  seen: string;
  sign: BriefSign;
}

/** 印刷シートにも渡す結果。★親（InterviewWorkspace）が持つ */
export interface ScriptView {
  sections: ScriptSectionView[];
  thread: string;
  /** ④の課題と⑤のプランのつながり。koushu セクションを渡していなければ空文字 */
  bridge: string;
}

interface ScriptResponse extends ScriptView {
  degraded: boolean;
  disabled: boolean;
  /** 実際に使ったモデルのID。表示にしか使わない（判断はサーバー側で完結している） */
  model: string;
  modelKey: SelectableModelKey;
}

interface Props {
  student: Student;
  /** 成績（ScorePanel と同じもの） */
  assessments: AssessmentWithScores[];
  /** 面談記録。タスク種別を含んでいてよい（中で除く） */
  interviews: StudentInterview[];
  /** 進行表の生データ（ProgressPanel と同じもの） */
  textbookData: TextbookProgressData[];
  /** 宿題・遅刻の生セッション行（DisciplinePanel と同じもの） */
  disciplineSessions: DisciplineSessionRow[];
  koushuEnrollments: KoushuEnrollment[];
  /** 通塾日程。⑤プラン提示の「通常授業との関係」に使う */
  regularPatterns: ScheduleRegularPattern[];
  /** 試験目標（②ヒアリング「目標の達成度」の材料） */
  examGoals: StudentExamGoalWithType[];
  /** 志望校（④現状の確認「志望校との差」の材料） */
  targetSchools: TargetSchoolRow[];
  /** 材料の読み込み中はボタンを押させない（半端な材料でまとめても作り直しになる） */
  loading?: boolean;
  /** 結果を親へ上げる。印刷シートが同じ内容を出すため */
  onResult: (view: ScriptView | null) => void;
  /**
   * カードの上に出す帯（「話すこと」）。
   * ★カードと対で消えてほしいのでカード側に持たせる。教室でAIがオフのときは
   *   カードごと出ないため、帯だけが残ると中身の無い見出しになる。
   */
  band?: ReactNode;
}

/** BRIEF_SECTIONS の並びのまま、そのシーンに属するセクションだけを抜き出す */
function sectionsForScene(sections: ScriptSectionView[], scene: SceneKey): ScriptSectionView[] {
  return sections.filter((s) => SCENE_OF_SECTION[s.key] === scene);
}

/* ============================================================
 * 1行の見た目（種類ごと）
 * ========================================================== */

/**
 * 事実の行の見出し → 飛び先カードの id。
 * ★見出しは「◯◯ ―― …」の「◯◯」の部分と完全一致で引く。
 *   ここに無い見出しはただの文字のまま出す（飛べないのにボタンに見せない）。
 * ★飛び先を増やすときは interview.shared.ts の INTERVIEW_CARD_IDS と対で足す。
 */
const FACT_JUMP_TARGETS: Record<string, string> = {
  成績: INTERVIEW_CARD_IDS.score,
  定期テスト: INTERVIEW_CARD_IDS.score,
  通知表: INTERVIEW_CARD_IDS.score,
  内申: INTERVIEW_CARD_IDS.score,
  模試: INTERVIEW_CARD_IDS.score,
  進度: INTERVIEW_CARD_IDS.progress,
  進行表: INTERVIEW_CARD_IDS.progress,
  授業の様子: INTERVIEW_CARD_IDS.discipline,
  '宿題・遅刻': INTERVIEW_CARD_IDS.discipline,
  前回の面談から: INTERVIEW_CARD_IDS.records,
};

/** 見出しと本文の区切り。buildTellSections などが組む行の書式 */
const FACT_SEPARATOR = ' ―― ';

function scrollToCard(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * 伝える（システムの事実）。丸ドットだけの素の1行。
 * 見出しに飛び先があるときだけ、その部分をボタンにして材料カードへスクロールする。
 */
function TellLine({ text }: { text: string }) {
  const sepIndex = text.indexOf(FACT_SEPARATOR);
  const label = sepIndex === -1 ? null : text.slice(0, sepIndex);
  const targetId = label ? FACT_JUMP_TARGETS[label] : undefined;

  return (
    <div className="flex items-start gap-2 text-[12.5px] leading-snug text-text-body">
      <span
        className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-text-heading"
        aria-hidden="true"
      />
      {targetId && label ? (
        <span>
          <button
            type="button"
            onClick={() => scrollToCard(targetId)}
            className="font-medium text-text-heading underline decoration-border-strong underline-offset-2 hover:decoration-primary"
            title="記録のカードへ移動する"
          >
            {label}
          </button>
          {text.slice(sepIndex)}
        </span>
      ) : (
        <span>{text}</span>
      )}
    </div>
  );
}

/** 話すこと（定型の読み上げ行）。事実の行と区別するため、印はダッシュにする */
function SayLine({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 text-[13px] leading-snug text-text-body">
      <span className="mt-[9px] h-px w-2 shrink-0 bg-text-faint" aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}

/**
 * 想定問答（よく聞かれること → こう答えている）。
 * ★読み上げる順ではなく面談中に引くものなので、伝える行とは見た目を分けている。
 */
function QaLine({ q, a }: { q: string; a: string }) {
  return (
    <div className="rounded-md border border-border-subtle bg-surface-hover px-2.5 py-1.5">
      <div className="flex items-start gap-2 text-[13px] font-bold leading-snug text-text-heading">
        <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-faint" aria-hidden="true" />
        <span>{q}</span>
      </div>
      <div className="mt-1 pl-[22px] text-[13px] leading-snug text-text-body">{a}</div>
    </div>
  );
}

/** 見せる（手元に用意する物） */
function ShowLine({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 text-[13px] leading-snug text-text-body">
      <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}

/** 聞く（NESTに記録が無い項目）。チェックは保存しない */
function AskLine({
  checked,
  onToggle,
  text,
}: {
  checked: boolean;
  onToggle: () => void;
  text: string;
}) {
  return (
    <label className="flex items-start gap-2 text-[13px] leading-snug text-text-body">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-ink"
      />
      <span>{text}</span>
    </label>
  );
}

/**
 * Sonnet 5 / Opus 5 の切り替え（admin/owner のみ表示）。
 *
 * ★実データで見比べたいだけなので、小さく・「作り直す」の近くに置く。
 *   目立たせすぎると、比較目的ではない教室長にも「選ぶもの」だと誤解される
 *  （そもそも教室長には出していないが、admin/owner にとっても主役はモデル選びではなく面談の台本）。
 */
function ModelKeyToggle({
  value,
  onChange,
  disabled,
}: {
  value: SelectableModelKey;
  onChange: (v: SelectableModelKey) => void;
  disabled: boolean;
}) {
  return (
    <div className="inline-flex items-center overflow-hidden rounded-full border border-border text-[11px]">
      {(['smart', 'best'] as const).map((key) => (
        <button
          key={key}
          type="button"
          disabled={disabled}
          onClick={() => onChange(key)}
          aria-pressed={value === key}
          className={`px-2 py-0.5 transition-colors disabled:opacity-40 ${
            value === key ? 'bg-ink text-white' : 'bg-surface text-text-muted hover:text-text-body'
          }`}
        >
          {MODEL_LABELS[key]}
        </button>
      ))}
    </div>
  );
}

/** 着眼点（AIが書いたもの・直せる）。sign は右のドットで示す */
function SeenLine({
  label,
  value,
  sign,
  onChange,
}: {
  label: string;
  value: string;
  sign: BriefSign;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-start gap-2 rounded-md bg-ink-subtle px-2.5 py-1.5">
      <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink" aria-hidden="true" />
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={value.length > 24 ? 2 : 1}
        placeholder="（見えることはありませんでした）"
        aria-label={`${label}から見えること`}
        className="min-w-0 flex-1 resize-none bg-transparent text-[13px] leading-snug text-text-heading outline-none"
      />
      {sign && (
        <span
          className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${sign === 'warn' ? 'bg-warning' : 'bg-success'}`}
          title={sign === 'warn' ? '注意して話す' : '伝えたい良い話'}
        />
      )}
    </div>
  );
}

export function InterviewScriptCard({
  student,
  assessments,
  interviews,
  textbookData,
  disciplineSessions,
  koushuEnrollments,
  regularPatterns,
  examGoals,
  targetSchools,
  loading,
  onResult,
  band,
}: Props) {
  /** この教室でAIを使えるか。null=まだ分からない */
  const [available, setAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<ScriptView | null>(null);
  const [madeAt, setMadeAt] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  /** 「聞く」のチェック。★保存しない。生徒を切り替えたら消す */
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  /** この画面でもう答えたか。★押し直させないためだけの印で、保存はしない */
  const [rated, setRated] = useState(false);

  /**
   * Sonnet 5 / Opus 5 の見比べ用。
   * ★admin / owner だけに切り替えを出す。比較は運営の仕事であって、講師・教室長には関係が無い
   *   （教室長は面談そのものは行うが、どのモデルで作るかを選ぶ理由が無い）。
   * ★サーバー（/api/ai/interview/brief）も同じロール境界を isOwnerOrAbove で確認しており、
   *   ここは表示を絞るだけ。権限外から model を送っても、サーバー側が黙って既定に倒す。
   */
  const { profile } = useAuth();
  const canChooseModel = isOwnerOrAbove(profile?.role);
  const [modelKey, setModelKey] = useState<SelectableModelKey>('best');
  /** 実際に作ったときに使われたモデル。★取り違え防止のため、結果のそばに常に出す */
  const [madeWithModelKey, setMadeWithModelKey] = useState<SelectableModelKey | null>(null);
  /** 上と対で持つ実際のモデルID（サーバーの応答そのまま）。答え合わせに残す用 */
  const [madeWithModel, setMadeWithModel] = useState<string | null>(null);

  useEffect(() => {
    if (!student.school_id) {
      setAvailable(false);
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const res = await fetchWithAuth(
          `/api/ai/feature-setting?school_id=${student.school_id}&feature=${STUDENT_DIGEST_FEATURE_KEY}`
        );
        if (!alive) return;
        if (!res.ok) return setAvailable(false);
        const json = (await res.json()) as { enabled: boolean };
        setAvailable(json.enabled);
      } catch {
        setAvailable(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [student.school_id]);

  // 生徒を切り替えたら結果を捨てる（前の生徒の内容が残ると読み違える）
  useEffect(() => {
    setView(null);
    setMadeAt(null);
    setMessage(null);
    setChecked({});
    setRated(false);
    setMadeWithModelKey(null);
    setMadeWithModel(null);
    onResult(null);
    // onResult は親で useCallback 済みだが、依存に入れると親の再描画で結果が消えるため入れない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student.id]);

  const currentSections = useMemo(
    () =>
      buildTellSections({
        assessments,
        interviews,
        textbookData,
        disciplineSessions,
        koushuEnrollments,
      }),
    [assessments, interviews, textbookData, disciplineSessions, koushuEnrollments]
  );

  // ②ヒアリング「目標の達成度」。AIセクションを通さない「伝える」「聞く」行なので、
  // buildTellSections とは別に持って scenes.ts の静的な ASK_LINES.hearing に足し込む。
  const goalAchievement = useMemo(
    () => buildGoalAchievementLines(examGoals, assessments),
    [examGoals, assessments]
  );
  // ④現状の確認「志望校との差」。志望校が未登録なら ask に「聞いて入れる」が1件入る
  const targetSchoolGap = useMemo(
    () => buildTargetSchoolGapLines(targetSchools, assessments),
    [targetSchools, assessments]
  );
  // ④現状の確認「成績が無いときに黙らない」。小学生には出さない
  const missingRecordAsk = useMemo(
    () => buildMissingRecordAskLines(assessments, student.grade),
    [assessments, student.grade]
  );

  // ★季節はヒューリスティック（interview.shared.ts の currentSeason 参照）。今日1回だけ決める
  const seasonKey = useMemo(() => currentSeason(new Date()), []);
  // ★③の定型と入試日は都県で中身が変わる。教室から引く（region.ts）
  const region = useMemo(() => regionOfSchool(student.school_id), [student.school_id]);
  const timing = useMemo(
    () => timingLines(student.grade, seasonKey, region),
    [student.grade, seasonKey, region]
  );
  // ③の想定問答。よく聞かれること → こう答えている（scenes.ts）
  const qa = useMemo(
    () => timingQa(student.grade, seasonKey, region),
    [student.grade, seasonKey, region]
  );
  // 出願・取り下げの〆切。★過ぎた日付は出ない（examDates.ts）
  const examApplication = useMemo(
    () => examApplicationLine(new Date(), student.grade, region),
    [student.grade, region]
  );
  // ⑤で「なぜこの教科・この単元か」を言うための根拠。③と同じ行（scenes.ts）
  const planRationale = useMemo(
    () => planRationaleLines(student.grade, seasonKey, region),
    [student.grade, seasonKey, region]
  );
  // 入試まであと何日。中3以外・東京都以外・年度の登録が無い年は null（行を出さない）
  const examCountdown = useMemo(
    () => examCountdownLine(new Date(), student.grade, region),
    [student.grade, region]
  );
  const seasonEnrollments = useMemo(
    () => koushuEnrollments.filter((e) => e.season === seasonKey),
    [koushuEnrollments, seasonKey]
  );
  const seasonKoma = seasonEnrollments.reduce((sum, e) => sum + (e.koma_count ?? 0), 0);
  const applied = seasonEnrollments.length > 0;

  const apply = (next: ScriptView | null) => {
    setView(next);
    onResult(next);
  };

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetchWithAuth('/api/ai/interview/brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schoolId: student.school_id,
          studentId: student.id,
          sections: currentSections,
          // ★admin/owner 以外は切り替えUIを出していないので modelKey は常に既定値（best）のまま。
          //   送ってもサーバー側で権限外なら無視されるだけなので、ここで出し分けなくてよい。
          model: modelKey,
        }),
      });
      if (!res.ok) throw new Error('failed');
      const json = (await res.json()) as ScriptResponse;

      if (json.disabled) return setAvailable(false);
      if (json.sections.length === 0) {
        return setMessage('面談で話せる記録がまだありません');
      }
      // ★実際に使われたモデルはサーバーの判断がすべて（権限外の指定はサーバーが黙って既定に倒す）。
      //   ここではその結果をそのまま表示・答え合わせ用に持つだけで、判断はしない。
      setMadeWithModelKey(json.modelKey);
      setMadeWithModel(json.model);

      // ★AIが使えなかったときも台本は出す。
      //   前身の「報告事項」はAIの見えることが主役だったので、作れなければ何も出さなかった。
      //   こちらは伝える行・聞くこと・見せるもの・定型が本体で、着眼点は付加価値。
      //   サーバーは degraded のときも現状の行（seen は空）を返しているので、それを捨てない。
      //   捨てると、APIが落ちている日に面談の台本が丸ごと使えなくなる。
      apply({
        sections: json.sections,
        thread: json.degraded ? '' : json.thread,
        bridge: json.degraded ? '' : json.bridge,
      });
      setMadeAt(new Date().toISOString().slice(0, 10));
      setRated(false);
      if (json.degraded) {
        setMessage('AIの着眼点は作れませんでした。記録から組んだ行はそのまま使えます');
      }
    } catch {
      setMessage('いまは作れませんでした');
    } finally {
      setBusy(false);
    }
  };

  /** 「見えること」の手直し。★直したものがそのまま印刷シートにも出る */
  const editSeen = (key: BriefSectionKey, seen: string) => {
    if (!view) return;
    apply({
      ...view,
      sections: view.sections.map((s) => (s.key === key ? { ...s, seen } : s)),
    });
  };

  const toggleAsk = (id: string) => {
    setChecked((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // ★オフ・未確定のあいだは何も出さない（押せる形にしない＝送信が起きない）
  if (available !== true) return null;

  /* ----------------------------------------------------------
   * シーンごとの「左＝話すこと」「右＝事実」を組む
   * ★どちらの列もこの2つの関数の中だけで組む。並びが複数箇所に散ると、
   *   「左を上から追えば面談が進む」という前提がシーンごとに崩れる。
   * -------------------------------------------------------- */

  /** そのシーンのAIセクションの「見えること」（話すこと＝左） */
  /**
   * AIが1文でも書けたか。
   * ★1文も書けていない（degraded・APIが落ちている等）ときは「見えること」の枠ごと出さない。
   *   枠は空でも編集できるので教室長が自分の言葉を書き足せるが、それは
   *   「AIは書いたが、この項目だけ見えることが無かった」ときに意味がある。
   *   AIが丸ごと動かなかった日に「（見えることはありませんでした）」が
   *   シーンの先頭に何行も並ぶと、AI抜きでも読めるはずの台本がただ読みにくくなる。
   */
  const hasAnySeen = view?.sections.some((s) => s.seen !== '') === true;

  const aiSeenLines = (scene: SceneKey): ReactNode[] =>
    view && hasAnySeen
      ? sectionsForScene(view.sections, scene).map((s) => (
          <SeenLine
            key={s.key}
            label={s.label}
            value={s.seen}
            sign={s.sign}
            onChange={(v) => editSeen(s.key, v)}
          />
        ))
      : [];

  /** そのシーンのAIセクションの「現状の行」（事実＝右） */
  const aiFactLines = (scene: SceneKey): ReactNode[] =>
    view
      ? sectionsForScene(view.sections, scene).flatMap((s) =>
          s.current.map((line, i) => (
            <TellLine
              key={`${s.key}-${i}`}
              text={i === 0 ? `${s.label}${FACT_SEPARATOR}${line}` : line}
            />
          ))
        )
      : [];

  const askLine = (id: string, text: string) => (
    <AskLine key={id} text={text} checked={checked[id] === true} onToggle={() => toggleAsk(id)} />
  );

  /** 左（話すこと）。定型・聞く・AIの着眼点・つながり・見せる物・想定問答 */
  const sceneSayLines = (scene: SceneKey): ReactNode[] => {
    const askLines = ASK_LINES[scene] ?? [];
    const showLines = SHOW_LINES[scene] ?? [];

    switch (scene) {
      case 'intro':
        return INTRO_LINES.map((t, i) => <SayLine key={i} text={t} />);

      case 'hearing':
        return [
          ...aiSeenLines('hearing'),
          ...askLines.map((t, i) => askLine(`hearing:${i}`, t)),
          // 目標はあるが結果が成績側にまだ入っていない試験。台本が入力を促す形にする
          ...goalAchievement.ask.map((t, i) => askLine(`hearing:goal:${i}`, t)),
        ];

      case 'timing':
        if (timing.length === 0 && qa.length === 0) {
          return [
            <span key="empty" className="text-[11px] text-text-faint">
              この学年・季節の定型トークはまだ用意されていません
            </span>,
          ];
        }
        return [
          ...timing.map((t, i) => <SayLine key={`timing-${i}`} text={t} />),
          ...qa.map((item, i) => <QaLine key={`qa-${i}`} q={item.q} a={item.a} />),
        ];

      case 'status':
        return [
          ...aiSeenLines('status'),
          ...showLines.map((t, i) => <ShowLine key={`show-${i}`} text={t} />),
          ...askLines.map((t, i) => askLine(`status:${i}`, t)),
          // 定期テスト・模試のどちらかが1件も記録に無いとき（中学生以上のみ）
          ...missingRecordAsk.map((t, i) => askLine(`status:missing:${i}`, t)),
          // 志望校が1件も登録されていないとき
          ...targetSchoolGap.ask.map((t, i) => askLine(`status:target-school:${i}`, t)),
        ];

      case 'plan':
        return [
          // ★③で話した「なぜ今か」を、プラン表を開いた場でもう一度出す（話すことなので左）
          ...planRationale.map((t, i) => <SayLine key={`rationale-${i}`} text={t} />),
          ...aiSeenLines('plan'),
          ...(view?.bridge
            ? [
                <div
                  key="bridge"
                  className="flex items-start gap-2 rounded-md bg-info-subtle px-2.5 py-1.5 text-[13px] leading-snug text-info"
                >
                  <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="font-bold">{view.bridge}</span>
                </div>,
              ]
            : []),
          ...showLines.map((t, i) => <ShowLine key={`show-${i}`} text={t} />),
        ];

      case 'apply':
        return APPLY_LINES.map((t, i) => <SayLine key={i} text={t} />);

      case 'closing':
        return CLOSING_LINES.map((t, i) => <SayLine key={i} text={t} />);
    }
  };

  /** 右（事実）。システムが記録から組んだ行だけを置く */
  const sceneFactLines = (scene: SceneKey): ReactNode[] => {
    switch (scene) {
      case 'hearing':
        return [
          ...aiFactLines('hearing'),
          // 目標の達成度。AIを通さず、システムが試験目標と成績を突き合わせて組む行
          ...goalAchievement.tell.map((t, i) => (
            <TellLine key={`goal-${i}`} text={i === 0 ? `目標の達成度${FACT_SEPARATOR}${t}` : t} />
          )),
        ];

      case 'timing':
        return [
          // 入試までの日数。★中3のときだけ出る（examDates.ts）。
          // 中1・中2に「あと900日」と言っても面談では使わない
          ...(examCountdown ? [<TellLine key="countdown" text={examCountdown} />] : []),
          ...(examApplication ? [<TellLine key="application" text={examApplication} />] : []),
        ];

      case 'status':
        return [
          ...aiFactLines('status'),
          // 志望校との差。マスタに当たり本人の内申・偏差値も取れたときだけ出る
          ...targetSchoolGap.tell.map((t, i) => <TellLine key={`gap-${i}`} text={t} />),
        ];

      case 'plan':
        return [
          ...(regularPatterns.length > 0
            ? [
                <TellLine
                  key="regular"
                  text={`通常授業${FACT_SEPARATOR}${formatRegularPatternsSchedule(regularPatterns)}`}
                />,
              ]
            : []),
          ...aiFactLines('plan'),
        ];

      case 'apply':
        return [
          <TellLine
            key="applied"
            text={`申込の状況${FACT_SEPARATOR}${
              applied ? `申込あり（${SEASON_LABELS[seasonKey]} ${seasonKoma}コマ）` : '未申込'
            }`}
          />,
        ];

      default:
        // ★①⑦は右が空。埋めずに空のままにする（非対称のほうが「ここは言うだけ」と分かる）
        return [];
    }
  };

  return (
    <>
      {band}
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Sparkles className="h-4 w-4 shrink-0 text-ink" aria-hidden="true" />
          <span className="text-sm font-bold text-text-heading">面談で話すこと</span>
          <span className="ml-auto shrink-0 text-[11px] text-text-faint">
            {madeAt ? `${madeAt.slice(5).replace('-', '/')} に作成 ・ ` : ''}
            {/* ★見比べるときに取り違えないよう、作ったモデルは結果のそばに常に出す（admin/owner のみ） */}
            {canChooseModel && madeWithModelKey
              ? `${MODEL_LABELS[madeWithModelKey]}で作成 ・ `
              : ''}
            保存されません
          </span>
        </div>

        {!view && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void run()}
              disabled={busy || loading === true}
              className="inline-flex items-center gap-1.5 rounded-full bg-ink px-3 py-1 text-[11px] font-medium text-white transition-opacity disabled:opacity-40"
            >
              <Sparkles className="h-3 w-3" aria-hidden="true" />
              {busy ? '作っています…' : '面談で話すことを作る'}
            </button>
            {canChooseModel && (
              <ModelKeyToggle value={modelKey} onChange={setModelKey} disabled={busy} />
            )}
            {message && <span className="text-[11px] text-text-muted">{message}</span>}
          </div>
        )}

        {view && (
          <div className="mt-3 flex flex-col gap-2">
            {/* 凡例 */}
            <div className="flex flex-wrap items-center gap-3 rounded-md bg-surface-hover px-2.5 py-1.5 text-[11px] text-text-muted">
              <span className="flex items-center gap-1">
                <span className="h-px w-2 bg-text-faint" aria-hidden="true" />
                話す（定型）
              </span>
              {/* AIが1文も書けなかった日は着眼点の行自体が出ないので、凡例からも外す */}
              {hasAnySeen && (
                <span className="flex items-center gap-1">
                  <Sparkles className="h-3 w-3 text-ink" aria-hidden="true" />
                  AIの着眼点
                </span>
              )}
              <span className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-sm border border-border" aria-hidden="true" />
                聞く
              </span>
              <span className="flex items-center gap-1">
                <FileText className="h-3 w-3 text-warning" aria-hidden="true" />
                見せる
              </span>
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-text-heading" aria-hidden="true" />
                事実（見出しを押すと記録へ移動）
              </span>
            </div>

            {/* ★列の見出しは一覧の先頭に1回だけ。シーンごとに繰り返すと読む線が切れる */}
            <div className="hidden gap-6 lg:grid lg:grid-cols-2">
              <span className="text-[10px] font-bold tracking-[0.2em] text-text-faint">
                話すこと
              </span>
              <span className="pl-3 text-[10px] font-bold tracking-[0.2em] text-text-faint">
                事実（記録から）
              </span>
            </div>

            {SCENE_KEYS.map((scene, index) => {
              const sayLines = sceneSayLines(scene);
              const factLines = sceneFactLines(scene);

              return (
                <section
                  key={scene}
                  className="border-t border-border-subtle pt-2.5 first-of-type:border-t-0 first-of-type:pt-0"
                >
                  <div className="mb-1.5 flex items-center gap-2">
                    <span
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border-subtle bg-surface-hover text-[10px] font-bold text-text-muted"
                      aria-hidden="true"
                    >
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span className="text-[13px] font-bold text-text-heading">
                      {SCENE_LABEL[scene]}
                    </span>
                    {/* シーンごとの短い補足バッジ */}
                    {scene === 'timing' && (
                      <span className="text-[11px] text-text-faint">
                        {SEASON_LABELS[seasonKey]}
                        {isExamGrade(student.grade) ? '・受験学年' : ''}
                      </span>
                    )}
                    {scene === 'plan' && seasonEnrollments.length > 0 && (
                      <span className="ml-auto text-[11px] text-text-faint">
                        {SEASON_LABELS[seasonKey]} 申込 {seasonKoma}コマ
                      </span>
                    )}
                    {scene === 'apply' && (
                      <span className="ml-auto text-[11px] text-text-faint">
                        {applied ? '申込あり' : '未申込'}
                      </span>
                    )}
                  </div>

                  <div className="grid items-start gap-x-6 gap-y-2 lg:grid-cols-2">
                    <div className="flex flex-col gap-1.5">{sayLines}</div>
                    {/* 右は少し静かに（薄い背景・小さめ）。空のシーンでは枠ごと出さない */}
                    {factLines.length > 0 ? (
                      <div className="flex flex-col gap-1 rounded-r-md border-l border-border-subtle bg-surface-hover px-3 py-1.5">
                        {factLines}
                      </div>
                    ) : (
                      <div aria-hidden="true" />
                    )}
                  </div>
                </section>
              );
            })}

            {/* 空の見出しは出さない（無いものを見出しだけ立てると「抜けている」に見える） */}
            {view.thread && (
              <div className="flex flex-col gap-1 border-t border-border-subtle pt-2.5">
                <span className="text-[11px] font-bold text-text-heading">つなげて見えること</span>
                <p className="text-xs leading-snug text-text-heading">{view.thread}</p>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle pt-2.5">
              <button
                type="button"
                onClick={() => void run()}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded-full border border-ink/25 bg-surface px-2.5 py-1 text-[11px] text-ink transition-opacity disabled:opacity-40"
              >
                <RefreshCw className="h-3 w-3" aria-hidden="true" />
                {busy ? '作っています…' : '作り直す'}
              </button>
              {canChooseModel && (
                <ModelKeyToggle value={modelKey} onChange={setModelKey} disabled={busy} />
              )}
              {message && <span className="text-[11px] text-text-muted">{message}</span>}
            </div>

            <span className="text-[11px] leading-snug text-text-muted">
              右の「事実」はシステムの記録です。AIの着眼点は直せます。聞くのチェックは保存されません
            </span>

            {/* ★答え合わせ。現状の行も「見えること」も記録しない（成績と引継ぎが混ざる）。
              残すのはセクション数とモデルだけ。
              ★モデルを残すのは、Sonnet 5 / Opus 5 のどちらが良いかを実データで比べるため
                （ai_output は jsonb なのでDB変更は不要。集計は /admin/ai-feedback）。
              ★AIが1文も書けなかったとき（APIが落ちている等）は出さない。
                評価する対象が無いのに「合っていた／ずれていた」を押させると、
                何を答えたのか分からない記録が溜まる。 */}
            {(view.thread !== '' ||
              view.bridge !== '' ||
              view.sections.some((s) => s.seen !== '')) && (
              <DigestVerdictChips
                rated={rated}
                onRate={(verdict) => {
                  setRated(true);
                  void recordAiFeedback({
                    schoolId: student.school_id ?? '',
                    feature: STUDENT_DIGEST_FEATURE_KEY,
                    targetKind: 'student',
                    targetId: student.id,
                    verdict,
                    aiOutput: {
                      sectionCount: view.sections.length,
                      ...(madeWithModelKey ? { modelKey: madeWithModelKey } : {}),
                      ...(madeWithModel ? { model: madeWithModel } : {}),
                    },
                  });
                }}
              />
            )}
          </div>
        )}
      </div>
    </>
  );
}
