import { supabase } from '../supabase';
import type { PortalMenu, PortalMenuInsert, PortalMenuUpdate } from '@/types/database';
import { getDefaultSchoolId, getSchoolByCode } from './schools';

// ============================================
// ポータルメニュー関連
// ============================================

/**
 * ポータルメニュー一覧を取得（管理用、全件）
 */
export async function getPortalMenus(schoolId?: string): Promise<PortalMenu[]> {
  const targetSchoolId = schoolId || getDefaultSchoolId();

  const { data, error } = await supabase
    .from('portal_menu')
    .select('*')
    .eq('school_id', targetSchoolId)
    .order('sort_order', { ascending: true });

  if (error) {
    throw new Error(`ポータルメニュー一覧の取得に失敗しました: ${error.message}`);
  }

  return data || [];
}

/**
 * 公開メニューを取得（ポータル用、is_visible=trueのみ）
 */
export async function getVisiblePortalMenus(schoolCode: string): Promise<PortalMenu[]> {
  // まず学校IDを取得
  const school = await getSchoolByCode(schoolCode);
  if (!school) {
    throw new Error(`教室が見つかりません: ${schoolCode}`);
  }

  const { data, error } = await supabase
    .from('portal_menu')
    .select('*')
    .eq('school_id', school.id)
    .eq('is_visible', true)
    .order('sort_order', { ascending: true });

  if (error) {
    throw new Error(`公開メニュー一覧の取得に失敗しました: ${error.message}`);
  }

  return data || [];
}

/**
 * ポータルメニューを更新
 */
export async function updatePortalMenu(
  id: string,
  data: PortalMenuUpdate
): Promise<PortalMenu> {
  const { data: updated, error } = await supabase
    .from('portal_menu')
    .update(data)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error(`ポータルメニューの更新に失敗しました: ${error.message}`);
  }

  return updated;
}

/**
 * ポータルメニューの並び替え
 */
export async function reorderPortalMenus(
  schoolId: string,
  menuIds: string[]
): Promise<void> {
  // トランザクション的な処理（Supabaseの制約により、ループで更新）
  const updates = menuIds.map((menuId, index) => {
    return supabase
      .from('portal_menu')
      .update({ sort_order: index + 1 })
      .eq('id', menuId)
      .eq('school_id', schoolId);
  });

  const results = await Promise.all(updates);

  const errors = results.filter((result) => result.error);
  if (errors.length > 0) {
    throw new Error(`ポータルメニューの並び替えに失敗しました: ${errors[0].error?.message}`);
  }
}

/**
 * ポータルメニューの表示/非表示をトグル
 */
export async function togglePortalMenuVisibility(id: string): Promise<PortalMenu> {
  // 現在の値を取得
  const { data: item, error: fetchError } = await supabase
    .from('portal_menu')
    .select('is_visible')
    .eq('id', id)
    .single();

  if (fetchError) {
    throw new Error(`ポータルメニューの取得に失敗しました: ${fetchError.message}`);
  }

  if (!item) {
    throw new Error('ポータルメニューが見つかりません');
  }

  // 反転して更新
  const { data: updated, error: updateError } = await supabase
    .from('portal_menu')
    .update({ is_visible: !item.is_visible })
    .eq('id', id)
    .select()
    .single();

  if (updateError) {
    throw new Error(`ポータルメニューの更新に失敗しました: ${updateError.message}`);
  }

  return updated;
}

/**
 * 教室のメニュー初期化（初回のみ）
 */
export async function initializePortalMenus(schoolId: string): Promise<void> {
  // 既存のメニューがあるか確認
  const { data: existing } = await supabase
    .from('portal_menu')
    .select('id')
    .eq('school_id', schoolId)
    .limit(1);

  if (existing && existing.length > 0) {
    // 既に初期化済み
    return;
  }

  // menu_keyからlink_urlを生成する関数
  const getLinkUrl = (menuKey: string): string | null => {
    const menuKeyToUrl: Record<string, string> = {
      zoukoma: '/zoukoma',
      moshi: '/moshi',
      mogi: '/mogi',
      shukaisu: '/shukaisu',
      youbi: '/youbi',
      kyozai: '/kyozai',
      soudan: '/soudan',
    };
    return menuKeyToUrl[menuKey] || null;
  };

  // 初期メニューを作成
  const defaultMenus: PortalMenuInsert[] = [
    {
      school_id: schoolId,
      menu_key: 'zoukoma',
      title: '増コマ申し込み',
      description: '追加授業のお申込みはこちら',
      is_visible: true,
      link_type: 'internal',
      link_url: getLinkUrl('zoukoma'),
      sort_order: 1,
    },
    {
      school_id: schoolId,
      menu_key: 'moshi',
      title: '模試申し込み',
      description: '模擬試験のお申込みはこちら',
      is_visible: true,
      link_type: 'internal',
      link_url: getLinkUrl('moshi'),
      sort_order: 2,
    },
    {
      school_id: schoolId,
      menu_key: 'mendan',
      title: '面談申し込み',
      description: '面談のご予約はこちら',
      is_visible: true,
      link_type: 'external',
      link_url: null,
      sort_order: 3,
    },
    {
      school_id: schoolId,
      menu_key: 'mogi',
      title: 'Vもぎ申し込み',
      description: 'Vもぎのお申込みはこちら',
      is_visible: true,
      link_type: 'internal',
      link_url: getLinkUrl('mogi'),
      sort_order: 4,
    },
    {
      school_id: schoolId,
      menu_key: 'shukaisu',
      title: '週回数変更',
      description: '週の授業回数変更のお申込み',
      is_visible: true,
      link_type: 'internal',
      link_url: getLinkUrl('shukaisu'),
      sort_order: 5,
    },
    {
      school_id: schoolId,
      menu_key: 'youbi',
      title: '曜日変更申し込み',
      description: '通塾曜日変更のお申込み',
      is_visible: true,
      link_type: 'internal',
      link_url: getLinkUrl('youbi'),
      sort_order: 6,
    },
    {
      school_id: schoolId,
      menu_key: 'kyozai',
      title: '教材販売',
      description: '教材のご購入はこちら',
      is_visible: true,
      link_type: 'internal',
      link_url: getLinkUrl('kyozai'),
      sort_order: 7,
    },
    {
      school_id: schoolId,
      menu_key: 'soudan',
      title: 'お客様相談',
      description: 'ご相談・ご要望はこちら',
      is_visible: true,
      link_type: 'internal',
      link_url: getLinkUrl('soudan'),
      sort_order: 8,
    },
  ];

  const { error } = await supabase.from('portal_menu').insert(defaultMenus);

  if (error) {
    throw new Error(`ポータルメニューの初期化に失敗しました: ${error.message}`);
  }
}
