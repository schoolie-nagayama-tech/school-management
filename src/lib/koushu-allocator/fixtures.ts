/**
 * 講習 自動コマ割り — 合成テストデータ（DB不要）
 *
 * 目的:
 *  - アロケータのユニットテスト（src/__tests__/lib/koushuAllocator.test.ts）
 *  - ブラウザ上のシミュレータ（/schedule/koushu/simulator）で設定を変えながら結果を目視
 *
 * 決定性: 乱数は seed 付き LCG のみ。Math.random / Date.now は使わない。
 * 同じ seed からは常に同じデータが出る＝テストが安定し、目視の比較もできる。
 */

import { DEFAULT_SETTINGS, type AllocatorInput, type CellKey, type SlotDef } from './types';

/** 決定的な擬似乱数（線形合同法）。seed を変えるとシナリオが変わる。 */
function makeRng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    // Numerical Recipes の係数
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

const cellKey = (date: string, slotId: string): CellKey => `${date}_${slotId}`;

/** 期間の日付を列挙（日曜とお盆を除外＝稼働日） */
export function buildKoushuDates(
  startDate = '2026-07-20',
  endDate = '2026-09-13',
  closed: string[] = ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16']
): string[] {
  const out: string[] = [];
  const closedSet = new Set(closed);
  const cur = new Date(startDate + 'T12:00:00');
  const end = new Date(endDate + 'T12:00:00');
  while (cur <= end) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, '0');
    const d = String(cur.getDate()).padStart(2, '0');
    const iso = `${y}-${m}-${d}`;
    // 日曜は休み
    if (cur.getDay() !== 0 && !closedSet.has(iso)) out.push(iso);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/** 実データ（緑園都市校）と同じ個別コマ時間 */
export const FIXTURE_SLOTS: SlotDef[] = [
  { id: 'slot1', slot_number: 1, start_time: '12:50:00', end_time: '14:20:00' },
  { id: 'slot2', slot_number: 2, start_time: '14:25:00', end_time: '15:55:00' },
  { id: 'slot3', slot_number: 3, start_time: '16:20:00', end_time: '17:50:00' },
  { id: 'slot4', slot_number: 4, start_time: '17:55:00', end_time: '19:25:00' },
  { id: 'slot5', slot_number: 5, start_time: '19:30:00', end_time: '21:00:00' },
];

export const FIXTURE_SUBJECTS = [
  { id: 'sub_kokugo', name: '国語' },
  { id: 'sub_sugaku', name: '数学' },
  { id: 'sub_eigo', name: '英語' },
  { id: 'sub_rika', name: '理科' },
  { id: 'sub_shakai', name: '社会' },
];

export const FIXTURE_TEACHERS = [
  { id: 't_sato', name: '佐藤 朱華', gender: 'female' as const, teachableSubjectIds: ['sub_kokugo', 'sub_eigo', 'sub_shakai'] },
  { id: 't_takigawa', name: '瀧川 怜生', gender: 'male' as const, teachableSubjectIds: ['sub_sugaku', 'sub_rika'] },
  { id: 't_sugiura', name: '杉浦 駿', gender: 'male' as const, teachableSubjectIds: ['sub_sugaku', 'sub_rika', 'sub_eigo'] },
  { id: 't_kitamura', name: '北村 由衣', gender: 'female' as const, teachableSubjectIds: ['sub_kokugo', 'sub_shakai'] },
  { id: 't_nishikan', name: '西舘 季紀', gender: 'male' as const, teachableSubjectIds: [] }, // 空=全科目可
  { id: 't_mizukami', name: '水上 歩乃歌', gender: 'female' as const, teachableSubjectIds: ['sub_eigo', 'sub_kokugo'] },
];

