/**
 * ダッシュボード「今日やること」の組み立て（build*）の純関数テスト。
 *
 * fetch 側（Supabase）は対象外。ここで固定したいのは
 *  - 当日の座席から拾う3種（欠勤・未配置・体験）の畳み方
 *  - 「今日来る生徒」との突き合わせ（来ない生徒の用事は出さない）
 *  - 期限の文言（あとN日 / 本日 / N日超過）
 *  - 並び順（時限つきが時間順で先頭、時限なしは期限超過が先）
 * の4点。UI 側が文言や件数に依存するため、仕様として固定する。
 */
import { describe, expect, it } from 'vitest';

import {
  buildMaterialTodos,
  buildReportTodos,
  buildSeatTodos,
  buildStudentAlertTodos,
  buildTaskTodos,
  buildTransferTodos,
} from '@/lib/api/todayTodos';
import type { SlotByStudentId } from '@/lib/api/todayTodos';
import type { Alert, StudentAlerts } from '@/types/alerts';
import type { MaterialOrderWithDetails } from '@/types/database';
import type { ScheduleEntry, ScheduleTimeSlot } from '@/types/schedule';
import { compareTodayTodos } from '@/types/today-todos';
import type { TodayTodoItem } from '@/types/today-todos';

const TODAY = '2026-08-31';
const SCHOOL = 'school1';

// ---------------------------------------------------------------
// テスト用ファクトリ
// ---------------------------------------------------------------

function makeSlot(id: string, slotNumber: number, start = '16:20:00', end = '17:40:00') {
  return {
    id,
    school_id: SCHOOL,
    slot_number: slotNumber,
    start_time: start,
    end_time: end,
    is_active: true,
    display_order: slotNumber,
    formation: 'individual',
    created_at: '',
    updated_at: '',
  } satisfies ScheduleTimeSlot;
}

const SLOT1 = makeSlot('slot1', 1, '16:20:00', '17:40:00');
const SLOT2 = makeSlot('slot2', 2, '17:50:00', '19:10:00');
const SLOTS = [SLOT1, SLOT2];

function makeEntry(over: Partial<ScheduleEntry> & { id: string }): ScheduleEntry {
  return {
    school_id: SCHOOL,
    entry_date: TODAY,
    time_slot_id: 'slot1',
    teacher_id: 'tA',
    student_id: null,
    subject_ids: [],
    seat_label: null,
    regular_pattern_id: null,
    kind: 'regular',
    formation: 'individual',
    ratio: 2,
    duration_minutes: null,
    half_position: null,
    attendance_status: null,
    status: 'scheduled',
    created_at: '',
    updated_at: '',
    ...over,
  } as ScheduleEntry;
}

/** 生徒つきのエントリ。student リレーションも同時に埋める。 */
function studentEntry(
  id: string,
  studentId: string,
  lastName: string,
  firstName: string,
  over: Partial<ScheduleEntry> = {}
): ScheduleEntry {
  return makeEntry({
    id,
    student_id: studentId,
    student: { id: studentId, last_name: lastName, first_name: firstName, grade: 8 },
    ...over,
  });
}

function makeAlert(over: Partial<Alert> & { id: string; alert_type: Alert['alert_type'] }): Alert {
  return {
    student_id: 'stu1',
    student_name: '田中太郎',
    grade: 8,
    alert_key: 'k',
    message: 'メッセージ',
    ...over,
  } as Alert;
}

function alertGroup(studentId: string, name: string, alerts: Alert[]): StudentAlerts {
  return { student_id: studentId, student_name: name, grade: 8, alerts };
}

const SLOT_BY_STUDENT: SlotByStudentId = new Map([
  ['stu1', { slotNumber: 1, slotTime: '16:20〜17:40' }],
  ['stu2', { slotNumber: 2, slotTime: '17:50〜19:10' }],
]);

// ---------------------------------------------------------------
// 1. 当日の座席
// ---------------------------------------------------------------

