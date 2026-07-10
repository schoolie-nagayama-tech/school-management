/**
 * 個別指導の「席」占有モデル（Phase R: 1対1/1対2・45分半コマ）。
 *
 * 用語:
 *  - 席(seat): 1講師×1日付×1コマ の中の1枠。既定は max_students_per_teacher_individual(=2) 席。
 *  - 半コマ(half): 90分コマを前半(first)・後半(second)に割った単位。
 *    45分授業は片方の半コマだけ占有し、同じ席の反対側にもう1人（別の45分生徒）を順次入れられる。
 *  - ratio: 1=1対1（生徒1名で満席=席数1に縮む） / 2=1対2（既定）。
 *
 * 席数ルール（計画書 §2.8）:
 *  - 同一（講師×日付×コマ）内に ratio=1 のエントリが1つでもあれば、その講師のそのコマの
 *    実効席数は 1 に縮む（1対1は生徒1名で満席・2人目不可）。
 *  - それ以外は max_students_per_teacher_individual（既定2）が席数。
 *
 * 半コマ占有:
 *  - 全コマ(half_position=null)エントリは席の両半を占有。
 *  - 45分(half_position=first/second)エントリは片半のみ占有。前半+後半を同一席で共有できる。
 *  - ratio=1 のエントリは席を専有（同一席の反対半に他生徒を入れられない）。
 *    ※席数ルールで席数1に縮むため、実際上は「その1エントリで満席」になる。
 *
 * この関数は純粋関数。DB非依存でユニットテストする（seatOccupancy.test.ts）。
 */

/** 半コマ位置。null は全コマ（両半を占有）。 */
export type HalfPosition = 'first' | 'second' | null;

/** 席計算の入力となるエントリの最小情報。 */
export interface SeatEntryInput {
  /** 指導比率。1=1対1 / 2=1対2。未指定は 2 として扱う。 */
  ratio?: 1 | 2 | null;
  /** 占有半コマ。null=全コマ。 */
  halfPosition?: HalfPosition;
}

/**
 * 空き（プレースホルダ行として描画する残席）。
 *  - kind='full'  : 丸ごと空いた席（全コマ／前半／後半いずれも追加可）
 *  - kind='first' : ある席の前半だけ空き（後半は埋まっている）→「空席（前45）」
 *  - kind='second': ある席の後半だけ空き（前半は埋まっている）→「空席（後45）」
 */
export interface SeatVacancy {
  kind: 'full' | 'first' | 'second';
}

export interface SeatOccupancyResult {
  /** ratio=1 の存在で縮んだ後の実効席数。 */
  effectiveSeatCount: number;
  /** 1人以上が座っている席の数。 */
  usedSeatCount: number;
  /** 追加可能な空き（描画用プレースホルダの元）。 */
  vacancies: SeatVacancy[];
  /** 空きがまったく無い（満席）か。 */
  isFull: boolean;
}

/** ratio を正規化（null/未指定→2）。 */
function normalizeRatio(r: SeatEntryInput['ratio']): 1 | 2 {
  return r === 1 ? 1 : 2;
}

/**
 * エントリ群から席の占有状況を計算する。
 *
 * @param entries このコマの有効エントリ（キャンセル・振替元は呼び出し側で除外しておく）
 * @param maxSeats max_students_per_teacher_individual（既定2）
 */
export function computeSeatOccupancy(
  entries: SeatEntryInput[],
  maxSeats: number
): SeatOccupancyResult {
  const base = Math.max(1, maxSeats);
  const hasExclusive = entries.some((e) => normalizeRatio(e.ratio) === 1);
  // ratio=1 が居れば席数1に縮む。
  const effectiveSeatCount = hasExclusive ? 1 : base;

  // 種類ごとに数える。ratio=1 は half に関わらず席を専有する。
  let exclusiveCount = 0;
  let fullCount = 0;
  let firstCount = 0;
  let secondCount = 0;
  for (const e of entries) {
    if (normalizeRatio(e.ratio) === 1) {
      exclusiveCount++;
    } else if (e.halfPosition === 'first') {
      firstCount++;
    } else if (e.halfPosition === 'second') {
      secondCount++;
    } else {
      fullCount++;
    }
  }

  // 前半と後半は同一席でペアにできる。ペアにできた分は席を共有。
  const pairedSeats = Math.min(firstCount, secondCount);
  const leftoverFirst = firstCount - pairedSeats; // 後半が空いた席
  const leftoverSecond = secondCount - pairedSeats; // 前半が空いた席

  const usedSeatCount = exclusiveCount + fullCount + pairedSeats + leftoverFirst + leftoverSecond;

  const vacancies: SeatVacancy[] = [];
  // 片半だけ空いた席（順次詰めのドロップ先）。
  for (let i = 0; i < leftoverFirst; i++) vacancies.push({ kind: 'second' });
  for (let i = 0; i < leftoverSecond; i++) vacancies.push({ kind: 'first' });
  // 丸ごと空いた席。
  const emptySeats = Math.max(0, effectiveSeatCount - usedSeatCount);
  for (let i = 0; i < emptySeats; i++) vacancies.push({ kind: 'full' });

  return {
    effectiveSeatCount,
    usedSeatCount,
    vacancies,
    isFull: vacancies.length === 0,
  };
}

