/**
 * 講習申込 `koma_by_subject` の正規化アクセサ。
 *
 * `koushu_enrollments.koma_by_subject` の値は歴史的に number（コマ数のみ）だったが、
 * 比率(1対1/1対2)・時間(45分/90分)・単価スナップショットを持たせるため
 * KomaSpec（オブジェクト）へ拡張した（docs/koushu-auto-allocation-spec.md §3-1・§9-2・§15-4）。
 * 本番の既存データは旧 number 形式のみだが、読み出し側で number/KomaSpec の分岐を
 * 都度書くと壊れやすいため、正規化をこのアクセサに一本化する。
 */
export interface KomaSpec {
  /** 本数。45分1本も「1コマ」と数える（残コマ計算の単位＝本数） */
  koma: number;
  /** 1対1(1) / 1対2(2)。既定2 */
  ratio: 1 | 2;
  /** 1コマの時間（分）。既定90 */
  duration: 45 | 90;
  /** 申込時点の1コマ単価（円・税込）のスナップショット */
  unitPrice?: number;
  /** 申込時点で差し引いた通常授業コマ数のスナップショット */
  regularKoma?: number;
}

/** 0以上の有限数かどうか（コマ数・単価・差引コマ数の共通バリデーション） */
function isNonNegativeFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

/**
 * koma_by_subject の1エントリを KomaSpec に正規化する。
 * 不正な値は null を返す（呼び出し側でその科目を落とす＝壊れたデータで
 * 画面全体が落ちないようにする。例外は投げない）。
 */
function normalizeOne(v: unknown): KomaSpec | null {
  // 旧形式: number そのもの。既定値（ratio=2 / duration=90）を補って正規化する。
  if (typeof v === 'number') {
    if (!isNonNegativeFiniteNumber(v)) return null;
    return { koma: v, ratio: 2, duration: 90 };
  }

  // 新形式: KomaSpec オブジェクト。配列や null はここで弾く。
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;

  const obj = v as Record<string, unknown>;
  if (!isNonNegativeFiniteNumber(obj.koma)) return null; // koma が無い/不正なら破棄

  // ratio/duration は許容値以外なら既定値に丸める（例外を投げず表示だけ守る）
  const ratio: 1 | 2 = obj.ratio === 1 || obj.ratio === 2 ? obj.ratio : 2;
  const duration: 45 | 90 = obj.duration === 45 || obj.duration === 90 ? obj.duration : 90;

  const spec: KomaSpec = { koma: obj.koma, ratio, duration };
  // 単価・差引コマ数のスナップショットは任意項目。不正値なら省略するだけで科目自体は落とさない。
  if (isNonNegativeFiniteNumber(obj.unitPrice)) spec.unitPrice = obj.unitPrice;
  if (isNonNegativeFiniteNumber(obj.regularKoma)) spec.regularKoma = obj.regularKoma;

  return spec;
}

/**
 * number（旧形式）もオブジェクト（新形式）も受け取り、科目ごとに KomaSpec へ正規化する。
 * 不正な値（null/NaN/負数/koma欠落オブジェクト等）を持つ科目は結果から除外する
 * （例外を投げない＝壊れたデータで画面全体が落ちないようにする）。
 */
export function normalizeKomaBySubject(v: unknown): Record<string, KomaSpec> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return {};

  const result: Record<string, KomaSpec> = {};
  for (const [subjectId, raw] of Object.entries(v as Record<string, unknown>)) {
    const spec = normalizeOne(raw);
    if (spec) result[subjectId] = spec;
  }
  return result;
}

/** 正規化済みマップから総コマ数（本数）を出す */
export function totalKoma(map: Record<string, KomaSpec>): number {
  return Object.values(map).reduce((sum, spec) => sum + spec.koma, 0);
}
