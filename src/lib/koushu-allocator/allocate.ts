/**
 * 講習 自動コマ割り — アロケータ本体（純粋関数・DB非依存）
 *
 * 正典仕様: docs/koushu-auto-allocation-spec.md §5
 *
 * 方式: 貪欲（制約の強い順）＋リペア1パス。
 *  - 生徒は「可能枠が少ない順 → 残本数が多い順」で処理（CSP の定石。順序依存を緩和）
 *  - 生徒内は科目ラウンドロビン（特定科目が枠を食い尽くすのを防ぐ）
 *  - 席の判定は seatOccupancy.ts（canPlaceEntry / computeSeatOccupancy）を唯一の正として使う
 *    ＝1対1の排他・45分の前半/後半ペアリングをここで再実装しない
 *  - スコアは内部のみ（UI非表示）。決定は「ハード制約で絞る → スコア最大のセルを採る」
 *
 * 決定性: Math.random / Date.now を使わない。同じ入力からは常に同じ出力（テスト可能性）。
 */

import { canPlaceEntry, computeSeatOccupancy, type SeatEntryInput, type HalfPosition } from '@/lib/utils/seatOccupancy';
import type {
  AllocatorInput,
  AllocatorResult,
  Assignment,
  CellKey,
  TaskDef,
  UnassignedReason,
  UnassignedTask,
} from './types';

// ============================================================
// 内部スコアの重み（暫定値・UIには出さない）
// ============================================================
/**
 * すべて暫定値。実運用しながら調整する前提でここに集約する（マジックナンバーを散らさない）。
 * 講師選択の 50/30/20/10/5 は既存 MATCH_CONFIG 準拠。
 */
export const ALLOC_WEIGHTS = {
  // 講師選択
  fixedTeacher: 50, // 生徒の固定講師
  pastHistory: 30, // 過去6か月の担当実績
  subjectMatch: 20, // 指導可能科目に含まれる
  genderPref: 10, // 希望性別に一致
  available: 5, // 出勤している（ベースライン）
  continuity: 8, // 同じ生徒×科目で既に割り当てた講師（低優先の明示）
  loadBalancePerKoma: 1.5, // 担当本数が少ない講師を優先（本数×これを減点）
  // セル選択
  spreadIdeal: 12, // 同一科目の理想間隔に近い
  adjacentBonus: 10, // 同日の連続コマ（連続優先ON時）
  sameDaySamePenalty: 8, // 同日に同科目（許可時のみ発生する減点）
  halfPackBonus: 6, // 既存席の空き半分を埋める（詰め込み効率）
} as const;

// ============================================================
// ヘルパ
// ============================================================

const cellKey = (date: string, slotId: string): CellKey => `${date}_${slotId}`;
const seatKey = (date: string, slotId: string, teacherId: string) => `${date}_${slotId}_${teacherId}`;

/** JST 安全な日付差（日数）。文字列 YYYY-MM-DD 前提。 */
function dayDiff(a: string, b: string): number {
  const da = new Date(a + 'T12:00:00').getTime();
  const dbb = new Date(b + 'T12:00:00').getTime();
  return Math.round(Math.abs(da - dbb) / 86_400_000);
}

/** 45分タスクの half を、その講師セルの空き状況から決める（詰め込み優先）。 */
function decideHalf(existingSeats: SeatEntryInput[], maxSeats: number, duration: 45 | 90): HalfPosition {
  if (duration !== 45) return null;
  const occ = computeSeatOccupancy(existingSeats, maxSeats);
  // 片半だけ空いた席を優先して埋める（新しい席を開かない）
  if (occ.vacancies.some((v) => v.kind === 'first')) return 'first';
  if (occ.vacancies.some((v) => v.kind === 'second')) return 'second';
  // 丸ごと空きに新規で開くときは前半から
  return 'first';
}

/** その配置が「新しい席を1つ消費するか」（教室席数の判定に使う） */
function seatDelta(existingSeats: SeatEntryInput[], incoming: SeatEntryInput, maxSeats: number): number {
  const before = computeSeatOccupancy(existingSeats, maxSeats).usedSeatCount;
  const after = computeSeatOccupancy([...existingSeats, incoming], maxSeats).usedSeatCount;
  return Math.max(0, after - before);
}

