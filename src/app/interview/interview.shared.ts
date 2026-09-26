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
import type { BriefSectionKey, FollowUpActor } from '@/lib/ai/interviewBrief';
import { PLAN_AI_PREFIX, SHUKAISU_AI_PREFIX, TEST_PREP_AI_PREFIX } from '@/lib/ai/interviewBrief';
import { zoukomaKomaCount } from '@/lib/utils/zoukomaKoma';
import type { TextbookProgressData } from './ProgressPanel';
import type { DisciplineSessionRow } from '@/lib/api/progress-sessions';
import type { TargetSchoolMaster, TargetSchoolRow } from '@/lib/api/targetSchools';
import type { MockSchoolRecord } from '@/lib/api/mockTargetSchools';
import { mockSchoolShortName } from '@/lib/scores/mockSchools';
import {
  calcKanagawaNaishin135,
  calcTokyoNaishin,
  type KanagawaNaishin135Result,
  type ReportCardInput,
} from '@/lib/utils/convertedNaishin';
import type { Region } from '@/lib/interview/region';
import { TOKYO_NAISHIN_POINT_WEIGHT } from '@/lib/interview/scenes';
import {
  ADMISSION_STATUS_LABEL,
  buildStudentReportCards,
  evaluateRule,
  pickPrimaryRule,
  provisionalNote,
  ruleHeading,
  type AdmissionJudgment,
  type AdmissionRule,
  type StudentReportCards,
} from '@/lib/interview/privateAdmission';

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
 * ★常体（だ・である調）の言い回しも拾う（2026-09-23・松村 知佳さんの実例）。
 *   「保護者からの要望は会話内では確認できなかった。」が前回の要望に拾われ、
 *   「…確認できなかった。」への対応を伝える、という行が立っていた。
 *   ★単独の「なかった」は足さない（「宿題をやらなかった」のような中身のある文まで消すため）。
 */
const NOTTA_EMPTY_BULLET =
  /(見つかりませんでした|確認できませんでした|確認できません|見当たりません|記載がありません|発言はありません|ありませんでした|特になし|特に無し|確認できなかった|確認されなかった|見当たらなかった|見つからなかった|記載はなかった|記載がなかった|発言はなかった|言及はなかった|言及されなかった|話題に出なかった)[。．.\s]*$/;

/**
 * 新しいNottaの型（2026-09-23 に教室長が変更）で「話題が出なかった」ことを表す1件。
 * ★新しい型では、出なかった見出しには「（なし）」を1件だけ書く決まり。
 *   古い型の「確認できませんでした」と同じ扱い（見出しごと記載なしに畳む）。
 * ★「生徒：（なし）」「受け止め：（なし）」のように頭の語が付いた（なし）も同じ（2026-09-24）。
 *   Nottaはテンプレートの指示1つにつき1行を書くので、話に出なかった指示が頭の語付きの（なし）で
 *   残る（本番 9/23 の実物）。畳まないと面談記録カードに「生徒：（なし）」が1件として出ていた。
 */
