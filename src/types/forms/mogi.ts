// Vもぎ申込フォーム関連の型定義

// 学年名と数値のマッピング
export const GRADE_NAME_TO_NUMBER: Record<string, number> = {
  小1: 1,
  小2: 2,
  小3: 3,
  小4: 4,
  小5: 5,
  小6: 6,
  中1: 7,
  中2: 8,
  中3: 9,
  高1: 10,
  高2: 11,
  高3: 12,
  既卒: 13,
};

export const GRADE_NUMBER_TO_NAME: Record<number, string> = {
  1: '小1',
  2: '小2',
  3: '小3',
  4: '小4',
  5: '小5',
  6: '小6',
  7: '中1',
  8: '中2',
  9: '中3',
  10: '高1',
  11: '高2',
  12: '高3',
  13: '既卒',
};

// 会場情報
export interface Venue {
  id: string;
  label: string;
}

// 地域（東京 = Vもぎ / 神奈川 = 全県模試）
export type MogiRegion = 'tokyo' | 'kanagawa';

export const MOGI_REGION_LABELS: Record<MogiRegion, string> = {
  tokyo: '東京（Vもぎ）',
  kanagawa: '神奈川（全県模試）',
};

// 申込フォーム上の呼称（eyebrow / 見出し用）
export const MOGI_REGION_FORM_TITLES: Record<MogiRegion, { eyebrow: string; title: string }> = {
  tokyo: { eyebrow: 'Vもぎ 申込', title: 'Vもぎ申し込み' },
  kanagawa: { eyebrow: '全県模試 申込', title: '神奈川全県模試 申し込み' },
};

// Vもぎ種別（東京 + 神奈川の両地域の種別を含むフラットなユニオン）
export type MogiExamType =
  | 'toritsu_v'
  | 'shiritsu_v'
  | 'jikousakusei'
  | 'zenken'
  | 'tokushoku';

export const MOGI_EXAM_TYPE_LABELS: Record<MogiExamType, string> = {
  toritsu_v: '都立Vもぎ',
  shiritsu_v: '私立Vもぎ',
  jikousakusei: '都立自校作成対策もぎ',
  zenken: '神奈川全県模試',
  tokushoku: '特色検査対策模試',
};

// 地域ごとの選択肢
export const MOGI_EXAM_TYPE_OPTIONS_BY_REGION: Record<
  MogiRegion,
  Array<{ value: MogiExamType; label: string }>
> = {
  tokyo: [
    { value: 'toritsu_v', label: MOGI_EXAM_TYPE_LABELS.toritsu_v },
    { value: 'shiritsu_v', label: MOGI_EXAM_TYPE_LABELS.shiritsu_v },
    { value: 'jikousakusei', label: MOGI_EXAM_TYPE_LABELS.jikousakusei },
  ],
  kanagawa: [
    { value: 'zenken', label: MOGI_EXAM_TYPE_LABELS.zenken },
    { value: 'tokushoku', label: MOGI_EXAM_TYPE_LABELS.tokushoku },
  ],
};

// 後方互換用（東京の種別をデフォルトとして公開）
export const MOGI_EXAM_TYPE_OPTIONS: Array<{ value: MogiExamType; label: string }> =
  MOGI_EXAM_TYPE_OPTIONS_BY_REGION.tokyo;

// 日程情報
export interface MogiDate {
  id: string; // YYYY-MM-DD形式
  label: string; // 表示用ラベル（例: "10月6日（日）"）
  /** 模試種別（都立V/私立V/都立自校作成）。既存データとの互換のため optional。 */
  exam_type?: MogiExamType;
  venues: Venue[];
}

// Vもぎ設定
export interface MogiSettings {
  description?: string;
  grades?: string[]; // 例: ["中3", "高1"]
  region?: MogiRegion; // 東京 or 神奈川（未設定は tokyo として扱う）
  dates?: MogiDate[];
  completion_message?: string;
}

// 選択された日程・会場
export interface DateVenueSelection {
  date_id: string;
  date_label: string;
  /** 日程の模試種別。既存データとの互換のため optional。 */
  exam_type?: MogiExamType;
  exam_type_label?: string;
  venue_id: string;
  venue_label: string;
}

// Vもぎ回答データ
export interface MogiResponseData {
  selections: DateVenueSelection[];
  selection_count: number;
  cancel_agreed: boolean;
  note?: string;
}

// Vもぎ期間（form_periodsから取得）
export interface MogiPeriod {
  id: string;
  school_id: string;
  form_type: 'mogi';
  period_key: string;
  title: string;
  settings: MogiSettings;
  publish_start: string | null;
  publish_end: string | null;
  is_active: boolean;
  linked_application_item_id: string | null;
  is_archived: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

// Vもぎ回答（form_responsesから取得）
export interface MogiResponse {
  id: string;
  school_id: string;
  form_type: 'mogi';
  form_period: string;
  student_name: string;
  grade: number;
  email: string;
  response_data: MogiResponseData;
  linked_student_id: string | null;
  linked_at: string | null;
  status_checks: {
    charged?: boolean;
  } | null;
  is_archived: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  linked_student?: {
    id: string;
    last_name: string;
    first_name: string;
  } | null;
}

// フィルター
export interface MogiResponseFilters {
  grade?: number;
  examType?: MogiExamType;
  dateId?: string;
  venueId?: string;
  chargedStatus?: 'charged' | 'not_charged';
  linkedStatus?: 'linked' | 'unlinked';
  showArchived?: boolean;
}

// 集計データ
export interface MogiStats {
  total_responses: number;
  date_venue_counts: Array<{
    date_id: string;
    date_label: string;
    exam_type?: MogiExamType;
    venue_counts: Array<{
      venue_id: string;
      venue_label: string;
      count: number;
    }>;
    total: number;
  }>;
  /** 種別ごとの回答数（exam_type 未設定は 'unclassified' に集計） */
  type_counts?: Array<{
    exam_type: MogiExamType | 'unclassified';
    label: string;
    count: number;
  }>;
  charged_count: number;
  linked_count: number;
}
