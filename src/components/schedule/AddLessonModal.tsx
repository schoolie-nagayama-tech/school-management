'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui';
import { Button } from '@/components/ui';
import { MapPin } from 'lucide-react';
import { StudentPickerList, type StudentPickerItem } from './StudentPickerList';
import { InquirySearchInput } from './InquirySearchInput';
import { getStudentContractRatioMap } from '@/lib/api/student-subject-contracts';
import type { HalfPosition } from '@/types/schedule';
import type { Subject } from '@/types/database';
import type { Inquiry } from '@/types/database';
import { getInquiryDisplayName } from '@/app/admin/inquiries/inquiryConstants';
import {
  groupSubjectsForSelect,
  subjectOptionLabel,
  filterSubjectsForGrade,
  gradeCategoryFromStudentGrade,
  gradeCategoryFromInquiryGrade,
  type SubjectGradeCategory,
} from '@/lib/utils/subjectOptions';

/** 種別タブ。追加授業（additional）/ 体験授業（trial）。 */
type LessonKind = 'additional' | 'trial';
/** 体験の対象者切替。既存生徒 / 問合せ名簿の見込み客。 */
type TrialTarget = 'student' | 'inquiry';

/**
 * Phase P2: 「授業を追加」モーダルの Step1 確定内容。
 * 講師・日付・コマは持たず、座席表のセル/講師カードのクリックで決める（＝配置モード化）。
 */
export interface AddLessonPlacementPayload {
  kind: LessonKind;
  /** 既存生徒（追加授業 / 体験×既存生徒）。見込み客のときは null。 */
  studentId: string | null;
  /** 体験の見込み客（問合せ）。studentId と排他。 */
  inquiryId: string | null;
  /** バナー表示用の対象者名。 */
  displayName: string;
  subjectId: string;
  subjectName: string;
  ratio: 1 | 2;
  durationMinutes: number | null;
  halfPosition: HalfPosition;
  /** 登録したいコマ数（1〜20）。この数だけ配置したら配置モードを自動終了する。 */
  targetCount: number;
}

export interface AddLessonModalProps {
  isOpen: boolean;
  onClose: () => void;
  schoolId: string;
  subjects: Subject[];
  /** Step1 確定 → 親が placingAdhoc('lesson') を開始する。 */
  onStartPlacement: (payload: AddLessonPlacementPayload) => void;
}

/**
 * ツールバー起点の「授業を追加」モーダル（Phase T → Phase P2 で配置モード化）。
 *
 * Step1 で 種別・対象者・科目・比率/45分 を選び、「座席表から日程を選ぶ」で閉じて配置モードへ。
 * 実際のコマ登録は座席表のセル/講師カードクリックで行う（複数コマ一括・担当未決定に対応）。
 */
