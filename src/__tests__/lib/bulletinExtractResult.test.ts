/**
 * 講師のAIサポート: AIの抽出結果を受け取る側のテスト。
 *
 * ★ここで守りたいのは「AIの出力をそのまま信じない」こと。
 *   カタログを閉じている意味は検証する側が有限で済むことにあるので、
 *   一覧に無いものが素通りすると閉じた意味が無くなる。
 */
import { describe, expect, it } from 'vitest';
import {
  findReminderTarget,
  parseExtractedTasks,
  shouldUpdateDueDate,
  type ExtractedTask,
  type OpenTask,
} from '@/lib/bulletin/extractResult';

function raw(...tasks: Record<string, unknown>[]) {
  return { tasks };
}

const validTask = {
  kind: 'report_card_entry',
  scope: 'all_students',
  target_grades: [],
  due_type: 'date',
  due_date: '2026-07-31',
  reason: '「7/31まで」と書かれている',
};

describe('抽出結果の検証', () => {
  it('正しい1件はそのまま通る', () => {
    const got = parseExtractedTasks(raw(validTask));
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({
      kind: 'report_card_entry',
      scope: 'all_students',
      dueType: 'date',
      dueDate: '2026-07-31',
    });
  });

  it('タスクが無ければ空を返す', () => {
    expect(parseExtractedTasks({ tasks: [] })).toEqual([]);
  });

  it('形が違うものは空を返す（落ちない）', () => {
    expect(parseExtractedTasks(null)).toEqual([]);
    expect(parseExtractedTasks({})).toEqual([]);
    expect(parseExtractedTasks({ tasks: 'なんでもない' })).toEqual([]);
    expect(parseExtractedTasks({ tasks: [null, 3, 'x'] })).toEqual([]);
  });

  /** ★カタログを閉じている意味がここにある */
  it('一覧に無い種別は捨てる', () => {
    expect(parseExtractedTasks(raw({ ...validTask, kind: '教室の掃除' }))).toEqual([]);
  });

  it('一覧に無い対象は捨てる', () => {
    expect(parseExtractedTasks(raw({ ...validTask, scope: 'everyone' }))).toEqual([]);
  });
});

describe('期限の扱い', () => {
  it('存在しない日付は期限なしに落とす', () => {
    const got = parseExtractedTasks(raw({ ...validTask, due_date: '2026-02-31' }));
    expect(got[0]).toMatchObject({ dueType: 'none', dueDate: null });
  });

  it('形式が違う日付も期限なしに落とす', () => {
    const got = parseExtractedTasks(raw({ ...validTask, due_date: '7月31日' }));
    expect(got[0]).toMatchObject({ dueType: 'none', dueDate: null });
  });

  it('every は日付を持たない', () => {
    const got = parseExtractedTasks(
      raw({ ...validTask, kind: 'report_deadline', due_type: 'every', due_date: '2026-07-31' })
    );
    expect(got[0]).toMatchObject({ dueType: 'every', dueDate: null });
  });

  it('知らない期限の型は none にする', () => {
    const got = parseExtractedTasks(raw({ ...validTask, due_type: 'asap' }));
    expect(got[0].dueType).toBe('none');
  });
});

describe('対象学年', () => {
  it('scope=grade のときだけ学年を持つ', () => {
    const got = parseExtractedTasks(
      raw({ ...validTask, scope: 'grade', target_grades: [9, 7, 8, 7] })
    );
    // 重複を除いて昇順
    expect(got[0].targetGrades).toEqual([7, 8, 9]);
  });

  it('scope が grade でなければ学年は捨てる', () => {
    const got = parseExtractedTasks(
      raw({ ...validTask, scope: 'all_students', target_grades: [9] })
    );
    expect(got[0].targetGrades).toEqual([]);
  });

  it('範囲外や数値でない学年は捨てる', () => {
    const got = parseExtractedTasks(
      raw({ ...validTask, scope: 'grade', target_grades: [0, 14, '中3', 9, null] })
    );
    expect(got[0].targetGrades).toEqual([9]);
  });
});

/**
 * 通学校（target_school_names）の受け取り（2026-09-08）。
 * ★永山校の試用で「諏訪中生は」が specific_students・target_student_ids=[] に
 *   なった。scope=attending_school のときだけ対象の通学校を持つ。
 */