describe('buildSeatTodos', () => {
  it('欠勤は対象の生徒数つきで出る（代講の規模が分かること）', () => {
    const entries = [
      studentEntry('e1', 'stu1', '田中', '太郎'),
      studentEntry('e2', 'stu2', '鈴木', '花子'),
      // 別コマなので対象外
      studentEntry('e3', 'stu3', '佐藤', '次郎', { time_slot_id: 'slot2' }),
    ];
    const items = buildSeatTodos({
      entries,
      absenceKeySet: new Set([`${TODAY}|slot1|tA`]),
      timeSlots: SLOTS,
      teacherNameById: new Map([['tA', '山田']]),
      today: TODAY,
    });

    const absence = items.find((i) => i.label === '欠勤');
    expect(absence).toBeDefined();
    expect(absence?.id).toBe(`absence:${TODAY}|slot1|tA`);
    expect(absence?.title).toBe('1限 山田先生が欠勤 — 代講の手配か振替の調整');
    expect(absence?.note).toBe('対象の生徒2名');
    expect(absence?.slotNumber).toBe(1);
    expect(absence?.urgency).toBe('high');
  });

  it('欠勤コマに授業が無ければ「このコマの授業はなし」', () => {
    const items = buildSeatTodos({
      entries: [],
      absenceKeySet: new Set([`${TODAY}|slot2|tB`]),
      timeSlots: SLOTS,
      teacherNameById: new Map(),
      today: TODAY,
    });
    expect(items[0].note).toBe('このコマの授業はなし');
    // 講師名が引けない場合は「講師」でフォールバック
    expect(items[0].title).toContain('2限 講師先生が欠勤');
  });

  it('未配置は時限ごとに1件へまとまり、生徒名は最大3名＋ほかN名', () => {
    const entries = [
      studentEntry('u1', 'a', '青木', '一', { teacher_id: '' }),
      studentEntry('u2', 'b', '井上', '二', { teacher_id: '' }),
      studentEntry('u3', 'c', '上野', '三', { teacher_id: '' }),
      studentEntry('u4', 'd', '江藤', '四', { teacher_id: '' }),
      // 別コマ → 別の1件になる
      studentEntry('u5', 'e', '尾崎', '五', { teacher_id: '', time_slot_id: 'slot2' }),
    ];
    const items = buildSeatTodos({
      entries,
      absenceKeySet: new Set(),
      timeSlots: SLOTS,
      teacherNameById: new Map(),
      today: TODAY,
    });

    const unplaced = items.filter((i) => i.label === '未配置');
    expect(unplaced).toHaveLength(2);

    const slot1 = unplaced.find((i) => i.slotNumber === 1);
    expect(slot1?.id).toBe(`unplaced:${TODAY}|slot1`);
    expect(slot1?.title).toBe('1限の担当講師が未定（4名）');
    expect(slot1?.note).toBe('青木一、井上二、上野三ほか1名');

    const slot2 = unplaced.find((i) => i.slotNumber === 2);
    expect(slot2?.title).toBe('2限の担当講師が未定（1名）');
    expect(slot2?.note).toBe('尾崎五');
  });

  it('体験は生徒名つきで1件ずつ出る（未入会は inquiry 名でフォールバック）', () => {
    const entries = [
      studentEntry('t1', 'stu1', '田中', '太郎', {
        kind: 'trial',
        subjects: [{ id: 's', name: '数学' }],
      }),
      makeEntry({
        id: 't2',
        kind: 'trial',
        time_slot_id: 'slot2',
        inquiry_id: 'inq1',
        inquiry: { id: 'inq1', student_name: '山本見込', student_name_kana: null, grade: null },
      }),
      // 生徒名がどこにも無い体験
      makeEntry({ id: 't3', kind: 'trial', time_slot_id: 'slot2' }),
    ];
    const items = buildSeatTodos({
      entries,
      absenceKeySet: new Set(),
      timeSlots: SLOTS,
      teacherNameById: new Map(),
      today: TODAY,
    });

    const trials = items.filter((i) => i.label === '体験');
    expect(trials).toHaveLength(3);

    const withStudent = trials.find((i) => i.id === 'trial:t1');
    expect(withStudent?.title).toBe('体験授業 田中太郎さん — 教材の準備と保護者対応');
    expect(withStudent?.note).toBe('数学');
    expect(withStudent?.student).toEqual({ id: 'stu1', name: '田中太郎', grade: 8 });
    expect(withStudent?.slotNumber).toBe(1);

    // 未入会の見込み客は student を持たせない（生徒詳細へ飛べないため）
    const inquiryTrial = trials.find((i) => i.id === 'trial:t2');
    expect(inquiryTrial?.title).toContain('山本見込さん');
    expect(inquiryTrial?.student).toBeUndefined();

    expect(trials.find((i) => i.id === 'trial:t3')?.title).toContain('（氏名未登録）さん');
  });

  it('cancelled と transferred_out のエントリは全て無視される', () => {
    const entries = [
      // 欠勤コマの生徒数にも数えない
      studentEntry('c1', 'stu1', '田中', '太郎', { status: 'cancelled' }),
      studentEntry('c2', 'stu2', '鈴木', '花子', { status: 'transferred_out' }),
      // 未配置にも体験にもならない
      studentEntry('c3', 'stu3', '佐藤', '次郎', { status: 'cancelled', teacher_id: '' }),
      studentEntry('c4', 'stu4', '高橋', '四郎', { status: 'transferred_out', kind: 'trial' }),
    ];
    const items = buildSeatTodos({
      entries,
      absenceKeySet: new Set([`${TODAY}|slot1|tA`]),
      timeSlots: SLOTS,
      teacherNameById: new Map([['tA', '山田']]),
      today: TODAY,
    });

    expect(items.filter((i) => i.label === '未配置')).toHaveLength(0);
    expect(items.filter((i) => i.label === '体験')).toHaveLength(0);
    expect(items.find((i) => i.label === '欠勤')?.note).toBe('このコマの授業はなし');
  });
});

