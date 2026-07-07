/**
 * 請求同期の純粋ロジック（billingCharged.ts）のテスト。
 *
 * 金銭に直結するため、以下の回帰を固定する:
 *  - aggregateChargedSplit: 計上済み/未計上コマ数の分離、増コマの重み付け、
 *    「計上済みが同期で消えない」不変条件、全計上判定
 *  - toJstDateString: created_at(UTC) → JST 暦日変換。JST 深夜0〜9時の回答が
 *    前の請求期間に誤計上される境界バグの回帰を防ぐ
 */
import { describe, it, expect } from 'vitest';
import {
  aggregateChargedSplit,
  aggregateOrderQuantitiesByStudent,
  computeCourseExtraSplit,
  resolveCompletedApplicationStudents,
  toJstDateString,
  type BillingResponseLike,
} from '@/lib/utils/billingCharged';

const resp = (
  linked_student_id: string | null,
  charged: boolean,
  response_data?: unknown
): BillingResponseLike => ({
  linked_student_id,
  status_checks: { charged },
  response_data,
});

describe('aggregateChargedSplit（通常フォーム: 1回答=1件）', () => {
  it('未計上のみ: charged=0 / nonCharged=total / allCharged=false', () => {
    const result = aggregateChargedSplit([resp('s1', false), resp('s1', false)], false);
    expect(result.get('s1')).toEqual({
      total: 2,
      nonCharged: 2,
      charged: 0,
      allCharged: false,
    });
  });

  it('全計上: nonCharged=0 / charged=total / allCharged=true', () => {
    const result = aggregateChargedSplit([resp('s1', true), resp('s1', true)], false);
    expect(result.get('s1')).toEqual({
      total: 2,
      nonCharged: 0,
      charged: 2,
      allCharged: true,
    });
  });

  it('計上済みと未計上の混在: 計上済み分は保持され、未計上だけが value_number に残る', () => {
    // 計上済み2 + 未計上1。同期しても計上済み(charged=2)が消えない不変条件。
    const result = aggregateChargedSplit(
      [resp('s1', true), resp('s1', true), resp('s1', false)],
      false
    );
    expect(result.get('s1')).toEqual({
      total: 3,
      nonCharged: 1,
      charged: 2,
      allCharged: false, // 1件でも未計上があれば false
    });
  });

  it('複数生徒を独立に集計する', () => {
    const result = aggregateChargedSplit(
      [resp('s1', false), resp('s2', true), resp('s2', false)],
      false
    );
    expect(result.get('s1')).toEqual({ total: 1, nonCharged: 1, charged: 0, allCharged: false });
    expect(result.get('s2')).toEqual({ total: 2, nonCharged: 1, charged: 1, allCharged: false });
  });

  it('linked_student_id が null の回答は無視する', () => {
    const result = aggregateChargedSplit([resp(null, false), resp('s1', false)], false);
    expect(result.has('s1')).toBe(true);
    expect(result.size).toBe(1);
  });

  it('status_checks が null の回答は未計上として数える', () => {
    const result = aggregateChargedSplit([{ linked_student_id: 's1', status_checks: null }], false);
    expect(result.get('s1')).toEqual({ total: 1, nonCharged: 1, charged: 0, allCharged: false });
  });

  it('生徒が初めて現れた順を Map の順序として保つ', () => {
    const result = aggregateChargedSplit(
      [resp('s2', false), resp('s1', false), resp('s2', true)],
      false
    );
    expect(Array.from(result.keys())).toEqual(['s2', 's1']);
  });
});

describe('aggregateChargedSplit（増コマ: 1回答=申込コマ数で重み付け）', () => {
  it('total_koma を重みに採用する', () => {
    const result = aggregateChargedSplit(
      [resp('s1', false, { total_koma: 3 }), resp('s1', true, { total_koma: 2 })],
      true
    );
    // total = 3 + 2 = 5, 未計上 = 3（charged=false の回答分）
    expect(result.get('s1')).toEqual({ total: 5, nonCharged: 3, charged: 2, allCharged: false });
  });

  it('total_koma 欠損時は subjects の合計にフォールバックする', () => {
    const result = aggregateChargedSplit(
      [resp('s1', false, { subjects: { math: 2, eng: 1 } })],
      true
    );
    expect(result.get('s1')).toEqual({ total: 3, nonCharged: 3, charged: 0, allCharged: false });
  });

  it('コマ数が判定できない増コマ回答は最低1コマとして数える', () => {
    const result = aggregateChargedSplit([resp('s1', true, {})], true);
    expect(result.get('s1')).toEqual({ total: 1, nonCharged: 0, charged: 1, allCharged: true });
  });

  it('通常フォームでは response_data を無視して1回答=1件で数える', () => {
    const result = aggregateChargedSplit([resp('s1', false, { total_koma: 99 })], false);
    expect(result.get('s1')?.total).toBe(1);
  });
});

describe('resolveCompletedApplicationStudents（完了申込→生徒別 school）', () => {
  it('completed のみを集約し、それ以外は無視する', () => {
    const result = resolveCompletedApplicationStudents([
      { student_id: 's1', status: 'completed', school_id: 'sc1' },
      { student_id: 's2', status: 'pending', school_id: 'sc1' },
      { student_id: 's3', status: null, school_id: 'sc1' },
    ]);
    expect(Array.from(result.keys())).toEqual(['s1']);
    expect(result.get('s1')).toBe('sc1');
  });

  it('同一生徒の複数完了申込は1件に集約する（後勝ちで school を保持）', () => {
    const result = resolveCompletedApplicationStudents([
      { student_id: 's1', status: 'completed', school_id: 'sc1' },
      { student_id: 's1', status: 'completed', school_id: 'sc2' },
    ]);
    expect(result.size).toBe(1);
    expect(result.get('s1')).toBe('sc2');
  });

  it('完了が無ければ空', () => {
    const result = resolveCompletedApplicationStudents([
      { student_id: 's1', status: 'pending', school_id: 'sc1' },
    ]);
    expect(result.size).toBe(0);
  });
});

