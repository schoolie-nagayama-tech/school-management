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
    <div className="min-h-[100dvh] flex flex-col bg-gradient-to-b from-emerald-50/90 via-white to-teal-50/50">
      {/* ヘッダー：柔らかい緑・白文字・スマホのノッチ対応 */}
      <header
        className="bg-emerald-500/95 text-white shadow-sm backdrop-blur-sm"
        style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}
      >
        <div className="max-w-lg mx-auto px-4 py-4 sm:py-5">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white drop-shadow-sm">
            {school.name}
          </h1>
          <p className="text-sm sm:text-base text-emerald-50 mt-1">
            各種お申し込みページ
          </p>
        </div>
      </header>

      {/* 本文 */}
      <main className="flex-1 max-w-lg mx-auto w-full px-4 py-6 sm:py-8 pb-[env(safe-area-inset-bottom)]">
        {/* 案内文：透明感のある白オーバーレイ */}
        <div className="bg-white/75 backdrop-blur-md border border-emerald-200/60 rounded-2xl p-4 sm:p-5 mb-6 shadow-sm text-slate-600">
          <p className="text-sm sm:text-base leading-relaxed">
            こちらは各種お申し込みページです。お申し込み内容の確認メールが届きますので、ご記入のうえ送信してください。
          </p>
        </div>

        {/* メニュー一覧 */}
        <PortalMenuList menus={menusWithActiveStatus} schoolCode={schoolCode} />
      </main>
    </div>
  );
}
