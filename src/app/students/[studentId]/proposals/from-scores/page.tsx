'use client';

import { Suspense } from 'react';
import { AdminLayout } from '@/components/layouts';
import { Loading } from '@/components/ui';
import { ScoreSheetPlanner } from '@/components/scoreSheet/ScoreSheetPlanner';

/**
 * 成績表（PCS・進研テスト・Vもぎ）から講習提案書を作る。教室長以上。
 * 正典: docs/score-sheet-plan-draft.md
 */
export default function ScoreSheetPlanPage() {
  return (
    <AdminLayout headerTitle="提案書">
      <Suspense fallback={<Loading />}>
        <ScoreSheetPlanner />
      </Suspense>
    </AdminLayout>
  );
}
