/**
 * AIの答え合わせ（ai_feedback）の値の一覧のテスト。
 *
 * ★ここで守りたいのは「verdict が数えられる形のまま残ること」。
 *   自由記述に緩めたり、ラベルの付け忘れで画面に生の値が出たりすると、
 *   何件あったのかを数えられなくなり、記録している意味が消える。
 */
import { describe, expect, it } from 'vitest';
import {
  FEEDBACK_TARGET_KINDS,
  FEEDBACK_VERDICTS,
  FEEDBACK_VERDICT_LABELS,
  isFeedbackTargetKind,
  isFeedbackVerdict,
} from '@/lib/ai/feedback';

describe('判断の一覧', () => {
  it('5つ（読み間違い・もう済んだ・追わなくていい・合っていた・その他）', () => {
    expect(FEEDBACK_VERDICTS).toHaveLength(5);
  });

  it('読み間違いが含まれる（これが集まらないとAIを直せない）', () => {
    expect(FEEDBACK_VERDICTS).toContain('misread');
  });

  it('全部の判断に画面用のラベルがある', () => {
    for (const v of FEEDBACK_VERDICTS) {
      expect(FEEDBACK_VERDICT_LABELS[v]).toBeTruthy();
    }
    expect(Object.keys(FEEDBACK_VERDICT_LABELS)).toHaveLength(FEEDBACK_VERDICTS.length);
  });
});

describe('isFeedbackVerdict', () => {
  it('一覧にある値は通る', () => {
    for (const v of FEEDBACK_VERDICTS) {
      expect(isFeedbackVerdict(v)).toBe(true);
    }
  });

  /** ★自由記述を通すと数えられなくなる */
  it('一覧に無い値は弾く', () => {
    expect(isFeedbackVerdict('読み間違い')).toBe(false);
    expect(isFeedbackVerdict('wrong')).toBe(false);
    expect(isFeedbackVerdict('')).toBe(false);
  });

  it('文字列でないものは弾く', () => {
    expect(isFeedbackVerdict(null)).toBe(false);
    expect(isFeedbackVerdict(undefined)).toBe(false);
    expect(isFeedbackVerdict(1)).toBe(false);
    expect(isFeedbackVerdict(['misread'])).toBe(false);
  });
});

describe('対象の種類', () => {
  it('いまは掲示板の依頼だけ（今後増える）', () => {
    expect(FEEDBACK_TARGET_KINDS).toContain('bulletin_task');
  });

  it('一覧に無いものは弾く', () => {
    expect(isFeedbackTargetKind('bulletin_task')).toBe(true);
    expect(isFeedbackTargetKind('bulletin_post')).toBe(false);
    expect(isFeedbackTargetKind(null)).toBe(false);
  });
});
