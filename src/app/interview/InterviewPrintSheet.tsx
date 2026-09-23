/**
 * 面談ワークスペース 印刷シート（A4縦1枚）
 * ------------------------------------------------------------------
 * courses/progress の CourseProgressReport と同じ流儀: 画面には `hidden print:block` で隠しておき、
 * 印刷時だけ表示される専用ブロック。名前付きページ（globals.css の `interviewreport`）で
 * 用紙サイズ・向きを固定する。
 *
 * ★面談の流れ順（InterviewScriptCard と同じ①〜⑦シーン）に作り替えた。①③⑦は定型なので短く、
 *   ②④を厚く配置し、下半分は面談中の手書きメモ欄（罫線）にする。
 * ★①③⑦・「聞くこと」はAI未生成でも刷れる（scenes.ts の定型データだけで組める）。
 *   ②④⑤の「伝える」行も interview.shared.ts の buildTellSections で独自に組み直しており、
 *   InterviewScriptCard（AIカード）を1回も押していなくても最低限の中身が印刷できる。
 *   「見えること」「つながり」はAIを起動していれば script から上乗せする。
 */

import type { AssessmentWithScores, Student, StudentInterview } from '@/types/database';
import { SEASON_LABELS } from '@/types/database';
import {
  buildTellSections,
  buildGoalAchievementLines,
  buildKoushuHistoryLines,
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
} from './interview.shared';
import type { TextbookProgressData } from './ProgressPanel';
import type { DisciplineSessionRow } from '@/lib/api/progress-sessions';
import type { KoushuEnrollment } from '@/lib/api/seasonalCourses';
import type { SeasonalProposalSeasonSummary } from '@/lib/api/seasonalProposalSummary';
import type { ScheduleRegularPattern } from '@/types/schedule';
import type { StudentExamGoalWithType } from '@/lib/api/progress';
import type { TargetSchoolRow } from '@/lib/api/targetSchools';
import type { ScriptView } from './InterviewScriptCard';
import {
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
} from '@/lib/interview/scenes';
import { examCountdownLine, examApplicationLine } from '@/lib/interview/examDates';
import { regionOfSchool } from '@/lib/interview/region';
import { briefSectionLabel, followUpItemKey, type BriefSectionKey } from '@/lib/ai/interviewBrief';
import { formatGradeLabel } from '@/lib/utils/gradeLabel';

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

