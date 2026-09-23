'use client';

/**
 * 面談ワークスペース 左カラム: 「面談で話すこと」カード（旧「報告事項」カード）
 * ------------------------------------------------------------------
 * 「前回の申し送り」の直下に置く。「報告事項を作る」を「面談で話すこと」に置き換え、
 * データの種類順（成績／授業の様子…）ではなく面談の流れ順（①導入〜⑦クロージング）で並べる。
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

import { useEffect, useMemo, useState } from 'react';
import { Sparkles, RefreshCw, FileText, ArrowRight } from 'lucide-react';
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
} from './interview.shared';
import {
  SCENE_KEYS,
  SCENE_LABEL,
  SCENE_OPEN_BY_DEFAULT,
  SCENE_OF_SECTION,
  ASK_LINES,
  SHOW_LINES,
  INTRO_LINES,
  CLOSING_LINES,
  APPLY_LINES,
  timingLines,
  planRationaleLines,
  isExamGrade,
  type SceneKey,
} from '@/lib/interview/scenes';
import { examCountdownLine } from '@/lib/interview/examDates';
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
}

/** BRIEF_SECTIONS の並びのまま、そのシーンに属するセクションだけを抜き出す */
function sectionsForScene(sections: ScriptSectionView[], scene: SceneKey): ScriptSectionView[] {
  return sections.filter((s) => SCENE_OF_SECTION[s.key] === scene);
}

/* ============================================================
 * 1行の見た目（種類ごと）
 * ========================================================== */

