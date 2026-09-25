/**
 * 面談ワークスペース 印刷シート（A4縦1枚）
 * ------------------------------------------------------------------
 * courses/progress の CourseProgressReport と同じ流儀: 画面には `hidden print:flex` で隠しておき、
 * 印刷時だけ表示される専用ブロック。名前付きページ（globals.css の `interviewreport`）で
 * 用紙サイズ・向きを固定する。
 *
 * ★面談の流れ順（InterviewScriptCard と同じ①〜⑦シーン）に作り替えた。①③⑦は定型なので短く、
 *   ②④を厚く配置し、下半分は面談中の手書きメモ欄（罫線）にする。
 * ★①③⑦・「聞くこと」はAI未生成でも刷れる（scenes.ts の定型データだけで組める）。
 *   ②④⑤の「伝える」行も interview.shared.ts の buildTellSections で独自に組み直しており、
 *   InterviewScriptCard（AIカード）を1回も押していなくても最低限の中身が印刷できる。
 *   「見えること」「つながり」はAIを起動していれば script から上乗せする。
 *
 * ★A4縦1枚に「確実に」収める仕組み（2026-09-23。以前は運任せで、中3の冬期には
 *   縦2枚＋末尾に横向きの白紙1枚が出ていた）:
 *   1. 紙を固定の箱にする。globals.css で 190mm×276mm・overflow hidden（はみ出しは次の紙へ流さず切る）。
 *   2. 件数を先に絞る（printCaps.ts）。事実の一覧より、話す・聞く行を残す。
 *   3. 長い1行は line-clamp で行数を切る。
 *   4. それでも溢れたときの受け止めとして、シーンごとに高さの上限（max-h・overflow hidden）を置く。
 *      溢れはそのシーンの中で切れ、下のシーン（⑤⑥⑦）が紙から押し出されることはない。
 *   5. メモ欄は残りの高さを全部使う（flex-1）。中身が多い生徒ほど狭くなり、足りなければ消える。
 *   末尾の横向き白紙は、シート以外の箱（トースト・通知の枠など）を印刷で消して止めている（globals.css）。
 */

import type { AssessmentWithScores, Student, StudentInterview } from '@/types/database';
import { SEASON_LABELS } from '@/types/database';
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
  formatRegularPatternsSchedule,
  koushuFiscalYear,
  mergeKoushuSeasons,
  previousFollowUpAskLine,
  previousFollowUpReportLine,
  stripTargetSchoolFactLines,
  summarizeCurrentKoushu,
  type MockApplicationForInterview,
  type ShukaisuChangeForInterview,
  type TestPrepProposalForInterview,
} from './interview.shared';
import type { TextbookProgressData } from './ProgressPanel';
import type { DisciplineSessionRow } from '@/lib/api/progress-sessions';
import type { KoushuEnrollment } from '@/lib/api/seasonalCourses';
import type { SeasonalProposalSeasonSummary } from '@/lib/api/seasonalProposalSummary';
import type { ScheduleRegularPattern } from '@/types/schedule';
import type { StudentExamGoalWithType } from '@/lib/api/progress';
import type { TargetSchoolRow } from '@/lib/api/targetSchools';
import type { MockSchoolRecord } from '@/lib/api/mockTargetSchools';
import type { ScriptView } from './InterviewScriptCard';
import {
  SCENE_OF_SECTION,
  ASK_LINES,
  HEARING_GROUP_KEYS,
  HEARING_GROUPS,
  hearingGroupOfSection,
  type HearingGroupKey,
  SHOW_LINES,
  INTRO_LINES,
  CLOSING_LINES,
  APPLY_LINES,
  timingLines,
  timingQa,
  planRationaleLines,
  isExamGrade,
} from '@/lib/interview/scenes';
import { examCountdownLine, examApplicationLine } from '@/lib/interview/examDates';
import { regionOfSchool } from '@/lib/interview/region';
import { buildStudentReportCards } from '@/lib/interview/privateAdmission';
import {
  BRIEF_SECTIONS,
  briefSectionLabel,
  followUpItemKey,
  type BriefSectionKey,
} from '@/lib/ai/interviewBrief';
import { formatGradeLabel } from '@/lib/utils/gradeLabel';
import {
  INTERVIEW_PRINT_CAPS as CAPS,
  capItems,
  capLinesWithRest,
} from '@/lib/interview/printCaps';

