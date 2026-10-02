/**
 * 週の座席表を通塾日程に合わせる「差分」の計算（純関数）。
 *
 * ★ なぜ全削除→再INSERTをやめたのか（2026-10-01）:
 *   以前の generateWeeklySchedule は対象週の通常授業を全部 DELETE して作り直していた。
 *   行の id が毎回変わるため、id に ON DELETE CASCADE でぶら下がる報告書（class_reports。
 *   承認済み＝保護者に公開済みのものも含む）と授業中ポップアップの記録が黙って消え、
 *   出欠を付けたコマ（completed）も scheduled に戻っていた。
 *   再生成は座席表を開いただけ・通塾日程を保存しただけでも自動で走るので、
 *   報告書の運用を始めた瞬間に事故になる。
 *   そこで「あるべきコマ」と「今あるコマ」を突き合わせ、
 *     - 両方にある → 行を残して変わった項目だけ更新（id を保つ）
 *     - あるべきなのに無い → 追加
 *     - もう要らない → 削除
 *   の3つに分ける。報告書付き・出欠済みのコマは「凍結」として一切触らない。
 *
 * 突き合わせのキーは同期チェック（detectScheduleDrift / 座席表ページの outOfSync）と同じ
 * `日付-コマ-生徒`（plannedEntryKey）。ここを変えると「未反映」の誤検知→毎回の再生成が
 * 起きるので、キーの意味論は動かさないこと（memory: スケジュール_数え方と判定の決まり）。
 */
import { plannedEntryKey, type PlannedEntry } from './specialCourseOverride';

/** schedule_entries に書く行（generateWeeklySchedule が INSERT/UPDATE する列） */
export interface WeeklyEntryRow {
  school_id: string;
  entry_date: string;
  time_slot_id: string;
  // 担当未決定パターンも生成対象なので nullable
  teacher_id: string | null;
  student_id: string;
  subject_ids: string[];
  seat_label: string | null;
  // 通塾日程の写しなら由来パターン、通年講座の講習期上書き由来なら NULL
  regular_pattern_id: string | null;
  status: string;
  kind: 'regular' | 'koushu';
  formation: string;
  ratio: 1 | 2;
  duration_minutes: number | null;
  half_position: 'first' | 'second' | null;
}

/** 対象週に既にある行（突き合わせに要る列だけ） */
export interface ExistingWeekEntry {
  id: string;
  entry_date: string;
  time_slot_id: string;
  student_id: string | null;
  teacher_id: string | null;
  kind: string;
  status: string;
  subject_ids: string[] | null;
  seat_label: string | null;
  regular_pattern_id: string | null;
  formation: string | null;
  ratio: number | null;
  duration_minutes: number | null;
  half_position: string | null;
}

/** 差分で更新してよい列（status・日付・コマ・生徒は突き合わせのキー側なので更新しない） */
type UpdatableColumn =
  | 'teacher_id'
  | 'subject_ids'
  | 'seat_label'
  | 'regular_pattern_id'
  | 'kind'
  | 'formation'
  | 'ratio'
  | 'duration_minutes'
  | 'half_position';

export interface WeeklySyncPlan {
  inserts: WeeklyEntryRow[];
  updates: Array<{ id: string; patch: Partial<Pick<WeeklyEntryRow, UpdatableColumn>> }>;
  deleteIds: string[];
  /** あるべきコマのうち既存行と対応がついた数（凍結・無変更も含む） */
  matchedCount: number;
  /** 凍結のため残した行のうち、通塾日程からはもう期待されていないもの */
  keptFrozenCount: number;
}

/** 再生成で差し替え得る行か（通常授業かつ予定・実施済み）。それ以外は枠を占有するだけ */
export function isReplaceableEntry(e: { kind: string; status: string }): boolean {
  return e.kind === 'regular' && (e.status === 'scheduled' || e.status === 'completed');
}

/**
 * 凍結＝再生成で一切触らない行か。
 *
 * - 報告書が付いている: 行を消すと報告書が消え、講師や日付を変えると報告書の記載とずれる
 * - 出欠済み（completed）: 実際に授業があった記録。後から通塾日程を変えても事実は変わらない
 *
 * ★ 生成（planWeeklySync）とズレ検知（detectScheduleDrift の extra）の両方がこの関数を使う。
 *   片方だけ凍結を知っていると、消せない「古い行」が永久にズレとして残り、
 *   座席表を開くたびに自動再生成が空回りする。
 */
export function isFrozenEntry(
  e: { id: string; status: string },
  reportedEntryIds: ReadonlySet<string>
): boolean {
  return e.status === 'completed' || reportedEntryIds.has(e.id);
}

function existingKey(e: ExistingWeekEntry): string {
  return plannedEntryKey({
    date: e.entry_date,
    timeSlotId: e.time_slot_id,
    studentId: e.student_id ?? '',
  });
}

