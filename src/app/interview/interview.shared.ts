/**
 * 面談ワークスペース共有ロジック
 * ------------------------------------------------------------------
 * ページ本体・左右カラム・印刷シートの複数コンポーネントから参照する
 * 純粋関数・型・定数をここにまとめる（ロジックの二重実装を防ぐため）。
 */

import type {
  AssessmentWithScores,
  CurriculumItemWithProgress,
  StudentInterview,
  StudentTextbookWithDetails,
} from '@/types/database';
import { ASSESSMENT_NAME_LABELS, SEASON_LABELS, SUBJECT_LABELS } from '@/types/database';
import type { ScheduleRegularPattern } from '@/types/schedule';
import { DAY_OF_WEEK_LABELS } from '@/types/schedule';
import type { KoushuEnrollment } from '@/lib/api/seasonalCourses';
import type {
  SeasonalProposalSeasonSummary,
  SeasonalProposalStatus,
} from '@/lib/api/seasonalProposalSummary';
import { normalizeKomaBySubject } from '@/lib/utils/komaBySubject';
import type { BriefSectionKey } from '@/lib/ai/interviewBrief';
import type { TextbookProgressData } from './ProgressPanel';
import type { DisciplineSessionRow } from '@/lib/api/progress-sessions';
import type { TargetSchoolMaster, TargetSchoolRow } from '@/lib/api/targetSchools';
import {
  calcKanagawaNaishin135,
  calcTokyoNaishin,
  type KanagawaNaishin135Result,
  type ReportCardInput,
} from '@/lib/utils/convertedNaishin';
import type { Region } from '@/lib/interview/region';
import { TOKYO_NAISHIN_POINT_WEIGHT } from '@/lib/interview/scenes';

/* ============================================================
 * 日付ユーティリティ
 * ========================================================== */

/** 今日を基準とした経過日数（'YYYY-MM-DD' 文字列同士の日数差） */
export function daysSince(dateStr: string): number {
  const d = new Date(dateStr);
  const today = new Date();
  d.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  return Math.round((today.getTime() - d.getTime()) / 86400000);
}

/** 'YYYY-MM-DD' を '2026/7/10（金）' 形式にする（InterviewList.formatDate と同じ表記） */
export function fmtDateJa(dateStr: string): string {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return dateStr;
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const dow = ['日', '月', '火', '水', '木', '金', '土'][date.getDay()];
  return `${y}/${m}/${d}（${dow}）`;
}

/* ============================================================
 * 前回の申し送り抽出
 * ========================================================== */

/**
 * 面談本文から「## 次回への申し送り」見出しセクションを抜き出す純粋関数。
 *
 * 面談記録はNotta（文字起こし）取込やモーダル編集で自由記述されるが、本文中に
 * `## 次回への申し送り` という見出しが書かれていれば、次回の面談時に左カラムの
 * 「前回の申し送り」ピン留めカードへ表示するため、この見出し以降〜次の `##` 見出し
 *（無ければ末尾）までを取り出す。
 *
 * 見出しが見つからない場合は null を返す。呼び出し側で「本文の先頭200字」等に
 * フォールバックさせる想定（申し送りを書く運用が徹底されていない過去記録にも配慮）。
 */
