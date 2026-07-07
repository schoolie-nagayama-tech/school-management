/**
 * 請求同期（フォーム回答 → student_billings）の純粋ロジック。
 *
 * DB アクセスを伴う billing.ts の sync 関数から、計算部分だけを切り出して
 * 単体テスト可能にしたもの。金銭に直結するため回帰テストで固定する。
 */
import { zoukomaKomaCount } from '@/lib/utils/zoukomaKoma';

/** 集計対象の回答（billing.ts の sync 関数が取得する形に対応） */
export type BillingResponseLike = {
  linked_student_id: string | null;
  status_checks: Record<string, boolean> | null;
  response_data?: unknown;
};

/** 生徒1人分の計上済み/未計上コマ数の内訳 */
export type StudentChargedSplit = {
  /** 全コマ数（計上済み + 未計上） */
  total: number;
  /** 未計上コマ数（value_number に入る） */
  nonCharged: number;
  /** 計上済みコマ数（quantity に入る）= total - nonCharged */
  charged: number;
  /** 全て計上済みか（is_billed に入る）。total が 0 のときは false */
  allCharged: boolean;
};

/**
 * フォーム回答を生徒ごとに集計し、計上済み/未計上コマ数に分ける。
 *
 * - 増コマ(zoukoma)は「1回答 = 申込コマ数(zoukomaKomaCount)」、それ以外は「1回答 = 1件」で重み付け。
 * - status_checks.charged が真の回答を「計上済み」とみなし、それ以外を未計上に数える。
 * - linked_student_id が無い回答は無視する。
 *
 * value_number(未計上) と quantity(計上済み) を分けて持つことで、同期しても計上済み分が
 * 消えず「✓計上 N」を残したまま新規分だけ別表示できる（計上済みが0に潰れる問題の対策）。
 *
 * 戻り値の Map は、生徒が allResponses に初めて現れた順を保つ（呼び出し側の処理順を安定させる）。
 */
export function aggregateChargedSplit(
  responses: BillingResponseLike[],
  isZoukoma: boolean
): Map<string, StudentChargedSplit> {
  const weightOf = (resp: { response_data?: unknown }): number =>
    isZoukoma ? zoukomaKomaCount(resp.response_data) : 1;

  const totalByStudent = new Map<string, number>();
  const nonChargedByStudent = new Map<string, number>();

  for (const resp of responses) {
    if (!resp.linked_student_id) continue;
    const weight = weightOf(resp);
    totalByStudent.set(
      resp.linked_student_id,
      (totalByStudent.get(resp.linked_student_id) || 0) + weight
    );
    const sc = resp.status_checks || {};
    if (!sc.charged) {
      nonChargedByStudent.set(
        resp.linked_student_id,
        (nonChargedByStudent.get(resp.linked_student_id) || 0) + weight
      );
    }
  }

  const result = new Map<string, StudentChargedSplit>();
  for (const [studentId, total] of Array.from(totalByStudent.entries())) {
    const nonCharged = nonChargedByStudent.get(studentId) || 0;
    const charged = total - nonCharged;
    result.set(studentId, {
      total,
      nonCharged,
      charged,
      allCharged: nonCharged === 0 && total > 0,
    });
  }
  return result;
}

/**
 * UTC の ISO タイムスタンプ(created_at)を JST(+9h) の暦日(YYYY-MM-DD)に変換する。
 *
 * DB セッションTZが UTC のため、請求期間(JSTカレンダー日)の境界比較と一致させるには、
 * created_at をこの関数で JST 暦日に直してから期間を引き当てる必要がある。素の UTC 日付で
 * 引くと、JST 深夜0〜9時の回答が前日扱いになり1つ前の請求期間に誤計上される。
 */
export function toJstDateString(iso: string): string {
  return new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000).toISOString().split('T')[0];
}
