/**
 * 枠（講師1人が同時に見るクラス）の定員を解決する純関数。
 *
 * 背景（定員の講座一本化）:
 *  個別・小集団・プログラミング（HAL）の本当の違いは「1枠あたり何人まで見るか」の数字だけ。
 *  そこで定員を special_courses.capacity に持たせ、講座に定員があればそれを優先する。
 *  講座に定員が無い（NULL）場合だけ、形態の既定値
 *  （school_class_capacity / school_formation_capacity の max_students_per_group）を使う。
 */

/** 1以上の整数かどうか（小数・0以下・NaN は「未設定」とみなす） */
function isPositiveInt(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1;
}

/**
 * 枠の定員を解決する。講座に定員があればそれが優先、無ければ形態の既定値。
 *
 * - courseCapacity が 1 以上の整数ならそれを返す
 * - null / undefined / 0以下 / 非整数 は formationDefault にフォールバック
 * - formationDefault も 1 未満（または不正値）なら 1 に切り上げる
 *   （0名の枠は作れてしまうと空カードが並ぶだけなので、必ず1名以上にする）
 */
export function resolveClassCapacity(input: {
  courseCapacity: number | null | undefined;
  formationDefault: number;
}): number {
  const { courseCapacity, formationDefault } = input;
  if (isPositiveInt(courseCapacity)) return courseCapacity;
  if (isPositiveInt(formationDefault)) return formationDefault;
  // 形態の既定値が壊れている（0・負数・小数・NaN）ときの最終防衛線
  return Math.max(1, Math.floor(Number.isFinite(formationDefault) ? formationDefault : 1) || 1);
}
