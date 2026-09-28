'use client';

/**
 * 生徒ハブの「志望校」セクション。面談ページ④「志望校と提案」と同じ組み立て。
 *
 * ★部品は面談側（src/app/interview/・src/components/interview/）をそのまま import する。写さない。
 *   面談側は今も毎日手が入っており、写すとハブだけ古い判定のまま残る。
 * ★組み立ての正典は src/app/interview/InterviewScriptCard.tsx の④（useTargetProposals を呼ぶ箇所と、
 *   TargetProposalTable・PrivateComparePanel・TargetSchoolMap を並べる箇所）。直すときは両方を見る。
 * ★面談④と違うところ:
 *   - 勉強の仕方（StudyTipCards）は出さない。材料が面談のAIの下書きなので、ハブには無い。
 *   - 話すこと・聞くこと（buildTargetSchoolTalkLines など）も出さない。面談の台本の行で、
 *     ハブは面談をする場所ではない。模試の志望校だけは「事実」なので出す。
 *   - 並びは全幅向けに組み替えた（上段=入力と提案の表、下段=私立の比較と地図）。
 * 成績・志望校・模試の志望校はハブ共通の取得係（HubDataContext）から読む。成績は「成績」セクションと
 * 1回の取得を共有する（同じ成績を2回取らない）。
 */
import { useMemo, useState } from 'react';
import { TargetSchoolsPanel } from '@/components/interview/TargetSchoolsPanel';
import {
  PrivateComparePanel,
  TargetProposalTable,
  useTargetProposals,
} from '@/app/interview/TargetProposals';
import { TargetSchoolMap } from '@/app/interview/TargetSchoolMap';
import { buildMockSchoolLines } from '@/app/interview/interview.shared';
import { useHubAssessments, useHubTargetSchools } from './HubDataContext';

interface TargetSchoolsSectionProps {
  studentId: string;
  schoolId: string;
  /** students.gender。私立の提案から入れない男子校・女子校を外し、偏差値を本人の側で出すため */
  gender: 'male' | 'female' | null;
}

export function TargetSchoolsSection({ studentId, schoolId, gender }: TargetSchoolsSectionProps) {
  const { assessments } = useHubAssessments();
  const { targetSchools, mockSchools, refetchTargetSchools } = useHubTargetSchools();

  const proposals = useTargetProposals(schoolId, targetSchools, assessments, gender);
  // 選んだ行（地図がその学校に寄る）と、基準を比べている私立（押した順・3校まで）。
  // ★面談と同じく保存しない。ページ内だけの状態（生徒が変わればページごと作り直される）
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const toggleCompare = (id: string) =>
    setCompareIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].slice(-3)
    );
  const compareItems = compareIds
    .map((id) => proposals.compareById.get(id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p));

  // 直近の模試の合格可能性（前回との比較つき）と、登録に無い公立校の指摘。面談④の「事実」と同じ行。
  // ★聞く行（ask）は面談の台本用なので出さない
  const mockSchoolLines = useMemo(
    () => buildMockSchoolLines(mockSchools, assessments, targetSchools),
    [mockSchools, assessments, targetSchools]
  );

  // 提案がまだ出ない生徒（模試の偏差値が無い等）では、表と地図の枠ごと出さない。
  // ★空の枠と「模試の偏差値が入ると…」の説明だけが大きく残り、横の空白になっていた（2026-09-28 指摘）
  const hasProposals =
    !proposals.loading && (proposals.rows.length > 0 || proposals.privateRows.length > 0);
  const hasMockLines = mockSchoolLines.tell.length > 0;

  return (
    <div className="flex flex-col">
      {/* 上段: 志望校の入力を全幅で。行は横に並べる（embedded）。
          見出し・補足文はハブの「志望校」見出しと重なるので出さない */}
      <div className="px-4 py-4">
        {/* 保存したら志望校を取り直し、下の表と地図にその場で反映する（面談と同じ） */}
        <TargetSchoolsPanel
          studentId={studentId}
          schoolId={schoolId}
          onSaved={refetchTargetSchools}
          embedded
        />
      </div>

      {/* 下段: 提案の表（＋模試の志望校・私立の比較）｜ 地図 を左右に。狭い画面は縦に積む */}
      {(hasProposals || hasMockLines) && (
        <div className="grid grid-cols-1 items-start gap-5 border-t border-border-subtle px-4 py-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-4">
            {hasProposals && (
              <TargetProposalTable
                state={proposals}
                selectedId={selectedProposalId}
                onSelect={setSelectedProposalId}
                compareIds={compareIds}
                onToggleCompare={toggleCompare}
              />
            )}
            {hasMockLines && (
              <div className="flex flex-col gap-1">
                <span className="text-[13px] font-bold text-text-heading">模試の志望校</span>
                {mockSchoolLines.tell.map((t, i) => (
                  <p
                    key={i}
                    className="m-0 text-[12.5px] leading-snug text-text-body [overflow-wrap:anywhere]"
                  >
                    {t}
                  </p>
                ))}
              </div>
            )}
            {/* 基準を比べる私立（空なら何も描かない部品） */}
            <PrivateComparePanel
              items={compareItems}
              onRemove={toggleCompare}
              onClear={() => setCompareIds([])}
            />
          </div>
          {hasProposals && (
            <div className="min-w-0">
              <TargetSchoolMap
                rows={proposals.rows}
                privateRows={proposals.privateRows}
                origin={proposals.origin}
                selectedId={selectedProposalId}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