// ---------------------------------------------------------------
// 2. 生徒アラート
// ---------------------------------------------------------------

describe('buildStudentAlertTodos', () => {
  it('今日来ない生徒のアラートは除外される', () => {
    const items = buildStudentAlertTodos({
      studentAlerts: [
        alertGroup('stu1', '田中太郎', [
          makeAlert({ id: 'a1', alert_type: 'interview_overdue', student_id: 'stu1' }),
        ]),
        alertGroup('stu9', '来ない太郎', [
          makeAlert({ id: 'a9', alert_type: 'interview_overdue', student_id: 'stu9' }),
        ]),
      ],
      todayStudentIds: new Set(['stu1']),
      slotByStudentId: SLOT_BY_STUDENT,
    });

    expect(items).toHaveLength(1);
    expect(items[0].student?.id).toBe('stu1');
    expect(items[0].title).toBe('面談の日程を聞く');
    expect(items[0].slotNumber).toBe(1);
    expect(items[0].slotTime).toBe('16:20〜17:40');
    expect(items[0].href).toBe('/students/stu1');
  });

  it('interview_recent は用事ではないので除外される', () => {
    const items = buildStudentAlertTodos({
      studentAlerts: [
        alertGroup('stu1', '田中太郎', [
          makeAlert({ id: 'r1', alert_type: 'interview_recent', student_id: 'stu1' }),
          makeAlert({ id: 'r2', alert_type: 'score_missing', student_id: 'stu1' }),
        ]),
      ],
      todayStudentIds: new Set(['stu1']),
      slotByStudentId: SLOT_BY_STUDENT,
    });

    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('alert:r2');
    expect(items[0].title).toBe('通知表・テスト結果を見せてもらう');
  });

  it('application_overdue の note は あとN日 / 本日 / N日超過 の3パターン', () => {
    const build = (daysUntilDue: number, id: string) =>
      buildStudentAlertTodos({
        studentAlerts: [
          alertGroup('stu1', '田中太郎', [
            makeAlert({
              id,
              alert_type: 'application_overdue',
              student_id: 'stu1',
              details: {
                item_name: '夏期講習申込書',
                due_date: '2026-09-05',
                days_until_due: daysUntilDue,
              },
            }),
          ]),
        ],
        todayStudentIds: new Set(['stu1']),
        slotByStudentId: SLOT_BY_STUDENT,
      })[0];

    const soon = build(5, 'ap1');
    expect(soon.title).toBe('「夏期講習申込書」を渡す・回収する');
    expect(soon.note).toBe('締切 9/5（あと5日）');
    expect(soon.overdue).toBeUndefined();

    expect(build(0, 'ap2').note).toBe('締切 9/5（本日）');

    const late = build(-3, 'ap3');
    expect(late.note).toBe('締切 9/5（3日超過）');
    expect(late.overdue).toBe(true);
  });

  it('item_name が無い申込は汎用の行動文になり、severity が緊急度に写る', () => {
    const items = buildStudentAlertTodos({
      studentAlerts: [
        alertGroup('stu1', '田中太郎', [
          makeAlert({
            id: 'ap4',
            alert_type: 'application_overdue',
            student_id: 'stu1',
            severity: 'danger',
          }),
        ]),
      ],
      todayStudentIds: new Set(['stu1']),
      slotByStudentId: SLOT_BY_STUDENT,
    });

    expect(items[0].title).toBe('申込書を渡す・回収する');
    expect(items[0].urgency).toBe('high');
  });

  it('面談未更新は days_overdue から「前回面談から◯日」を出し overdue になる', () => {
    const items = buildStudentAlertTodos({
      studentAlerts: [
        alertGroup('stu2', '鈴木花子', [
          makeAlert({
            id: 'io1',
            alert_type: 'interview_overdue',
            student_id: 'stu2',
            student_name: '鈴木花子',
            severity: 'warning',
            details: { days_overdue: 45 },
          }),
        ]),
      ],
      todayStudentIds: new Set(['stu2']),
      slotByStudentId: SLOT_BY_STUDENT,
    });

    expect(items[0].note).toBe('前回面談から45日');
    expect(items[0].overdue).toBe(true);
    expect(items[0].urgency).toBe('medium');
    expect(items[0].slotNumber).toBe(2);
  });
});

