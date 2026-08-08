'use client';

/**
 * 講習（個別）自動配置の実行パネル（§11）。
 *
 * 正典仕様: docs/koushu-auto-allocation-spec.md §4（実行時設定）・§5-5（再実行）・§11。
 *
 * ここでやること:
 *  - 対象学年の複数選択（決定21）。小学生/中学生/高校生のショートカット付き
 *  - 実行時設定4つ（1日上限・連続優先・同日同科目・科目の均等分散）。前回値を localStorage 記憶
 *  - 再実行モード（破棄 / 差分。§5-5）
 *  - 実行 → 下書き（schedule_match_batches + schedule_match_proposals）
 *  - 結果と未割当理由（5分類）の表示
 *
 * ★ 公開済みエントリと手動配置には破棄モードでも触れない。
 *   破棄が消すのは「この期間の下書き提案」だけ（status='dismissed' にするので履歴は残る）。
 */

import { useState, useEffect, useCallback } from 'react';
import { Wand2, Info, AlertTriangle } from 'lucide-react';
import {
  runKoushuAllocation,
  type KoushuRerunMode,
  type RunKoushuAllocationResult,
} from '@/lib/api/koushu-match';
import { DEFAULT_SETTINGS, type AllocatorSettings } from '@/lib/koushu-allocator/types';
import { getKoushuApplyPeriods } from '@/lib/api/koushuApplyAdmin';
import type { KoushuPeriodInfo } from '@/lib/api/koushu-period';
import { GRADE_LABELS } from '@/types/database';

interface Props {
  period: KoushuPeriodInfo;
  schoolId: string;
  /** 実行者の user_id */
  executedBy: string;
  /** 実行が終わって下書きが変わったとき（親が提案一覧を読み直す） */
  onCompleted: (batchId: string | null) => void;
}

/**
 * 学年ショートカット。
 * 「受験生」は作らない（決定51: 小6でも中学受験する子、中3でも中高一貫で受験しない子がいて
 * 定義できないため。学年を直接選ぶ運用にする）。
 */
const GRADE_SHORTCUTS: Array<{ label: string; grades: number[] }> = [
  { label: '小学生', grades: [1, 2, 3, 4, 5, 6] },
  { label: '中学生', grades: [7, 8, 9] },
  { label: '高校生', grades: [10, 11, 12] },
];

const ALL_GRADES = Object.keys(GRADE_LABELS)
  .map(Number)
  .sort((a, b) => a - b);

const settingsStorageKey = (schoolId: string) => `koushu_alloc_settings_${schoolId}`;