/**
 * 紙の本文1行の文字。★9.5px・行間1.4。以前の10px・行間1.6では1枚に収まらなかった。
 *   文字は8.5px未満にしない（教室長が面談中に手元で読む）。
 */
const LINE = 'text-[9.5px] leading-[1.4] text-gray-800';

interface InterviewPrintSheetProps {
  student: Student;
  today: string;
  /** 面談記録。タスク種別を含んでいてよい（中で除く。② ヒアリングの「前回」の材料） */
  interviews: StudentInterview[];
  assessments: AssessmentWithScores[];
  /** 進行表の生データ（画面の ProgressPanel と同じもの）。集計はこちら側で行う */
  textbookData: TextbookProgressData[];
  /** 宿題・遅刻パネルと同じ生セッション行 */
  disciplineSessions: DisciplineSessionRow[];
  koushuEnrollments: KoushuEnrollment[];
  /** 講習の提案書（期ごとのまとめ）。★⑤の主材料。koushu_enrollments は本番0行 */
  koushuSummaries: SeasonalProposalSeasonSummary[];
  regularPatterns: ScheduleRegularPattern[];
  /** 試験目標（②ヒアリング「目標の達成度」の材料。InterviewScriptCard と同じもの） */
  examGoals: StudentExamGoalWithType[];
  /** 志望校（④現状の確認「志望校」の材料） */
  targetSchools: TargetSchoolRow[];
  /** 模試の志望校と合格可能性（④現状の確認「直近の模試」の材料） */
  mockSchools: MockSchoolRecord[];
  /** テスト対策の提案書と増コマ申込（④。InterviewScriptCard と同じもの） */
  testPrep: TestPrepProposalForInterview[];
  /** 週回数変更の申込の最新1件（②塾） */
  shukaisu: ShukaisuChangeForInterview | null;
  /** 模試の申込（④結果の返却） */
  mockApplications: MockApplicationForInterview[];
  /** 科目ID→科目名（⑤プラン提示「講習の履歴」の科目名に使う） */
  subjectNames: Record<string, string>;
  /**
   * 面談で話すこと（AI）。押していなければ null で、「見えること」「つながり」は乗らない。
   * ★画面で手直しした「見えること」がそのまま入る（親が結果を持っているため）。
   */
  script?: ScriptView | null;
}

/** その1行だけの小さな見出し番号付きヘッダ */
function SceneHeading({ no, label, badge }: { no: string; label: string; badge?: string }) {
  return (
    <div className="mb-1 flex items-baseline gap-1.5 border-b border-gray-300 pb-0.5">
      <span className="text-[9px] font-bold text-gray-500">{no}</span>
      <span className="text-[11.5px] font-bold">{label}</span>
      {badge && <span className="ml-auto text-[9px] text-gray-500">{badge}</span>}
    </div>
  );
}

/** 箇条書き。★1項目は2行で切る（定型でも、季節によっては1項目が3行になるものがある） */
function Bullets({ items }: { items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className={`m-0 list-disc pl-[15px] ${LINE}`}>
      {items.map((t, i) => (
        <li key={i}>
          <span className="line-clamp-2">{t}</span>
        </li>
      ))}
    </ul>
  );
}

/** 削った件数の注記。★黙って消すと「紙に無い＝記録が無い」と読まれるので必ず残す */
function RestNote({ hidden }: { hidden: number }) {
  if (hidden <= 0) return null;
  return <div className="text-[9px] leading-[1.4] text-gray-500">ほか{hidden}件は画面で</div>;
}