describe('対象の通学校', () => {
  it('scope=attending_school のときだけ通学校を持つ', () => {
    const got = parseExtractedTasks(
      raw({ ...validTask, scope: 'attending_school', target_school_names: ['諏訪中', '永山中'] })
    );
    expect(got[0].targetSchoolNames).toEqual(['諏訪中', '永山中']);
  });

  it('scope が attending_school でなければ通学校は捨てる', () => {
    const got = parseExtractedTasks(
      raw({ ...validTask, scope: 'all_students', target_school_names: ['諏訪中'] })
    );
    expect(got[0].targetSchoolNames).toEqual([]);
  });

  it('前後の空白を trim し、重複を除く', () => {
    const got = parseExtractedTasks(
      raw({
        ...validTask,
        scope: 'attending_school',
        target_school_names: [' 諏訪中 ', '諏訪中', '永山中'],
      })
    );
    expect(got[0].targetSchoolNames).toEqual(['諏訪中', '永山中']);
  });

  it('文字列でないもの・空文字・長すぎるものは捨てる', () => {
    const got = parseExtractedTasks(
      raw({
        ...validTask,
        scope: 'attending_school',
        target_school_names: ['諏訪中', 123, '', '  ', 'あ'.repeat(31)],
      })
    );
    expect(got[0].targetSchoolNames).toEqual(['諏訪中']);
  });

  it('10件を超える指定は先頭10件に切る', () => {
    const many = Array.from({ length: 15 }, (_, i) => `学校${i}`);
    const got = parseExtractedTasks(
      raw({ ...validTask, scope: 'attending_school', target_school_names: many })
    );
    expect(got[0].targetSchoolNames).toHaveLength(10);
  });

  it('通学校が違えば同じ種別でも別のタスクとして残す', () => {
    const got = parseExtractedTasks(
      raw(
        { ...validTask, scope: 'attending_school', target_school_names: ['諏訪中'] },
        { ...validTask, scope: 'attending_school', target_school_names: ['永山中'] }
      )
    );
    expect(got).toHaveLength(2);
  });
});

describe('生徒に紐づかない種別', () => {
  /**
   * ★シフト提出などは完了履歴の student_id が NULL になる種別。
   * 生徒向けの対象で配ると数えられなくなるので、種別のほうを優先する。
   */
  it.each([['shift_submit'], ['shift_check'], ['timesheet_entry']])(
    '%s は対象を teacher_self に矯正する',
    (kind) => {
      const got = parseExtractedTasks(raw({ ...validTask, kind, scope: 'all_students' }));
      expect(got[0].scope).toBe('teacher_self');
    }
  );
});

describe('重複と上限', () => {
  it('同じ種別×対象は1件にまとめる', () => {
    const got = parseExtractedTasks(raw(validTask, { ...validTask, reason: '別の書き方' }));
    expect(got).toHaveLength(1);
  });

  it('同じ種別でも対象が違えば別に残す', () => {
    const got = parseExtractedTasks(raw(validTask, { ...validTask, scope: 'assigned_students' }));
    expect(got).toHaveLength(2);
  });

  it('1投稿から取りすぎない（5件まで）', () => {
    const many = [
      { ...validTask, kind: 'report_card_entry' },
      { ...validTask, kind: 'test_result_entry' },
      { ...validTask, kind: 'goal_setting' },
      { ...validTask, kind: 'progress_entry' },
      { ...validTask, kind: 'material_handout_check' },
      { ...validTask, kind: 'owned_material_check' },
      { ...validTask, kind: 'test_prep_proposal' },
    ];
    expect(parseExtractedTasks(raw(...many))).toHaveLength(5);
  });

  it('理由は長すぎたら切る', () => {
    const got = parseExtractedTasks(raw({ ...validTask, reason: 'あ'.repeat(500) }));
    expect(got[0].reason.length).toBe(200);
  });
});

/**
 * ★根拠にした一文（source_excerpt）。
 *   「どこで読み間違えたか」を追うために、投稿の文を原文のまま残させている。
 *   要約や作文が混ざると追跡に使えないので、そう見えるものは捨てて空にする。
 */
describe('根拠にした一文', () => {
  it('そのまま受け取る', () => {
    const got = parseExtractedTasks(
      raw({ ...validTask, source_excerpt: '7/31までに通知表を回収してください' })
    );
    expect(got[0].sourceExcerpt).toBe('7/31までに通知表を回収してください');
  });

  it('前後の空白は落とす', () => {
    const got = parseExtractedTasks(raw({ ...validTask, source_excerpt: '  PCSを配布  ' }));
    expect(got[0].sourceExcerpt).toBe('PCSを配布');
  });

  it('改行は空白に潰す（カードの1行に収めるため）', () => {
    const got = parseExtractedTasks(raw({ ...validTask, source_excerpt: '通知表を\n回収' }));
    expect(got[0].sourceExcerpt).toBe('通知表を 回収');
  });

  /** ★長すぎるものは「そのまま写す」に従っていない。中途半端に残すより空にする */
  it('長すぎるものは捨てて空にする', () => {
    const got = parseExtractedTasks(raw({ ...validTask, source_excerpt: 'あ'.repeat(61) }));
    expect(got[0].sourceExcerpt).toBe('');
  });

  it('無い・文字列でないときは空', () => {
    expect(parseExtractedTasks(raw(validTask))[0].sourceExcerpt).toBe('');
    expect(parseExtractedTasks(raw({ ...validTask, source_excerpt: 3 }))[0].sourceExcerpt).toBe('');
    expect(parseExtractedTasks(raw({ ...validTask, source_excerpt: '   ' }))[0].sourceExcerpt).toBe(
      ''
    );
  });
});

