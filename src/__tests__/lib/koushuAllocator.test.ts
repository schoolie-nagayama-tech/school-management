/**
 * 講習 自動コマ割りアロケータのユニットテスト（DB不要）
 *
 * 正典仕様: docs/koushu-auto-allocation-spec.md
 * 方針: ハード制約は「不変条件」として1つの検証関数にまとめ、最小シナリオと
 *       現実規模の合成データ（fixtures）の両方で必ず成立することを確かめる。
 */

import { allocateKoushu } from '@/lib/koushu-allocator/allocate';
import { computeSubjectBalance } from '@/lib/koushu-allocator/balance';
import {
  buildFixtureInput,
  buildMinimalInput,
  FIXTURE_SLOTS,
} from '@/lib/koushu-allocator/fixtures';
import type { AllocatorInput, AllocatorResult } from '@/lib/koushu-allocator/types';
import { computeSeatOccupancy, type SeatEntryInput } from '@/lib/utils/seatOccupancy';

/**
 * 結果がハード制約をすべて満たしているか検証する。
 * どのシナリオでも破ってはいけないものだけをここに置く（ソフトな好みは別テスト）。
 */
function assertInvariants(input: AllocatorInput, result: AllocatorResult) {
  const slotById = new Map(input.slots.map((s) => [s.id, s]));
  const studentById = new Map(input.students.map((s) => [s.id, s]));
  const teacherById = new Map(input.teachers.map((t) => [t.id, t]));

  // 集計器
  const seatsByTeacherCell = new Map<string, SeatEntryInput[]>();
  const komaByStudentDay = new Map<string, number>();
  const studentCell = new Set<string>();
  const datesByStudentSubject = new Map<string, string[]>();

  for (const a of result.assignments) {
    const cell = `${a.date}_${a.slotId}`;

    // (1) 期間の稼働日・実在コマに置かれている
    expect(input.dates).toContain(a.date);
    expect(slotById.has(a.slotId)).toBe(true);

    // (2) 生徒の出席可能枠の中に置かれている
    const avail = input.studentAvailability.get(a.studentId);
    expect(avail, `生徒 ${a.studentId} の可能表が無いのに配置された`).toBeDefined();
    expect(avail!.has(cell), `${a.studentId} の可能枠外 ${cell} に配置された`).toBe(true);

    // (3) 講師がそのセルに出勤している
    const onDuty = input.teacherAvailability.get(cell) ?? [];
    expect(onDuty, `${cell} に出勤していない講師 ${a.teacherId} が割当てられた`).toContain(
      a.teacherId
    );

    // (4) 生徒の希望条件（NG・性別）と講師の指導可能科目
    const st = studentById.get(a.studentId)!;
    const tc = teacherById.get(a.teacherId)!;
    expect(st.excludedTeacherIds ?? []).not.toContain(a.teacherId);
    if (st.preferredTeacherGender && tc.gender) {
      expect(tc.gender).toBe(st.preferredTeacherGender);
    }
    const teachable = tc.teachableSubjectIds ?? [];
    if (teachable.length > 0) {
      expect(teachable, `${tc.name} は ${a.subjectId} を指導できない`).toContain(a.subjectId);
    }

    // (5) 生徒は同一コマに1コマまで
    const scKey = `${a.studentId}_${cell}`;
    expect(studentCell.has(scKey), `${a.studentId} が ${cell} に二重配置`).toBe(false);
    studentCell.add(scKey);

    // 集計
    const sk = `${cell}_${a.teacherId}`;
    seatsByTeacherCell.set(sk, [
      ...(seatsByTeacherCell.get(sk) ?? []),
      { ratio: a.ratio, halfPosition: a.halfPosition },
    ]);
    const sd = `${a.studentId}_${a.date}`;
    komaByStudentDay.set(sd, (komaByStudentDay.get(sd) ?? 0) + 1);
    const ss = `${a.studentId}_${a.subjectId}`;
    datesByStudentSubject.set(ss, [...(datesByStudentSubject.get(ss) ?? []), a.date]);

    // (6) 45分は必ず半コマ位置を持ち、90分は持たない
    if (a.duration === 45) {
      expect(['first', 'second']).toContain(a.halfPosition);
    } else {
      expect(a.halfPosition).toBeNull();
    }
  }

  // (7) 講師セルの席が溢れていない（1対1排他・半コマペアリングを含む）
  for (const [sk, seats] of Array.from(seatsByTeacherCell.entries())) {
    const occ = computeSeatOccupancy(seats, input.capacity.maxStudentsPerTeacher);
    expect(occ.usedSeatCount, `${sk} が席数を超過`).toBeLessThanOrEqual(occ.effectiveSeatCount);
    // 1対1が居るなら、そのセルはその1件だけ
    if (seats.some((s) => s.ratio === 1)) {
      expect(seats.length, `${sk}: 1対1のセルに複数配置`).toBe(1);
    }
  }

  // (8) 教室全体の席数を超えていない
  const usedByCell = new Map<string, number>();
  for (const [sk, seats] of Array.from(seatsByTeacherCell.entries())) {
    const cell = sk.split('_').slice(0, 2).join('_');
    const used = computeSeatOccupancy(seats, input.capacity.maxStudentsPerTeacher).usedSeatCount;
    usedByCell.set(cell, (usedByCell.get(cell) ?? 0) + used);
  }
  for (const [cell, used] of Array.from(usedByCell.entries())) {
    expect(used, `${cell} が教室席数を超過`).toBeLessThanOrEqual(
      input.capacity.totalIndividualSeats
    );
  }

  // (9) 1日上限を超えていない
  for (const [sd, n] of Array.from(komaByStudentDay.entries())) {
    expect(n, `${sd} が1日上限超過`).toBeLessThanOrEqual(input.settings.maxKomaPerStudentPerDay);
  }

  // (10) 同一科目の同日重複（設定で禁止のとき）
  if (!input.settings.allowSameSubjectSameDay) {
    for (const [ss, dates] of Array.from(datesByStudentSubject.entries())) {
      expect(new Set(dates).size, `${ss} が同じ日に同科目で複数配置`).toBe(dates.length);
    }
  }

  // (11) 割当＋未割当が申込コマ数と一致する（取りこぼし・重複計上が無い）
  const assignedByTask = new Map<string, number>();
  for (const a of result.assignments) {
    const k = `${a.studentId}_${a.subjectId}`;
    assignedByTask.set(k, (assignedByTask.get(k) ?? 0) + 1);
  }
  const unassignedByTask = new Map<string, number>();
  for (const u of result.unassigned) {
    const k = `${u.studentId}_${u.subjectId}`;
    unassignedByTask.set(k, (unassignedByTask.get(k) ?? 0) + u.koma);
  }
  for (const t of input.tasks) {
    const k = `${t.studentId}_${t.subjectId}`;
    const got = (assignedByTask.get(k) ?? 0) + (unassignedByTask.get(k) ?? 0);
    expect(got, `${k}: 申込 ${t.koma} に対し 割当+未割当 = ${got}`).toBe(t.koma);
  }
}