/**
 * 既存エントリ群に、新しい (ratio, halfPosition) のエントリを追加できるかを判定する。
 * 容量オーバー・1対1の排他を弾く。座席表の配置・登録時の容量ガードに使う。
 */
export function canPlaceEntry(
  existing: SeatEntryInput[],
  incoming: SeatEntryInput,
  maxSeats: number
): boolean {
  // 既存に 1対1 が居れば、その講師のそのコマは満席（誰も追加できない）。
  if (existing.some((e) => normalizeRatio(e.ratio) === 1)) return false;

  // 追加が 1対1 の場合：席を専有するので、既存が空のときだけ許可。
  if (normalizeRatio(incoming.ratio) === 1) {
    return existing.length === 0;
  }

  // 追加が 1対2 の場合：half に合う空きが要る。
  const occ = computeSeatOccupancy(existing, maxSeats);
  const half = incoming.halfPosition ?? null;
  if (half === null) {
    // 全コマは丸ごと空いた席が必要。
    return occ.vacancies.some((v) => v.kind === 'full');
  }
  if (half === 'first') {
    return occ.vacancies.some((v) => v.kind === 'full' || v.kind === 'first');
  }
  return occ.vacancies.some((v) => v.kind === 'full' || v.kind === 'second');
}

// ============================================================
// 実効時間帯（半コマ）の導出
// ============================================================

/** "HH:MM[:SS]" → 0時からの分。 */
function toMinutes(hhmmss: string): number {
  const s = (hhmmss ?? '').slice(0, 8);
  const [h, m] = s.split(':');
  return (parseInt(h, 10) || 0) * 60 + (parseInt(m, 10) || 0);
}

/** 分 → "HH:MM:SS"。 */
function toTimeStr(mins: number): string {
  const clamped = Math.max(0, mins);
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

/**
 * エントリ/パターンの (コマ時刻, duration_minutes, half_position) から実効時間帯を導出する。
 *
 * 現場運用の割り（要現場確認・計画書 §2.8b）:
 *  - 前半(first)  = コマ開始 〜 コマ開始 + halfLen 分
 *  - 後半(second) = コマ終了 - halfLen 分 〜 コマ終了
 *  - 全コマ(null) = コマ開始 〜 コマ終了（duration が 45 でも half 指定が無ければ全コマ扱い）
 * halfLen は duration_minutes（45想定）を使う。90分コマの半分＝45分が既定。
 *
 * duration/half がどちらも実質「全コマ」を意味する場合はコマ丸ごとを返すので、
 * 既存（半コマ非対応）の呼び出しと同じ時間帯になり挙動不変。
 */
export function computeEffectiveTimeRange(
  slotStart: string,
  slotEnd: string,
  durationMinutes: number | null | undefined,
  halfPosition: HalfPosition
): { start: string; end: string } {
  if (halfPosition !== 'first' && halfPosition !== 'second') {
    return { start: slotStart, end: slotEnd };
  }
  const startM = toMinutes(slotStart);
  const endM = toMinutes(slotEnd);
  // 半コマ長。45分授業が前提だが、コマ時刻がそれより短い場合はコマ長にクランプ。
  const halfLen = Math.min(durationMinutes ?? 45, Math.max(0, endM - startM));
  if (halfPosition === 'first') {
    return { start: slotStart, end: toTimeStr(startM + halfLen) };
  }
  return { start: toTimeStr(endM - halfLen), end: slotEnd };
}
