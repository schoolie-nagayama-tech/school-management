/**
 * AIを呼べる最低ロールの境界。
 *
 * ★ここが狂うと「押せるのに403」が戻る。実際に報告書の講評の推敲が、
 *   講師に出るのにAPIは教室長以上で、故障の文言に化けていた。
 */

import { describe, it, expect } from 'vitest';
import { AI_FEATURE_KEYS, AI_FEATURE_MIN_ROLE, canUseAiFeature } from '@/lib/ai/features';

describe('canUseAiFeature', () => {
  it('全機能に最低ロールがある（足し忘れでundefinedにしない）', () => {
    for (const key of AI_FEATURE_KEYS) {
      expect(AI_FEATURE_MIN_ROLE[key]).toBeDefined();
    }
  });

  it('講師が使えるのは「講師のAIサポート」と「生徒のまとめ」だけ', () => {
    expect(canUseAiFeature('teacher', 'teacher_assist')).toBe(true);
    expect(canUseAiFeature('teacher', 'student_digest')).toBe(true);
    expect(canUseAiFeature('teacher', 'ai_compose')).toBe(false);
    expect(canUseAiFeature('teacher', 'plan_theme')).toBe(false);
    expect(canUseAiFeature('teacher', 'today_plan')).toBe(false);
    expect(canUseAiFeature('teacher', 'parent_message')).toBe(false);
  });

  it('教室長以上はすべて使える', () => {
    for (const role of ['manager', 'owner', 'admin']) {
      for (const key of AI_FEATURE_KEYS) {
        expect(canUseAiFeature(role, key)).toBe(true);
      }
    }
  });

  it('保護者・未設定はどれも使えない', () => {
    for (const key of AI_FEATURE_KEYS) {
      expect(canUseAiFeature('parent', key)).toBe(false);
      expect(canUseAiFeature(null, key)).toBe(false);
      expect(canUseAiFeature(undefined, key)).toBe(false);
    }
  });
});