describe('allocateKoushu — 基本動作', () => {
  it('余裕があれば申込コマ数どおり割り当てる', () => {
    const input = buildMinimalInput();
    const result = allocateKoushu(input);
    expect(result.assignments).toHaveLength(2);
    expect(result.unassigned).toHaveLength(0);
    assertInvariants(input, result);
  });

  it('同じ入力からは常に同じ結果になる（決定的）', () => {
    const a = allocateKoushu(buildFixtureInput({ seed: 7 }));
    const b = allocateKoushu(buildFixtureInput({ seed: 7 }));
    expect(a.assignments).toEqual(b.assignments);
    expect(a.unassigned).toEqual(b.unassigned);
  });

  it('可能枠が無い（可能表未提出）生徒は理由付きで未割当になる', () => {
    const input = buildMinimalInput({
      tasks: [{ studentId: 'S2', subjectId: 'X', koma: 2, ratio: 2, duration: 90 }],
      studentAvailability: new Map(), // 誰も提出していない
    });
    const result = allocateKoushu(input);
    expect(result.assignments).toHaveLength(0);
    expect(result.unassigned).toEqual([
      { studentId: 'S2', subjectId: 'X', koma: 2, reason: 'no_availability_submission' },
    ]);
  });
});

describe('allocateKoushu — ハード制約', () => {
  it('生徒の可能枠の外には置かない', () => {
    const input = buildMinimalInput({
      tasks: [{ studentId: 'S1', subjectId: 'X', koma: 4, ratio: 2, duration: 90 }],
      studentAvailability: new Map([['S1', new Set(['2026-07-21_A'])]]), // 1枠だけ
    });
    const result = allocateKoushu(input);
    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0].date).toBe('2026-07-21');
    expect(result.assignments[0].slotId).toBe('A');
    expect(result.unassigned[0].koma).toBe(3);
    assertInvariants(input, result);
  });

  it('1日上限（既定2コマ）を超えない', () => {
    // 1日に3枠あるが上限2 → 3コマ目は別日へ
    const input = buildMinimalInput({
      slots: [
        { id: 'A', slot_number: 1, start_time: '16:20:00', end_time: '17:50:00' },
        { id: 'B', slot_number: 2, start_time: '17:55:00', end_time: '19:25:00' },
        { id: 'C', slot_number: 3, start_time: '19:30:00', end_time: '21:00:00' },
      ],
      tasks: [
        { studentId: 'S1', subjectId: 'X', koma: 2, ratio: 2, duration: 90 },
        { studentId: 'S1', subjectId: 'Y', koma: 1, ratio: 2, duration: 90 },
      ],
      subjects: [
        { id: 'X', name: '数学' },
        { id: 'Y', name: '英語' },
      ],
      studentAvailability: new Map([
        ['S1', new Set(['2026-07-20_A', '2026-07-20_B', '2026-07-20_C', '2026-07-21_A'])],
      ]),
      teacherAvailability: new Map([
        ['2026-07-20_A', ['T1']],
        ['2026-07-20_B', ['T1']],
        ['2026-07-20_C', ['T1']],
        ['2026-07-21_A', ['T1']],
      ]),
    });
    const result = allocateKoushu(input);
    expect(result.assignments).toHaveLength(3);
    const on20 = result.assignments.filter((a) => a.date === '2026-07-20');
    expect(on20).toHaveLength(2);
    assertInvariants(input, result);
  });

  it('同一科目を同じ日に2コマ入れない（既定 allowSameSubjectSameDay=false）', () => {
    const input = buildMinimalInput({
      tasks: [{ studentId: 'S1', subjectId: 'X', koma: 2, ratio: 2, duration: 90 }],
      studentAvailability: new Map([
        ['S1', new Set(['2026-07-20_A', '2026-07-20_B', '2026-07-21_A'])],
      ]),
    });
    const result = allocateKoushu(input);
    expect(result.assignments).toHaveLength(2);
    const dates = result.assignments.map((a) => a.date);
    expect(new Set(dates).size).toBe(2); // 別日に散る
    assertInvariants(input, result);
  });

  it('同日同科目を許可すると同じ日に2コマ入る', () => {
    const input = buildMinimalInput({
      tasks: [{ studentId: 'S1', subjectId: 'X', koma: 2, ratio: 2, duration: 90 }],
      studentAvailability: new Map([['S1', new Set(['2026-07-20_A', '2026-07-20_B'])]]),
      teacherAvailability: new Map([
        ['2026-07-20_A', ['T1']],
        ['2026-07-20_B', ['T1']],
      ]),
      settings: {
        maxKomaPerStudentPerDay: 2,
        preferConsecutive: true,
        allowSameSubjectSameDay: true,
        spreadSubjectEvenly: false,
      },
    });
    const result = allocateKoushu(input);
    expect(result.assignments).toHaveLength(2);
    expect(new Set(result.assignments.map((a) => a.date)).size).toBe(1);
    assertInvariants(input, result);
  });

  it('1対1は講師の席を専有する（同じ講師セルに2人目を入れない）', () => {
    const input = buildMinimalInput({
      students: [
        { id: 'S1', name: '生徒1', grade: 9 },
        { id: 'S2', name: '生徒2', grade: 9 },
      ],
      tasks: [
        { studentId: 'S1', subjectId: 'X', koma: 1, ratio: 1, duration: 90 }, // 1対1
        { studentId: 'S2', subjectId: 'X', koma: 1, ratio: 2, duration: 90 },
      ],
      // 両者ともこの1枠しか空いていない
      studentAvailability: new Map([
        ['S1', new Set(['2026-07-20_A'])],
        ['S2', new Set(['2026-07-20_A'])],
      ]),
      teacherAvailability: new Map([['2026-07-20_A', ['T1']]]),
    });
    const result = allocateKoushu(input);
    // 1対1が席を専有するので、どちらか1名しか入らない
    expect(result.assignments).toHaveLength(1);
    expect(result.unassigned).toHaveLength(1);
    assertInvariants(input, result);
  });

  it('45分×2コマは同じ講師セルの前半/後半で席を共有できる', () => {
    const input = buildMinimalInput({
      students: [
        { id: 'S1', name: '生徒1', grade: 5 },
        { id: 'S2', name: '生徒2', grade: 5 },
      ],
      tasks: [
        { studentId: 'S1', subjectId: 'X', koma: 1, ratio: 2, duration: 45 },
        { studentId: 'S2', subjectId: 'X', koma: 1, ratio: 2, duration: 45 },
      ],
      studentAvailability: new Map([
        ['S1', new Set(['2026-07-20_A'])],
        ['S2', new Set(['2026-07-20_A'])],
      ]),
      teacherAvailability: new Map([['2026-07-20_A', ['T1']]]),
      // 席1つでも前半/後半で2人入る
      capacity: { maxStudentsPerTeacher: 1, totalIndividualSeats: 1 },
    });
    const result = allocateKoushu(input);
    expect(result.assignments).toHaveLength(2);
    const halves = result.assignments.map((a) => a.halfPosition).sort();
    expect(halves).toEqual(['first', 'second']);
    assertInvariants(input, result);
  });

  it('NG講師・希望性別・指導可能科目に反する割当をしない', () => {
    const input = buildMinimalInput({
      students: [
        // T1(男性)はNG、T2(女性)のみ可
        {
          id: 'S1',
          name: '生徒1',
          grade: 9,
          excludedTeacherIds: ['T1'],
          preferredTeacherGender: 'female',
        },
      ],
      teachers: [
        { id: 'T1', name: '講師1', gender: 'male', teachableSubjectIds: [] },
        { id: 'T2', name: '講師2', gender: 'female', teachableSubjectIds: ['X'] },
        { id: 'T3', name: '講師3', gender: 'female', teachableSubjectIds: ['Z'] }, // 科目外
      ],
      tasks: [{ studentId: 'S1', subjectId: 'X', koma: 1, ratio: 2, duration: 90 }],
      studentAvailability: new Map([['S1', new Set(['2026-07-20_A'])]]),
      teacherAvailability: new Map([['2026-07-20_A', ['T1', 'T2', 'T3']]]),
    });
    const result = allocateKoushu(input);
    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0].teacherId).toBe('T2');
    assertInvariants(input, result);
  });

  it('教室全体の席数を超えない', () => {
    // 講師2名×席2 = 4人入れるが、教室席数は2に絞る
    const input = buildMinimalInput({
      students: ['S1', 'S2', 'S3', 'S4'].map((id) => ({ id, name: id, grade: 9 })),
      teachers: [
        { id: 'T1', name: '講師1', gender: null, teachableSubjectIds: [] },
        { id: 'T2', name: '講師2', gender: null, teachableSubjectIds: [] },
      ],
      tasks: ['S1', 'S2', 'S3', 'S4'].map((id) => ({
        studentId: id,
        subjectId: 'X',
        koma: 1,
        ratio: 2 as const,
        duration: 90 as const,
      })),
      studentAvailability: new Map(
        ['S1', 'S2', 'S3', 'S4'].map((id) => [id, new Set(['2026-07-20_A'])])
      ),
      teacherAvailability: new Map([['2026-07-20_A', ['T1', 'T2']]]),
      capacity: { maxStudentsPerTeacher: 2, totalIndividualSeats: 2 },
    });
    const result = allocateKoushu(input);
    expect(result.assignments.length).toBeLessThanOrEqual(2);
    assertInvariants(input, result);
  });

  it('既存配置（公開済み・手動）を尊重し、その席を二重に使わない', () => {
    const input = buildMinimalInput({
      students: [
        { id: 'S1', name: '生徒1', grade: 9 },
        { id: 'S2', name: '生徒2', grade: 9 },
      ],
      tasks: [{ studentId: 'S2', subjectId: 'X', koma: 1, ratio: 2, duration: 90 }],
      studentAvailability: new Map([['S2', new Set(['2026-07-20_A'])]]),
      teacherAvailability: new Map([['2026-07-20_A', ['T1']]]),
      capacity: { maxStudentsPerTeacher: 1, totalIndividualSeats: 1 },
      // 既に S1 が 1対1 でその枠を専有している
      existing: [
        {
          studentId: 'S1',
          subjectId: 'X',
          date: '2026-07-20',
          slotId: 'A',
          teacherId: 'T1',
          ratio: 1,
          duration: 90,
          halfPosition: null,
        },
      ],
    });
    const result = allocateKoushu(input);
    expect(result.assignments).toHaveLength(0);
    expect(result.unassigned[0].reason).toBe('no_teacher');
  });
});