// ============================================================
// 可変状態（割当中の occupancy）
// ============================================================

class AllocState {
  /** `${date}_${slotId}_${teacherId}` → その講師セルのエントリ（席計算用） */
  seatsByTeacherCell = new Map<string, SeatEntryInput[]>();
  /** `${date}_${slotId}` → 教室全体で使用中の席数 */
  usedSeatsByCell = new Map<CellKey, number>();
  /** `${studentId}_${date}` → その日の本数 */
  komaByStudentDay = new Map<string, number>();
  /** `${studentId}_${date}_${slotId}` → 既に入っているか（生徒の同一コマ重複防止） */
  studentCellTaken = new Set<string>();
  /** `${studentId}_${subjectId}` → 配置済みの日付一覧（分散・同日判定用） */
  datesByStudentSubject = new Map<string, string[]>();
  /** `${studentId}_${date}` → その日に入っている slot_number 一覧（連続判定用） */
  slotNumbersByStudentDay = new Map<string, number[]>();
  /** teacherId → 割当本数（負荷平準化用） */
  loadByTeacher = new Map<string, number>();
  /** `${studentId}_${subjectId}` → 使った講師ID集合（継続性用） */
  teachersByStudentSubject = new Map<string, Set<string>>();

  seats(date: string, slotId: string, teacherId: string): SeatEntryInput[] {
    return this.seatsByTeacherCell.get(seatKey(date, slotId, teacherId)) ?? [];
  }

  commit(a: {
    studentId: string;
    subjectId: string;
    date: string;
    slotId: string;
    slotNumber: number;
    teacherId: string;
    ratio: 1 | 2;
    halfPosition: HalfPosition;
    maxSeats: number;
  }) {
    const sk = seatKey(a.date, a.slotId, a.teacherId);
    const existing = this.seatsByTeacherCell.get(sk) ?? [];
    const incoming: SeatEntryInput = { ratio: a.ratio, halfPosition: a.halfPosition };
    const delta = seatDelta(existing, incoming, a.maxSeats);
    this.seatsByTeacherCell.set(sk, [...existing, incoming]);

    const ck = cellKey(a.date, a.slotId);
    this.usedSeatsByCell.set(ck, (this.usedSeatsByCell.get(ck) ?? 0) + delta);

    const sd = `${a.studentId}_${a.date}`;
    this.komaByStudentDay.set(sd, (this.komaByStudentDay.get(sd) ?? 0) + 1);
    this.studentCellTaken.add(`${a.studentId}_${ck}`);

    const ss = `${a.studentId}_${a.subjectId}`;
    this.datesByStudentSubject.set(ss, [...(this.datesByStudentSubject.get(ss) ?? []), a.date]);

    this.slotNumbersByStudentDay.set(sd, [...(this.slotNumbersByStudentDay.get(sd) ?? []), a.slotNumber]);

    this.loadByTeacher.set(a.teacherId, (this.loadByTeacher.get(a.teacherId) ?? 0) + 1);

    const set = this.teachersByStudentSubject.get(ss) ?? new Set<string>();
    set.add(a.teacherId);
    this.teachersByStudentSubject.set(ss, set);
  }
}

// ============================================================
// 候補評価
// ============================================================

interface Candidate {
  date: string;
  slotId: string;
  slotNumber: number;
  teacherId: string;
  halfPosition: HalfPosition;
  score: number;
}

/** 生徒の可能枠を (date, slotId, slotNumber) に展開したもの。走査対象＝これだけ。 */
export interface AvailCell {
  date: string;
  slotId: string;
  slotNumber: number;
}

/**
 * 生徒ごとの可能枠を展開する（期間・実在コマと突き合わせる）。
 * 1回だけ作って使い回す。可能枠だけを走査するので
 *  - 未割当理由の判定が「可能枠の中で何に阻まれたか」になる（枠の外は理由に数えない）
 *  - 走査量が 期間×全コマ → 生徒の可能枠数 に減る
 */
