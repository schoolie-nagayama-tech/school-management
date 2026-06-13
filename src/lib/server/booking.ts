/**
 * 面談セルフ予約: サーバー専用の予約ロジック。
 * google-calendar を import するため Edge/Client では使用不可。
 *
 * docs/inquiry-booking-requirements.md §5 (F1-3, F1-4) 参照
 */

import crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { listCalendarEvents } from '@/lib/google-calendar';
import { resolveBookingConfig, type BookingConfig } from '@/lib/utils/bookingConfig';
import type { InquirySchoolSettings } from '@/types/database';
// InquirySchoolSettings は SettingsForAvailability の booking_config 型に使う

// resolveBookingConfig を re-export して API ルートから import できるようにする
export { resolveBookingConfig } from '@/lib/utils/bookingConfig';

// ============================================================
// 公開型
// ============================================================

/** 面談の空き枠 1件 */
export interface InterviewSlot {
  /** JST 日付 'YYYY-MM-DD' */
  date: string;
  /** JST 開始時刻 'HH:mm' */
  startTime: string;
  /** 開始時刻の ISO 8601（+09:00 オフセット付き）。API レスポンス・重複判定に使う */
  startIso: string;
}

/** カレンダーの busy 区間（ISO 文字列） */
export interface BusyInterval {
  start: string;
  end: string;
}

// ============================================================
// 内部ヘルパー: JST 変換
// ============================================================

/**
 * UTC の Date を JST に変換し { year, month(1-based), day, hours, minutes, dow } を返す。
 * サーバーの TZ 設定に依存しない UTC+9 固定計算。
 */
function toJST(d: Date) {
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return {
    year: jst.getUTCFullYear(),
    month: jst.getUTCMonth() + 1,
    day: jst.getUTCDate(),
    hours: jst.getUTCHours(),
    minutes: jst.getUTCMinutes(),
    dow: jst.getUTCDay(), // 0=日
  };
}

/**
 * JST 日付文字列 'YYYY-MM-DD' と時刻 'HH:mm' から ISO 8601 (+09:00) 文字列を生成する。
 */
function toJstIso(date: string, time: string): string {
  return `${date}T${time}:00+09:00`;
}

/**
 * 'HH:mm' を「その日の分数(0=0:00)」に変換する。
 */
function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Date を 'YYYY-MM-DD'(JST) に変換する。
 */