export function AddLessonModal({
  isOpen,
  onClose,
  schoolId,
  subjects,
  onStartPlacement,
}: AddLessonModalProps) {
  const { profile } = useAuth();
  void profile; // 予約：将来 created_by 等で使う可能性。

  const [kind, setKind] = useState<LessonKind>('additional');
  const [trialTarget, setTrialTarget] = useState<TrialTarget>('inquiry');
  const [selectedStudent, setSelectedStudent] = useState<StudentPickerItem | null>(null);
  const [selectedInquiry, setSelectedInquiry] = useState<Inquiry | null>(null);
  const [subjectId, setSubjectId] = useState<string>('');
  // Phase R: 追加授業（既存生徒）のみ 指導比率・45分前後半を出す。体験は ratio=2 固定・半コマなし。
  const [ratio, setRatio] = useState<1 | 2>(2);
  const [halfPosition, setHalfPosition] = useState<HalfPosition>(null);
  const [contractRatioMap, setContractRatioMap] = useState<Map<string, 1 | 2>>(new Map());
  // P2改訂: 登録したいコマ数（1〜20）。この数だけ配置したら配置モードを自動終了する。
  const [targetCount, setTargetCount] = useState<number>(1);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // P2改訂: 対象者の学年区分。選択済みのときだけ科目を絞る（未選択・推定不能なら全区分表示）。
  const gradeCategory: SubjectGradeCategory | null = useMemo(() => {
    if (kind === 'trial' && trialTarget === 'inquiry') {
      return selectedInquiry ? gradeCategoryFromInquiryGrade(selectedInquiry.grade) : null;
    }
    return selectedStudent ? gradeCategoryFromStudentGrade(selectedStudent.grade) : null;
  }, [kind, trialTarget, selectedInquiry, selectedStudent]);

  // 学年区分で絞った科目。区分内に該当ゼロなら全表示へフォールバック（noneForGrade で注意文）。
  const filteredForGrade = useMemo(
    () => filterSubjectsForGrade(subjects, gradeCategory),
    [subjects, gradeCategory]
  );
  const noneForGrade = !!gradeCategory && filteredForGrade.length === 0;
  const shownSubjects = noneForGrade ? subjects : filteredForGrade;

  const selectedSubject = subjects.find((s) => s.id === subjectId);
  const is45 = selectedSubject?.duration_minutes === 45;

  // 体験×問合せ（見込み客）のときは既存生徒の入力・比率UIを出さない。
  const isInquiryTrial = kind === 'trial' && trialTarget === 'inquiry';
  // 比率・45分UIを出すのは「追加授業（＝既存生徒）」のときだけ（体験はシンプルに）。
  const showRatioUi = kind === 'additional';

  // 開くたびに初期化。
  useEffect(() => {
    if (!isOpen) return;
    setKind('additional');
    setTrialTarget('inquiry');
    setSelectedStudent(null);
    setSelectedInquiry(null);
    setSubjectId(subjects[0]?.id ?? '');
    setRatio(2);
    setHalfPosition(null);
    setContractRatioMap(new Map());
    setTargetCount(1);
    setErrorMsg(null);
  }, [isOpen, subjects]);

  // 対象者の学年区分で科目を絞った結果、現在の選択が候補外になったら先頭へ寄せる。
  useEffect(() => {
    if (shownSubjects.length === 0) return;
    if (!shownSubjects.some((s) => s.id === subjectId)) {
      setSubjectId(shownSubjects[0].id);
    }
  }, [shownSubjects, subjectId]);

  // 追加授業の既存生徒選択時：契約比率マップを読み込む（科目選択時の ratio 初期値に使う）。
  useEffect(() => {
    if (!selectedStudent) {
      setContractRatioMap(new Map());
      return;
    }
    let cancelled = false;
    getStudentContractRatioMap(selectedStudent.id).then((m) => {
      if (!cancelled) setContractRatioMap(m);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedStudent]);

  // 科目変更時：ratio は契約から初期化、half は45分科目なら前半を既定に。
  useEffect(() => {
    if (!showRatioUi) return;
    setRatio(contractRatioMap.get(subjectId) ?? 2);
    setHalfPosition(selectedSubject?.duration_minutes === 45 ? 'first' : null);
  }, [subjectId, contractRatioMap, selectedSubject?.duration_minutes, showRatioUi]);

  const canStart = useMemo(() => {
    if (!schoolId || !subjectId) return false;
    if (isInquiryTrial) return !!selectedInquiry;
    return !!selectedStudent;
  }, [schoolId, subjectId, isInquiryTrial, selectedInquiry, selectedStudent]);

  const handleStart = () => {
    if (!subjectId || !selectedSubject) {
      setErrorMsg('科目を選択してください');
      return;
    }
    if (isInquiryTrial) {
      if (!selectedInquiry) {
        setErrorMsg('問合せを選択してください');
        return;
      }
      onStartPlacement({
        kind: 'trial',
        studentId: null,
        inquiryId: selectedInquiry.id,
        displayName: getInquiryDisplayName(selectedInquiry).name,
        subjectId,
        subjectName: selectedSubject.name,
        ratio: 2,
        durationMinutes: null,
        halfPosition: null,
        targetCount,
      });
      onClose();
      return;
    }
    if (!selectedStudent) {
      setErrorMsg('生徒を選択してください');
      return;
    }
    // 体験×既存生徒はシンプルに ratio=2・全コマ。追加授業は選んだ比率・半コマ。
    const effRatio: 1 | 2 = showRatioUi ? ratio : 2;
    const effHalf: HalfPosition = showRatioUi && is45 ? halfPosition : null;
    const effDuration = showRatioUi ? (selectedSubject.duration_minutes ?? null) : null;
    onStartPlacement({
      kind,
      studentId: selectedStudent.id,
      inquiryId: null,
      displayName: `${selectedStudent.last_name}${selectedStudent.first_name}`,
      subjectId,
      subjectName: selectedSubject.name,
      ratio: effRatio,
      durationMinutes: effDuration,
      halfPosition: effHalf,
      targetCount,
    });
    onClose();
  };

  const selectClass =
    'w-full px-3 py-2 border border-[var(--stroke)] rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)]';

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md bg-white border border-gray-200">
        <DialogHeader>
          <DialogTitle>授業を追加</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* 種別タブ：追加授業 / 体験授業 */}
          <div className="inline-flex rounded-lg bg-[var(--surface)] p-0.5 w-full">
            {[
              { v: 'additional' as const, label: '追加授業' },
              { v: 'trial' as const, label: '体験授業' },
            ].map((t) => (
              <button
                key={t.v}
                type="button"
                onClick={() => setKind(t.v)}
                className={`flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  kind === t.v
                    ? 'bg-white text-[var(--headline)] shadow-sm'
                    : 'text-[var(--paragraph-light)] hover:text-[var(--headline)]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* 対象者 */}
          <div>
            <label className="block text-xs font-medium text-[var(--paragraph)] mb-1">対象者</label>
            {kind === 'trial' && (
              // 体験のみ「既存生徒 / 問合せ名簿」のサブトグルを出す。
              <div className="inline-flex rounded-lg bg-[var(--surface)] p-0.5 mb-2">
                {[
                  { v: 'inquiry' as const, label: '問合せ名簿' },
                  { v: 'student' as const, label: '既存生徒' },
                ].map((t) => (
                  <button
                    key={t.v}
                    type="button"
                    onClick={() => setTrialTarget(t.v)}
                    className={`px-3 py-0.5 rounded-md text-xs font-medium transition-colors ${
                      trialTarget === t.v
                        ? 'bg-white text-[var(--headline)] shadow-sm'
                        : 'text-[var(--paragraph-light)] hover:text-[var(--headline)]'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}

            {isInquiryTrial ? (
              <>
                <InquirySearchInput schoolId={schoolId} onSelect={setSelectedInquiry} />
                {selectedInquiry && (
                  <div className="mt-2 text-sm text-[var(--headline)]">
                    選択: {getInquiryDisplayName(selectedInquiry).name}
                    <span className="ml-1 text-xs text-[var(--paragraph-light)]">（見込み客）</span>
                  </div>
                )}
              </>
            ) : selectedStudent ? (
              <div className="flex items-center gap-2">
                <div className="flex-1 text-sm text-[var(--headline)]">
                  選択: {selectedStudent.last_name} {selectedStudent.first_name}
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedStudent(null)}
                  className="text-xs text-[var(--paragraph-light)] hover:text-[var(--headline)] underline"
                >
                  選び直す
                </button>
              </div>
            ) : (
              // Phase P2: 提案書仕様の一括ロード＋学年グルーピングのピッカーに統一。
              <StudentPickerList
                schoolIds={schoolId ? [schoolId] : []}
                onSelect={setSelectedStudent}
                selectedId={null}
              />
            )}
          </div>

          {/* 科目 */}
          <div>
            <label className="block text-xs font-medium text-[var(--paragraph)] mb-1">科目</label>
            <select
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
              className={selectClass}
            >
              {shownSubjects.length === 0 ? (
                <option value="">科目が登録されていません</option>
              ) : (
                groupSubjectsForSelect(shownSubjects).map((g) => (
                  <optgroup key={g.label} label={g.label}>
                    {g.subjects.map((s) => (
                      <option key={s.id} value={s.id}>
                        {subjectOptionLabel(s)}
                      </option>
                    ))}
                  </optgroup>
                ))
              )}
            </select>
            {noneForGrade && (
              // 対象者の学年区分に該当する科目が無い → 全科目にフォールバックしている旨を明示。
              <p className="mt-1 text-[11px] text-[var(--paragraph-light)]">
                該当学年の科目がありません（全科目を表示しています）
              </p>
            )}
          </div>

          {/* P2改訂: コマ数。この数だけ座席表に配置したら配置モードを自動終了する。 */}
          <div>
            <label className="block text-xs font-medium text-[var(--paragraph)] mb-1">コマ数</label>
            <input
              type="number"
              min={1}
              max={20}
              value={targetCount}
              onChange={(e) => {
                const n = Math.floor(Number(e.target.value));
                setTargetCount(Number.isFinite(n) ? Math.min(20, Math.max(1, n)) : 1);
              }}
              className={selectClass}
            />
            <p className="mt-1 text-[11px] text-[var(--paragraph-light)]">
              指定した数だけ配置すると自動で終了します。途中で「完了」した残りは未消化プールに退避します
            </p>
          </div>

          {/* Phase R: 追加授業（既存生徒）のみ 指導比率＋45分前後半 */}
          {showRatioUi && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[var(--paragraph)] mb-1">
                  指導比率
                </label>
                <select
                  value={String(ratio)}
                  onChange={(e) => setRatio(e.target.value === '1' ? 1 : 2)}
                  className={selectClass}
                >
                  <option value="2">1対2</option>
                  <option value="1">1対1（1名で満席）</option>
                </select>
              </div>
              {is45 && (
                <div>
                  <label className="block text-xs font-medium text-[var(--paragraph)] mb-1">
                    45分の前後半
                  </label>
                  <select
                    value={halfPosition ?? 'first'}
                    onChange={(e) => setHalfPosition(e.target.value as HalfPosition)}
                    className={selectClass}
                  >
                    <option value="first">前半（コマ開始〜+45分）</option>
                    <option value="second">後半（コマ終了−45分〜終了）</option>
                  </select>
                </div>
              )}
            </div>
          )}

          {errorMsg && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
              <div className="font-medium">開始できません</div>
              <div className="mt-1">{errorMsg}</div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            キャンセル
          </Button>
          <Button
            onClick={handleStart}
            disabled={!canStart}
            className="bg-[#1e3a5f] hover:bg-[#2a4a6f] flex items-center gap-1"
          >
            <MapPin className="h-4 w-4" />
            座席表から日程を選ぶ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