export function buildAvailCells(input: AllocatorInput): Map<string, AvailCell[]> {
  const dateSet = new Set(input.dates);
  const slotById = new Map(input.slots.map((s) => [s.id, s]));
  const out = new Map<string, AvailCell[]>();

  for (const [studentId, cells] of Array.from(input.studentAvailability.entries())) {
    const list: AvailCell[] = [];
    for (const key of Array.from(cells)) {
      // CellKey = `${YYYY-MM-DD}_${slotId}`
      const date = key.slice(0, 10);
      const slotId = key.slice(11);
      if (!dateSet.has(date)) continue;
      const slot = slotById.get(slotId);
      if (!slot) continue;
      list.push({ date, slotId, slotNumber: slot.slot_number });
    }
    list.sort((a, b) => a.date.localeCompare(b.date) || a.slotNumber - b.slotNumber);
    out.set(studentId, list);
  }
  return out;
}

/** ハード制約で落ちた理由の集計（未割当理由の判定に使う） */
export interface Blockers {
  /** 生徒の可能枠を自分の配置で使い切った */
  exhausted: number;
  /** 1日上限・同日同科目で入らない */
  dailyLimit: number;
  /** 教室が満席 */
  seat: number;
  /** 置ける講師がいない */
  teacher: number;
}

