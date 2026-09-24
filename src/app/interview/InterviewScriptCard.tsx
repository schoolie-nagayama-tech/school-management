'use client';

/**
 * 面談ワークスペース: 「面談で話すこと」カード（旧「報告事項」カード）
 * ------------------------------------------------------------------
 * ページ最上段・全幅に置く。データの種類順（成績／授業の様子…）ではなく
 * 面談の流れ順（①導入〜⑦クロージング）で並べる。
 *
 * ★2026-09-23 の整理で、シーンの左右2列をやめて1列にした（正典:
 *   docs/interview-workspace-layout-2026-09.md「2026-09-23 整理」）。
 *   ★同日、lg 以上だけ「左＝(a)(b) 話すこと／右＝(c)(d) 聞くこと・根拠」の2列に戻した
 *   （1列＋880px 上限では広い画面の右半分が空いたため。renderBlock の注記）。
 *   旧2列（左＝事実／右＝話す）とは分け方が違う。話す行は左の1列だけを上から追えばよい。
 *   シーン・②の小見出しの中は必ずこの順に並べる:
 *     (a) ひとこと（AIが書いた、そのまま言える切り出しの1文）
 *     (b) 話すこと（定型・AIの着眼点・報告・場面・前回の言葉・見せる物・想定問答）
 *     (c) 聞くこと（チェックの行。小さな見出し「聞くこと」の下にまとめる）
 *     (d) 根拠（記録）… システムが記録から組んだ事実の行。★既定はたたむ
 *   2列だと、面談中に目が左右を往復して「いま何を言うか」が追えなかった。事実は話す前の
 *   確認には要るが、話している最中には要らないので、畳んでおく。
 *   ★聞くことを話すことの間に混ぜない。チェックの行が話す行の間に挟まると、
 *     話の流れが「言う→聞く→言う」で切れ、どこまで話したか分からなくなる。
 * ★シーンの開閉（旧 SCENE_OPEN_BY_DEFAULT）は廃止した。縦に全部出す並びに変えたので、
 *   畳んでおくと「上から追えば進む」が成立しない。
 *   ★例外は③時期の重要性の定型だけ（2026-09-23）。毎回同じ定型なので既定でたたむ
 *   （理由は timingOpen の注記）。根拠（記録）の開閉はシーンの開閉とは別物（factsOpen の注記）。
 *
 * 正典: docs/interview-script-ai-plan.md
 *
 * ★AIに投げる単位は従来どおり「セクション」のまま。シーンへの割り当ては
 *   src/lib/interview/scenes.ts の固定テーブルが決める（AIに順番を決めさせない）。
 * ★現状の行（tell）はここ（システム）が組む。AIが書くのは「見えること」（seen）
 *   「つなげて見えること」（thread）「④の課題と⑤のプランのつながり」（bridge）と、
 *   2026-09-23 に足した「ひとこと」（openers）「場面」（episodes）だけ。
 *   「前回の言葉」（「」の中の言葉）はAIではなくシステムが面談記録から拾う（extractQuotedWords）。
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

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Sparkles,
  RefreshCw,
  FileText,
  ArrowRight,
  HelpCircle,
  ChevronDown,
  ChevronRight,
  ChevronUp,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { isOwnerOrAbove } from '@/lib/utils/roles';
import { fetchWithAuth } from '@/lib/api/auth';
import { STUDENT_DIGEST_FEATURE_KEY } from '@/lib/ai/features';
import { recordAiFeedback } from '@/lib/ai/feedback';
import { DigestVerdictChips } from '@/components/ai/DigestVerdictChips';
import {
  SELECTABLE_MODEL_KEY_LABELS as MODEL_LABELS,
  followUpItemKey,
  type BriefEpisode,
  type BriefFollowUp,
  type BriefSectionKey,
  type BriefSign,
  type OpenerKey,
  type SelectableModelKey,
} from '@/lib/ai/interviewBrief';
import type { AssessmentWithScores, Student, StudentInterview } from '@/types/database';
import type { DisciplineSessionRow } from '@/lib/api/progress-sessions';
import type { KoushuEnrollment } from '@/lib/api/seasonalCourses';
import type { SeasonalProposalSeasonSummary } from '@/lib/api/seasonalProposalSummary';
import type { ScheduleRegularPattern } from '@/types/schedule';
import type { StudentExamGoalWithType } from '@/lib/api/progress';
import type { TargetSchoolRow } from '@/lib/api/targetSchools';
import type { MockSchoolRecord } from '@/lib/api/mockTargetSchools';
import { SEASON_LABELS } from '@/types/database';
import type { TextbookProgressData } from './ProgressPanel';
import {
  buildTellSections,
  buildGoalAchievementLines,
  buildMockReturnLines,
  buildShukaisuLines,
  buildTestPrepLines,
  buildKoushuHistoryLines,
  buildMockSchoolLines,
  buildMissingRecordAskLines,
  buildPreviousCommitmentLines,
  buildTargetSchoolGapLines,
  buildTargetSchoolTalkLines,
  latestOwnHensachi,
  latestOwnNaishin,
  latestOwnKanagawaNaishin,
  currentSeason,
  extractQuotedWords,
  quotedWordTalkLine,
  previousFollowUpAskLine,
  previousFollowUpReportLine,
  formatRegularPatternsSchedule,
  koushuFiscalYear,
  mergeKoushuSeasons,
  stripTargetSchoolFactLines,
  summarizeCurrentKoushu,
  INTERVIEW_CARD_IDS,
  type MockApplicationForInterview,
  type ShukaisuChangeForInterview,
  type TestPrepProposalForInterview,
} from './interview.shared';
import {
  SCENE_KEYS,
  SCENE_LABEL,
  SCENE_OF_SECTION,
  ASK_LINES,
  HEARING_GROUP_KEYS,
  HEARING_GROUPS,
  hearingGroupOfSection,
  SHOW_LINES,
  INTRO_LINES,
  CLOSING_LINES,
  APPLY_LINES,
  timingLines,
  timingQa,
  planRationaleLines,
  isExamGrade,
  type HearingGroupKey,
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
  /**
   * 前回の約束・要望を「報告する」か「聞く」か（AIの判定・1件ずつ）。
   * ★AIが返さなかった項目はここに無い。画面は出どころで振る受け皿へ落とす。
   */
  followUps: BriefFollowUp[];
  thread: string;
  /** ④の課題と⑤のプランのつながり。koushu セクションを渡していなければ空文字 */
  bridge: string;
  /**
   * シーン・②の小見出しの頭の「ひとこと」（AI）。★AIが使えない日は空（静的な文で埋めない。
   * 決まり文句を「ひとこと」として出すと、AIが読んだ上での切り出しと見分けが付かなくなる）
   */
  openers: Partial<Record<OpenerKey, string>>;
  /** 引継ぎから拾った場面（AI）。日付・講師はサーバーが引継ぎの行から付けたもの */
  episodes: BriefEpisode[];
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
  /** 講習の提案書（期ごとのまとめ）。★⑤の主材料。koushu_enrollments は本番0行 */
  koushuSummaries: SeasonalProposalSeasonSummary[];
  /** 通塾日程。⑤プラン提示の「通常授業との関係」に使う */
  regularPatterns: ScheduleRegularPattern[];
  /** 試験目標（②ヒアリング「目標の達成度」の材料） */
  examGoals: StudentExamGoalWithType[];
  /** 志望校（④現状の確認「志望校」の材料） */
  targetSchools: TargetSchoolRow[];
  /** 模試の志望校と合格可能性（④現状の確認「直近の模試」の材料） */
  mockSchools: MockSchoolRecord[];
  /** テスト対策の提案書と増コマ申込（④「テスト対策 → 結果と課題」の材料） */
  testPrep: TestPrepProposalForInterview[];
  /** 週回数変更の申込の最新1件（②塾「変えたあとどうか」の材料） */
  shukaisu: ShukaisuChangeForInterview | null;
  /** 模試の申込（④「結果を返せているか」の材料） */
  mockApplications: MockApplicationForInterview[];
  /** 科目ID→科目名（⑤プラン提示「講習の履歴」の科目名に使う） */
  subjectNames: Record<string, string>;
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
  模試の申込: INTERVIEW_CARD_IDS.score,
  進度: INTERVIEW_CARD_IDS.progress,
  進行表: INTERVIEW_CARD_IDS.progress,
  授業の様子: INTERVIEW_CARD_IDS.discipline,
  '宿題・遅刻': INTERVIEW_CARD_IDS.discipline,
  前回の面談から: INTERVIEW_CARD_IDS.records,
  前回の約束: INTERVIEW_CARD_IDS.records,
  前回の要望: INTERVIEW_CARD_IDS.records,
};