export interface FixtureOptions {
  seed?: number;
  /** 期間（既定 2026 夏期 8週） */
  startDate?: string;
  endDate?: string;
  /** 1講師あたり席数 / 教室席数 */
  maxStudentsPerTeacher?: number;
  totalIndividualSeats?: number;
  /** 可能表を未提出にする生徒を1人混ぜる（未割当理由のテスト用） */
  includeUnsubmittedStudent?: boolean;
}

/**
 * 現実に近い講習シナリオを1つ組み立てる。
 *
 * - 生徒10名（中3多め）。可能枠の広さに差をつける（制約の強い順が効くか見るため）
 * - 科目は1〜3、本数3〜8。一部を 1対1 / 45分にする
 * - 講師6名。日ごとに出勤する講師が変わる（シフト提出を模した粗密）
 */
export function buildFixtureInput(opts: FixtureOptions = {}): AllocatorInput {
  const {
    seed = 42,
    startDate = '2026-07-20',
    endDate = '2026-09-13',
    maxStudentsPerTeacher = 2,
    totalIndividualSeats = 12,
    includeUnsubmittedStudent = true,
  } = opts;

  const rnd = makeRng(seed);
  const dates = buildKoushuDates(startDate, endDate);
  const slots = FIXTURE_SLOTS;

  // ---- 生徒 ----
  const studentSeeds = [
    { id: 's_miyanaga', name: '宮永 心那', grade: 9 },
    { id: 's_inada', name: '稲田 葵', grade: 9 },
    { id: 's_sonoda', name: '園田 あいり', grade: 8 },
    { id: 's_ohashi', name: '大橋 穂乃梨', grade: 9 },
    { id: 's_kawahara', name: '川原 彩葉', grade: 9 },
    { id: 's_osaki', name: '大崎 透', grade: 6 },
    { id: 's_torii', name: '鳥居 宗生', grade: 6 },
    { id: 's_tajima', name: '田嶋 健', grade: 5 },
    { id: 's_kubota', name: '久保田 聡介', grade: 6 },
    { id: 's_nagai', name: '永井 祐吏', grade: 8 },
  ];

  const students = studentSeeds.map((s, i) => ({
    ...s,
    // 一部の生徒に固定講師・NG・性別希望を付ける
    fixedTeacherIds: i === 0 ? ['t_sato'] : i === 3 ? ['t_takigawa'] : [],
    excludedTeacherIds: i === 1 ? ['t_sugiura'] : [],
    preferredTeacherGender: i === 4 ? ('female' as const) : null,
  }));

  // ---- 生徒の出席可能枠（講習可能表の提出を模す） ----
  // density を生徒ごとに変え、「枠が狭い生徒」を意図的に作る（制約の強い順の検証）
  const studentAvailability = new Map<string, Set<CellKey>>();
  students.forEach((st, i) => {
    // 最後の生徒は未提出にする（未割当理由 no_availability_submission の検証）
    if (includeUnsubmittedStudent && i === students.length - 1) {
      return; // Map にエントリを作らない = 未提出
    }
    // 0.18〜0.6 の粗密。小学生は早いコマ、中学生は遅いコマ中心にする
    const density = 0.18 + rnd() * 0.42;
    const isElementary = st.grade <= 6;
    const set = new Set<CellKey>();
    for (const d of dates) {
      // 生徒ごとに「通える曜日」を絞る（週2〜4日）
      const dow = new Date(d + 'T12:00:00').getDay();
      const dowOk = (dow * 7 + i * 13) % 10 < 6; // 決定的な曜日フィルタ
      if (!dowOk) continue;
      for (const s of slots) {
        const slotFit = isElementary ? s.slot_number <= 3 : s.slot_number >= 2;
        if (!slotFit) continue;
        if (rnd() < density) set.add(cellKey(d, s.id));
      }
    }
    studentAvailability.set(st.id, set);
  });

  // ---- 講師の出勤可能（講習シフト提出を模す） ----
  const teacherAvailability = new Map<CellKey, string[]>();
  for (const d of dates) {
    const dow = new Date(d + 'T12:00:00').getDay();
    for (const s of slots) {
      const onDuty: string[] = [];
      FIXTURE_TEACHERS.forEach((t, ti) => {
        // 講師ごとに出勤しやすい曜日・コマの癖を決定的に作る
        const dowBias = (dow + ti * 3) % 7;
        if (dowBias >= 5) return; // 週2日は休み
        const slotBias = (s.slot_number + ti) % 5;
        if (slotBias === 0) return; // 1コマは外す
        if (rnd() < 0.72) onDuty.push(t.id);
      });
      teacherAvailability.set(cellKey(d, s.id), onDuty);
    }
  }

  // ---- 申込（タスク） ----
  const tasks: AllocatorInput['tasks'] = [];
  students.forEach((st, i) => {
    const subjCount = 1 + Math.floor(rnd() * 3); // 1〜3科目
    const pool = [...FIXTURE_SUBJECTS];
    for (let k = 0; k < subjCount; k++) {
      const pick = pool.splice(Math.floor(rnd() * pool.length), 1)[0];
      if (!pick) break;
      const koma = 3 + Math.floor(rnd() * 6); // 3〜8本
      // 決定的に一部を 1対1 / 45分にする
      const ratio: 1 | 2 = i % 5 === 0 && k === 0 ? 1 : 2;
      const duration: 45 | 90 = st.grade <= 6 && k === 0 ? 45 : 90;
      tasks.push({ studentId: st.id, subjectId: pick.id, koma, ratio, duration });
    }
  });

  // ---- 過去担当（内部スコアの +pastHistory 用） ----
  const pastTeacherByStudent = new Map<string, Set<string>>();
  students.forEach((st, i) => {
    pastTeacherByStudent.set(st.id, new Set([FIXTURE_TEACHERS[i % FIXTURE_TEACHERS.length].id]));
  });

  return {
    dates,
    slots,
    students,
    teachers: FIXTURE_TEACHERS,
    subjects: FIXTURE_SUBJECTS,
    tasks,
    studentAvailability,
    teacherAvailability,
    capacity: { maxStudentsPerTeacher, totalIndividualSeats },
    existing: [],
    settings: { ...DEFAULT_SETTINGS },
    pastTeacherByStudent,
  };
}