/** そのタスク1本を置ける候補（セル×講師）を全部列挙してスコア付けする。 */
function findCandidates(
  task: TaskDef,
  input: AllocatorInput,
  state: AllocState,
  availCells: Map<string, AvailCell[]>,
  blockers: Blockers
): Candidate[] {
  const { settings, capacity } = input;
  const cells = availCells.get(task.studentId);
  if (!cells || cells.length === 0) return [];

  const student = input.students.find((s) => s.id === task.studentId);
  const excluded = new Set(student?.excludedTeacherIds ?? []);
  const fixed = new Set(student?.fixedTeacherIds ?? []);
  const prefGender = student?.preferredTeacherGender ?? null;
  const past = input.pastTeacherByStudent?.get(task.studentId) ?? new Set<string>();
  const ss = `${task.studentId}_${task.subjectId}`;
  const placedDates = state.datesByStudentSubject.get(ss) ?? [];
  const continuityTeachers = state.teachersByStudentSubject.get(ss) ?? new Set<string>();

  // 分散の理想間隔（この科目を期間全体に散らしたときの日間隔）
  const totalForSubject = placedDates.length + task.koma;
  const idealGap = totalForSubject > 1 ? Math.max(1, input.dates.length / totalForSubject) : input.dates.length;

  const out: Candidate[] = [];

  // 走査は「生徒の可能枠」だけ。枠の外は候補にも理由にも数えない。
  for (const cellDef of cells) {
    const { date, slotId, slotNumber } = cellDef;
    const sd = `${task.studentId}_${date}`;
    const ck = cellKey(date, slotId);

    // ---- 生徒側のハード制約 ----
    if ((state.komaByStudentDay.get(sd) ?? 0) >= settings.maxKomaPerStudentPerDay) {
      blockers.dailyLimit++;
      continue;
    }
    const sameDay = placedDates.includes(date);
    if (sameDay && !settings.allowSameSubjectSameDay) {
      blockers.dailyLimit++;
      continue;
    }
    // その枠を自分の別配置で既に使っている
    if (state.studentCellTaken.has(`${task.studentId}_${ck}`)) {
      blockers.exhausted++;
      continue;
    }

    const teacherIds = input.teacherAvailability.get(ck) ?? [];
    if (teacherIds.length === 0) {
      blockers.teacher++;
      continue;
    }

    {
      const cellUsedSeats = state.usedSeatsByCell.get(ck) ?? 0;
      let anyTeacherFitted = false;
      let seatBlockedHere = false;

      for (const tid of teacherIds) {
        // ---- 講師側のハード制約 ----
        if (excluded.has(tid)) continue;
        const teacher = input.teachers.find((t) => t.id === tid);
        if (!teacher) continue;
        if (prefGender && teacher.gender && teacher.gender !== prefGender) continue;
        const teachable = teacher.teachableSubjectIds ?? [];
        // 空=全科目可（既存慣習）。指導できない講師はハード除外。
        const canTeach = teachable.length === 0 || teachable.includes(task.subjectId);
        if (!canTeach) continue;

        const existingSeats = state.seats(date, slotId, tid);
        const half = decideHalf(existingSeats, capacity.maxStudentsPerTeacher, task.duration);
        const incoming: SeatEntryInput = { ratio: task.ratio, halfPosition: half };

        // 席（1対1排他・半コマペアリング）は seatOccupancy が唯一の正
        if (!canPlaceEntry(existingSeats, incoming, capacity.maxStudentsPerTeacher)) continue;

        // 教室全体の席数
        const delta = seatDelta(existingSeats, incoming, capacity.maxStudentsPerTeacher);
        if (cellUsedSeats + delta > capacity.totalIndividualSeats) {
          seatBlockedHere = true;
          continue;
        }

        anyTeacherFitted = true;

        // ---- 内部スコア ----
        let score = ALLOC_WEIGHTS.available;
        if (fixed.has(tid)) score += ALLOC_WEIGHTS.fixedTeacher;
        if (past.has(tid)) score += ALLOC_WEIGHTS.pastHistory;
        // 指導可能（＝ここまで来た候補は全員）に一律で加点する。
        // teachable の「宣言あり/なし」で差を付けると、指導可能科目を空にしている
        // 「全科目可」の講師だけが 20点不利になり、ほとんど選ばれなくなる（実測で
        // 27本 vs 4本の偏りが出た）。空=全科目可という慣習と矛盾するため一律にする。
        score += ALLOC_WEIGHTS.subjectMatch;
        if (prefGender && teacher.gender === prefGender) score += ALLOC_WEIGHTS.genderPref;
        if (continuityTeachers.has(tid)) score += ALLOC_WEIGHTS.continuity;
        // 負荷平準化（担当本数が少ない講師を優先）
        score -= (state.loadByTeacher.get(tid) ?? 0) * ALLOC_WEIGHTS.loadBalancePerKoma;
        // 詰め込み効率（既存席の空き半分を埋めるなら加点＝新しい席を開かない）
        if (delta === 0) score += ALLOC_WEIGHTS.halfPackBonus;
        // 同一科目の分散
        if (settings.spreadSubjectEvenly && placedDates.length > 0) {
          const nearest = Math.min(...placedDates.map((d) => dayDiff(d, date)));
          score += (Math.min(nearest, idealGap) / idealGap) * ALLOC_WEIGHTS.spreadIdeal;
        }
        // 同日に同科目（許可されている場合のみここに来る）は減点
        if (sameDay) score -= ALLOC_WEIGHTS.sameDaySamePenalty;
        // 同日の連続コマ
        if (settings.preferConsecutive) {
          const nums = state.slotNumbersByStudentDay.get(sd) ?? [];
          if (nums.some((n) => Math.abs(n - slotNumber) === 1)) score += ALLOC_WEIGHTS.adjacentBonus;
        }

        out.push({ date, slotId, slotNumber, teacherId: tid, halfPosition: half, score });
      }

      if (!anyTeacherFitted) {
        if (seatBlockedHere) blockers.seat++;
        else blockers.teacher++;
      }
    }
  }

  // 決定性: スコア降順 → 日付昇順 → コマ番号昇順 → 講師ID昇順
  out.sort(
    (a, b) =>
      b.score - a.score ||
      a.date.localeCompare(b.date) ||
      a.slotNumber - b.slotNumber ||
      a.teacherId.localeCompare(b.teacherId)
  );
  return out;
}

/**
 * ブロッカー集計から未割当理由を決める。
 * 「講師不足」「席不足」は運用で手を打てる（シフト交渉・席の増設）ので、
 * 数が同じなら生徒側の事情（上限・枠の使い切り）より先に報告する。
 */
function pickReason(b: Blockers): UnassignedReason {
  const entries: Array<[UnassignedReason, number]> = [
    ['no_teacher', b.teacher],
    ['no_seat', b.seat],
    ['daily_limit', b.dailyLimit],
    ['not_enough_available_cells', b.exhausted],
  ];
  entries.sort((x, y) => y[1] - x[1]);
  return entries[0][1] > 0 ? entries[0][0] : 'not_enough_available_cells';
}

