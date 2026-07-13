/**
 * 問合せ管理ページ共有定数。
 * ステータスの表示ラベル・色を一元管理する。
 */
import type { InquiryStatus } from '@/types/database';

export interface StatusConfig {
  label: string;
  /** Tailwind のインラインクラス（Badge 内で使う） */
  className: string;
}

/**
 * ステータスごとの表示設定。
 * 追客の段階を表す: 対応中 → 体験待ち → 返事待ち → 入会 / 失注(連絡不通/没/体験没)。
 * 「返事待ち」は内部値 trial_done（体験を実施し、相手の返事を待っている状態）。
 * Record のキー順が select / ドーナツの表示順になる。
 */
export const STATUS_CONFIG: Record<InquiryStatus, StatusConfig> = {
  in_progress: { label: '対応中', className: 'bg-blue-100 text-blue-800' },
  trial_waiting: { label: '体験待ち', className: 'bg-indigo-100 text-indigo-800' },
  trial_done: { label: '返事待ち', className: 'bg-cyan-100 text-cyan-800' },
  enrolled: { label: '入会', className: 'bg-green-100 text-green-800' },
  unreachable: { label: '連絡不通', className: 'bg-gray-200 text-gray-700' },
  lost: { label: '没', className: 'bg-gray-100 text-gray-500' },
  trial_lost: { label: '体験没', className: 'bg-orange-100 text-orange-700' },
};

/**
 * 電話がつながりやすい時間帯の選択肢（複数選択）。
 * これに加えて「その他」は自由記述（note）で持つ。key は DB(jsonb slots)に保存する値。
 */
export const CONTACT_TIME_OPTIONS = [
  { key: 'anytime', label: 'いつでも' },
  { key: 'noon', label: 'ひる' },
  { key: 'evening', label: '夕方' },
  { key: 'night', label: '夜以降' },
  { key: 'saturday', label: '土曜' },
] as const;

export type ContactTimeKey = (typeof CONTACT_TIME_OPTIONS)[number]['key'];

/** 「その他」を表す slots のキー（チェックすると自由記述欄を出す） */
export const CONTACT_TIME_OTHER_KEY = 'other';

/** フィルタ用ステータス選択肢（"全て" を先頭に） */
export const STATUS_OPTIONS: { value: InquiryStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'すべて' },
  { value: 'in_progress', label: '対応中' },
  { value: 'trial_waiting', label: '体験待ち' },
  { value: 'trial_done', label: '返事待ち' },
  { value: 'enrolled', label: '入会' },
  { value: 'unreachable', label: '連絡不通' },
  { value: 'lost', label: '没' },
  { value: 'trial_lost', label: '体験没' },
];

/** コンタクト方法の表示ラベル（status_change/material_sent は自動記録用） */
export const CONTACT_METHOD_LABELS: Record<string, string> = {
  tel: '電話',
  email: 'メール',
  sms: 'SMS',
  visit: '来校',
  interview: '面談',
  other: 'その他',
  material_sent: '資料発送',
  status_change: 'ステータス変更',
};

/** コンタクト方向の表示ラベル */
export const CONTACT_DIRECTION_LABELS: Record<string, string> = {
  outbound: '発信',
  inbound: '着信・受信',
};

/**
 * 方法ごとの既定の方向。
 * 方法を選ぶと方向を自動でこの値に切り替える（その後の手動変更も可）。
 * - 来校(visit)は相手が来るので 着信・受信、それ以外はこちらからの発信が基本。
 */
export const METHOD_DEFAULT_DIRECTION: Record<ManualContactMethod, 'outbound' | 'inbound'> = {
  tel: 'outbound',
  email: 'outbound',
  sms: 'outbound',
  visit: 'inbound',
  interview: 'inbound',
  material_sent: 'outbound',
  other: 'outbound',
};

/**
 * 手入力フォームで選べる method。
 * material_sent(資料送付) は手動でも記録できる（status変更時の自動記録とは別経路）。
 * status_change は handleSave で自動 insert するのでフォームには出さない。
 */
export const MANUAL_CONTACT_METHODS = [
  'tel',
  'email',
  'sms',
  'visit',
  'interview',
  'material_sent',
  'other',
] as const;
export type ManualContactMethod = (typeof MANUAL_CONTACT_METHODS)[number];

/**
 * 結果の選択肢（method ごと）。free text 入力も併用できるようにする。
 * 電話の追客状況がひと目で分かるよう選択式を充実させた。
 */
export const CONTACT_RESULT_OPTIONS: Record<ManualContactMethod, string[]> = {
  tel: ['つながった', '不在', '留守電', '拒否', '折返し待ち', '番号違い', 'その他'],
  email: ['送信済み', '返信あり', '返信なし', 'その他'],
  sms: ['送信済み', '返信あり', 'その他'],
  visit: ['来校', '面談実施', '体験実施', 'キャンセル', 'その他'],
  interview: ['実施', '日程調整中', 'キャンセル', '欠席', 'その他'],
  material_sent: ['発送済み', '手渡し', 'その他'],
  other: [],
};

/**
 * 問合せの「表示名」と、それが保護者名フォールバックかどうかを返す。
 *
 * HP からの取込では生徒名が空で保護者名しか入っていないことがある。
 * その場合に「表示している名前は保護者名」だと UI 上で示せるよう、
 * isGuardianFallback を返す。
 *
 * - student_name があればそれを使う（isGuardianFallback=false）
 * - student_name が空で guardian_name があれば保護者名を使う（isGuardianFallback=true）
 * - どちらも無ければ '（氏名未登録）'（isGuardianFallback=false）
 */
export interface InquiryDisplayName {
  name: string;
  isGuardianFallback: boolean;
}
export function getInquiryDisplayName(q: {
  student_name: string | null;
  guardian_name: string | null;
}): InquiryDisplayName {
  if (q.student_name && q.student_name.trim()) {
    return { name: q.student_name, isGuardianFallback: false };
  }
  if (q.guardian_name && q.guardian_name.trim()) {
    return { name: q.guardian_name, isGuardianFallback: true };
  }
  return { name: '（氏名未登録）', isGuardianFallback: false };
}

/** ステータス遷移メッセージ（status_change の result）*/
export function formatStatusTransition(from: string, to: string): string {
  return `${STATUS_CONFIG[from as keyof typeof STATUS_CONFIG]?.label ?? from} → ${STATUS_CONFIG[to as keyof typeof STATUS_CONFIG]?.label ?? to}`;
}

/** 失注理由の選択肢（没 / 体験没 時に記録） */
export const LOST_REASONS = [
  '料金',
  '他塾に決定',
  '時期が合わない',
  '連絡不通のまま',
  'その他',
] as const;

/** YYYY/MM/DD 形式にフォーマットする */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

/** YYYY/MM/DD HH:mm 形式にフォーマットする */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return `${formatDate(iso)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
