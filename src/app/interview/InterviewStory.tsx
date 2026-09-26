'use client';

/**
 * 台本の一番上に出す「受講の枠」と「面談の筋」（見立て・今日いちばん言いたいこと・道筋）。
 *
 * ★教室長の画面だけに出す。印刷シートには出さない（2026-09-25 教室長。紙に載せるかは別に判断する。
 *   「立て直し」のような言葉を保護者の目に触れる紙に載せない）。
 * ★場面の構成（①〜⑦）は変えない。筋は上に1枚だけ置き、各場面の文をAIがこの向きにそろえる。
 * 正典: docs/interview-workspace-layout-2026-09.md「面談の筋（2026-09-25）」
 */
import type { BriefRoadmapStep, RoadmapStepKey } from '@/lib/ai/interviewBrief';
import {
  STORY_TONE_HOW,
  STORY_TONE_LABEL,
  type EnrollmentView,
  type StoryTone,
  type StoryToneResult,
} from '@/lib/interview/story';

/** 見立ての色。★追い風＝success／踏ん張りどころ＝warning／立て直し＝danger（既存のトークンだけ） */
const TONE_BOX: Record<StoryTone, string> = {
  tailwind: 'border-border-subtle bg-success-subtle',
  mixed: 'border-border-subtle bg-warning-subtle',
  rebuild: 'border-border-subtle bg-danger-subtle',
};
const TONE_PILL: Record<StoryTone, string> = {
  tailwind: 'bg-success',
  mixed: 'bg-warning',
  rebuild: 'bg-danger',
};
const SIGNAL_TEXT = { up: 'text-success', down: 'text-danger', flat: 'text-text-muted' } as const;

export function EnrollmentStrip({
  enrollment,
  koushuSeasonHeading,
}: {
  enrollment: EnrollmentView;
  /** 今期の見出し（「冬期 2026」）。今期の提案書が無いときに「冬期 2026 の提案なし」と出す */
  koushuSeasonHeading: string;
}) {
  const { regular, koushu, testPrep } = enrollment;
  return (
    <div
      className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 rounded-lg border border-border-subtle px-3 py-1.5 text-[12.5px]"
      data-script-enrollment
    >
      <span className="text-[11.5px] text-text-muted">通常授業</span>
      <span className="text-text-body">
        {regular ? (
          <span className="font-bold text-text-heading">{regular}</span>
        ) : (
          <span className="text-text-faint">通塾日程が未登録</span>
        )}
      </span>

      <span className="text-[11.5px] text-text-muted">講習</span>
      <span className="text-text-body">
        {koushu ? (
          <>
            {koushu.season} <span className="font-bold text-text-heading">{koushu.body}</span>
            <StatusChip label={koushu.status} tone={koushu.status === '申込済' ? 'done' : 'wait'} />
          </>
        ) : (
          <span className="text-text-faint">{koushuSeasonHeading} の提案なし</span>
        )}
      </span>

      <span className="text-[11.5px] text-text-muted">テスト対策</span>
      <span className="text-text-body">
        {testPrep ? (
          <>
            {testPrep.exam} <span className="font-bold text-text-heading">{testPrep.body}</span>
            {testPrep.zoukoma && (
              <span className="ml-1 text-[11.5px] text-text-muted">（{testPrep.zoukoma}）</span>
            )}
          </>
        ) : (
          <span className="text-text-faint">受講なし</span>
        )}
      </span>
    </div>
  );
}

function StatusChip({ label, tone }: { label: string; tone: 'done' | 'wait' }) {
  return (
    <span
      className={`ml-1.5 rounded px-1.5 text-[10.5px] ${
        tone === 'done' ? 'bg-success-subtle text-success' : 'bg-warning-subtle text-warning'
      }`}
    >
      {label}
    </span>
  );
}

const STEP_LABEL: Record<RoadmapStepKey, string> = {
  now: 'いま',
  next: '次の区切り ―― 次の定期テスト・次の模試',
  goal: '入試',
};

export function StoryPanel({
  tone,
  thesis,
  roadmap,
  goalLabel,
  koushuText,
}: {
  tone: StoryToneResult;
  /** AIが書いた今日いちばん言いたいこと。まだ作っていない・書けなければ空 */
  thesis: string;
  roadmap: BriefRoadmapStep[];
  /** 3段目の見出し（中3＝「入試 ―― 2/21」、それ以外＝「学年の終わり」） */
  goalLabel: string;
  /** 講習の印に添える文（「冬期講習 数学8コマ・英語6コマ」）。講習の提案が無ければ null */
  koushuText: string | null;
}) {
  // ★見立ても言いたいことも無ければ何も出さない（空の枠を立てると「抜けている」に見える）
  if (!tone.tone && !thesis) return null;
  const box = tone.tone ? TONE_BOX[tone.tone] : 'border-border-subtle bg-surface-hover';

  return (
    <div className={`mt-2 rounded-lg border px-3 py-2.5 ${box}`} data-script-story>
      {tone.tone ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10.5px] font-bold tracking-widest text-text-muted">見立て</span>
          <span
            className={`rounded-full px-3 text-[13px] font-bold leading-6 text-white ${TONE_PILL[tone.tone]}`}
          >
            {STORY_TONE_LABEL[tone.tone]}
          </span>
          <span className="text-[12px] text-text-body">{STORY_TONE_HOW[tone.tone]}</span>
        </div>
      ) : (
        <span className="text-[11px] text-text-muted">
          見立てに使える記録（内申・模試・定期テスト・宿題）が少ないため、見立ては出していません
        </span>
      )}
      {tone.signals.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {tone.signals.map((s) => (
            <span
              key={s.key}
              className={`rounded border border-border-subtle bg-surface px-1.5 text-[11px] ${SIGNAL_TEXT[s.direction]}`}
            >
              {s.text}
            </span>
          ))}
        </div>
      )}

      {thesis && (
        <div className="mt-2.5">
          <span className="block text-[10.5px] font-bold tracking-widest text-text-muted">
            今日いちばん言いたいこと
          </span>
          <p className="text-[15px] font-bold leading-relaxed text-text-heading">{thesis}</p>
        </div>
      )}

      {roadmap.length > 0 && (
        <div className="mt-2.5 grid grid-cols-1 gap-2 lg:grid-cols-3">
          {roadmap.map((st) => (
            <div
              key={st.key}
              className="rounded-md border border-border-subtle bg-surface px-2.5 py-2 text-[12px]"
            >
              <span className="block text-[10.5px] font-bold text-text-muted">
                {st.key === 'goal' ? goalLabel : STEP_LABEL[st.key]}
              </span>
              <span className="mb-1 block text-[12.5px] font-bold text-text-heading">
                {st.goal}
              </span>
              <div className="grid grid-cols-[auto_1fr] gap-x-1.5 gap-y-0.5">
                {st.juku && (
                  <>
                    <span className="text-[10.5px] text-text-muted">
                      {st.key === 'now' ? '根拠' : '塾'}
                    </span>
                    <span className="text-text-body">{st.juku}</span>
                  </>
                )}
                {st.home && (
                  <>
                    <span className="text-[10.5px] text-text-muted">家庭</span>
                    <span className="text-text-body">{st.home}</span>
                  </>
                )}
              </div>
              {st.koushu && koushuText && (
                <span className="mt-1 inline-block rounded bg-info-subtle px-1.5 text-[11px] text-info">
                  {koushuText}はここ
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      {/* ★注意書きは置かない（2026-09-27 教室長「いらない」）。決め方はヘルプに書いてある */}
    </div>
  );
}