describe('再掲のまとめ方', () => {
  const task: ExtractedTask = {
    kind: 'report_card_entry',
    scope: 'all_students',
    targetGrades: [],
    targetSchoolNames: [],
    dueType: 'date',
    dueDate: '2026-08-10',
    reason: '',
    sourceExcerpt: '',
  };
  const open: OpenTask[] = [
    { id: 'a', kind: 'report_card_entry', scope: 'all_students', dueDate: '2026-07-31' },
    { id: 'b', kind: 'progress_entry', scope: 'assigned_students', dueDate: null },
  ];

  /**
   * ★同じ依頼が繰り返し投稿される（清瀬校だけで4回）。
   * 投稿ごとに別タスクを作ると進捗が投稿のたびにリセットされる。
   */
  it('種別と対象が同じなら既存のタスクに束ねる', () => {
    expect(findReminderTarget(task, open)?.id).toBe('a');
  });

  /** ★期限は再掲のたびに延びるので、突き合わせの条件に入れない */
  it('期限が違っても同じタスクとみなす', () => {
    expect(task.dueDate).not.toBe(open[0].dueDate);
    expect(findReminderTarget(task, open)?.id).toBe('a');
  });

  it('対象が違えば別のタスクとして作る', () => {
    const other: ExtractedTask = { ...task, scope: 'assigned_students' };
    expect(findReminderTarget(other, open)).toBeNull();
  });

  it('種別が違えば別のタスクとして作る', () => {
    const other: ExtractedTask = { ...task, kind: 'goal_setting' };
    expect(findReminderTarget(other, open)).toBeNull();
  });

  it('既存が無ければ新規作成', () => {
    expect(findReminderTarget(task, [])).toBeNull();
  });

  /** ★「諏訪中生は」と「永山中生は」は同じ種別でも母数が別の依頼なので束ねない */
  it('通学校が違えば別のタスクとして作る', () => {
    const withSchool: ExtractedTask = {
      ...task,
      scope: 'attending_school',
      targetSchoolNames: ['諏訪中'],
    };
    const openWithSchool: OpenTask[] = [
      {
        id: 'c',
        kind: 'report_card_entry',
        scope: 'attending_school',
        dueDate: null,
        targetSchoolNames: ['永山中'],
      },
    ];
    expect(findReminderTarget(withSchool, openWithSchool)).toBeNull();
  });

  it('通学校が同じなら既存のタスクに束ねる（順序は無視する）', () => {
    const withSchools: ExtractedTask = {
      ...task,
      scope: 'attending_school',
      targetSchoolNames: ['永山中', '諏訪中'],
    };
    const openWithSchools: OpenTask[] = [
      {
        id: 'd',
        kind: 'report_card_entry',
        scope: 'attending_school',
        dueDate: null,
        targetSchoolNames: ['諏訪中', '永山中'],
      },
    ];
    expect(findReminderTarget(withSchools, openWithSchools)?.id).toBe('d');
  });
});

describe('再掲で期限が変わったか', () => {
  const base: ExtractedTask = {
    kind: 'report_card_entry',
    scope: 'all_students',
    targetGrades: [],
    targetSchoolNames: [],
    dueType: 'date',
    dueDate: '2026-08-10',
    reason: '',
    sourceExcerpt: '',
  };
  const target: OpenTask = {
    id: 'a',
    kind: 'report_card_entry',
    scope: 'all_students',
    dueDate: '2026-07-31',
  };

  it('延びていれば更新する', () => {
    expect(shouldUpdateDueDate(base, target)).toBe(true);
  });

  it('前倒しでも更新する', () => {
    expect(shouldUpdateDueDate({ ...base, dueDate: '2026-07-20' }, target)).toBe(true);
  });

  it('同じなら更新しない', () => {
    expect(shouldUpdateDueDate({ ...base, dueDate: '2026-07-31' }, target)).toBe(false);
  });

  it('期限が書かれていない再掲では、既存の期限を消さない', () => {
    expect(shouldUpdateDueDate({ ...base, dueType: 'none', dueDate: null }, target)).toBe(false);
  });
});
