/**
 * 授業中ポップアップの「いつ出すか」のテスト。
 *
 * ★守りたいのは3点:
 *  - 未対応0件でAIを呼ばないこと（大半の授業がこれ。費用が効くのはここ）
 *  - 期限当日・超過はAIを待たずに出すこと
 *  - 残り時間が無いときは出さないこと（生徒が帰れば意味がない）
 */
import { describe, expect, it } from 'vitest';
import {
  CUTOFF_MINUTES_BEFORE_END,
  checkpointAt,
  daysUntilDue,
  decideTiming,
  isDueTodayOrOverdue,
  type TimingInput,
} from '@/lib/bulletin/popupTiming';
import { parsePopupDecision } from '@/lib/bulletin/popupPrompt';

/** 80分授業の 1/3 ≈ 27分 / 2/3 ≈ 53分 */
const LESSON = 80;

function input(over: Partial<TimingInput> = {}): TimingInput {
  return {
    elapsedMinutes: 27,
    totalMinutes: LESSON,
    pendingCount: 1,
    alreadyShown: false,
    hasDueTodayOrOverdue: false,
    ...over,
  };
}

describe('チェックポイント', () => {
  it('1/3 のあたりで first', () => {
    expect(checkpointAt(27, LESSON)).toBe('first');
  });

  it('2/3 のあたりで second', () => {
    expect(checkpointAt(53, LESSON)).toBe('second');
  });

  it('間の時刻では照合しない', () => {
    expect(checkpointAt(40, LESSON)).toBeNull();
    expect(checkpointAt(5, LESSON)).toBeNull();
  });

  it('授業時間が0なら照合しない（0除算を作らない）', () => {
    expect(checkpointAt(10, 0)).toBeNull();
  });
});

describe('出すかどうかの判断', () => {
  /**
   * ★これが最も多いケース。冒頭で講師が自分でやった授業もここに来る。
   * AIを呼ばないので費用がゼロで済む。
   */
  it('未対応が0件ならAIを呼ばない', () => {
    expect(decideTiming(input({ pendingCount: 0 }))).toEqual({
      action: 'skip',
      reason: 'no_pending',
    });
  });

  it('1コマにつき1件だけ。出したらもう出さない', () => {
    expect(decideTiming(input({ alreadyShown: true }))).toEqual({
      action: 'skip',
      reason: 'already_shown',
    });
  });

  /** ★生徒が帰ってしまえば、生徒に聞くタイプのタスクは意味がない */
  it('残り時間が足りなければ出さない', () => {
    const late = LESSON - CUTOFF_MINUTES_BEFORE_END + 1;
    expect(decideTiming(input({ elapsedMinutes: late }))).toEqual({
      action: 'skip',
      reason: 'too_late',
    });
  });

  it('照合の時刻でなければ何もしない', () => {
    expect(decideTiming(input({ elapsedMinutes: 40 }))).toEqual({
      action: 'skip',
      reason: 'not_checkpoint',
    });
  });

  it('通常はAIに判断させる', () => {
    expect(decideTiming(input())).toEqual({ action: 'ask_ai', checkpoint: 'first' });
  });

  /** ★期限当日・超過だけはAIの判断を待たない */
  it('期限当日・超過は強制的に出す', () => {
    expect(decideTiming(input({ hasDueTodayOrOverdue: true }))).toEqual({
      action: 'force',
      checkpoint: 'first',
    });
  });

  /** 強制表示でも、残り時間と1件制限のほうが先に効く */
  it('期限当日でも、もう出していれば出さない', () => {
    expect(decideTiming(input({ hasDueTodayOrOverdue: true, alreadyShown: true })).action).toBe(
      'skip'
    );
  });

  it('期限当日でも、残り時間が無ければ出さない', () => {
    const late = LESSON - 1;
    expect(decideTiming(input({ hasDueTodayOrOverdue: true, elapsedMinutes: late })).action).toBe(
      'skip'
    );
  });

  it('期限当日でも、未対応が0件ならAIを呼ばない', () => {
    expect(decideTiming(input({ hasDueTodayOrOverdue: true, pendingCount: 0 })).action).toBe(
      'skip'
    );
  });
});

describe('期限の判定', () => {
  const today = '2026-09-04';

  it.each([
    ['2026-09-04', true],
    ['2026-09-03', true],
    ['2026-08-01', true],
  ])('%s は当日または超過', (due, expected) => {
    expect(isDueTodayOrOverdue(due, today)).toBe(expected);
  });

  it('先の日付はまだ', () => {
    expect(isDueTodayOrOverdue('2026-09-05', today)).toBe(false);
  });

  it('期限が無ければ強制表示しない', () => {
    expect(isDueTodayOrOverdue(null, today)).toBe(false);
  });
});

describe('期限までの日数', () => {
  const today = '2026-09-04';

  it('先の日付は正の数', () => {
    expect(daysUntilDue('2026-09-21', today)).toBe(17);
  });

  it('当日は0', () => {
    expect(daysUntilDue(today, today)).toBe(0);
  });

  it('超過は負の数', () => {
    expect(daysUntilDue('2026-09-01', today)).toBe(-3);
  });

  it('期限が無ければ null', () => {
    expect(daysUntilDue(null, today)).toBeNull();
  });
});

describe('AIの答えの受け取り', () => {
  it('正しい show はそのまま通る', () => {
    const got = parsePopupDecision({
      action: 'show',
      message: '演習の合間に通知表の入力をお願いします。',
      reason: '演習が一区切りついている',
    });
    expect(got.action).toBe('show');
    expect(got.message).toContain('通知表');
  });

  /**
   * ★壊れた出力で授業中にカードを出すのが、いちばん避けたい事故。
   * 読めない答えは show ではなく wait に倒す。
   */
  it('読めない答えは wait に倒す', () => {
    expect(parsePopupDecision(null).action).toBe('wait');
    expect(parsePopupDecision('show').action).toBe('wait');
    expect(parsePopupDecision({}).action).toBe('wait');
    expect(parsePopupDecision({ action: 'popup' }).action).toBe('wait');
  });

  it('show なのに文面が無ければ出さない', () => {
    expect(parsePopupDecision({ action: 'show', message: '   ' }).action).toBe('wait');
  });

  it('wait と skip では文面を持たない', () => {
    expect(parsePopupDecision({ action: 'wait', message: '出しません' }).message).toBe('');
    expect(parsePopupDecision({ action: 'skip', message: '見送り' }).message).toBe('');
  });

  it('文面が長すぎたら切る', () => {
    const got = parsePopupDecision({ action: 'show', message: 'あ'.repeat(300) });
    expect(got.message.length).toBe(120);
  });
});
