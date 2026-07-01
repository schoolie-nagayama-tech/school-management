/**
 * 問合せメール送信 API 層。
 * 対象テーブル: inquiry_mail_templates / inquiry_mail_logs / inquiry_school_settings
 *
 * Edge Function 'send-inquiry-mail' を呼び出し、送信ログを記録する。
 * verify_jwt=true のため、ログイン中の管理者が invoke すると自動で JWT が付く。
 */

import { supabase } from '../supabase';
import type {
  InquiryMailTemplate,
  InquiryMailTemplateInsert,
  InquiryMailTemplateUpdate,
  InquiryMailLog,
  InquiryMailLogInsert,
  InquirySchoolSettings,
  Inquiry,
} from '@/types/database';
import { fetchAllPaged } from '@/lib/utils/supabasePaging';

// ============================================================
// テンプレート CRUD
// ============================================================

/**
 * 指定教室 + 全教室共通(school_id=null) のテンプレート一覧を返す。
 * sort_order 昇順 → name 昇順 でソート。
 * テンプレート数は少量なので全件取得してクライアントでフィルタする。
 *
 * @param schoolId 単一または複数の school_id（省略時は共通テンプレのみ）
 */
export async function getMailTemplates(
  schoolId?: string | string[]
): Promise<InquiryMailTemplate[]> {
  const { data, error } = await supabase
    .from('inquiry_mail_templates')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (error) {
    throw new Error(`メールテンプレートの取得に失敗しました: ${error.message}`);
  }

  const all = (data || []) as InquiryMailTemplate[];

  // schoolId が指定されていない場合は全教室共通のみ
  if (!schoolId) {
    return all.filter((t) => t.school_id === null);
  }

  const ids = Array.isArray(schoolId) ? schoolId : [schoolId];

  // school_id=null(全教室共通) または 指定教室 のいずれか
  return all.filter((t) => t.school_id === null || ids.includes(t.school_id));
}

/**
 * テンプレートを新規作成する。
 */
export async function createMailTemplate(
  data: InquiryMailTemplateInsert
): Promise<InquiryMailTemplate> {
  const { data: created, error } = await supabase
    .from('inquiry_mail_templates')
    .insert(data)
    .select()
    .single();

  if (error) {
    throw new Error(`テンプレートの作成に失敗しました: ${error.message}`);
  }

  return created as InquiryMailTemplate;
}

/**
 * テンプレートを更新する。
 */
export async function updateMailTemplate(
  id: string,
  data: InquiryMailTemplateUpdate
): Promise<InquiryMailTemplate> {
  const { data: updated, error } = await supabase
    .from('inquiry_mail_templates')
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error(`テンプレートの更新に失敗しました: ${error.message}`);
  }

  return updated as InquiryMailTemplate;
}

/**
 * テンプレートを物理削除する。
 */
export async function deleteMailTemplate(id: string): Promise<void> {
  const { error } = await supabase.from('inquiry_mail_templates').delete().eq('id', id);

  if (error) {
    throw new Error(`テンプレートの削除に失敗しました: ${error.message}`);
  }
}

// ============================================================
// 教室別設定
// ============================================================

/**
 * 教室別のメール送信設定を1件取得する。
 * レコードが存在しない場合は null を返す（PGRST116 は正常系）。
 */
export async function getInquirySchoolSettings(
  schoolId: string
): Promise<InquirySchoolSettings | null> {
  const { data, error } = await supabase
    .from('inquiry_school_settings')
    .select('*')
    .eq('school_id', schoolId)
    .single();

  if (error) {
    // PGRST116: 0行ヒット（設定未登録は正常）
    if (error.code === 'PGRST116') return null;
    throw new Error(`教室設定の取得に失敗しました: ${error.message}`);
  }

  return data as InquirySchoolSettings;
}

// ============================================================
// 変数差し込み（純関数）
// ============================================================

/**
 * 教室コード → 面談予約（Googleカレンダーの予約ページ）URL。
 * {面談設定URL} 変数の差し込み元。リンクは静的なので定数で持つ
 * （教室別設定への移設が必要になったら inquiry_school_settings に列追加）。
 */
export const INTERVIEW_BOOKING_URLS: Record<string, string> = {
  nagayama: 'https://calendar.app.google/YihD3Rrzw7ikrSYc8',
  horinouchi: 'https://calendar.app.google/braDFmT9VdN1c47n6',
  kiyose: 'https://calendar.app.google/mJ3H4DCtrK8FAesu8',
  ryokuentoshi: 'https://calendar.app.google/yFL3WgxgyVxYqtXs9',
};

/** 教室コードから面談予約URLを引く。未登録・未指定は空文字。 */
export function interviewBookingUrlForCode(code?: string | null): string {
  if (!code) return '';
  return INTERVIEW_BOOKING_URLS[code] ?? '';
}

/** テンプレート本文に差し込む変数セット */
export interface InquiryMailVars {
  保護者: string;
  生徒: string;
  教室名: string;
  教室電話: string;
  署名: string;
  面談設定URL: string;
}