export function InterviewPrintSheet({
  student,
  today,
  interviews,
  assessments,
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
  script,
}: InterviewPrintSheetProps) {
  // ★AI未生成でも刷れるよう、伝える行は独自に組み直す（InterviewScriptCard と同じ関数）
  const tellSections = buildTellSections({
    assessments,
    interviews,
    textbookData,
    disciplineSessions,
    koushuEnrollments,
    koushuSummaries,
    subjectNames,
    targetSchools,
    mockSchools,
  });
  // 目標の達成度・志望校との差・成績記録なしの「聞くこと」も同じ関数で組み直す
  // （InterviewScriptCard と二重実装しない。画面と紙で数字がずれる事故を防ぐ）
  const goalAchievement = buildGoalAchievementLines(
    examGoals,
    assessments,
    student.grade,
    new Date()
  );
  const targetSchoolGap = buildTargetSchoolGapLines(
    targetSchools,
    assessments,
    regionOfSchool(student.school_id)
  );
  // 直近の模試の合格可能性と、登録に無い公立校（画面の④と同じ関数）
  const mockSchoolLines = buildMockSchoolLines(mockSchools, assessments, targetSchools);
  // 申込から見えること（画面の④・②塾と同じ関数）
  const testPrepLines = buildTestPrepLines(
    testPrep,
    assessments,
    student.grade,
    new Date(),
    goalAchievement.ask
  );
  const shukaisuLines = buildShukaisuLines(shukaisu, disciplineSessions, new Date());
  const mockReturn = buildMockReturnLines(mockApplications, assessments, new Date());
  const missingRecordAsk = buildMissingRecordAskLines(assessments, student.grade, {
    hasTestPrepAsk: testPrepLines.ask.length > 0,
    hasMockApplication: mockApplications.length > 0,
  });
  // ②ヒアリングの「前回の約束・前回の要望」と、そこから組む「その後どうですか」
  const previous = buildPreviousCommitmentLines(interviews);
  /**
   * 前回の約束・要望を「報告」と「聞く」に振り分ける（画面と同じ規則）。
   * ★AIが返した項目はその判定に従い、無いものは出どころ（fallback）で振る。
   */
  const followUpByItem = new Map((script?.followUps ?? []).map((f) => [f.item, f]));
  const followUpReports: string[] = [];
  const followUpAsks: string[] = [];
  for (const item of previous.items) {
    const hit = followUpByItem.get(followUpItemKey(item.text));
    const kind = hit?.kind ?? item.fallback;
    if (kind === 'report') {
      followUpReports.push(
        hit?.text ? `報告 ―― ${hit.text}` : previousFollowUpReportLine(item.text, item.source)
      );
    } else {
      followUpAsks.push(hit?.text || previousFollowUpAskLine(item.text));
    }
  }

  // seen（AIの着眼点）は script があれば key で引く。無ければ全て空文字扱い
  const seenByKey = new Map<BriefSectionKey, string>();
  if (script) {
    for (const s of script.sections) if (s.seen) seenByKey.set(s.key, s.seen);
  }
  // script は lessons・parent（サーバーが足す2セクション）の current も持っている。
  // ★AI未生成のときはこの2つが無いまま（面談画面はこの2つの材料を読んでいないため）
  // ★志望校の行は score に混ぜてAIへ送っているので、ここで外す（④で別ブロックにして出す）
  const currentByKey = new Map<BriefSectionKey, string[]>(
    tellSections.map((s) => [s.key, stripTargetSchoolFactLines(s.current)])
  );
  if (script) {
    for (const s of script.sections) {
      if (!currentByKey.has(s.key) && s.current.length > 0) {
        currentByKey.set(s.key, stripTargetSchoolFactLines(s.current));
      }
    }
  }

  const seasonKey = currentSeason(new Date());
  // ★③の定型と入試日は都県で中身が変わる。教室から引く（region.ts）
  const region = regionOfSchool(student.school_id);
  const timing = timingLines(student.grade, seasonKey, region);
  // ⑤で「なぜこの教科・この単元か」を言うための根拠。③と同じ行（scenes.ts）
  const planRationale = planRationaleLines(student.grade, seasonKey, region);
  // ④の話すこと: 志望校ごとに「めやすとの差から何を言うか」（画面と同じ関数）
  const targetSchoolTalk = buildTargetSchoolTalkLines(
    targetSchools,
    latestOwnNaishin(assessments),
    latestOwnHensachi(assessments),
    region,
    // 神奈川県立（135点満点）と比べる本人の内申。どちらを使うかは学校の満点で決まる
    latestOwnKanagawaNaishin(assessments),
    // 私立の推薦・併願優遇の判定に使う本人の通知表（画面と同じ）
    buildStudentReportCards(assessments)
  );
  const examCountdown = examCountdownLine(new Date(), student.grade, region);
  const examApplication = examApplicationLine(new Date(), student.grade, region);
  // ③の想定問答。よく聞かれること → こう答えている（scenes.ts）
  const qa = timingQa(student.grade, seasonKey, region);
  // ★年度は4月始まり（1〜3月は前年度）。画面（InterviewScriptCard）と同じ規則で組む
  const fiscalYear = koushuFiscalYear(new Date());
  // 提案書（主材料）と koushu_enrollments（2027-02公開のWeb申込。いまは0行）を期ごとに合流
  const koushuBuckets = mergeKoushuSeasons(koushuSummaries, koushuEnrollments, subjectNames);
  // ⑤プラン提示「これまでの講習の申し込み履歴」。今期は今期の行が出すので除く
  const koushuHistory = buildKoushuHistoryLines(koushuBuckets, fiscalYear, seasonKey);
  // ★ヘッダー帯・⑤のバッジ・⑥の「申込の状況」で同じ値を使う
  const koushuSummary = summarizeCurrentKoushu(koushuBuckets, fiscalYear, seasonKey);

  /** シーン内の1セクション（伝える＋見えること）を1ブロックにする */
  function sectionBlock(key: BriefSectionKey) {
    const current = currentByKey.get(key);
    if (!current || current.length === 0) return null;
    const seen = seenByKey.get(key);
    // ★事実は頭の数件・2行まで（全部は画面の「材料（記録）」にある）。成績や進行表は
    //   1セクションで6〜7行に伸びることがあり、これが1枚を超える主因の一つだった。
    // ★見えること（AI）は2行まで。プロンプトで1文40字までにしてあり、半段幅の2行に収まる。
    //   はみ出すのは画面で手直しして長くしたときだけ。
    return (
      <div key={key} className={LINE}>
        <div className="line-clamp-2">
          ・{briefSectionLabel(key)} ―― {capLinesWithRest(current, CAPS.sectionLines).join('／')}
        </div>
        {seen && <div className="ml-3 line-clamp-2 text-purple-800">→ {seen}</div>}
      </div>
    );
  }

  const statusKeys = (Object.keys(SCENE_OF_SECTION) as BriefSectionKey[]).filter(
    (k) => SCENE_OF_SECTION[k] === 'status'
  );
  const planKeys = (Object.keys(SCENE_OF_SECTION) as BriefSectionKey[]).filter(
    (k) => SCENE_OF_SECTION[k] === 'plan'
  );

  /**
   * ②の小見出しごとの「事実」（左）。★並びは画面の hearingFactLines と揃える。
   *   どのセクションをどの小見出しに出すかは scenes.ts の HEARING_GROUP_OF_SECTION が決める。
   */
  function hearingFacts(group: HearingGroupKey) {
    const nodes = BRIEF_SECTIONS.map((s) => s.key)
      .filter((k) => hearingGroupOfSection(k) === group)
      .map(sectionBlock)
      .filter((n) => n !== null);
    const line = (text: string) => <div className={`line-clamp-2 ${LINE}`}>・{text}</div>;
    if (group === 'review') {
      // 前回の約束（未完了タスク）・前回の要望（直近の面談記録）。★事実なので頭の数件だけ
      if (previous.promises.length > 0)
        nodes.push(
          line(
            `前回の約束 ―― ${capLinesWithRest(previous.promises, CAPS.previousPromises).join('／')}`
          )
        );
      if (previous.requests.length > 0)
        nodes.push(
          line(
            `前回の要望・方針 ―― ${capLinesWithRest(previous.requests, CAPS.previousRequests).join('／')}`
          )
        );
    }
    if (group === 'juku') {
      // 週回数変更。★紙は見出しの1行だけ（変更後の月の集計は画面の②塾の根拠で）
      for (const t of shukaisuLines.facts.slice(0, CAPS.shukaisu)) nodes.push(line(t));
    }
    if (group === 'school' && goalAchievement.tell.length > 0) {
      // 目標の達成度。試験目標と成績を突き合わせて組む「伝える」行
      nodes.push(line(`目標の達成度 ―― ${goalAchievement.tell.join('／')}`));
    }
    return nodes;
  }

  /**
   * ②の小見出しごとの「話すこと・聞くこと」（右）。★画面の hearingBlock と揃える。
   *
   * ★2026-09-23 に画面へ足した「ひとこと」「場面」「前回の言葉」は、紙の話すことには足さない。
   *   紙は2列のまま（面談前の準備用で、根拠も並べて見せる）で、A4 1枚に余裕が無い。
   *   ひとこと（最大8行）・場面（最大2行）を足すと、そのぶん②が切れるかメモ欄が消える。
   *   - 前回の言葉は、lastInterview の現状の行（「前回の言葉: 「…」（生徒）」）として
   *     左の「前回の面談から」の1行に「／」区切りで既に乗る。話すことに重ねて出さない。
   *   - ひとこと・場面は画面で見る（面談中に読むもので、準備の紙には要らない）。
   */
  function hearingSays(group: HearingGroupKey): {
    lines: { text: string; ask: boolean }[];
    hidden: number;
  } {
    const asks = HEARING_GROUPS[group].ask.map((text) => ({ text, ask: true }));
    if (group === 'review') {
      // 前回の要望のうち、塾から対応を伝えるもの → 家庭に聞くもの（画面と同じ振り分け）
      // ★前回の要望への対応は件数が記録次第（Nottaの要約だと5件以上並ぶ）なので絞る。
      //   報告を先に残す（塾から言うことを落とすと、保護者に聞かれて答えられない）。
      //   小見出しの定型の聞くこと（asks）は短く件数も一定なので絞らない。
      const followUps = capItems(
        [
          ...followUpReports.map((text) => ({ text, ask: false })),
          ...followUpAsks.map((text) => ({ text, ask: true })),
        ],
        CAPS.followUps
      );
      return { lines: [...followUps.shown, ...asks], hidden: followUps.hidden };
    }
    if (group === 'school') {
      // 目標はあるが結果が成績側にまだ入っていない試験
      return {
        lines: [...asks, ...goalAchievement.ask.map((text) => ({ text, ask: true }))],
        hidden: 0,
      };
    }
    if (group === 'juku' && shukaisuLines.talk) {
      // 週回数変更の「報告」または「確定してよいか」（画面の②塾と同じ行）
      const talk = shukaisuLines.talk;
      // ★週回数変更の行は1件しか組まれない（CAPS.shukaisu と同じ1行）ので、ここでは絞らない
      return { lines: [{ text: talk.text, ask: talk.kind === 'ask' }, ...asks], hidden: 0 };
    }
    return { lines: asks, hidden: 0 };
  }

  // ③・④・⑤の件数の上限（printCaps.ts）。★削った件数は「ほかN件は画面で」で残す
  const timingCapped = capItems(timing, CAPS.timing);
  const qaCapped = capItems(qa, CAPS.qa);
  const targetSchoolCapped = capItems(targetSchoolGap.tell, CAPS.targetSchools);
  const mockCapped = capItems(mockSchoolLines.tell, CAPS.mockSchoolLines);
  const talkCapped = capItems(targetSchoolTalk, CAPS.targetSchoolTalk);
  const planRationaleCapped = capItems(planRationale, CAPS.planRationale);
  // ④の申込から見えること。★テスト対策の根拠は1行につなぐ・聞くことは1件（printCaps.ts）
  const testPrepFactLine = capItems(testPrepLines.facts, CAPS.testPrepFacts).shown.join('／');
  const applicationAsksCapped = capItems(
    [...testPrepLines.ask, ...mockReturn.ask],
    CAPS.applicationAsks
  );

  /*
   * ★シーンごとの高さの上限（max-h + overflow-hidden）。件数の上限と line-clamp で普通は届かない
   *   受け止めで、AIの文を画面で長く直した・記録が極端に多い、といった想定外のときだけ効く。
   *   溢れはそのシーンの中で切れ、下のシーンやメモ欄の見出しを押し出さない。
   *   上限の合計: ヘッダー約9mm＋①③60＋②88＋④46＋⑤⑥⑦44＋間隔約8＝約255mm。
   *   つなげて見えること（2行・約9mm）が乗ると約264mm で、276mmの箱の残り（メモ欄）は罫線1本ぶん。
   *   ★これは全シーンが上限に届いたときの話。実在の生徒（中3・冬期）でメモ欄は罫線3〜8本残る。
   *   ★上限を上げると、まずメモ欄が消え、さらに上げると⑤⑥⑦の下端が切れる。
   *     ②④を上限いっぱいに取ってあるのは、②④の右（話す・聞く行）を切らずに残すため
   *     （件数の上限を足してもなお中身の長い生徒が、実データで②④をはみ出した）。
   */
  return (
    <div className="interview-report-print-page hidden flex-col bg-white text-black print:flex">
      {/* ヘッダー */}
      <div className="mb-2 flex shrink-0 items-end gap-3 border-b-2 border-black pb-1">
        <div className="text-base font-bold leading-tight">
          {student.last_name} {student.first_name} さん 面談シート
        </div>
        <div className="text-xs text-gray-600">
          {formatGradeLabel(student.grade)}
          {student.school_name ? ` ／ ${student.school_name}` : ''}
        </div>
        <div className="ml-auto text-right text-[10px] leading-tight text-gray-600">
          出力日：{today}
        </div>
      </div>

      <div className="grid shrink-0 grid-cols-2 gap-x-5 gap-y-2.5">
        {/* ① 導入 ＋ ③の想定問答。
            ★①は定型3行で短く、右の③の下に大きな空きが出ていた。③の想定問答（面談中に
              聞かれたら引く控え）をここに置き、③本体（話す行）と同じ段に収める。 */}
        <div className="flex max-h-[60mm] flex-col gap-1 overflow-hidden">
          <div className="flex flex-col gap-1">
            <SceneHeading no="01" label="導入" />
            <Bullets items={INTRO_LINES} />
          </div>
          {qaCapped.shown.length > 0 && (
            <div className="flex flex-col gap-0.5">
              <SceneHeading no="03" label="よく聞かれること" />
              {/* 問を太字にして答えを下げる。★問は1行・答えは2行で切る（全文は画面の③） */}
              {qaCapped.shown.map((item, i) => (
                <div key={i} className="text-[9px] leading-[1.35] text-gray-800">
                  <div className="line-clamp-1 font-bold">Q. {item.q}</div>
                  <div className="line-clamp-2 pl-2.5">A. {item.a}</div>
                </div>
              ))}
              <RestNote hidden={qaCapped.hidden} />
            </div>
          )}
        </div>

        {/* ③ 時期の重要性 */}
        <div className="flex max-h-[60mm] flex-col gap-0.5 overflow-hidden">
          <SceneHeading
            no="03"
            label="時期の重要性"
            badge={`${SEASON_LABELS[seasonKey]}${isExamGrade(student.grade) ? '・受験学年' : ''}`}
          />
          {/* 入試までの日数。★中3のときだけ出る（examDates.ts） */}
          {examCountdown && <p className={`${LINE} font-medium`}>{examCountdown}</p>}
          {examApplication && <p className={`${LINE} font-medium`}>{examApplication}</p>}
          {timing.length > 0 || qa.length > 0 ? (
            <>
              {/* ★定型トークは季節によって10行近い。頭の数行を残す（並びは scenes.ts の順） */}
              <Bullets items={timingCapped.shown} />
              <RestNote hidden={timingCapped.hidden} />
            </>
          ) : (
            <p className="text-[10px] text-gray-500">この学年・季節の定型トークは未登録です</p>
          )}
        </div>

        {/* ② ヒアリング（2段ぶち抜き） */}
        <div className="col-span-2 flex max-h-[88mm] flex-col gap-1 overflow-hidden">
          <SceneHeading no="02" label="ヒアリング" />
          {/* ★小見出し（振り返り／学校／塾／家庭）は画面（InterviewScriptCard）と同じ順・同じ振り分け。
              A4 1枚に収めるため、見出しは1行の小さな文字にして、左右とも空の小見出しは出さない */}
          <div className="flex flex-col gap-0.5">
            {HEARING_GROUP_KEYS.map((group) => {
              const facts = hearingFacts(group);
              const says = hearingSays(group);
              if (facts.length === 0 && says.lines.length === 0) return null;
              return (
                <div key={group}>
                  <div className="border-l-2 border-gray-400 pl-1 text-[9.5px] font-bold leading-tight text-gray-700">
                    {HEARING_GROUPS[group].label}
                  </div>
                  <div className="grid grid-cols-2 gap-x-5">
                    <div className="flex flex-col">
                      {facts.map((node, i) => (
                        <div key={i}>{node}</div>
                      ))}
                    </div>
                    <div className="border-l border-dotted border-gray-400 pl-3.5">
                      {says.lines.map((line, i) => (
                        <div key={i} className={`line-clamp-2 ${LINE}`}>
                          {line.ask ? '□ ' : '・'}
                          {line.text}
                        </div>
                      ))}
                      <RestNote hidden={says.hidden} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ④ 現状の確認（2段ぶち抜き） */}
        <div className="col-span-2 flex max-h-[46mm] flex-col gap-1 overflow-hidden">
          <SceneHeading no="04" label="現状の確認" />
          <div className="grid grid-cols-2 gap-x-5">
            <div className="flex flex-col gap-0.5">
              {statusKeys.map(sectionBlock)}
              {/* 志望校。めやす・本人との差・沿線を1件1行にまとめたブロック */}
              {targetSchoolCapped.shown.map((t, i) => (
                <div key={i} className={`line-clamp-2 ${LINE}`}>
                  ・{i === 0 ? '志望校 ―― ' : ''}
                  {t}
                </div>
              ))}
              <RestNote hidden={targetSchoolCapped.hidden} />
              {/* 直近の模試の合格可能性と、登録に無い公立校の指摘（画面の④右と同じ行） */}
              {mockCapped.shown.map((t, i) => (
                <div key={`mock-${i}`} className={`line-clamp-2 ${LINE}`}>
                  ・{t}
                </div>
              ))}
              <RestNote hidden={mockCapped.hidden} />
              {/* テスト対策（見出し → 結果）。画面の④根拠と同じ関数で組んだ行の頭2件 */}
              {testPrepFactLine && (
                <div className={`line-clamp-2 ${LINE}`}>・{testPrepFactLine}</div>
              )}
            </div>
            <div className="flex flex-col gap-0.5 border-l border-dotted border-gray-400 pl-3.5">
              {/* ★志望校について話すこと（画面の④左の先頭と同じ行）。聞く行は □ を付ける */}
              {talkCapped.shown.length > 0 && (
                <>
                  <div className="text-[9px] font-bold text-gray-600">話すこと</div>
                  {talkCapped.shown.map((line, i) => (
                    <div key={`talk-${i}`} className={`line-clamp-2 ${LINE}`}>
                      {line.kind === 'ask' ? '□ ' : '・'}
                      {line.text}
                    </div>
                  ))}
                  <RestNote hidden={talkCapped.hidden} />
                  <div className="mt-0.5 text-[9px] font-bold text-gray-600">
                    聞くこと・見せる物
                  </div>
                </>
              )}
              {(SHOW_LINES.status ?? []).map((t, i) => (
                <div key={i} className={LINE}>
                  {t}
                </div>
              ))}
              {(ASK_LINES.status ?? []).map((t, i) => (
                <div key={i} className={LINE}>
                  □ {t}
                </div>
              ))}
              {/* 定期テスト・模試のどちらかが1件も記録に無いとき（中学生以上のみ） */}
              {missingRecordAsk.map((t, i) => (
                <div key={`missing-${i}`} className={LINE}>
                  □ {t}
                </div>
              ))}
              {/* 模試に書いたのに志望校に登録されていない公立校 */}
              {mockSchoolLines.ask.map((t, i) => (
                <div key={`mock-ask-${i}`} className={`line-clamp-2 ${LINE}`}>
                  □ {t}
                </div>
              ))}
              {/* 申込から聞くこと（テスト対策の結果・模試の返却）。★1件だけ（printCaps.ts） */}
              {applicationAsksCapped.shown.map((t, i) => (
                <div key={`application-ask-${i}`} className={`line-clamp-1 ${LINE}`}>
                  □ {t}
                </div>
              ))}
              <RestNote hidden={applicationAsksCapped.hidden} />
              {/* 志望校が1件も登録されていないとき */}
              {targetSchoolGap.ask.map((t, i) => (
                <div key={`school-${i}`} className={LINE}>
                  □ {t}
                </div>
              ))}
              {/* ★登録がある生徒には「動いたか」を聞く（カードの TARGET_SCHOOL_ASK_LINES と同じ） */}
              {targetSchools.length > 0 &&
                ['志望校の見学・説明会に行ったか', '併願の私立は決まっているか'].map((t, i) => (
                  <div key={`school-ask-${i}`} className={LINE}>
                    □ {t}
                  </div>
                ))}
            </div>
          </div>
        </div>

        {/* ⑤ プラン提示 */}
        <div className="flex max-h-[44mm] flex-col gap-0.5 overflow-hidden">
          <SceneHeading
            no="05"
            label="プラン提示"
            badge={koushuSummary.koma > 0 ? koushuSummary.label : undefined}
          />
          {regularPatterns.length > 0 && (
            <p className={`line-clamp-1 ${LINE}`}>
              ・通常授業 ―― {formatRegularPatternsSchedule(regularPatterns)}
            </p>
          )}
          {/* ★③で話した「なぜ今か」を、プラン表のところでもう一度出す（scenes.ts） */}
          <Bullets items={planRationaleCapped.shown} />
          {planKeys.map(sectionBlock)}
          {/* これまでの申し込み（今期を除く）。履歴が無ければ行ごと出ない */}
          {koushuHistory.length > 0 && (
            <p className={`line-clamp-2 ${LINE}`}>・講習の履歴 ―― {koushuHistory.join('／')}</p>
          )}
          {script?.bridge && (
            <div className={`line-clamp-2 rounded bg-teal-50 px-2 py-0.5 ${LINE} text-teal-800`}>
              {script.bridge}
            </div>
          )}
          {(SHOW_LINES.plan ?? []).map((t, i) => (
            <div key={i} className="line-clamp-2 text-[9px] leading-[1.4] text-gray-600">
              見せる物 ―― {t}
            </div>
          ))}
        </div>

        {/* ⑥⑦ 申し込み・クロージング（定型。長さが変わらないので絞らない） */}
        <div className="flex max-h-[44mm] flex-col gap-1.5 overflow-hidden">
          <div className="flex flex-col gap-0.5">
            <SceneHeading no="06" label="申し込み" badge={koushuSummary.label} />
            <Bullets items={APPLY_LINES} />
          </div>
          <div className="flex flex-col gap-0.5">
            <SceneHeading no="07" label="クロージング" />
            <Bullets items={CLOSING_LINES} />
          </div>
        </div>
      </div>

      {/* つなげて見えること（AI生成時のみ）。★2行で切る */}
      {script?.thread && (
        <div className={`mt-1.5 line-clamp-2 shrink-0 ${LINE}`}>
          <span className="font-bold">つなげて見えること：</span>
          {script.thread}
        </div>
      )}

      {/*
        面談中のメモ欄（手書き罫線）。★紙（globals.css で 190mm×276mm に固定した箱）の残りを全部使う。
        以前は箱に高さが無かったので固定の 250px を取っていたが、中身が長い生徒ではそのぶん
        2枚目に溢れていた。いまは flex-1 で「余った高さ」だけを使い、min-h-0 で縮められるようにしてある。
        中身が多い生徒ほど狭くなり、余りが無ければ罫線は1本も出ない（中身を切るよりメモ欄を削る）。
      */}
      <div className="mt-2 flex min-h-0 flex-1 flex-col gap-0.5 overflow-hidden">
        <div className="shrink-0 border-b border-gray-300 pb-0.5 text-[9px] font-bold text-gray-600">
          面談中のメモ
        </div>
        <div
          className="min-h-0 flex-1"
          style={{
            backgroundImage:
              'repeating-linear-gradient(to bottom, transparent, transparent 24px, #e7e5e4 24px, #e7e5e4 25px)',
          }}
        />
      </div>
      {/* ★末尾の「NEST／面談シート／出力日」の行は外した（2026-09-23）。出力日はヘッダーにあり、
          その1行ぶんをメモ欄に回す */}
    </div>
  );
}