/** localStorage から実行時設定を読む（壊れていたら既定値。例外は投げない） */
function loadStoredSettings(schoolId: string): AllocatorSettings {
  if (typeof window === 'undefined') return { ...DEFAULT_SETTINGS };
  try {
    const raw = window.localStorage.getItem(settingsStorageKey(schoolId));
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<AllocatorSettings>;
    return {
      maxKomaPerStudentPerDay:
        typeof parsed.maxKomaPerStudentPerDay === 'number' && parsed.maxKomaPerStudentPerDay >= 1
          ? parsed.maxKomaPerStudentPerDay
          : DEFAULT_SETTINGS.maxKomaPerStudentPerDay,
      preferConsecutive:
        typeof parsed.preferConsecutive === 'boolean'
          ? parsed.preferConsecutive
          : DEFAULT_SETTINGS.preferConsecutive,
      allowSameSubjectSameDay:
        typeof parsed.allowSameSubjectSameDay === 'boolean'
          ? parsed.allowSameSubjectSameDay
          : DEFAULT_SETTINGS.allowSameSubjectSameDay,
      spreadSubjectEvenly:
        typeof parsed.spreadSubjectEvenly === 'boolean'
          ? parsed.spreadSubjectEvenly
          : DEFAULT_SETTINGS.spreadSubjectEvenly,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function KoushuAllocationPanel({ period, schoolId, executedBy, onCompleted }: Props) {
  const [settings, setSettings] = useState<AllocatorSettings>(() => loadStoredSettings(schoolId));
  const [selectedGrades, setSelectedGrades] = useState<number[]>([]); // 空＝全学年
  const [rerunMode, setRerunMode] = useState<KoushuRerunMode>('discard');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunKoushuAllocationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 学年別の講習終了日（決定44）。course_prep_periods から読む */
  const [endByGrade, setEndByGrade] = useState<Record<string, string> | null>(null);

  // 教室を切り替えたら記憶した設定を読み直す
  useEffect(() => {
    setSettings(loadStoredSettings(schoolId));
    setResult(null);
  }, [schoolId]);

  // 学年別終了日を取得（失敗しても共通の終了日で動くので致命的ではない）
  useEffect(() => {
    let cancelled = false;
    getKoushuApplyPeriods(schoolId)
      .then((rows) => {
        if (cancelled) return;
        const hit = rows.find((r) => r.season === period.season && r.year === period.year);
        setEndByGrade(hit?.scheduleEndByGrade ?? null);
      })
      .catch((err) => {
        console.error('[KoushuAllocationPanel] 学年別終了日の取得に失敗:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [schoolId, period.season, period.year]);

  const updateSettings = useCallback(
    (patch: Partial<AllocatorSettings>) => {
      setSettings((prev) => {
        const next = { ...prev, ...patch };
        try {
          window.localStorage.setItem(settingsStorageKey(schoolId), JSON.stringify(next));
        } catch {
          // localStorage が使えない環境（プライベートモード等）でも実行自体は続けられる
        }
        return next;
      });
    },
    [schoolId]
  );

  const toggleGrade = (grade: number) => {
    setSelectedGrades((prev) =>
      prev.includes(grade)
        ? prev.filter((g) => g !== grade)
        : [...prev, grade].sort((a, b) => a - b)
    );
  };

  const handleRun = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await runKoushuAllocation({
        schoolId,
        period,
        executedBy,
        settings,
        gradeFilter: selectedGrades.length > 0 ? selectedGrades : null,
        scheduleEndByGrade: endByGrade,
        rerunMode,
      });
      setResult(res);
      onCompleted(res.batchId);
    } catch (e) {
      console.error('[KoushuAllocationPanel] 実行に失敗:', e);
      setError(e instanceof Error ? e.message : '自動配置に失敗しました');
    } finally {
      setRunning(false);
    }
  };

  const gradeSummary =
    selectedGrades.length === 0
      ? '全学年'
      : selectedGrades.map((g) => GRADE_LABELS[g] ?? g).join('・');

  return (
    <div className="rounded-lg border border-border-subtle p-2.5 space-y-2.5">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-text-body">個別 自動配置</span>
        <span className="text-[11px] text-text-muted">{gradeSummary}</span>
        <button
          type="button"
          onClick={handleRun}
          disabled={running}
          className="ml-auto inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-info text-white hover:bg-info/90 active:scale-[0.97] transition-[background-color,transform] duration-150 disabled:opacity-50"
        >
          <Wand2 className="w-3.5 h-3.5" />
          {running ? '実行中…' : '自動配置を実行'}
        </button>
      </div>

      {/* 対象学年（決定21） */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] text-text-muted w-14 shrink-0">対象学年</span>
          <button
            type="button"
            onClick={() => setSelectedGrades([])}
            className={`px-2 py-0.5 text-[11px] rounded border transition-colors duration-150 ${
              selectedGrades.length === 0
                ? 'bg-info text-white border-info'
                : 'border-border-default text-text-muted hover:bg-surface-hover'
            }`}
          >
            全学年
          </button>
          {GRADE_SHORTCUTS.map((sc) => (
            <button
              key={sc.label}
              type="button"
              onClick={() => setSelectedGrades(sc.grades)}
              className="px-2 py-0.5 text-[11px] rounded border border-border-default text-text-muted hover:bg-surface-hover transition-colors duration-150"
            >
              {sc.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 flex-wrap pl-[3.875rem]">
          {ALL_GRADES.map((g) => {
            const on = selectedGrades.includes(g);
            return (
              <button
                key={g}
                type="button"
                onClick={() => toggleGrade(g)}
                className={`px-1.5 py-0.5 text-[11px] rounded border transition-colors duration-150 ${
                  on
                    ? 'bg-info-subtle text-info border-info/40'
                    : 'border-border-subtle text-text-faint hover:bg-surface-hover'
                }`}
              >
                {GRADE_LABELS[g]}
              </button>
            );
          })}
        </div>
      </div>

      {/* 実行時設定（§4）。前回値は localStorage に記憶する */}
      <div className="flex items-center gap-3 flex-wrap text-[11px]">
        <span className="text-text-muted w-14 shrink-0">設定</span>
        <label className="flex items-center gap-1 text-text-body">
          1日上限
          <select
            value={settings.maxKomaPerStudentPerDay}
            onChange={(e) => updateSettings({ maxKomaPerStudentPerDay: Number(e.target.value) })}
            className="px-1 py-0.5 border border-border rounded bg-surface text-text-body"
          >
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n}コマ
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1 text-text-body cursor-pointer">
          <input
            type="checkbox"
            checked={settings.preferConsecutive}
            onChange={(e) => updateSettings({ preferConsecutive: e.target.checked })}
          />
          連続コマを優先
        </label>
        <label className="flex items-center gap-1 text-text-body cursor-pointer">
          <input
            type="checkbox"
            checked={settings.allowSameSubjectSameDay}
            onChange={(e) => updateSettings({ allowSameSubjectSameDay: e.target.checked })}
          />
          同じ日に同じ科目を許可
        </label>
        <label className="flex items-center gap-1 text-text-body cursor-pointer">
          <input
            type="checkbox"
            checked={settings.spreadSubjectEvenly}
            onChange={(e) => updateSettings({ spreadSubjectEvenly: e.target.checked })}
          />
          科目を期間全体に散らす
        </label>
      </div>

      {/* 再実行モード（§5-5） */}
      <div className="flex items-center gap-3 flex-wrap text-[11px]">
        <span className="text-text-muted w-14 shrink-0">再実行</span>
        <label className="flex items-center gap-1 text-text-body cursor-pointer">
          <input
            type="radio"
            name="koushu-rerun-mode"
            checked={rerunMode === 'discard'}
            onChange={() => setRerunMode('discard')}
          />
          下書きを破棄して組み直す
        </label>
        <label className="flex items-center gap-1 text-text-body cursor-pointer">
          <input
            type="radio"
            name="koushu-rerun-mode"
            checked={rerunMode === 'diff'}
            onChange={() => setRerunMode('diff')}
          />
          差分（今の下書きは残して埋める）
        </label>
        <span className="text-text-faint">公開済み・手動配置はどちらでも触りません</span>
      </div>

      {/* 結果 */}
      {result && (
        <div className="space-y-1.5 text-[11px]">
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-text-body">
            <span>
              提案 <strong className="tabular-nums">{result.proposalsCreated}</strong> 件
            </span>
            <span className="text-text-muted">
              申込 {result.requestedKoma} コマ中 {result.assignedKoma} コマ配置
            </span>
            {result.repairedKoma > 0 && (
              <span className="text-text-muted">入替えで救済 {result.repairedKoma} コマ</span>
            )}
            <span className="text-text-muted">均等度 {result.evenness.toFixed(2)}</span>
            {result.dismissedDrafts > 0 && (
              <span className="text-text-muted">
                既存の下書き {result.dismissedDrafts} 件を破棄
              </span>
            )}
          </div>

          {/* 実データの欠損の注意書き（黙って劣化させない） */}
          {result.notes.subjectAssignmentIsProvisional && (
            <div className="flex gap-1.5 rounded border border-warning/30 bg-warning-subtle/40 p-1.5">
              <Info className="w-3.5 h-3.5 text-warning shrink-0 mt-px" />
              <p className="text-text-body">
                Web申込がまだ無いため、<strong>科目は暫定割当</strong>
                です（紙の申込コマ数から推定）。科目別の内訳は目安として見てください。
              </p>
            </div>
          )}
          {result.notes.studentAvailabilitySource === 'regular_pattern' && (
            <div className="flex gap-1.5 rounded border border-warning/30 bg-warning-subtle/40 p-1.5">
              <Info className="w-3.5 h-3.5 text-warning shrink-0 mt-px" />
              <p className="text-text-body">
                講習の通塾可能表が未提出のため、<strong>普段の通塾日程</strong>
                を可能枠として使いました。
              </p>
            </div>
          )}
          {result.notes.unresolvedTeachers.length > 0 && (
            <div className="flex gap-1.5 rounded border border-warning/30 bg-warning-subtle/40 p-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-warning shrink-0 mt-px" />
              <p className="text-text-body">
                講習シフトの提出者 {result.notes.unresolvedTeachers.length} 名
                をアカウントに紐付けられず、出勤として数えていません（
                {result.notes.unresolvedTeachers.slice(0, 5).join('・')}
                {result.notes.unresolvedTeachers.length > 5 ? ' ほか' : ''}）。
              </p>
            </div>
          )}
          {result.notes.unresolvedTimeSlots > 0 && (
            <p className="text-text-muted">
              コマ時間が解決できなかったシフト行 {result.notes.unresolvedTimeSlots} 件を無視しました
              （過去の期間とコマ時間が変わっている可能性があります）。
            </p>
          )}
          {result.notes.studentsClampedByGradeEnd > 0 && (
            <p className="text-text-muted">
              学年別の終了日で {result.notes.studentsClampedByGradeEnd} 名の可能枠を短縮しました。
            </p>
          )}

          {/* 未割当（理由別・§5-3の5分類） */}
          {result.unassignedGroups.length > 0 && (
            <div className="rounded border border-border-subtle p-1.5">
              <p className="font-semibold text-text-body mb-1">
                未割当 {result.unassignedGroups.reduce((s, g) => s + g.koma, 0)} コマ
              </p>
              <ul className="space-y-1 max-h-40 overflow-y-auto">
                {result.unassignedGroups.map((g) => (
                  <li key={g.reason}>
                    <span className="px-1 py-0.5 rounded bg-surface-hover text-text-muted mr-1">
                      {g.label}
                    </span>
                    <span className="text-text-body tabular-nums">{g.koma}コマ</span>
                    <span className="text-text-faint">
                      {' '}
                      —{' '}
                      {g.students
                        .slice(0, 8)
                        .map((s) => `${s.studentName}(${s.koma})`)
                        .join('・')}
                      {g.students.length > 8 ? ` ほか${g.students.length - 8}名` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {error && <p className="text-[11px] text-danger bg-danger/5 rounded px-2 py-1">{error}</p>}
    </div>
  );
}