export function extractHandover(content: string): string | null {
  const heading = '## 次回への申し送り';
  const idx = content.indexOf(heading);
  if (idx === -1) return null;

  const afterHeading = content.slice(idx + heading.length);
  // 次の見出し（改行 + "## "）が来たらそこで打ち切る。無ければ末尾まで。
  const nextHeadingOffset = afterHeading.search(/\n##\s/);
  const excerpt =
    nextHeadingOffset === -1 ? afterHeading : afterHeading.slice(0, nextHeadingOffset);
  const trimmed = excerpt.trim();
  return trimmed || null;
}

/** 申し送りとして1行に載せる長さ。これ以上は面談中に読まれない */
const MAX_HANDOVER_LENGTH = 120;

/**
 * 面談記録に `## 次回への申し送り` が無いときの受け皿。
 *
 * ★Notta（文字起こし）取込の本文は【タイトル】【録音日時】【音声URL】で始まる。
 *   そのまま先頭を切り出すと、面談で読む行が録音日時とURLで埋まる（実機で確認した）。
 *   話の中身が始まるのは「--- Notta 要約 ---」や最初の「■」見出しから。
 *   見つかればそこから、無ければメタ行だけを落として返す。
 */
export function stripNottaMeta(content: string): string {
  const summaryIdx = content.indexOf('--- Notta 要約 ---');
  if (summaryIdx !== -1) {
    const after = content.slice(summaryIdx + '--- Notta 要約 ---'.length).trim();
    if (after) return after;
  }
  const sectionIdx = content.indexOf('■');
  if (sectionIdx !== -1) return content.slice(sectionIdx).trim();

  // メタ行（【…】で始まる行）だけを落とす
  const rest = content
    .split('\n')
    .filter((line) => !/^\s*【(タイトル|録音日時|音声URL|参加者)】/.test(line))
    .join('\n')
    .trim();
  return rest || content;
}

/* ============================================================
 * 材料カードのアンカー
 * ========================================================== */

/**
 * 「材料（記録）」の段に並ぶカードの id。
 * ★台本（InterviewScriptCard）の「事実」の行から、その元になったカードへ飛ぶために使う。
 *   飛び先とアンカーを別々の場所に書くとすぐずれるので、ここ1箇所で持つ。
 */
export const INTERVIEW_CARD_IDS = {
  score: 'interview-card-score',
  progress: 'interview-card-progress',
  discipline: 'interview-card-discipline',
  records: 'interview-card-records',
} as const;

/* ============================================================
 * Notta 取込本文の構造化
 * ========================================================== */

/** Notta 要約の1見出しぶん */
export interface NottaSection {
  heading: string;
  bullets: string[];
}

/** parseNottaSummary の戻り。面談記録カードが構造化して描くための材料 */
export interface NottaSummary {
  /** 【タイトル】の中身。無ければ null */
  title: string | null;
  /** 【音声URL】のURL。無ければ null */
  audioUrl: string | null;
  /** 中身のある見出しだけ（この順に出す） */
  sections: NottaSection[];
  /** 中身が空だった見出しの名前。末尾に「記載なし：A・B」と1行でまとめる */
  omitted: string[];
}

/** 本文に出さないメタ行。面談で読む行が録音日時とURLで埋まるため（stripNottaMeta と同じ対象） */
const NOTTA_META_KEYS = ['タイトル', '録音日時', '音声URL', '参加者'] as const;

/**
 * 「中身が無い」箇条書きの言い回し。
 * ★Nottaは話題が出なかった見出しも必ず立て、「〜は会話の中で確認できませんでした」と書く。
 *   実物では本文の半分がこれで埋まるため、見出しごと畳んで末尾に1行でまとめる。
 * ★2026-09-23 に言い回しを足し、**箇条書き1件ずつ**落とすようにした。
 *   「保護者からの明確な要望として確認できる発言はありません。」のような1件が中身のある
 *   箇条書きに混ざると、②で「前回の要望」として読み上げ、「対応を伝える」行まで立っていた
 *  （小川 華佳さんの実例）。
 * ★文末で当てる（末尾の句点・空白は許す）。文中に「ありませんでした」を含むだけの
 *   中身のある箇条書き（「宿題は問題ありませんでしたが、英語の小テストが…」）まで消さないため。
 */
const NOTTA_EMPTY_BULLET =
  /(見つかりませんでした|確認できませんでした|確認できません|見当たりません|記載がありません|発言はありません|ありませんでした|特になし)[。．.\s]*$/;

/** 行末に紛れ込む不可視文字（Nottaの出力に LRM が混ざる）ごと落とす */
function trimNottaLine(line: string): string {
  return line.replace(/[\s‎‏​]+$/g, '').replace(/^[\s‎‏​]+/g, '');
}

/**
 * Notta（文字起こし）取込の本文を、見出し＋箇条書きに組み直す。
 *
 * ★Notta以外の本文（手入力の短い記録）では null を返す。呼び出し側は従来どおり
 *   本文をそのまま出す。構造が無いものを無理に節に割ると、かえって読めなくなる。
 * ★見出しの書き方は実物に2通りある（「■ 塾からの報告」と「【塾からの報告】」）。
 *   Nottaの出力テンプレートが途中で変わった名残なので、両方を見出しとして扱う。
 *   ただし【タイトル】【録音日時】【音声URL】【参加者】はメタなので見出しにしない。
 * ★見出しが1つも取れなければ null（＝構造化できていない）。音声URLだけ拾って
 *   本文を節に割らずに出す、という中途半端な状態を作らない。
 */
export function parseNottaSummary(content: string): NottaSummary | null {
  const lines = content.split('\n');

  let title: string | null = null;
  let audioUrl: string | null = null;
  const sections: NottaSection[] = [];
  let current: NottaSection | null = null;

  for (const raw of lines) {
    const line = trimNottaLine(raw);
    if (!line) continue;

    // 「--- Notta 要約 ---」の区切りは出さない
    if (/^-{2,}\s*Notta\s*要約\s*-{2,}$/.test(line)) continue;

    const meta = line.match(/^【(タイトル|録音日時|音声URL|参加者)】\s*(.*)$/);
    if (meta) {
      if (meta[1] === 'タイトル' && meta[2]) title = meta[2];
      if (meta[1] === '音声URL') {
        const url = meta[2].match(/https?:\/\/\S+/);
        if (url) audioUrl = url[0];
      }
      continue;
    }

    const headingMark = line.match(/^■\s*(.+)$/);
    const headingBracket = line.match(/^【(.+?)】$/);
    const heading = headingMark?.[1] ?? headingBracket?.[1];
    if (heading && !(NOTTA_META_KEYS as readonly string[]).includes(heading)) {
      current = { heading: trimNottaLine(heading), bullets: [] };
      sections.push(current);
      continue;
    }

    // 見出しが始まる前の行は捨てる（メタの残りか、Nottaの前置き）
    if (!current) continue;
    const bullet = trimNottaLine(line.replace(/^[・\-*]\s*/, ''));
    // ★「確認できませんでした」等の箇条書きは1件ずつ落とす（NOTTA_EMPTY_BULLET の注記）
    if (bullet && !NOTTA_EMPTY_BULLET.test(bullet)) current.bullets.push(bullet);
  }

  if (sections.length === 0) return null;

  // ★箇条書きがすべて落ちた見出しは畳む。
  //   1件も箇条書きが無い見出しも同じ扱い（読む人にとっては同じ「記載なし」）。
  const kept: NottaSection[] = [];
  const omitted: string[] = [];
  for (const s of sections) {
    if (s.bullets.length === 0) {
      omitted.push(s.heading);
    } else {
      kept.push(s);
    }
  }

  return { title, audioUrl, sections: kept, omitted };
}

/* ============================================================
 * 進行表サマリ
 * ========================================================== */

export interface TextbookProgressSummary {
  id: string;
  name: string;
  subject: string;
  total: number;
  done: number;
  progressPct: number;
  stalled: boolean;
  lastDate: string | null;
}

/**
 * 進行表1テキスト分の進捗集計。
 *
 * newProgress.shared.ts の progressStats/isStalled と同じ意味論（最終指導日から14日超で停滞）を
 * getStudentProgress() が返す CurriculumItemWithProgress[] に対して計算し直したもの。
 * 面談ページは生徒単体のテキスト一覧から取得する経路（進行表ページはテキスト一覧を通塾ボードと
 * 一括取得する経路）が異なるため、関数自体は共有せずここで同じロジックを再実装している。
 * 停滞判定のしきい値（14日）を変える場合は newProgress.shared.ts の isStalled も合わせて直すこと。
 */
export function summarizeTextbookProgress(
  textbook: StudentTextbookWithDetails,
  rows: CurriculumItemWithProgress[]
): TextbookProgressSummary {
  const total = rows.length;
  const done = rows.filter((r) => (r.progress?.lessons || []).some((l) => l.lesson_date)).length;

  let lastDate: string | null = null;
  for (const r of rows) {
    for (const l of r.progress?.lessons || []) {
      if (l.lesson_date && (!lastDate || l.lesson_date > lastDate)) lastDate = l.lesson_date;
    }
  }
  const stalled = lastDate != null && daysSince(lastDate) > 14;

  return {
    id: textbook.id,
    name: textbook.textbook?.name ?? '（不明な教材）',
    subject: textbook.textbook?.subject ?? '',
    total,
    done,
    progressPct: total > 0 ? Math.round((done / total) * 100) : 0,
    lastDate,
    stalled,
  };
}

/** 進行表パネル・印刷シートで使う「直近の単元履歴」1件分 */
export interface TextbookLessonHistoryEntry {
  lessonDate: string;
  unitTitle: string;
  teacherName: string | null;
  /** その単元の引継ぎメモ（無ければ null。空文字は null 扱いにする） */
  handover: string | null;
}

/** 進行表パネル・印刷シートで使うテキスト1件分の詳細（進捗集計＋履歴＋次単元＋宿題/遅刻件数） */
export interface TextbookProgressDetail extends TextbookProgressSummary {
  /** 直近の単元履歴。最大5件・実施日の新しい順 */
  recentLessons: TextbookLessonHistoryEntry[];
  /** 次にやる単元名（レッスンが1件も記録されていない単元のうち先頭2件、カリキュラム順） */
  nextUnitTitles: string[];
  /** 宿題未実施が立っている単元数（0件なら呼び出し側で非表示にする） */
  homeworkNotDoneCount: number;
  /** 遅刻が立っている単元数（0件なら呼び出し側で非表示にする） */
  tardyCount: number;
}

/**
 * 進行表パネル向けの詳細集計。summarizeTextbookProgress の進捗集計に加えて、
 * 面談で話題にしやすい「直近何をやったか」「次に何をやるか」「宿題・遅刻の状況」をまとめる。
 *
 * 引継ぎ・宿題未実施・遅刻は student_progress（テキスト×単元）側のフィールドで、
 * 授業セッション記録と非同期に保存される仕様のため、実際には入っていないことが多い。
 * 呼び出し側は 0件・null のときに「0回」「引継ぎなし」を並べず、何も出さないこと
 * （[[project_progress_handover_decoupling]] 参照）。
 */
export function summarizeTextbookDetail(
  textbook: StudentTextbookWithDetails,
  rows: CurriculumItemWithProgress[]
): TextbookProgressDetail {
  const base = summarizeTextbookProgress(textbook, rows);

  // 全単元のレッスンをフラット化して実施日の新しい順に並べ、先頭5件を「直近の単元履歴」とする。
  // teacher_name はレッスン行に無ければ進行記録側（progress.teacher_name）にフォールバックする。
  const flatLessons: TextbookLessonHistoryEntry[] = [];
  for (const item of rows) {
    for (const lesson of item.progress?.lessons ?? []) {
      if (!lesson.lesson_date) continue;
      flatLessons.push({
        lessonDate: lesson.lesson_date,
        unitTitle: item.title,
        teacherName: lesson.teacher_name ?? item.progress?.teacher_name ?? null,
        handover: item.progress?.handover?.trim() || null,
      });
    }
  }
  flatLessons.sort((a, b) => b.lessonDate.localeCompare(a.lessonDate));
  const recentLessons = flatLessons.slice(0, 5);

  // 次にやる単元 = レッスンが1件も記録されていない単元を、カリキュラムの並び順(sort_order)で先頭から2件
  const nextUnitTitles = [...rows]
    .filter((r) => !(r.progress?.lessons ?? []).some((l) => l.lesson_date))
    .sort((a, b) => a.sort_order - b.sort_order)
    .slice(0, 2)
    .map((r) => r.title);

  const homeworkNotDoneCount = rows.filter((r) => r.progress?.homework_not_done).length;
  const tardyCount = rows.filter((r) => r.progress?.tardy).length;

  return { ...base, recentLessons, nextUnitTitles, homeworkNotDoneCount, tardyCount };
}

/* ============================================================
 * 通塾日程・講習申込の整形
 * ------------------------------------------------------------
 * 2カラム再構成（成績・進行表を主役にする）で「基本情報」カードは廃止したため、
 * 現在ワークスペース内では未使用。他画面からの再利用や将来の復活に備えて残す
 * 純粋関数（テストで担保）。
 * ========================================================== */

/** 通塾日程を「火19:00 / 木19:00」形式にまとめる */
export function formatRegularPatternsSchedule(patterns: ScheduleRegularPattern[]): string {
  if (patterns.length === 0) return '未設定';

  const seen = new Set<string>();
  const items: { order: number; label: string }[] = [];
  for (const p of patterns) {
    const dayLabel = DAY_OF_WEEK_LABELS[p.day_of_week] ?? '?';
    const time = p.time_slot?.start_time ? p.time_slot.start_time.slice(0, 5) : '';
    const label = time ? `${dayLabel}${time}` : dayLabel;
    if (seen.has(label)) continue;
    seen.add(label);
    items.push({ order: p.day_of_week * 10000 + (p.time_slot?.slot_number ?? 0), label });
  }
  items.sort((a, b) => a.order - b.order);
  return items.map((i) => i.label).join(' / ');
}

/** 講習申込を季節ごとに合算して「夏期: 16コマ、冬期: 8コマ」形式にまとめる */
export function formatKoushuEnrollments(enrollments: KoushuEnrollment[]): string {
  if (enrollments.length === 0) return '申込なし';
  const bySeason = new Map<string, number>();
  for (const e of enrollments) {
    const key = e.season ?? '';
    bySeason.set(key, (bySeason.get(key) ?? 0) + (e.koma_count ?? 0));
  }
  return Array.from(bySeason.entries())
    .map(
      ([season, koma]) =>
        `${SEASON_LABELS[season as keyof typeof SEASON_LABELS] ?? season}: ${koma}コマ`
    )
    .join('、');
}

/* ============================================================
 * 面談で話すこと（InterviewScriptCard・印刷シート共通）
 * ========================================================== */

/**
 * 今日から見た「いま話すべき講習の季節」を月から決める暫定ヒューリスティック。
 *
 * ★正確な根拠は無い（docs/interview-script-ai-plan.md §8 は入試日・期の定義を未決としている）。
 *   ヘルプFAQ「面談同期」の運用メモにある「面談は講習期間の1〜2か月前に行う」を手がかりに、
 *   各季節の準備〜実施期間（冬期=秋〜冬／春期=冬〜春／夏期=春〜夏）で年間を3分割した。
 *   季節ごとの定型トーク（timingLines）が実際に用意されているのは中3・夏期だけなので、
 *   この分割の粗さが実害になる場面はいまのところ無い。より正確な期の判定ができるようになったら
 *   （講習期間の設定を読みに行くなど）差し替える。
 */
export function currentSeason(date: Date): 'spring' | 'summer' | 'winter' {
  const month = date.getMonth() + 1; // 1〜12
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  return 'winter'; // 9〜2月
}

/** 面談で話すこと（InterviewScriptCard）の「伝える」行。AIに渡す【現状】とも兼用する */
export interface TellSection {
  key: BriefSectionKey;
  current: string[];
}

/** 宿題・遅刻をさかのぼる月数 */
const TELL_DISCIPLINE_MONTHS = 3;

/** 「英語 72（前回 65）」を科目ぶん並べた1行を作る。値が1つも無ければ null */
function tellScoreLine(
  assessments: AssessmentWithScores[],
  category: AssessmentCategory,
  heading: string
): string | null {
  // 直近2件（今回・前回）だけ見る。推移そのものは右カラムの成績パネルが出している
  const summary = computeScoreSummary(assessments, category, 2);
  if (summary.testLabels.length === 0) return null;

  const last = summary.testLabels.length - 1;
  const prev = last - 1;
  const parts: string[] = [];
  for (const row of summary.rows) {
    const curr = row.values[last];
    if (curr == null) continue;
    const before = prev >= 0 ? row.values[prev] : null;
    parts.push(before == null ? `${row.label} ${curr}` : `${row.label} ${curr}（前回 ${before}）`);
  }
  if (parts.length === 0) return null;
  return `${heading} ${summary.testLabels[last]}: ${parts.join('／')}`;
}

/**
 * 面談ワークスペースが持っているデータから「伝える」行（システムが組んだ現状）を作る。
 *
 * ★InterviewScriptCard（AIへ送る材料）と InterviewPrintSheet（AI未生成でも刷れる土台）の
 *   両方から呼ぶ。二重実装すると、片方だけ直したときに画面と紙で数字がずれるため。
 * ★lessons（授業の様子）と parent（保護者と）はここでは組まない。面談画面が読んでいない
 *   材料なので、サーバー（/api/ai/interview/brief）が足す。AI未生成のときは印刷シートにも
 *   この2つは出ない。
 */
export function buildTellSections(props: {
  assessments: AssessmentWithScores[];
  interviews: StudentInterview[];
  textbookData: TextbookProgressData[];
  disciplineSessions: DisciplineSessionRow[];
  koushuEnrollments: KoushuEnrollment[];
  /** 講習の提案書（期ごとのまとめ）。★⑤の主材料。koushu_enrollments は本番0行 */
  koushuSummaries?: readonly SeasonalProposalSeasonSummary[];
  /** 科目ID→科目名。koushu_enrollments 側の科目名を出すために使う */
  subjectNames?: Record<string, string>;
  /** 志望校。★score の現状に混ぜてAIへ送る（④で志望校に触れさせるため） */
  targetSchools?: readonly TargetSchoolRow[];
}): TellSection[] {
  const sections: TellSection[] = [];

  const scoreLines: string[] = [];
  const regular = tellScoreLine(props.assessments, 'regular_test', '定期テスト');
  if (regular) scoreLines.push(regular);
  const report = tellScoreLine(props.assessments, 'report_card', '通知表');
  if (report) scoreLines.push(report);
  /**
   * ★志望校の行を score に混ぜて送る。④の「見えること」で志望校に触れられるようにするため
   *   （docs/interview-workspace-layout-2026-09.md §④）。
   * ★画面・紙では「志望校」の行として別に出すので、表示側はこの行を score から外す
   *   （isTargetSchoolFactLine で見分ける）。二重に出さないため。
   */
  for (const line of buildTargetSchoolGapLines(props.targetSchools ?? [], props.assessments).tell) {
    scoreLines.push(`${TARGET_SCHOOL_FACT_PREFIX}${line}`);
  }
  if (scoreLines.length > 0) sections.push({ key: 'score', current: scoreLines });

  const months = computeDisciplineMonthly(
    props.disciplineSessions,
    TELL_DISCIPLINE_MONTHS,
    new Date()
  );
  const disciplineLines = months
    .filter((m) => m.lessonDays > 0)
    .map(
      (m) =>
        `${m.label}（授業${m.lessonDays}日）: 宿題未提出 ${m.homeworkMissedDays}回／遅刻 ${m.tardyDays}回`
    );
  if (disciplineLines.length > 0) sections.push({ key: 'discipline', current: disciplineLines });

  // ★科目ごとのLIVE教材だけ・進捗%は出さない（第2段の決めごと）。主役は引継ぎのテキスト
  const progressLines = buildProgressFactLines(props.textbookData);
  if (progressLines.length > 0) sections.push({ key: 'progress', current: progressLines });

  /**
   * ⑤の「今期の講習」。★材料は提案書（seasonal_proposals）。koushu_enrollments は
   *   本番0行なので、これだけを見ていた頃は全生徒が「申込なし」になっていた。
   *   2027-02公開のWeb申込が動き出したら、同じ期のバケットに合流して同じ行に出る。
   */
  const koushuBuckets = mergeKoushuSeasons(
    props.koushuSummaries ?? [],
    props.koushuEnrollments,
    props.subjectNames ?? {}
  );
  const today = new Date();
  const koushuLines = buildKoushuCurrentLines(
    koushuBuckets,
    koushuFiscalYear(today),
    currentSeason(today)
  );
  if (koushuLines.length > 0) sections.push({ key: 'koushu', current: koushuLines });

  const latest = props.interviews.filter((i) => i.interview_type !== 'task')[0];
  if (latest) {
    const lines = [
      `${fmtDateJa(latest.interview_date)}（${daysSince(latest.interview_date)}日前）`,
    ];
    // ★空の節（「確認できませんでした」だけの見出し）を畳んだ文面。AIにもこれがそのまま渡る
    const text = buildHandoverText(latest.content);
    if (text) lines.push(`申し送り: ${text}`);
    sections.push({ key: 'lastInterview', current: lines });
  }

  return sections;
}

/* ============================================================
 * 成績サマリ（成績パネル・印刷シート共通）
 * ========================================================== */

/** 成績カテゴリ（Assessment['category'] のエイリアス。ここでの引数用に短く再掲する） */
export type AssessmentCategory = 'regular_test' | 'report_card' | 'mock';

// 科目の表示順。定期テスト/内申は共通9科、模試は換算内申などカテゴリによって出現する
// 科目集合が異なるため固定リストにはしない。ここでは「並べる優先順位」だけを決め、
// このリストに無い科目（他カテゴリで将来増えても）は末尾に回して落とさない。
const SUBJECT_ORDER = [
  'english',
  'math',
  'japanese',
  'science',
  'social',
  'music',
  'art',
  'tech_home',
  'pe',
  'conv_5',
  'conv_4',
] as const;

function subjectOrderIndex(subject: string): number {
  const i = (SUBJECT_ORDER as readonly string[]).indexOf(subject);
  return i === -1 ? SUBJECT_ORDER.length : i;
}

export interface ScoreSummaryRow {
  subject: string;
  label: string;
  values: (number | null)[]; // testLabels と同じ並び（古い→新しい）
}

export interface ScoreSummary {
  testLabels: string[]; // 直近N件、古い→新しい順
  rows: ScoreSummaryRow[];
  totals: number[]; // 各テストの合計点（testLabels と同じ並び）
}

/**
 * 指定カテゴリの直近N件を集計する（既定は定期テスト直近3件。印刷シートの従来仕様と同じ）。
 * listAssessments() は新しい順（降順）で返るため、先頭N件を取ってから
 * 表示用に古い→新しい順へ反転する（成績推移として左から右に読めるように）。
 *
 * 科目行はカテゴリごとの固定リストを使わず、実際に scores に出現した科目だけから作る
 * （内申は9科、模試は換算内申など、カテゴリで科目集合が違うため）。
 */
export function computeScoreSummary(
  assessments: AssessmentWithScores[],
  category: AssessmentCategory = 'regular_test',
  count = 3
): ScoreSummary {
  const picked = assessments
    .filter((a) => a.category === category)
    .slice(0, count)
    .reverse();

  const testLabels = picked.map((a) => ASSESSMENT_NAME_LABELS[a.name_code] ?? a.name_code);

  const subjectSet = new Set<string>();
  for (const a of picked) {
    for (const s of a.scores) subjectSet.add(s.subject);
  }
  const subjects = Array.from(subjectSet).sort(
    (a, b) => subjectOrderIndex(a) - subjectOrderIndex(b) || a.localeCompare(b)
  );

  const rows: ScoreSummaryRow[] = subjects.map((subject) => ({
    subject,
    label: SUBJECT_LABELS[subject] ?? subject,
    values: picked.map((a) => a.scores.find((s) => s.subject === subject)?.value ?? null),
  }));
  const totals = picked.map((_, i) => rows.reduce((sum, row) => sum + (row.values[i] ?? 0), 0));

  return { testLabels, rows, totals };
}

/* ============================================================
 * 宿題・遅刻の月次集計（宿題・遅刻パネル・印刷シート共通）
 * ========================================================== */

/** 宿題・遅刻の月次集計1行分 */
export interface DisciplineMonth {
  month: string; // 'YYYY-MM'
  label: string; // '2026年7月'
  lessonDays: number; // 授業日数（session_dateのユニーク数）
  homeworkMissedDays: number; // 宿題忘れがあった日数
  tardyDays: number; // 遅刻があった日数
}

/**
 * 生徒の宿題忘れ・遅刻を月次で集計する（宿題・遅刻パネル・印刷シート共通）。
 *
 * 教材ごとに1セッション行が立つため、同じ授業日に複数教材のセッションが存在しうる。
 * ここでは「日単位」で数える: 同日の行のうちどれか1件でも homework_not_done/tardy が
 * true ならその日を1日として数える（教材数ぶんの二重計上を防ぐ）。
 *
 * today を含む月から遡って monthsBack ヶ月分を対象にし、記録の無い月も
 * lessonDays: 0 で埋めたうえで新しい月が先頭になる配列で返す。範囲外の日付は無視する。
 * 月キーは session_date（'YYYY-MM-DD'）の先頭7文字をそのまま使う（タイムゾーン変換不要）。
 */
export function computeDisciplineMonthly(
  sessions: { session_date: string; homework_not_done: boolean; tardy: boolean }[],
  monthsBack: number,
  today: Date
): DisciplineMonth[] {
  // 対象月キー（新しい順）を先に確定する。範囲外の月は後段で無視する。
  const monthKeys: string[] = [];
  for (let i = 0; i < monthsBack; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    monthKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const monthKeySet = new Set(monthKeys);

  // 日単位でフラグを集約する: 同日に複数教材の行があっても、どれか1件が true ならその日は true
  const dayHomework = new Map<string, boolean>();
  const dayTardy = new Map<string, boolean>();
  const daysByMonth = new Map<string, Set<string>>();
  for (const s of sessions) {
    const monthKey = s.session_date.slice(0, 7);
    if (!monthKeySet.has(monthKey)) continue; // 範囲外の日付は無視

    if (!daysByMonth.has(monthKey)) daysByMonth.set(monthKey, new Set());
    daysByMonth.get(monthKey)!.add(s.session_date);

    if (s.homework_not_done) dayHomework.set(s.session_date, true);
    if (s.tardy) dayTardy.set(s.session_date, true);
  }

  return monthKeys.map((monthKey) => {
    const days = daysByMonth.get(monthKey) ?? new Set<string>();
    let homeworkMissedDays = 0;
    let tardyDays = 0;
    for (const day of Array.from(days)) {
      if (dayHomework.get(day)) homeworkMissedDays++;
      if (dayTardy.get(day)) tardyDays++;
    }
    const [y, m] = monthKey.split('-');
    return {
      month: monthKey,
      label: `${y}年${Number(m)}月`,
      lessonDays: days.size,
      homeworkMissedDays,
      tardyDays,
    };
  });
}

/**
 * 全生徒ぶんのセッション行を生徒ごとにグループ化し、それぞれ computeDisciplineMonthly で月次集計する。
 * 集計ロジックを二重実装しないため、既存の computeDisciplineMonthly に委譲する
 * （面談入口一覧の「宿題・遅刻」全生徒集計ビュー用）。
 *
 * Map のキーは student_id。rows に一度も登場しない生徒はエントリ自体を作らない
 * （呼び出し側で「記録なし」扱いにするため）。
 */
export function computeDisciplineMonthlyByStudent(
  rows: { student_id: string; session_date: string; homework_not_done: boolean; tardy: boolean }[],
  monthsBack: number,
  today: Date
): Map<string, DisciplineMonth[]> {
  const byStudent = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byStudent.get(row.student_id);
    if (list) {
      list.push(row);
    } else {
      byStudent.set(row.student_id, [row]);
    }
  }

  const result = new Map<string, DisciplineMonth[]>();
  for (const [studentId, studentRows] of Array.from(byStudent.entries())) {
    result.set(studentId, computeDisciplineMonthly(studentRows, monthsBack, today));
  }
  return result;
}

/** 全生徒合算の月次合計1行分 */
export interface DisciplineMonthTotal extends DisciplineMonth {
  /** その月に授業記録が1日以上あった生徒数 */
  studentCount: number;
  /** その月に宿題忘れが1日以上あった生徒数 */
  homeworkStudentCount: number;
  /** その月に遅刻が1日以上あった生徒数 */
  tardyStudentCount: number;
}

/**
 * 生徒ごとの月次集計（画面に既に出している DisciplineRow.months の配列そのもの）を
 * 月単位で合算して「全体」の月次合計を作る。
 *
 * 生の session 行から再集計しない理由: 画面の生徒行と「全体」合計行で数字が食い違うと
 * 集計の信頼性が疑われる。既に各生徒行の表示に使っている computeDisciplineMonthly の
 * 出力をそのまま足し上げることで、生徒行の合計＝全体行になることを構造的に保証する。
 *
 * 月の枠組み（対象月キー・label・新しい月が先頭の順序）は computeDisciplineMonthly([], ...) で
 * 作り、そこに各生徒の同月の値を月キーで対応付けて足し込む（配列インデックスの並びに
 * 依存すると、生徒によって記録の欠けた月がある場合にズレるため）。
 */
export function computeDisciplineMonthlyTotals(
  perStudentMonths: DisciplineMonth[][],
  monthsBack: number,
  today: Date
): DisciplineMonthTotal[] {
  const frame = computeDisciplineMonthly([], monthsBack, today);
  const totalsByMonth = new Map<string, DisciplineMonthTotal>(
    frame.map((m) => [
      m.month,
      { ...m, studentCount: 0, homeworkStudentCount: 0, tardyStudentCount: 0 },
    ])
  );

  for (const months of perStudentMonths) {
    for (const m of months) {
      const total = totalsByMonth.get(m.month);
      if (!total) continue; // 対象範囲外の月キーは無視（通常は起こらない想定）
      total.lessonDays += m.lessonDays;
      total.homeworkMissedDays += m.homeworkMissedDays;
      total.tardyDays += m.tardyDays;
      if (m.lessonDays > 0) total.studentCount += 1;
      if (m.homeworkMissedDays > 0) total.homeworkStudentCount += 1;
      if (m.tardyDays > 0) total.tardyStudentCount += 1;
    }
  }

  return frame.map((m) => totalsByMonth.get(m.month)!);
}

/** 期間全体（表示中の全月）の合計 */
export interface DisciplineOverallTotal {
  lessonDays: number;
  homeworkMissedDays: number;
  tardyDays: number;
  /** 期間中に1日でも授業記録があった生徒数 */
  studentCount: number;
  /** 期間中に1日でも宿題忘れがあった生徒数 */
  homeworkStudentCount: number;
  /** 期間中に1日でも遅刻があった生徒数 */
  tardyStudentCount: number;
}

/**
 * 期間全体（表示中の全月分）の合計を生徒ごとの月次配列から計算する。
 *
 * 注意: 人数を「月ごとの人数の単純合計」にしてはいけない。同じ生徒が5月・6月の両方で
 * 宿題忘れをしていた場合、月次の人数を単純に足すと2名分にカウントされてしまい、
 * 「延べ人数」であって「実際に該当した生徒数」ではなくなる。期間合計としてここで
 * 知りたいのは「期間中に1人でも宿題忘れ/遅刻があった生徒が何人いるか」なので、
 * 必ず生徒単位でいったん期間合計を作ってから、その値が0より大きいかどうかで数える。
 * 引数（各生徒の月次配列）は読み取るだけで変更しない。
 */
export function computeDisciplineOverallTotal(
  perStudentMonths: DisciplineMonth[][]
): DisciplineOverallTotal {
  let lessonDays = 0;
  let homeworkMissedDays = 0;
  let tardyDays = 0;
  let studentCount = 0;
  let homeworkStudentCount = 0;
  let tardyStudentCount = 0;

  for (const months of perStudentMonths) {
    // まず生徒1人分の期間合計を出してから人数判定に使う（月またぎの重複カウント防止）
    let studentLessonDays = 0;
    let studentHomeworkMissedDays = 0;
    let studentTardyDays = 0;
    for (const m of months) {
      studentLessonDays += m.lessonDays;
      studentHomeworkMissedDays += m.homeworkMissedDays;
      studentTardyDays += m.tardyDays;
    }

    lessonDays += studentLessonDays;
    homeworkMissedDays += studentHomeworkMissedDays;
    tardyDays += studentTardyDays;
    if (studentLessonDays > 0) studentCount += 1;
    if (studentHomeworkMissedDays > 0) homeworkStudentCount += 1;
    if (studentTardyDays > 0) tardyStudentCount += 1;
  }

  return {
    lessonDays,
    homeworkMissedDays,
    tardyDays,
    studentCount,
    homeworkStudentCount,
    tardyStudentCount,
  };
}

/**
 * 「注意が必要」とみなす割合のしきい値。この値以上の月は赤字にして目に留まりやすくする。
 * 根拠のある値ではなく運用上の目安のため、必要に応じて調整してよい。
 * 宿題・遅刻パネル（1生徒用）と面談入口の全生徒集計ビューの両方で使うため、ここに集約する
 * （二重定義しない）。
 */
export const DISCIPLINE_ALERT_RATIO_THRESHOLD = 0.3;

/* ============================================================
 * 目標の達成度（②ヒアリング）
 * ------------------------------------------------------------
 * 正典: docs/interview-script-ai-plan.md §「②ヒアリングに『目標の達成度』を足す」
 *
 * 目標（student_textbook_exams.target_score）と結果は別テーブルに分かれている。
 * student_textbook_exams.result_score にも結果欄はあるが、現場は結果を成績側
 * （assessments category='regular_test' + assessment_scores）にしか入れていない
 * （本番確認：result_score が入っているのは9件だけ）。そのため結果は成績側と突き合わせる。
 *
 * 突き合わせには科目・試験名の変換が要る。目標側は日本語（subject_key='英語'、
 * exam_types.name='1学期期末'）、成績側は英語キー（subject='english'、
 * name_code='term1_final'）で持っているため。★変換表はこの1か所にまとめる。
 * 片方だけ直すと黙って突き合わなくなる（例: exam_types に試験名を追加しても、
 * ここに対応する name_code を足し忘れると、その試験の目標は永遠に「聞くこと」に回り続ける）。
 * ========================================================== */

/** 目標側（student_textbook_exams.subject_key・日本語）→成績側（assessment_scores.subject）の変換 */
export const GOAL_SUBJECT_TO_ASSESSMENT_SUBJECT: Record<string, string> = {
  数学: 'math',
  英語: 'english',
  国語: 'japanese',
  理科: 'science',
  社会: 'social',
};

/** 目標側（exam_types.name・日本語）→成績側（assessments.name_code）の変換 */
export const GOAL_EXAM_NAME_TO_ASSESSMENT_NAME_CODE: Record<string, string> = {
  '1学期中間': 'term1_mid',
  '1学期期末': 'term1_final',
  '2学期中間': 'term2_mid',
  '2学期期末': 'term2_final',
  学年末: 'year_end',
  前期中間: 'first_mid',
  前期期末: 'first_final',
  後期中間: 'second_mid',
  後期期末: 'second_final',
};

/** buildGoalAchievementLines に渡す試験目標1件分（getStudentExamGoalsForInterview の戻りと互換） */
export interface ExamGoalForAchievement {
  subject_key: string;
  exam_type_name: string | null;
  custom_exam_name: string | null;
  exam_date: string;
  target_score: number | null;
}

/** 「目標の達成度」の行。伝える（突き合わせできた）／聞く（結果が見つからない）に分かれる */
export interface GoalAchievementLines {
  tell: string[];
  ask: string[];
}

/**
 * 試験目標と定期テストの結果を突き合わせて「目標の達成度」の行を作る。
 *
 * ★直近の試験のぶんだけ（最新の exam_date のグループ）に絞る。行数が増えすぎると
 *   結局読まれないため（他のシーンと同じ方針）。
 * ★結果が見つからない（科目・試験名が変換できない、または成績側にまだその試験が
 *   入っていない）ときは「聞くこと」に回す。247名のうち多数がこちらに入る想定で、
 *   台本が入力を促す形になるのが狙い。黙って行ごと落とさない。
 *
 * ★同じ行が2回出ないように、組み上げた文で重複を落とす（2026-09）。
 *   目標は「生徒×科目」に移したが、student_textbook_exams の行はテキストごとに残っており、
 *   同じ科目のテキストを複数持つ生徒には subject_key・exam_date・target_score が
 *   まったく同じ行が2件できる（実例: 緑園都市校の中3で英語の目標が2行並んだ）。
 *   ★落とすのは「組み上げた文が完全に同じ」ときだけにしてある。科目と試験が同じでも
 *     目標点が違う行は、データの食い違いとして両方見せる（片方を黙って選ぶと気づけない）。
 */
export function buildGoalAchievementLines(
  examGoals: readonly ExamGoalForAchievement[],
  assessments: AssessmentWithScores[]
): GoalAchievementLines {
  const withTarget = examGoals.filter((g) => g.target_score != null);
  if (withTarget.length === 0) return { tell: [], ask: [] };

  const latestDate = withTarget.reduce(
    (max, g) => (g.exam_date > max ? g.exam_date : max),
    withTarget[0].exam_date
  );
  const targets = withTarget.filter((g) => g.exam_date === latestDate);

  const tell: string[] = [];
  const ask: string[] = [];

  for (const goal of targets) {
    const target = goal.target_score as number;
    const examLabel = goal.exam_type_name ?? goal.custom_exam_name ?? '（試験名未設定）';
    const subject = GOAL_SUBJECT_TO_ASSESSMENT_SUBJECT[goal.subject_key];
    const nameCode = goal.exam_type_name
      ? GOAL_EXAM_NAME_TO_ASSESSMENT_NAME_CODE[goal.exam_type_name]
      : undefined;

    // 変換できない（科目・試験名がどちらの変換表にも無い）ときは、結果を探しようが無いので聞くことに回す
    const score =
      subject && nameCode
        ? (assessments
            .find((a) => a.category === 'regular_test' && a.name_code === nameCode)
            ?.scores.find((s) => s.subject === subject)?.value ?? null)
        : null;

    if (score == null) {
      ask.push(`${goal.subject_key} ${examLabel} 目標${target}点。結果を聞いて入れる`);
      continue;
    }

    const diff = score - target;
    const diffText = diff >= 0 ? `+${diff}・達成` : `${diff}`;
    tell.push(`${goal.subject_key} ${examLabel} 目標${target} → ${score}（${diffText}）`);
  }

  return { tell: Array.from(new Set(tell)), ask: Array.from(new Set(ask)) };
}

/* ============================================================
 * ④現状の確認: 成績が無いときに黙らない
 * ========================================================== */

/**
 * 定期テスト・模試のどちらかが1件も記録に無いとき、④の「聞くこと」に回す行を作る。
 *
 * ★いまは記録が無いセクションを丸ごと落としており、定期テストは51%・模試は39%の生徒にしか
 *   入っていないため、半数の生徒で成績の話がまるごと台本から消えて面談で話し忘れる。
 * ★小学生には出さない（定期テストが無い学年で「聞いて入れる」は的外れ）。
 *   学年は小1=1 の通し番号で、7以上が中学生（GRADE_LABELS が正典）。
 */
export function buildMissingRecordAskLines(
  assessments: AssessmentWithScores[],
  grade: number | null
): string[] {
  if (grade == null || grade < 7) return [];

  const lines: string[] = [];
  if (!assessments.some((a) => a.category === 'regular_test')) {
    lines.push('定期テストの結果を聞いて入れる');
  }
  if (!assessments.some((a) => a.category === 'mock')) {
    lines.push('模試を受けているか聞く');
  }
  return lines;
}

/* ============================================================
 * ④現状の確認: 志望校との差
 * ========================================================== */

/**
 * 必要内申の表示。★満点が65以外のとき（3教科校は75点満点、産業技術高専は52点満点）は
 * 分母を添える（「必要内申55/75」）。分母が無いと、面談で言う「必要内申55」が
 * 65点満点の55として伝わってしまう。
 *
 * ★TargetSchoolsPanel（志望校の入力パネル）と InterviewScriptCard（④現状の確認）の
 *   両方が同じ書式で必要内申を出すため、ここに共通化して置く（二重定義しない）。
 */
export function formatNaishin(
  naishin: number | null,
  naishinMax: number | null,
  label?: string
): string {
  // ★神奈川（135点満点）の資料上の呼び名は「基準内申」。東京の「必要内申」と呼び分ける
  //   （どちらの制度の数字かを語で見分けられるように。schoolLookup.ts の出し分けと揃える）
  const name = label ?? (naishinMax === KANAGAWA_NAISHIN_MAX ? '基準内申' : '必要内申');
  if (naishin == null) return `${name}は未設定`;
  if (naishinMax != null && naishinMax !== 65) return `${name}${naishin}/${naishinMax}`;
  return `${name}${naishin}`;
}

/** 生徒本人の直近の内申（report_card）から、換算内申（都立・65点満点）を計算する。無ければ null */
export function latestOwnNaishin(assessments: AssessmentWithScores[]): number | null {
  // assessments は新しい順（降順）で来る前提（computeScoreSummary と同じ前提）
  const latest = assessments.find((a) => a.category === 'report_card');
  if (!latest) return null;
  const scores: Record<string, number | null> = {};
  for (const s of latest.scores) scores[s.subject] = s.value;
  return calcTokyoNaishin(scores).converted;
}

/** 神奈川県公立の内申の満点（中2学年末×1＋中3×2）。high_school_standards.naishin_max と同じ値 */
export const KANAGAWA_NAISHIN_MAX = 135;

/**
 * 表示に使う内申の満点。★神奈川で内申が空の16校は naishin_max も空で入っている
 * （docs/data/README.md §神奈川）。そのまま formatNaishin に渡すと「必要内申は未設定」と
 * 東京の語で出るので、神奈川は満点が空でも135として扱う。
 */
export function displayNaishinMax(prefecture: string, naishinMax: number | null): number | null {
  if (naishinMax == null && prefecture === '神奈川県') return KANAGAWA_NAISHIN_MAX;
  return naishinMax;
}

/** 通知表1件を calcKanagawaNaishin135 に渡す形にする */
function toReportCardInput(a: AssessmentWithScores): ReportCardInput {
  const scores: Record<string, number | null> = {};
  for (const s of a.scores) scores[s.subject] = s.value;
  return { nameCode: a.name_code, scores };
}

/** 中2の「学年末」にあたる通知表の name_code。★2期制は後期（second）が学年の評定になる */
const GRADE8_YEAR_END_CODES = ['year_end', 'second'] as const;
/**
 * 中3の通知表として使う name_code の優先順。
 * ★入試に使うのは2学期（2期制は後期）の評定なので、それを最優先にする。学年末（year_end）が
 *   あっても2学期のほうを採る（学年末は入試のあとに出る評定で、入試の計算には使われない）。
 *   1学期・前期しか無いときは仮計算（calcKanagawaNaishin135 が provisional を立てる）。
 */
const GRADE9_CODE_PRIORITY = ['term2', 'second', 'year_end', 'term1', 'first'] as const;

/**
 * 生徒本人の神奈川県公立の内申（135点満点）。材料が足りなければ null。
 * ★学年は小1=1 の通し番号（中2=8・中3=9）。assessments は新しい順で来る前提なので、
 *   同じ学年・同じ name_code が2件あれば新しいほうを使う。
 */
export function latestOwnKanagawaNaishin(
  assessments: AssessmentWithScores[]
): KanagawaNaishin135Result | null {
  const reportCards = assessments.filter((a) => a.category === 'report_card');
  const pick = (grade: number, codes: readonly string[]) => {
    for (const code of codes) {
      const hit = reportCards.find((a) => a.grade === grade && a.name_code === code);
      if (hit) return hit;
    }
    return undefined;
  };
  const g8 = pick(8, GRADE8_YEAR_END_CODES);
  const g9 = pick(9, GRADE9_CODE_PRIORITY);
  if (!g8 || !g9) return null;
  return calcKanagawaNaishin135(toReportCardInput(g8), toReportCardInput(g9));
}

/**
 * 本人の内申を、志望校の満点ごとに持ったもの。
 * ★どちらで比べるかは**学校の満点**で決める。教室の都県（region）では決めない。
 *   東京の教室の生徒が神奈川県立を、神奈川の教室の生徒が都立を志望することはあり、
 *   教室の都県で計算方法を選ぶと、65点満点の数字と135点満点のめやすを引き算してしまう。
 */
export interface OwnNaishinByScale {
  /** 都立の換算内申（65点満点・直近の通知表1回分） */
  tokyo: number | null;
  /** 神奈川県公立の内申（135点満点） */
  kanagawa: KanagawaNaishin135Result | null;
}

/** 生徒本人の直近の模試（mock）の5科偏差値（hensa_5）。無ければ null */
export function latestOwnHensachi(assessments: AssessmentWithScores[]): number | null {
  const latest = assessments.find(
    (a) => a.category === 'mock' && a.scores.some((s) => s.subject === 'hensa_5')
  );
  return latest?.scores.find((s) => s.subject === 'hensa_5')?.value ?? null;
}

/** 「志望校」の行。伝える（登録されている志望校ぶん）／聞く（志望校が未登録） */
export interface TargetSchoolGapLines {
  tell: string[];
  ask: string[];
}

/**
 * 志望校の行の見出し。
 * ★AIには score セクションの現状に混ぜて渡す（④で志望校に触れさせるため）が、
 *   画面・紙では「志望校」の行として別に出す。どちらの行かをこの見出しで見分ける。
 */
export const TARGET_SCHOOL_FACT_PREFIX = '志望校 ―― ';

/** score の現状の行のうち、志望校の行かどうか（表示側が外すために使う） */
export function isTargetSchoolFactLine(line: string): boolean {
  return line.startsWith(TARGET_SCHOOL_FACT_PREFIX);
}

/** score の現状の行から志望校の行を外す（画面・紙は志望校ブロックで別に出すため） */
export function stripTargetSchoolFactLines(lines: readonly string[]): string[] {
  return lines.filter((l) => !isTargetSchoolFactLine(l));
}

/**
 * 志望校の内申の満点がどちらの制度か。
 * ★学校の満点で決める（教室の都県では決めない。OwnNaishinByScale の注記）。
 *   神奈川で内申が空の16校は naishin_max も空で来うるので、そのときは都県で神奈川と見る。
 *   - 'kanagawa' … 135点満点（中2学年末×1＋中3×2）
 *   - 'tokyo'    … 65点満点（都立の換算内申）。満点が空の都立もここ（従来どおり）
 *   - 'other'    … 75点満点（3教科校）・52点満点（産業技術高専）。本人の数字を計算できない
 */
function naishinScaleOf(master: TargetSchoolMaster): 'tokyo' | 'kanagawa' | 'other' {
  const max = displayNaishinMax(master.prefecture, master.naishinMax);
  if (max === KANAGAWA_NAISHIN_MAX) return 'kanagawa';
  return max == null || max === 65 ? 'tokyo' : 'other';
}

/** 差の符号つき表示（+0 も「+」を付ける。従来の④と同じ） */
function signed(n: number): string {
  return `${n >= 0 ? '+' : ''}${n}`;
}

/** 中3が1学期（前期）の評定で仮に計算した内申であることを、④の右に添える文言 */
const KANAGAWA_PROVISIONAL_NOTE = '（中3は1学期の評定で仮計算）';

/**
 * 合格のめやすと本人との差を「必要内申45（+0）」「必要偏差値51（-3）」の形に組む。
 *
 * ★満点が65以外（3教科校=75点満点、産業技術高専=52点満点）のときは差を出さない。
 *   calcTokyoNaishin は5科×1＋実技4科×2＝65点満点しか計算しないので、
 *   満点の違う学校の必要内申から引くと意味のない値になる（駒場の保健体育は
 *   必要内申55/75。本人41を引いて「-14」と出すと、面談で「あと14足りません」と
 *   言ってしまう）。満点が違うときは必要内申だけを分母つきで示す。
 *   出典: vault NEST/ナレッジ/高校入試情報_都立は1020点の総合得点1本で決まる.md
 * ★神奈川県立（135点満点）は本人の内申を別の式（中2学年末×1＋中3×2）で出して比べ、
 *   「基準内申107/135（本人 98・-9）」の形にする。135点満点の数字は面談で聞き慣れないので、
 *   差だけでなく本人の値も並べる。語は資料どおり「基準内申」「基準偏差値」（東京の「必要〜」と
 *   呼び分ける）。中3が1学期の評定しか無ければ「（中3は1学期の評定で仮計算）」を添える。
 * ★この分母の決まりを書くのはここ1か所だけ。志望校の行も、④の「差」も、ここを通す。
 */
function targetSchoolStandardParts(
  master: TargetSchoolMaster,
  own: OwnNaishinByScale,
  ownHensachi: number | null
): string[] {
  const parts: string[] = [];
  const { naishinDiff, hensachiDiff, ownNaishin, provisional } = targetSchoolDiffs(
    master,
    own,
    ownHensachi
  );
  const isKanagawa = naishinScaleOf(master) === 'kanagawa';

  if (master.naishin != null) {
    const base = formatNaishin(
      master.naishin,
      displayNaishinMax(master.prefecture, master.naishinMax)
    );
    if (naishinDiff != null && isKanagawa) {
      parts.push(
        `${base}（本人 ${ownNaishin}・${signed(naishinDiff)}）` +
          (provisional ? KANAGAWA_PROVISIONAL_NOTE : '')
      );
    } else if (naishinDiff != null) {
      parts.push(`${base}（${signed(naishinDiff)}）`);
    } else {
      // 本人の内申が無い／満点が違って引けない。めやすだけを分母つきで示す
      parts.push(base);
    }
  }

  if (master.hensachi != null) {
    const label = isKanagawa ? '基準偏差値' : '必要偏差値';
    parts.push(
      hensachiDiff != null
        ? `${label}${master.hensachi}（${signed(hensachiDiff)}）`
        : `${label}${master.hensachi}`
    );
  }

  return parts;
}

/**
 * 本人とめやすの差（本人 − めやす）。引けないときは null。
 *
 * ★本人の内申は学校の満点で選ぶ（65＝都立の換算内申、135＝神奈川の中2＋中3×2）。
 *   満点が75・52の学校とは内申の差を取らない。理由は targetSchoolStandardParts の注記のとおり。
 *   右の「志望校」の行（数字）と左の「話すこと」（buildTargetSchoolTalkLines）が
 *   **同じこの関数**を通るので、片方だけ差が出て片方は出ない、という食い違いが起きない。
 */
function targetSchoolDiffs(
  master: TargetSchoolMaster,
  own: OwnNaishinByScale,
  ownHensachi: number | null
): {
  naishinDiff: number | null;
  hensachiDiff: number | null;
  /** 差の計算に使った本人の内申（学校の満点に合わせたもの） */
  ownNaishin: number | null;
  /** 神奈川の内申を中3の1学期の評定で仮に計算したか */
  provisional: boolean;
} {
  const scale = naishinScaleOf(master);
  const ownNaishin =
    scale === 'kanagawa' ? (own.kanagawa?.converted ?? null) : scale === 'tokyo' ? own.tokyo : null;
  const provisional = scale === 'kanagawa' && (own.kanagawa?.provisional ?? false);
  return {
    naishinDiff: master.naishin != null && ownNaishin != null ? ownNaishin - master.naishin : null,
    hensachiDiff:
      master.hensachi != null && ownHensachi != null ? ownHensachi - master.hensachi : null,
    ownNaishin,
    provisional,
  };
}

/**
 * 志望校を1件1行にまとめる（④現状の確認）。
 *
 * 「第1 清瀬（普通科） ／ めやす 必要内申45（+0）・必要偏差値51（-3）（出典） ／ 沿線: 西武池袋線」。
 *
 * ★登録されている志望校は、マスタに当たらなくても行を出す（私立・他県は自由記述のまま残るため）。
 *   めやすと差はマスタに当たったときだけ足す。
 * ★2026-09の第2段で「志望校との差」の行と統合した。めやすと差を別の行に出すと
 *   同じ数字が2か所に並び、どちらが本人でどちらが学校か読み違える。
 * ★「Vもぎ 2025年9月版・合格可能性60%の位置」の出典と、verified_at が null なら
 *   「原本との突き合わせは未了」を必ず添える。保護者に見せうる数字なので、
 *   出どころと確度を隠さない（docs/interview-script-ai-plan.md §4-2）。
 * ★最寄駅（primary_station）は出さない。直線距離で選んでおり、乗り換えを無視した
 *   「最寄り」は保護者に対して使えない（docs/data/README.md）。沿線だけを出す。
 * ★志望校が1件も登録されていなければ、④の「聞くこと」に「志望校を聞いて入れる」を出す
 *   （②ではなく④。志望校そのものはTargetSchoolsPanelが②の近くで入力させるが、
 *   「聞くこと」の定型リストとしては現状の確認で扱う）。
 */
export function buildTargetSchoolGapLines(
  targetSchools: readonly TargetSchoolRow[],
  assessments: AssessmentWithScores[]
): TargetSchoolGapLines {
  if (targetSchools.length === 0) {
    return { tell: [], ask: ['志望校を聞いて入れる'] };
  }

  // ★本人の内申は両方の満点ぶん先に出しておき、学校ごとに満点で選ぶ（targetSchoolDiffs）
  const own: OwnNaishinByScale = {
    tokyo: latestOwnNaishin(assessments),
    kanagawa: latestOwnKanagawaNaishin(assessments),
  };
  const ownHensachi = latestOwnHensachi(assessments);

  const tell: string[] = [];
  for (const school of targetSchools) {
    const master = school.master;
    // 学校名はマスタ優先（自由記述の表記ゆれを直した正式名が入る）
    const name = master?.schoolName ?? school.schoolName;
    // ★course の空文字は「普通科の本体」。学科名が無いのではないので、括弧ごと出さない
    const course = master?.course ? `（${master.course}）` : '';
    const blocks: string[] = [`第${school.rank} ${name}${course}`];

    if (master) {
      const parts = targetSchoolStandardParts(master, own, ownHensachi);
      if (parts.length > 0) {
        const sourceBits: string[] = [];
        // ★「合格可能性60%の位置」は Vもぎ（都立）の表の定義。神奈川の合格基準一覧表
        //  （新教育研究協会）にはその定義が書かれていないので、出典名だけにする
        if (master.sourceLabel) {
          sourceBits.push(
            naishinScaleOf(master) === 'kanagawa'
              ? master.sourceLabel
              : `${master.sourceLabel}・合格可能性60%の位置`
          );
        }
        if (master.verifiedAt == null) sourceBits.push('原本との突き合わせは未了');
        const sourceSuffix = sourceBits.length > 0 ? `（${sourceBits.join('／')}）` : '';
        blocks.push(`めやす ${parts.join('・')}${sourceSuffix}`);
      }

      /**
       * ★沿線まで。最寄駅（primary_station）は出さない。
       *   直線距離で決めており、乗り換えを無視した「最寄り」は面談で使えない
       *  （docs/data/README.md）。
       */
      const accessLines = (master.accessLines ?? []).filter((l) => l.trim());
      if (accessLines.length > 0) blocks.push(`沿線: ${accessLines.join('・')}`);
    }

    tell.push(blocks.join(' ／ '));
  }

  return { tell, ask: [] };
}

/** ④の左（話すこと）に出す、志望校についての1行。say＝言う／ask＝聞く（チェック付き） */
export interface TargetSchoolTalkLine {
  kind: 'say' | 'ask';
  text: string;
}

/**
 * ④現状の確認: 志望校について**話すこと**（左の列）を学校ごとに組む。
 *
 * ★2026-09-23 の教室長レビューで足した。右に「めやす 必要内申49（+4）・必要偏差値55（-1）」が
 *   出ていても、左が「見学に行ったか」の定型だけでは、その数字から何を言うかが台本に無かった。
 * ★AIには書かせない。差の数字はシステムが計算したものなので、ここでは数字を使ってよい
 *  （AIに数字を書かせない決まりは「書き写しの1字違いに誰も気づけない」ため。計算した本人が
 *   組むならその心配は無い）。
 * ★差は targetSchoolDiffs を通す。右の「志望校」の行と同じ関数なので、満点が違う学校
 *  （75点満点・52点満点）で内申の話をしない、という決まりも自動で揃う。
 * ★東京と神奈川で言うことを変える。
 *   - 「換算内申1点は当日の素点で約3点ぶん」は都立の1020点方式の話（scenes.ts と同じ定数）。
 *   - 「推薦」は都立の推薦入試のこと。神奈川の公立には東京の意味での推薦入試が無いので、
 *     推薦の言葉を出さず、中立な比較だけにする。
 *   - 都県が分からない教室（region=null）も神奈川と同じ中立な形に倒す。どちらの制度か
 *     言えない話を出すより、比べた事実だけ言うほうが事故が小さい。
 *   - 東京の教室でも、志望校が神奈川県立なら中立な形にする（都立の推薦・1020点方式の話は
 *     神奈川県立には当てはまらない）。
 * ★ownNaishin は都立の換算内申（65点満点）。神奈川県立（135点満点）と比べる本人の内申は
 *   ownKanagawaNaishin で別に渡す。どちらを使うかは学校の満点で決まる（targetSchoolDiffs）。
 *   中3が1学期の評定で仮に計算した値なら、内申の行に「（仮計算）」を添える。
 */
export function buildTargetSchoolTalkLines(
  targetSchools: readonly TargetSchoolRow[],
  ownNaishin: number | null,
  ownHensachi: number | null,
  region: Region | null,
  ownKanagawaNaishin: KanagawaNaishin135Result | null = null
): TargetSchoolTalkLine[] {
  const own: OwnNaishinByScale = { tokyo: ownNaishin, kanagawa: ownKanagawaNaishin };
  const lines: TargetSchoolTalkLine[] = [];

  for (const school of targetSchools) {
    const name = school.master?.schoolName ?? school.schoolName;
    const { naishinDiff, hensachiDiff, provisional } = school.master
      ? targetSchoolDiffs(school.master, own, ownHensachi)
      : { naishinDiff: null, hensachiDiff: null, provisional: false };
    // 都立の制度の話（推薦・換算内申1点の重み）をするのは、東京の教室で神奈川県立以外を見ているときだけ
    const isTokyo =
      region === 'tokyo' && !(school.master && naishinScaleOf(school.master) === 'kanagawa');
    const prov = provisional ? '（仮計算）' : '';

    if (naishinDiff == null && hensachiDiff == null) {
      lines.push({
        kind: 'say',
        text: `${name}：めやすと比べる材料が無い（内申・模試を聞いて入れる）`,
      });
      continue;
    }

    // --- 内申 ---
    if (naishinDiff != null) {
      if (naishinDiff > 0) {
        lines.push({
          kind: 'say',
          text: isTokyo
            ? `${name}：内申はめやすを${naishinDiff}上回っている${prov}。推薦も一般も内申が武器になる`
            : `${name}：内申はめやすを${naishinDiff}上回っている${prov}。内申が武器になる`,
        });
      } else if (naishinDiff < 0) {
        lines.push({
          kind: 'say',
          text:
            `${name}：内申がめやすに${-naishinDiff}届かない${prov}。当日の点で取り返す` +
            (isTokyo ? `（${TOKYO_NAISHIN_POINT_WEIGHT}）` : ''),
        });
      } else {
        lines.push({ kind: 'say', text: `${name}：内申はめやすちょうど${prov}` });
      }
    }

    // --- 偏差値 ---
    if (hensachiDiff != null) {
      // 学校名は内申の行で出していれば繰り返さない。「も」は内申もプラスのときだけ
      const head = naishinDiff == null ? `${name}：` : '';
      if (hensachiDiff > 0) {
        const particle = naishinDiff != null && naishinDiff > 0 ? 'も' : 'は';
        lines.push({
          kind: 'say',
          text: `${head}偏差値${particle}めやすを${hensachiDiff}上回っている。このまま維持`,
        });
      } else if (hensachiDiff < 0) {
        lines.push({
          kind: 'say',
          text: `${head}偏差値はめやすまであと${-hensachiDiff}。次の模試で届く幅かを一緒に見る`,
        });
      } else {
        lines.push({ kind: 'say', text: `${head}偏差値はめやすちょうど` });
      }
    }

    // --- 組み合わせ（両方そろったときだけ） ---
    if (naishinDiff != null && hensachiDiff != null) {
      if (naishinDiff > 0 && hensachiDiff > 0) {
        lines.push({
          kind: 'ask',
          text: `${name}は第${school.rank}志望として安全圏。上の学校を狙うかを聞く`,
        });
      } else if (naishinDiff > 0 && hensachiDiff < 0) {
        // ★内申が効く推薦のほうが有利になりうる。神奈川には東京の意味での推薦が無いので出さない
        if (isTokyo) lines.push({ kind: 'ask', text: `${name}の推薦を受けるか聞く` });
      } else if (naishinDiff < 0 && hensachiDiff > 0) {
        lines.push({
          kind: 'say',
          text: isTokyo
            ? `${name}は一般入試の当日点で勝負する形になる`
            : `${name}は当日の学力検査で勝負する形になる`,
        });
      }
    }
  }

  return lines;
}

/* ============================================================
 * ②ヒアリング: 前回の約束・前回の要望
 * ------------------------------------------------------------
 * 正典: docs/interview-workspace-layout-2026-09.md §「中身の追加（第2段）」
 *
 * せっかく来てもらう面談なので、「前回こう言っていましたが、その後どうですか」を
 * 台本に載せる。件数と文言が確実でないと面談で使えないため、AIには書かせず
 * システムが組む（AIに書かせるのは lastInterview の「見えること」だけ）。
 * ========================================================== */

/** 「その後どうですか」に埋め込む本文の長さ。これ以上は面談で読み上げられない */
const MAX_FOLLOW_UP_TEXT = 40;
/** 前回の要望として拾う箇条書きの上限。並べすぎると左の「話すこと」が埋まる */
const MAX_PREVIOUS_REQUESTS = 5;
/** 前回の約束として出す未完了タスクの上限（同上） */
const MAX_PREVIOUS_PROMISES = 5;

/**
 * 「前回の要望」として拾う Notta の見出し。
 * ★要望そのものだけでなく「次回への申し送り」「今後の方針」も拾う。前回の面談で
 *   保護者と約束したことは、この3つのどこに書かれるか運用で決まっていないため。
 */
const PREVIOUS_REQUEST_HEADING = /(保護者からの要望|要望|次回への申し送り|今後の方針)/;

/**
 * 要望の「中身」ではなく、要望について**論評している**箇条書き。
 * ★Nottaは要望の節に「要望の強さは、具体的な依頼というより進路選択に関する相談・
 *   不安の表明レベルです。」のような所見を混ぜる（小川 華佳さんの実例）。
 *   これを「前回の要望」として拾うと、②で「〜への対応を伝える」という意味の通らない行が立つ。
 * ★当てる範囲は狭くしてある（頭が「要望の強さ」「要望は」「要望としては」、または
 *   「というより」「レベルです」を含むものだけ）。要望そのものを取りこぼすほうが害が大きいので、
 *   広げるときは実物の文で確かめてから足すこと。
 * ★面談記録カード（parseNottaSummary の表示）では消さない。所見として読む価値はあるので、
 *   ②の「前回の要望」に拾うときだけ外す。
 * ★「〜がうかがえます」「〜が見られます」「〜と思われます」で終わる文も外す（2026-09-23 追加）。
 *   保護者が言ったことではなく、Notta が様子から推し量った所見。小川 華佳さんの
 *   「推薦入試の結果や志望校の倍率に対する不安が強く、早く安心したい気持ちが見られます。」が
 *   「報告 ―― 前回の要望『…気持ちが見られます。』への対応を伝える」になっていた。
 *   ②の読み取り（AI）には申し送りとして全文が渡るので、所見そのものは失われない。
 */
const PREVIOUS_REQUEST_COMMENTARY =
  /^(要望の強さ|要望は|要望としては)|というより|レベルです|(うかがえます|伺えます|見られます|と思われます|と考えられます)。?$/;

/** 'YYYY-MM-DD' を 'M/D' にする（狭い枠に出す事実の行では年を落とす） */
export function fmtMonthDay(dateStr: string): string {
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return dateStr;
  return `${Number(m[2])}/${Number(m[3])}`;
}

/** 面談で読み上げる長さに詰める（切ったことが分かるよう…を付ける） */
function clipForTalk(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_FOLLOW_UP_TEXT ? `${flat.slice(0, MAX_FOLLOW_UP_TEXT)}…` : flat;
}

/**
 * 追いかける1件（前回の約束・前回の要望）。
 *
 * ★2026-09-23 に source を持たせた。教室長の指摘で「聞く」か「報告する」かは**中身で決まる**
 *   ことが分かったため（「英語の長文を増やしてほしい」は塾が対応を報告すること、
 *   「慶應を含めて最後まで検討」は家庭に聞くこと）。判定は原則AI（followUps）が行うが、
 *   AIが使えない日に何も出さないわけにいかないので、出どころで振る受け皿をここに持つ。
 */
export interface PreviousCommitmentItem {
  /** 本文（原文のまま）。★AIへ送る followUps の item はこの文字列そのもの */
  text: string;
  /** 出どころ。'task'＝前回の約束（未完了タスク）／それ以外は面談記録の見出し */
  source: string;
  /** AIが使えない・その項目を返さなかったときの既定の扱い */
  fallback: FollowUpFallbackKind;
}

/** AIが使えないときの既定の扱い。report＝塾から対応を伝える／ask＝家庭に聞く */
export type FollowUpFallbackKind = 'report' | 'ask';

/** ②ヒアリングの「前回の約束」「前回の要望」と、そこから組む「聞くこと」 */
export interface PreviousCommitmentLines {
  /** 右（事実）: 未完了のタスク。1件1行 */
  promises: string[];
  /** 右（事実）: 直近の面談記録から拾った要望・申し送りの箇条書き */
  requests: string[];
  /** 左（話すこと）: 約束・要望1件ごとの「その後どうですか」 */
  asks: string[];
  /**
   * 左（話すこと）を1件ずつ組むための素。★約束が先・要望が後（面談で話す順）。
   * 同じ本文が約束と要望の両方にあるときは先に来たほう（約束）だけを残す。
   */
  items: PreviousCommitmentItem[];
}

/**
 * その出どころは「報告」か「聞く」か。★AIが使えないときだけ使う受け皿。
 *
 * 保護者からの**要望**は、その後こちらがどう対応したかを塾から伝えるもの
 * （聞き返すと「前に頼んだのに何もしていないのか」になる）。
 * 一方で約束・申し送り・今後の方針は、家庭側が動いた結果を聞く側が多い。
 *
 * ★ただし今後の方針・申し送りでも、塾が引き受けた行動（「〜を確認します」「〜を準備します」）は
 *   報告にする（2026-09-23・小川 華佳さんの実例）。Notta は「次回までに…推薦入試の条件を確認します」
 *   のように塾の宿題を方針として書く。これを「その後どうですか」と保護者に聞くのは筋が違う。
 *   語尾で当てるのは、AIが使えない日の受け皿だから（AIが動けば AI が1件ずつ決める）。
 *   家庭と塾のどちらの行動とも読める「検討します」は含めない（聞くほうに倒す）。
 */
const SCHOOL_SIDE_ACTION =
  /(確認します|準備します|進めます|用意します|提案します|お伝えします|共有します)。?$/;

export function previousItemFallbackKind(source: string, text = ''): FollowUpFallbackKind {
  if (source === 'task') return 'ask';
  if (/要望/.test(source)) return 'report';
  return SCHOOL_SIDE_ACTION.test(text) ? 'report' : 'ask';
}

/** 左（話すこと）: 「前回の『◯◯』はその後どうですか」 */
export function previousFollowUpAskLine(text: string): string {
  return `前回の「${clipForTalk(text)}」はその後どうですか`;
}

/**
 * 左（話すこと）: 対応を口頭で伝える行（中身は教室長が埋める）。
 * ★出どころで言い方を変える。要望なら「対応を伝える」、塾が引き受けた方針なら「進み具合を伝える」
 */
export function previousFollowUpReportLine(text: string, source = '要望'): string {
  return /要望/.test(source)
    ? `報告 ―― 前回の要望「${clipForTalk(text)}」への対応を伝える`
    : `報告 ―― 前回決めた「${clipForTalk(text)}」の進み具合を伝える`;
}

/**
 * 前回の約束（未完了タスク）と前回の要望（直近の面談記録の箇条書き）を組み、
 * 1件ごとに「前回の『◯◯』はその後どうですか」を作る。
 *
 * ★約束の本文は title ではなく content に入る（InterviewTasksCard の追加欄が
 *   content に書くため）。title が入っている古い行もあるので title を優先する。
 * ★同じ文面が約束と要望の両方に出ることがある（面談でタスクに起こした要望など）ので、
 *   「聞くこと」は文面で重複を落とす。同じことを2回聞かせない。
 * ★items は出どころ（source）付きで1件ずつ返す。「聞く」か「報告する」かは中身で決まり、
 *   その判定はAI（followUps）が行うが、AIが使えない日のために出どころでも振れるようにしてある。
 */
export function buildPreviousCommitmentLines(
  interviews: readonly StudentInterview[]
): PreviousCommitmentLines {
  // --- 前回の約束（未完了タスク） ---
  const promiseTexts: string[] = [];
  const promises: string[] = [];
  /** 出どころ付きの1件ずつ。約束→要望の順に積む */
  const items: PreviousCommitmentItem[] = [];
  for (const row of interviews) {
    if (row.interview_type !== 'task' || row.is_completed) continue;
    if (promises.length >= MAX_PREVIOUS_PROMISES) break;
    const text = (row.title?.trim() || row.content || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    promiseTexts.push(text);
    promises.push(`${text}（${fmtMonthDay(row.interview_date)}・未完了）`);
    items.push({ text, source: 'task', fallback: previousItemFallbackKind('task') });
  }

  // --- 前回の要望（直近の面談記録の箇条書き） ---
  const requests: string[] = [];
  const latest = interviews.find((i) => i.interview_type !== 'task');
  if (latest) {
    // ★中身が空の見出し（「確認できませんでした」だけの節）は parseNottaSummary が畳むので、
    //   ここに来る時点で omitted は混ざらない
    const parsed = parseNottaSummary(latest.content);
    for (const section of parsed?.sections ?? []) {
      if (!PREVIOUS_REQUEST_HEADING.test(section.heading)) continue;
      for (const bullet of section.bullets) {
        if (requests.length >= MAX_PREVIOUS_REQUESTS) break;
        const text = bullet.replace(/\s+/g, ' ').trim();
        if (!text) continue;
        // 要望そのものではなく要望への論評（PREVIOUS_REQUEST_COMMENTARY の注記）
        if (PREVIOUS_REQUEST_COMMENTARY.test(text)) continue;
        requests.push(text);
        // ★同じ文面が約束にもあるときは、先に積んだ約束のほうを残す（2回追いかけさせない）
        if (!items.some((i) => i.text === text)) {
          items.push({
            text,
            source: section.heading,
            fallback: previousItemFallbackKind(section.heading, text),
          });
        }
      }
    }
  }

  // --- 「その後どうですか」（左） ---
  const asks = Array.from(
    new Set([...promiseTexts, ...requests].map((t) => previousFollowUpAskLine(t)))
  );

  return { promises, requests, asks, items };
}

/* ============================================================
 * ②ヒアリング: 前回の申し送り（AIにもこの文面を渡す）
 * ========================================================== */

/**
 * 面談記録1件から「前回の申し送り」として1行に載せる文面を作る。
 *
 * ★Notta取込の本文をそのまま切り出すと、「確認できませんでした」だけの節や
 *   録音日時・URLが行の半分を占める。実機で読めなかったので、構造化してから畳む。
 *   ここで作った文面は画面だけでなく **AIにもそのまま渡る**（ノイズを減らすのが狙い）。
 *
 * 優先順:
 *   1. `## 次回への申し送り` 見出し（手で書いたもの）
 *   2. Nottaの「次回への申し送り」節
 *   3. Nottaの中身のある節を「見出し: 箇条書き／…」で並べたもの
 *   4. メタ行だけ落とした本文（構造化できない手入力の記録）
 */
export function buildHandoverText(content: string): string {
  const explicit = extractHandover(content);
  if (explicit) return explicit.replace(/\s+/g, ' ').trim().slice(0, MAX_HANDOVER_LENGTH);

  const parsed = parseNottaSummary(content);
  if (parsed && parsed.sections.length > 0) {
    const handoverSection = parsed.sections.find((s) => /次回への申し送り/.test(s.heading));
    const text = handoverSection
      ? handoverSection.bullets.join('／')
      : // ★節の区切りは「｜」。箇条書きの区切り（／）と見分けが付かないと、
        //   どこまでが同じ見出しの話なのか読めなくなる
        parsed.sections.map((s) => `${s.heading}: ${s.bullets.join('／')}`).join('｜');
    const flat = text.replace(/\s+/g, ' ').trim();
    if (flat) return flat.slice(0, MAX_HANDOVER_LENGTH);
  }

  return stripNottaMeta(content).replace(/\s+/g, ' ').trim().slice(0, MAX_HANDOVER_LENGTH);
}

/* ============================================================
 * ④現状の確認: 進行表（LIVEの教材だけ・引継ぎのテキストが主役）
 * ========================================================== */

/** 1冊につき出す直近の履歴の数。3回ぶん見れば「最近どうか」は分かる */
const PROGRESS_RECENT_LESSONS = 3;
/** 引継ぎの1行に載せる長さ */
const PROGRESS_HANDOVER_LENGTH = 80;

/**
 * 科目ごとに「いま使っている教材」（LIVE）を1冊だけ選ぶ。
 *
 * ★判定は進行表ページの `pickLiveTextbookIds`（newProgress.shared.ts）と同じ
 *   「最終利用日が最新・同日なら手動の並び順が上」。同じ画面で LIVE の付く教材が
 *   違って見えると取り違えるため、意味論はあちらに合わせること。
 *   関数そのものを共有しないのは、面談ページが取得している形
 *  （テキスト×進行記録の配列）が進行表ページと違うため（このファイル冒頭の
 *   summarizeTextbookProgress と同じ事情）。
 * ★授業記録が1件も無い教材は候補にしない（最終利用日が無い＝使っていない）。
 */
export function pickLiveTextbookDetails(
  textbookData: readonly TextbookProgressData[]
): TextbookProgressDetail[] {
  const best = new Map<string, { detail: TextbookProgressDetail; order: number }>();

  textbookData.forEach(({ textbook, rows }, index) => {
    const detail = summarizeTextbookDetail(textbook, rows);
    if (!detail.lastDate) return;
    // 並び順は手動（sort_order）が正。取得順は呼び出し側の都合なので同点のときだけ使う
    const order = textbook.sort_order ?? index;
    const current = best.get(detail.subject);
    if (
      !current ||
      detail.lastDate > (current.detail.lastDate ?? '') ||
      (detail.lastDate === current.detail.lastDate && order < current.order)
    ) {
      best.set(detail.subject, { detail, order });
    }
  });

  return Array.from(best.values()).map((v) => v.detail);
}

/**
 * 同じ講師・同じ引継ぎ文の行が続いたら、いちばん新しい1件だけ残す。
 *
 * ★引継ぎは単元（student_progress）に付いており、同じ単元を複数回に分けて進めると
 *   その回すべてに同じ文が乗る。実際に 9/15 と 9/11 に同じ講師・同じ文の行が並んでいた。
 *   面談で同じ文を2回読むと「先週と同じことしか言えていない」に見えるので畳む。
 * ★引継ぎが空の行は畳まない。文が無い行同士を「同じ」と見なすと、別々の単元が消えて
 *   何をやったのかが分からなくなる。
 * ★連続していないとき（間に別の引継ぎが挟まるとき）は残す。時系列が飛ぶと読めなくなるため。
 * ★入力は新しい順（summarizeTextbookDetail が実施日の降順で返す）なので、
 *   連続する塊の先頭＝いちばん新しい1件が残る。
 */
export function dedupeConsecutiveHandovers(
  lessons: readonly TextbookLessonHistoryEntry[]
): TextbookLessonHistoryEntry[] {
  const kept: TextbookLessonHistoryEntry[] = [];
  let prevKey: string | null = null;
  for (const lesson of lessons) {
    const text = lesson.handover?.replace(/\s+/g, ' ').trim() ?? '';
    const key = text ? JSON.stringify([lesson.teacherName?.trim() ?? '', text]) : null;
    if (key != null && key === prevKey) continue;
    kept.push(lesson);
    prevKey = key;
  }
  return kept;
}

/**
 * ④現状の確認の「進行表」の行を組む。
 *
 * ★進捗%は出さない。数字の話は成績でする、というのが第2段の決めごと
 *  （docs/interview-workspace-layout-2026-09.md）。主役は引継ぎのテキスト。
 * ★1冊目の行に「進行表 ―― 」の見出しを付けるのは呼び出し側（カード・印刷シート）。
 */
export function buildProgressFactLines(textbookData: readonly TextbookProgressData[]): string[] {
  const lines: string[] = [];

  for (const detail of pickLiveTextbookDetails(textbookData)) {
    const subject = SUBJECT_LABELS[detail.subject] ?? detail.subject;
    const head = `${detail.name}${subject ? `（${subject}）` : ''}`;
    lines.push(`${head} 最終記入 ${detail.lastDate ? fmtMonthDay(detail.lastDate) : '―'}`);

    for (const lesson of dedupeConsecutiveHandovers(detail.recentLessons).slice(
      0,
      PROGRESS_RECENT_LESSONS
    )) {
      const teacher = lesson.teacherName?.trim();
      const handover = lesson.handover?.replace(/\s+/g, ' ').trim();
      lines.push(
        `${fmtMonthDay(lesson.lessonDate)} ${lesson.unitTitle}${teacher ? `（${teacher}）` : ''}` +
          // 引継ぎが無い単元のほうが多い。「：」だけが並ぶと読めないので、無ければ足さない
          (handover ? `：${handover.slice(0, PROGRESS_HANDOVER_LENGTH)}` : '')
      );
    }

    if (detail.nextUnitTitles.length > 0) {
      lines.push(`次 ―― ${detail.nextUnitTitles.join('、')}`);
    }
  }

  return lines;
}

/* ============================================================
 * ⑤プラン提示: 今期の提案と、これまでの講習の履歴
 * ------------------------------------------------------------
 * 正典: docs/interview-workspace-layout-2026-09.md §⑤
 *
 * ★材料は提案書（seasonal_proposals）。koushu_enrollments は本番0行で、
 *   2027-02公開のWeb申込の入力源として空のまま待っている。消さずに足し込む側に置き、
 *   行ができたら同じ期のバケットに合流させる（lib/api/seasonalProposalSummary.ts 参照）。
 * ========================================================== */

/** 履歴として出す期の数。古い期まで並べても面談では使わない */
const MAX_KOUSHU_HISTORY = 4;

/** 期の状態の言い方。⑤の行・⑥のバッジ・ヘッダー帯で同じ言葉を使う */
const KOUSHU_STATUS_LABEL: Record<SeasonalProposalStatus, string> = {
  approved: '申込済',
  sent: '提案中',
  draft: '下書き',
};

/** 年度内の季節の並び（古い→新しい）。年度は4月始まりなので 春期 → 夏期 → 冬期 */
const SEASON_ORDER_IN_YEAR: Record<string, number> = { spring: 0, summer: 1, winter: 2 };

/**
 * 今日が属する講習の年度。
 *
 * ★1〜3月は前年度。年度は4月始まりで、1〜2月の冬期講習・3月の春期講習はどちらも
 *   前年4月に始まった年度のものとして year に入っている
 *  （本番の実例: 2026-09 に作った冬期の提案書が year=2026）。
 */
export function koushuFiscalYear(date: Date): number {
  const month = date.getMonth() + 1;
  return month <= 3 ? date.getFullYear() - 1 : date.getFullYear();
}

/** 期（年度×季節）1つぶんの講習。提案書と（将来の）Web申込を合流させた形 */
export interface KoushuSeasonBucket {
  year: number;
  season: string;
  status: SeasonalProposalStatus;
  /** 科目名（日本語）→ コマ数 */
  komaBySubject: Record<string, number>;
  totalKoma: number;
}

/**
 * 提案書のまとめ（getSeasonalProposalSummaryByStudent）と koushu_enrollments を、
 * 期（年度×季節）ごとに1つのバケットへ合流させる。
 *
 * ★koushu_enrollments は年度カラムを持たない（school+season+student+formation で一意）ので、
 *   年度は created_at の年から出す。1〜3月に作られた行は前年度に寄せる（koushuFiscalYear と同じ規則）。
 * ★enrollments の行は「保護者が実際に申し込んだ」ものなので approved 扱いにする。
 * ★科目名は subjects マスタ（id→name）を呼び出し側から渡す。ここでは引かない（純粋関数を保つ）。
 */
export function mergeKoushuSeasons(
  summaries: readonly SeasonalProposalSeasonSummary[],
  enrollments: readonly KoushuEnrollment[],
  subjectNames: Record<string, string>
): KoushuSeasonBucket[] {
  const byKey = new Map<string, KoushuSeasonBucket>();

  const bucketOf = (year: number, season: string): KoushuSeasonBucket => {
    const key = `${year}-${season}`;
    const found = byKey.get(key);
    if (found) return found;
    const created: KoushuSeasonBucket = {
      year,
      season,
      status: 'draft',
      komaBySubject: {},
      totalKoma: 0,
    };
    byKey.set(key, created);
    return created;
  };

  const rank: Record<SeasonalProposalStatus, number> = { draft: 0, sent: 1, approved: 2 };

  for (const s of summaries) {
    const bucket = bucketOf(s.year, s.season);
    if (rank[s.status] > rank[bucket.status]) bucket.status = s.status;
    for (const [subject, koma] of Object.entries(s.komaBySubject)) {
      bucket.komaBySubject[subject] = (bucket.komaBySubject[subject] ?? 0) + koma;
    }
    bucket.totalKoma += s.totalKoma;
  }

  for (const e of enrollments) {
    const season = e.season ?? '';
    if (!season) continue;
    const created = e.created_at ? new Date(e.created_at) : null;
    if (!created || Number.isNaN(created.getTime())) continue;
    const bucket = bucketOf(koushuFiscalYear(created), season);
    bucket.status = 'approved';
    const normalized = normalizeKomaBySubject(e.koma_by_subject);
    let named = 0;
    for (const [subjectId, spec] of Object.entries(normalized)) {
      const name = subjectNames[subjectId] ?? '科目不明';
      bucket.komaBySubject[name] = (bucket.komaBySubject[name] ?? 0) + spec.koma;
      named += spec.koma;
    }
    // ★科目別の内訳が無い古い行は総コマ数だけ足す。内訳が取れないことを黙って0コマに見せない
    bucket.totalKoma += named > 0 ? named : (e.koma_count ?? 0);
  }

  return Array.from(byKey.values());
}

/** 新しい期が先頭になる並び（年度降順 → 年度内は 冬期・夏期・春期 の順） */
function sortKoushuSeasonsDesc(buckets: readonly KoushuSeasonBucket[]): KoushuSeasonBucket[] {
  return [...buckets].sort(
    (a, b) =>
      b.year - a.year ||
      (SEASON_ORDER_IN_YEAR[b.season] ?? -1) - (SEASON_ORDER_IN_YEAR[a.season] ?? -1)
  );
}

/** 「数学 8コマ・英語 6コマ」。0コマの科目は出さない。1つも残らなければ null */
function komaBySubjectText(komaBySubject: Record<string, number>): string | null {
  const parts = Object.entries(komaBySubject)
    .filter(([, koma]) => koma > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([subject, koma]) => `${subject} ${koma}コマ`);
  return parts.length > 0 ? parts.join('・') : null;
}

/** 期の見出し（「夏期 2026」）。DBに無い季節キーはそのまま出す */
function koushuSeasonLabel(bucket: KoushuSeasonBucket): string {
  const label = SEASON_LABELS[bucket.season as keyof typeof SEASON_LABELS] ?? bucket.season;
  return `${label} ${bucket.year}`;
}

/**
 * ⑤の「今期」の行（1行 or 0行）。
 *
 * 「提案 数学 8コマ・英語 6コマ（申込済）」。status が sent なら（提案中）、draft なら（下書き）。
 * ★コマ数が1つも入っていない提案書（applied_koma が全部0）は「提案あり・コマ未確定」。
 *   提案書はあるのに何も言わないと、面談で話し漏らす。
 */
export function buildKoushuCurrentLines(
  buckets: readonly KoushuSeasonBucket[],
  year: number,
  season: string
): string[] {
  const bucket = buckets.find((b) => b.year === year && b.season === season);
  if (!bucket) return [];
  const body = komaBySubjectText(bucket.komaBySubject);
  const status = KOUSHU_STATUS_LABEL[bucket.status];
  return [body ? `提案 ${body}（${status}）` : `提案あり・コマ未確定（${status}）`];
}

/**
 * ⑤の「講習の履歴」の行（今期を除く・新しい順・最大4件）。
 *
 * 「夏期 2026：数学 12コマ・英語 8コマ（申込）」。
 * ★approved（申し込みが確定した期）だけを出す。下書き・提案中の過去の期は
 *   「出したが取らなかった」「作りかけのまま残った」行で、面談で読み上げるとノイズになる。
 * ★履歴が無ければ空配列（呼び出し側は行を出さない）。
 */
export function buildKoushuHistoryLines(
  buckets: readonly KoushuSeasonBucket[],
  year: number,
  season: string
): string[] {
  return sortKoushuSeasonsDesc(buckets)
    .filter((b) => !(b.year === year && b.season === season))
    .filter((b) => b.status === 'approved')
    .slice(0, MAX_KOUSHU_HISTORY)
    .map((b) => {
      const body = komaBySubjectText(b.komaBySubject) ?? `${b.totalKoma}コマ`;
      return `${koushuSeasonLabel(b)}：${body}（申込）`;
    });
}

/** ヘッダー帯・⑤のバッジ・⑥「申込の状況」が共通に使う、講習1行のまとめ */
export interface KoushuSummaryView {
  /** 表示文。3か所で同じ文言を使う（片方だけ直して食い違うのを防ぐ） */
  label: string;
  /** コマ数。今期が空なら直近の期のコマ数 */
  koma: number;
  /** 今期の申込が確定しているか。★過去の期にフォールバックしているときは false */
  applied: boolean;
  /** label が今期のものか。false＝今期は空で直近の期を出している */
  isCurrentSeason: boolean;
}

/**
 * 今期の講習を1行にまとめる。ヘッダー帯・⑤のバッジ・⑥の「申込の状況」で同じ値を使う。
 *
 * ★今期に1件も無いときは黙って「申込なし」で終わらせない。直近の期を添える。
 *   本番では夏期の提案書しか無い生徒が大半で、9月の面談で「申込なし」とだけ出ると
 *   「この生徒は講習を取ったことがない」と読み違える（実際は夏期に98コマ取っている）。
 */
export function summarizeCurrentKoushu(
  buckets: readonly KoushuSeasonBucket[],
  year: number,
  season: string
): KoushuSummaryView {
  const seasonLabel = SEASON_LABELS[season as keyof typeof SEASON_LABELS] ?? season;
  const current = buckets.find((b) => b.year === year && b.season === season);
  if (current) {
    return {
      label: `${koushuSeasonLabel(current)} ${current.totalKoma}コマ（${KOUSHU_STATUS_LABEL[current.status]}）`,
      koma: current.totalKoma,
      applied: current.status === 'approved',
      isCurrentSeason: true,
    };
  }

  const latest = sortKoushuSeasonsDesc(buckets)[0];
  if (!latest) {
    return { label: '申込なし', koma: 0, applied: false, isCurrentSeason: false };
  }
  return {
    label: `${seasonLabel} ${year} は申込なし（直近 ${koushuSeasonLabel(latest)} ${latest.totalKoma}コマ・${KOUSHU_STATUS_LABEL[latest.status]}）`,
    koma: latest.totalKoma,
    applied: false,
    isCurrentSeason: false,
  };
}
