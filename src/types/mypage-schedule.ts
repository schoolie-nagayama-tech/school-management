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
