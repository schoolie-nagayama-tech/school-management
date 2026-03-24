import { describe, it, expect } from 'vitest';
import {
  generateStudentCSV,
  getStudentCSVTemplate,
  generateTeacherCSV,
  getTeacherCSVTemplate,
  getMockCSVTemplate,
  STUDENT_CSV_HEADERS,
  TEACHER_CSV_HEADERS,
} from '@/lib/utils/csvUtils';
import type { Student, Subject } from '@/types/database';

// テスト用の最低限のStudentオブジェクト
function makeStudent(overrides: Partial<Student & { subjects?: Subject[] }> = {}): Student & { subjects?: Subject[] } {
  return {
    id: 'student-1',
    student_code: 'S001',
    last_name: '山田',
    first_name: '太郎',
    last_name_kana: 'やまだ',
    first_name_kana: 'たろう',
    grade: 3,
    status: 'active',
    school_name: '第一中学校',
    class_name: '3-A',
    club: 'サッカー部',
    school_id: 'school-1',
    subject_other: null,
    deleted_at: null,
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
    ...overrides,
  } as Student & { subjects?: Subject[] };
}

describe('generateStudentCSV', () => {
  it('ヘッダー行と1行の生徒データを生成する', () => {
    const students = [makeStudent()];
    const csv = generateStudentCSV(students);
    const lines = csv.split('\r\n');

    expect(lines.length).toBe(2);
    // ヘッダー行
    expect(lines[0]).toContain('生徒コード');
    expect(lines[0]).toContain('姓');
    expect(lines[0]).toContain('名');
    // データ行
    expect(lines[1]).toContain('S001');
    expect(lines[1]).toContain('山田');
    expect(lines[1]).toContain('太郎');
    expect(lines[1]).toContain('在籍中');
  });

  it('在籍状況をラベルに変換する', () => {
    const csv = generateStudentCSV([makeStudent({ status: 'inactive' })]);
    expect(csv).toContain('休会');
  });

  it('退会ステータスをラベルに変換する', () => {
    const csv = generateStudentCSV([makeStudent({ status: 'withdrawn' })]);
    expect(csv).toContain('退会');
  });

  it('subjects がある場合はスラッシュ区切りで出力する', () => {
    const student = makeStudent();
    (student as Student & { subjects: Subject[] }).subjects = [
      { id: '1', name: '英語', grade_category: 'middle', sort_order: 1, duration_minutes: 50, created_at: '' } as Subject,
      { id: '2', name: '数学', grade_category: 'middle', sort_order: 2, duration_minutes: 50, created_at: '' } as Subject,
    ];
    const csv = generateStudentCSV([student]);
    expect(csv).toContain('英語/数学');
  });

  it('空の生徒配列ではヘッダー行のみ', () => {
    const csv = generateStudentCSV([]);
    const lines = csv.split('\r\n');
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain('生徒コード');
  });

  it('null フィールドは空文字として出力される', () => {
    const student = makeStudent({
      student_code: null as unknown as string,
      school_name: null,
      class_name: null,
      club: null,
    });
    const csv = generateStudentCSV([student]);
    // null は空として処理される（エラーなく生成される）
    expect(csv).toBeDefined();
  });

  it('特殊文字（カンマ）を含むフィールドはクォートされる', () => {
    const student = makeStudent({ school_name: '東京都立第一,中学校' });
    const csv = generateStudentCSV([student]);
    expect(csv).toContain('"東京都立第一,中学校"');
  });

  it('ダブルクォートを含むフィールドはエスケープされる', () => {
    const student = makeStudent({ club: 'サッカー"部"' });
    const csv = generateStudentCSV([student]);
    expect(csv).toContain('"サッカー""部"""');
  });

  it('改行を含むフィールドはクォートされる', () => {
    const student = makeStudent({ club: 'サッカー\n部' });
    const csv = generateStudentCSV([student]);
    expect(csv).toContain('"サッカー\n部"');
  });
});

describe('getStudentCSVTemplate', () => {
  it('ヘッダー行のみのCSVを返す', () => {
    const template = getStudentCSVTemplate();
    expect(template).toContain('生徒コード');
    expect(template).toContain('姓');
    expect(template).toContain('名');
    expect(template.endsWith('\r\n')).toBe(true);
  });

  it('全ヘッダーカラムを含む', () => {
    const template = getStudentCSVTemplate();
    for (const header of STUDENT_CSV_HEADERS) {
      expect(template).toContain(header);
    }
  });
});

describe('generateTeacherCSV', () => {
  it('講師データをCSVに変換する', () => {
    const teachers = [
      {
        display_name: '佐藤先生',
        email: 'sato@example.com',
        school_names: ['渋谷校', '新宿校'],
        is_active: true,
      },
    ];
    const csv = generateTeacherCSV(teachers);
    const lines = csv.split('\r\n');

    expect(lines.length).toBe(2);
    expect(lines[0]).toContain('表示名');
    expect(lines[1]).toContain('佐藤先生');
    expect(lines[1]).toContain('sato@example.com');
    expect(lines[1]).toContain('渋谷校/新宿校');
    expect(lines[1]).toContain('有効');
  });

  it('無効な講師は「無効」と表示される', () => {
    const teachers = [
      {
        display_name: '田中先生',
        email: null,
        school_names: [],
        is_active: false,
      },
    ];
    const csv = generateTeacherCSV(teachers);
    expect(csv).toContain('無効');
  });

  it('空の配列ではヘッダーのみ', () => {
    const csv = generateTeacherCSV([]);
    const lines = csv.split('\r\n');
    expect(lines.length).toBe(1);
  });
});

describe('getTeacherCSVTemplate', () => {
  it('ヘッダー行のみのCSVを返す', () => {
    const template = getTeacherCSVTemplate();
    expect(template).toContain('表示名');
    expect(template).toContain('メールアドレス');
    expect(template.endsWith('\r\n')).toBe(true);
  });
});

describe('getMockCSVTemplate', () => {
  it('模試CSVテンプレートを返す', () => {
    const template = getMockCSVTemplate();
    expect(template).toContain('テスト名');
    expect(template).toContain('試験月');
    expect(template).toContain('英語');
    expect(template).toContain('数学');
    expect(template).toContain('国語');
    expect(template).toContain('理科');
    expect(template).toContain('社会');
    expect(template).toContain('偏差値(3科)');
    expect(template).toContain('偏差値(5科)');
  });

  it('サンプルデータ行が含まれる', () => {
    const template = getMockCSVTemplate();
    expect(template).toContain('会場模試');
    expect(template).toContain('教室模試');
    expect(template).toContain('2025-06');
    expect(template).toContain('2025-07');
  });
});

describe('STUDENT_CSV_HEADERS', () => {
  it('11カラム定義されている', () => {
    expect(STUDENT_CSV_HEADERS.length).toBe(11);
  });
});

describe('TEACHER_CSV_HEADERS', () => {
  it('4カラム定義されている', () => {
    expect(TEACHER_CSV_HEADERS.length).toBe(4);
  });
});