// ---------------------------------------------------------------
// 3. 月次タスク
// ---------------------------------------------------------------

describe('buildTaskTodos', () => {
  it('今日が期日か期限超過だけを拾い、完了済み教室しかないタスクは出さない', () => {
    const items = buildTaskTodos({
      today: TODAY,
      tasks: [
        {
          id: 't1',
          task_date: TODAY,
          task_name: '請求データ確認',
          category: 'a',
          overdue: false,
          incompleteSchoolIds: [SCHOOL],
        },
        {
          id: 't2',
          task_date: '2026-08-28',
          task_name: '出勤簿の締め',
          category: 'a',
          overdue: true,
          incompleteSchoolIds: [SCHOOL],
        },
        // 未来の予定は今日の判断材料ではない
        {
          id: 't3',
          task_date: '2026-09-10',
          task_name: '来月の準備',
          category: 'a',
          overdue: false,
          incompleteSchoolIds: [SCHOOL],
        },
        // 全教室完了済み
        {
          id: 't4',
          task_date: TODAY,
          task_name: '完了済み',
          category: 'a',
          overdue: false,
          incompleteSchoolIds: [],
        },
      ],
    });

    expect(items.map((i) => i.id)).toEqual(['task:t1', 'task:t2']);
    expect(items[0].note).toBe('期限: 今日');
    expect(items[0].urgency).toBe('medium');
    expect(items[1].note).toBe('期限を3日超過');
    expect(items[1].urgency).toBe('high');
    expect(items[1].overdue).toBe(true);
    // 時間の決まっていない用事なので時限は付けない
    expect(items.every((i) => i.slotNumber === undefined)).toBe(true);
  });
});

// ---------------------------------------------------------------
// 4. 報告書
// ---------------------------------------------------------------