/** 空のブロッカー集計を作る */
function emptyBlockers(): Blockers {
  return { exhausted: 0, dailyLimit: 0, seat: 0, teacher: 0 };
}

// ============================================================
// メイン
// ============================================================

export function allocateKoushu(input: AllocatorInput): AllocatorResult {
  const { capacity } = input;
  const state = new AllocState();

  // ---- 既存配置を occupancy に積む ----
  const slotByIdAll = new Map(input.slots.map((s) => [s.id, s]));
  for (const e of input.existing) {
    const slot = slotByIdAll.get(e.slotId);
    if (!slot) continue;
    state.commit({
      studentId: e.studentId,
      subjectId: e.subjectId,
      date: e.date,
      slotId: e.slotId,
      slotNumber: slot.slot_number,
      teacherId: e.teacherId,
      ratio: e.ratio,
      halfPosition: e.halfPosition,
      maxSeats: capacity.maxStudentsPerTeacher,
    });
  }

  const assignments: Assignment[] = [];
  const unassigned: UnassignedTask[] = [];

  // 生徒の可能枠を展開（走査対象＝ここだけ。1回作って使い回す）
  const availCells = buildAvailCells(input);

  // ---- 可能表未提出の生徒は対象外（仕様書 §1-4） ----
  const workable: TaskDef[] = [];
  for (const t of input.tasks) {
    if (t.koma <= 0) continue;
    const cells = availCells.get(t.studentId);
    if (!cells || cells.length === 0) {
      unassigned.push({
        studentId: t.studentId,
        subjectId: t.subjectId,
        koma: t.koma,
        reason: 'no_availability_submission',
      });
    } else {
      workable.push({ ...t });
    }
  }

  // ---- 生徒の処理順: 制約の強い順（可能枠が少ない順）→ 残本数が多い順 ----
  const remainingByStudent = new Map<string, number>();
  for (const t of workable) {
    remainingByStudent.set(t.studentId, (remainingByStudent.get(t.studentId) ?? 0) + t.koma);
  }
  const studentOrder = Array.from(remainingByStudent.keys()).sort((a, b) => {
    const ca = input.studentAvailability.get(a)?.size ?? 0;
    const cb = input.studentAvailability.get(b)?.size ?? 0;
    return (
      ca - cb ||
      (remainingByStudent.get(b) ?? 0) - (remainingByStudent.get(a) ?? 0) ||
      a.localeCompare(b)
    );
  });

  // ---- 貪欲配置（生徒内は科目ラウンドロビン） ----
  const leftover = new Map<string, TaskDef>(); // `${studentId}_${subjectId}` → 残タスク

  for (const studentId of studentOrder) {
    const tasks = workable.filter((t) => t.studentId === studentId).map((t) => ({ ...t }));
    // 科目ラウンドロビン: 残本数が残っている限り1本ずつ回す
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const task of tasks) {
        if (task.koma <= 0) continue;
        const blockers = emptyBlockers();
        const cands = findCandidates(task, input, state, availCells, blockers);
        if (cands.length === 0) continue; // この科目はもう置けない（リペアへ）
        const best = cands[0];
        state.commit({
          studentId: task.studentId,
          subjectId: task.subjectId,
          date: best.date,
          slotId: best.slotId,
          slotNumber: best.slotNumber,
          teacherId: best.teacherId,
          ratio: task.ratio,
          halfPosition: best.halfPosition,
          maxSeats: capacity.maxStudentsPerTeacher,
        });
        assignments.push({
          studentId: task.studentId,
          subjectId: task.subjectId,
          date: best.date,
          slotId: best.slotId,
          teacherId: best.teacherId,
          ratio: task.ratio,
          duration: task.duration,
          halfPosition: best.halfPosition,
          score: best.score,
        });
        task.koma -= 1;
        progressed = true;
      }
    }
    // 置けなかった残りを記録
    for (const task of tasks) {
      if (task.koma > 0) leftover.set(`${task.studentId}_${task.subjectId}`, task);
    }
  }

  // ---- リペア1パス（仕様書 §5-3） ----
  // 未割当タスクごとに、配置済み1件を別セルへ動かして空きを作れないか試す。
  let repairedKoma = 0;
  for (const [, task] of Array.from(leftover.entries())) {
    while (task.koma > 0) {
      const moved = tryRepair(task, input, state, availCells, assignments);
      if (!moved) break;
      task.koma -= 1;
      repairedKoma += 1;
    }
  }

  // ---- 未割当を確定（理由付き） ----
  for (const [, task] of Array.from(leftover.entries())) {
    if (task.koma <= 0) continue;
    const blockers = emptyBlockers();
    findCandidates(task, input, state, availCells, blockers);
    unassigned.push({
      studentId: task.studentId,
      subjectId: task.subjectId,
      koma: task.koma,
      reason: pickReason(blockers),
    });
  }

  const requestedKoma = input.tasks.reduce((s, t) => s + Math.max(0, t.koma), 0);
  return {
    assignments,
    unassigned,
    stats: {
      requestedKoma,
      assignedKoma: assignments.length,
      loadByTeacher: Object.fromEntries(state.loadByTeacher),
      repairedKoma,
    },
  };
}

