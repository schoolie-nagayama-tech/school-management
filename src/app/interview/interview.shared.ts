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
import type { BriefSectionKey } from '@/lib/ai/interviewBrief';
import type { TextbookProgressData } from './ProgressPanel';
import type { DisciplineSessionRow } from '@/lib/api/progress-sessions';
import type { TargetSchoolRow } from '@/lib/api/targetSchools';
import { calcTokyoNaishin } from '@/lib/utils/convertedNaishin';

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
 */
const NOTTA_EMPTY_BULLET =
  /(見つかりませんでした|確認できませんでした|確認できません|記載がありません)/;

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
    if (bullet) current.bullets.push(bullet);
  }

  if (sections.length === 0) return null;

  // ★箇条書きが「確認できませんでした」等しか無い見出しは畳む。
  //   1件も箇条書きが無い見出しも同じ扱い（読む人にとっては同じ「記載なし」）。
  const kept: NottaSection[] = [];
  const omitted: string[] = [];
  for (const s of sections) {
    if (s.bullets.length === 0 || s.bullets.every((b) => NOTTA_EMPTY_BULLET.test(b))) {
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

/** 進度に載せるテキストの数。並べすぎると読まれない */
const TELL_MAX_PROGRESS_LINES = 4;
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
}): TellSection[] {
  const sections: TellSection[] = [];

  const scoreLines: string[] = [];
  const regular = tellScoreLine(props.assessments, 'regular_test', '定期テスト');
  if (regular) scoreLines.push(regular);
  const report = tellScoreLine(props.assessments, 'report_card', '通知表');
  if (report) scoreLines.push(report);
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

  const progressLines = props.textbookData
    .slice(0, TELL_MAX_PROGRESS_LINES)
    .map(({ textbook, rows }) => {
      const detail = summarizeTextbookDetail(textbook, rows);
      const next = detail.nextUnitTitles[0];
      const stalled = detail.stalled ? '・停滞' : '';
      return `${detail.name}: ${detail.progressPct}%${stalled}${next ? `・次: ${next}` : ''}`;
    });
  if (progressLines.length > 0) sections.push({ key: 'progress', current: progressLines });

  if (props.koushuEnrollments.length > 0) {
    sections.push({
      key: 'koushu',
      current: [`申込 ${formatKoushuEnrollments(props.koushuEnrollments)}`],
    });
  }

  const latest = props.interviews.filter((i) => i.interview_type !== 'task')[0];
  if (latest) {
    const lines = [
      `${fmtDateJa(latest.interview_date)}（${daysSince(latest.interview_date)}日前）`,
    ];
    const handover = extractHandover(latest.content) ?? stripNottaMeta(latest.content);
    const text = handover.replace(/\s+/g, ' ').trim().slice(0, MAX_HANDOVER_LENGTH);
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
  label = '必要内申'
): string {
  if (naishin == null) return `${label}は未設定`;
  if (naishinMax != null && naishinMax !== 65) return `${label}${naishin}/${naishinMax}`;
  return `${label}${naishin}`;
}

/** 生徒本人の直近の内申（report_card）から、換算内申（都立・65点満点）を計算する。無ければ null */
function latestOwnNaishin(assessments: AssessmentWithScores[]): number | null {
  // assessments は新しい順（降順）で来る前提（computeScoreSummary と同じ前提）
  const latest = assessments.find((a) => a.category === 'report_card');
  if (!latest) return null;
  const scores: Record<string, number | null> = {};
  for (const s of latest.scores) scores[s.subject] = s.value;
  return calcTokyoNaishin(scores).converted;
}

/** 生徒本人の直近の模試（mock）の5科偏差値（hensa_5）。無ければ null */
function latestOwnHensachi(assessments: AssessmentWithScores[]): number | null {
  const latest = assessments.find(
    (a) => a.category === 'mock' && a.scores.some((s) => s.subject === 'hensa_5')
  );
  return latest?.scores.find((s) => s.subject === 'hensa_5')?.value ?? null;
}

/** 「志望校との差」の行。伝える（マスタに当たり本人の数字も取れた）／聞く（志望校が未登録） */
export interface TargetSchoolGapLines {
  tell: string[];
  ask: string[];
}

/**
 * 志望校（マスタに当たったもの）と本人の内申・偏差値を並べて「志望校との差」の行を作る。
 *
 * ★マスタに当たっていて（master が非null）、本人の内申・偏差値のどちらかが取れるときだけ出す。
 * ★「Vもぎ 2025年9月版・合格可能性60%の位置」の出典と、verified_at が null なら
 *   「原本との突き合わせは未了」を必ず添える。保護者に見せうる数字なので、
 *   出どころと確度を隠さない（docs/interview-script-ai-plan.md §4-2）。
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

  const ownNaishin = latestOwnNaishin(assessments);
  const ownHensachi = latestOwnHensachi(assessments);

  const tell: string[] = [];
  for (const school of targetSchools) {
    const master = school.master;
    if (!master) continue;

    const parts: string[] = [];
    if (master.naishin != null) {
      /**
       * ★差を出してよいのは、本人の換算内申と必要内申の満点が揃っているときだけ。
       *
       * calcTokyoNaishin は5科×1＋実技4科×2＝65点満点しか計算しない。
       * 3教科入試の学科（芸術・体育系）は国数英×1＋残り6科×2＝75点満点、
       * 産業技術高専は独自換算で52点満点なので、65点満点の本人の数字から引くと
       * 意味のない値になる（駒場の保健体育は必要内申55/75。本人41を引いて「-14」と
       * 出すと、面談で「あと14足りません」と言ってしまう）。
       *
       * 満点が違うときは必要内申だけを分母つきで出し、差は出さない。
       * 出典: vault NEST/ナレッジ/高校入試情報_都立は1020点の総合得点1本で決まる.md
       *      「3教科入試の学科を志望に混ぜたら換算内申の満点が75になる。
       *        65点満点の学校と同じ数字で並べない」
       */
      const comparable = master.naishinMax == null || master.naishinMax === 65;
      if (ownNaishin != null) {
        if (comparable) {
          const diff = ownNaishin - master.naishin;
          const diffText = diff >= 0 ? `+${diff}` : `${diff}`;
          parts.push(`${formatNaishin(master.naishin, master.naishinMax)}（${diffText}）`);
        } else {
          // 満点が違うので差は出せない。必要内申だけを分母つきで示す
          parts.push(formatNaishin(master.naishin, master.naishinMax));
        }
      }
      // 本人の内申が取れないときは何も出さない（②④の「聞くこと」が入力を促す）
    }
    if (master.hensachi != null && ownHensachi != null) {
      const diff = ownHensachi - master.hensachi;
      const diffText = diff >= 0 ? `+${diff}` : `${diff}`;
      parts.push(`必要偏差値${master.hensachi}（${diffText}）`);
    }
    if (parts.length === 0) continue;

    const sourceBits: string[] = [];
    if (master.sourceLabel) sourceBits.push(`${master.sourceLabel}・合格可能性60%の位置`);
    if (master.verifiedAt == null) sourceBits.push('原本との突き合わせは未了');
    const sourceSuffix = sourceBits.length > 0 ? `（${sourceBits.join('／')}）` : '';

    tell.push(`第${school.rank}志望 ${master.schoolName} ―― ${parts.join('・')}${sourceSuffix}`);
  }

  return { tell, ask: [] };
}