describe('buildReportTodos', () => {
  const target = (
    id: string,
    teacher: string
  ): Parameters<typeof buildReportTodos>[0]['overdueTargets'][number] => ({
    schedule_entry_id: id,
    entry_date: '2026-08-30',
    student_id: 's',
    teacher_id: 't',
    student_name: '生徒',
    student_grade: 8,
    teacher_name: teacher,
    slot_number: 1,
    report_id: null,
    report_status: null,
    days_overdue: 1,
  });

  it('未提出は1件に畳み、講師別内訳を件数の多い順で出す', () => {
    const items = buildReportTodos({
      overdueTargets: [target('a', '田中'), target('b', '田中'), target('c', '鈴木')],
      pendingCount: 0,
    });

    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('report-overdue');
    expect(items[0].title).toBe('昨日までの報告書が未提出 3件');
    expect(items[0].note).toBe('田中2・鈴木1');
    expect(items[0].overdue).toBe(true);
    expect(items[0].slotNumber).toBeUndefined();
  });

  it('講師が4人以上なら「ほか」で畳む', () => {
    const items = buildReportTodos({
      overdueTargets: [
        target('a', '田中'),
        target('b', '鈴木'),
        target('c', '佐藤'),
        target('d', '高橋'),
      ],
      pendingCount: 0,
    });
    expect(items[0].note?.endsWith('ほか')).toBe(true);
  });

  it('未提出0件なら行を作らず、承認待ちは件数があるときだけ出る', () => {
    expect(buildReportTodos({ overdueTargets: [], pendingCount: 0 })).toHaveLength(0);

    const items = buildReportTodos({ overdueTargets: [], pendingCount: 4 });
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('report-pending');
    expect(items[0].title).toBe('承認待ちの報告書 4件を確認する');
    expect(items[0].urgency).toBe('low');
  });
});

// ---------------------------------------------------------------
// 5. 振替
// ---------------------------------------------------------------

describe('buildTransferTodos', () => {
  it('今日来る生徒は個別に、来ない生徒はまとめて1件になる', () => {
    const entries = [
      studentEntry('tr1', 'stu1', '田中', '太郎', {
        status: 'transferred_out',
        transfer_deadline: '2026-09-30',
      }),
      studentEntry('tr2', 'stu8', '来ない', '花子', {
        status: 'transferred_out',
        transfer_deadline: '2026-09-10',
      }),
      studentEntry('tr3', 'stu9', '来ない', '次郎', {
        status: 'transferred_out',
        transfer_deadline: '2026-09-05',
      }),
    ];

    const items = buildTransferTodos({
      entries,
      todayStudentIds: new Set(['stu1']),
      slotByStudentId: SLOT_BY_STUDENT,
      today: TODAY,
    });

    const individual = items.find((i) => i.id === 'transfer:tr1');
    expect(individual?.title).toBe('田中太郎さんに振替の候補日を聞く');
    expect(individual?.note).toBe('振替期限 9/30（あと30日）');
    expect(individual?.urgency).toBe('medium');
    expect(individual?.slotNumber).toBe(1);

    const summary = items.find((i) => i.id === 'transfer-summary');
    expect(summary?.title).toBe('振替期限が近いコマ 2件 — 保護者へ候補日の連絡');
    expect(summary?.note).toBe('最短 9/5');
    expect(summary?.slotNumber).toBeUndefined();
  });

  it('残り3日以内・超過は high、超過は overdue になる', () => {
    const items = buildTransferTodos({
      entries: [
        studentEntry('tr4', 'stu1', '田中', '太郎', {
          status: 'transferred_out',
          transfer_deadline: '2026-09-02',
        }),
        studentEntry('tr5', 'stu2', '鈴木', '花子', {
          status: 'transferred_out',
          transfer_deadline: '2026-08-29',
        }),
      ],
      todayStudentIds: new Set(['stu1', 'stu2']),
      slotByStudentId: SLOT_BY_STUDENT,
      today: TODAY,
    });

    const soon = items.find((i) => i.id === 'transfer:tr4');
    expect(soon?.urgency).toBe('high');
    expect(soon?.note).toBe('振替期限 9/2（あと2日）');

    const late = items.find((i) => i.id === 'transfer:tr5');
    expect(late?.urgency).toBe('high');
    expect(late?.overdue).toBe(true);
    expect(late?.note).toBe('振替期限 8/29（2日超過）');
  });

  it('対象が全員今日来るなら まとめの1件は作らない', () => {
    const items = buildTransferTodos({
      entries: [
        studentEntry('tr6', 'stu1', '田中', '太郎', {
          status: 'transferred_out',
          transfer_deadline: '2026-09-30',
        }),
      ],
      todayStudentIds: new Set(['stu1']),
      slotByStudentId: SLOT_BY_STUDENT,
      today: TODAY,
    });
    expect(items.find((i) => i.id === 'transfer-summary')).toBeUndefined();
  });
});

