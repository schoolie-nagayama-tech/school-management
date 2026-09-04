'use client';

/**
 * 「授業の設定」ページ（旧・特別講座管理）。
 *
 * 指導形態・コマ時間・定員・講座を1画面にまとめる。
 * 「① 指導形態を追加 → ② コマ時間を決める → ③ 定員を決める → ④ 講座を作る → ⑤ 生徒を入れる」
 * の流れをそのまま上から下に並べ、形態タブで切り替える。
 *
 * 旧 /settings/time-slots（コマ時間設定）と /settings/class-capacity（授業生徒数設定）は
 * このページへ統合し、旧ルートはリダイレクトだけ残している。
 * ルート（/schedule/special-courses）は既存リンク・ブックマークのため変えない。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { AdminLayout } from '@/components/layouts';
import AccessDenied from '@/components/AccessDenied';
import { ToastContainer } from '@/components/ui';
import { FormationTabBar } from '@/components/schedule/FormationTabBar';
import { TimeSlotSection } from '@/components/schedule/lesson-settings/TimeSlotSection';
import { CapacitySection } from '@/components/schedule/lesson-settings/CapacitySection';
import { CoursesSection } from '@/components/schedule/lesson-settings/CoursesSection';
import { useAuth } from '@/contexts/AuthContext';
import { useMasterData } from '@/contexts/MasterDataContext';
import { useToast } from '@/hooks/useToast';
import { isManagerOrAbove } from '@/lib/utils/roles';
import { getFormations } from '@/lib/api/schedule-formations';
import { INDIVIDUAL_FORMATION, type ScheduleFormation } from '@/types/schedule';

/** 設定の流れ（上のステップ表示）。装飾は控えめにテキストだけで示す。 */
const SETUP_STEPS = [
  '① 指導形態を追加',
  '② コマ時間を決める',
  '③ 定員を決める',
  '④ 講座を作る',
  '⑤ 生徒を入れる（座席表の「＋講座の枠」または生徒詳細の通塾日程）',
];

export default function LessonSettingsPage() {
  const { profile, selectedSchoolId } = useAuth();
  const { schools, subjects } = useMasterData();
  const { toasts, removeToast, success, error: toastError } = useToast();

  // 'all'（すべての教室）は編集対象として扱わない（教室スコープの設定のため）
  const schoolId = selectedSchoolId && selectedSchoolId !== 'all' ? selectedSchoolId : '';
  const schoolName = schools.find((s) => s.id === schoolId)?.name ?? '';

  // 形態マスタは無効・システム含む全件を保持する（タブバーの並び替えが全件を要求するため）
  const [formations, setFormations] = useState<ScheduleFormation[]>([]);
  const [selectedFormation, setSelectedFormation] = useState<string>(INDIVIDUAL_FORMATION);
  // コマ時間を編集したら講座フォームのコマ候補を作り直すためのバージョン
  const [slotsVersion, setSlotsVersion] = useState(0);

  const canManageFormations = isManagerOrAbove(profile?.role);

  const loadFormations = useCallback(async () => {
    try {
      setFormations(await getFormations(true));
    } catch (e) {
      toastError((e as Error).message);
    }
  }, [toastError]);

  useEffect(() => {
    loadFormations();
  }, [loadFormations]);

  const selectedMeta = useMemo(
    () => formations.find((f) => f.key === selectedFormation) ?? null,
    [formations, selectedFormation]
  );
  const selectedLabel = selectedMeta?.label ?? '個別';
  const isIndividual = selectedFormation === INDIVIDUAL_FORMATION;
  // 講座を開ける形態（個別は1対1/1対2のブース運用で講座の概念を持たない）
  const courseFormations = useMemo(
    () => formations.filter((f) => f.key !== INDIVIDUAL_FORMATION),
    [formations]
  );

  // 権限チェックはフック呼び出しがすべて終わった後に行う（Hooks のルール順守のため早期 return を最後に置く）
  if (!isManagerOrAbove(profile?.role)) return <AccessDenied />;

  return (
    <AdminLayout headerTitle="授業の設定">
      <div className="space-y-6">
        {/* ヘッダー */}
        <div className="flex items-start gap-3">
          <Link href="/schedule">
            <button className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors active:scale-[0.97]">
              <ArrowLeft className="w-5 h-5" />
            </button>
          </Link>
          <div>
            <h1 className="text-xl font-bold text-[var(--headline)]">授業の設定</h1>
            <p className="text-sm text-[var(--paragraph)]">
              指導形態・コマ時間・定員・講座をここでまとめて設定します。
            </p>
            <ol className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--paragraph)]">
              {SETUP_STEPS.map((step, i) => (
                <li key={step} className="flex items-center gap-2">
                  <span>{step}</span>
                  {i < SETUP_STEPS.length - 1 && <span className="text-gray-300">→</span>}
                </li>
              ))}
            </ol>
          </div>
        </div>

        {!schoolId ? (
          <div className="text-center py-12 text-[var(--paragraph)]">
            教室を選択してください（ヘッダーの教室切替から1教室を選んでください）。
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 text-xs text-[var(--paragraph)]">
              <span className="font-medium">教室:</span>
              <span>{schoolName}</span>
            </div>

            {/* 形態タブバー（追加・改名・並び替え・無効化・削除つき） */}
            <FormationTabBar
              formations={formations}
              selectedKey={selectedFormation}
              onSelectKey={setSelectedFormation}
              onChanged={loadFormations}
              canManage={canManageFormations}
              onSuccess={success}
              onError={toastError}
            />

            {/* コマ時間 */}
            <TimeSlotSection
              schoolId={schoolId}
              formationKey={selectedFormation}
              onSuccess={success}
              onError={toastError}
              onSlotsChanged={() => setSlotsVersion((v) => v + 1)}
            />

            {/* 定員 */}
            <CapacitySection
              schoolId={schoolId}
              formationKey={selectedFormation}
              formationLabel={selectedLabel}
              onSuccess={success}
              onError={toastError}
            />

            {/* 講座（個別は講座を使わない） */}
            {isIndividual ? (
              <p className="text-sm text-[var(--paragraph)] bg-[var(--surface)] rounded-md px-3 py-2">
                個別指導は講座を使いません。生徒の通塾日程は生徒詳細から登録します。
              </p>
            ) : (
              <>
                <CoursesSection
                  schoolId={schoolId}
                  formationKey={selectedFormation}
                  formationLabel={selectedLabel}
                  formations={courseFormations}
                  subjects={subjects}
                  slotsVersion={slotsVersion}
                />

                {/* 生徒の入れ方（講座を作ったあとの行き先） */}
                <div className="border border-[var(--stroke)] rounded-xl bg-[var(--surface)] px-4 py-3 space-y-2">
                  <p className="text-sm font-medium text-[var(--headline)]">生徒を入れるには</p>
                  <p className="text-xs text-[var(--paragraph)]">
                    座席表の形態ボードで「＋講座の枠」、または生徒詳細の通塾日程から登録します。
                  </p>
                  <Link
                    href="/schedule"
                    className="inline-flex items-center gap-1 text-xs font-medium text-[var(--primary)] hover:underline"
                  >
                    <ArrowRight className="w-3.5 h-3.5" />
                    座席表を開く
                  </Link>
                </div>
              </>
            )}
          </>
        )}
      </div>

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </AdminLayout>
  );
}