describe('allocateKoushu — 優先順とソフト項', () => {
  it('可能枠が少ない生徒（制約の強い順）を先に確定する', () => {
    // 同じ1枠を2人が狙う。S_tight は他に行き場が無い、S_loose は別日にも行ける
    const input = buildMinimalInput({
      students: [
        { id: 'S_loose', name: 'ゆるい', grade: 9 },
        { id: 'S_tight', name: 'きつい', grade: 9 },
      ],
      tasks: [
        { studentId: 'S_loose', subjectId: 'X', koma: 1, ratio: 2, duration: 90 },
        { studentId: 'S_tight', subjectId: 'X', koma: 1, ratio: 2, duration: 90 },
      ],
      studentAvailability: new Map([
        ['S_loose', new Set(['2026-07-20_A', '2026-07-21_A', '2026-07-22_A'])],
        ['S_tight', new Set(['2026-07-20_A'])],
      ]),
      teacherAvailability: new Map([
        ['2026-07-20_A', ['T1']],
        ['2026-07-21_A', ['T1']],
        ['2026-07-22_A', ['T1']],
      ]),
      // 1枠1名しか入れない状況を作る
      capacity: { maxStudentsPerTeacher: 1, totalIndividualSeats: 1 },
    });
    const result = allocateKoushu(input);
    // 両方入る（tight が 7/20 を取り、loose は別日へ回る）
    expect(result.assignments).toHaveLength(2);
    const tight = result.assignments.find((a) => a.studentId === 'S_tight')!;
    expect(tight.date).toBe('2026-07-20');
    const loose = result.assignments.find((a) => a.studentId === 'S_loose')!;
    expect(loose.date).not.toBe('2026-07-20');
    assertInvariants(input, result);
  });

  it('リペアが働く（先に置いた生徒を動かして後の生徒を救済する）', () => {
    // 制約の強い順で救えないケースを意図的に作る:
    //   S1(科目X) と S2(科目Y) は可能枠の数が同じ。先に処理される S1 が 7/20 を取ると、
    //   S2 は「7/20 は教室満席」「7/21 は Y を教える講師が出勤なし」で行き場を失う。
    //   S1 は 7/21 に移れるので、1手動かせば両方入る＝リペアの出番。
    const input = buildMinimalInput({
      dates: ['2026-07-20', '2026-07-21'],
      slots: [{ id: 'A', slot_number: 1, start_time: '16:20:00', end_time: '17:50:00' }],
      students: [
        { id: 'S1', name: '生徒1', grade: 9 },
        { id: 'S2', name: '生徒2', grade: 9 },
      ],
      teachers: [
        { id: 'T1', name: '講師1', gender: null, teachableSubjectIds: ['X'] },
        { id: 'T2', name: '講師2', gender: null, teachableSubjectIds: ['Y'] },
      ],
      subjects: [
        { id: 'X', name: '数学' },
        { id: 'Y', name: '英語' },
      ],
      tasks: [
        { studentId: 'S1', subjectId: 'X', koma: 1, ratio: 2, duration: 90 },
        { studentId: 'S2', subjectId: 'Y', koma: 1, ratio: 2, duration: 90 },
      ],
      studentAvailability: new Map([
        ['S1', new Set(['2026-07-20_A', '2026-07-21_A'])],
        ['S2', new Set(['2026-07-20_A', '2026-07-21_A'])],
      ]),
      // 7/21 は T2（英語）が出勤していない
      teacherAvailability: new Map([
        ['2026-07-20_A', ['T1', 'T2']],
        ['2026-07-21_A', ['T1']],
      ]),
      // 教室席1 = 1コマに1名しか入れない（講師が別でも埋まる）
      capacity: { maxStudentsPerTeacher: 2, totalIndividualSeats: 1 },
    });
    const result = allocateKoushu(input);
    expect(result.assignments).toHaveLength(2);
    expect(result.unassigned).toHaveLength(0);
    expect(result.stats.repairedKoma).toBe(1);
    // S1 が 7/21 へ退避し、S2 が 7/20 に入っている
    expect(result.assignments.find((a) => a.studentId === 'S1')!.date).toBe('2026-07-21');
    expect(result.assignments.find((a) => a.studentId === 'S2')!.date).toBe('2026-07-20');
    assertInvariants(input, result);
  });

  it('全科目可（指導可能科目が空）の講師が不当に敬遠されない', () => {
    // 空=全科目可 の講師と、明示宣言の講師が同条件なら、負荷の少ない側が選ばれる。
    // 以前は「宣言あり」だけが +20 されており、全科目可の講師がほぼ使われなかった。
    const input = buildMinimalInput({
      dates: ['2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23'],
      slots: [{ id: 'A', slot_number: 1, start_time: '16:20:00', end_time: '17:50:00' }],
      students: [{ id: 'S1', name: '生徒1', grade: 9 }],
      teachers: [
        { id: 'T_declared', name: '宣言あり', gender: null, teachableSubjectIds: ['X'] },
        { id: 'T_any', name: '全科目可', gender: null, teachableSubjectIds: [] },
      ],
      tasks: [{ studentId: 'S1', subjectId: 'X', koma: 4, ratio: 2, duration: 90 }],
      studentAvailability: new Map([
        ['S1', new Set(['2026-07-20_A', '2026-07-21_A', '2026-07-22_A', '2026-07-23_A'])],
      ]),
      teacherAvailability: new Map([
        ['2026-07-20_A', ['T_declared', 'T_any']],
        ['2026-07-21_A', ['T_declared', 'T_any']],
        ['2026-07-22_A', ['T_declared', 'T_any']],
        ['2026-07-23_A', ['T_declared', 'T_any']],
      ]),
      settings: {
        maxKomaPerStudentPerDay: 2,
        preferConsecutive: false,
        allowSameSubjectSameDay: true,
        spreadSubjectEvenly: false,
      },
    });
    const result = allocateKoushu(input);
    expect(result.assignments).toHaveLength(4);
    const anyCount = result.assignments.filter((a) => a.teacherId === 'T_any').length;
    // 負荷平準化が効いて、全科目可の講師にも回る（偏り0コマではない）
    expect(anyCount).toBeGreaterThan(0);
    assertInvariants(input, result);
  });

  it('固定講師が居れば優先して割り当てる', () => {
    const input = buildMinimalInput({
      students: [{ id: 'S1', name: '生徒1', grade: 9, fixedTeacherIds: ['T2'] }],
      teachers: [
        { id: 'T1', name: '講師1', gender: null, teachableSubjectIds: [] },
        { id: 'T2', name: '講師2', gender: null, teachableSubjectIds: [] },
      ],
      tasks: [{ studentId: 'S1', subjectId: 'X', koma: 1, ratio: 2, duration: 90 }],
      studentAvailability: new Map([['S1', new Set(['2026-07-20_A'])]]),
      teacherAvailability: new Map([['2026-07-20_A', ['T1', 'T2']]]),
    });
    const result = allocateKoushu(input);
    expect(result.assignments[0].teacherId).toBe('T2');
  });

  it('同一科目は期間内に分散する（同じ週に固まらない）', () => {
    const dates = Array.from({ length: 12 }, (_, i) => {
      const d = new Date('2026-07-20T12:00:00');
      d.setDate(d.getDate() + i);
      return d.toISOString().slice(0, 10);
    });
    const avail = new Set(dates.map((d) => `${d}_A`));
    const input = buildMinimalInput({
      dates,
      slots: [{ id: 'A', slot_number: 1, start_time: '16:20:00', end_time: '17:50:00' }],
      tasks: [{ studentId: 'S1', subjectId: 'X', koma: 3, ratio: 2, duration: 90 }],
      studentAvailability: new Map([['S1', avail]]),
      teacherAvailability: new Map(dates.map((d) => [`${d}_A`, ['T1']])),
    });
    const result = allocateKoushu(input);
    expect(result.assignments).toHaveLength(3);
    const placed = result.assignments.map((a) => a.date).sort();
    // 3コマを12日に散らすので、隣接日に固まらない（最小間隔が2日以上）
    const gaps = placed.slice(1).map((d, i) => {
      const a = new Date(placed[i] + 'T12:00:00').getTime();
      const b = new Date(d + 'T12:00:00').getTime();
      return Math.round((b - a) / 86_400_000);
    });
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(2);
    assertInvariants(input, result);
  });
});

