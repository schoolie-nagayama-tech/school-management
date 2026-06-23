/**
 * 問合せ名寄せ（関連問合せ検索）ユーティリティ。
 * 電話番号・メールアドレス・生徒氏名が一致する他の問合せを検索して返す。
 * 再問合せや兄弟姉妹の問合せを把握するために使用する。
 */

import { supabase } from '../supabase';
import type { Inquiry } from '@/types/database';

/** 名寄せ結果: 関連問合せ本体と一致したフィールド種別 */
export interface RelatedInquiry {
  inquiry: Inquiry;
  matchedBy: ('phone' | 'email' | 'name')[];
}

/**
 * 指定問合せと電話/メール/生徒名が一致する他の問合せを返す（名寄せ）。
 * 再問合せ・兄弟姉妹の検出用。最大20件、inquired_at 降順。
 * deleted_at IS NULL のみ。自分自身は除く。全教室横断で検索する（admin/owner は RLS で全校見える）。
 *
 * PostgREST の or 構文は値に "," や "(" が含まれると壊れるため、
 * phone / email / student_name の3クエリを並列実行して id でマージする。
 */
export async function findRelatedInquiries(inquiry: Inquiry): Promise<RelatedInquiry[]> {
  const { id, phone, email, student_name } = inquiry;

  // email が 'なし' の場合は検索しない（不要なヒット防止）
  const validEmail = email && email !== 'なし' ? email : null;
  // student_name が2文字以下は同姓ノイズが多いためスキップ
  const validName = student_name && student_name.length > 2 ? student_name : null;

  // 検索対象がひとつもない場合は空配列を返す
  if (!phone && !validEmail && !validName) return [];

  // ---- 並列3クエリ（phone / email / name それぞれ個別に実行） ----

  const makeBaseQuery = () =>
    supabase
      .from('inquiries')
      .select('*')
      .is('deleted_at', null) // 論理削除済みは除外
      .neq('id', id) // 自分自身を除く
      .order('inquired_at', { ascending: false })
      .limit(20);

  // phone 一致クエリ（phone が null なら実行しない）
  const phonePromise = phone
    ? makeBaseQuery().eq('phone', phone)
    : Promise.resolve({ data: [] as Inquiry[], error: null });

  // email 一致クエリ（有効なメールのみ）
  const emailPromise = validEmail
    ? makeBaseQuery().eq('email', validEmail)
    : Promise.resolve({ data: [] as Inquiry[], error: null });

  // student_name 一致クエリ（3文字以上のみ）
  const namePromise = validName
    ? makeBaseQuery().eq('student_name', validName)
    : Promise.resolve({ data: [] as Inquiry[], error: null });

  const [phoneResult, emailResult, nameResult] = await Promise.all([
    phonePromise,
    emailPromise,
    namePromise,
  ]);

  // エラーは静かに無視（呼び出し側が握り潰す設計だが、デバッグ用に console.warn）
  if (phoneResult.error)
    console.warn('[inquiryDedup] phone query error:', phoneResult.error.message);
  if (emailResult.error)
    console.warn('[inquiryDedup] email query error:', emailResult.error.message);
  if (nameResult.error) console.warn('[inquiryDedup] name query error:', nameResult.error.message);

  // ---- id でマージして matchedBy を付与 ----
  const map = new Map<string, RelatedInquiry>();

  /** マージ処理: 既存エントリに matchedBy を追記、なければ新規作成 */
  const merge = (rows: Inquiry[] | null, field: 'phone' | 'email' | 'name') => {
    if (!rows) return;
    for (const row of rows) {
      const existing = map.get(row.id);
      if (existing) {
        // 同一 id の重複ヒット → matchedBy に追記
        existing.matchedBy.push(field);
      } else {
        map.set(row.id, { inquiry: row, matchedBy: [field] });
      }
    }
  };

  merge(phoneResult.data as Inquiry[] | null, 'phone');
  merge(emailResult.data as Inquiry[] | null, 'email');
  merge(nameResult.data as Inquiry[] | null, 'name');

  // inquired_at 降順で最大20件に絞って返す
  return Array.from(map.values())
    .sort((a, b) => b.inquiry.inquired_at.localeCompare(a.inquiry.inquired_at))
    .slice(0, 20);
}
