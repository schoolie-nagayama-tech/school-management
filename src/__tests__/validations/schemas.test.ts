import {
  studentSchema,
  userInviteSchema,
  bulletinPostSchema,
  portalFormResponseSchema,
  interviewSchema,
  courseSchema,
  validate,
} from '@/lib/validations/schemas';

describe('studentSchema', () => {
  const validStudent = {
    last_name: '山田',
    first_name: '太郎',
    grade: 3,
    status: 'active' as const,
  };

  it('有効なデータを受け入れる', () => {
    expect(studentSchema.safeParse(validStudent).success).toBe(true);
  });

  it('姓が空だとエラー', () => {
    const result = studentSchema.safeParse({ ...validStudent, last_name: '' });
    expect(result.success).toBe(false);
  });

  it('名が空だとエラー', () => {
    const result = studentSchema.safeParse({ ...validStudent, first_name: '' });
    expect(result.success).toBe(false);
  });

  it('gradeが整数でないとエラー', () => {
    const result = studentSchema.safeParse({ ...validStudent, grade: 3.5 });
    expect(result.success).toBe(false);
  });

  it('無効なstatusはエラー', () => {
    const result = studentSchema.safeParse({ ...validStudent, status: 'unknown' });
    expect(result.success).toBe(false);
  });

  it('オプションフィールドは空文字を許可', () => {
    const result = studentSchema.safeParse({
      ...validStudent,
      last_name_kana: '',
      school_name: '',
    });
    expect(result.success).toBe(true);
  });
});

describe('userInviteSchema', () => {
  const validInvite = {
    email: 'test@example.com',
    display_name: 'テストユーザー',
    role: 'teacher' as const,
    schoolId: 'school-123',
  };

  it('有効なデータを受け入れる', () => {
    expect(userInviteSchema.safeParse(validInvite).success).toBe(true);
  });

  it('無効なメールアドレスはエラー', () => {
    const result = userInviteSchema.safeParse({ ...validInvite, email: 'invalid' });
    expect(result.success).toBe(false);
  });

  it('無効なroleはエラー', () => {
    const result = userInviteSchema.safeParse({ ...validInvite, role: 'superuser' });
    expect(result.success).toBe(false);
  });
});

describe('bulletinPostSchema', () => {
  it('有効なデータを受け入れる', () => {
    const result = bulletinPostSchema.safeParse({ title: 'テスト', content: '本文' });
    expect(result.success).toBe(true);
  });

  it('タイトルが201文字以上でエラー', () => {
    const result = bulletinPostSchema.safeParse({ title: 'あ'.repeat(201), content: '本文' });
    expect(result.success).toBe(false);
  });

  it('本文が空だとエラー', () => {
    const result = bulletinPostSchema.safeParse({ title: 'テスト', content: '' });
    expect(result.success).toBe(false);
  });
});

describe('portalFormResponseSchema', () => {
  const validResponse = {
    school_id: '550e8400-e29b-41d4-a716-446655440000',
    form_type: 'moshi',
    form_period: '2026-04',
    student_name: '山田太郎',
    grade: 3,
    response_data: { choice: 'A' },
  };

  it('有効なデータを受け入れる', () => {
    expect(portalFormResponseSchema.safeParse(validResponse).success).toBe(true);
  });

  it('school_idがUUIDでないとエラー', () => {
    const result = portalFormResponseSchema.safeParse({ ...validResponse, school_id: 'not-uuid' });
    expect(result.success).toBe(false);
  });

  it('gradeが範囲外だとエラー', () => {
    const result = portalFormResponseSchema.safeParse({ ...validResponse, grade: 25 });
    expect(result.success).toBe(false);
  });

  it('emailは空文字を許可', () => {
    const result = portalFormResponseSchema.safeParse({ ...validResponse, email: '' });
    expect(result.success).toBe(true);
  });

  it('無効なemailはエラー', () => {
    const result = portalFormResponseSchema.safeParse({ ...validResponse, email: 'bad' });
    expect(result.success).toBe(false);
  });
});

describe('interviewSchema', () => {
  it('有効なデータを受け入れる', () => {
    const result = interviewSchema.safeParse({
      student_id: '550e8400-e29b-41d4-a716-446655440000',
      school_id: '550e8400-e29b-41d4-a716-446655440001',
      interview_date: '2026-04-08',
    });
    expect(result.success).toBe(true);
  });

  it('student_idがUUIDでないとエラー', () => {
    const result = interviewSchema.safeParse({
      student_id: 'bad',
      school_id: '550e8400-e29b-41d4-a716-446655440001',
      interview_date: '2026-04-08',
    });
    expect(result.success).toBe(false);
  });
});

describe('courseSchema', () => {
  it('有効なデータを受け入れる', () => {
    const result = courseSchema.safeParse({
      name: '夏期講習',
      school_id: '550e8400-e29b-41d4-a716-446655440000',
      start_date: '2026-07-20',
      end_date: '2026-08-31',
    });
    expect(result.success).toBe(true);
  });
});

describe('validate ヘルパー', () => {
  it('成功時はdataを返す', () => {
    const result = validate(bulletinPostSchema, { title: 'テスト', content: '本文' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe('テスト');
    }
  });

  it('失敗時はエラーメッセージ配列を返す', () => {
    const result = validate(bulletinPostSchema, { title: '', content: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });
});
