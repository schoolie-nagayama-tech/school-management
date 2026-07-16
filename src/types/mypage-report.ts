/**
 * 保護者ポータル 授業報告書（Stage 4・保護者面）の共有型。
 * 正典: docs/portal-v2-requirements.md §7-4「保護者面（読み取り）」。
 *
 * ★ なぜ src/types/class-report.ts と別建てにするか:
 *   class-report.ts はスタッフ側（記入・提出・承認ワークフロー）の型で、内部運用列
 *   （status / rejection_reason / approved_by …）を含む。保護者面が見るのは
 *   限定公開ビュー portal_class_reports の列だけであり、**型の上でも内部列を持たない**
 *   ことで「うっかり内部列を参照するコードがコンパイルを通ってしまう」事故を防ぐ。
 *   DB のビューとこの型が同じ「見せる列」の定義を二重に表明している（多層防御）。
 *
 * ★ lib/mypage/* は `import 'server-only'` なのでクライアントから import できない。
 *   API の戻り値の形はサーバー/クライアントで共有したいので型だけをここに置く。
 *
 * ★ 英単語テスト（vocab_test_*）を持たない理由（確定仕様・元に戻さないこと）:
 *   「単語テストと確認テストは分けられない」という判断で、テストは確認テストに一本化された。
 *   講師フォーム（app/lesson-reports/[scheduleEntryId]）は既に確認テストしか入力させず、
 *   vocab_test_* には null しか書かない。よって保護者に出す枠を残しても永遠に空になる。
 *   DB（class_reports の列・portal_class_reports ビュー）には列が残っているが、
 *   列の削除は適用済みマイグレーションの改変になるため行わず、公開面から外すだけにする
 *   （列は死んだまま無害）。型から外しておくと「うっかり参照するコードがコンパイルを
 *   通ってしまう」事故も防げる。
 */

/** 次回までの宿題1件（class_reports.homework_assignments の要素）。 */
export interface PortalHomeworkAssignment {
  /** 'YYYY-MM-DD'。日付なしの行もありうる。 */
  date?: string | null;
  text?: string | null;
}

/**
 * 科目別欄（単語・計算・漢字の反復練習）＋プリント等自由記述。class_reports.subject_specific
 * （jsonb）の正規化後の形。kind='none' はデータの入っていない状態を表すので保持しない
 * （lib/mypage/reports.ts の normalizeSubjectSpecific が null に潰す）。
 * ただし kind='none' でも extraMaterials だけ入っていることがある（プリント自由記述は
 * kind に依らず書けるため）ので、その場合は kind='none' のまま extraMaterials だけ持つ。
 */
export interface PortalSubjectSpecific {
  kind: 'vocab' | 'calc' | 'kanji' | 'none';
  /** 練習範囲。例: 'Unit 6 単語' */
  range: string | null;
  /** ページ範囲。例: '46-49'（先頭に 'p.' は付けない・表示側で付与） */
  pages: string | null;
  /** 1日の練習回数 */
  timesPerDay: number | null;
  /** 期間。例: '1週間' */
  duration: string | null;
  /** プリント・テキスト外の教材（自由記述）。kind に依らず入りうる。 */
  extraMaterials: string | null;
}

/** 学習内容1件（教材×単元×ページ）。portal_lesson_report_units の1行。 */
export interface PortalReportUnit {
  id: string;
  /** メイン教材か（詳細画面で「メイン」バッジを出す）。 */
  isMain: boolean;
  /** 教材名（ビュー内で解決済み。ID は露出しない）。 */
  textbookName: string | null;
  /** 単元名の配列（ビュー内で解決済み。ID は露出しない）。 */
  unitTitles: string[];
  pageStart: number | null;
  pageEnd: number | null;
  displayOrder: number;
}

/** 一覧カード1件。詳細を開かなくても概況が掴める最小の情報。 */
export interface PortalReportListItem {
  id: string;
  studentId: string;
  /** 'YYYY-MM-DD' */
  lessonDate: string;
  /** コマから解決した教科名（複数ありうる）。 */
  subjectNames: string[];
  /** 限定公開ビュー portal_teacher_names 経由で解決した講師名。 */
  teacherName: string | null;
  /** 今日の目標（カードでは1行に省略表示）。 */
  shortTermGoal: string | null;
  /** カードの結果チップ用（テストは確認テストに一本化。ファイル冒頭の注記を参照）。 */
  checkTestScore: number | null;
  checkTestTotal: number | null;
  checkTestPassed: boolean | null;
  homeworkCompletionPct: number | null;
  isRead: boolean;
}

/** 詳細1件。モックのセクション2の並びに対応。 */
export interface PortalReportDetail {
  id: string;
  studentId: string;
  lessonDate: string;
  subjectNames: string[];
  teacherName: string | null;
  /** 今日の目標 */
  shortTermGoal: string | null;
  /** 試験目標（mid_term_goal_snapshot 由来。保存時に formatExamGoal で整形済み。
   *  ★ 行動目標スナップショットはビューが出さない） */
  midTermGoal: string | null;
  /** 学習内容（教材×単元×ページ） */
  units: PortalReportUnit[];
  /** 学校の進度 */
  schoolProgress: string | null;
  /** 科目別欄（単語・計算・漢字の反復練習）＋プリント等自由記述。無ければ null。 */
  subjectSpecific: PortalSubjectSpecific | null;
  /** 宿題の取り組み（3項目のバー） */
  homeworkCompletionPct: number | null;
  homeworkCorrectPct: number | null;
  todayCorrectPct: number | null;
  /** テスト（確認テストのみ。ファイル冒頭の注記を参照） */
  checkTestScore: number | null;
  checkTestTotal: number | null;
  checkTestPassed: boolean | null;
  /** 講師より（講評） */
  reviewComment: string | null;
  /** 次回までの宿題（日付ごと） */
  homeworkAssignments: PortalHomeworkAssignment[];
  isRead: boolean;
}

/** 月グルーピングされた一覧（見出し＋その月の報告書）。 */
export interface PortalReportMonthGroup {
  /** 'YYYY-MM'（キー用） */
  monthKey: string;
  /** '2026年7月'（表示用） */
  monthLabel: string;
  items: PortalReportListItem[];
}

/**
 * 一覧を月ごとにグルーピングする（新しい月が先頭・月内も新しい順）。
 *
 * ★ 純関数としてここに置く理由: 画面（クライアント）とテストの両方から使うため。
 *   lessonDate は 'YYYY-MM-DD' の文字列なので Date に変換せず前方6文字で切る
 *   （タイムゾーンで月がズレる事故を構造的に避ける）。
 */
export function groupReportsByMonth(items: PortalReportListItem[]): PortalReportMonthGroup[] {
  const groups = new Map<string, PortalReportListItem[]>();
  for (const item of items) {
    const key = item.lessonDate.slice(0, 7);
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }
  return (
    Array.from(groups.entries())
      // 月キーは 'YYYY-MM' なので辞書順の降順＝新しい月が先頭。
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([monthKey, list]) => {
        const [y, m] = monthKey.split('-');
        return {
          monthKey,
          monthLabel: `${Number(y)}年${Number(m)}月`,
          items: [...list].sort((a, b) => (a.lessonDate < b.lessonDate ? 1 : -1)),
        };
      })
  );
}