// ---------------------------------------------------------------
// 6. 教材
// ---------------------------------------------------------------

describe('buildMaterialTodos', () => {
  const order = (
    id: string,
    studentId: string | null,
    materialName: string,
    lastName = '田中',
    firstName = '太郎'
  ) =>
    ({
      id,
      school_id: SCHOOL,
      material_id: `m-${id}`,
      student_id: studentId,
      is_sample: false,
      quantity: 1,
      status: 'delivered',
      ordered_at: null,
      delivered_at: null,
      distributed_at: null,
      notes: null,
      created_by: null,
      created_at: '',
      updated_at: '',
      material: { name: materialName },
      student: studentId
        ? { id: studentId, last_name: lastName, first_name: firstName, grade: 8 }
        : null,
    }) as unknown as MaterialOrderWithDetails;

  it('今日来る生徒のぶんだけ、生徒ごとに1件へ畳む', () => {
    const items = buildMaterialTodos({
      orders: [
        order('o1', 'stu1', '数学ワーク'),
        order('o2', 'stu1', '英語ワーク'),
        order('o3', 'stu1', '理科ワーク'),
        order('o4', 'stu2', '国語ワーク', '鈴木', '花子'),
        // 今日来ない生徒には渡せない
        order('o5', 'stu9', '社会ワーク', '来ない', '太郎'),
        // 生徒未指定（教室在庫）も対象外
        order('o6', null, '在庫用'),
      ],
      todayStudentIds: new Set(['stu1', 'stu2']),
      slotByStudentId: SLOT_BY_STUDENT,
    });

    expect(items).toHaveLength(2);

    const first = items.find((i) => i.id === 'material:stu1');
    expect(first?.title).toBe('発注済みの教材を渡す');
    expect(first?.note).toBe('数学ワーク、英語ワークほか1件');
    expect(first?.student).toEqual({ id: 'stu1', name: '田中太郎', grade: 8 });
    expect(first?.slotNumber).toBe(1);
    expect(first?.urgency).toBe('low');
    expect(first?.href).toBe('/ordering');

    expect(items.find((i) => i.id === 'material:stu2')?.note).toBe('国語ワーク');
  });
});

// ---------------------------------------------------------------
// 7. 並び順
// ---------------------------------------------------------------

describe('compareTodayTodos との組み合わせ', () => {
  it('時限つきが時限順で先頭、時限なしは後ろで期限超過が先に来る', () => {
    const seat = buildSeatTodos({
      entries: [studentEntry('e1', 'stu1', '田中', '太郎', { time_slot_id: 'slot2' })],
      absenceKeySet: new Set([`${TODAY}|slot2|tA`]),
      timeSlots: SLOTS,
      teacherNameById: new Map([['tA', '山田']]),
      today: TODAY,
    });
    const alerts = buildStudentAlertTodos({
      studentAlerts: [
        alertGroup('stu1', '田中太郎', [
          makeAlert({ id: 'x1', alert_type: 'score_missing', student_id: 'stu1' }),
        ]),
      ],
      todayStudentIds: new Set(['stu1']),
      // 1限に来る生徒 → 2限の欠勤より前に出る
      slotByStudentId: new Map([['stu1', { slotNumber: 1 }]]),
    });
    const tasks = buildTaskTodos({
      today: TODAY,
      tasks: [
        {
          id: 'n1',
          task_date: TODAY,
          task_name: '今日が期日',
          category: 'a',
          overdue: false,
          incompleteSchoolIds: [SCHOOL],
        },
        {
          id: 'n2',
          task_date: '2026-08-25',
          task_name: '超過',
          category: 'a',
          overdue: true,
          incompleteSchoolIds: [SCHOOL],
        },
      ],
    });

    const sorted: TodayTodoItem[] = [...tasks, ...seat, ...alerts].sort(compareTodayTodos);

    expect(sorted.map((i) => i.id)).toEqual([
      'alert:x1', // 1限
      `absence:${TODAY}|slot2|tA`, // 2限
      'task:n2', // 時限なし・期限超過
      'task:n1', // 時限なし
    ]);
  });
});
