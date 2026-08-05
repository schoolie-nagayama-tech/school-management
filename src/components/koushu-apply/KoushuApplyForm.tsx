'use client';

/**
 * 講習申込フォーム（保護者向け）— 共有フォーム本体。
 *
 * 正典仕様: docs/koushu-auto-allocation-spec.md 第2部（決定13〜54）。
 * 見た目・文言・挙動の設計図はモック `src/app/schedule/koushu/apply-mock/page.tsx`
 * （採用案: 通える日は案B＝週アコーディオン）。本コンポーネントはそれを実データ・実送信に
 * 移植したもので、`/koushu-apply/[token]` と `/portal/[schoolCode]/koushu` の両ルートから
 * 同じコンポーネントを描画する（§10-1）。
 *
 * 4ステップ: 1.申込内容（個別） 2.特別講座 3.通える日 4.確認。
 * 入出力契約は `src/types/koushu-apply.ts`（正典・変更しない）。
 */
import { useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  chargeableKoma,
  type ApplyAddableSubject,
  type ApplyDuration,
  type ApplyRatio,
  type KoushuApplyFormData,
  type KoushuApplyRequest,
  type KoushuApplyResponse,
} from '@/types/koushu-apply';
import { StepSubjects } from './StepSubjects';
import { StepCourses } from './StepCourses';
import { StepAvailability } from './StepAvailability';
import { StepConfirm } from './StepConfirm';
import { AppliedSummary, AlreadySubmittedNotice } from './AppliedSummary';
import { cellKey } from './koushuApplyClientUtils';

/** どちらの経路（トークン/生徒コード）から開いたかを表す。送信APIへそのまま渡す */
export type KoushuApplyIdentity = { token: string } | { schoolCode: string; studentCode: string };

/** 申込1行（提案書由来 or 保護者が追加した科目）を同じ形で扱う表示用の型 */
export interface ApplyLineView {
  subjectId: string;
  subjectName: string;
  /** 保護者が追加した科目は未定なので空配列 */
  textbookNames: string[];
  theme: string | null;
  proposedKoma: number;
  ratio: ApplyRatio;
  duration: ApplyDuration;
  regularKoma: number;
  /** 単価表に組み合わせが無ければ null（オンライン申込の対象外。決定26） */
  unitPrice: number | null;
  addedByParent: boolean;
}

const STEP_LABELS = ['申込内容', '小集団・プログラミング', '通える日', '確認'] as const;

/** 追加科目の既定形式。1対2・90分があればそれを、無ければ選べる先頭の組み合わせを使う */
function pickDefaultFormat(subject: ApplyAddableSubject): {
  ratio: ApplyRatio;
  duration: ApplyDuration;
} {
  const preferred = subject.options.find((o) => o.ratio === 2 && o.duration === 90);
  const opt = preferred ?? subject.options[0];
  return { ratio: opt.ratio, duration: opt.duration };
}

interface KoushuApplyFormProps {
  data: KoushuApplyFormData;
  identity: KoushuApplyIdentity;
}