/**
 * {変数名} プレースホルダーを実値に置換する純関数。
 * 未知の {xxx} はそのまま残す。
 */
export function renderTemplate(text: string, vars: InquiryMailVars): string {
  return text
    .replace(/\{保護者\}/g, vars.保護者)
    .replace(/\{生徒\}/g, vars.生徒)
    .replace(/\{教室名\}/g, vars.教室名)
    .replace(/\{教室電話\}/g, vars.教室電話)
    .replace(/\{署名\}/g, vars.署名)
    .replace(/\{面談設定URL\}/g, vars.面談設定URL);
}

/**
 * Inquiry + 教室名 + 設定から変数セットを構築するヘルパー。
 *
 * - 保護者: guardian_name > student_name > 'お客様'
 * - 生徒:   student_name または空文字
 * - 教室名: settings.sender_name > schoolName
 * - 教室電話: settings.sender_tel または空文字
 * - 署名:   settings.mail_signature または空文字
 */
export function buildMailVars(
  inquiry: Inquiry,
  schoolName: string,
  settings: InquirySchoolSettings | null,
  /** 教室コード（{面談設定URL} の解決に使用）。未指定なら面談URLは空文字。 */
  schoolCode?: string | null
): InquiryMailVars {
  return {
    保護者: inquiry.guardian_name || inquiry.student_name || 'お客様',
    生徒: inquiry.student_name || '',
    教室名: settings?.sender_name || schoolName,
    教室電話: settings?.sender_tel || '',
    署名: settings?.mail_signature || '',
    面談設定URL: interviewBookingUrlForCode(schoolCode),
  };
}

// ============================================================
// 送信 + ログ
// ============================================================

export interface SendInquiryMailParams {
  inquiry: Inquiry;
  /** レンダリング済み件名（変数置換後） */
  subject: string;
  /** レンダリング済み本文（変数置換後） */
  body: string;
  /** 差出人名（未指定時: settings.sender_name || schoolName） */
  fromName?: string;
  /** 返信先メールアドレス（未指定時: settings.mail_reply_to） */
  replyTo?: string;
  /** 使用テンプレートID（手書き送信時は null） */
  templateId?: string | null;
}

/**
 * Edge Function 'send-inquiry-mail' を invoke してメールを送信し、
 * 結果を inquiry_mail_logs に記録する。
 *
 * - inquiry.email が未設定の場合は即 throw。
 * - invoke 失敗時は 'failed' ログを記録してから throw。
 * - invoke 成功時は 'sent' ログを記録。
 */
export async function sendInquiryMail(p: SendInquiryMailParams): Promise<void> {
  const { inquiry, subject, body, fromName, replyTo, templateId } = p;

  // 宛先チェック
  if (!inquiry.email) {
    throw new Error('メールアドレスがありません');
  }

  // Edge Function 呼び出し
  const { data, error } = await supabase.functions.invoke('send-inquiry-mail', {
    body: {
      to: inquiry.email,
      subject,
      body,
      ...(fromName ? { fromName } : {}),
      ...(replyTo ? { replyTo } : {}),
    },
  });

  // invoke 自体のエラー、または Function 内で返した error を検出
  const failed = !!error || (data && data.error);

  // ログ記録（送信成功・失敗どちらも残す）
  const logRow: InquiryMailLogInsert = {
    inquiry_id: inquiry.id,
    school_id: inquiry.school_id,
    template_id: templateId ?? null,
    method: 'email',
    subject,
    status: failed ? 'failed' : 'sent',
    sent_at: new Date().toISOString(),
    sent_by: null, // 必要であればクライアントで auth.uid を渡して記録可能
    // Resend が返す email ID を保存（Webhook での開封/クリック突合キー）
    resend_email_id: !failed && data && data.id ? (data.id as string) : null,
  };

  await supabase.from('inquiry_mail_logs').insert(logRow);

  // 失敗時は throw してコンポーネントにエラーを伝える
  if (failed) {
    const msg = error?.message || (data && data.error) || 'メール送信に失敗しました';
    throw new Error(msg);
  }
}

/**
 * 指定問合せの送信ログを取得する。
 * sent_at 降順で返す。
 */
export async function getMailLogs(inquiryId: string): Promise<InquiryMailLog[]> {
  const { data, error } = await supabase
    .from('inquiry_mail_logs')
    .select('*')
    .eq('inquiry_id', inquiryId)
    .order('sent_at', { ascending: false });

  if (error) {
    throw new Error(`送信履歴の取得に失敗しました: ${error.message}`);
  }

  return (data || []) as InquiryMailLog[];
}

/**
 * 指定教室群の送信記録を全件取得する（送信候補の既送判定用）。
 * 1000 件を超えるケースに備えて fetchAllPaged でページングする。
 *
 * @param schoolIds 対象の school_id 配列
 */
export async function getMailLogsBySchool(schoolIds: string[]): Promise<InquiryMailLog[]> {
  return fetchAllPaged<InquiryMailLog>((from, to) =>
    supabase
      .from('inquiry_mail_logs')
      .select('*')
      .in('school_id', schoolIds)
      .order('sent_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to)
  );
}
