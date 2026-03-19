import { notFound } from 'next/navigation';
import { getSchoolByCode } from '@/lib/api/schools';
import { getAllPortalMenusForPortal } from '@/lib/api/portal';
import { getActiveFormPeriod } from '@/lib/api/form-periods';
import { PortalMenuList } from '@/components/portal';
import type { FormType, PortalMenu } from '@/types/database';

// 管理画面での公開/非公開の切り替えを保護者ポータルに即反映するためキャッシュしない
export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface PortalPageProps {
  params: Promise<{ schoolCode: string }>;
}

// menu_keyからform_typeへのマッピング
const MENU_KEY_TO_FORM_TYPE: Record<string, FormType | null> = {
  zoukoma: 'zoukoma',
  moshi: 'moshi',
  mogi: 'mogi',
  shukaisu: 'shukaisu',
  youbi: 'youbi',
  kyozai: 'kyozai',
  soudan: 'soudan',
  mendan: null, // 面談は外部リンクなのでnull
};

export default async function PortalPage({ params }: PortalPageProps) {
  const { schoolCode } = await params;

  // 教室情報を取得
  const school = await getSchoolByCode(schoolCode);
  if (!school) {
    notFound();
  }

  // メニューを全件取得（非公開はグレーアウト表示）
  let menus: PortalMenu[];
  try {
    menus = await getAllPortalMenusForPortal(schoolCode);
  } catch (error) {
    console.error('Error fetching portal menus:', error);
    menus = [];
  }

  // 各メニューの公開期間をチェック（is_visible と isFormActive を渡す）
  const menusWithActiveStatus = await Promise.all(
    menus.map(async (menu) => {
      // 内部フォームの場合のみ公開期間をチェック
      if (menu.link_type === 'internal') {
        const formType = MENU_KEY_TO_FORM_TYPE[menu.menu_key];
        if (formType) {
          try {
            const activePeriod = await getActiveFormPeriod(school.id, formType);
            const isFormActive = !!activePeriod;
            return { menu, isFormActive, isVisible: menu.is_visible === true };
          } catch (error) {
            console.error(`Error checking form period for ${menu.menu_key}:`, error);
            return { menu, isFormActive: false, isVisible: menu.is_visible === true };
          }
        }
      }
      // 外部リンクの場合は常にアクティブとみなす（link_urlまたはlink_urlsが設定されている場合）
      const hasLinks: boolean = menu.menu_key === 'mendan'
        ? !!(menu.link_urls && menu.link_urls.length > 0)
        : !!menu.link_url;
      return { menu, isFormActive: hasLinks, isVisible: menu.is_visible === true };
    })
  );

  return (
    <div className="min-h-[100dvh] flex flex-col bg-[#f8f9fa]">
      {/* ヘッダー */}
      <header
        className="bg-white border-b border-[#e5e7eb]"
        style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
      >
        <div className="max-w-lg mx-auto px-5 py-4 sm:py-5">
          <div className="flex items-center gap-3">
            {school.logo_url ? (
              <img
                src={school.logo_url}
                alt={school.name}
                className="w-9 h-9 rounded-lg object-cover flex-shrink-0"
              />
            ) : (
              <div className="w-9 h-9 rounded-lg bg-[#1a1a1a] flex items-center justify-center flex-shrink-0">
                <span className="text-white text-sm font-bold">
                  {school.name.charAt(0)}
                </span>
              </div>
            )}
            <div className="min-w-0">
              <h1 className="text-base sm:text-lg font-bold text-[#1a1a1a] truncate leading-tight">
                {school.name}
              </h1>
              <p className="text-xs text-[#6b7280] mt-0.5">各種お申し込み</p>
            </div>
          </div>
        </div>
      </header>

      {/* 本文 */}
      <main className="flex-1 max-w-lg mx-auto w-full px-4 sm:px-5 py-5 sm:py-6 pb-[env(safe-area-inset-bottom)]">
        {/* 案内文 */}
        <p className="text-[13px] text-[#6b7280] leading-relaxed mb-5 px-1">
          お申し込み内容の確認メールが届きます。ご記入のうえ送信してください。
        </p>

        {/* メニュー一覧 */}
        <PortalMenuList menus={menusWithActiveStatus} schoolCode={schoolCode} />
      </main>
    </div>
  );
}
