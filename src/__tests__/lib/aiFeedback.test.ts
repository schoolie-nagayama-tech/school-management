/**
 * AIの答え合わせ（ai_feedback）の値の一覧のテスト。
 *
 * ★ここで守りたいのは「verdict が数えられる形のまま残ること」。
 *   自由記述に緩めたり、ラベルの付け忘れで画面に生の値が出たりすると、
 *   何件あったのかを数えられなくなり、記録している意味が消える。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FEEDBACK_TARGET_KINDS,
  FEEDBACK_VERDICTS,
  FEEDBACK_VERDICTS_BY_FEATURE,
  FEEDBACK_VERDICT_LABELS,
  isFeedbackTargetKind,
  isFeedbackVerdict,
  isVerdictForFeature,
  MAX_FEEDBACK_BATCH,
  recordAiFeedbackBatch,
  type AiFeedbackInput,
} from '@/lib/ai/feedback';
import { AI_FEATURE_KEYS } from '@/lib/ai/features';

// ★fetchWithAuth は動的 import される。ここを差し替えて、送った中身を見る
const fetchWithAuth = vi.fn();
vi.mock('@/lib/api/auth', () => ({
  fetchWithAuth: (...args: unknown[]) => fetchWithAuth(...args),
}));

describe('判断の一覧', () => {
  it('9つ（読み取り3・まとめ2・生成3・その他）', () => {
    expect(FEEDBACK_VERDICTS).toHaveLength(9);
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
  it('答え合わせの入口があるものが揃っている', () => {
    for (const kind of [
      'bulletin_task',
      'bulletin_post',
      'seasonal_proposal',
      'student_textbook',
      'student',
    ]) {
      expect(FEEDBACK_TARGET_KINDS).toContain(kind);
    }
  });

  it('一覧に無いものは弾く', () => {
    expect(isFeedbackTargetKind('bulletin_task')).toBe(true);
    expect(isFeedbackTargetKind('seasonal_course')).toBe(false);
    expect(isFeedbackTargetKind(null)).toBe(false);
  });
});

/**
 * ★機能ごとの語彙。ここが崩れると、画面のチップとAPIの検証が食い違って
 *   「押したのに記録されない」が黙って起きる。
 */
describe('機能ごとの判断の一覧', () => {
  it('すべてのAI機能に一覧がある（作り忘れると画面が何も出せない）', () => {
    for (const key of AI_FEATURE_KEYS) {
      expect(FEEDBACK_VERDICTS_BY_FEATURE[key]).toBeDefined();
    }
    expect(Object.keys(FEEDBACK_VERDICTS_BY_FEATURE)).toHaveLength(AI_FEATURE_KEYS.length);
  });

  it('載っている判断はすべて有効な値', () => {
    for (const key of AI_FEATURE_KEYS) {
      for (const v of FEEDBACK_VERDICTS_BY_FEATURE[key]) {
        expect(isFeedbackVerdict(v)).toBe(true);
      }
    }
  });

  it('機能ごとに聞くことが違う（読み取りは解釈・生成は使えたか・まとめは合っていたか）', () => {
    expect(FEEDBACK_VERDICTS_BY_FEATURE.teacher_assist).toContain('misread');
    expect(FEEDBACK_VERDICTS_BY_FEATURE.ai_compose).toContain('used_as_is');
    expect(FEEDBACK_VERDICTS_BY_FEATURE.student_digest).toEqual(['ok', 'off']);
    // ★入口を作っていない機能は空（ボタンだけ先に置かない）
    expect(FEEDBACK_VERDICTS_BY_FEATURE.today_plan).toHaveLength(0);
    expect(FEEDBACK_VERDICTS_BY_FEATURE.parent_message).toHaveLength(0);
  });

  it('その機能で使わない判断は弾く', () => {
    expect(isVerdictForFeature('ai_compose', 'used_as_is')).toBe(true);
    // 下書きに「読み間違い」は無い（あると機能ごとの件数が意味を失う）
    expect(isVerdictForFeature('ai_compose', 'misread')).toBe(false);
    expect(isVerdictForFeature('plan_theme', 'edited')).toBe(false);
    expect(isVerdictForFeature('today_plan', 'ok')).toBe(false);
    expect(isVerdictForFeature('student_digest', 'unknown')).toBe(false);
  });
});

describe('recordAiFeedbackBatch', () => {
  beforeEach(() => {
    fetchWithAuth.mockReset();
    fetchWithAuth.mockResolvedValue({ ok: true });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const item = (i: number): AiFeedbackInput => ({
    schoolId: '00000000-0000-4000-8000-000000000001',
    feature: 'ai_compose',
    targetKind: 'bulletin_post',
    verdict: 'used_as_is',
    aiOutput: { i },
  });

  /** ★空のリクエストで往復しない */
  it('0件なら送らない', async () => {
    await recordAiFeedbackBatch([]);
    expect(fetchWithAuth).not.toHaveBeenCalled();
  });

  it('1回のリクエストにまとめて送る', async () => {
    await recordAiFeedbackBatch([item(1), item(2)]);
    expect(fetchWithAuth).toHaveBeenCalledTimes(1);
    const [url, init] = fetchWithAuth.mock.calls[0] as [string, { body: string }];
    expect(url).toBe('/api/ai/feedback');
    expect(JSON.parse(init.body).items).toHaveLength(2);
  });

  /** ★上限を超えたぶんは捨てる（APIも同じ数で切るので送っても入らない） */
  it('上限で切る', async () => {
    const many = Array.from({ length: MAX_FEEDBACK_BATCH + 20 }, (_, i) => item(i));
    await recordAiFeedbackBatch(many);
    const [, init] = fetchWithAuth.mock.calls[0] as [string, { body: string }];
    expect(JSON.parse(init.body).items).toHaveLength(MAX_FEEDBACK_BATCH);
  });

  /** ★記録の失敗で本体の操作を止めない */
  it('通信が失敗しても投げない', async () => {
    fetchWithAuth.mockRejectedValue(new Error('network'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(recordAiFeedbackBatch([item(1)])).resolves.toBeUndefined();
  });
});