describe('科目の時間的な偏り（前半英語ばかり…の防止）', () => {
  /** 連続した日付を n 日ぶん作る（休講なし） */
  function seqDates(n: number, from = '2026-07-20'): string[] {
    const out: string[] = [];
    const cur = new Date(from + 'T12:00:00');
    for (let i = 0; i < n; i++) {
      const y = cur.getFullYear();
      const m = String(cur.getMonth() + 1).padStart(2, '0');
      const d = String(cur.getDate()).padStart(2, '0');
      out.push(`${y}-${m}-${d}`);
      cur.setDate(cur.getDate() + 1);
    }
    return out;
  }

  it('2コマの科目は前半と後半に1コマずつ置かれる（絶対位置のアンカー）', () => {
    const dates = seqDates(20);
    const input = buildMinimalInput({
      dates,
      slots: [{ id: 'A', slot_number: 1, start_time: '16:20:00', end_time: '17:50:00' }],
      tasks: [{ studentId: 'S1', subjectId: 'X', koma: 2, ratio: 2, duration: 90 }],
      studentAvailability: new Map([['S1', new Set(dates.map((d) => `${d}_A`))]]),
      teacherAvailability: new Map(dates.map((d) => [`${d}_A`, ['T1']])),
    });
    const result = allocateKoushu(input);
    expect(result.assignments).toHaveLength(2);
    const idx = result.assignments.map((a) => dates.indexOf(a.date)).sort((a, b) => a - b);
    // 理想位置は 0.25 / 0.75 の地点（= だいたい 5日目と14日目）
    expect(idx[0]).toBeLessThan(dates.length / 2);
    expect(idx[1]).toBeGreaterThanOrEqual(dates.length / 2);
  });

  it('コマ数が少ない科目も期間の後半に残る（多い科目に食われない）', () => {
    // 英語8コマ・数学2コマ。均等化が無いと数学が前半で終わり、後半は英語だけになる。
    const dates = seqDates(40);
    const avail = new Set(dates.map((d) => `${d}_A`));
    const input = buildMinimalInput({
      dates,
      slots: [{ id: 'A', slot_number: 1, start_time: '16:20:00', end_time: '17:50:00' }],
      subjects: [
        { id: 'EN', name: '英語' },
        { id: 'MA', name: '数学' },
      ],
      tasks: [
        { studentId: 'S1', subjectId: 'EN', koma: 8, ratio: 2, duration: 90 },
        { studentId: 'S1', subjectId: 'MA', koma: 2, ratio: 2, duration: 90 },
      ],
      studentAvailability: new Map([['S1', avail]]),
      teacherAvailability: new Map(dates.map((d) => [`${d}_A`, ['T1']])),
    });
    const result = allocateKoushu(input);
    const half = dates.length / 2;
    const mathIdx = result.assignments
      .filter((a) => a.subjectId === 'MA')
      .map((a) => dates.indexOf(a.date));
    expect(mathIdx).toHaveLength(2);
    expect(
      mathIdx.some((i) => i < half),
      '数学が前半に1コマも無い'
    ).toBe(true);
    expect(
      mathIdx.some((i) => i >= half),
      '数学が後半に1コマも無い'
    ).toBe(true);
    // 後半にも両科目が混ざっていること
    const lateSubjects = new Set(
      result.assignments.filter((a) => dates.indexOf(a.date) >= half).map((a) => a.subjectId)
    );
    expect(lateSubjects).toEqual(new Set(['EN', 'MA']));
    assertInvariants(input, result);
  });

  it('均等化ONはOFFより偏りが小さく、割当コマ数を犠牲にしない', () => {
    const base = buildFixtureInput({ seed: 42 });
    const off = allocateKoushu({
      ...base,
      settings: { ...base.settings, spreadSubjectEvenly: false },
    });
    const on = allocateKoushu({
      ...base,
      settings: { ...base.settings, spreadSubjectEvenly: true },
    });

    expect(on.stats.subjectBalance.evenness).toBeGreaterThan(off.stats.subjectBalance.evenness);
    // 均等化は「詰め込みを諦める」形で達成してはいけない
    expect(on.stats.assignedKoma).toBeGreaterThanOrEqual(off.stats.assignedKoma);
  });

  it('期間を4等分した各期のコマ数が偏らない（教室全体で見た山崩し）', () => {
    const input = buildFixtureInput({ seed: 42 });
    const result = allocateKoushu(input);
    const totals = result.stats.subjectBalance.quarters.map((q) => q.total);
    expect(totals).toHaveLength(4);
    const mean = totals.reduce((s, n) => s + n, 0) / totals.length;
    // 最も多い期が平均の1.5倍を超えない（均等化前は 41 vs 平均25.5 で超えていた）
    expect(Math.max(...totals)).toBeLessThanOrEqual(mean * 1.5);
    // 最終期が空にならない（前半に食い尽くされていない）
    expect(totals[3]).toBeGreaterThan(0);
  });

  it('複数 seed で均等度が実用水準を保つ', () => {
    for (const seed of [1, 7, 42, 99, 2026]) {
      const result = allocateKoushu(buildFixtureInput({ seed }));
      expect(result.stats.subjectBalance.evenness, `seed=${seed} の均等度が低い`).toBeGreaterThan(
        0.7
      );
    }
  });
});