function toRow(schoolId: string, pe: PlannedEntry, teacherId: string | null): WeeklyEntryRow {
  return {
    school_id: schoolId,
    entry_date: pe.date,
    time_slot_id: pe.timeSlotId,
    teacher_id: teacherId,
    student_id: pe.studentId,
    subject_ids: pe.subjectIds,
    seat_label: pe.seatLabel,
    // 上書き由来のコマは通塾日程の写しではないので regular_pattern_id を持たせない
    // （ズレ検知の「余分な行」判定は regular_pattern_id 付きだけを見るため、巻き込まれない）。
    regular_pattern_id: pe.source === 'regular' ? pe.regularPatternId : null,
    status: 'scheduled',
    kind: pe.kind,
    formation: pe.formation,
    ratio: pe.ratio,
    duration_minutes: pe.durationMinutes,
    half_position: pe.halfPosition,
  };
}

function sameArray(a: readonly string[] | null, b: readonly string[]): boolean {
  const x = a ?? [];
  return x.length === b.length && x.every((v, i) => v === b[i]);
}

function diffRow(
  current: ExistingWeekEntry,
  desired: WeeklyEntryRow
): Partial<Pick<WeeklyEntryRow, UpdatableColumn>> {
  const patch: Partial<Pick<WeeklyEntryRow, UpdatableColumn>> = {};
  if ((current.teacher_id ?? null) !== desired.teacher_id) patch.teacher_id = desired.teacher_id;
  if (!sameArray(current.subject_ids, desired.subject_ids)) patch.subject_ids = desired.subject_ids;
  if ((current.seat_label ?? null) !== desired.seat_label) patch.seat_label = desired.seat_label;
  if ((current.regular_pattern_id ?? null) !== desired.regular_pattern_id) {
    patch.regular_pattern_id = desired.regular_pattern_id;
  }
  if (current.kind !== desired.kind) patch.kind = desired.kind;
  if ((current.formation ?? null) !== desired.formation) patch.formation = desired.formation;
  if ((current.ratio ?? null) !== desired.ratio) patch.ratio = desired.ratio;
  if ((current.duration_minutes ?? null) !== desired.duration_minutes) {
    patch.duration_minutes = desired.duration_minutes;
  }
  if ((current.half_position ?? null) !== desired.half_position) {
    patch.half_position = desired.half_position;
  }
  return patch;
}

export interface PlanWeeklySyncInput {
  schoolId: string;
  /** planWeeklyEntries の結果（その週にあるべきコマ） */
  planned: PlannedEntry[];
  /** 対象週の既存行すべて（kind・status を問わない） */
  existing: ExistingWeekEntry[];
  /** 報告書が付いている schedule_entries.id */
  reportedEntryIds: ReadonlySet<string>;
}

export function planWeeklySync(input: PlanWeeklySyncInput): WeeklySyncPlan {
  const { schoolId, planned, existing, reportedEntryIds } = input;

  // 差し替えない行（振替元/振替先/キャンセル、講習・追加・体験などの単発コマ）が押さえている枠。
  // ここに通常授業を作ると UNIQUE 違反や振替戻しの重複（N-4）になるので、あるべきコマから外す。
  // 同期チェックの covered（kind・status を問わず行があれば確保済み）と同じ意味論。
  const occupiedKeys = new Set<string>();
  const candidatesByKey = new Map<string, ExistingWeekEntry[]>();
  for (const e of existing) {
    const key = existingKey(e);
    if (!isReplaceableEntry(e)) {
      occupiedKeys.add(key);
      continue;
    }
    const list = candidatesByKey.get(key);
    if (list) list.push(e);
    else candidatesByKey.set(key, [e]);
  }

  const inserts: WeeklyEntryRow[] = [];
  const updates: WeeklySyncPlan['updates'] = [];
  const used = new Set<string>();
  let matchedCount = 0;

  for (const pe of planned) {
    const key = plannedEntryKey(pe);
    if (occupiedKeys.has(key)) continue;

    // 同じ枠に複数の行・複数のあるべきコマがあり得る（同コマ同生徒で講師違い）。
    // 講師が一致する行を優先して対応づけ、無ければ残っている行のどれかに対応づける。
    const candidates = (candidatesByKey.get(key) ?? []).filter((c) => !used.has(c.id));
    const match =
      (pe.teacherId ? candidates.find((c) => c.teacher_id === pe.teacherId) : undefined) ??
      candidates[0];

    if (!match) {
      inserts.push(toRow(schoolId, pe, pe.teacherId));
      continue;
    }

    used.add(match.id);
    matchedCount++;
    if (isFrozenEntry(match, reportedEntryIds)) continue;

    // 通塾日程に講師が無ければ、その行に手で割り当てた講師（「このコマだけ」割当）を残す。
    // 通塾日程に講師があればそちらで上書きする（全削除方式のときと同じ挙動。
    // 手動変更を区別する目印がまだ無いため、ここは変えていない）。
    const teacherId = pe.teacherId ?? (pe.source === 'regular' ? match.teacher_id : null);
    const patch = diffRow(match, toRow(schoolId, pe, teacherId));
    if (Object.keys(patch).length > 0) updates.push({ id: match.id, patch });
  }

  const deleteIds: string[] = [];
  let keptFrozenCount = 0;
  candidatesByKey.forEach((list) => {
    for (const e of list) {
      if (used.has(e.id)) continue;
      if (isFrozenEntry(e, reportedEntryIds)) keptFrozenCount++;
      else deleteIds.push(e.id);
    }
  });

  return { inserts, updates, deleteIds, matchedCount, keptFrozenCount };
}