export function KoushuApplyForm({ data, identity }: KoushuApplyFormProps) {
  const [step, setStep] = useState(1);
  const [komaBySubject, setKomaBySubject] = useState<Record<string, number>>(() =>
    Object.fromEntries(data.proposals.map((p) => [p.subjectId, p.proposedKoma]))
  );
  const [addedSubjectIds, setAddedSubjectIds] = useState<string[]>([]);
  const [addedFormat, setAddedFormat] = useState<
    Record<string, { ratio: ApplyRatio; duration: ApplyDuration }>
  >({});
  const [ng, setNg] = useState<Set<string>>(new Set());
  const [courseJoin, setCourseJoin] = useState<Set<string>>(new Set());

  const [submitting, setSubmitting] = useState(false);
  const [justSubmitted, setJustSubmitted] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // state更新の反映待ち中に連打されても2重送信しないようにするガード（stateだけだと非同期で間に合わない）
  const submittingRef = useRef(false);

  // ---- 申込明細（提案 ＋ 保護者が追加した科目） ----
  const lines: ApplyLineView[] = useMemo(() => {
    const proposalLines: ApplyLineView[] = data.proposals.map((p) => ({
      subjectId: p.subjectId,
      subjectName: p.subjectName,
      textbookNames: p.textbookNames,
      theme: p.theme,
      proposedKoma: p.proposedKoma,
      ratio: p.ratio,
      duration: p.duration,
      regularKoma: p.regularKoma,
      unitPrice: p.unitPrice,
      addedByParent: false,
    }));
    const addedLines: ApplyLineView[] = addedSubjectIds.map((subjectId) => {
      const subject = data.addableSubjects.find((s) => s.subjectId === subjectId);
      const fmt =
        addedFormat[subjectId] ??
        (subject ? pickDefaultFormat(subject) : { ratio: 2, duration: 90 });
      const option = subject?.options.find(
        (o) => o.ratio === fmt.ratio && o.duration === fmt.duration
      );
      return {
        subjectId,
        subjectName: subject?.subjectName ?? '不明な科目',
        textbookNames: [],
        theme: null,
        proposedKoma: 0,
        ratio: fmt.ratio,
        duration: fmt.duration,
        // 提案外に追加した科目は通常授業で取っていない前提（全コマが講習費の対象。決定25）
        regularKoma: 0,
        unitPrice: option?.unitPrice ?? null,
        addedByParent: true,
      };
    });
    return [...proposalLines, ...addedLines];
  }, [data.proposals, data.addableSubjects, addedSubjectIds, addedFormat]);

  const bumpKoma = (subjectId: string, delta: number) =>
    setKomaBySubject((prev) => ({
      ...prev,
      [subjectId]: Math.max(0, (prev[subjectId] ?? 0) + delta),
    }));

  const addSubject = (subjectId: string) => {
    const subject = data.addableSubjects.find((s) => s.subjectId === subjectId);
    if (!subject) return;
    setAddedSubjectIds((prev) => [...prev, subjectId]);
    setAddedFormat((prev) => ({ ...prev, [subjectId]: pickDefaultFormat(subject) }));
    setKomaBySubject((prev) => ({ ...prev, [subjectId]: 2 }));
  };

  const removeSubject = (subjectId: string) => {
    setAddedSubjectIds((prev) => prev.filter((s) => s !== subjectId));
    setAddedFormat((prev) => {
      const next = { ...prev };
      delete next[subjectId];
      return next;
    });
    setKomaBySubject((prev) => {
      const next = { ...prev };
      delete next[subjectId];
      return next;
    });
  };

  /** 追加科目の形式変更。変更後の組み合わせに単価が無ければ、そのratioで選べる先頭の時間に補正する */
  const setSubjectFormat = (
    subjectId: string,
    patch: Partial<{ ratio: ApplyRatio; duration: ApplyDuration }>
  ) => {
    const subject = data.addableSubjects.find((s) => s.subjectId === subjectId);
    setAddedFormat((prev) => {
      const current =
        prev[subjectId] ?? (subject ? pickDefaultFormat(subject) : { ratio: 2, duration: 90 });
      let next = { ...current, ...patch };
      if (
        subject &&
        !subject.options.some((o) => o.ratio === next.ratio && o.duration === next.duration)
      ) {
        const fallback = subject.options.find((o) => o.ratio === next.ratio) ?? subject.options[0];
        if (fallback) next = { ratio: fallback.ratio, duration: fallback.duration };
      }
      return { ...prev, [subjectId]: next };
    });
  };

  // ---- 個別の集計（講習費は通常授業ぶんを差し引く。決定27・単価未設定の科目は集計・送信のどちらからも除外） ----
  const totals = useMemo(() => {
    let totalKoma = 0;
    let totalRegular = 0;
    let totalChargeable = 0;
    let totalFee = 0;
    for (const line of lines) {
      if (line.unitPrice == null) continue;
      const koma = komaBySubject[line.subjectId] ?? 0;
      totalKoma += koma;
      totalRegular += Math.min(koma, line.regularKoma);
      const chargeable = chargeableKoma(koma, line.regularKoma);
      totalChargeable += chargeable;
      totalFee += chargeable * line.unitPrice;
    }
    return { totalKoma, totalRegular, totalChargeable, totalFee };
  }, [lines, komaBySubject]);

  // ---- 特別講座（小集団・プログラミング） ----
  const toggleCourse = (courseId: string) =>
    setCourseJoin((prev) => {
      const next = new Set(prev);
      if (next.has(courseId)) next.delete(courseId);
      else next.add(courseId);
      return next;
    });
  const joinedCourses = useMemo(
    () => data.courses.filter((c) => courseJoin.has(c.courseId)),
    [data.courses, courseJoin]
  );
  const totalCourseFee = useMemo(
    () => joinedCourses.reduce((sum, c) => sum + c.unitPrice * c.remainingCount, 0),
    [joinedCourses]
  );
  const grandTotal = totals.totalFee + totalCourseFee;

  // ---- 通える日（全○初期・×だけを持つ） ----
  const slotsByDate = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const s of data.availabilitySlots) {
      const list = map.get(s.date) ?? [];
      list.push(s.timeSlot);
      map.set(s.date, list);
    }
    for (const list of Array.from(map.values())) list.sort();
    return map;
  }, [data.availabilitySlots]);
  const dates = useMemo(() => Array.from(slotsByDate.keys()).sort(), [slotsByDate]);
  const totalOpenSlots = data.availabilitySlots.length;
  const okCells = totalOpenSlots - ng.size;

  const toggleKeys = (keys: string[]) =>
    setNg((prev) => {
      const next = new Set(prev);
      const allNg = keys.every((k) => next.has(k));
      for (const k of keys) {
        if (allNg) next.delete(k);
        else next.add(k);
      }
      return next;
    });
  const toggleSlot = (key: string) => toggleKeys([key]);
  const toggleDay = (date: string) =>
    toggleKeys((slotsByDate.get(date) ?? []).map((ts) => cellKey(date, ts)));
  const toggleWeek = (weekDates: string[]) =>
    toggleKeys(weekDates.flatMap((d) => (slotsByDate.get(d) ?? []).map((ts) => cellKey(d, ts))));
  const toggleTimeSlotInWeek = (weekDates: string[], timeSlot: string) =>
    toggleKeys(
      weekDates
        .filter((d) => (slotsByDate.get(d) ?? []).includes(timeSlot))
        .map((d) => cellKey(d, timeSlot))
    );

  // ---- 送信 ----
  const handleSubmit = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const body: KoushuApplyRequest = {
        token: 'token' in identity ? identity.token : null,
        schoolCode: 'schoolCode' in identity ? identity.schoolCode : null,
        studentCode: 'studentCode' in identity ? identity.studentCode : null,
        // 単価未設定の科目は送るとAPIが400で全体を弾くため、送信対象から除外する
        subjects: lines
          .filter((l) => l.unitPrice != null)
          .map((l) => ({
            subjectId: l.subjectId,
            koma: komaBySubject[l.subjectId] ?? 0,
            ratio: l.ratio,
            duration: l.duration,
          })),
        courses: Array.from(courseJoin).map((courseId) => ({ courseId })),
        unavailableSlots: data.availabilitySlots.filter((s) => ng.has(cellKey(s.date, s.timeSlot))),
      };
      const res = await fetch('/api/koushu-apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as KoushuApplyResponse;
      if (!res.ok || !json.ok) {
        setErrorMessage(json.message || '送信に失敗しました。もう一度お試しください。');
        return;
      }
      setJustSubmitted(true);
    } catch {
      setErrorMessage('通信に失敗しました。電波の良い場所でもう一度お試しください。');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const readOnly = data.alreadySubmitted || justSubmitted;

  return (
    <div className="min-h-[100dvh] bg-[#f8f9fa] flex flex-col">
      <header
        className="sticky top-0 z-10 bg-white border-b border-[var(--stroke)] px-4 py-3"
        style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
      >
        <div className="max-w-lg mx-auto w-full">
          <p className="text-[11px] text-[var(--paragraph)]">{data.period.label}</p>
          <p className="text-sm font-semibold text-[var(--headline)]">
            {data.student.name}{' '}
            <span className="text-xs font-normal">（{data.student.gradeLabel}）</span>
          </p>
          {!readOnly && (
            <div className="flex gap-1 mt-2">
              {STEP_LABELS.map((label, i) => (
                <div key={label} className="flex-1">
                  <div
                    className={`h-1 rounded-full ${step >= i + 1 ? 'bg-ink' : 'bg-gray-200'}`}
                    aria-hidden
                  />
                  <p
                    className={`text-[10px] mt-1 ${
                      step >= i + 1 ? 'text-[var(--headline)]' : 'text-[var(--paragraph)]'
                    }`}
                  >
                    {label}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 max-w-lg mx-auto w-full px-4 py-4 pb-24">
        {readOnly ? (
          justSubmitted ? (
            <AppliedSummary
              lines={lines}
              komaBySubject={komaBySubject}
              totals={totals}
              joinedCourses={joinedCourses}
              totalCourseFee={totalCourseFee}
              grandTotal={grandTotal}
            />
          ) : (
            <AlreadySubmittedNotice />
          )
        ) : (
          <>
            {step === 1 && (
              <StepSubjects
                lines={lines}
                komaBySubject={komaBySubject}
                bumpKoma={bumpKoma}
                addableSubjects={data.addableSubjects}
                addedSubjectIds={addedSubjectIds}
                addSubject={addSubject}
                removeSubject={removeSubject}
                setSubjectFormat={setSubjectFormat}
                allow45={data.allow45}
                totals={totals}
              />
            )}
            {step === 2 && (
              <StepCourses
                courses={data.courses}
                courseJoin={courseJoin}
                toggleCourse={toggleCourse}
                totalCourseFee={totalCourseFee}
              />
            )}
            {step === 3 && (
              <StepAvailability
                dates={dates}
                slotsByDate={slotsByDate}
                ng={ng}
                toggleSlot={toggleSlot}
                toggleDay={toggleDay}
                toggleWeek={toggleWeek}
                toggleTimeSlotInWeek={toggleTimeSlotInWeek}
                totalOpenSlots={totalOpenSlots}
                okCells={okCells}
                totalKoma={totals.totalKoma}
              />
            )}
            {step === 4 && (
              <StepConfirm
                lines={lines}
                komaBySubject={komaBySubject}
                totals={totals}
                joinedCourses={joinedCourses}
                totalCourseFee={totalCourseFee}
                grandTotal={grandTotal}
                okCells={okCells}
                totalOpenSlots={totalOpenSlots}
              />
            )}
          </>
        )}
      </main>

      {!readOnly && (
        <div
          className="sticky bottom-0 bg-white border-t border-[var(--stroke)] px-4 py-3"
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        >
          <div className="max-w-lg mx-auto w-full space-y-2">
            {errorMessage && <p className="text-xs text-danger">{errorMessage}</p>}
            <div className="flex gap-2">
              {step > 1 && (
                <button
                  type="button"
                  onClick={() => setStep(step - 1)}
                  disabled={submitting}
                  className="px-3 py-2.5 rounded-lg border border-[var(--stroke)] text-sm text-[var(--headline)] flex items-center gap-1 disabled:opacity-50"
                >
                  <ChevronLeft className="w-4 h-4" />
                  戻る
                </button>
              )}
              <button
                type="button"
                onClick={() => (step === 4 ? handleSubmit() : setStep(Math.min(4, step + 1)))}
                disabled={submitting}
                className="flex-1 px-3 py-2.5 rounded-lg bg-ink text-white text-sm font-medium disabled:opacity-40 flex items-center justify-center gap-1"
              >
                {step === 4 ? (submitting ? '送信中…' : 'この内容で申し込む') : '次へ'}
                {step < 4 && <ChevronRight className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