describe('computeSubjectBalance — 指標の定義', () => {
  const dates = Array.from({ length: 11 }, (_, i) => `2026-07-${String(20 + i).padStart(2, '0')}`);
  const mk = (date: string) => ({
    studentId: 'S1',
    subjectId: 'X',
    date,
    slotId: 'A',
    teacherId: 'T1',
    ratio: 2 as const,
    duration: 90 as const,
    halfPosition: null,
    score: 0,
  });

  it('均等に散っていれば 1 に近い', () => {
    // 11日に3コマ → 理想位置は index 1.67 / 5 / 8.33
    const b = computeSubjectBalance(dates, [mk(dates[2]), mk(dates[5]), mk(dates[8])]);
    expect(b.evenness).toBeGreaterThan(0.9);
  });

  it('片端に固まっていれば 0 に近い', () => {
    const b = computeSubjectBalance(dates, [mk(dates[0]), mk(dates[0 + 1]), mk(dates[2])]);
    expect(b.evenness).toBeLessThan(0.4);
  });

  it('1コマだけの科目は指標に含めない（均等かを定義できない）', () => {
    const b = computeSubjectBalance(dates, [mk(dates[0])]);
    expect(b.evenness).toBe(1);
    expect(b.worst).toHaveLength(0);
    // 配置自体は期別集計に出る
    expect(b.quarters.reduce((s, q) => s + q.total, 0)).toBe(1);
  });
});

