/**
 * 面談セルフ予約の設定型と既定値。
 * クライアント・サーバー両用の純関数のみ（google-calendar は import しない）。
 *
 * docs/inquiry-booking-requirements.md §4 booking_config 参照
 */

export interface BookingConfig {
  /** 空き判定・イベント作成に使う教室長の Google アカウント。null=school 照合の先頭 */
  calendar_email: string | null;
  /** 面談受付の曜日 0=日〜6=土。既定は火〜土 */
  interview_days: number[];
  /** 面談受付の開始時刻 HH:mm */
  interview_start: string;
  /** 面談受付の終了時刻 HH:mm（枠の終了がこれを超えない） */
  interview_end: string;
  /** 1枠の分数 */
  interview_duration_min: number;
  /** 何時間先から予約可 */
  lead_hours: number;
  /** 何日先まで（今日を含まず now + window_days 日後まで） */
  window_days: number;
}

/** DB の booking_config(jsonb) が設定されていない場合の既定値 */
export const DEFAULT_BOOKING_CONFIG: BookingConfig = {
  calendar_email: null,
  interview_days: [2, 3, 4, 5, 6], // 火〜土
  interview_start: '14:00',
  interview_end: '21:00',
  interview_duration_min: 60,
  lead_hours: 24,
  window_days: 14,
};

/**
 * DB の booking_config(jsonb) を既定値とマージして返す。
 * 型不正・想定外の値は既定にフォールバックして厳密に扱う。
 */
export function resolveBookingConfig(raw: unknown): BookingConfig {
  const def = DEFAULT_BOOKING_CONFIG;

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...def };
  }

  const r = raw as Record<string, unknown>;

  // calendar_email: string | null
  const calendarEmail =
    typeof r.calendar_email === 'string'
      ? r.calendar_email || null
      : r.calendar_email === null
        ? null
        : def.calendar_email;

  // interview_days: number[] (各要素が 0-6 の整数)
  const interviewDays =
    Array.isArray(r.interview_days) &&
    r.interview_days.every((d) => typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6)
      ? (r.interview_days as number[])
      : def.interview_days;

  // interview_start: 'HH:mm' 形式
  const interviewStart =
    typeof r.interview_start === 'string' && /^\d{2}:\d{2}$/.test(r.interview_start)
      ? r.interview_start
      : def.interview_start;

  // interview_end: 'HH:mm' 形式
  const interviewEnd =
    typeof r.interview_end === 'string' && /^\d{2}:\d{2}$/.test(r.interview_end)
      ? r.interview_end
      : def.interview_end;

  // interview_duration_min: 正の整数
  const interviewDurationMin =
    typeof r.interview_duration_min === 'number' &&
    Number.isInteger(r.interview_duration_min) &&
    r.interview_duration_min > 0
      ? r.interview_duration_min
      : def.interview_duration_min;

  // lead_hours: 非負整数
  const leadHours =
    typeof r.lead_hours === 'number' && Number.isInteger(r.lead_hours) && r.lead_hours >= 0
      ? r.lead_hours
      : def.lead_hours;

  // window_days: 正の整数
  const windowDays =
    typeof r.window_days === 'number' && Number.isInteger(r.window_days) && r.window_days > 0
      ? r.window_days
      : def.window_days;

  return {
    calendar_email: calendarEmail,
    interview_days: interviewDays,
    interview_start: interviewStart,
    interview_end: interviewEnd,
    interview_duration_min: interviewDurationMin,
    lead_hours: leadHours,
    window_days: windowDays,
  };
}