/**
 * 最小シナリオ（テストで制約を1つずつ確かめる用）。
 * 1日1コマ・講師1名・生徒2名など、手で結果を検算できる規模。
 */
export function buildMinimalInput(over: Partial<AllocatorInput> = {}): AllocatorInput {
  const base: AllocatorInput = {
    dates: ['2026-07-20', '2026-07-21', '2026-07-22'],
    slots: [
      { id: 'A', slot_number: 1, start_time: '16:20:00', end_time: '17:50:00' },
      { id: 'B', slot_number: 2, start_time: '17:55:00', end_time: '19:25:00' },
    ],
    students: [
      { id: 'S1', name: '生徒1', grade: 9 },
      { id: 'S2', name: '生徒2', grade: 9 },
    ],
    teachers: [{ id: 'T1', name: '講師1', gender: null, teachableSubjectIds: [] }],
    subjects: [{ id: 'X', name: '数学' }],
    tasks: [{ studentId: 'S1', subjectId: 'X', koma: 2, ratio: 2, duration: 90 }],
    studentAvailability: new Map([
      ['S1', new Set(['2026-07-20_A', '2026-07-20_B', '2026-07-21_A', '2026-07-22_A'])],
      ['S2', new Set(['2026-07-20_A', '2026-07-21_A'])],
    ]),
    teacherAvailability: new Map([
      ['2026-07-20_A', ['T1']],
      ['2026-07-20_B', ['T1']],
      ['2026-07-21_A', ['T1']],
      ['2026-07-22_A', ['T1']],
    ]),
    capacity: { maxStudentsPerTeacher: 2, totalIndividualSeats: 12 },
    existing: [],
    settings: { ...DEFAULT_SETTINGS },
  };
  return { ...base, ...over };
}
