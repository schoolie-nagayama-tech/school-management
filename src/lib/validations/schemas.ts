import { z } from 'zod';

// ── 共通 ──

/** 空文字列を許可する optional string */
const optionalString = z.string().optional().or(z.literal(''));

// ── 生徒 ──

export const studentSchema = z.object({
  last_name: z.string().min(1, '姓は必須です'),
  first_name: z.string().min(1, '名は必須です'),
  last_name_kana: optionalString,
  first_name_kana: optionalString,
  grade: z.number({ required_error: '学年を選択してください' }).int(),
  status: z.enum(['active', 'inactive', 'withdrawn'], {
    required_error: '在籍状況を選択してください',
  }),
  school_name: optionalString,
  class_name: optionalString,
  club: optionalString,
  student_code: optionalString,
  subject_ids: z.array(z.string()).optional(),
});

export type StudentFormData = z.infer<typeof studentSchema>;

// ── ユーザー招待 ──

export const userInviteSchema = z.object({
  email: z.string().min(1, 'メールアドレスは必須です').email('有効なメールアドレスを入力してください'),
  display_name: z.string().min(1, '表示名は必須です'),
  role: z.enum(['admin', 'owner', 'manager', 'teacher'], {
    required_error: '役割を選択してください',
  }),
  schoolId: z.string().min(1, '教室を選択してください'),
});

export type UserInviteFormData = z.infer<typeof userInviteSchema>;

// ── 掲示板投稿 ──

export const bulletinPostSchema = z.object({
  title: z.string().min(1, 'タイトルは必須です').max(200, 'タイトルは200文字以内にしてください'),
  content: z.string().min(1, '本文は必須です'),
  is_important: z.boolean().optional(),
});

export type BulletinPostFormData = z.infer<typeof bulletinPostSchema>;

// ── ポータル フォーム送信 ──

export const portalFormResponseSchema = z.object({
  school_id: z.string().uuid('無効な教室IDです'),
  form_type: z.string().min(1, 'フォーム種別は必須です'),
  form_period: z.string().min(1, 'フォーム期間は必須です'),
  student_name: z.string().min(1, '生徒名は必須です'),
  grade: z.number().int().min(-2).max(20),
  email: z.string().email('有効なメールアドレスを入力してください').optional().or(z.literal('')),
  response_data: z.record(z.unknown()),
});

export type PortalFormResponseData = z.infer<typeof portalFormResponseSchema>;

// ── 面談 ──

export const interviewSchema = z.object({
  student_id: z.string().uuid(),
  school_id: z.string().uuid(),
  interview_date: z.string().min(1, '日付は必須です'),
  interview_type: z.enum(['regular', 'special', 'emergency']).optional(),
  notes: optionalString,
  is_task: z.boolean().optional(),
});

export type InterviewFormData = z.infer<typeof interviewSchema>;

// ── 講習設定 ──

export const courseSchema = z.object({
  name: z.string().min(1, '講習名は必須です'),
  school_id: z.string().uuid('教室を選択してください'),
  start_date: z.string().min(1, '開始日は必須です'),
  end_date: z.string().min(1, '終了日は必須です'),
  description: optionalString,
});

export type CourseFormData = z.infer<typeof courseSchema>;

// ── バリデーションヘルパー ──

/**
 * Zodスキーマでデータを検証し、エラーメッセージの配列を返す。
 * 検証成功時は空配列を返す。
 */
export function validate<T>(schema: z.ZodType<T>, data: unknown): { success: true; data: T } | { success: false; errors: string[] } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const errors = result.error.issues.map((issue) => {
    const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    return `${path}${issue.message}`;
  });
  return { success: false, errors };
}