describe('aggregateOrderQuantitiesByStudent（発注→生徒別の数量/教材名）', () => {
  const order = (
    student_id: string | null,
    quantity: number | null,
    materialName: string | null,
    school_id = 'sc1'
  ) => ({ student_id, school_id, quantity, materialName });

  it('生徒ごとに数量を合算し、教材名は重複を除いて集める', () => {
    const result = aggregateOrderQuantitiesByStudent([
      order('s1', 2, '数学ワーク'),
      order('s1', 3, '英語ワーク'),
      order('s1', 1, '数学ワーク'), // 教材名は重複除外
    ]);
    expect(result.get('s1')).toEqual({
      quantity: 6,
      school_id: 'sc1',
      textbookNames: ['数学ワーク', '英語ワーク'],
    });
  });

  it('quantity 未指定(null/0)は1として数える', () => {
    const result = aggregateOrderQuantitiesByStudent([order('s1', null, 'A'), order('s1', 0, 'B')]);
    expect(result.get('s1')?.quantity).toBe(2);
  });

  it('student_id が無い発注は無視する', () => {
    const result = aggregateOrderQuantitiesByStudent([order(null, 5, 'A'), order('s1', 1, 'B')]);
    expect(result.size).toBe(1);
    expect(result.has('s1')).toBe(true);
  });

  it('教材名が無い発注は textbookNames を空のままにする', () => {
    const result = aggregateOrderQuantitiesByStudent([order('s1', 1, null)]);
    expect(result.get('s1')).toEqual({ quantity: 1, school_id: 'sc1', textbookNames: [] });
  });

  it('school_id は最初に現れた発注のものを採用する', () => {
    const result = aggregateOrderQuantitiesByStudent([
      order('s1', 1, 'A', 'scFirst'),
      order('s1', 1, 'B', 'scSecond'),
    ]);
    expect(result.get('s1')?.school_id).toBe('scFirst');
  });
});

describe('computeCourseExtraSplit（講習増コマ→請求の計上/未計上）', () => {
  it('新規（計上済み0）: 全量が未計上に出る', () => {
    expect(computeCourseExtraSplit(0, 5)).toEqual({
      charged: 0,
      pending: 5,
      allCharged: false,
    });
  });

  it('計上済みを保持し、増えた差分だけ未計上に出す', () => {
    // 既に3計上済み、新しい合計5 → 計上済み3維持・未計上2
    expect(computeCourseExtraSplit(3, 5)).toEqual({
      charged: 3,
      pending: 2,
      allCharged: false,
    });
  });

  it('合計と計上済みが一致: 全計上（未計上0）', () => {
    expect(computeCourseExtraSplit(4, 4)).toEqual({
      charged: 4,
      pending: 0,
      allCharged: true,
    });
  });

  it('合計が計上済みを下回ると計上済みを合計まで切り下げる（意図的な挙動・要注意）', () => {
    // 既に5計上済みだが新しい合計は2 → 計上済みが2に切り下がる（3コマ分が黙って消える）
    expect(computeCourseExtraSplit(5, 2)).toEqual({
      charged: 2,
      pending: 0,
      allCharged: true,
    });
  });

  it('合計0（計上済みあり）: charged=0 かつ allCharged=false', () => {
    // 呼び出し側は total<=0 をスキップするが、純粋関数としては0を負にせず返す
    expect(computeCourseExtraSplit(3, 0)).toEqual({
      charged: 0,
      pending: 0,
      allCharged: false,
    });
  });
});

describe('toJstDateString（UTC → JST 暦日）', () => {
  it('JST 深夜(0〜9時)の回答を当日として扱う（境界バグの回帰防止）', () => {
    // UTC 2/28 20:00 = JST 3/1 05:00。素の UTC 日付だと「2/28」になり前の期間へ誤計上されていた。
    expect(toJstDateString('2026-02-28T20:00:00Z')).toBe('2026-03-01');
  });

  it('JST 00:00 ちょうど（UTC 前日15:00）を当日として扱う', () => {
    expect(toJstDateString('2026-02-28T15:00:00Z')).toBe('2026-03-01');
  });

  it('JST 23:59（UTC 当日14:59）を当日として扱う', () => {
    expect(toJstDateString('2026-02-28T14:59:59Z')).toBe('2026-02-28');
  });

  it('UTC 00:00（= JST 当日09:00）を当日として扱う', () => {
    expect(toJstDateString('2026-03-01T00:00:00Z')).toBe('2026-03-01');
  });

  it('ミリ秒・オフセット付き ISO でも JST 暦日を返す', () => {
    // UTC 3/1 14:59:59.999 = JST 3/1 23:59 → まだ 3/1
    expect(toJstDateString('2026-03-01T14:59:59.999Z')).toBe('2026-03-01');
    // +09:00 表記でも同じ絶対時刻なら同じ暦日
    expect(toJstDateString('2026-03-01T05:00:00+09:00')).toBe('2026-03-01');
  });
});