/** 伝える（システムの事実）。丸ドットだけの素の1行 */
function TellLine({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 text-[13px] leading-snug text-text-body">
      <span
        className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-text-heading"
        aria-hidden="true"
      />
      <span>{text}</span>
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

  /** シーンごとのAIセクション（tell+seen）を並べる小コンポーネント */
  const renderAiSections = (scene: SceneKey) => {
    if (!view) return null;
    return sectionsForScene(view.sections, scene).map((s) => (
      <div key={s.key} className="flex flex-col gap-1">
        {s.current.map((line, i) => (
          <TellLine key={i} text={i === 0 ? `${s.label} ―― ${line}` : line} />
        ))}
        <SeenLine
          label={s.label}
          value={s.seen}
          sign={s.sign}
          onChange={(v) => editSeen(s.key, v)}
        />
      </div>
    ));
  };

  return (
    <div className="rounded-lg border border-border bg-surface-raised p-3">
      <div className="flex items-center gap-1.5">
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-ink" aria-hidden="true" />
        <span className="text-xs font-semibold text-text-heading">面談で話すこと</span>
        <span className="ml-auto shrink-0 text-[11px] text-text-faint">
          {madeAt ? `${madeAt.slice(5).replace('-', '/')} に作成 ・ ` : ''}
          {/* ★見比べるときに取り違えないよう、作ったモデルは結果のそばに常に出す（admin/owner のみ） */}
          {canChooseModel && madeWithModelKey ? `${MODEL_LABELS[madeWithModelKey]}で作成 ・ ` : ''}
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
        <div className="mt-2 flex flex-col gap-2.5">
          {/* 凡例 */}
          <div className="flex flex-wrap items-center gap-3 rounded-md bg-surface px-2.5 py-1.5 text-[11px] text-text-muted">
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-text-heading" aria-hidden="true" />
              伝える
            </span>
            <span className="flex items-center gap-1">
              <Sparkles className="h-3 w-3 text-ink" aria-hidden="true" />
              AIの着眼点
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-sm border border-border" aria-hidden="true" />
              聞く
            </span>
            <span className="flex items-center gap-1">
              <FileText className="h-3 w-3 text-warning" aria-hidden="true" />
              見せる
            </span>
          </div>

          {SCENE_KEYS.map((scene) => {
            const askLines = ASK_LINES[scene] ?? [];
            const showLines = SHOW_LINES[scene] ?? [];

            return (
              <details
                key={scene}
                open={SCENE_OPEN_BY_DEFAULT[scene]}
                className="rounded-md border border-border-subtle"
              >
                <summary className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-xs font-bold text-text-heading">
                  <span>{SCENE_LABEL[scene]}</span>
                  {/* シーンごとの短い補足バッジ */}
                  {scene === 'timing' && (
                    <span className="font-normal text-text-faint">
                      {SEASON_LABELS[seasonKey]}
                      {isExamGrade(student.grade) ? '・受験学年' : ''}
                    </span>
                  )}
                  {scene === 'plan' && seasonEnrollments.length > 0 && (
                    <span className="ml-auto font-normal text-text-faint">
                      {SEASON_LABELS[seasonKey]} 申込 {seasonKoma}コマ
                    </span>
                  )}
                  {scene === 'apply' && (
                    <span className="ml-auto font-normal text-text-faint">
                      {applied ? '申込あり' : '未申込'}
                    </span>
                  )}
                </summary>

                <div className="flex flex-col gap-1.5 px-2.5 pb-2.5">
                  {scene === 'intro' && INTRO_LINES.map((t, i) => <TellLine key={i} text={t} />)}

                  {scene === 'hearing' && (
                    <>
                      {renderAiSections('hearing')}
                      {/* 目標の達成度。AI（renderAiSections）を通さず、システムが試験目標と
                          成績を突き合わせて直接組む「伝える」行 */}
                      {goalAchievement.tell.map((t, i) => (
                        <TellLine key={`goal-${i}`} text={i === 0 ? `目標の達成度 ―― ${t}` : t} />
                      ))}
                      {(askLines.length > 0 || goalAchievement.ask.length > 0) && (
                        <>
                          <div className="mt-0.5 h-px bg-border-subtle" />
                          <div className="text-[11px] font-medium text-text-faint">
                            ここから先は聞くこと（NESTに記録が無い）
                          </div>
                          {askLines.map((t, i) => {
                            const id = `hearing:${i}`;
                            return (
                              <AskLine
                                key={id}
                                text={t}
                                checked={checked[id] === true}
                                onToggle={() => toggleAsk(id)}
                              />
                            );
                          })}
                          {/* 目標はあるが結果が成績側にまだ入っていない試験。台本が入力を促す形にする */}
                          {goalAchievement.ask.map((t, i) => {
                            const id = `hearing:goal:${i}`;
                            return (
                              <AskLine
                                key={id}
                                text={t}
                                checked={checked[id] === true}
                                onToggle={() => toggleAsk(id)}
                              />
                            );
                          })}
                        </>
                      )}
                    </>
                  )}

                  {scene === 'timing' && (
                    <>
                      {/* 入試までの日数。★中3のときだけ出る（examDates.ts）。
                          中1・中2に「あと900日」と言っても面談では使わない */}
                      {examCountdown && <TellLine text={examCountdown} />}
                      {timing.length > 0 ? (
                        timing.map((t, i) => <TellLine key={i} text={t} />)
                      ) : (
                        <span className="text-[11px] text-text-faint">
                          この学年・季節の定型トークはまだ用意されていません
                        </span>
                      )}
                    </>
                  )}

                  {scene === 'status' && (
                    <>
                      {renderAiSections('status')}
                      {/* 志望校との差。マスタに当たり本人の内申・偏差値も取れたときだけ出る */}
                      {targetSchoolGap.tell.map((t, i) => (
                        <TellLine key={`gap-${i}`} text={t} />
                      ))}
                      {showLines.map((t, i) => (
                        <ShowLine key={i} text={t} />
                      ))}
                      {askLines.map((t, i) => {
                        const id = `status:${i}`;
                        return (
                          <AskLine
                            key={id}
                            text={t}
                            checked={checked[id] === true}
                            onToggle={() => toggleAsk(id)}
                          />
                        );
                      })}
                      {/* 定期テスト・模試のどちらかが1件も記録に無いとき（中学生以上のみ） */}
                      {missingRecordAsk.map((t, i) => {
                        const id = `status:missing:${i}`;
                        return (
                          <AskLine
                            key={id}
                            text={t}
                            checked={checked[id] === true}
                            onToggle={() => toggleAsk(id)}
                          />
                        );
                      })}
                      {/* 志望校が1件も登録されていないとき */}
                      {targetSchoolGap.ask.map((t, i) => {
                        const id = `status:target-school:${i}`;
                        return (
                          <AskLine
                            key={id}
                            text={t}
                            checked={checked[id] === true}
                            onToggle={() => toggleAsk(id)}
                          />
                        );
                      })}
                    </>
                  )}

                  {scene === 'plan' && (
                    <>
                      {regularPatterns.length > 0 && (
                        <TellLine
                          text={`通常授業 ―― ${formatRegularPatternsSchedule(regularPatterns)}`}
                        />
                      )}
                      {/* ★③で話した「なぜ今か」を、プラン表を開いた場でもう一度出す。
                          ③と同じ行（scenes.ts の KANAGAWA_JUNIOR3_WINTER_SUBJECTS） */}
                      {planRationale.map((t, i) => (
                        <TellLine key={`rationale-${i}`} text={t} />
                      ))}
                      {renderAiSections('plan')}
                      {view.bridge && (
                        <div className="flex items-start gap-2 rounded-md bg-info-subtle px-2.5 py-1.5 text-[13px] leading-snug text-info">
                          <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          <span className="font-bold">{view.bridge}</span>
                        </div>
                      )}
                      {showLines.map((t, i) => (
                        <ShowLine key={i} text={t} />
                      ))}
                    </>
                  )}

                  {scene === 'apply' && (
                    <>
                      <TellLine
                        text={`申込の状況 ―― ${
                          applied
                            ? `申込あり（${SEASON_LABELS[seasonKey]} ${seasonKoma}コマ）`
                            : '未申込'
                        }`}
                      />
                      {APPLY_LINES.map((t, i) => (
                        <TellLine key={i} text={t} />
                      ))}
                    </>
                  )}

                  {scene === 'closing' &&
                    CLOSING_LINES.map((t, i) => <TellLine key={i} text={t} />)}
                </div>
              </details>
            );
          })}

          {/* 空の見出しは出さない（無いものを見出しだけ立てると「抜けている」に見える） */}
          {view.thread && (
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-bold text-text-heading">つなげて見えること</span>
              <p className="text-xs leading-snug text-text-heading">{view.thread}</p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
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
            伝える行はシステムの記録です。AIの着眼点は直せます。聞くのチェックは保存されません
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
  );
}