/**
 * リペア: 配置済み1件を別の実行可能セルへ1手だけ動かして、task が入る空きを作る。
 * 成功したら state と assignments を書き換えて true。
 *
 * 単純化のため「動かす候補」は task と同じ生徒以外の配置に限る（自分を動かしても本数は増えない）。
 * 探索はコストを抑えるため先頭から最初に成功したものを採る（1手・最初のヒット）。
 */
function tryRepair(
  task: TaskDef,
  input: AllocatorInput,
  state: AllocState,
  availCells: Map<string, AvailCell[]>,
  assignments: Assignment[]
): boolean {
  const { capacity } = input;
  const slotById = new Map(input.slots.map((s) => [s.id, s]));

  for (let i = 0; i < assignments.length; i++) {
    const victim = assignments[i];
    if (victim.studentId === task.studentId) continue;

    // victim を取り除いた状態を作る（state を作り直すのは高コストなので、
    // 「取り除いて → 試す → 戻す」を state のコピーで行う）
    const trial = cloneState(state);
    removeFromState(trial, victim, slotById, capacity.maxStudentsPerTeacher);

    // victim の代替先を探す（victim 自身が別セルに移れるか）
    const victimTask: TaskDef = {
      studentId: victim.studentId,
      subjectId: victim.subjectId,
      koma: 1,
      ratio: victim.ratio,
      duration: victim.duration,
    };
    const vb = emptyBlockers();
    const vCands = findCandidates(victimTask, input, trial, availCells, vb).filter(
      (c) => !(c.date === victim.date && c.slotId === victim.slotId && c.teacherId === victim.teacherId)
    );
    if (vCands.length === 0) continue;

    // victim を移した状態で、task が入るか
    const vBest = vCands[0];
    const trial2 = cloneState(trial);
    trial2.commit({
      studentId: victim.studentId,
      subjectId: victim.subjectId,
      date: vBest.date,
      slotId: vBest.slotId,
      slotNumber: vBest.slotNumber,
      teacherId: vBest.teacherId,
      ratio: victim.ratio,
      halfPosition: vBest.halfPosition,
      maxSeats: capacity.maxStudentsPerTeacher,
    });
    const tb = emptyBlockers();
    const tCands = findCandidates(task, input, trial2, availCells, tb);
    if (tCands.length === 0) continue;

    // 成功: 本番 state を trial2 + task 配置に更新
    const tBest = tCands[0];
    trial2.commit({
      studentId: task.studentId,
      subjectId: task.subjectId,
      date: tBest.date,
      slotId: tBest.slotId,
      slotNumber: tBest.slotNumber,
      teacherId: tBest.teacherId,
      ratio: task.ratio,
      halfPosition: tBest.halfPosition,
      maxSeats: capacity.maxStudentsPerTeacher,
    });
    adoptState(state, trial2);

    // assignments を書き換え
    assignments[i] = {
      ...victim,
      date: vBest.date,
      slotId: vBest.slotId,
      teacherId: vBest.teacherId,
      halfPosition: vBest.halfPosition,
      score: vBest.score,
    };
    assignments.push({
      studentId: task.studentId,
      subjectId: task.subjectId,
      date: tBest.date,
      slotId: tBest.slotId,
      teacherId: tBest.teacherId,
      ratio: task.ratio,
      duration: task.duration,
      halfPosition: tBest.halfPosition,
      score: tBest.score,
    });
    return true;
  }
  return false;
}