function Bullets({ items }: { items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="m-0 list-disc pl-[15px] text-[10px] leading-[1.6] text-gray-800">
      {items.map((t, i) => (
        <li key={i}>{t}</li>
      ))}
    </ul>
  );
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
  });
  // 目標の達成度・志望校との差・成績記録なしの「聞くこと」も同じ関数で組み直す
  // （InterviewScriptCard と二重実装しない。画面と紙で数字がずれる事故を防ぐ）
  const goalAchievement = buildGoalAchievementLines(examGoals, assessments);
  const targetSchoolGap = buildTargetSchoolGapLines(targetSchools, assessments);
  const missingRecordAsk = buildMissingRecordAskLines(assessments, student.grade);
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
    latestOwnKanagawaNaishin(assessments)
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
    return (
      <div key={key} className="text-[10px] leading-[1.6] text-gray-800">
        <span>
          ・{briefSectionLabel(key)} ―― {current.join('／')}
        </span>
        {seen && <div className="ml-3 text-purple-800">→ {seen}</div>}
      </div>
    );
  }

  const statusKeys = (Object.keys(SCENE_OF_SECTION) as BriefSectionKey[]).filter(
    (k) => SCENE_OF_SECTION[k] === 'status'
  );
  const planKeys = (Object.keys(SCENE_OF_SECTION) as BriefSectionKey[]).filter(
    (k) => SCENE_OF_SECTION[k] === 'plan'
  );

  return (
    <div className="interview-report-print-page hidden bg-white text-black print:block">
      {/* ヘッダー */}
      <div className="mb-3 flex items-end gap-3 border-b-2 border-black pb-1.5">
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

      <div className="grid grid-cols-2 gap-x-5 gap-y-3.5">
        {/* ① 導入 */}
        <div className="flex flex-col gap-1">
          <SceneHeading no="01" label="導入" />
          <Bullets items={INTRO_LINES} />
        </div>

        {/* ③ 時期の重要性 */}
        <div className="flex flex-col gap-1">
          <SceneHeading
            no="03"
            label="時期の重要性"
            badge={`${SEASON_LABELS[seasonKey]}${isExamGrade(student.grade) ? '・受験学年' : ''}`}
          />
          {/* 入試までの日数。★中3のときだけ出る（examDates.ts） */}
          {examCountdown && <p className="text-[10px] font-medium">{examCountdown}</p>}
          {examApplication && <p className="text-[10px] font-medium">{examApplication}</p>}
          {timing.length > 0 || qa.length > 0 ? (
            <>
              <Bullets items={timing} />
              {/* 想定問答。面談中に引くものなので、問を太字にして答えを下げる */}
              {qa.map((item, i) => (
                <div key={i} className="text-[9.5px] leading-[1.5] text-gray-800">
                  <div className="font-bold">Q. {item.q}</div>
                  <div className="pl-2.5">A. {item.a}</div>
                </div>
              ))}
            </>
          ) : (
            <p className="text-[10px] text-gray-500">この学年・季節の定型トークは未登録です</p>
          )}
        </div>

        {/* ② ヒアリング（2段ぶち抜き） */}
        <div className="col-span-2 flex flex-col gap-1 break-inside-avoid">
          <SceneHeading no="02" label="ヒアリング" />
          <div className="grid grid-cols-2 gap-x-5">
            {/* ★並びは画面（InterviewScriptCard の sceneFactLines('hearing')）と揃える。
                前回の面談から → 前回の約束 → 前回の要望 → 授業の様子 → 宿題・遅刻 → 目標の達成度 */}
            <div className="flex flex-col gap-1">
              {sectionBlock('lastInterview')}
              {/* 前回の約束（未完了タスク）・前回の要望（直近の面談記録） */}
              {previous.promises.length > 0 && (
                <div className="text-[10px] leading-[1.6] text-gray-800">
                  ・前回の約束 ―― {previous.promises.join('／')}
                </div>
              )}
              {previous.requests.length > 0 && (
                <div className="text-[10px] leading-[1.6] text-gray-800">
                  ・前回の要望・方針 ―― {previous.requests.join('／')}
                </div>
              )}
              {sectionBlock('lessons')}
              {sectionBlock('discipline')}
              {sectionBlock('parent')}
              {/* 目標の達成度。試験目標と成績を突き合わせて組む「伝える」行 */}
              {goalAchievement.tell.length > 0 && (
                <div className="text-[10px] leading-[1.6] text-gray-800">
                  ・目標の達成度 ―― {goalAchievement.tell.join('／')}
                </div>
              )}
            </div>
            <div className="border-l border-dotted border-gray-400 pl-3.5">
              {/* ★前回の要望のうち、塾から対応を伝えるもの（画面と同じ振り分け） */}
              {followUpReports.length > 0 && (
                <>
                  <div className="mb-0.5 text-[9px] font-bold text-gray-600">話すこと</div>
                  {followUpReports.map((t, i) => (
                    <div key={`report-${i}`} className="text-[10px] leading-[1.6] text-gray-800">
                      ・{t}
                    </div>
                  ))}
                </>
              )}
              <div
                className={`mb-0.5 text-[9px] font-bold text-gray-600 ${
                  followUpReports.length > 0 ? 'mt-1' : ''
                }`}
              >
                聞くこと
              </div>
              {/* 前回の約束・要望のうち、家庭に聞くもの */}
              {followUpAsks.map((t, i) => (
                <div key={`followup-${i}`} className="text-[10px] leading-[1.6] text-gray-800">
                  □ {t}
                </div>
              ))}
              {(ASK_LINES.hearing ?? []).map((t, i) => (
                <div key={i} className="text-[10px] leading-[1.6] text-gray-800">
                  □ {t}
                </div>
              ))}
              {/* 目標はあるが結果が成績側にまだ入っていない試験 */}
              {goalAchievement.ask.map((t, i) => (
                <div key={`goal-${i}`} className="text-[10px] leading-[1.6] text-gray-800">
                  □ {t}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ④ 現状の確認（2段ぶち抜き） */}
        <div className="col-span-2 flex flex-col gap-1 break-inside-avoid">
          <SceneHeading no="04" label="現状の確認" />
          <div className="grid grid-cols-2 gap-x-5">
            <div className="flex flex-col gap-1">
              {statusKeys.map(sectionBlock)}
              {/* 志望校。めやす・本人との差・沿線を1件1行にまとめたブロック */}
              {targetSchoolGap.tell.map((t, i) => (
                <div key={i} className="text-[10px] leading-[1.6] text-gray-800">
                  ・{i === 0 ? '志望校 ―― ' : ''}
                  {t}
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-1 border-l border-dotted border-gray-400 pl-3.5">
              {/* ★志望校について話すこと（画面の④左の先頭と同じ行）。聞く行は □ を付ける */}
              {targetSchoolTalk.length > 0 && (
                <>
                  <div className="mb-0.5 text-[9px] font-bold text-gray-600">話すこと</div>
                  {targetSchoolTalk.map((line, i) => (
                    <div key={`talk-${i}`} className="text-[10px] leading-[1.6] text-gray-800">
                      {line.kind === 'ask' ? '□ ' : '・'}
                      {line.text}
                    </div>
                  ))}
                  <div className="mb-0.5 mt-1 text-[9px] font-bold text-gray-600">
                    聞くこと・見せる物
                  </div>
                </>
              )}
              {(SHOW_LINES.status ?? []).map((t, i) => (
                <div key={i} className="text-[10px] leading-[1.6] text-gray-800">
                  {t}
                </div>
              ))}
              {(ASK_LINES.status ?? []).map((t, i) => (
                <div key={i} className="text-[10px] leading-[1.6] text-gray-800">
                  □ {t}
                </div>
              ))}
              {/* 定期テスト・模試のどちらかが1件も記録に無いとき（中学生以上のみ） */}
              {missingRecordAsk.map((t, i) => (
                <div key={`missing-${i}`} className="text-[10px] leading-[1.6] text-gray-800">
                  □ {t}
                </div>
              ))}
              {/* 志望校が1件も登録されていないとき */}
              {targetSchoolGap.ask.map((t, i) => (
                <div key={`school-${i}`} className="text-[10px] leading-[1.6] text-gray-800">
                  □ {t}
                </div>
              ))}
              {/* ★登録がある生徒には「動いたか」を聞く（カードの TARGET_SCHOOL_ASK_LINES と同じ） */}
              {targetSchools.length > 0 &&
                ['志望校の見学・説明会に行ったか', '併願の私立は決まっているか'].map((t, i) => (
                  <div key={`school-ask-${i}`} className="text-[10px] leading-[1.6] text-gray-800">
                    □ {t}
                  </div>
                ))}
            </div>
          </div>
        </div>

        {/* ⑤ プラン提示 */}
        <div className="flex flex-col gap-1 break-inside-avoid">
          <SceneHeading
            no="05"
            label="プラン提示"
            badge={koushuSummary.koma > 0 ? koushuSummary.label : undefined}
          />
          {regularPatterns.length > 0 && (
            <p className="text-[10px] leading-[1.6] text-gray-800">
              ・通常授業 ―― {formatRegularPatternsSchedule(regularPatterns)}
            </p>
          )}
          {/* ★③で話した「なぜ今か」を、プラン表のところでもう一度出す（scenes.ts） */}
          <Bullets items={planRationale} />
          {planKeys.map(sectionBlock)}
          {/* これまでの申し込み（今期を除く）。履歴が無ければ行ごと出ない */}
          {koushuHistory.length > 0 && (
            <p className="text-[10px] leading-[1.6] text-gray-800">
              ・講習の履歴 ―― {koushuHistory.join('／')}
            </p>
          )}
          {script?.bridge && (
            <div className="rounded bg-teal-50 px-2 py-1 text-[10px] leading-[1.6] text-teal-800">
              {script.bridge}
            </div>
          )}
          {(SHOW_LINES.plan ?? []).map((t, i) => (
            <div key={i} className="text-[9.5px] text-gray-600">
              見せる物 ―― {t}
            </div>
          ))}
        </div>

        {/* ⑥⑦ 申し込み・クロージング */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <SceneHeading no="06" label="申し込み" badge={koushuSummary.label} />
            <Bullets items={APPLY_LINES} />
          </div>
          <div className="flex flex-col gap-1">
            <SceneHeading no="07" label="クロージング" />
            <Bullets items={CLOSING_LINES} />
          </div>
        </div>
      </div>

      {/* つなげて見えること（AI生成時のみ） */}
      {script?.thread && (
        <div className="mt-2 text-[10px] leading-[1.6] text-gray-800">
          <span className="font-bold">つなげて見えること：</span>
          {script.thread}
        </div>
      )}

      {/*
        面談中のメモ欄（手書き罫線）。★用紙の残り全部を使いたいが、@page の A4 指定は
        印刷時のページ物理サイズであって画面のボックス高さには効かないため、flex-1 で
        「残りを埋める」ことはできない（親に高さの制約が無い）。かわりに十分な高さを
        固定で確保しておく。中身（①〜⑦）が短い生徒ほど余白が増えるだけで、はみ出す事故は起きない。
      */}
      <div className="mt-3.5 flex flex-col gap-1">
        <div className="border-b border-gray-300 pb-0.5 text-[9px] font-bold text-gray-600">
          面談中のメモ
        </div>
        <div
          className="min-h-[300px]"
          style={{
            backgroundImage:
              'repeating-linear-gradient(to bottom, transparent, transparent 24px, #e7e5e4 24px, #e7e5e4 25px)',
          }}
        />
      </div>

      <div className="mt-1 text-right text-[9px] text-gray-400">NEST／面談シート／{today}</div>
    </div>
  );
}
