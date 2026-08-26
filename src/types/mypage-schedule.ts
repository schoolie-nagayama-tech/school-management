/**
 * 保護者ポータル スケジュール（Stage 3）の共有型。
 * 正典: docs/portal-v2-requirements.md §4「S. スケジュール」/ §7-3。
 *
 * ★ なぜ lib/mypage/* から型を切り出すか:
 *   transferQuota.ts / formGuidance.ts は `import 'server-only'` なのでクライアント
 *   コンポーネントから import できない。API の戻り値の形はサーバーとクライアントで
 *   共有したいので、型だけをこの中立なファイルに置く（実装はサーバー側に残す）。
 */

// ============================================================
// 振替クォータ（§7-3）
// ============================================================

/** 振替無制限期間（フリー期間）に当たっているときの判定結果。 */
export interface TransferQuotaFree {
  mode: 'free';
  /** ポータルの注記に出す説明（例: '夏期講習前フリー期間'）。 */
  label: string | null;
  /** 'YYYY-MM-DD' */
  startDate: string;
  /** 'YYYY-MM-DD' */
  endDate: string;
  /** フリー期間中は常に振替可。 */
  canRequestTransfer: true;
}

/** 通常（上限判定あり）のときの判定結果。 */
export interface TransferQuotaLimited {
  mode: 'limited';
  /** 素の上限（＝有効な通塾日程パターン数）。 */
  limit: number;
  /** 教室の追加許可を足した実効上限。 */
  effectiveLimit: number;
  /** 使用済み（確定済みの振替元のみ。保護者の未処理リクエストは含まない）。 */
  used: number;
  /** 残り（0未満にはしない）。 */
  remaining: number;
  /** 残り>0 なら振替希望を受け付けられる。 */
  canRequestTransfer: boolean;
  /** 教室の追加許可が付いているか。 */
  hasPermission: boolean;
  /** 追加許可の回数（無ければ0）。 */
  permissionExtra: number;
  /** 表示用の月ラベル（例: '2026年7月'）。 */
  monthLabel: string;
}

export type TransferQuota = TransferQuotaFree | TransferQuotaLimited;

// ============================================================
// 予定ビュー
// ============================================================

/** 予定1件のDTO（/api/mypage/schedule の戻り）。 */
export interface PortalScheduleEntryDto {
  id: string;
  /** 'YYYY-MM-DD' */
  entryDate: string;
  slotNumber: number | null;
  /** '17:00〜18:30'。時限が引けなければ null。 */
  slotLabel: string | null;
  /** 'HH:MM'。 */
  startTime: string | null;
  /** 'scheduled'|'completed'|'cancelled'|'transferred_out'|'transferred_in' */
  status: string;
  /** 'regular'|'koushu'|'test_prep'|'additional'|'trial' */
  kind: string;
  subjectNames: string[];
  teacherName: string | null;
  seatLabel: string | null;
}

/**
 * 申込済み模試（Vもぎ・全県模試 / オープン模試）の実施予定1件。
 * `schedule_entries` ではなく `form_responses` から導出する別ソースのため、
 * `PortalScheduleEntryDto` とは別型にしている（時限・座席・講師の概念が無い）。
 */
export interface PortalExamEventDto {
  /** 合成ID（`${formType}:${responseId}:${日付キー}`）。リストの key に使う。 */
  id: string;
  /** 'YYYY-MM-DD' */
  entryDate: string;
  /** 例: form_periods.title（無ければ 'Vもぎ・全県模試' / '模試'）。 */
  title: string;
  /** '10:00〜13:00' 等。不明なら null。 */
  timeLabel: string | null;
  /** Vもぎ・全県模試の会場名。オープン模試（教室実施）は null。 */
  venueLabel: string | null;
  formType: 'moshi' | 'mogi';
}

/**
 * 教室に実在する時限1件（/api/mypage/schedule の戻りに同梱）。
 *
 * ★ なぜ予定APIに相乗りさせるか: 振替希望の「時限」を自由入力から選択に変えるために
 *   必要になった値だが、これを使う AbsenceSheet は必ず予定ビュー（ScheduleView）の
 *   コマから開かれる。専用の口を足すより、既に叩いている予定APIに載せて親から
 *   渡すほうがリクエストが増えない（保護者は電波の悪い場所でも使う）。
 */
export interface PortalTimeSlotDto {
  id: string;
  slotNumber: number;
  /** '17:00〜18:30'。開始・終了が引けない時限は API 側で落とすので必ず値がある。 */
  slotLabel: string;
}

// ============================================================
// 手続きハブ（§7-3 申し込みプッシュ）
// ============================================================

/** ポータルに出すフォーム種別（請求系は出さない）。 */
export const GUIDANCE_FORM_TYPES = [
  'zoukoma',
  'moshi',
  'mogi',
  'shukaisu',
  'youbi',
  'soudan',
] as const;
export type GuidanceFormType = (typeof GUIDANCE_FORM_TYPES)[number];

/** プッシュカード1件（「〇〇さんへのご案内」）。 */
export interface GuidancePush {
  studentId: string;
  studentName: string;
  formType: GuidanceFormType;
  periodKey: string;
  title: string;
  /** 強調カードに出す理由文（例: '7/10 に教室からテスト対策のご提案があります'）。 */
  reason: string;
  /** 申込先 URL（当面 v1 フォーム）。 */
  href: string;
}

/** 通常一覧の1件。 */
export interface GuidanceItem {
  studentId: string;
  studentName: string;
  formType: GuidanceFormType;
  periodKey: string;
  title: string;
  status: 'open' | 'ended';
  href: string;
}

/** 手続きハブに渡すデータ一式。 */
export interface FormGuidance {
  pushes: GuidancePush[];
  items: GuidanceItem[];
}
