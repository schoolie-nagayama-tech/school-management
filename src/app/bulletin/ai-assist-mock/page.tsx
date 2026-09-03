'use client';

/**
 * 「連絡掲示板AIアシスト」の静的モック（検討用・admin限定・URL直打ちで見る）。
 *
 * 目的:
 *   仕様を関係者が画面で見てイメージできるようにするための画面。
 *   ナビ（navConfig）には登録しない。
 *
 * ★ このモックの制約:
 *   - DBアクセス・API呼び出し・AI呼び出しは一切なし。固定データとクライアント状態だけで動く。
 *   - 人名・教室名・投稿本文はすべて架空。実在の生徒・講師とは無関係。
 *   - 何を押しても保存されない。
 *
 * 表現している仕様（要約）:
 *   教室長が連絡掲示板に自由文で投稿する（投稿UIは変えない）。AIが投稿を読み、13種の
 *   有限カタログから「講師がNEST上でやるべきタスク」を抽出する。各タスクはDBの状態から
 *   自動で済／未済を判定できる。AIアシストONの講師には、授業中に未対応タスクが1件だけ
 *   控えめなポップアップで出る。出すタイミングはAIが判断する。
 */

import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { isSystemAdmin } from '@/lib/utils/roles';
import { AdminLayout } from '@/components/layouts';
import { Loading } from '@/components/ui';
import AccessDenied from '@/components/AccessDenied';
import {
  Bot,
  ClipboardList,
  Info,
  LayoutDashboard,
  MonitorSmartphone,
  Workflow,
} from 'lucide-react';
import { ExtractTab } from './components/ExtractTab';
import { BoardTab } from './components/BoardTab';
import { SettingsTab } from './components/SettingsTab';
import { SimulatorTab } from './components/SimulatorTab';
import { HowItWorksTab } from './components/HowItWorksTab';

type TabId = 'extract' | 'board' | 'settings' | 'simulator' | 'how';

interface TabDef {
  id: TabId;
  label: string;
  /** タブの立場（誰の視点の画面か）を添えて、混乱しないようにする */
  viewpoint: string;
  icon: React.ReactNode;
}

const TABS: TabDef[] = [
  {
    id: 'extract',
    label: '投稿後のAI読み取り',
    viewpoint: '教室長',
    icon: <ClipboardList className="h-3.5 w-3.5" />,
  },
  {
    id: 'board',
    label: '進捗ボード',
    viewpoint: '教室長',
    icon: <LayoutDashboard className="h-3.5 w-3.5" />,
  },
  {
    id: 'settings',
    label: 'AIアシスト設定',
    viewpoint: '講師管理',
    icon: <Bot className="h-3.5 w-3.5" />,
  },
  {
    id: 'simulator',
    label: '授業中ポップアップ',
    viewpoint: '講師',
    icon: <MonitorSmartphone className="h-3.5 w-3.5" />,
  },
  {
    id: 'how',
    label: '仕組み',
    viewpoint: '共通',
    icon: <Workflow className="h-3.5 w-3.5" />,
  },
];

function AiAssistMock() {
  const [tab, setTab] = useState<TabId>('extract');

  return (
    <AdminLayout documentTitle="連絡掲示板AIアシスト（モック）">
      <div className="space-y-4">
        {/* モック明示バナー */}
        <div className="flex items-start gap-2 rounded-lg border border-info bg-info-subtle px-4 py-3 text-sm text-info">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            これは「連絡掲示板AIアシスト」の仕様を見るためのモックです。ダミーデータのみで動いており、DB・AIには一切つながっていません（何を押しても保存されません）。
          </p>
        </div>

        <h1 className="text-lg font-bold text-text-heading">連絡掲示板AIアシスト</h1>

        {/* タブ */}
        <div className="flex flex-wrap gap-1.5 border-b border-border pb-2">
          {TABS.map((t) => {
            const active = t.id === tab;
            return (
              <button
                key={t.id}
                type="button"
                aria-pressed={active}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12.5px] font-bold transition-colors duration-150 active:scale-[0.97] ${
                  active
                    ? 'border-info bg-info text-white'
                    : 'border-border bg-white text-text-muted hover:bg-surface'
                }`}
              >
                {t.icon}
                {t.label}
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[9.5px] font-bold ${
                    active ? 'bg-white/20 text-white' : 'bg-surface text-text-faint'
                  }`}
                >
                  {t.viewpoint}
                </span>
              </button>
            );
          })}
        </div>

        {/* タブの中身（切り替えのたびに作り直す。モックなので状態を持ち越さなくてよい） */}
        {tab === 'extract' && <ExtractTab />}
        {tab === 'board' && <BoardTab />}
        {tab === 'settings' && <SettingsTab />}
        {tab === 'simulator' && <SimulatorTab />}
        {tab === 'how' && <HowItWorksTab />}
      </div>
    </AdminLayout>
  );
}

/* ============================================================
 * ゲート（admin 限定。検討用のモック画面なので他ロールには出さない）
 * ========================================================== */

export default function BulletinAiAssistMockPage() {
  const { profile, isLoading } = useAuth();

  if (isLoading) {
    return (
      <AdminLayout>
        <Loading />
      </AdminLayout>
    );
  }

  if (!isSystemAdmin(profile?.role)) {
    return (
      <AdminLayout>
        <AccessDenied message="このページはシステム管理者のみアクセス可能です" />
      </AdminLayout>
    );
  }

  return <AiAssistMock />;
}
