import { notFound } from 'next/navigation';
import { getSchoolByCode } from '@/lib/api/schools';
import { getVisiblePortalMenus } from '@/lib/api/portal';
import { getActiveFormPeriod } from '@/lib/api/form-periods';
import { PortalMenuList } from '@/components/portal';
import type { FormType } from '@/types/database';

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

  // 公開メニューを取得
  let menus;
  try {
    menus = await getVisiblePortalMenus(schoolCode);
  } catch (error) {
    console.error('Error fetching portal menus:', error);
    menus = [];
  }

  // 各メニューの公開期間をチェック
  const menusWithActiveStatus = await Promise.all(
    menus.map(async (menu) => {
      // 内部フォームの場合のみ公開期間をチェック
      if (menu.link_type === 'internal') {
        const formType = MENU_KEY_TO_FORM_TYPE[menu.menu_key];
        if (formType) {
          try {
            const activePeriod = await getActiveFormPeriod(school.id, formType);
            const isFormActive = !!activePeriod;
            return { menu, isFormActive };
          } catch (error) {
            console.error(`Error checking form period for ${menu.menu_key}:`, error);
            return { menu, isFormActive: false };
          }
        }
      }
      // 外部リンクの場合は常にアクティブとみなす（link_urlまたはlink_urlsが設定されている場合）
      const hasLinks = menu.menu_key === 'mendan' 
        ? (menu.link_urls && menu.link_urls.length > 0)
        : !!menu.link_url;
      return { menu, isFormActive: hasLinks };
    })
  );

  return (
    <div className="min-h-screen bg-[#f8fafc]">
      <div className="max-w-md mx-auto px-4 py-8">
        {/* ヘッダー */}
        <header className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-[#1f2937] mb-2">
            {school.name}
          </h1>
        </header>

        {/* メニュー一覧 */}
        <PortalMenuList menus={menusWithActiveStatus} schoolCode={schoolCode} />
      </div>
    </div>
  );
}