/** 見出しと本文の区切り。buildTellSections などが組む行の書式 */
const FACT_SEPARATOR = ' ―― ';

/**
 * 志望校が登録されている生徒に④で聞くこと。
 * ★登録が無い生徒には出さない（無い志望校の見学を聞いても始まらない。
 *   その場合は buildTargetSchoolGapLines の ask「志望校を聞いて入れる」が出る）。
 */
const TARGET_SCHOOL_ASK_LINES = [
  '志望校の見学・説明会に行ったか',
  '併願の私立は決まっているか',
] as const;

/** ③時期の重要性の開閉を覚えておく localStorage のキー（値は '1'＝開く／'0'＝たたむ） */
const TIMING_OPEN_STORAGE_KEY = 'nest.interview.timingOpen';
/** 「根拠をすべて開く」を覚えておく localStorage のキー（値は '1'＝開く／'0'＝たたむ） */
const FACTS_OPEN_STORAGE_KEY = 'nest.interview.factsOpen';

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
 * Sonnet 5 / Opus 5.5 の切り替え（admin/owner のみ表示）。
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

/**
 * textarea の高さを中身に合わせる。
 * ★2026-09-23 の教室長レビューで入れた。以前は rows を字数で1〜2行に決め打ちしており、
 *   AIの着眼点（最大数百字）が枠の中でスクロールして、面談中に全文が読めなかった。
 * ★幅が変わると折り返しが変わるので、ウィンドウのリサイズでも測り直す。
 *   値が変わったとき（手直し・作り直し）も測り直す。
 * ★一度 height を auto に戻してから scrollHeight を読む。戻さないと、縮めるべきときに
 *   前の高さのまま scrollHeight が返り、文を消しても枠が小さくならない。
 */