describe('allocateKoushu — 現実規模の合成データ', () => {
  it('8週・10生徒・6講師でハード制約を全て満たす', () => {
    const input = buildFixtureInput({ seed: 42 });
    const result = allocateKoushu(input);
    assertInvariants(input, result);
    // 少なくとも大半は割り当たること（枠が現実的に足りている想定）
    expect(result.stats.assignedKoma).toBeGreaterThan(0);
    expect(result.stats.assignedKoma).toBeLessThanOrEqual(result.stats.requestedKoma);
  });

  it('複数の seed でも不変条件が壊れない', () => {
    for (const seed of [1, 7, 42, 99, 2026]) {
      const input = buildFixtureInput({ seed });
      const result = allocateKoushu(input);
      assertInvariants(input, result);
    }
  });

  it('設定を変えても不変条件が壊れない', () => {
    const variants = [
      {
        maxKomaPerStudentPerDay: 1,
        preferConsecutive: false,
        allowSameSubjectSameDay: false,
        spreadSubjectEvenly: false,
      },
      {
        maxKomaPerStudentPerDay: 3,
        preferConsecutive: true,
        allowSameSubjectSameDay: true,
        spreadSubjectEvenly: true,
      },
      {
        maxKomaPerStudentPerDay: 2,
        preferConsecutive: false,
        allowSameSubjectSameDay: true,
        spreadSubjectEvenly: false,
      },
    ];
    for (const settings of variants) {
      const base = buildFixtureInput({ seed: 42 });
      const input = { ...base, settings };
      const result = allocateKoushu(input);
      assertInvariants(input, result);
    }
  });

  it('1日上限を上げると割当コマ数が増える（詰め込みが効く）', () => {
    const base = buildFixtureInput({ seed: 42 });
    const tight = allocateKoushu({
      ...base,
      settings: { ...base.settings, maxKomaPerStudentPerDay: 1 },
    });
    const loose = allocateKoushu({
      ...base,
      settings: { ...base.settings, maxKomaPerStudentPerDay: 3 },
    });
    expect(loose.stats.assignedKoma).toBeGreaterThanOrEqual(tight.stats.assignedKoma);
  });

  it('席を絞ると割当コマ数が減る（需要がセルに集中する短期シナリオ）', () => {
    // 8週に散らすと1セルあたり0.5コマ程度で席が縛りにならないため、
    // 期間を1週に圧縮して需要をセルに集中させたうえで比較する。
    const opts = { seed: 42, startDate: '2026-07-20', endDate: '2026-07-25' };
    const rich = allocateKoushu(buildFixtureInput({ ...opts, totalIndividualSeats: 12 }));
    const poor = allocateKoushu(buildFixtureInput({ ...opts, totalIndividualSeats: 1 }));
    expect(poor.stats.assignedKoma).toBeLessThan(rich.stats.assignedKoma);
    // 席不足が理由として報告されること
    expect(poor.unassigned.some((u) => u.reason === 'no_seat')).toBe(true);
  });

  it('スロット定義は実データ（緑園都市校）と同じ5コマ', () => {
    expect(FIXTURE_SLOTS.map((s) => s.start_time.slice(0, 5))).toEqual([
      '12:50',
      '14:25',
      '16:20',
      '17:55',
      '19:30',
    ]);
  });
});