function dateToJstDateStr(d: Date): string {
  const { year, month, day } = toJST(d);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// ============================================================
// generateInterviewSlots
// ============================================================

/**
 * 候補枠を生成し、busy・既存予約と重複するものを除外して返す。
 * 純関数なのでテストしやすい。
 *
 * @param config       resolveBookingConfig で解決した設定
 * @param busy         カレンダーの busy 区間（allDay 除外済みで渡すこと）
 * @param existingInterviewIso  同教室の既存 interview_at (ISO)。自分自身は除外して渡すこと。
 * @param now          現在時刻（テスト用に外から渡す）
 */
export function generateInterviewSlots(
  config: BookingConfig,
  busy: BusyInterval[],
  existingInterviewIso: string[],
  now: Date
): InterviewSlot[] {
  const durationMs = config.interview_duration_min * 60 * 1000;

  // earliest: now + lead_hours 時間後（ms）
  const earliestMs = now.getTime() + config.lead_hours * 60 * 60 * 1000;

  // 終端: now から window_days 日後の 23:59:59 JST
  const endDate = new Date(now.getTime() + config.window_days * 24 * 60 * 60 * 1000);
  const endDateStr = dateToJstDateStr(endDate);
  const endMs = new Date(`${endDateStr}T23:59:59+09:00`).getTime();

  const startMin = timeToMinutes(config.interview_start);
  const endMin = timeToMinutes(config.interview_end);

  // busy 区間を ms に変換してキャッシュ
  const busyMs = busy.map((b) => ({
    start: new Date(b.start).getTime(),
    end: new Date(b.end).getTime(),
  }));

  // 既存予約を ms に変換してキャッシュ
  const existingMs = existingInterviewIso.map((iso) => ({
    start: new Date(iso).getTime(),
    end: new Date(iso).getTime() + durationMs,
  }));

  const slots: InterviewSlot[] = [];

  // now の JST 日付から 1 日ずつ走査
  let cursor = new Date(now.getTime());
  // cursor をその日の 00:00 JST に揃える（切り捨て）
  const { year: y0, month: m0, day: d0 } = toJST(cursor);
  cursor = new Date(`${y0}-${String(m0).padStart(2, '0')}-${String(d0).padStart(2, '0')}T00:00:00+09:00`);

  while (cursor.getTime() <= endMs) {
    const dateStr = dateToJstDateStr(cursor);
    const { dow } = toJST(cursor);

    if (config.interview_days.includes(dow)) {
      // interview_start〜interview_end を duration_min 刻みで候補生成
      let slotMinute = startMin;
      while (slotMinute + config.interview_duration_min <= endMin) {
        const hh = String(Math.floor(slotMinute / 60)).padStart(2, '0');
        const mm = String(slotMinute % 60).padStart(2, '0');
        const slotStartIso = toJstIso(dateStr, `${hh}:${mm}`);
        const slotStartMs = new Date(slotStartIso).getTime();
        const slotEndMs = slotStartMs + durationMs;

        // earliest より前の枠はスキップ
        if (slotStartMs < earliestMs) {
          slotMinute += config.interview_duration_min;
          continue;
        }

        // window 終端より後はスキップ
        if (slotStartMs > endMs) {
          slotMinute += config.interview_duration_min;
          continue;
        }

        // busy と重複チェック（枠の開始 < busy.end かつ 枠の終了 > busy.start）
        const busyConflict = busyMs.some(
          (b) => slotStartMs < b.end && slotEndMs > b.start
        );
        if (busyConflict) {
          slotMinute += config.interview_duration_min;
          continue;
        }

        // 既存予約と重複チェック（同一 duration で重なり）
        const existingConflict = existingMs.some(
          (e) => slotStartMs < e.end && slotEndMs > e.start
        );
        if (existingConflict) {
          slotMinute += config.interview_duration_min;
          continue;
        }

        slots.push({ date: dateStr, startTime: `${hh}:${mm}`, startIso: slotStartIso });
        slotMinute += config.interview_duration_min;
      }
    }

    // 翌日へ
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }

  return slots;
}

// ============================================================
// resolveBookingCalendarUserId
// ============================================================

/**
 * booking_config.calendar_email、またはその教室の notification_email / notification_emails と
 * google_calendar_tokens.calendar_email を照合して user_id を返す。
 * 見つからなければ null。
 *
 * createFurikaeCalendarEvents (google-calendar.ts:331〜) と同方式。
 */
export async function resolveBookingCalendarUserId(
  serviceClient: SupabaseClient,
  schoolId: string,
  config: BookingConfig
): Promise<string | null> {
  // 1) 全 calendar_email → user_id マッピングを取得
  const { data: tokens, error: tokensError } = await serviceClient
    .from('google_calendar_tokens')
    .select('user_id, calendar_email');

  if (tokensError || !tokens || tokens.length === 0) {
    console.log('[booking] calendar_tokens が見つかりません');
    return null;
  }

  // 2) config.calendar_email が指定されている場合はそれを優先
  if (config.calendar_email) {
    const target = config.calendar_email.toLowerCase();
    const matched = tokens.find(
      (t: { user_id: string; calendar_email: string | null }) =>
        t.calendar_email?.toLowerCase() === target
    );
    if (matched) return matched.user_id;
    console.log(`[booking] calendar_email(${config.calendar_email}) に一致するトークンがありません`);
    return null;
  }

  // 3) 未指定の場合は school の notification_email / notification_emails で照合
  const { data: school, error: schoolError } = await serviceClient
    .from('schools')
    .select('notification_email, notification_emails')
    .eq('id', schoolId)
    .maybeSingle();

  if (schoolError || !school) {
    console.log('[booking] 教室情報が取得できません:', schoolError?.message);
    return null;
  }

  const schoolEmails: string[] = [];
  if (school.notification_email) {
    schoolEmails.push((school.notification_email as string).toLowerCase());
  }
  if (Array.isArray(school.notification_emails)) {
    for (const e of school.notification_emails) {
      const lower = (e as string).toLowerCase();
      if (!schoolEmails.includes(lower)) schoolEmails.push(lower);
    }
  }

  if (schoolEmails.length === 0) {
    console.log('[booking] 教室にメールアドレスが設定されていません');
    return null;
  }

  const matched = tokens.find(
    (t: { user_id: string; calendar_email: string | null }) =>
      t.calendar_email && schoolEmails.includes(t.calendar_email.toLowerCase())
  );

  if (!matched) {
    console.log('[booking] 教室メールと一致する calendar_token がありません');
    return null;
  }

  return matched.user_id;
}

// ============================================================
// getInterviewAvailability
// ============================================================

/** getInterviewAvailability に渡す inquiry の最小フィールド */
export interface InquiryForAvailability {
  id: string;
  school_id: string;
}

/** getInterviewAvailability に渡す settings の最小フィールド */
export interface SettingsForAvailability {
  booking_config: InquirySchoolSettings['booking_config'];
}

/**
 * 指定した inquiry の面談空き枠を算出する。
 *
 * @returns slots: 空き枠配列、calendarConnected: カレンダー取得が成功したか
 */
export async function getInterviewAvailability(
  serviceClient: SupabaseClient,
  inquiry: InquiryForAvailability,
  settings: SettingsForAvailability | null
): Promise<{ slots: InterviewSlot[]; calendarConnected: boolean }> {
  const config = resolveBookingConfig(settings?.booking_config ?? null);
  const now = new Date();

  // earliest と endISO を算出（カレンダー取得の範囲）
  const earliestMs = now.getTime() + config.lead_hours * 60 * 60 * 1000;
  const earliestDate = new Date(earliestMs);
  const earliestIso = earliestDate.toISOString();

  const endDate = new Date(now.getTime() + config.window_days * 24 * 60 * 60 * 1000);
  // window 終端の JST 23:59:59
  const endDateStr = dateToJstDateStr(endDate);
  const endIso = new Date(`${endDateStr}T23:59:59+09:00`).toISOString();

  let busy: BusyInterval[] = [];
  let calendarConnected = false;

  // カレンダー busy 取得
  const userId = await resolveBookingCalendarUserId(serviceClient, inquiry.school_id, config);
  if (userId) {
    const calResult = await listCalendarEvents(userId, earliestIso, endIso);
    if (calResult.success && calResult.events) {
      calendarConnected = true;
      // allDay イベントはブロックしない仕様なので除外
      busy = calResult.events
        .filter((e) => !e.allDay)
        .map((e) => ({ start: e.start, end: e.end }));
    } else {
      console.warn('[booking] カレンダー取得失敗（グレースフルデグレード）:', calResult.error);
    }
  }

  // 同教室の既存 interview_at を取得（自身は除外）
  const { data: existingRows, error: existingError } = await serviceClient
    .from('inquiries')
    .select('interview_at')
    .eq('school_id', inquiry.school_id)
    .not('interview_at', 'is', null)
    .neq('id', inquiry.id)
    .limit(1000);

  if (existingError) {
    console.warn('[booking] 既存予約取得失敗:', existingError.message);
  }

  const existingInterviewIso: string[] = (existingRows || [])
    .map((r: { interview_at: string | null }) => r.interview_at)
    .filter((v): v is string => typeof v === 'string');

  const slots = generateInterviewSlots(config, busy, existingInterviewIso, now);
  return { slots, calendarConnected };
}

// ============================================================
// generateBookingToken
// ============================================================

/**
 * URL に安全な予約トークンを生成する。
 * crypto.randomBytes(24).toString('base64url') = 32 文字 (base64url)
 */
export function generateBookingToken(): string {
  return crypto.randomBytes(24).toString('base64url');
}