// ---- state のコピー/差し替え（リペアの試行用） ----

function cloneState(s: AllocState): AllocState {
  const n = new AllocState();
  n.seatsByTeacherCell = new Map(Array.from(s.seatsByTeacherCell, ([k, v]) => [k, [...v]]));
  n.usedSeatsByCell = new Map(s.usedSeatsByCell);
  n.komaByStudentDay = new Map(s.komaByStudentDay);
  n.studentCellTaken = new Set(s.studentCellTaken);
  n.datesByStudentSubject = new Map(Array.from(s.datesByStudentSubject, ([k, v]) => [k, [...v]]));
  n.slotNumbersByStudentDay = new Map(Array.from(s.slotNumbersByStudentDay, ([k, v]) => [k, [...v]]));
  n.loadByTeacher = new Map(s.loadByTeacher);
  n.teachersByStudentSubject = new Map(Array.from(s.teachersByStudentSubject, ([k, v]) => [k, new Set(v)]));
  return n;
}

function adoptState(target: AllocState, src: AllocState) {
  target.seatsByTeacherCell = src.seatsByTeacherCell;
  target.usedSeatsByCell = src.usedSeatsByCell;
  target.komaByStudentDay = src.komaByStudentDay;
  target.studentCellTaken = src.studentCellTaken;
  target.datesByStudentSubject = src.datesByStudentSubject;
  target.slotNumbersByStudentDay = src.slotNumbersByStudentDay;
  target.loadByTeacher = src.loadByTeacher;
  target.teachersByStudentSubject = src.teachersByStudentSubject;
}

function removeFromState(
  s: AllocState,
  a: Assignment,
  slotById: Map<string, { slot_number: number }>,
  maxSeats: number
) {
  const sk = seatKey(a.date, a.slotId, a.teacherId);
  const seats = s.seatsByTeacherCell.get(sk) ?? [];
  const before = computeSeatOccupancy(seats, maxSeats).usedSeatCount;
  // 同じ (ratio, half) の1件を取り除く
  const idx = seats.findIndex(
    (e) => (e.ratio ?? 2) === a.ratio && (e.halfPosition ?? null) === (a.halfPosition ?? null)
  );
  if (idx >= 0) seats.splice(idx, 1);
  s.seatsByTeacherCell.set(sk, seats);
  const after = computeSeatOccupancy(seats, maxSeats).usedSeatCount;

  const ck = cellKey(a.date, a.slotId);
  s.usedSeatsByCell.set(ck, Math.max(0, (s.usedSeatsByCell.get(ck) ?? 0) - Math.max(0, before - after)));

  const sd = `${a.studentId}_${a.date}`;
  s.komaByStudentDay.set(sd, Math.max(0, (s.komaByStudentDay.get(sd) ?? 0) - 1));
  s.studentCellTaken.delete(`${a.studentId}_${ck}`);

  const ss = `${a.studentId}_${a.subjectId}`;
  const dates = s.datesByStudentSubject.get(ss) ?? [];
  const di = dates.indexOf(a.date);
  if (di >= 0) dates.splice(di, 1);
  s.datesByStudentSubject.set(ss, dates);

  const slotNumber = slotById.get(a.slotId)?.slot_number;
  if (slotNumber != null) {
    const nums = s.slotNumbersByStudentDay.get(sd) ?? [];
    const ni = nums.indexOf(slotNumber);
    if (ni >= 0) nums.splice(ni, 1);
    s.slotNumbersByStudentDay.set(sd, nums);
  }

  s.loadByTeacher.set(a.teacherId, Math.max(0, (s.loadByTeacher.get(a.teacherId) ?? 0) - 1));
  // teachersByStudentSubject はヒント用途なので厳密に戻さない（継続性の加点が少しブレるだけ）
}
