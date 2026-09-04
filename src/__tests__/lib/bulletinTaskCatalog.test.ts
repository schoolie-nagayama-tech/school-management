/**
 * 掲示板AIアシストの土台（タスクのカタログ・済判定・自動チェックの規約）のテスト。
 *
 * ここで固定したいのは3点:
 *  - 内申の済は9科すべて（換算内申で水増しされない・高校生には使わない）
 *  - 自動チェックが人の判断を上書きしないこと
 *  - 自動で付いた行を消さないこと（消すと自動が付け直してしまう）
 */
import { describe, expect, it } from 'vitest';
import {
  TASK_KINDS,
  TASK_KIND_LABELS,
  TASK_SCOPES,
  TASK_SCOPE_LABELS,
  REPORT_CARD_SUBJECTS,
  isReportCardEntered,
  isReportCardTarget,
  isTeacherSelfKind,
  missingReportCardSubjects,
} from '@/lib/bulletin/taskCatalog';
import { canAutoWrite, canDeleteOnClear } from '@/lib/bulletin/applicationSync';

describe('タスクのカタログ', () => {
  it('種別は13種で、すべてに日本語ラベルがある', () => {
    expect(TASK_KINDS).toHaveLength(13);
    for (const kind of TASK_KINDS) {
      expect(TASK_KIND_LABELS[kind]).toBeTruthy();
    }
  });

  it('対象は5種で、すべてに日本語ラベルがある', () => {
    expect(TASK_SCOPES).toHaveLength(5);
    for (const scope of TASK_SCOPES) {
      expect(TASK_SCOPE_LABELS[scope]).toBeTruthy();
    }
  });

  it('シフト・出勤簿は生徒に紐づかない', () => {
    expect(isTeacherSelfKind('shift_submit')).toBe(true);
    expect(isTeacherSelfKind('timesheet_entry')).toBe(true);
    expect(isTeacherSelfKind('report_card_entry')).toBe(false);
  });
});

describe('内申入力の済判定', () => {
  const all9 = [...REPORT_CARD_SUBJECTS];

  it('9科そろって初めて済', () => {
    expect(isReportCardEntered(all9)).toBe(true);
  });

  it('8科では済にならない', () => {
    expect(isReportCardEntered(all9.slice(0, 8))).toBe(false);
  });

  it('主要5科だけでは済にならない', () => {
    expect(isReportCardEntered(['english', 'math', 'japanese', 'social', 'science'])).toBe(false);
  });

  it('何も入っていなければ済にならない', () => {
    expect(isReportCardEntered([])).toBe(false);
  });

  /**
   * ★換算内申は科目ではない。「入力された科目数が9以上か」で数えると
   * 換算内申が混ざって水増しされ、実際は未入力の生徒が済に見えてしまう。
   */
  it('換算内申で水増しされない', () => {
    const eight = all9.slice(0, 8);
    const padded = [...eight, 'conv_5', 'conv_4', 'conv_total'];
    expect(padded.length).toBeGreaterThanOrEqual(9);
    expect(isReportCardEntered(padded)).toBe(false);
  });

  it('足りない科目を返せる（督促の文面に使う）', () => {
    expect(missingReportCardSubjects(all9)).toEqual([]);
    expect(missingReportCardSubjects(all9.slice(0, 8))).toEqual(['pe']);
  });
});

describe('内申入力の対象', () => {
  it.each([
    [7, true],
    [8, true],
    [9, true],
  ])('中学生（%i）は対象', (grade, expected) => {
    expect(isReportCardTarget(grade)).toBe(expected);
  });

  /**
   * ★高校生は科目体系がまったく違う（hs_ で始まる科目が50種近くあり履修も生徒ごとに違う）。
   * 9科の基準を当てると全員が永久に未済になる。
   */
  it.each([[10], [11], [12], [13]])('高校生・既卒（%i）は対象外', (grade) => {
    expect(isReportCardTarget(grade)).toBe(false);
  });

  it.each([[1], [6]])('小学生（%i）は対象外', (grade) => {
    expect(isReportCardTarget(grade)).toBe(false);
  });

  it('学年が未設定なら対象外', () => {
    expect(isReportCardTarget(null)).toBe(false);
    expect(isReportCardTarget(undefined)).toBe(false);
  });
});

describe('自動チェックの規約', () => {
  it('行が無ければ自動で付けてよい', () => {
    expect(canAutoWrite({ exists: false })).toBe(true);
  });

  it('前回も自動なら追随してよい', () => {
    expect(canAutoWrite({ exists: true, setBy: 'auto' })).toBe(true);
  });

  /**
   * ★これが本丸。人が付けた・外した・対象外にした、のどれであっても自動は触らない。
   * 既存の行はすべて manual（列の既定値）なので、導入時点の「対象外」が
   * 自動の「完了」で塗り替えられることはない。
   */
  it('人が触った行には二度と触らない', () => {
    expect(canAutoWrite({ exists: true, setBy: 'manual' })).toBe(false);
  });

  it('setBy が不明な既存行も触らない（安全側に倒す）', () => {
    expect(canAutoWrite({ exists: true })).toBe(false);
  });
});

describe('チェックを外すときに行を消してよいか', () => {
  /**
   * ★自動で付いた行を消すと「まだ付けていない」と区別できず、次の同期で
   * 自動が付け直してしまう。空にして manual として残す必要がある。
   */
  it('自動で付いた行は消さない', () => {
    expect(canDeleteOnClear({ exists: true, setBy: 'auto' })).toBe(false);
  });

  it('人が付けた行は従来どおり消してよい', () => {
    expect(canDeleteOnClear({ exists: true, setBy: 'manual' })).toBe(true);
  });

  it('行が無ければ何もしなくてよい', () => {
    expect(canDeleteOnClear({ exists: false })).toBe(true);
  });
});
