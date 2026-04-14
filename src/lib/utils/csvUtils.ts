/**
 * CSV入出力ユーティリティ
 * - UTF-8 with BOM (Excel対応)
 * - papaparse によるロバストなCSVパース
 */
import Papa from 'papaparse';
import type { Student, Subject, AssessmentWithScores, StudentInterview } from '@/types/database';
import {
  ASSESSMENT_CATEGORY_LABELS,
  ASSESSMENT_NAME_LABELS,
  INTERVIEW_TYPE_LABELS,
} from '@/types/database';

// ─────────────────────────────────────────────
// 共通: ダウンロード
// ─────────────────────────────────────────────

/** UTF-8 BOM付きCSV文字列をファイルとしてダウンロードする */
export function downloadCSV(content: string, filename: string): void {
  const BOM = '\uFEFF';
  const blob = new Blob([BOM + content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** フィールド値をCSVセルに変換（特殊文字をエスケープ） */
function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  // カンマ・ダブルクォート・改行を含む場合はクォートで囲む
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** 1行分の CSV 行文字列を生成 */
function csvRow(cells: (string | number | boolean | null | undefined)[]): string {
  return cells.map(csvCell).join(',');
}

// ─────────────────────────────────────────────
// 生徒CSV
// ─────────────────────────────────────────────

export const STUDENT_CSV_HEADERS = [
  '生徒コード',
  '姓',
  '名',
  '姓（かな）',
  '名（かな）',
  '学年',
  '在籍状況',
  '学校名',
  'クラス',
  '部活',
  '受講科目',
] as const;

const STATUS_LABELS: Record<string, string> = {
  active: '在籍中',
  inactive: '休会',
  withdrawn: '退会',
};

const STATUS_VALUES: Record<string, string> = {
  在籍中: 'active',
  休会: 'inactive',
  退会: 'withdrawn',
  active: 'active',
  inactive: 'inactive',
  withdrawn: 'withdrawn',
};

/**
 * 生徒一覧から CSV文字列を生成（subjects フィールドを含む）
 */
export function generateStudentCSV(
  students: (Student & { subjects?: Subject[] })[]
): string {
  const rows = [
    csvRow([...STUDENT_CSV_HEADERS]),
    ...students.map((s) => {
      const subjectNames = (s.subjects || []).map((sub) => sub.name).join('/');
      return csvRow([
        s.student_code,
        s.last_name,
        s.first_name,
        s.last_name_kana,
        s.first_name_kana,
        s.grade,
        STATUS_LABELS[s.status] ?? s.status,
        s.school_name,
        s.class_name,
        s.club,
        subjectNames,
      ]);
    }),
  ];
  return rows.join('\r\n');
}

/** 生徒CSVテンプレート（ヘッダー行のみ） */
export function getStudentCSVTemplate(): string {
  return csvRow([...STUDENT_CSV_HEADERS]) + '\r\n';
}

// ─────────────────────────────────────────────
// 生徒CSVインポート
// ─────────────────────────────────────────────

export interface StudentCSVRow {
  rowIndex: number; // 元のCSV行番号（1-based, ヘッダー除く）
  student_code: string | null;
  last_name: string;
  first_name: string;
  last_name_kana: string;
  first_name_kana: string;
  grade: number;
  status: 'active' | 'inactive' | 'withdrawn';
  school_name: string | null;
  class_name: string | null;
  club: string | null;
  subject_names: string[]; // 「/」区切りで分割された科目名
  errors: string[]; // バリデーションエラー一覧
}

/**
 * CSVファイルをパースして生徒行配列を返す
 */
export function parseStudentCSV(file: File): Promise<StudentCSVRow[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<string[]>(file, {
      skipEmptyLines: true,
      complete: (results) => {
        const rawRows = results.data;
        if (rawRows.length === 0) {
          reject(new Error('CSVファイルが空です'));
          return;
        }

        // ヘッダー行をスキップ（最初の行がヘッダーかどうかを確認）
        const firstRow = rawRows[0];
        const isHeader =
          firstRow[0] === '生徒コード' ||
          firstRow[1] === '姓' ||
          firstRow[0] === 'student_code';
        const dataRows = isHeader ? rawRows.slice(1) : rawRows;

        const parsed: StudentCSVRow[] = dataRows.map((cols, i) => {
          const errors: string[] = [];

          const student_code = cols[0]?.trim() || null;
          const last_name = cols[1]?.trim() ?? '';
          const first_name = cols[2]?.trim() ?? '';
          const last_name_kana = cols[3]?.trim() ?? '';
          const first_name_kana = cols[4]?.trim() ?? '';
          const gradeRaw = cols[5]?.trim() ?? '';
          const statusRaw = cols[6]?.trim() ?? '';
          const school_name = cols[7]?.trim() || null;
          const class_name = cols[8]?.trim() || null;
          const club = cols[9]?.trim() || null;
          const subjectsRaw = cols[10]?.trim() ?? '';

          // 必須チェック
          if (!last_name) errors.push('姓が空です');
          if (!first_name) errors.push('名が空です');
          if (!last_name_kana) errors.push('姓（かな）が空です');
          if (!first_name_kana) errors.push('名（かな）が空です');

          // 学年チェック
          const grade = parseInt(gradeRaw, 10);
          if (!gradeRaw || isNaN(grade) || grade < 1 || grade > 13) {
            errors.push(`学年が無効です（1〜13の数値を入力してください）: "${gradeRaw}"`);
          }

          // 在籍状況
          const statusMapped = STATUS_VALUES[statusRaw] as 'active' | 'inactive' | 'withdrawn' | undefined;
          const status: 'active' | 'inactive' | 'withdrawn' =
            statusMapped ?? 'active';
          if (statusRaw && !statusMapped) {
            errors.push(
              `在籍状況が無効です（在籍中/休会/退会）: "${statusRaw}"`
            );
          }

          // 科目名
          const subject_names = subjectsRaw
            ? subjectsRaw
                .split('/')
                .map((s) => s.trim())
                .filter(Boolean)
            : [];

          return {
            rowIndex: i + 1,
            student_code,
            last_name,
            first_name,
            last_name_kana,
            first_name_kana,
            grade: isNaN(grade) ? 1 : grade,
            status,
            school_name,
            class_name,
            club,
            subject_names,
            errors,
          };
        });

        resolve(parsed);
      },
      error: (err) => {
        reject(new Error(`CSVの解析に失敗しました: ${err.message}`));
      },
    });
  });
}

// ─────────────────────────────────────────────
// 講師CSV
// ─────────────────────────────────────────────

export const TEACHER_CSV_HEADERS = [
  '表示名',
  'メールアドレス（ログインID）',
  '担当教室',
  '状態',
] as const;

export interface TeacherExportRow {
  display_name: string | null;
  email: string | null;
  school_names: string[]; // 担当教室名の一覧
  is_active: boolean;
}

/**
 * 講師一覧から CSV文字列を生成
 */
export function generateTeacherCSV(teachers: TeacherExportRow[]): string {
  const rows = [
    csvRow([...TEACHER_CSV_HEADERS]),
    ...teachers.map((t) =>
      csvRow([
        t.display_name,
        t.email,
        t.school_names.join('/'),
        t.is_active ? '有効' : '無効',
      ])
    ),
  ];
  return rows.join('\r\n');
}

/** 講師CSVインポート用ヘッダー（新仕様） */
export const TEACHER_IMPORT_CSV_HEADERS = [
  '表示名',
  'メールアドレス（任意）',
  'パスワード（任意）',
  '担当教室（教室コード、複数は/区切り）',
  '指導科目（科目名、複数は/区切り）',
  '出勤可能曜日（日月火水木金土のうち複数は/区切り）',
  '状態（有効/無効、省略時は有効）',
] as const;

/** 講師CSVテンプレート（ヘッダー行 + サンプル1行） */
export function getTeacherCSVTemplate(): string {
  const sample = [
    '山田 太郎',
    'taro@example.com',
    '',
    'SCH001/SCH002',
    '英語/数学',
    '月/水/金',
    '有効',
  ];
  return csvRow([...TEACHER_IMPORT_CSV_HEADERS]) + '\r\n' + csvRow(sample) + '\r\n';
}

// ─────────────────────────────────────────────
// 講師CSVインポート
// ─────────────────────────────────────────────

export interface TeacherCSVRow {
  rowIndex: number;
  display_name: string;
  email: string | null;
  password: string | null;
  /** 生の担当教室文字列（コードまたは名前。/区切り） */
  school_codes_raw: string[];
  /** 生の指導科目名（/区切り） */
  subject_names_raw: string[];
  /** 出勤可能曜日（0=日〜6=土） */
  available_days_of_week: number[] | null;
  /** true=有効、false=無効 */
  is_active: boolean;
  errors: string[];
}

const DAY_OF_WEEK_MAP: Record<string, number> = {
  '日': 0, '月': 1, '火': 2, '水': 3, '木': 4, '金': 5, '土': 6,
  '日曜': 0, '月曜': 1, '火曜': 2, '水曜': 3, '木曜': 4, '金曜': 5, '土曜': 6,
};

function splitMulti(value: string): string[] {
  return value
    .split(/[\/／,，、]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * CSVファイルをパースして講師行配列を返す
 */
export function parseTeacherCSV(file: File): Promise<TeacherCSVRow[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<string[]>(file, {
      skipEmptyLines: true,
      complete: (results) => {
        const rawRows = results.data;
        if (rawRows.length === 0) {
          reject(new Error('CSVファイルが空です'));
          return;
        }

        // ヘッダー行スキップ判定
        const firstRow = rawRows[0];
        const isHeader =
          firstRow[0] === '表示名' ||
          firstRow[0] === 'display_name' ||
          firstRow[0] === '名前';
        const dataRows = isHeader ? rawRows.slice(1) : rawRows;

        const parsed: TeacherCSVRow[] = dataRows.map((cols, i) => {
          const errors: string[] = [];
          const display_name = cols[0]?.trim() ?? '';
          const emailRaw = cols[1]?.trim() ?? '';
          const passwordRaw = cols[2]?.trim() ?? '';
          const schoolsRaw = cols[3]?.trim() ?? '';
          const subjectsRaw = cols[4]?.trim() ?? '';
          const daysRaw = cols[5]?.trim() ?? '';
          const statusRaw = cols[6]?.trim() ?? '';

          if (!display_name) errors.push('表示名が空です');

          // 曜日パース
          let available_days_of_week: number[] | null = null;
          if (daysRaw) {
            const days: number[] = [];
            for (const d of splitMulti(daysRaw)) {
              const n = DAY_OF_WEEK_MAP[d];
              if (n === undefined) {
                errors.push(`曜日「${d}」が認識できません`);
              } else if (!days.includes(n)) {
                days.push(n);
              }
            }
            available_days_of_week = days.length > 0 ? days : null;
          }

          // 状態パース
          let is_active = true;
          if (statusRaw) {
            if (statusRaw === '無効' || statusRaw === 'false' || statusRaw === '0') {
              is_active = false;
            } else if (statusRaw !== '有効' && statusRaw !== 'true' && statusRaw !== '1') {
              errors.push(`状態「${statusRaw}」は「有効」または「無効」を指定してください`);
            }
          }

          return {
            rowIndex: i + 1,
            display_name,
            email: emailRaw || null,
            password: passwordRaw || null,
            school_codes_raw: splitMulti(schoolsRaw),
            subject_names_raw: splitMulti(subjectsRaw),
            available_days_of_week,
            is_active,
            errors,
          };
        });

        resolve(parsed);
      },
      error: (err) => {
        reject(new Error(`CSVの解析に失敗しました: ${err.message}`));
      },
    });
  });
}

// ─────────────────────────────────────────────
// 成績CSV（assessments + assessment_scores）
// ─────────────────────────────────────────────

/** 成績CSVの科目カラム定義（全カテゴリ共通）*/
const ASSESSMENT_SUBJECT_COLUMNS = [
  { code: 'english',   label: '英語' },
  { code: 'math',      label: '数学' },
  { code: 'japanese',  label: '国語' },
  { code: 'social',    label: '社会' },
  { code: 'science',   label: '理科' },
  { code: 'music',     label: '音楽' },
  { code: 'art',       label: '美術' },
  { code: 'tech_home', label: '技術・家庭' },
  { code: 'pe',        label: '保健体育' },
  { code: 'hensa_3',   label: '偏差値(3科)' },
  { code: 'hensa_5',   label: '偏差値(5科)' },
] as const;

/**
 * 生徒一覧 + 成績Mapから CSV文字列を生成
 * 1行 = 1 assessment（成績1テスト）
 */
export function generateAssessmentCSV(
  students: (Student & { subjects?: Subject[] })[],
  assessmentsByStudent: Map<string, AssessmentWithScores[]>
): string {
  const subjectLabels = ASSESSMENT_SUBJECT_COLUMNS.map((s) => s.label);
  const header = csvRow([
    '生徒コード', '生徒名', '学年', 'テスト種別', 'テスト名', '試験月',
    ...subjectLabels,
  ]);

  const dataRows: string[] = [];
  for (const student of students) {
    const assessments = assessmentsByStudent.get(student.id);
    if (!assessments || assessments.length === 0) continue;

    const studentName = `${student.last_name} ${student.first_name}`;

    for (const assessment of assessments) {
      // scores 配列を subject→value の Map に変換
      const scoreMap = new Map<string, number | null>(
        assessment.scores.map((s) => [s.subject, s.value])
      );

      const categoryLabel =
        ASSESSMENT_CATEGORY_LABELS[assessment.category] ?? assessment.category;
      const testNameLabel =
        ASSESSMENT_NAME_LABELS[assessment.name_code] ?? assessment.name_code;
      const examMonth = assessment.exam_month
        ? assessment.exam_month.slice(0, 7) // YYYY-MM
        : '';

      const subjectValues = ASSESSMENT_SUBJECT_COLUMNS.map((s) => {
        const v = scoreMap.get(s.code);
        return v !== undefined && v !== null ? v : '';
      });

      dataRows.push(
        csvRow([
          student.student_code,
          studentName,
          student.grade,
          categoryLabel,
          testNameLabel,
          examMonth,
          ...subjectValues,
        ])
      );
    }
  }

  return [header, ...dataRows].join('\r\n');
}

// ─────────────────────────────────────────────
// 面談記録CSV（student_interviews）
// ─────────────────────────────────────────────

/**
 * 生徒一覧 + 面談記録Mapから CSV文字列を生成
 * 1行 = 1 interview（面談記録1件）
 */
export function generateInterviewCSV(
  students: (Student & { subjects?: Subject[] })[],
  interviewsByStudent: Map<string, StudentInterview[]>
): string {
  const header = csvRow([
    '生徒コード', '生徒名', '学年', '面談日', '面談タイプ', '内容', 'タスク完了', '完了日時',
  ]);

  const dataRows: string[] = [];
  for (const student of students) {
    const interviews = interviewsByStudent.get(student.id);
    if (!interviews || interviews.length === 0) continue;

    const studentName = `${student.last_name} ${student.first_name}`;

    for (const interview of interviews) {
      const typeLabel =
        INTERVIEW_TYPE_LABELS[interview.interview_type as keyof typeof INTERVIEW_TYPE_LABELS]
        ?? interview.interview_type;
      const completed = interview.is_completed ? '完了' : '';
      const completedAt = interview.completed_at
        ? interview.completed_at.slice(0, 16).replace('T', ' ')
        : '';

      dataRows.push(
        csvRow([
          student.student_code,
          studentName,
          student.grade,
          interview.interview_date,
          typeLabel,
          interview.content, // csvCell() が改行・カンマを自動エスケープ
          completed,
          completedAt,
        ])
      );
    }
  }

  return [header, ...dataRows].join('\r\n');
}

// ─────────────────────────────────────────────
// 模試成績CSVインポート
// ─────────────────────────────────────────────

const MOCK_NAME_MAP: Record<string, string> = {
  '会場模試': 'venue',
  '教室模試': 'classroom',
  venue: 'venue',
  classroom: 'classroom',
};

export interface MockCsvRow {
  rowIndex: number;
  name_code: string;
  exam_month: string;
  scores: Record<string, number | null>;
  errors: string[];
}

export function getMockCSVTemplate(): string {
  return 'テスト名,試験月,英語,数学,国語,理科,社会,偏差値(3科),偏差値(5科)\r\n会場模試,2025-06,72,85,68,77,81,58.3,62.1\r\n教室模試,2025-07,75,80,70,73,78,56.5,60.8';
}

export function parseMockCSV(file: File): Promise<MockCsvRow[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      encoding: 'UTF-8',
      complete(results) {
        const rows: MockCsvRow[] = [];
        for (let i = 0; i < results.data.length; i++) {
          const raw = results.data[i];
          const errors: string[] = [];

          const rawName = (raw['テスト名'] ?? '').trim();
          const name_code = MOCK_NAME_MAP[rawName] ?? '';
          if (!name_code) errors.push(`テスト名「${rawName}」は無効です（会場模試 or 教室模試）`);

          const exam_month = (raw['試験月'] ?? '').trim();
          if (!/^\d{4}-\d{2}$/.test(exam_month)) errors.push(`試験月「${exam_month}」はYYYY-MM形式で入力してください`);

          const scores: Record<string, number | null> = {};
          const subjectMap: [string, string][] = [
            ['英語', 'english'],
            ['数学', 'math'],
            ['国語', 'japanese'],
            ['理科', 'science'],
            ['社会', 'social'],
            ['偏差値(3科)', 'hensa_3'],
            ['偏差値(5科)', 'hensa_5'],
          ];
          for (const [csvKey, dbKey] of subjectMap) {
            const val = (raw[csvKey] ?? '').trim();
            if (val === '') {
              scores[dbKey] = null;
            } else {
              const num = parseFloat(val);
              if (isNaN(num)) {
                errors.push(`${csvKey}「${val}」は数値で入力してください`);
                scores[dbKey] = null;
              } else {
                scores[dbKey] = num;
              }
            }
          }

          rows.push({ rowIndex: i + 2, name_code, exam_month, scores, errors });
        }
        resolve(rows);
      },
      error(err) {
        reject(new Error(`CSVの読み込みに失敗しました: ${err.message}`));
      },
    });
  });
}