describe('学年別の講習終了日（決定44）— 終了が早い生徒の分散', () => {
  /**
   * 学年別終了日で「期間の途中までしか通えない生徒」が混ざったときに、
   * その生徒が通える範囲の中で均等に散ること。
   *
   * ★ この検証が守っているもの（allocate.ts の EARLY_END_RATIO）:
   *   絶対位置アンカーの基準区間を常に「期間全体」にすると、終了が早い生徒の
   *   後半のコマの理想位置が通える範囲の外に出てアンカーが効かなくなり、前方に寄る。
   *   逆に常に「その生徒の可能枠」に縮めると、期間いっぱい通える生徒の分散が悪化する。
   *   そのため「明らかに早く終わる生徒だけ縮める」条件付きにしている。
   *
   * ★ 閾値の根拠（合成データ5seedの実測。両側を確認済み）:
   *   期間全体で固定 → 0.814 ／ 条件付き（現行） → 0.831
   *   その間の 0.825 を下限に置く。単一シナリオでは差が出ない（統計的な差なので
   *   fixtures 全体で測る必要がある）。
   */
  const SEEDS = [1, 7, 42, 99, 2026];
  const CLAMP_RATIO = 0.6;

  /** 生徒の半分の可能枠を期間先頭 60% で切る（＝終了が早い学年の代用） */
  function clampHalfOfStudents(input: AllocatorInput): AllocatorInput {
    const cutoffDate = input.dates[Math.max(0, Math.floor(input.dates.length * CLAMP_RATIO) - 1)];
    const clamped = new Map(input.studentAvailability);
    Array.from(clamped.keys())
      .sort()
      .forEach((sid, i) => {
        if (i % 2 !== 0) return;
        const kept = new Set<string>();
        for (const key of Array.from(clamped.get(sid) ?? [])) {
          if (key.slice(0, 10) <= cutoffDate) kept.add(key);
        }
        clamped.set(sid, kept);
      });
    return { ...input, studentAvailability: clamped };
  }

  /**
   * 「その生徒が通える範囲の中で均等か」を測る。
   * computeSubjectBalance は期間全体を基準にするので、通える範囲が狭い生徒は
   * 何をしても偏って見える。ここでは基準を生徒の最終可能日に置いて測る。
   */
  function windowEvenness(input: AllocatorInput, result: AllocatorResult): number {
    const idxByDate = new Map(input.dates.map((d, i) => [d, i]));
    const maxIdxByStudent = new Map<string, number>();
    for (const [sid, cells] of Array.from(input.studentAvailability.entries())) {
      const idxs = Array.from(cells)
        .map((k) => idxByDate.get(k.slice(0, 10)))
        .filter((v): v is number => v != null);
      if (idxs.length > 0) maxIdxByStudent.set(sid, Math.max(...idxs));
    }

    const positions = new Map<string, number[]>();
    for (const a of result.assignments) {
      const i = idxByDate.get(a.date);
      if (i == null) continue;
      const key = `${a.studentId}|${a.subjectId}`;
      const arr = positions.get(key);
      if (arr) arr.push(i);
      else positions.set(key, [i]);
    }

    const drifts: number[] = [];
    for (const [key, pos] of Array.from(positions.entries())) {
      if (pos.length < 2) continue;
      const sid = key.slice(0, key.indexOf('|'));
      const span = Math.max(1, maxIdxByStudent.get(sid) ?? input.dates.length - 1);
      const sorted = [...pos].sort((a, b) => a - b);
      let sum = 0;
      for (let k = 0; k < sorted.length; k++) {
        sum += Math.abs(sorted[k] - ((k + 0.5) / sorted.length) * span);
      }
      drifts.push(sum / sorted.length / span);
    }
    const mean = drifts.length === 0 ? 0 : drifts.reduce((s, d) => s + d, 0) / drifts.length;
    return Math.max(0, Math.min(1, 1 - mean * 2));
  }

  it('通える範囲の中での均等度が実測水準（0.825以上）を保つ', () => {
    let sum = 0;
    for (const seed of SEEDS) {
      const input = clampHalfOfStudents(buildFixtureInput({ seed }));
      const result = allocateKoushu(input);
      assertInvariants(input, result);
      sum += windowEvenness(input, result);
    }
    expect(sum / SEEDS.length).toBeGreaterThanOrEqual(0.825);
  });

  it('期間を切っても割当コマ数が大きく落ちない', () => {
    for (const seed of SEEDS) {
      const base = buildFixtureInput({ seed });
      const clamped = clampHalfOfStudents(base);
      const before = allocateKoushu(base).stats.assignedKoma;
      const after = allocateKoushu(clamped).stats.assignedKoma;
      // 半数の生徒の枠を4割削っているので減るのは当然だが、破滅的に落ちないこと
      expect(after).toBeGreaterThan(before * 0.8);
    }
  });
});