const NOTTA_NONE_BULLET = /^(?:[^\s（(：:]{1,8}\s*[：:]\s*)?[（(]\s*なし\s*[）)][。．.]?$/;

/**
 * Nottaの要約の見出しとして扱ってよい名前（■・【】が付いていない形で来たときだけ使う）。
 * ★Slack経由で届いた要約は「前回の確認 • 前回の面談…」のように、見出しの印が無く、
 *   箇条書きの「•」と同じ行に見出しが並ぶ。自由文の中の語を見出しと取り違えないよう、
 *   知っている名前だけを見出しにする（src/lib/api/notta-transcripts.ts の
 *   NOTTA_SECTION_HEADERS と揃える。印象に残った言葉は2026-09-23の新しい型で足した見出し）。
 */
const NOTTA_KNOWN_HEADINGS = [
  '前回の確認',
  '塾からの報告',
  '保護者からの要望',
  '生徒からの要望',
  '相談事項',
  '今後の方針',
  '総合メモ',
  '印象に残った言葉',
  '次回への申し送り',
] as const;

/** 不可視文字（LRM・RLM・ゼロ幅空白）。Nottaの出力の行末や見出しの前に混ざる */
const NOTTA_INVISIBLE = /[‎‏​]/g;

/**
 * Slack経由の形（見出しの印なし・「•」の箇条書き・見出しが前の箇条書きの行末に続く）を、
 * 「■ 見出し」と「・箇条書き」の行に組み直す。
 *
 * 例（本番の notta_transcripts.transcript の実物の形）:
 *   「前回の確認 • 前回の面談…\n• 前回決めた方針…\n• …‎ 塾からの報告 • 英語は…」
 * ★見出しとみなすのは「知っている見出し名の直後に •」が来たときと、
 *   知っている見出し名だけの行（印なし）のときだけ。
 * ★すでに「■ 見出し」「【見出し】」の形の本文（取り込み時に整形済みの記録）は触らない
 *  （■ や 【 の直後の見出しは (^|\s) に当たらないので置き換わらない）。
 */
function normalizeNottaLayout(content: string): string {
  const names = NOTTA_KNOWN_HEADINGS.join('|');
  const inlineHeading = new RegExp(`(^|\\s)(${names})\\s*•\\s*`, 'g');
  const bareHeadingLine = new RegExp(`^\\s*(${names})\\s*$`);
  return content
    .replace(NOTTA_INVISIBLE, '')
    .replace(inlineHeading, (_m, _pre: string, name: string) => `\n■ ${name}\n・`)
    .split('\n')
    .map((line) => {
      const bare = line.match(bareHeadingLine);
      return bare ? `■ ${bare[1]}` : line;
    })
    .join('\n');
}

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
  // ★Slack経由の形（見出しの印なし・「•」の箇条書き）を先に組み直す（normalizeNottaLayout の注記）
  const lines = normalizeNottaLayout(content).split('\n');

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
    const bullet = trimNottaLine(line.replace(/^[・•\-*]\s*/, ''));
    // ★知っている見出し名だけの箇条書き（「・印象に残った言葉」）は見出しに戻す（2026-09-24）。
    //   取り込み時の整形の見出し一覧に「印象に残った言葉」を足す前に取り込んだ記録は、
    //   見出しが前の節（総合メモ）の箇条書きとして保存されている（本番 9/23 の実物）
    if ((NOTTA_KNOWN_HEADINGS as readonly string[]).includes(bullet)) {
      current = { heading: bullet, bullets: [] };
      sections.push(current);
      continue;
    }
    // ★「確認できませんでした」等の箇条書きは1件ずつ落とす（NOTTA_EMPTY_BULLET の注記）。
    //   新しい型の「（なし）」も同じ（NOTTA_NONE_BULLET の注記）
    if (bullet && !NOTTA_EMPTY_BULLET.test(bullet) && !NOTTA_NONE_BULLET.test(bullet)) {
      current.bullets.push(bullet);
    }
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
  /** 模試の志望校と合格可能性。★「直近の模試」の行を score に混ぜてAIへ送る */
  mockSchools?: readonly MockSchoolRecord[];
  /**
   * テスト対策の短い行（buildTestPrepLines の aiLines。「テスト対策:」で始まる）。
   * ★score に混ぜてAIへ送る。表示側は stripTargetSchoolFactLines で外す（④に別の形で出すため）
   */
  testPrepAiLines?: readonly string[];
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
  /**
   * ★「直近の模試」の行（合格可能性つき）も score に混ぜる。AIが合格可能性の流れに
   *   言葉で触れられるようにするため（数字はAIに書かせない。画面が別に出す）。
   *   表示側は志望校の行と同じく stripTargetSchoolFactLines で外す。
   */
  const mockLine = buildMockSchoolLines(
    props.mockSchools ?? [],
    props.assessments,
    props.targetSchools ?? []
  ).aiLine;
  if (mockLine) scoreLines.push(mockLine);
  for (const line of props.testPrepAiLines ?? []) scoreLines.push(line);
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
    // ★前回、本人・保護者が「」で言った言葉。AIには言い換えずに引用させる（extractQuotedWords）
    // ★話し手は取り込み時に人が選んだ面談種別で決める（speakerByInterviewType の注記）
    for (const word of extractQuotedWords(latest.content, latest.interview_type))
      lines.push(quotedWordFactLine(word));
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
  /**
   * 各テストの学年（testLabels と同じ並び）。★「1学期期末」だけでは中2と中3のどちらの試験か
   * 分からない（学年をまたいで直近5件を並べると、同じ名前の列が2つ出る）。見出しに添える用
   */
  testGrades: (number | null)[];
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
  const testGrades = picked.map((a) => a.grade ?? null);

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

  return { testLabels, testGrades, rows, totals };
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
 * ★結果は「その試験の、目標の年度の学年の」定期テストだけと突き合わせる（2026-09）。
 *   name_code だけで引くと、中3の2学期中間の目標に去年（中2）の2学期中間の点が付く
 *   （本番に term2_mid が111件あり、多くが前の学年のもの。実例: 中3の国語で
 *   「目標90 → 69（-21）」と出たが、69は中2のときの点だった）。
 *   目標の年度の学年は、今の学年から「今日の年度 − exam_date の年度」を引いて出す
 *  （4月始まり・koushuFiscalYear。buildTestPrepLines の proposalGrade と同じ考え方）。
 *   学年が分からない生徒は突き合わせようが無いので、全部「聞くこと」に回す。
 *   ★去年の点を出すより、聞いて入れてもらう方が安全（違う点で「-21」と言うと面談が壊れる）。
 */
export function buildGoalAchievementLines(
  examGoals: readonly ExamGoalForAchievement[],
  assessments: readonly AssessmentWithScores[],
  studentGrade: number | null,
  today: Date
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
  const fiscalNow = koushuFiscalYear(today);

  for (const goal of targets) {
    const target = goal.target_score as number;
    const examLabel = goal.exam_type_name ?? goal.custom_exam_name ?? '（試験名未設定）';
    const subject = GOAL_SUBJECT_TO_ASSESSMENT_SUBJECT[goal.subject_key];
    const nameCode = goal.exam_type_name
      ? GOAL_EXAM_NAME_TO_ASSESSMENT_NAME_CODE[goal.exam_type_name]
      : undefined;
    const goalGrade = gradeInFiscalYearOf(studentGrade, fiscalNow, goal.exam_date);

    // 変換できない（科目・試験名がどちらの変換表にも無い）、または目標の年度の学年が出せない
    // ときは、結果を探しようが無いので聞くことに回す
    const score =
      subject && nameCode && goalGrade != null
        ? (assessments
            .find(
              (a) =>
                a.category === 'regular_test' && a.name_code === nameCode && a.grade === goalGrade
            )
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

/**
 * 日付（YYYY-MM-DD）の年度に、その生徒が何年生だったか。
 *
 * ★new Date('YYYY-MM-DD') は UTC 0時として読まれるため使わない。年と月だけを文字列から取り、
 *   ローカルの日付として koushuFiscalYear に渡す（4/1 が 3月扱いになる事故を避ける）。
 * ★未来の年度（来年度の目標）なら学年は上がる。差をそのまま引くので +1 になる。
 */
function gradeInFiscalYearOf(
  studentGrade: number | null,
  fiscalNow: number,
  dateStr: string
): number | null {
  if (studentGrade == null) return null;
  const m = /^(\d{4})-(\d{2})/.exec(dateStr);
  if (!m) return null;
  const fiscal = koushuFiscalYear(new Date(Number(m[1]), Number(m[2]) - 1, 1));
  return studentGrade - (fiscalNow - fiscal);
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
  grade: number | null,
  /**
   * ★申込から分かっていることがあるときは、同じことを別の言い方で2回聞かせない。
   *   - hasTestPrepAsk: テスト対策の「{試験名}の結果を聞いて入れる」が出ている
   *   - hasMockApplication: 模試の申込がある（受けているかは聞くまでもない。結果の返却は別の行が聞く）
   */
  known: { hasTestPrepAsk?: boolean; hasMockApplication?: boolean } = {}
): string[] {
  if (grade == null || grade < 7) return [];

  const lines: string[] = [];
  if (!known.hasTestPrepAsk && !assessments.some((a) => a.category === 'regular_test')) {
    lines.push('定期テストの結果を聞いて入れる');
  }
  if (!known.hasMockApplication && !assessments.some((a) => a.category === 'mock')) {
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

/**
 * score の現状の行から志望校の行と「直近の模試」の行を外す。
 * ★どちらもAIには score に混ぜて渡すが、画面・紙では④の志望校ブロックとして別に出すため。
 */
export function stripTargetSchoolFactLines(lines: readonly string[]): string[] {
  // ★「テスト対策:」の行も同じ扱い（AIには score に混ぜて渡し、画面・紙は④に別の形で出す）
  // ★「プラン:」の行（koushu に混ぜて渡す今期のプランの中身）も外す。⑤の科目カードが別の形で出す
  return lines.filter(
    (l) =>
      !isTargetSchoolFactLine(l) &&
      !isMockSchoolFactLine(l) &&
      !isTestPrepAiLine(l) &&
      !l.startsWith(PLAN_AI_PREFIX)
  );
}

/** score の現状の行のうち、AIに渡すために混ぜた「テスト対策:」の行か */
export function isTestPrepAiLine(line: string): boolean {
  return line.startsWith(TEST_PREP_AI_PREFIX);
}

/* ============================================================
 * 模試の志望校と合格可能性（④現状の確認）
 * ========================================================== */

/** 「直近の模試」の行の書き出し。score に混ぜた行を表示側で見分けるのに使う */
export const MOCK_SCHOOL_FACT_PREFIX = '直近の模試（';

export function isMockSchoolFactLine(line: string): boolean {
  return line.startsWith(MOCK_SCHOOL_FACT_PREFIX);
}

export interface MockSchoolLines {
  /** 右（事実）。1行目が「直近の模試（…） ―― …」、2行目があれば「★模試では … も書いている」 */
  tell: string[];
  /** 左（聞く）。登録に無い公立校を志望校に入れるか */
  ask: string[];
  /** AIの score に混ぜる行（tell の1行目と同じ）。無ければ null */
  aiLine: string | null;
}

/** 合格可能性の短い表示。「60%」／「判定なし」／空欄は空文字 */
function possibilityText(s: { possibility: number | null; unjudged: boolean }): string {
  if (s.possibility != null) return `${s.possibility}%`;
  return s.unjudged ? '判定なし' : '';
}

/** 同じ学校かどうか。マスタに当たっていればIDで、無ければ短い名前で比べる */
function sameMockSchool(a: MockSchoolRecord, b: MockSchoolRecord): boolean {
  if (a.highSchoolId && b.highSchoolId) return a.highSchoolId === b.highSchoolId;
  return mockSchoolShortName(a.nameRaw) === mockSchoolShortName(b.nameRaw);
}

/**
 * ④に出す「直近の模試」の行。
 *   直近の模試（会場模試 9月） ―― 狛江 60%（前回 50%）・神代 20%／私立 専修大附属 70%
 *
 * ★直近＝志望校が1件でも入っている模試のうち、いちばん新しいもの。前回＝その1つ前。
 *   模試の並びは assessments（listAssessments の新しい順）に従う。
 * ★合格可能性の数字はシステムが組む（AIに書かせない。数字の書き写しの1字違いに誰も気づけない）。
 * ★「判定なし」（模試の **）は 0% と書かない。
 * ★登録に無い公立校の指摘は、志望校が1件以上登録されている生徒だけに出す。
 *   未登録の生徒には④に「志望校を聞いて入れる」が既に出ており、同じことを2回言わせない。
 */
export function buildMockSchoolLines(
  mockSchools: readonly MockSchoolRecord[],
  assessments: readonly AssessmentWithScores[],
  targetSchools: readonly TargetSchoolRow[]
): MockSchoolLines {
  const empty: MockSchoolLines = { tell: [], ask: [], aiLine: null };
  if (mockSchools.length === 0) return empty;

  const byAssessment = new Map<string, MockSchoolRecord[]>();
  for (const s of mockSchools) {
    const list = byAssessment.get(s.assessmentId) ?? [];
    list.push(s);
    byAssessment.set(s.assessmentId, list);
  }
  const mocks = assessments.filter((a) => a.category === 'mock' && byAssessment.has(a.id));
  if (mocks.length === 0) return empty;

  const latest = mocks[0];
  const current = [...(byAssessment.get(latest.id) ?? [])].sort((a, b) => a.slot - b.slot);
  const previous = mocks[1] ? (byAssessment.get(mocks[1].id) ?? []) : [];

  const part = (s: MockSchoolRecord) => {
    const poss = possibilityText(s);
    const before = previous.find((p) => sameMockSchool(p, s));
    const beforeText = before ? possibilityText(before) : '';
    return [mockSchoolShortName(s.nameRaw), poss, beforeText ? `（前回 ${beforeText}）` : '']
      .filter(Boolean)
      .join(' ')
      .replace(' （', '（');
  };

  const publicParts = current.filter((s) => s.isPublic).map(part);
  const privateParts = current.filter((s) => !s.isPublic).map(part);
  const title = ASSESSMENT_NAME_LABELS[latest.name_code] ?? latest.title ?? '模試';
  const monthSource = latest.exam_month ?? latest.exam_date;
  const month = monthSource ? ` ${Number(monthSource.slice(5, 7))}月` : '';
  const body = [
    publicParts.join('・'),
    privateParts.length > 0 ? `私立 ${privateParts.join('・')}` : '',
  ]
    .filter(Boolean)
    .join('／');
  const aiLine = `${MOCK_SCHOOL_FACT_PREFIX}${title}${month}） ―― ${body}`;

  const tell = [aiLine];
  const ask: string[] = [];
  if (targetSchools.length > 0) {
    const registered = targetSchools.map((t) => ({
      id: t.highSchoolId,
      name: mockSchoolShortName(t.schoolName),
    }));
    const missing = current
      .filter((s) => s.isPublic)
      .filter(
        (s) =>
          !registered.some((r) =>
            s.highSchoolId && r.id
              ? s.highSchoolId === r.id
              : r.name === mockSchoolShortName(s.nameRaw)
          )
      )
      .map((s) => mockSchoolShortName(s.nameRaw));
    if (missing.length > 0) {
      const names = missing.join('・');
      tell.push(`★模試では ${names} も書いている（登録に無い）`);
      ask.push(`模試で書いた ${names} は志望校に入れるか聞く`);
    }
  }
  return { tell, ask, aiLine };
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
  } else if (master.hensachiByGender) {
    /**
     * ★私立の共学校で男子表・女子表の値が違うときは両方を並べ、差は出さない。
     *   NEST は生徒の性別を持っていないので、どちらかと引き算すると半分の生徒に違う表の差を言う。
     */
    const g = master.hensachiByGender;
    const bits = [
      g.男子 != null ? `男子${g.男子}` : null,
      g.女子 != null ? `女子${g.女子}` : null,
    ].filter(Boolean);
    if (bits.length > 0) parts.push(`必要偏差値 ${bits.join('・')}`);
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
export function targetSchoolDiffs(
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
 * 私立・国立の志望校について、代表の入試区分（既定は併願優遇（公私））を本人の通知表に当てた判定。
 * 公立（admissionRules が空）なら null。
 *
 * 「併願（公私） 届いている（3科12（基準11）を満たす）」の形。
 * ★判定はシステムの計算なので数字を出してよい（AIには書かせない。buildTargetSchoolTalkLines の★と同じ理由）。
 * ★基準が紙と未照合（verified_at=NULL）なら必ず添える。AIの書き起こしのままの数字で
 *   「届いている」と言い切って、読み違いだったときに保護者の併願が崩れる。
 * ★仮判定（中3の1学期・中2の学年末）なら添える。
 * ★gender（生徒の性別）が分かれば、男女別の基準は本人の側を代表に選ぶ（pickPrimaryRule）。
 */
export function privateAdmissionBlock(
  master: TargetSchoolMaster,
  cards: StudentReportCards,
  region: Region | null,
  gender: 'male' | 'female' | null = null
): { text: string; rule: AdmissionRule; judgment: AdmissionJudgment } | null {
  const rules = master.admissionRules ?? [];
  if (rules.length === 0) return null;
  const rule = pickPrimaryRule(rules, region, gender);
  if (!rule) return null;
  const judgment = evaluateRule(rule, cards);
  const notes: string[] = [];
  const prov = provisionalNote(judgment.provisional);
  if (prov && judgment.status !== 'na' && judgment.status !== 'nodata') notes.push(prov);
  if (rule.verifiedAt == null) notes.push('基準は原本と未照合');
  const summary =
    judgment.status === 'na' || judgment.status === 'nodata'
      ? judgment.summary
      : `${ADMISSION_STATUS_LABEL[judgment.status]}・${judgment.summary}`;
  return {
    text: `${ruleHeading(rule)} ${summary}` + (notes.length > 0 ? `（${notes.join('／')}）` : ''),
    rule,
    judgment,
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
  assessments: AssessmentWithScores[],
  region: Region | null = null,
  /** 生徒の性別（私立の男女別の基準を本人の側で判定する）。未設定は null */
  gender: 'male' | 'female' | null = null
): TargetSchoolGapLines {
  if (targetSchools.length === 0) {
    return { tell: [], ask: ['志望校を聞いて入れる'] };
  }
  const cards = buildStudentReportCards(assessments);

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
    // ★併願の印（TargetSchoolsPanel の「併願」ボタン）はAIの材料にも添える。
    //   印が無いと、併願で押さえる私立を第2志望＝本命の1つとして話を組まれる
    const heigan = school.isHeigan ? '（併願）' : '';
    const blocks: string[] = [`第${school.rank} ${name}${course}${heigan}`];

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

      // 私立・国立: 推薦・併願優遇の基準を本人の通知表に当てた判定
      const privateBlock = privateAdmissionBlock(master, cards, region, gender);
      if (privateBlock) blocks.push(privateBlock.text);

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

/**
 * 私立・国立の志望校について、④の左で言うこと・聞くこと。
 * ★判定の数字はシステムの計算（privateAdmission.ts）。AIには書かせない。
 * ★確認事項（欠席日数・説明会参加など）は、届いているときほど聞く。判定が「届いている」でも、
 *   欠席日数で出願できない生徒を見落とすのが一番の事故になるため。
 */
function privateAdmissionTalkLines(
  name: string,
  master: TargetSchoolMaster,
  cards: StudentReportCards,
  region: Region | null,
  gender: 'male' | 'female' | null
): TargetSchoolTalkLine[] {
  const block = privateAdmissionBlock(master, cards, region, gender);
  if (!block) return [];
  const { rule, judgment } = block;
  const heading = ruleHeading(rule);
  const unverified = rule.verifiedAt == null ? '（基準は原本と未照合）' : '';
  const lines: TargetSchoolTalkLine[] = [];
  const firstCheck = judgment.checks[0];

  switch (judgment.status) {
    case 'ok':
    case 'ok_with_bonus':
      lines.push({
        kind: 'say',
        text: `${name}：${heading}の内申の基準は届いている${unverified}。${judgment.summary}`,
      });
      if (firstCheck) lines.push({ kind: 'ask', text: `${name}：${firstCheck}を確かめる` });
      break;
    case 'conditional':
      lines.push({ kind: 'say', text: `${name}：${heading}は${judgment.summary}${unverified}` });
      break;
    case 'bonus':
      lines.push({ kind: 'say', text: `${name}：${heading}は${judgment.summary}${unverified}` });
      lines.push({
        kind: 'ask',
        text: `${name}：英検・漢検・数検など、加点になるものを持っているか聞く`,
      });
      break;
    case 'short':
      lines.push({
        kind: 'say',
        text: `${name}：${heading}の基準まで${judgment.summary}${unverified}。2学期の評定で届く幅かを話す`,
      });
      break;
    case 'ng':
      lines.push({
        kind: 'say',
        text: `${name}：${heading}は${judgment.summary}${unverified}。一般入試か別のコースを考える`,
      });
      break;
    case 'na':
      lines.push({
        kind: 'say',
        text: `${name}：${heading}は内申では決まらない（${judgment.summary}）。当日の点で勝負する形`,
      });
      break;
    case 'nodata':
      lines.push({ kind: 'ask', text: `${name}：通知表を入れると${heading}の判定が出る` });
      break;
  }
  return lines;
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
  ownKanagawaNaishin: KanagawaNaishin135Result | null = null,
  /** 私立の推薦・併願優遇を判定するための本人の通知表（buildStudentReportCards） */
  reportCards: StudentReportCards | null = null,
  /** 生徒の性別（私立の男女別の基準を本人の側で判定する。右の「志望校」の行とそろえる） */
  gender: 'male' | 'female' | null = null
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

    // --- 私立・国立: 推薦・併願優遇の判定 ---
    const privateLines =
      school.master && reportCards
        ? privateAdmissionTalkLines(name, school.master, reportCards, region, gender)
        : [];
    lines.push(...privateLines);

    if (naishinDiff == null && hensachiDiff == null) {
      // 私立の判定を出したなら「材料が無い」は言わない（内申の材料はある）
      if (privateLines.length > 0) continue;
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
 * ★常体（〜様子が見られる。）も同じ（2026-09-24）。本番の古い型の実物で
 *   「報告 ―― 前回の要望「…様子が見られる。」への対応を伝える」が立っていた。
 */
const PREVIOUS_REQUEST_COMMENTARY =
  /^(要望の強さ|要望は|要望としては)|というより|レベルです|(うかがえます|伺えます|見られます|と思われます|と考えられます|うかがえる|伺える|見られる|と思われる|と考えられる)。?$/;

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
  /**
   * 新しいNottaの型の「誰が動くか」。★AIにも本文とは別に添えて送る（interviewBrief.ts の
   * FollowUpActor）。古い型の記録・タスクには付かない。
   */
  actor?: FollowUpActor;
  /** 新しいNottaの型の要望の印（【相談】【要望】）。いまは画面に出していない */
  tag?: '相談' | '要望';
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

export function previousItemFallbackKind(
  source: string,
  text = '',
  /**
   * 新しいNottaの型の「誰が動くか」（parsePreviousBullet が頭の語から取ったもの）。
   * ★あれば語尾の当て推量（SCHOOL_SIDE_ACTION）より優先する。書いた本人が決めた動く人なので、
   *   語尾から推すより確か。塾が動く＝報告、家庭・生徒・次回確認＝聞く。
   */
  actor?: FollowUpActor
): FollowUpFallbackKind {
  if (source === 'task') return 'ask';
  if (actor) return actor === 'juku' ? 'report' : 'ask';
  if (/要望/.test(source)) return 'report';
  return SCHOOL_SIDE_ACTION.test(text) ? 'report' : 'ask';
}

/**
 * 新しいNottaの型（2026-09-23）の判断の行。「感情：不安が強い」「受け止め：前向き」のように、
 * 書いた人の見立てを頭の語で分けて書く決まり。
 * ★面談記録カードにはそのまま出すが、②の「前回の要望・方針」には拾わない
 *  （要望でも約束でもないものに「対応を伝える」「その後どうですか」が立つと意味が通らない）。
 * ★古い型の「保護者の感情面：…」「保護者・生徒の受け止め：…」も同じ見立ての行（2026-09-24）。
 *   本番の実物で「報告 ―― 前回の要望「保護者の感情面：…」への対応を伝える」が立っていた。
 */
const NOTTA_JUDGEMENT_PREFIX = /^(?:保護者・生徒の|保護者の|生徒の)?(感情|受け止め)面?\s*[：:]/;

/**
 * 新しいNottaの型の「保護者からの要望」の末尾の印（【相談】【要望】）。
 * ★②で読み上げる本文からは外す。印は tag に残す（いまは画面に出していない）。
 */
const NOTTA_REQUEST_TAG = /\s*【(相談|要望)】\s*$/;

/**
 * 新しいNottaの型の「今後の方針」の頭の語（誰が動くか）。
 * ★古い型の「【塾】テキストを発注する」「【保護者】カードを登録する」も同じ意味で読む（2026-09-24）。
 *   読まないと「【塾】…」に保護者へ「その後どうですか」と聞く行が立っていた（本番の実物）。
 */
const NOTTA_ACTOR_PREFIX: readonly { re: RegExp; actor: FollowUpActor }[] = [
  { re: /^(?:塾\s*[：:]|【塾】)\s*/, actor: 'juku' },
  { re: /^(?:家庭\s*[：:]|【(?:家庭|保護者)】)\s*/, actor: 'home' },
  { re: /^(?:生徒\s*[：:]|【生徒】)\s*/, actor: 'student' },
  { re: /^次回確認\s*[：:]\s*/, actor: 'nextCheck' },
];

/** parsePreviousBullet の戻り */
export interface PreviousBullet {
  /** 頭の語・末尾の印を外した本文。★②とAIに渡すのはこの文 */
  text: string;
  /** 「塾：」「家庭：」…から取った動く人。古い型（頭の語なし）では無い */
  actor?: FollowUpActor;
  /** 「【相談】」「【要望】」の印。無ければ無い */
  tag?: '相談' | '要望';
  /** 「感情：」「受け止め：」の判断の行。②には拾わない */
  judgement: boolean;
}

/**
 * Nottaの箇条書き1件を、②で追いかける1件として読む（新しい型・古い型の両方）。
 * ★古い型の箇条書き（頭の語も印も無い）はそのまま text に入り、actor も tag も付かない。
 */
export function parsePreviousBullet(bullet: string): PreviousBullet {
  let text = bullet.replace(/\s+/g, ' ').trim();
  if (NOTTA_JUDGEMENT_PREFIX.test(text)) return { text, judgement: true };

  let tag: PreviousBullet['tag'];
  const tagMatch = text.match(NOTTA_REQUEST_TAG);
  if (tagMatch) {
    tag = tagMatch[1] as PreviousBullet['tag'];
    text = text.slice(0, tagMatch.index).trim();
  }

  let actor: FollowUpActor | undefined;
  for (const p of NOTTA_ACTOR_PREFIX) {
    if (p.re.test(text)) {
      actor = p.actor;
      text = text.replace(p.re, '').trim();
      break;
    }
  }
  // ★「話者 2：」の頭の語は誰が動くかにならない（話者番号は生徒・保護者・塾のどれか分からない）。
  //   外すだけで actor は付けず、AIが使えない日は語尾の当て推量（SCHOOL_SIDE_ACTION）に任せる
  if (!actor) text = text.replace(NOTTA_SPEAKER_NUMBER_PREFIX, '').trim();
  return { text: stripSpeakerNumbers(text), actor, tag, judgement: false };
}

/**
 * Nottaの話者番号（「話者 2」「話者１」）。
 * ★Nottaは声を聞き分けて番号を振るだけで、誰の声かは分からない。本番では「話者 1」が
 *   教室長本人のことが多かった。テンプレートで「生徒は名前で書く」としていた頃は、名前を
 *   知らないNottaが代わりに「話者 2は…」「話者 2：…」と書いていた（2026-09-23 の実物）。
 *   台本に「前回の「話者 2は…」はその後どうですか」と出すと読めないので、②の本文からは外す。
 * ★面談記録カード（parseNottaSummary の表示）では外さない。記録そのものとして残す。
 */
const NOTTA_SPEAKER_NUMBER_PREFIX = /^話者\s*[0-9０-９]+\s*[：:]\s*/;
const NOTTA_SPEAKER_NUMBER = /話者\s*[0-9０-９]+/;

/**
 * 本文中の話者番号を外す。「話者 2は国立大学を…」→「国立大学を…」、
 * 「生徒（話者 4）が…」→「生徒が…」。★名前や「本人」に置き換えない（誰の声か分からないため）。
 */
function stripSpeakerNumbers(text: string): string {
  return text
    .replace(/[（(]\s*話者\s*[0-9０-９]+\s*[）)]/g, '')
    .replace(/話者\s*[0-9０-９]+\s*(?:は|が|も)[、，]?\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
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
        // ★新しい型の頭の語（塾：／家庭：…）・末尾の印（【相談】…）はここで外す（parsePreviousBullet）
        const parsedBullet = parsePreviousBullet(bullet);
        // 「感情：」「受け止め：」は見立ての行で、要望・約束・方針ではない
        if (parsedBullet.judgement) continue;
        const text = parsedBullet.text;
        if (!text) continue;
        // ★「次回確認事項：」「合意した対応・変更点：」のような小見出しだけの行は中身が無い
        //  （古い型の実物。「前回の「次回確認事項：」はその後どうですか」が立っていた）
        if (/[：:]$/.test(text)) continue;
        // 要望そのものではなく要望への論評（PREVIOUS_REQUEST_COMMENTARY の注記）
        if (PREVIOUS_REQUEST_COMMENTARY.test(text)) continue;
        requests.push(text);
        // ★同じ文面が約束にもあるときは、先に積んだ約束のほうを残す（2回追いかけさせない）
        if (!items.some((i) => i.text === text)) {
          items.push({
            text,
            source: section.heading,
            fallback: previousItemFallbackKind(section.heading, text, parsedBullet.actor),
            ...(parsedBullet.actor ? { actor: parsedBullet.actor } : {}),
            ...(parsedBullet.tag ? { tag: parsedBullet.tag } : {}),
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
 * ②ヒアリング: 前回の「」の言葉をそのまま運ぶ
 * ------------------------------------------------------------
 * 正典: docs/interview-workspace-layout-2026-09.md「2026-09-23 整理」
 *
 * ★前回の面談で本人・保護者が口にした言葉（「頑張ります」）を、次の面談で
 *   そのまま返す。言い換えた要約では「覚えていてくれた」にならない。
 *   AIには書かせずシステムが拾う（1字でも変わると本人の言葉ではなくなる）。
 * ========================================================== */

/** 前回の言葉1件 */
export interface QuotedWord {
  /** 「」の中身（原文のまま） */
  quote: string;
  /** 誰の言葉か。分からなければ null（画面は「〜という言葉が出ていました」と言う） */
  speaker: '生徒' | '保護者' | null;
}

/** 拾う言葉の上限。②の振り返りの話すことに並ぶので多すぎると埋まる */
const MAX_QUOTED_WORDS = 3;
/** これより短い「」は言葉ではなく語（「英検」「推薦」など）とみなして拾わない */
const MIN_QUOTE_LENGTH = 3;
/**
 * これより長い「」は拾わない。★切り詰めない（途中で切ったら本人の言葉ではなくなる）。
 *   長い「」はたいてい発言ではなく、文書・資料の引用。
 */
const MAX_QUOTE_LENGTH = 60;

/** 話し手を指す語。★同じ文の中で「」より前にある、いちばん近いものを採る */
const SPEAKER_STUDENT = /(生徒|本人|お子さん|お子様)/g;
const SPEAKER_PARENT = /(保護者|お母様|お母さん|お父様|お父さん|母|父)/g;

/** 新しい型の「印象に残った言葉」の末尾の話し手の印（（生徒）（保護者）など） */
const QUOTE_SPEAKER_LABEL = /[（(]\s*([^（）()]{1,8})\s*[）)]\s*$/;

/**
 * 塾側を指す語。★「塾からは「最初にしては良い」と伝えた」のような塾の発言を、
 * 「前回の面談で…という言葉が出ていました」と家庭の言葉のように読み上げないため（2026-09-24）。
 */
// ★「塾」単独では当てない（「生徒は塾で「頑張ります」と」の生徒の言葉まで落とすため）。
//   話し手として書かれる形（塾から・塾側・教室長・先生…）だけにする
const SPEAKER_JUKU = /(塾から|塾側|塾は|教室から|教室側|教室長|先生|講師)/g;

/** 話し手の語から生徒・保護者・塾を決める（どれでもなければ null） */
function speakerOfWord(word: string): QuotedWord['speaker'] | 'juku' {
  if (/^(生徒|本人|お子さん|お子様)$/.test(word)) return '生徒';
  if (/^(保護者|お母様|お母さん|お父様|お父さん|母|父)$/.test(word)) return '保護者';
  if (/^(塾|教室|先生|講師|教室長)$/.test(word)) return 'juku';
  return null;
}

/**
 * 面談種別から話し手を決める（2026-09-24・教室長と決めた）。
 *
 * ★Nottaは話し手が生徒か保護者か（塾か家庭かさえ）を聞き分けられない。要約に付く（生徒）（保護者）や
 *   「生徒は「…」と」は、Nottaが中身から推し量ったもので当てにならない。
 *   一方、面談種別は取り込むときに人が選んでいる。生徒面談なら塾以外の話し手は生徒しかいない。
 * - 生徒面談: 生徒。ただし本文が保護者の言葉だと言っていれば食い違うので null（決めつけない）
 * - それ以外（保護者面談・電話・その他…）: null。保護者面談は三者面談のこともあり、生徒の言葉が混ざる
 * - 種別を渡さない呼び出し（種別が分からない本文）は、本文からの推し量りをそのまま使う（従来どおり）
 */
function speakerByInterviewType(
  hinted: QuotedWord['speaker'],
  interviewType: string | undefined,
  /**
   * 話し手の書かれていない言葉を家庭の言葉とみなしてよいか。
   * ★新しい型の「印象に残った言葉」は塾の言葉を書かない決まりなので true。
   *   古い型の文中の「」は、話し手の語が無ければ塾の言葉のこともある
   *  （「ちょっとずつやろう」という方針が毎回確認されている…の実物）ので false。
   */
  unlabeledIsFamily: boolean
): QuotedWord['speaker'] {
  if (interviewType === undefined) return hinted;
  if (interviewType !== 'student_interview') return null;
  if (hinted === '保護者') return null;
  if (hinted === null && !unlabeledIsFamily) return null;
  return '生徒';
}

/**
 * 古い型で、「」より前の同じ文から話し手を決める。
 * ★主語（「保護者は」「お母様から」「塾からは」）があればそれを採る。無ければ「」にいちばん近い語。
 *   いちばん近い語だけで決めると「保護者は生徒の現状に対して危機感を共有しており、「本当やばいな」」が
 *   生徒の言葉になっていた（2026-09-24・本番の実物）。
 */
function speakerOfSentence(sentence: string): QuotedWord['speaker'] | 'juku' {
  const kinds = [
    { re: SPEAKER_STUDENT, kind: '生徒' as const },
    { re: SPEAKER_PARENT, kind: '保護者' as const },
    { re: SPEAKER_JUKU, kind: 'juku' as const },
  ];
  let subject: { at: number; kind: QuotedWord['speaker'] | 'juku' } | null = null;
  let nearest: { at: number; kind: QuotedWord['speaker'] | 'juku' } | null = null;
  for (const { re, kind } of kinds) {
    re.lastIndex = 0;
    for (let m = re.exec(sentence); m; m = re.exec(sentence)) {
      const end = m.index + m[0].length;
      // 塾から・塾は のように語そのものが助詞まで含むものは、それ自体を主語とみなす
      const isSubject = /[はら]$/.test(m[0]) || /^(?:本人)?(は|が|から)/.test(sentence.slice(end));
      if (isSubject && (!subject || m.index > subject.at)) subject = { at: m.index, kind };
      if (!nearest || m.index > nearest.at) nearest = { at: m.index, kind };
    }
  }
  return (subject ?? nearest)?.kind ?? null;
}

/**
 * 古い型（「印象に残った言葉」の節が無い記録）で、文中の「」が発言かどうか。
 * ★「」の直後が「と」（「〜」と発言／と話す／という）か、「」の中が話し言葉の語尾で
 *   終わるときだけ拾う。教材名（「新中学問題集」を進める）や見出しの引用を
 *   「前回こう話していました」と読み上げないため。
 */
function looksSpoken(quote: string, after: string): boolean {
  // ★「最初にしては良い」「伸びしろがある」と… のように「」が続くときは、続きの「」を飛ばして
  //   「と」を見る（小川 華佳さんの実物。先頭の「」だけ取りこぼしていた）
  // ★「として」は発言ではない（「「精神的支柱」として肯定的に捉えて」の実物・2026-09-24）
  if (/^と(?!して)/.test(after.replace(/^(?:[、・]?「[^「」]*」)+/, ''))) return true;
  return /(ます|です|たい|ない|だ|よ|ね|な|か|[。！？!?])$/.test(quote);
}

/**
 * 面談記録の本文から、本人・保護者が言った「」の言葉を拾う（最大3件・重複なし）。
 *
 * - ★新しい型（2026-09-23〜）で「印象に残った言葉」の見出しがあれば、その節だけを使う。
 *   話し手は末尾の（生徒）（保護者）の印から取る。節が「（なし）」でも他の節からは拾わない
 *  （新しい型で書いた人が「無かった」と決めたものを、推し量りで埋めない）。
 * - 古い型は、中身のある節の箇条書きから文中の「」を拾う。話し手は同じ文の中で「」より前にある
 *   生徒｜本人｜お子さん／保護者｜お母様｜母… のうち、いちばん近い語で決める。無ければ null。
 * - 3字未満・60字超・見出しと同じ語・重複は拾わない。
 * - 「感情：」「受け止め：」の見立ての行からは拾わない（本人の言葉ではない）。
 * - Nottaとして読めない本文（手入力の短い記録）は、メタ行を落とした本文から同じ規則で拾う。
 * - ★塾側の言葉は拾わない（2026-09-24）。新しい型の（塾）（先生）の印、古い型で「」より前に
 *   いちばん近い語が塾から・先生…のもの、「話者 1：「…」」のように話者番号で書かれたもの。
 *   話者番号は誰の声か分からず、本番では「話者 1」が教室長本人のことが多かった
 *  （旧型の重要発言メモ「話者 1：「提出物出せよ」」）。家庭の言葉として読み上げるより、出さないほうがよい。
 * - ★interviewType（取り込み時に人が選んだ面談種別）を渡すと、話し手はそれで決める
 *  （speakerByInterviewType の注記）。本文の（生徒）（保護者）は食い違いの確認にだけ使う。
 */
export function extractQuotedWords(content: string, interviewType?: string): QuotedWord[] {
  const parsed = parseNottaSummary(content);
  const out: QuotedWord[] = [];
  const headings = new Set<string>([
    ...(parsed?.sections.map((s) => s.heading) ?? []),
    ...(parsed?.omitted ?? []),
  ]);

  const push = (
    quoteRaw: string,
    hinted: QuotedWord['speaker'] | 'juku',
    unlabeledIsFamily: boolean
  ) => {
    if (out.length >= MAX_QUOTED_WORDS) return;
    // 塾側の言葉は家庭の言葉として読み上げない（この関数の注記）
    if (hinted === 'juku') return;
    const quote = quoteRaw.replace(/\s+/g, ' ').trim();
    if (quote.length < MIN_QUOTE_LENGTH || quote.length > MAX_QUOTE_LENGTH) return;
    if (headings.has(quote)) return;
    if (out.some((q) => q.quote === quote)) return;
    out.push({ quote, speaker: speakerByInterviewType(hinted, interviewType, unlabeledIsFamily) });
  };

  // --- 新しい型：「印象に残った言葉」の節 ---
  const impressive = '印象に残った言葉';
  if (parsed && headings.has(impressive)) {
    const section = parsed.sections.find((s) => s.heading === impressive);
    for (const raw of section?.bullets ?? []) {
      // 話者番号で書かれた言葉は誰の声か分からない（塾側のこともある）ので拾わない
      if (NOTTA_SPEAKER_NUMBER.test(raw)) continue;
      const bullet = raw.trim();
      const label = bullet.match(QUOTE_SPEAKER_LABEL);
      const speaker = label ? speakerOfWord(label[1].trim()) : null;
      const body = label ? bullet.slice(0, label.index).trim() : bullet;
      const quoted = Array.from(body.matchAll(/「([^「」]+)」/g)).map((m) => m[1]);
      // 「」で囲んでいない書き方（頑張ります（生徒））も言葉として拾う
      if (quoted.length === 0) push(body, speaker, true);
      for (const q of quoted) push(q, speaker, true);
    }
    return out;
  }

  // --- 古い型：文中の「」 ---
  const texts: string[] = parsed
    ? parsed.sections.flatMap((s) => s.bullets)
    : stripNottaMeta(content).split('\n');
  for (const text of texts) {
    if (NOTTA_JUDGEMENT_PREFIX.test(text.trim())) continue;
    for (const m of Array.from(text.matchAll(/「([^「」]+)」/g))) {
      const start = m.index ?? 0;
      const after = text.slice(start + m[0].length);
      if (!looksSpoken(m[1], after)) continue;
      // 同じ文の中（直前の句点・改行より後ろ）だけを見る
      const before = text.slice(0, start);
      const sentenceStart = Math.max(
        before.lastIndexOf('。'),
        before.lastIndexOf('！'),
        before.lastIndexOf('？'),
        before.lastIndexOf('\n')
      );
      // ★「保護者（話者 5）は「…」」の括弧書きは話し手の語の添え書きなので外して読む。
      //   括弧でなく話者番号そのものが話し手（「話者 1：「…」」）なら誰の声か分からない（この関数の注記）
      const sentence = before
        .slice(sentenceStart + 1)
        .replace(/[（(]\s*話者\s*[0-9０-９]+\s*[）)]/g, '');
      if (NOTTA_SPEAKER_NUMBER.test(sentence)) continue;
      // ★「「…」という外部からの指摘」のように、後ろで別の人の言葉だと言っているものは拾わない
      //  （「接客・まとめる仕事が向いている」の実物。前の「生徒は」から生徒の言葉にしていた）
      if (/^という[^。「」]{0,10}からの/.test(after)) continue;
      push(m[1], speakerOfSentence(sentence), false);
    }
  }
  return out;
}

/**
 * 前回の言葉を②振り返りで話す1文にする。
 * ★呼び方は「◯◯さん」（名字・様は使わない。ひとことと同じ）。名前が無ければ「本人」。
 */
export function quotedWordTalkLine(word: QuotedWord, givenName: string | null | undefined): string {
  const name = (givenName ?? '').trim();
  if (word.speaker === '生徒') {
    return `前回、${name ? `${name}さん` : '本人'}は「${word.quote}」と話していました`;
  }
  if (word.speaker === '保護者') {
    return `前回、保護者の方は「${word.quote}」とおっしゃっていました`;
  }
  return `前回の面談で「${word.quote}」という言葉が出ていました`;
}

/**
 * AIへ渡す【現状】の行（lastInterview に足す）。
 * ★「前回の言葉:」で始める。プロンプトはこの印の「」を言い換えずに引用させる。
 */
export function quotedWordFactLine(word: QuotedWord): string {
  return `前回の言葉: 「${word.quote}」${word.speaker ? `（${word.speaker}）` : ''}`;
}

/* ============================================================
 * 面談記録の検索（材料の段・面談記録カード）
 * ========================================================== */

/**
 * 1文字ずつ検索用に揃える（全角英数→半角・半角カナ→全角・大文字→小文字）。
 * ★1文字ずつ NFKC を掛けるのは、揃えたあとの位置から元の文の位置へ戻すため
 *  （文全体に掛けると「ｶﾞ」の2文字が1文字になるなど長さが変わり、ハイライトの位置がずれる）。
 *   その代わり半角カナの濁点は合成されない（「ｶﾞ」は「カ゛」）。面談記録の検索では困らない。
 */
function foldForSearch(text: string): { folded: string; origin: number[] } {
  let folded = '';
  const origin: number[] = [];
  let i = 0;
  for (const ch of Array.from(text)) {
    const f = ch.normalize('NFKC').toLowerCase();
    folded += f;
    for (let k = 0; k < f.length; k += 1) origin.push(i);
    i += ch.length;
  }
  return { folded, origin };
}

/** 検索語を揃える（空白だけなら空文字） */
export function normalizeSearchQuery(query: string): string {
  return foldForSearch(query.trim()).folded;
}

/** 本文が検索語を含むか（全角半角・大文字小文字を区別しない）。空の検索語は常に true */
export function matchesSearch(text: string, query: string): boolean {
  const q = normalizeSearchQuery(query);
  if (!q) return true;
  return foldForSearch(text).folded.includes(q);
}

/** ハイライト用に分けた1片 */
export interface HighlightPart {
  text: string;
  hit: boolean;
}

/**
 * 本文を「当たった所」と「それ以外」に分ける（元の文字のまま返す）。
 * 当たらなければ1片（hit=false）。空の検索語も1片。
 */
export function splitForHighlight(text: string, query: string): HighlightPart[] {
  const q = normalizeSearchQuery(query);
  if (!q || !text) return [{ text, hit: false }];
  const { folded, origin } = foldForSearch(text);
  const parts: HighlightPart[] = [];
  let cursor = 0; // 元の文での位置
  let from = 0; // 揃えた文での検索開始位置
  for (let at = folded.indexOf(q, from); at !== -1; at = folded.indexOf(q, from)) {
    const start = origin[at];
    const lastOrigin = origin[at + q.length - 1];
    // 当たりの末尾の1文字（サロゲートペアなら2単位）まで含める
    const end = lastOrigin + ((text.codePointAt(lastOrigin) ?? 0) > 0xffff ? 2 : 1);
    if (start >= cursor) {
      if (start > cursor) parts.push({ text: text.slice(cursor, start), hit: false });
      parts.push({ text: text.slice(start, end), hit: true });
      cursor = end;
    }
    from = at + q.length;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), hit: false });
  return parts;
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
export const KOUSHU_STATUS_LABEL: Record<SeasonalProposalStatus, string> = {
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
export function komaBySubjectText(komaBySubject: Record<string, number>): string | null {
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

/* ============================================================
 * 申込から見えること（④テスト対策・②週回数変更・④模試の結果）
 * ------------------------------------------------------------
 * 正典: docs/interview-workspace-layout-2026-09.md「申込から見えること」
 *
 * 教室長の言葉（2026-09-23）:
 *   「テスト対策は取ったのに点数が上がった下がったとか課題感とリンクしたい。
 *    週回数変更は変更してそのあとどうかを報告事項としてあげる。
 *    模試は結果を返せてればよい」
 *
 * ★申込（提案書・フォームの回答）は面談画面が読み込み、ここは並べるだけの純粋関数にする
 *  （読み込みは lib/api/interviewApplications.ts）。画面・紙・テストで同じ関数を使う。
 * ★数字はシステムが組む。AIには短い行（aiLines）を渡し、言葉だけを書かせる。
 * ========================================================== */

/** 'YYYY-MM-DD'（ローカル日付）。★toISOString は UTC なので、朝の9時前に前日へずれる */
function localYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 'YYYY-MM-DD' 同士の日数差（b − a）。どちらかが読めなければ NaN */
function ymdDiffDays(a: string, b: string): number {
  const ta = Date.parse(`${a.slice(0, 10)}T00:00:00Z`);
  const tb = Date.parse(`${b.slice(0, 10)}T00:00:00Z`);
  return Math.round((tb - ta) / 86400000);
}

/** 'YYYY-MM' → '9月'（今日と年が違えば '2027年1月'） */
function monthLabel(ym: string, today: Date): string {
  const [y, m] = ym.split('-').map(Number);
  return y === today.getFullYear() ? `${m}月` : `${y}年${m}月`;
}

/* ---------- ④ テスト対策 → 結果と課題 ---------- */

/** 増コマ申込（form_responses form_type='zoukoma'）1件ぶん。読み込み側がそのまま渡す */
export interface ZoukomaResponseForInterview {
  formPeriod: string;
  createdAt: string;
  responseData: unknown;
}

/**
 * 提案書に対する増コマ申込の状況。
 * - applied: その期にこの生徒の回答がある（コマ数は請求と同じ zoukomaKomaCount）
 * - none: 期は分かるが、回答が無い
 * - unknown: 提案書に期（zoukoma_period_id）が付いていない。★申込の有無を決めつけない
 */
export type TestPrepZoukomaStatus =
  | { status: 'applied'; koma: number }
  | { status: 'none' }
  | { status: 'unknown' };

/**
 * 提案書の期（period_key）に対する増コマ申込を決める。
 * ★同じ期に回答が2件以上あるときは、いちばん新しい1件を採る（出し直しを足し算しない）。
 *   コマ数の数え方は請求と同じ zoukomaKomaCount（src/lib/utils/zoukomaKoma.ts）に合わせる。
 */
export function resolveTestPrepZoukoma(
  periodKey: string | null,
  responses: readonly ZoukomaResponseForInterview[]
): TestPrepZoukomaStatus {
  if (!periodKey) return { status: 'unknown' };
  const latest = responses
    .filter((r) => r.formPeriod === periodKey)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!latest) return { status: 'none' };
  return { status: 'applied', koma: zoukomaKomaCount(latest.responseData) };
}

/** テスト対策の提案書1件ぶん（公開済みのものだけを渡す） */
export interface TestPrepProposalForInterview {
  id: string;
  /** exam_types.name（「2学期中間」）。★試験の種類が付いていない提案書は null */
  examName: string | null;
  title: string;
  createdAt: string;
  /**
   * 科目（提案書の並び順）。units は提案書に載った単元（並び順）と、その単元に割り当てたコマ数。
   * ★単元にはテスト範囲がまるごと入る（自己評価を付けるため）。コマが付いた単元だけが「対策した」単元
   */
  subjects: { name: string; koma: number; units: { name: string; koma: number }[] }[];
  zoukoma: TestPrepZoukomaStatus;
}

export interface TestPrepLines {
  /** ④の根拠。1件目の提案書から順に「見出し → 結果 → 単元」 */
  facts: string[];
  /** ④の聞くこと（結果がまだ入っていない試験） */
  ask: string[];
  /** AIの score に混ぜる行（「テスト対策:」で始まる・1提案書1行） */
  aiLines: string[];
}

/** 何件の提案書まで見るか。★最新と、その1つ前まで（「前回の対策はどうだったか」まで） */
const MAX_TEST_PREP_PROPOSALS = 2;
/** 「対策した単元」に並べる単元の数と1単元の長さ */
const MAX_TEST_PREP_UNITS = 3;
const TEST_PREP_UNIT_LENGTH = 14;

/**
 * 定期テストの年度内の順番。★成績は listAssessments が学年→実施月→name_code で並べて返すが、
 *   実施月（exam_month）は6割以上が空で、そのとき name_code の文字順（term1_final が term1_mid より前）
 *   になる。「前回」を正しく引くため、年度内の順番はここで決め打ちする。
 */
const REGULAR_TEST_ORDER: Record<string, number> = {
  term1_mid: 1,
  first_mid: 1,
  term1_final: 2,
  first_final: 2,
  term2_mid: 3,
  second_mid: 3,
  term2_final: 4,
  second_final: 4,
  year_end: 5,
};

function regularTestKey(a: AssessmentWithScores): number | null {
  const order = REGULAR_TEST_ORDER[a.name_code];
  if (order == null || a.grade == null) return null;
  return a.grade * 10 + order;
}

/**
 * 提案書の科目のうち、対策をした科目と、その単元。
 *
 * ★提案書の単元にはテスト範囲がまるごと入っている（全科目の単元に自己評価を付けてから、
 *   苦手な単元にだけコマを割り当てる作り）。本番の実例（永山校 中3）では、英語・数学・国語は
 *   単元が載っているのに0コマで、コマが付いているのは理科・社会の3単元だけだった。
 *   そこで、コマの付いた科目があれば「コマの付いた科目・コマの付いた単元」だけを対策とみなす
 *  （科目にコマがあっても単元にコマが無ければ、その科目の単元をすべて出す）。
 * ★どの科目にもコマが無い提案書（コマ未入力のまま公開したもの）は、単元の載った科目を対策とみなす。
 */
function proposedSubjects(
  p: TestPrepProposalForInterview
): { name: string; koma: number; units: string[] }[] {
  const names = (units: { name: string; koma: number }[], onlyKoma: boolean) => {
    const picked = onlyKoma ? units.filter((u) => u.koma > 0) : units;
    return (picked.length > 0 ? picked : units).map((u) => u.name).filter((n) => n.trim() !== '');
  };
  const withKoma = p.subjects.filter((s) => s.koma > 0);
  if (withKoma.length > 0) {
    return withKoma.map((s) => ({ name: s.name, koma: s.koma, units: names(s.units, true) }));
  }
  return p.subjects
    .filter((s) => s.units.length > 0)
    .map((s) => ({ name: s.name, koma: 0, units: names(s.units, false) }));
}

/**
 * ④に出すテスト対策の行を組む。
 *
 *   テスト対策（2学期中間）数学 4コマ・英語 1コマ（増コマ申込 3コマ）
 *   → 結果 数学 64→70（+6）／英語 72
 *   対策した単元：一次関数・連立方程式・不定詞（ほか5）
 *
 * ★結果は「その試験の、その学年の」定期テストだけと突き合わせる。name_code だけで引くと、
 *   中2の2学期中間（去年）を中3の対策の結果として出してしまう（本番に去年の term2_mid が111件ある）。
 *   提案書を作った年度の学年は、今の学年から年度の差を引いて出す（4月始まり・koushuFiscalYear）。
 * ★「前回」は同じ科目の点がある、1つ前の定期テスト（学年×年度内の順番。REGULAR_TEST_ORDER）。
 * ★科目名・試験名の変換は目標の達成度と同じ表（GOAL_*）を使う。変換できない科目（高校の科目など）は
 *   結果を出さない。点の無い科目を「前回なし」と書くと、受けていないように読めるため。
 * ★結果がまだ入っていない試験は「聞くこと」に回す。ただし目標の達成度が同じ試験を
 *   すでに聞いているとき（existingAsks にその試験名が入っているとき）は重ねない。
 * ★試験の種類が付いていない提案書（本番の公開済み57件のうち15件）は、結果と突き合わせようが無いので
 *   見出しと単元だけを出す（聞くことも出さない。何の結果を聞けばよいかが分からない）。
 * ★コマも単元も無い提案書（中身が空）は飛ばす。「テスト対策（…）」とだけ出しても話せない。
 */
export function buildTestPrepLines(
  proposals: readonly TestPrepProposalForInterview[],
  assessments: readonly AssessmentWithScores[],
  studentGrade: number | null,
  today: Date,
  existingAsks: readonly string[] = []
): TestPrepLines {
  const facts: string[] = [];
  const ask: string[] = [];
  const aiLines: string[] = [];

  const regular = assessments.filter((a) => a.category === 'regular_test');
  const fiscalNow = koushuFiscalYear(today);

  const picked = [...proposals]
    .filter((p) => proposedSubjects(p).length > 0)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, MAX_TEST_PREP_PROPOSALS);

  for (const p of picked) {
    const subjects = proposedSubjects(p);
    const examLabel = p.examName ?? p.title;
    const komaText = subjects
      .filter((s) => s.koma > 0)
      .map((s) => `${s.name} ${s.koma}コマ`)
      .join('・');
    const subjectText = komaText || subjects.map((s) => s.name).join('・');
    const zoukomaText =
      p.zoukoma.status === 'applied'
        ? `増コマ申込 ${p.zoukoma.koma}コマ`
        : p.zoukoma.status === 'none'
          ? '増コマ申込なし'
          : '';
    facts.push(
      `テスト対策（${examLabel}）${subjectText}${zoukomaText ? `（${zoukomaText}）` : ''}`
    );

    // 結果の突き合わせ（その試験・その学年の定期テスト）
    const nameCode = p.examName ? GOAL_EXAM_NAME_TO_ASSESSMENT_NAME_CODE[p.examName] : undefined;
    const created = new Date(p.createdAt);
    const proposalGrade =
      studentGrade != null && !Number.isNaN(created.getTime())
        ? studentGrade - (fiscalNow - koushuFiscalYear(created))
        : null;
    const mappable = subjects
      .map((s) => ({ name: s.name, key: GOAL_SUBJECT_TO_ASSESSMENT_SUBJECT[s.name] }))
      .filter((s): s is { name: string; key: string } => !!s.key);

    let resultText = '';
    if (nameCode && proposalGrade != null && mappable.length > 0) {
      const result = regular.find((a) => a.name_code === nameCode && a.grade === proposalGrade);
      const resultKey = result ? regularTestKey(result) : null;
      const parts: string[] = [];
      if (result && resultKey != null) {
        for (const s of mappable) {
          const now = result.scores.find((x) => x.subject === s.key)?.value;
          if (now == null) continue;
          // 1つ前の定期テストで、同じ科目の点があるもの
          let prev: { key: number; value: number } | null = null;
          for (const a of regular) {
            const k = regularTestKey(a);
            if (k == null || k >= resultKey) continue;
            const v = a.scores.find((x) => x.subject === s.key)?.value;
            if (v == null) continue;
            if (!prev || k > prev.key) prev = { key: k, value: v };
          }
          if (prev) {
            const diff = now - prev.value;
            parts.push(`${s.name} ${prev.value}→${now}（${diff >= 0 ? `+${diff}` : diff}）`);
          } else {
            parts.push(`${s.name} ${now}`);
          }
        }
      }
      if (parts.length > 0) {
        resultText = parts.join('／');
        facts.push(`→ 結果 ${resultText}`);
      } else if (!existingAsks.some((t) => t.includes(examLabel))) {
        ask.push(`${examLabel}の結果を聞いて入れる`);
      }
    }

    const units = subjects.flatMap((s) => s.units);
    let unitText = '';
    if (units.length > 0) {
      const shown = units
        .slice(0, MAX_TEST_PREP_UNITS)
        .map((u) =>
          u.length > TEST_PREP_UNIT_LENGTH ? `${u.slice(0, TEST_PREP_UNIT_LENGTH)}…` : u
        );
      const rest = units.length - shown.length;
      unitText = `${shown.join('・')}${rest > 0 ? `（ほか${rest}）` : ''}`;
      facts.push(`対策した単元：${unitText}`);
    }

    aiLines.push(
      [
        `${TEST_PREP_AI_PREFIX} ${examLabel} ${subjects.map((s) => s.name).join('・')}${
          zoukomaText ? `（${zoukomaText}）` : ''
        }`,
        resultText ? `結果 ${resultText}` : '結果まだ',
        unitText ? `単元 ${unitText}` : '',
      ]
        .filter(Boolean)
        .join('／')
    );
  }

  return { facts, ask: Array.from(new Set(ask)), aiLines };
}

/* ---------- ② 週回数変更 → 変えたあとどうか ---------- */

/** 週回数変更の申込（form_responses form_type='shukaisu'）の最新1件 */
export interface ShukaisuChangeForInterview {
  createdAt: string;
  currentWeekly: number | null;
  requestedWeekly: number | null;
  /** 'YYYY-MM'（response_data.change_from）。読めなければ null */
  changeFrom: string | null;
  /** 席を用意したか（status_checks.seated） */
  seated: boolean;
}

export interface ShukaisuLines {
  /** ②塾の根拠 */
  facts: string[];
  /** ②塾の話すこと（say）・聞くこと（ask）。1件 */
  talk: { kind: 'say' | 'ask'; text: string } | null;
  /** AIの lessons に足す行（「週回数変更:」で始まる）。無ければ null */
  aiLine: string | null;
}

/** 何日前までの申込を拾うか。★半年より前の変更は、もう「変えたあと」の話ではない */
const SHUKAISU_LOOKBACK_DAYS = 183;
/** 変更後の月の集計を何か月ぶん出すか */
const SHUKAISU_MONTHS = 3;

/**
 * ②塾に出す週回数変更の行を組む。
 *
 *   週回数変更 週2→週3（9月から）実施中
 *   変更後 2026年9月（授業8日）: 宿題未提出 1回／遅刻 0回
 *
 * ★変更月が来ていれば（実施中）、変えたあとの様子を**報告**する行を話すことに立てる
 *  （教室長「変更してそのあとどうかを報告事項としてあげる」）。
 *   変更後の月の集計は、宿題・遅刻のパネルと同じ computeDisciplineMonthly の出力をそのまま使う。
 * ★まだ変更前なら、席を用意済みか（status_checks.seated）で言うことが変わる。
 *   用意済み → 「◯月から週◯で席を用意しています」と伝える／未 → 確定してよいかを聞く。
 * ★週回数が同じ（曜日・科目だけの変更）ときは「週2→週2」と書かない。
 */
export function buildShukaisuLines(
  change: ShukaisuChangeForInterview | null,
  disciplineSessions: readonly {
    session_date: string;
    homework_not_done: boolean;
    tardy: boolean;
  }[],
  today: Date
): ShukaisuLines {
  const empty: ShukaisuLines = { facts: [], talk: null, aiLine: null };
  if (!change || !change.changeFrom || !/^\d{4}-\d{2}$/.test(change.changeFrom)) return empty;
  const age = ymdDiffDays(change.createdAt.slice(0, 10), localYmd(today));
  if (Number.isNaN(age) || age > SHUKAISU_LOOKBACK_DAYS) return empty;

  const from = change.changeFrom;
  const fromLabel = monthLabel(from, today);
  const thisMonth = localYmd(today).slice(0, 7);
  const effective = from <= thisMonth;
  const a = change.currentWeekly;
  const b = change.requestedWeekly;
  const sameCount = a != null && b != null && a === b;
  const countText =
    a != null && b != null
      ? sameCount
        ? `週${b}のまま・曜日/科目の変更`
        : `週${a}→週${b}`
      : b != null
        ? `週${b}へ`
        : '内容は申込を確認';
  const statusText = effective ? '実施中' : change.seated ? '席確定' : '受付済み';

  const facts = [`週回数変更 ${countText}（${fromLabel}から）${statusText}`];
  const after = effective
    ? computeDisciplineMonthly([...disciplineSessions], SHUKAISU_MONTHS, today)
        .filter((m) => m.month >= from && m.lessonDays > 0)
        .reverse() // 変更月から順に読む
    : [];
  for (const m of after) {
    facts.push(
      `変更後 ${m.label}（授業${m.lessonDays}日）: 宿題未提出 ${m.homeworkMissedDays}回／遅刻 ${m.tardyDays}回`
    );
  }

  const target = sameCount ? '新しい曜日・科目' : b != null ? `週${b}` : '新しい通塾';
  const talk: ShukaisuLines['talk'] = effective
    ? {
        kind: 'say',
        text: sameCount
          ? '報告 ―― 曜日・科目を変えてからの様子を伝える'
          : `報告 ―― ${target}にしてからの様子を伝える`,
      }
    : change.seated
      ? { kind: 'say', text: `${fromLabel}から${target}で席を用意しています` }
      : { kind: 'ask', text: `${fromLabel}から${target}で確定してよいか確認する` };

  const afterText = after
    .map((m) => `${m.label} 授業${m.lessonDays}日・宿題未提出${m.homeworkMissedDays}回`)
    .join('、');
  const aiLine = `${SHUKAISU_AI_PREFIX} ${countText}（${fromLabel}から・${statusText}）${
    afterText ? `／変更後 ${afterText}` : ''
  }`;

  return { facts, talk, aiLine };
}

/* ---------- ④ 模試 → 結果を返せているか ---------- */

/** 模試の申込1件（受験日が確かに分かるものだけ。読み込み側で決める） */
export interface MockApplicationForInterview {
  /** 表示名（「都立Vもぎ」「9月度オープン模試」） */
  name: string;
  /** 受験日 'YYYY-MM-DD' */
  examDate: string;
}

export interface MockReturnLines {
  facts: string[];
  ask: string[];
}

/** 受験から何日たったら「まだ入っていない」と言うか。返却・入力にかかる日数の目安 */
const MOCK_RETURN_GRACE_DAYS = 7;
/** 何日前の受験まで見るか。★古い模試を今さら聞いても面談では使わない */
const MOCK_RETURN_LOOKBACK_DAYS = 90;
/** 出す件数 */
const MAX_MOCK_RETURN = 2;

/**
 * ④に出す「模試の結果がまだ入っていない」の行（教室長「模試は結果を返せてればよい」）。
 *
 * ★結果が入っていれば何も出さない。出すのは受験から7日以上たって、その月以降の模試の成績
 *  （assessments category='mock'）が1件も無いときだけ。
 * ★成績側の日付は月単位（exam_date は '2026-09-01' の形）なので、月で比べる。
 *   同じ月に別の模試の成績が入っていると「入っている」と見なして黙る。
 *   間違って黙るほうが、入っているのに「入っていない」と言うより害が小さい。
 * ★名前は模試名に月を添える（「都立Vもぎ 9月」）。名前にもう月が入っていれば足さない。
 */
export function buildMockReturnLines(
  applications: readonly MockApplicationForInterview[],
  assessments: readonly AssessmentWithScores[],
  today: Date
): MockReturnLines {
  const todayYmd = localYmd(today);
  const mockMonths = assessments
    .filter((a) => a.category === 'mock')
    .map((a) => (a.exam_date ?? a.exam_month ?? '').slice(0, 7))
    .filter((m) => /^\d{4}-\d{2}$/.test(m));

  const seen = new Set<string>();
  const facts: string[] = [];
  const ask: string[] = [];
  const sorted = [...applications].sort((a, b) => b.examDate.localeCompare(a.examDate));
  for (const app of sorted) {
    if (facts.length >= MAX_MOCK_RETURN) break;
    const days = ymdDiffDays(app.examDate, todayYmd);
    if (Number.isNaN(days) || days < MOCK_RETURN_GRACE_DAYS || days > MOCK_RETURN_LOOKBACK_DAYS) {
      continue;
    }
    const month = app.examDate.slice(0, 7);
    if (mockMonths.some((m) => m >= month)) continue;

    const m = Number(app.examDate.slice(5, 7));
    const name = app.name.includes(`${m}月`) ? app.name : `${app.name} ${m}月`;
    if (seen.has(name)) continue;
    seen.add(name);
    facts.push(`模試の申込 ―― ${name}（${fmtMonthDay(app.examDate)}受験）の結果が未入力`);
    ask.push(`${name}の結果がまだ入っていない（返却を確認）`);
  }
  return { facts, ask };
}