function useAutosizeTextarea(value: string) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  useEffect(() => {
    const onResize = () => {
      const el = ref.current;
      if (!el) return;
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return ref;
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
  // ★全文を枠の中でスクロールさせない（useAutosizeTextarea の注記）
  const textareaRef = useAutosizeTextarea(value);
  return (
    <div className="flex items-start gap-2 rounded-md bg-ink-subtle px-2.5 py-1.5">
      <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink" aria-hidden="true" />
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={1}
        placeholder="（見えることはありませんでした）"
        aria-label={`${label}から見えること`}
        className="min-w-0 flex-1 resize-none overflow-hidden bg-transparent text-[13px] leading-snug text-text-heading outline-none"
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

/**
 * 前回の要望・約束への「報告」（AIが記録から追えたもの）。
 *
 * ★見た目は着眼点（SeenLine）と同じ枠に揃える。どちらもAIが書いた文で、
 *   面談では並んで読むため、枠が違うと視線が飛ぶ。
 * ★直せない（textarea にしていない）。着眼点と違って「前回こう言われて、こう対応した」は
 *   事実の報告なので、その場で書き換える場面が思いつかない。
 *   要る場面が出たら SeenLine と同じ editSeen 相当を足す（いまは見送り）。
 */
function ReportRow({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md bg-ink-subtle px-2.5 py-1.5">
      <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-[13px] leading-snug text-text-heading">
        <span className="mr-1.5 rounded-sm bg-ink/10 px-1 py-px text-[10px] font-bold text-ink">
          報告
        </span>
        {text}
      </p>
    </div>
  );
}

/**
 * ひとこと（AIが書いた、保護者にそのまま言える切り出しの1文）。
 *
 * ★AIの着眼点（青系の ink の枠・Sparkles）とは見た目を分ける。着眼点は教室長が読む
 *   内部の下書きで、ひとことは口に出す話し言葉。同じ枠だと「これは読み上げてよい文か」を
 *   面談中に取り違える。温かい色味のトークンが無いので、地は surface-hover、左の線だけ
 *   warning（琥珀）で引いて区別する（globals.css に新しい色は足さない。
 *   ★border-warning/60 のような不透明度指定は使わない。色が var() なので Tailwind 3 では効かない）。
 * ★直せない（textarea にしていない）。そのまま言う1文なので、直す場面は着眼点の側で足りる。
 */
function OpenerLine({ text }: { text: string }) {
  return (
    <div className="rounded-r-md border-l-[3px] border-warning bg-surface-hover px-3 py-1.5">
      <div className="text-[10px] font-bold tracking-[0.08em] text-text-muted">ひとこと</div>
      <p className="text-[14px] leading-relaxed text-text-heading">「{text}」</p>
    </div>
  );
}

/**
 * 場面（講師の引継ぎから拾った具体的な瞬間）。「9/17の英語で…（内山先生）」。
 * ★日付・講師名はサーバーが引継ぎの行から付けたもので、AIの文には入っていない。
 */
function EpisodeLine({ episode }: { episode: BriefEpisode }) {
  return (
    <PillLine
      pill="場面"
      text={`${episode.date}の${episode.text}${episode.teacher ? `（${episode.teacher}先生）` : ''}`}
    />
  );
}

/**
 * 小さな札つきの話す行（「場面」「言葉」）。
 * ★定型の話す行（ダッシュ）と見分けるための札。どちらも中身は記録から来た具体的な話で、
 *   読み上げの定型ではないことが一目で分かるようにする。
 */
function PillLine({ pill, text }: { pill: string; text: string }) {
  return (
    <div className="flex items-start gap-2 text-[13px] leading-snug text-text-body">
      <span className="mt-px shrink-0 rounded-full border border-border-subtle bg-surface-hover px-1.5 text-[10px] font-bold leading-[16px] text-text-body">
        {pill}
      </span>
      <span>{text}</span>
    </div>
  );
}

/** 聞くことの小見出し。★チェックの行はこの下にまとめ、話す行の間に混ぜない */
function AskLabel() {
  return (
    // ★lg 以上は右の列の先頭に来るので上の余白を消す（左の1行目と頭をそろえる）
    <div className="mt-1.5 text-[10px] font-bold tracking-[0.14em] text-text-muted lg:mt-0">
      聞くこと
    </div>
  );
}

/**
 * 根拠（記録）の開閉。既定はたたむ（factsOpen の注記）。
 * ★開いた中身は以前の右の列と同じ静かな枠（薄い背景・左の細い線）。見出しを押すと
 *   材料カードへ飛ぶボタン（TellLine）はそのまま使える。
 */
function FactsDisclosure({
  count,
  open,
  onToggle,
  children,
}: {
  count: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="mt-1 flex flex-col gap-1">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="inline-flex w-fit items-center gap-1 rounded-md px-1 py-0.5 text-[11px] text-text-muted hover:bg-surface-hover hover:text-text-body"
      >
        {open ? (
          <ChevronDown className="h-3 w-3" aria-hidden="true" />
        ) : (
          <ChevronRight className="h-3 w-3" aria-hidden="true" />
        )}
        根拠（記録）{count}件
      </button>
      {open && (
        <div className="flex flex-col gap-1 rounded-r-md border-l border-border-subtle bg-surface-hover px-3 py-1.5">
          {children}
        </div>
      )}
    </div>
  );
}

/** シーン・②の小見出し1つぶんの中身（並びは (a)〜(d) の順に固定。ファイル冒頭の注記） */
interface BlockParts {
  opener?: string;
  talk: ReactNode[];
  ask: ReactNode[];
  facts: ReactNode[];
}

function isEmptyBlock(b: BlockParts): boolean {
  return !b.opener && b.talk.length === 0 && b.ask.length === 0 && b.facts.length === 0;
}

export function InterviewScriptCard({
  student,
  assessments,
  interviews,
  textbookData,
  disciplineSessions,
  koushuEnrollments,
  koushuSummaries,
  regularPatterns,
  examGoals,
  targetSchools,
  mockSchools,
  testPrep,
  shukaisu,
  mockApplications,
  subjectNames,
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
   * Sonnet 5 / Opus 5.5 の見比べ用。
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

  // ②ヒアリング「目標の達成度」。AIセクションを通さない「伝える」「聞く」行なので、
  // buildTellSections とは別に持って②「学校」の小見出しに足し込む。
  const goalAchievement = useMemo(
    () => buildGoalAchievementLines(examGoals, assessments),
    [examGoals, assessments]
  );
  /**
   * ④「テスト対策 → 結果と課題」。★目標の達成度がすでに同じ試験の結果を聞いているときは、
   *   「結果を聞いて入れる」を重ねない（existingAsks）。AIには aiLines を score に混ぜて渡す
   */
  const testPrepLines = useMemo(
    () => buildTestPrepLines(testPrep, assessments, student.grade, new Date(), goalAchievement.ask),
    [testPrep, assessments, student.grade, goalAchievement.ask]
  );
  // ②塾「週回数変更 → 変えたあとどうか」。変更後の月は宿題・遅刻と同じ集計を使う
  const shukaisuLines = useMemo(
    () => buildShukaisuLines(shukaisu, disciplineSessions, new Date()),
    [shukaisu, disciplineSessions]
  );
  // ④「模試 → 結果を返せているか」。結果が入っていれば何も出ない
  const mockReturn = useMemo(
    () => buildMockReturnLines(mockApplications, assessments, new Date()),
    [mockApplications, assessments]
  );

  const currentSections = useMemo(
    () =>
      buildTellSections({
        assessments,
        interviews,
        textbookData,
        disciplineSessions,
        koushuEnrollments,
        koushuSummaries,
        subjectNames,
        targetSchools,
        mockSchools,
        testPrepAiLines: testPrepLines.aiLines,
      }),
    [
      testPrepLines.aiLines,
      assessments,
      interviews,
      textbookData,
      disciplineSessions,
      koushuEnrollments,
      koushuSummaries,
      subjectNames,
      targetSchools,
      mockSchools,
    ]
  );

  // ④現状の確認「志望校」。志望校が未登録なら ask に「聞いて入れる」が1件入る
  const targetSchoolGap = useMemo(
    () => buildTargetSchoolGapLines(targetSchools, assessments),
    [targetSchools, assessments]
  );
  // ④現状の確認「直近の模試」。合格可能性と、登録に無い公立校（あれば聞く）
  const mockSchoolLines = useMemo(
    () => buildMockSchoolLines(mockSchools, assessments, targetSchools),
    [mockSchools, assessments, targetSchools]
  );
  // ②ヒアリング「前回の約束・前回の要望」と、そこから組む「その後どうですか」。
  // ★AIには書かせない（件数と文言が確実でないと面談で使えない）
  const previous = useMemo(() => buildPreviousCommitmentLines(interviews), [interviews]);
  // ②振り返り「前回の言葉」。直近の面談記録（タスク以外）の「」の言葉をそのまま運ぶ。
  // ★AIを通さない（システムが拾う）ので、AIが使えない日にも出る
  const quotedWords = useMemo(() => {
    const latest = interviews.find((i) => i.interview_type !== 'task');
    // ★話し手は面談種別で決める（Nottaは生徒か保護者かを聞き分けられない）
    return latest ? extractQuotedWords(latest.content, latest.interview_type) : [];
  }, [interviews]);
  // ④現状の確認「成績が無いときに黙らない」。小学生には出さない
  // ★申込から分かっていること（テスト対策の結果を聞く・模試を申し込んでいる）は重ねて聞かない
  const missingRecordAsk = useMemo(
    () =>
      buildMissingRecordAskLines(assessments, student.grade, {
        hasTestPrepAsk: testPrepLines.ask.length > 0,
        hasMockApplication: mockApplications.length > 0,
      }),
    [assessments, student.grade, testPrepLines.ask.length, mockApplications.length]
  );

  // ★季節はヒューリスティック（interview.shared.ts の currentSeason 参照）。今日1回だけ決める
  const seasonKey = useMemo(() => currentSeason(new Date()), []);
  // ★③の定型と入試日は都県で中身が変わる。教室から引く（region.ts）
  const region = useMemo(() => regionOfSchool(student.school_id), [student.school_id]);
  // ④の左（話すこと）: 志望校ごとに「めやすとの差から何を言うか」。★右の志望校の行と同じ差を使う
  const targetSchoolTalk = useMemo(
    () =>
      buildTargetSchoolTalkLines(
        targetSchools,
        latestOwnNaishin(assessments),
        latestOwnHensachi(assessments),
        region,
        // 神奈川県立（135点満点）と比べる本人の内申。どちらを使うかは学校の満点で決まる
        latestOwnKanagawaNaishin(assessments)
      ),
    [targetSchools, assessments, region]
  );

  /**
   * ③時期の重要性を開いておくか。★既定はたたむ。ブラウザごとに覚える。
   * ★③だけ畳めるようにした（2026-09-23 教室長レビュー）。③の左は学年×季節×都県の定型と
   *   想定問答で、どの生徒でも毎回同じ文。十数行あって台本の中で一番長いのに、
   *   読み慣れた教室長には要らない。②④⑤は生徒ごとに中身が変わる（前回の要望・志望校・
   *   提案書）ので畳まない。畳むと、その生徒にしか無い話を見落とす。
   * ★右（入試まで・出願〆切）は短く、その日にしか言えない事実なので、たたんでも出したままにする。
   * ★保存先は localStorage（講師の好み。サーバーに持つほどのものではない）。
   *   プライベートウィンドウ等で読み書きが投げることがあるので try/catch で包み、
   *   読めなければ既定（たたむ）のまま動かす。最初の描画は常にたたんだ状態で、
   *   読めた値はマウント後に反映する（SSRとの食い違いを出さないため）。
   */
  const [timingOpen, setTimingOpen] = useState(false);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(TIMING_OPEN_STORAGE_KEY) === '1') setTimingOpen(true);
    } catch {
      // 読めなければ既定（たたむ）のまま
    }
  }, []);
  const toggleTimingOpen = () => {
    setTimingOpen((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(TIMING_OPEN_STORAGE_KEY, next ? '1' : '0');
      } catch {
        // 覚えられなくても、この画面の中では開閉できる
      }
      return next;
    });
  };
  /**
   * 根拠（記録）を開いておくか。★既定はたたむ。「根拠をすべて開く」だけをブラウザごとに覚える。
   * ★2026-09-23 に右の列（事実）をやめて畳むようにした。面談中は話すことだけを上から追い、
   *   事実は準備のとき・聞かれたときに開いて確かめる。
   * ★個別の開閉（factsOverride）は覚えない。その場の確認で開くもので、次の生徒・次の面談まで
   *   持ち越すと「なぜここだけ開いているのか」になる。全体の切り替えを押すと個別の開閉は捨てる。
   * ★localStorage の扱いは timingOpen と同じ（try/catch・最初の描画は既定のまま）。
   */
  const [factsOpenAll, setFactsOpenAll] = useState(false);
  const [factsOverride, setFactsOverride] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try {
      if (window.localStorage.getItem(FACTS_OPEN_STORAGE_KEY) === '1') setFactsOpenAll(true);
    } catch {
      // 読めなければ既定（たたむ）のまま
    }
  }, []);
  const toggleFactsOpenAll = () => {
    const next = !factsOpenAll;
    setFactsOpenAll(next);
    setFactsOverride({});
    try {
      window.localStorage.setItem(FACTS_OPEN_STORAGE_KEY, next ? '1' : '0');
    } catch {
      // 覚えられなくても、この画面の中では開閉できる
    }
  };
  const isFactsOpen = (id: string) => factsOverride[id] ?? factsOpenAll;
  const toggleFacts = (id: string) =>
    setFactsOverride((prev) => ({ ...prev, [id]: !(prev[id] ?? factsOpenAll) }));

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
  // 入試まであと何日。★呼び名は都県で変わる（東京「都立一次」／神奈川「共通選抜」）。
  // 中3以外・都県が未登録の教室・年度の登録が無い年は null（行を出さない）
  const examCountdown = useMemo(
    () => examCountdownLine(new Date(), student.grade, region),
    [student.grade, region]
  );
  // ★年度は4月始まり（1〜3月は前年度）。⑤の今期・履歴・バッジで同じ規則を使う
  const fiscalYear = useMemo(() => koushuFiscalYear(new Date()), []);
  // 提案書（主材料）と koushu_enrollments（2027-02公開のWeb申込。いまは0行）を期ごとに合流
  const koushuBuckets = useMemo(
    () => mergeKoushuSeasons(koushuSummaries, koushuEnrollments, subjectNames),
    [koushuSummaries, koushuEnrollments, subjectNames]
  );
  // ⑤プラン提示「これまでの講習の申し込み履歴」。今期は今期の行が出すので除く
  const koushuHistory = useMemo(
    () => buildKoushuHistoryLines(koushuBuckets, fiscalYear, seasonKey),
    [koushuBuckets, fiscalYear, seasonKey]
  );
  // ★ヘッダー帯（InterviewWorkspace）・⑤のバッジ・⑥の「申込の状況」で同じ値を使う
  const koushuSummary = useMemo(
    () => summarizeCurrentKoushu(koushuBuckets, fiscalYear, seasonKey),
    [koushuBuckets, fiscalYear, seasonKey]
  );

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
          // ★前回の約束・要望。「報告する」か「聞く」かをAIに1件ずつ決めさせるため、
          //   本文をそのまま渡す（戻りの item はこの文と1字も違わないことが条件）
          //   新しいNottaの型で「誰が動くか」（塾：／家庭：…）が分かっているものは添えて送る
          //   （本文は頭の語を外した文。サーバーも同じ followUpItemKey で突き合わせる）
          followUpItems: previous.items.map((i) =>
            i.actor ? { text: i.text, actor: i.actor } : i.text
          ),
          // ★週回数変更は授業の様子（lessons＝サーバーが組む）に足す行なので、別の口で送る
          //   （サーバーは「週回数変更:」で始まる行しか通さない。sanitizeLessonNotes）
          lessonNotes: shukaisuLines.aiLine ? [shukaisuLines.aiLine] : [],
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
        // ★degraded の日はAIの文を1つも出さない（前回の約束・要望は出どころで振る）
        followUps: json.degraded ? [] : (json.followUps ?? []),
        thread: json.degraded ? '' : json.thread,
        bridge: json.degraded ? '' : json.bridge,
        // ★ひとこと・場面も同じ。AIが使えない日に決まり文句で埋めない（ScriptView の注記）
        openers: json.degraded ? {} : (json.openers ?? {}),
        episodes: json.degraded ? [] : (json.episodes ?? []),
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
   * シーンごとの「ひとこと・話す・聞く・根拠」を組む
   * ★並べるのは sceneBlock / hearingBlock の中だけ。並びが複数箇所に散ると、
   *   「上から追えば面談が進む」という前提がシーンごとに崩れる。
   * -------------------------------------------------------- */

  /**
   * AIが1文でも書けたか。
   * ★1文も書けていない（degraded・APIが落ちている等）ときは「見えること」の枠ごと出さない。
   *   枠は空でも編集できるので教室長が自分の言葉を書き足せるが、それは
   *   「AIは書いたが、この項目だけ見えることが無かった」ときに意味がある。
   *   AIが丸ごと動かなかった日に「（見えることはありませんでした）」が
   *   シーンの先頭に何行も並ぶと、AI抜きでも読めるはずの台本がただ読みにくくなる。
   */
  const hasAnySeen =
    view?.sections.some((s) => s.seen !== '') === true || (view?.followUps.length ?? 0) > 0;

  /**
   * 前回の約束・要望 → AIの振り分け。★突き合わせは本文の完全一致
   *  （サーバーが同じ文字列で突き合わせて捨てているので、ここに残っているものは必ず一致する）。
   */
  const followUpByItem = new Map((view?.followUps ?? []).map((f) => [f.item, f]));

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

  /**
   * そのシーンのAIセクションの「現状の行」（根拠）。
   * ★志望校の行は score に混ぜてAIへ送っているが、画面では下の「志望校」のブロックで
   *   別に出すので、ここでは外す（同じ行を2回出さない）。
   */
  const aiFactLines = (scene: SceneKey): ReactNode[] =>
    view
      ? sectionsForScene(view.sections, scene).flatMap((s) =>
          stripTargetSchoolFactLines(s.current).map((line, i) => (
            <TellLine
              key={`${s.key}-${i}`}
              text={i === 0 ? `${s.label}${FACT_SEPARATOR}${line}` : line}
            />
          ))
        )
      : [];

  /**
   * セクション1つぶんの「事実」の行。
   * ★②ヒアリングは小見出し（振り返り／学校／塾／家庭）ごとに出すので、
   *   シーン単位ではなくキー単位で取り出せるようにしてある。
   *   BRIEF_SECTIONS の順（AIへ送る順）は変えない。
   */
  const aiFactLinesOf = (key: BriefSectionKey): ReactNode[] =>
    view
      ? view.sections
          .filter((s) => s.key === key)
          .flatMap((s) =>
            stripTargetSchoolFactLines(s.current).map((line, i) => (
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

  const openers = view?.openers ?? {};

  /**
   * ③時期の重要性の定型（話すこと）。★たたんでいるときは件数だけを1行で見せる（timingOpen の注記）
   */
  const timingTalk = (): ReactNode[] => {
    if (timing.length === 0 && qa.length === 0) {
      return [
        <span key="empty" className="text-[11px] text-text-faint">
          この学年・季節の定型トークはまだ用意されていません
        </span>,
      ];
    }
    if (!timingOpen) {
      const counts = [
        timing.length > 0 ? `定型 ${timing.length}行` : null,
        qa.length > 0 ? `想定問答 ${qa.length}件` : null,
      ]
        .filter(Boolean)
        .join('・');
      return [
        <button
          key="timing-toggle"
          type="button"
          onClick={toggleTimingOpen}
          aria-expanded={false}
          className="inline-flex items-center gap-1 self-start rounded-md px-1 py-0.5 text-[12px] text-text-muted hover:bg-surface-hover hover:text-text-body"
        >
          {counts}を表示
          <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
        </button>,
      ];
    }
    return [
      ...timing.map((t, i) => <SayLine key={`timing-${i}`} text={t} />),
      ...qa.map((item, i) => <QaLine key={`qa-${i}`} q={item.q} a={item.a} />),
      <button
        key="timing-toggle"
        type="button"
        onClick={toggleTimingOpen}
        aria-expanded={true}
        className="inline-flex items-center gap-1 self-start rounded-md px-1 py-0.5 text-[12px] text-text-muted hover:bg-surface-hover hover:text-text-body"
      >
        たたむ
        <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
      </button>,
    ];
  };

  /**
   * シーン1つぶんの中身（②以外）。★並びは (a)ひとこと→(b)話す→(c)聞く→(d)根拠 に固定
   * （ファイル冒頭の注記）。どのシーンもこの関数の中だけで組む。並びが複数箇所に散ると、
   * 「上から追えば面談が進む」という前提がシーンごとに崩れる。
   */
  const sceneBlock = (scene: SceneKey): BlockParts => {
    const showLines = (SHOW_LINES[scene] ?? []).map((t, i) => (
      <ShowLine key={`show-${i}`} text={t} />
    ));
    const askLines = ASK_LINES[scene] ?? [];

    switch (scene) {
      case 'intro':
        return {
          opener: openers.intro,
          talk: INTRO_LINES.map((t, i) => <SayLine key={i} text={t} />),
          ask: [],
          // ★①は根拠が無い（言うだけの場面）。埋め草を置かない
          facts: [],
        };

      case 'hearing':
        // ★②は小見出しごとに組む（hearingBlock）。ここには来ない
        return { talk: [], ask: [], facts: [] };

      case 'timing':
        return {
          opener: openers.timing,
          talk: timingTalk(),
          ask: [],
          facts: [
            // 入試までの日数。★中3のときだけ出る（examDates.ts）。
            // 中1・中2に「あと900日」と言っても面談では使わない
            ...(examCountdown ? [<TellLine key="countdown" text={examCountdown} />] : []),
            ...(examApplication ? [<TellLine key="application" text={examApplication} />] : []),
          ],
        };

      case 'status':
        return {
          opener: openers.status,
          talk: [
            /**
             * ★志望校の話を先頭に置く（2026-09-23 教室長レビュー）。根拠に差の数字が出ていても、
             *   何を言うかが無いと面談で志望校に触れずに終わる。数字はシステムが計算したもの
             *  （buildTargetSchoolTalkLines の注記）。聞く行（ask）は下の「聞くこと」へ回す。
             */
            ...targetSchoolTalk
              .map((line, i) => ({ line, i }))
              .filter(({ line }) => line.kind !== 'ask')
              .map(({ line, i }) => (
                <SayLine key={`status:target-school-talk:${i}`} text={line.text} />
              )),
            ...aiSeenLines('status'),
            ...showLines,
          ],
          ask: [
            ...targetSchoolTalk
              .map((line, i) => ({ line, i }))
              .filter(({ line }) => line.kind === 'ask')
              .map(({ line, i }) => askLine(`status:target-school-talk:${i}`, line.text)),
            ...askLines.map((t, i) => askLine(`status:${i}`, t)),
            // 定期テスト・模試のどちらかが1件も記録に無いとき（中学生以上のみ）
            ...missingRecordAsk.map((t, i) => askLine(`status:missing:${i}`, t)),
            // 志望校が1件も登録されていないとき
            ...targetSchoolGap.ask.map((t, i) => askLine(`status:target-school:${i}`, t)),
            // 模試に書いたのに志望校に登録されていない公立校
            ...mockSchoolLines.ask.map((t, i) => askLine(`status:mock-school:${i}`, t)),
            // テスト対策をした試験の結果がまだ入っていない
            ...testPrepLines.ask.map((t, i) => askLine(`status:test-prep:${i}`, t)),
            // 申し込んだ模試の結果がまだ入っていない（返却を確認）
            ...mockReturn.ask.map((t, i) => askLine(`status:mock-return:${i}`, t)),
            // ★登録がある生徒には、めやすの数字ではなく「動いたか」を聞く
            ...(targetSchools.length > 0
              ? TARGET_SCHOOL_ASK_LINES.map((t, i) => askLine(`status:target-school-ask:${i}`, t))
              : []),
          ],
          facts: [
            ...aiFactLines('status'),
            // 志望校。めやす・本人との差・沿線を1件1行にまとめたブロック
            ...targetSchoolGap.tell.map((t, i) => (
              <TellLine key={`gap-${i}`} text={i === 0 ? `志望校${FACT_SEPARATOR}${t}` : t} />
            )),
            // 直近の模試の合格可能性（前回との比較つき）と、登録に無い公立校の指摘
            ...mockSchoolLines.tell.map((t, i) => <TellLine key={`mock-school-${i}`} text={t} />),
            // テスト対策（試験・コマ・増コマ申込 → 結果 → 対策した単元）。数字はシステムが組む
            ...testPrepLines.facts.map((t, i) => <TellLine key={`test-prep-${i}`} text={t} />),
            // 申し込んだ模試の結果が未入力（入っていれば行ごと出ない）
            ...mockReturn.facts.map((t, i) => <TellLine key={`mock-return-${i}`} text={t} />),
          ],
        };

      case 'plan':
        return {
          opener: openers.plan,
          talk: [
            // ★③で話した「なぜ今か」を、プラン表を開いた場でもう一度出す
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
            ...showLines,
          ],
          ask: [],
          facts: [
            ...(regularPatterns.length > 0
              ? [
                  <TellLine
                    key="regular"
                    text={`通常授業${FACT_SEPARATOR}${formatRegularPatternsSchedule(regularPatterns)}`}
                  />,
                ]
              : []),
            ...aiFactLines('plan'),
            // これまでの申し込み（今期を除く）。履歴が無ければ行ごと出ない
            ...koushuHistory.map((t, i) => (
              <TellLine
                key={`koushu-history-${i}`}
                text={i === 0 ? `講習の履歴${FACT_SEPARATOR}${t}` : t}
              />
            )),
          ],
        };

      case 'apply':
        return {
          talk: APPLY_LINES.map((t, i) => <SayLine key={i} text={t} />),
          ask: [],
          facts: [
            <TellLine key="applied" text={`申込の状況${FACT_SEPARATOR}${koushuSummary.label}`} />,
          ],
        };

      case 'closing':
        return {
          talk: CLOSING_LINES.map((t, i) => <SayLine key={i} text={t} />),
          ask: [],
          facts: [],
        };
    }
  };

  /* ----------------------------------------------------------
   * ②ヒアリングは小見出し（振り返り／学校／塾／家庭）ごとに組む
   * ★どのAIセクションをどの小見出しに出すか・何を聞くかは scenes.ts の
   *   HEARING_GROUP_OF_SECTION / HEARING_GROUPS が決める。ここで決め打ちしない。
   * -------------------------------------------------------- */

  /** その小見出しに属するAIセクション（BRIEF_SECTIONS の並びのまま） */
  const sectionsOfGroup = (group: HearingGroupKey): ScriptSectionView[] =>
    view ? view.sections.filter((s) => hearingGroupOfSection(s.key) === group) : [];

  const hearingBlock = (group: HearingGroupKey): BlockParts => {
    const groupSections = sectionsOfGroup(group);
    const seen: ReactNode[] = hasAnySeen
      ? groupSections.map((s) => (
          <SeenLine
            key={s.key}
            label={s.label}
            value={s.seen}
            sign={s.sign}
            onChange={(v) => editSeen(s.key, v)}
          />
        ))
      : [];
    const sectionFacts = groupSections.flatMap((s) => aiFactLinesOf(s.key));
    const groupAsks = HEARING_GROUPS[group].ask.map((t, i) => askLine(`hearing:${group}:${i}`, t));
    const opener = openers[group];

    switch (group) {
      case 'review': {
        /**
         * ★前回の約束・要望は、1件ずつ「報告する」か「聞く」かを分ける（2026-09-23）。
         *   一律に「その後どうですか」と聞いていたが、保護者からの要望
         *  （「英語の長文を増やしてほしい」）は塾が対応を**報告する**ことで、
         *   聞き返すと「前に頼んだのに何もしていないのか」になる（教室長の指摘）。
         * ★判定はAI（followUps）。返ってこなかった項目・AIが使えない日は
         *   出どころ（item.fallback。新しいNottaの型なら「塾：」「家庭：」の動く人）で振る。
         * ★報告は話すこと、聞くは聞くことへ分ける（話す行の間にチェックを挟まない）。
         */
        const reports: ReactNode[] = [];
        const asks: ReactNode[] = [];
        previous.items.forEach((item, i) => {
          const hit = followUpByItem.get(followUpItemKey(item.text));
          const kind = hit?.kind ?? item.fallback;
          if (kind === 'report') {
            reports.push(
              hit?.text ? (
                <ReportRow key={`hearing:followup:${i}`} text={hit.text} />
              ) : (
                // AIが書いていない報告は、中身を教室長が口頭で埋める（行だけ立てる）
                <SayLine
                  key={`hearing:followup:${i}`}
                  text={previousFollowUpReportLine(item.text, item.source)}
                />
              )
            );
          } else {
            asks.push(
              askLine(`hearing:followup:${i}`, hit?.text || previousFollowUpAskLine(item.text))
            );
          }
        });
        return {
          opener,
          talk: [
            // ★前回、本人・保護者が口にした言葉をそのまま返す（extractQuotedWords の注記）
            ...quotedWords.map((w, i) => (
              <PillLine
                key={`quote-${i}`}
                pill="言葉"
                text={quotedWordTalkLine(w, student.first_name)}
              />
            )),
            ...reports,
            ...seen,
          ],
          ask: [...asks, ...groupAsks],
          // ★並びは話す順（前回の面談から → 前回の約束 → 前回の要望・方針）
          facts: [
            ...sectionFacts,
            ...previous.promises.map((t, i) => (
              <TellLine
                key={`promise-${i}`}
                text={i === 0 ? `前回の約束${FACT_SEPARATOR}${t}` : t}
              />
            )),
            ...previous.requests.map((t, i) => (
              <TellLine
                key={`request-${i}`}
                text={i === 0 ? `前回の要望・方針${FACT_SEPARATOR}${t}` : t}
              />
            )),
          ],
        };
      }
      case 'school':
        return {
          opener,
          talk: seen,
          // 目標はあるが結果が成績側にまだ入っていない試験。台本が入力を促す形にする
          ask: [
            ...groupAsks,
            ...goalAchievement.ask.map((t, i) => askLine(`hearing:goal:${i}`, t)),
          ],
          // 目標の達成度。AIを通さず、システムが試験目標と成績を突き合わせて組む行
          facts: [
            ...sectionFacts,
            ...goalAchievement.tell.map((t, i) => (
              <TellLine
                key={`goal-${i}`}
                text={i === 0 ? `目標の達成度${FACT_SEPARATOR}${t}` : t}
              />
            )),
          ],
        };
      case 'juku':
        return {
          opener,
          // 塾＝AIの着眼点（家庭では見えない塾での様子）と、引継ぎから拾った場面
          // ★週回数変更の「報告」を先頭に置く。変えたあとどうかは塾から切り出す話題
          //  （教室長「変更してそのあとどうかを報告事項としてあげる」）
          talk: [
            ...(shukaisuLines.talk?.kind === 'say'
              ? [<SayLine key="shukaisu-say" text={shukaisuLines.talk.text} />]
              : []),
            ...seen,
            ...(view?.episodes ?? []).map((e, i) => (
              <EpisodeLine key={`episode-${i}`} episode={e} />
            )),
          ],
          ask: [
            ...groupAsks,
            ...(shukaisuLines.talk?.kind === 'ask'
              ? [askLine('hearing:shukaisu', shukaisuLines.talk.text)]
              : []),
          ],
          facts: [
            ...sectionFacts,
            ...shukaisuLines.facts.map((t, i) => <TellLine key={`shukaisu-${i}`} text={t} />),
          ],
        };
      default:
        return { opener, talk: seen, ask: groupAsks, facts: sectionFacts };
    }
  };

  /**
   * シーン・小見出し1つぶんを描く。★並びは (a)〜(d) に固定（ファイル冒頭の注記）。
   * ★lg 以上は2列（2026-09-23 教室長承認）。左＝話すこと（(a)(b)）、右＝聞くこと→根拠（(c)(d)）。
   *   1列＋880px の上限では広い画面でカードの右半分が空いていた。話す行と、チェックする行・
   *   確かめる事実は面談中の使い方が違う（読み上げる／消し込む・ちらっと見る）ので、
   *   左右に分けても「言う→聞く→言う」で話が切れることはない（聞くことを話す行の間に
   *   混ぜない、という決まりはそのまま）。
   * ★880px の上限は外した。左の行の長さは列の比（1.7 : 1）で抑える。
   * ★右に置くもの（聞くこと・根拠）が無いシーンは1列のまま全幅にする。空の右列を立てると
   *   「何か抜けている」に見える。逆に右だけあるときも右の列に置く（位置が毎回同じ方が探せる）。
   * ★lg 未満は従来どおり縦に積む（左の中身→聞くこと→根拠）。
   */
  const renderBlock = (id: string, parts: BlockParts) => {
    const hasRight = parts.ask.length > 0 || parts.facts.length > 0;
    const left = (
      <div className="flex min-w-0 flex-col gap-1.5" data-script-col="talk">
        {parts.opener && <OpenerLine text={parts.opener} />}
        {parts.talk}
      </div>
    );
    if (!hasRight) return left;
    return (
      <div className="grid grid-cols-1 gap-1.5 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] lg:gap-6">
        {left}
        <div className="flex min-w-0 flex-col gap-1.5" data-script-col="ask">
          {parts.ask.length > 0 && (
            <div className="flex flex-col gap-1">
              <AskLabel />
              {parts.ask}
            </div>
          )}
          {parts.facts.length > 0 && (
            <FactsDisclosure
              count={parts.facts.length}
              open={isFactsOpen(id)}
              onToggle={() => toggleFacts(id)}
            >
              {parts.facts}
            </FactsDisclosure>
          )}
        </div>
      </div>
    );
  };

  const hasAnyOpener = Object.keys(openers).length > 0;
  const hasAnyEpisode = (view?.episodes.length ?? 0) > 0;

  return (
    <>
      {band}
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Sparkles className="h-4 w-4 shrink-0 text-ink" aria-hidden="true" />
          <span className="text-sm font-bold text-text-heading">面談で話すこと</span>
          {/* ★根拠（記録）をまとめて開く・たたむ。ブラウザごとに覚える（factsOpenAll の注記） */}
          {view && (
            <button
              type="button"
              role="switch"
              aria-checked={factsOpenAll}
              onClick={toggleFactsOpenAll}
              className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-[11px] text-text-body hover:bg-surface-hover"
            >
              <span
                className={`relative inline-block h-3.5 w-6 rounded-full transition-colors ${
                  factsOpenAll ? 'bg-ink' : 'bg-border-strong'
                }`}
                aria-hidden="true"
              >
                <span
                  className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-surface transition-[left] ${
                    factsOpenAll ? 'left-3' : 'left-0.5'
                  }`}
                />
              </span>
              根拠をすべて開く
            </button>
          )}
          <span className={`${view ? '' : 'ml-auto '}shrink-0 text-[11px] text-text-faint`}>
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
            {/* 凡例。★その日に出ていない種類は載せない（AIが書けなかった日のひとこと・場面など） */}
            <div className="flex flex-wrap items-center gap-3 rounded-md bg-surface-hover px-2.5 py-1.5 text-[11px] text-text-muted">
              {hasAnyOpener && (
                <span className="flex items-center gap-1">
                  <span className="h-2.5 w-[3px] rounded-full bg-warning" aria-hidden="true" />
                  ひとこと（そのまま言える）
                </span>
              )}
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
              {hasAnyEpisode && (
                <span className="flex items-center gap-1">
                  <span className="rounded-full border border-border-subtle bg-surface px-1 text-[10px] font-bold leading-[14px] text-text-body">
                    場面
                  </span>
                  授業の引継ぎから
                </span>
              )}
              <span className="flex items-center gap-1">
                <FileText className="h-3 w-3 text-warning" aria-hidden="true" />
                見せる
              </span>
              {/* ★ここから右の列（lg 以上）に出る種類。凡例も画面の左→右の順に並べる */}
              <span className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-sm border border-border" aria-hidden="true" />
                聞く
              </span>
              <span className="flex items-center gap-1">
                <ChevronRight className="h-3 w-3" aria-hidden="true" />
                根拠（記録。見出しを押すと記録へ移動）
              </span>
            </div>

            {/**
             * つなげて見えること（AI）。★①より上・全幅に置く（2026-09-23 教室長の指摘）。
             *   複数の材料をまたいだ見立てで、面談全体の芯になる。以前はシーンの下（カードの末尾）に
             *   あり、面談の前に目を通されずに終わっていた。面談に入る前に最初に読むものとして上に出す。
             * ★目立たせるが騒がせない：info-subtle の地と 14px の本文。枠線・強い色は使わない。
             * ★空なら何も出さない（無いものを見出しだけ立てると「抜けている」に見える）。
             */}
            {view.thread && (
              <div
                className="flex flex-col gap-1 rounded-md bg-info-subtle px-3 py-2"
                data-script-thread
              >
                <span className="text-[11px] font-bold text-info">つなげて見えること</span>
                <p className="text-sm leading-relaxed text-text-heading">{view.thread}</p>
              </div>
            )}

            {SCENE_KEYS.map((scene, index) => (
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
                      {/* ★入試までの日数は根拠を畳んでも見えるよう見出しにも出す
                          （その日にしか言えない事実で、③の話の前提になるため） */}
                      {examCountdown ? ` ・ ${examCountdown}` : ''}
                    </span>
                  )}
                  {scene === 'plan' && koushuSummary.koma > 0 && (
                    <span className="ml-auto text-[11px] text-text-faint">
                      {koushuSummary.label}
                    </span>
                  )}
                  {scene === 'apply' && (
                    <span className="ml-auto text-[11px] text-text-faint">
                      {koushuSummary.applied ? '申込あり' : '未申込'}
                    </span>
                  )}
                </div>

                {scene === 'hearing' ? (
                  /**
                   * ②は小見出し（振り返り／学校／塾／家庭）ごとに組む。
                   * ★中身が1つも無い小見出しは出さない（見出しだけ立てると「抜けている」に見える）。
                   */
                  <div className="flex flex-col gap-3.5">
                    {HEARING_GROUP_KEYS.map((group) => {
                      const parts = hearingBlock(group);
                      if (isEmptyBlock(parts)) return null;
                      const meta = HEARING_GROUPS[group];
                      return (
                        <div key={group} data-hearing-group={group}>
                          <div className="mb-1.5 border-l-[3px] border-border-strong pl-2 text-[13px] font-bold leading-tight text-text-heading">
                            {meta.label}
                            {meta.note && (
                              <span className="ml-2 text-[11px] font-normal text-text-muted">
                                {meta.note}
                              </span>
                            )}
                          </div>
                          {renderBlock(`hearing:${group}`, parts)}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  renderBlock(scene, sceneBlock(scene))
                )}
              </section>
            ))}

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
              根拠はシステムの記録です。AIの着眼点は直せます。聞くのチェックは保存されません
            </span>

            {/* ★答え合わせ。現状の行も「見えること」も記録しない（成績と引継ぎが混ざる）。
              残すのはセクション数とモデルだけ。
              ★モデルを残すのは、Sonnet 5 / Opus 5.5 のどちらが良いかを実データで比べるため
                （ai_output は jsonb なのでDB変更は不要。集計は /admin/ai-feedback）。
              ★AIが1文も書けなかったとき（APIが落ちている等）は出さない。
                評価する対象が無いのに「合っていた／ずれていた」を押させると、
                何を答えたのか分からない記録が溜まる。ひとこと・場面だけ書けた日も対象に入れる。 */}
            {(view.thread !== '' ||
              view.bridge !== '' ||
              view.followUps.length > 0 ||
              hasAnyOpener ||
              hasAnyEpisode ||
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
