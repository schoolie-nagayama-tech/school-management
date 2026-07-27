'use client';

/**
 * 講習 自動コマ割り アロケータ — シミュレータページ
 *
 * DBを一切参照しない検証用ページ。合成データ（fixtures.ts）を allocateKoushu() に渡し、
 * 設定を変えながら結果を目視で確認する。書き込みは一切行わない。
 *
 * 正典仕様: docs/koushu-auto-allocation-spec.md
 */

import { Fragment, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  RefreshCw,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  AlertCircle,
  Info,
  Database,
} from 'lucide-react';
import { AdminLayout } from '@/components/layouts';
import { Loading } from '@/components/ui';
import { useAuth } from '@/contexts/AuthContext';
import AccessDenied from '@/components/AccessDenied';
import { allocateKoushu } from '@/lib/koushu-allocator/allocate';
import { buildFixtureInput } from '@/lib/koushu-allocator/fixtures';
import { loadRealAllocatorInput, type RealDataNotes } from '@/lib/koushu-allocator/realDataAdapter';
import { getKoushuPeriods, type KoushuPeriodInfo } from '@/lib/api/koushu-period';
import { getSchools } from '@/lib/api/schools';
import type { School } from '@/types/database';
import {
  DEFAULT_SETTINGS,
  UNASSIGNED_REASON_LABELS,
  type AllocatorInput,
  type AllocatorSettings,
  type Assignment,
  type SubjectBalance,
  type UnassignedReason,
} from '@/lib/koushu-allocator/types';

// ============================================================
// 期間プリセット
// ============================================================

type PeriodKey = '8w' | '4w' | '1w';

const PERIOD_OPTIONS: { key: PeriodKey; label: string; start: string; end: string }[] = [
  { key: '8w', label: '8週（夏期・既定）', start: '2026-07-20', end: '2026-09-13' },
  { key: '4w', label: '4週', start: '2026-07-20', end: '2026-08-16' },
  { key: '1w', label: '1週（密）', start: '2026-07-20', end: '2026-07-25' },
];

const DEFAULT_SEED = 42;
const DEFAULT_TEACHER_SEATS = 2;
const DEFAULT_CLASSROOM_SEATS = 12;

// ============================================================
// 日付ユーティリティ（JST安全。toISOString().slice は使わない）
// ============================================================

const DOW_JA = ['日', '月', '火', '水', '木', '金', '土'];

function getDow(dateStr: string): number {
  return new Date(dateStr + 'T12:00:00').getDay();
}

/** 週先頭(月曜)・月初・先頭列は "M/D"、それ以外は日のみ */
function buildDateLabel(dateStr: string, isFirst: boolean): { label: string; short: string } {
  const parts = dateStr.split('-');
  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);
  const dow = getDow(dateStr);
  const isMonthStart = dateStr.endsWith('-01');
  const full = `${month}/${day}`;
  const useFull = isFirst || dow === 1 || isMonthStart;
  return { label: useFull ? full : String(day), short: full };
}

function formatDateJa(dateStr: string): string {
  const parts = dateStr.split('-');
  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);
  const dow = DOW_JA[getDow(dateStr)];
  return `${month}/${day}(${dow})`;
}

/** 今日の日付 "YYYY-MM-DD"（ローカル時刻の暦日。toISOString().slice は使わない） */
function todayStr(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ============================================================
// データソース（合成データ / 実データ）
// ============================================================

type DataSource = 'synthetic' | 'real';

// ============================================================
// 割当ラベル（1:1 / 45分前後半の表示）
// ============================================================

function assignmentTag(a: Assignment): string {
  const ratioLabel = a.ratio === 1 ? '1対1' : '1対2';
  const durationLabel =
    a.duration === 45
      ? a.halfPosition === 'first'
        ? '45分前半'
        : a.halfPosition === 'second'
          ? '45分後半'
          : '45分'
      : '90分';
  return `${ratioLabel}・${durationLabel}`;
}

// ============================================================
// マトリクスのセル配色（割当件数に応じた段階的な濃さ）
// ============================================================

function cellBg(count: number): string {
  if (count <= 0) return 'bg-gray-100';
  if (count === 1) return 'bg-amber-200';
  if (count === 2) return 'bg-amber-400';
  return 'bg-amber-600 text-white';
}

/** 実データ未取得時に allocateKoushu へ渡す空入力（null分岐を避けるためのプレースホルダ） */
const EMPTY_INPUT: AllocatorInput = {
  dates: [],
  slots: [],
  students: [],
  teachers: [],
  subjects: [],
  tasks: [],
  studentAvailability: new Map(),
  teacherAvailability: new Map(),
  capacity: { maxStudentsPerTeacher: 2, totalIndividualSeats: 12 },
  existing: [],
  settings: DEFAULT_SETTINGS,
};

// ============================================================
// メインコンポーネント
// ============================================================

export default function KoushuSimulatorPage() {
  const { profile, selectedSchoolId } = useAuth();
  const isManager =
    profile?.role === 'admin' || profile?.role === 'owner' || profile?.role === 'manager';

  // ---- データソース ----
  const [dataSource, setDataSource] = useState<DataSource>('synthetic');

  // ---- シミュレーション設定（合成データモード専用） ----
  const [seed, setSeed] = useState(DEFAULT_SEED);
  const [periodKey, setPeriodKey] = useState<PeriodKey>('8w');
  const [teacherSeats, setTeacherSeats] = useState(DEFAULT_TEACHER_SEATS);
  const [classroomSeats, setClassroomSeats] = useState(DEFAULT_CLASSROOM_SEATS);

  // ---- 割当設定（両モード共通） ----
  const [settings, setSettings] = useState<AllocatorSettings>({ ...DEFAULT_SETTINGS });

  // ---- 実データモード専用の状態 ----
  const [schools, setSchools] = useState<School[]>([]);
  const [schoolsLoading, setSchoolsLoading] = useState(false);
  const [realSchoolId, setRealSchoolId] = useState<string>('');
  const [realPeriods, setRealPeriods] = useState<KoushuPeriodInfo[]>([]);
  const [periodsLoading, setPeriodsLoading] = useState(false);
  const [realPeriodId, setRealPeriodId] = useState<string>('');
  const [realLoading, setRealLoading] = useState(false);
  const [realError, setRealError] = useState<string | null>(null);
  const [realData, setRealData] = useState<{ input: AllocatorInput; notes: RealDataNotes } | null>(
    null
  );
  const [realReloadToken, setRealReloadToken] = useState(0);

  // ---- UI開閉状態（詳細展開） ----
  const [selectedCellKey, setSelectedCellKey] = useState<string | null>(null);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);

  const period = PERIOD_OPTIONS.find((p) => p.key === periodKey) ?? PERIOD_OPTIONS[0];

  // ---- 実データ: 教室一覧を取得し、useAuth の選択中教室を既定にする ----
  useEffect(() => {
    if (dataSource !== 'real' || schools.length > 0) return;
    let cancelled = false;
    setSchoolsLoading(true);
    getSchools()
      .then((list) => {
        if (cancelled) return;
        setSchools(list);
        setRealSchoolId((cur) => {
          if (cur) return cur;
          if (selectedSchoolId && selectedSchoolId !== 'all') return selectedSchoolId;
          return list[0]?.id ?? '';
        });
      })
      .catch((err) => console.error('教室一覧の取得に失敗しました', err))
      .finally(() => {
        if (!cancelled) setSchoolsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dataSource, schools.length, selectedSchoolId]);

  // ---- 実データ: 教室が決まったら講習期間一覧を取得（既定は「今日を含む期間」、無ければ先頭） ----
  useEffect(() => {
    if (dataSource !== 'real' || !realSchoolId) return;
    let cancelled = false;
    setPeriodsLoading(true);
    getKoushuPeriods(realSchoolId)
      .then((list) => {
        if (cancelled) return;
        setRealPeriods(list);
        const today = todayStr();
        const current = list.find(
          (p) => p.schedule_start_date <= today && today <= p.schedule_end_date
        );
        setRealPeriodId(current?.id ?? list[0]?.id ?? '');
      })
      .catch((err) => {
        console.error('講習期間の取得に失敗しました', err);
        if (!cancelled) {
          setRealPeriods([]);
          setRealPeriodId('');
        }
      })
      .finally(() => {
        if (!cancelled) setPeriodsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dataSource, realSchoolId]);

  const realPeriod = realPeriods.find((p) => p.id === realPeriodId) ?? null;

  // ---- 実データ: 教室・期間が決まったら実データを読み込む ----
  // settings（チェックボックス類）には依存させない＝設定を変えても再取得しない（allocateKoushu だけ再実行）。
  useEffect(() => {
    if (dataSource !== 'real' || !realSchoolId || !realPeriod) return;
    let cancelled = false;
    setRealLoading(true);
    setRealError(null);
    loadRealAllocatorInput({
      schoolId: realSchoolId,
      period: realPeriod,
      settings: DEFAULT_SETTINGS,
    })
      .then((res) => {
        if (cancelled) return;
        setRealData(res);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('実データの取得に失敗しました', err);
        setRealError(err instanceof Error ? err.message : '実データの取得に失敗しました');
        setRealData(null);
      })
      .finally(() => {
        if (!cancelled) setRealLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // realPeriod はオブジェクト参照なので realPeriodId（と再読込トークン）を依存にする
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSource, realSchoolId, realPeriodId, realReloadToken]);

  // ---- 入力データ（合成データモード: seed・期間・席・設定が変わるたび再構築） ----
  const syntheticInput = useMemo(() => {
    const base = buildFixtureInput({
      seed,
      startDate: period.start,
      endDate: period.end,
      maxStudentsPerTeacher: Math.max(1, teacherSeats),
      totalIndividualSeats: Math.max(1, classroomSeats),
    });
    return { ...base, settings: { ...settings } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, period.start, period.end, teacherSeats, classroomSeats, settings]);

  // ---- 入力データ（データソースに応じて切替。実データ未取得時は空入力） ----
  const input = useMemo<AllocatorInput>(() => {
    if (dataSource === 'synthetic') return syntheticInput;
    if (!realData) return EMPTY_INPUT;
    // 実データ取得結果に、その場で変更できる割当設定（settings）だけを上書きする
    return { ...realData.input, settings: { ...settings } };
  }, [dataSource, syntheticInput, realData, settings]);

  // ---- 割当計算（純関数呼び出しのみ。DBアクセス無し） ----
  const result = useMemo(() => allocateKoushu(input), [input]);

  // ---- 名前解決用マップ ----
  const subjectNameById = useMemo(
    () => new Map(input.subjects.map((s) => [s.id, s.name])),
    [input]
  );
  const teacherNameById = useMemo(
    () => new Map(input.teachers.map((t) => [t.id, t.name])),
    [input]
  );
  const studentNameById = useMemo(
    () => new Map(input.students.map((s) => [s.id, s.name])),
    [input]
  );
  const slotById = useMemo(() => new Map(input.slots.map((s) => [s.id, s])), [input]);
  const slotsSorted = useMemo(
    () => [...input.slots].sort((a, b) => a.slot_number - b.slot_number),
    [input]
  );

  // ---- セルキー → 割当一覧 ----
  const assignmentsByCell = useMemo(() => {
    const m = new Map<string, Assignment[]>();
    for (const a of result.assignments) {
      const key = `${a.date}_${a.slotId}`;
      const arr = m.get(key);
      if (arr) arr.push(a);
      else m.set(key, [a]);
    }
    return m;
  }, [result]);

  // ---- 生徒別サマリ ----
  const studentSummaries = useMemo(() => {
    return input.students.map((s) => {
      const applied = input.tasks
        .filter((t) => t.studentId === s.id)
        .reduce((sum, t) => sum + Math.max(0, t.koma), 0);
      const assigned = result.assignments.filter((a) => a.studentId === s.id).length;
      const unassignedEntries = result.unassigned.filter((u) => u.studentId === s.id);
      const unassignedKoma = unassignedEntries.reduce((sum, u) => sum + u.koma, 0);
      // 理由別にコマ数を集計し、最多の理由を「主な理由」とする
      const byReason = new Map<UnassignedReason, number>();
      for (const u of unassignedEntries) {
        byReason.set(u.reason, (byReason.get(u.reason) ?? 0) + u.koma);
      }
      let mainReason: UnassignedReason | null = null;
      let mainReasonKoma = 0;
      for (const [reason, koma] of Array.from(byReason.entries())) {
        if (koma > mainReasonKoma) {
          mainReason = reason;
          mainReasonKoma = koma;
        }
      }
      return { id: s.id, name: s.name, applied, assigned, unassignedKoma, mainReason };
    });
  }, [input, result]);

  // ---- 講師別負荷 ----
  const teacherLoads = useMemo(() => {
    const loads = input.teachers.map((t) => ({
      id: t.id,
      name: t.name,
      load: result.stats.loadByTeacher[t.id] ?? 0,
    }));
    const maxLoad = Math.max(1, ...loads.map((l) => l.load));
    return { loads, maxLoad };
  }, [input, result]);

  // ---- 未割当を理由別にグループ化（表示順は UNASSIGNED_REASON_LABELS の定義順） ----
  const unassignedByReason = useMemo(() => {
    const order = Object.keys(UNASSIGNED_REASON_LABELS) as UnassignedReason[];
    const groups: {
      reason: UnassignedReason;
      total: number;
      items: { studentId: string; subjectId: string; koma: number }[];
    }[] = [];
    for (const reason of order) {
      const items = result.unassigned.filter((u) => u.reason === reason);
      if (items.length === 0) continue;
      groups.push({ reason, total: items.reduce((s, u) => s + u.koma, 0), items });
    }
    return groups;
  }, [result]);

  if (!isManager) return <AccessDenied />;

  const requestedKoma = result.stats.requestedKoma;
  const assignedKoma = result.stats.assignedKoma;
  const unassignedKoma = requestedKoma - assignedKoma;
  const achievementRate = requestedKoma > 0 ? Math.round((assignedKoma / requestedKoma) * 100) : 0;
  const rateBadgeClass =
    achievementRate === 100
      ? 'bg-success-subtle text-success'
      : achievementRate >= 80
        ? 'bg-warning-subtle text-warning'
        : 'bg-danger-subtle text-danger';

  const resetSettings = () => {
    setSeed(DEFAULT_SEED);
    setPeriodKey('8w');
    setTeacherSeats(DEFAULT_TEACHER_SEATS);
    setClassroomSeats(DEFAULT_CLASSROOM_SEATS);
    setSettings({ ...DEFAULT_SETTINGS });
  };

  // 実データがまだ使える状態でない（読込中・エラー・未取得）間は、下の結果セクションを隠す
  const realNotReady = dataSource === 'real' && (realLoading || !!realError || !realData);

  const selectedCellAssignments = selectedCellKey
    ? (assignmentsByCell.get(selectedCellKey) ?? [])
    : [];
  const selectedCellLabel = (() => {
    if (!selectedCellKey) return '';
    const us = selectedCellKey.indexOf('_');
    const date = selectedCellKey.slice(0, us);
    const slotId = selectedCellKey.slice(us + 1);
    const slotNumber = slotById.get(slotId)?.slot_number ?? '?';
    return `${formatDateJa(date)} ${slotNumber}限`;
  })();

  const selectedStudentAssignments = selectedStudentId
    ? result.assignments
        .filter((a) => a.studentId === selectedStudentId)
        .slice()
        .sort(
          (a, b) =>
            a.date.localeCompare(b.date) ||
            (slotById.get(a.slotId)?.slot_number ?? 0) - (slotById.get(b.slotId)?.slot_number ?? 0)
        )
    : [];

  return (
    <AdminLayout headerTitle="講習 自動コマ割り シミュレータ">
      <div className="space-y-6 pb-12">
        {/* ヘッダー */}
        <div className="flex items-center gap-3">
          <Link href="/schedule">
            <button className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors active:scale-[0.97]">
              <ArrowLeft className="w-5 h-5" />
            </button>
          </Link>
          <h1 className="text-xl font-bold text-[var(--headline)]">
            講習 自動コマ割り シミュレータ
          </h1>
        </div>

        {/* 検証用ページの注記バナー */}
        <div className="flex items-start gap-2 rounded-lg border border-warning bg-warning-subtle px-4 py-3 text-sm text-warning">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <p>
            これは検証用ページです。実データモードでも読み取り専用で、DBへの書き込みは一切行いません。
          </p>
        </div>

        {/* データソース切替 */}
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-[var(--paragraph)]" />
          <div className="inline-flex rounded-lg border border-[var(--stroke)] bg-white p-0.5">
            <button
              onClick={() => setDataSource('synthetic')}
              className={[
                'px-3 py-1.5 text-sm rounded-md transition-colors active:scale-[0.97]',
                dataSource === 'synthetic'
                  ? 'bg-info text-white'
                  : 'text-[var(--paragraph)] hover:bg-gray-50',
              ].join(' ')}
            >
              合成データ
            </button>
            <button
              onClick={() => setDataSource('real')}
              className={[
                'px-3 py-1.5 text-sm rounded-md transition-colors active:scale-[0.97]',
                dataSource === 'real'
                  ? 'bg-info text-white'
                  : 'text-[var(--paragraph)] hover:bg-gray-50',
              ].join(' ')}
            >
              実データ（読み取り専用）
            </button>
          </div>
        </div>

        {/* 設定パネル */}
        <div className="rounded-lg border border-[var(--stroke)] bg-white p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[var(--headline)]">
              {dataSource === 'synthetic' ? 'シナリオ設定' : '対象・割当設定'}
            </h2>
            {dataSource === 'synthetic' ? (
              <button
                onClick={resetSettings}
                className="flex items-center gap-1 text-xs text-[var(--paragraph)] hover:text-[var(--headline)] transition-colors active:scale-[0.97]"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                設定を既定に戻す
              </button>
            ) : (
              <button
                onClick={() => setRealReloadToken((t) => t + 1)}
                disabled={realLoading || !realSchoolId || !realPeriodId}
                className="flex items-center gap-1 text-xs text-[var(--paragraph)] hover:text-[var(--headline)] transition-colors active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${realLoading ? 'animate-spin' : ''}`} />
                再取得
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {dataSource === 'synthetic' ? (
              <>
                {/* seed */}
                <div>
                  <label className="block text-xs text-[var(--paragraph)] mb-1">
                    シナリオ seed
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      value={seed}
                      onChange={(e) => setSeed(Number(e.target.value) || 0)}
                      className="w-full border border-[var(--stroke)] rounded-md px-2 py-1.5 text-sm bg-white text-[var(--headline)]"
                    />
                    <button
                      onClick={() => setSeed((s) => s + 1)}
                      title="別のシナリオ"
                      className="p-1.5 border border-[var(--stroke)] rounded-md text-[var(--paragraph)] hover:text-[var(--headline)] hover:bg-gray-50 transition-colors active:scale-[0.97] shrink-0"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* 期間 */}
                <div>
                  <label className="block text-xs text-[var(--paragraph)] mb-1">期間</label>
                  <select
                    value={periodKey}
                    onChange={(e) => setPeriodKey(e.target.value as PeriodKey)}
                    className="w-full border border-[var(--stroke)] rounded-md px-2 py-1.5 text-sm bg-white text-[var(--headline)]"
                  >
                    {PERIOD_OPTIONS.map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* 1講師あたり席数 */}
                <div>
                  <label className="block text-xs text-[var(--paragraph)] mb-1">
                    1講師あたり席数
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={teacherSeats}
                    onChange={(e) => setTeacherSeats(Number(e.target.value) || 1)}
                    className="w-full border border-[var(--stroke)] rounded-md px-2 py-1.5 text-sm bg-white text-[var(--headline)]"
                  />
                </div>

                {/* 教室席数 */}
                <div>
                  <label className="block text-xs text-[var(--paragraph)] mb-1">教室席数</label>
                  <input
                    type="number"
                    min={1}
                    value={classroomSeats}
                    onChange={(e) => setClassroomSeats(Number(e.target.value) || 1)}
                    className="w-full border border-[var(--stroke)] rounded-md px-2 py-1.5 text-sm bg-white text-[var(--headline)]"
                  />
                </div>
              </>
            ) : (
              <>
                {/* 教室 */}
                <div>
                  <label className="block text-xs text-[var(--paragraph)] mb-1">教室</label>
                  <select
                    value={realSchoolId}
                    onChange={(e) => {
                      setRealSchoolId(e.target.value);
                      setRealData(null);
                      setRealPeriods([]);
                      setRealPeriodId('');
                    }}
                    disabled={schoolsLoading || schools.length === 0}
                    className="w-full border border-[var(--stroke)] rounded-md px-2 py-1.5 text-sm bg-white text-[var(--headline)] disabled:opacity-50"
                  >
                    {schoolsLoading && <option>読み込み中...</option>}
                    {!schoolsLoading && schools.length === 0 && <option>教室がありません</option>}
                    {schools.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* 講習期間 */}
                <div>
                  <label className="block text-xs text-[var(--paragraph)] mb-1">講習期間</label>
                  <select
                    value={realPeriodId}
                    onChange={(e) => setRealPeriodId(e.target.value)}
                    disabled={periodsLoading || realPeriods.length === 0}
                    className="w-full border border-[var(--stroke)] rounded-md px-2 py-1.5 text-sm bg-white text-[var(--headline)] disabled:opacity-50"
                  >
                    {periodsLoading && <option>読み込み中...</option>}
                    {!periodsLoading && realPeriods.length === 0 && (
                      <option>講習期間が未設定です</option>
                    )}
                    {realPeriods.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}（{p.schedule_start_date}〜{p.schedule_end_date}）
                      </option>
                    ))}
                  </select>
                </div>

                {/* プレースホルダ（合成データの席数入力に相当する枠。実データは school_class_capacity から取得） */}
                <div className="sm:col-span-2 flex items-end">
                  <p className="text-xs text-[var(--paragraph)] pb-1.5">
                    席数・生徒・講師・申込は教室の実データ（school_class_capacity
                    等）から取得します。下の「データの前提」も確認してください。
                  </p>
                </div>
              </>
            )}

            {/* 1日上限コマ数 */}
            <div>
              <label className="block text-xs text-[var(--paragraph)] mb-1">1日上限コマ数</label>
              <input
                type="number"
                min={1}
                value={settings.maxKomaPerStudentPerDay}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    maxKomaPerStudentPerDay: Number(e.target.value) || 1,
                  }))
                }
                className="w-full border border-[var(--stroke)] rounded-md px-2 py-1.5 text-sm bg-white text-[var(--headline)]"
              />
            </div>

            {/* チェックボックス群 */}
            <label className="flex items-center gap-2 text-sm text-[var(--headline)] self-end pb-1.5">
              <input
                type="checkbox"
                checked={settings.preferConsecutive}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, preferConsecutive: e.target.checked }))
                }
                className="w-4 h-4 rounded border-[var(--stroke)]"
              />
              連続優先
            </label>
            <label className="flex items-center gap-2 text-sm text-[var(--headline)] self-end pb-1.5">
              <input
                type="checkbox"
                checked={settings.allowSameSubjectSameDay}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, allowSameSubjectSameDay: e.target.checked }))
                }
                className="w-4 h-4 rounded border-[var(--stroke)]"
              />
              同日同科目を許可
            </label>
            <label className="flex items-center gap-2 text-sm text-[var(--headline)] self-end pb-1.5">
              <input
                type="checkbox"
                checked={settings.spreadSubjectEvenly}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, spreadSubjectEvenly: e.target.checked }))
                }
                className="w-4 h-4 rounded border-[var(--stroke)]"
              />
              科目を均等分散
            </label>
          </div>
        </div>

        {/* 実データモード: 読込中インジケータ */}
        {dataSource === 'real' && realLoading && (
          <div className="rounded-lg border border-[var(--stroke)] bg-white p-4">
            <Loading label="実データを読み込み中..." size="sm" />
          </div>
        )}

        {/* 実データモード: エラー表示 */}
        {dataSource === 'real' && realError && !realLoading && (
          <div className="flex items-start gap-2 rounded-lg border border-danger bg-danger-subtle px-4 py-3 text-sm text-danger">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">実データの取得に失敗しました</p>
              <p className="text-xs mt-0.5">{realError}</p>
            </div>
          </div>
        )}

        {/* 実データモード: データの前提（欠損・フォールバックの明示） */}
        {dataSource === 'real' && realData && <RealDataNotesPanel notes={realData.notes} />}

        {!realNotReady && (
          <>
            {/* 結果サマリ */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <SummaryCard label="申込コマ数" value={`${requestedKoma}コマ`} />
              <SummaryCard
                label="割当コマ数"
                value={`${assignedKoma}コマ`}
                badge={{ text: `達成率 ${achievementRate}%`, className: rateBadgeClass }}
              />
              <SummaryCard label="未割当コマ数" value={`${unassignedKoma}コマ`} />
              <SummaryCard label="リペア救済コマ数" value={`${result.stats.repairedKoma}コマ`} />
            </div>

            {/* 割当マトリクス */}
            <div className="rounded-lg border border-[var(--stroke)] bg-white p-4">
              <h2 className="text-sm font-semibold text-[var(--headline)] mb-3">
                割当マトリクス（日付 × コマ）
              </h2>
              <div className="overflow-x-auto">
                <div
                  className="inline-grid text-[10px]"
                  style={{ gridTemplateColumns: `48px repeat(${input.dates.length}, 22px)` }}
                >
                  {/* 左上空セル */}
                  <div />

                  {/* 日付ヘッダ行 */}
                  {input.dates.map((dateStr, idx) => {
                    const dow = getDow(dateStr);
                    const isMonday = dow === 1;
                    const isFirst = idx === 0;
                    const { label } = buildDateLabel(dateStr, isFirst);
                    const textColor =
                      dow === 0
                        ? 'text-red-400'
                        : dow === 6
                          ? 'text-blue-400'
                          : 'text-[var(--paragraph)]';
                    return (
                      <div
                        key={dateStr}
                        className={[
                          'flex items-end justify-center pb-1 select-none',
                          isMonday && !isFirst ? 'border-l border-gray-200 ml-1 pl-1' : '',
                        ].join(' ')}
                      >
                        <span className={`leading-none whitespace-nowrap ${textColor}`}>
                          {label}
                        </span>
                      </div>
                    );
                  })}

                  {/* コマ行 */}
                  {slotsSorted.map((slot) => (
                    <MatrixRow
                      key={slot.id}
                      slot={slot}
                      dates={input.dates}
                      assignmentsByCell={assignmentsByCell}
                      teacherNameById={teacherNameById}
                      subjectNameById={subjectNameById}
                      studentNameById={studentNameById}
                      selectedCellKey={selectedCellKey}
                      onSelectCell={(key) =>
                        setSelectedCellKey((cur) => (cur === key ? null : key))
                      }
                    />
                  ))}
                </div>
              </div>

              {/* 凡例 */}
              <div className="flex items-center gap-3 mt-3 text-[10px] text-[var(--paragraph)]">
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2.5 h-2.5 rounded-sm bg-gray-100" />
                  0件
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-200" />
                  1件
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-400" />
                  2件
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-600" />
                  3件以上
                </span>
              </div>

              {/* セル詳細 */}
              {selectedCellKey && (
                <div className="mt-4 border-t border-[var(--stroke)] pt-3">
                  <h3 className="text-xs font-semibold text-[var(--headline)] mb-2">
                    {selectedCellLabel} の割当（{selectedCellAssignments.length}件）
                  </h3>
                  {selectedCellAssignments.length === 0 ? (
                    <p className="text-xs text-[var(--paragraph)]">割当はありません</p>
                  ) : (
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-[var(--paragraph)] border-b border-[var(--stroke)]">
                          <th className="py-1 pr-3 font-medium">講師</th>
                          <th className="py-1 pr-3 font-medium">生徒</th>
                          <th className="py-1 pr-3 font-medium">科目</th>
                          <th className="py-1 font-medium">形態</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedCellAssignments.map((a, i) => (
                          <tr key={i} className="border-b border-gray-100 last:border-0">
                            <td className="py-1 pr-3 text-[var(--headline)]">
                              {teacherNameById.get(a.teacherId) ?? a.teacherId}
                            </td>
                            <td className="py-1 pr-3 text-[var(--headline)]">
                              {studentNameById.get(a.studentId) ?? a.studentId}
                            </td>
                            <td className="py-1 pr-3 text-[var(--headline)]">
                              {subjectNameById.get(a.subjectId) ?? a.subjectId}
                            </td>
                            <td className="py-1 text-[var(--paragraph)]">{assignmentTag(a)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>

            {/* 生徒別サマリ */}
            <div className="rounded-lg border border-[var(--stroke)] bg-white p-4">
              <h2 className="text-sm font-semibold text-[var(--headline)] mb-3">生徒別サマリ</h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[var(--paragraph)] border-b border-[var(--stroke)]">
                    <th className="py-1.5 pr-3 font-medium">生徒</th>
                    <th className="py-1.5 pr-3 font-medium">申込</th>
                    <th className="py-1.5 pr-3 font-medium">割当</th>
                    <th className="py-1.5 pr-3 font-medium">未割当</th>
                    <th className="py-1.5 font-medium">主な理由</th>
                  </tr>
                </thead>
                <tbody>
                  {studentSummaries.map((s) => {
                    const fullyAssigned = s.unassignedKoma === 0;
                    const isOpen = selectedStudentId === s.id;
                    return (
                      // key は Fragment 側に付ける（内側の <tr> に付けても React は兄弟を識別できない）
                      <Fragment key={s.id}>
                        <tr className="border-b border-gray-100 last:border-0">
                          <td className="py-1.5 pr-3">
                            <button
                              onClick={() =>
                                setSelectedStudentId((cur) => (cur === s.id ? null : s.id))
                              }
                              className="flex items-center gap-1 text-[var(--headline)] hover:underline active:scale-[0.98] transition-transform"
                            >
                              {isOpen ? (
                                <ChevronDown className="w-3.5 h-3.5" />
                              ) : (
                                <ChevronRight className="w-3.5 h-3.5" />
                              )}
                              {s.name}
                            </button>
                          </td>
                          <td className="py-1.5 pr-3 text-[var(--paragraph)]">{s.applied}コマ</td>
                          <td className="py-1.5 pr-3 text-[var(--paragraph)]">{s.assigned}コマ</td>
                          <td
                            className={`py-1.5 pr-3 ${fullyAssigned ? 'text-success' : 'text-danger font-medium'}`}
                          >
                            {fullyAssigned ? '達成' : `残${s.unassignedKoma}コマ`}
                          </td>
                          <td className="py-1.5 text-[var(--paragraph)]">
                            {s.mainReason ? UNASSIGNED_REASON_LABELS[s.mainReason] : '-'}
                          </td>
                        </tr>
                        {isOpen && (
                          <tr key={`${s.id}-detail`} className="bg-gray-50">
                            <td colSpan={5} className="p-3">
                              {selectedStudentAssignments.length === 0 ? (
                                <p className="text-xs text-[var(--paragraph)]">
                                  割当明細はありません
                                </p>
                              ) : (
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="text-left text-[var(--paragraph)]">
                                      <th className="py-1 pr-3 font-medium">日付</th>
                                      <th className="py-1 pr-3 font-medium">コマ</th>
                                      <th className="py-1 pr-3 font-medium">講師</th>
                                      <th className="py-1 font-medium">科目</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {selectedStudentAssignments.map((a, i) => (
                                      <tr key={i}>
                                        <td className="py-0.5 pr-3 text-[var(--headline)]">
                                          {formatDateJa(a.date)}
                                        </td>
                                        <td className="py-0.5 pr-3 text-[var(--headline)]">
                                          {slotById.get(a.slotId)?.slot_number ?? '?'}限
                                        </td>
                                        <td className="py-0.5 pr-3 text-[var(--headline)]">
                                          {teacherNameById.get(a.teacherId) ?? a.teacherId}
                                        </td>
                                        <td className="py-0.5 text-[var(--headline)]">
                                          {subjectNameById.get(a.subjectId) ?? a.subjectId}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* 講師別負荷 */}
            <div className="rounded-lg border border-[var(--stroke)] bg-white p-4">
              <h2 className="text-sm font-semibold text-[var(--headline)] mb-3">講師別負荷</h2>
              <div className="space-y-2">
                {teacherLoads.loads.map((l) => (
                  <div key={l.id} className="flex items-center gap-2 text-sm">
                    <span className="w-24 shrink-0 text-[var(--paragraph)] truncate">{l.name}</span>
                    <div className="flex-1 h-4 bg-gray-100 rounded overflow-hidden">
                      <div
                        className="h-full bg-info rounded"
                        style={{ width: `${(l.load / teacherLoads.maxLoad) * 100}%` }}
                      />
                    </div>
                    <span className="w-10 text-right text-[var(--headline)] shrink-0">
                      {l.load}コマ
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* 科目バランス（前半英語ばかり…になっていないかを見る） */}
            <SubjectBalancePanel
              balance={result.stats.subjectBalance}
              subjects={input.subjects}
              studentNameById={studentNameById}
              subjectNameById={subjectNameById}
              spreadEnabled={settings.spreadSubjectEvenly}
            />

            {/* 未割当リスト */}
            <div className="rounded-lg border border-[var(--stroke)] bg-white p-4">
              <h2 className="text-sm font-semibold text-[var(--headline)] mb-3">未割当リスト</h2>
              {unassignedByReason.length === 0 ? (
                <p className="text-sm text-success">未割当はありません</p>
              ) : (
                <div className="space-y-4">
                  {unassignedByReason.map((group) => (
                    <div key={group.reason}>
                      <h3 className="text-xs font-semibold text-danger mb-1.5">
                        {UNASSIGNED_REASON_LABELS[group.reason]}（{group.total}コマ）
                      </h3>
                      <ul className="text-sm text-[var(--paragraph)] space-y-0.5 pl-1">
                        {group.items.map((it, i) => (
                          <li key={i}>
                            {studentNameById.get(it.studentId) ?? it.studentId}{' '}
                            {subjectNameById.get(it.subjectId) ?? it.subjectId} ×{it.koma}コマ
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  );
}

// ============================================================
// 科目バランス（期別の科目構成と偏り指標）
// ============================================================

/** 科目の識別色。subjects 配列の順で決まる（同じ入力なら常に同じ色） */
const SUBJECT_BAR_COLORS = [
  'bg-blue-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-purple-500',
  'bg-rose-500',
  'bg-cyan-500',
  'bg-orange-500',
  'bg-indigo-500',
];

function SubjectBalancePanel({
  balance,
  subjects,
  studentNameById,
  subjectNameById,
  spreadEnabled,
}: {
  balance: SubjectBalance;
  subjects: { id: string; name: string }[];
  studentNameById: Map<string, string>;
  subjectNameById: Map<string, string>;
  spreadEnabled: boolean;
}) {
  const colorBySubject = new Map(
    subjects.map((s, i) => [s.id, SUBJECT_BAR_COLORS[i % SUBJECT_BAR_COLORS.length]])
  );
  const evennessPct = Math.round(balance.evenness * 100);
  const evennessClass =
    evennessPct >= 80
      ? 'bg-success-subtle text-success'
      : evennessPct >= 60
        ? 'bg-warning-subtle text-warning'
        : 'bg-danger-subtle text-danger';
  // 期ごとのバー幅を揃えるため、最も多い期を基準にする
  const maxTotal = Math.max(1, ...balance.quarters.map((q) => q.total));

  return (
    <div className="rounded-lg border border-[var(--stroke)] bg-white p-4">
      <div className="flex items-center justify-between gap-2 mb-1">
        <h2 className="text-sm font-semibold text-[var(--headline)]">科目バランス（期別の構成）</h2>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${evennessClass}`}>
          均等度 {evennessPct}%
        </span>
      </div>
      <p className="text-xs text-[var(--paragraph)] mb-3">
        各科目のコマが期間全体へ均等に散っているか。
        {spreadEnabled ? '「科目を均等分散」ON' : '「科目を均等分散」OFF（偏りが出やすい）'}
      </p>

      {/* 科目の凡例 */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 mb-3">
        {subjects.map((s) => (
          <span key={s.id} className="flex items-center gap-1.5 text-xs text-[var(--paragraph)]">
            <span className={`w-2.5 h-2.5 rounded-sm ${colorBySubject.get(s.id)}`} />
            {s.name}
          </span>
        ))}
      </div>

      {/* 期別の積み上げバー */}
      <div className="space-y-2">
        {balance.quarters.map((q, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="w-32 shrink-0 text-[var(--paragraph)]">
              第{i + 1}期 {q.startDate.slice(5)}〜{q.endDate.slice(5)}
            </span>
            <div className="flex-1 h-5 bg-gray-100 rounded overflow-hidden">
              {/* 期どうしの多寡が分かるよう、最大の期を100%として全体幅を決める */}
              <div className="flex h-full" style={{ width: `${(q.total / maxTotal) * 100}%` }}>
                {subjects.map((s) => {
                  const koma = q.komaBySubject[s.id] ?? 0;
                  if (koma === 0) return null;
                  return (
                    <div
                      key={s.id}
                      className={colorBySubject.get(s.id)}
                      style={{ width: `${(koma / Math.max(1, q.total)) * 100}%` }}
                      title={`第${i + 1}期 ${s.name} ${koma}コマ`}
                    />
                  );
                })}
              </div>
            </div>
            <span className="w-12 text-right text-[var(--headline)] shrink-0">{q.total}コマ</span>
          </div>
        ))}
      </div>

      {/* 偏りが大きい生徒×科目 */}
      {balance.worst.length > 0 && (
        <div className="mt-4 pt-3 border-t border-[var(--stroke)]">
          <h3 className="text-xs font-semibold text-[var(--headline)] mb-1.5">
            偏りが大きい生徒×科目
          </h3>
          <ul className="text-xs text-[var(--paragraph)] space-y-0.5">
            {balance.worst.slice(0, 5).map((w, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="flex-1 truncate">
                  {studentNameById.get(w.studentId) ?? w.studentId}{' '}
                  {subjectNameById.get(w.subjectId) ?? w.subjectId}
                </span>
                {/* drift は 0=均等 / 0.5=片端に全部。分かりやすさのため均等度に換算して出す */}
                <span className="shrink-0">均等度 {Math.round((1 - w.drift * 2) * 100)}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ============================================================
// 実データの前提パネル（欠損・フォールバックを明示する）
// ============================================================

function RealDataNotesPanel({ notes }: { notes: RealDataNotes }) {
  const teacherUnresolvedCount = notes.unresolvedTeachers.length;
  const availabilityLabel =
    notes.studentAvailabilitySource === 'shift_submission'
      ? '生徒の講習可能表（提出あり）'
      : notes.studentAvailabilitySource === 'regular_pattern'
        ? '通塾日程からのフォールバック（生徒の講習可能表が0件のため）'
        : '対象生徒なし';

  return (
    <div className="rounded-lg border border-info bg-info-subtle px-4 py-3 text-sm text-[var(--headline)] space-y-2">
      <div className="flex items-center gap-2 font-semibold text-info">
        <Info className="w-4 h-4 shrink-0" />
        データの前提
      </div>
      <ul className="space-y-1 text-xs text-[var(--paragraph)] pl-1">
        <li>
          申込コマ合計 {notes.totalAppliedKoma}コマ（申込のある生徒 {notes.studentsWithApplication}
          名）
        </li>
        <li>
          科目は<span className="font-semibold text-[var(--headline)]">暫定割当</span>
          です。生徒IDから決定的に1〜2科目を仮に割り振っています（申込コマと科目の正式な紐付けは未実装・P1で対応予定）。
        </li>
        <li>
          生徒の出席可能枠: {availabilityLabel}
          {notes.studentsWithoutAvailability > 0 && (
            <span className="text-danger">
              {' '}
              （うち {notes.studentsWithoutAvailability}
              名は出席可能枠を作れませんでした＝未割当になります）
            </span>
          )}
        </li>
        <li>
          講師の講習シフト提出 {notes.teacherSubmissions}名中 解決{notes.teacherSubmissionsResolved}
          名 （出勤可能スロット {notes.teacherSlotRows}行）
          {notes.unresolvedTimeSlots > 0 && (
            <span> ／ 時限を解決できなかった行 {notes.unresolvedTimeSlots}件</span>
          )}
        </li>
        {teacherUnresolvedCount > 0 && (
          <li className="text-danger">
            この講師のシフトはアカウントに紐付けられず反映されていません（{teacherUnresolvedCount}
            名）: {notes.unresolvedTeachers.join('、')}
          </li>
        )}
      </ul>
    </div>
  );
}

// ============================================================
// サマリカード
// ============================================================

function SummaryCard({
  label,
  value,
  badge,
}: {
  label: string;
  value: string;
  badge?: { text: string; className: string };
}) {
  return (
    <div className="rounded-lg border border-[var(--stroke)] bg-white p-4">
      <p className="text-xs text-[var(--paragraph)] mb-1">{label}</p>
      <div className="flex items-center gap-2">
        <p className="text-xl font-bold text-[var(--headline)]">{value}</p>
        {badge && (
          <span
            className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${badge.className}`}
          >
            {badge.text}
          </span>
        )}
      </div>
    </div>
  );
}

// ============================================================
// マトリクス1行（コマ単位）
// ============================================================

function MatrixRow({
  slot,
  dates,
  assignmentsByCell,
  teacherNameById,
  subjectNameById,
  studentNameById,
  selectedCellKey,
  onSelectCell,
}: {
  slot: { id: string; slot_number: number };
  dates: string[];
  assignmentsByCell: Map<string, Assignment[]>;
  teacherNameById: Map<string, string>;
  subjectNameById: Map<string, string>;
  studentNameById: Map<string, string>;
  selectedCellKey: string | null;
  onSelectCell: (key: string) => void;
}) {
  return (
    <>
      {/* 行頭ラベル */}
      <div className="flex items-center justify-end pr-1.5 text-[var(--paragraph)] leading-none">
        {slot.slot_number}限
      </div>

      {dates.map((dateStr, idx) => {
        const dow = getDow(dateStr);
        const isMonday = dow === 1;
        const isFirst = idx === 0;
        const key = `${dateStr}_${slot.id}`;
        const assignments = assignmentsByCell.get(key) ?? [];
        const count = assignments.length;
        const isSelected = selectedCellKey === key;

        // title: 「7/22(水) 3限: 3件 / 佐藤(数学) 宮永, 瀧川(英語) 稲田 …」
        const title = `${formatDateJa(dateStr)} ${slot.slot_number}限: ${count}件${
          count > 0
            ? ' / ' +
              assignments
                .map((a) => {
                  const teacher = teacherNameById.get(a.teacherId) ?? a.teacherId;
                  const subject = subjectNameById.get(a.subjectId) ?? a.subjectId;
                  const student = studentNameById.get(a.studentId) ?? a.studentId;
                  const tag = assignmentTag(a);
                  return `${teacher}(${subject}) ${student}・${tag}`;
                })
                .join(', ')
            : ''
        }`;

        return (
          <div
            key={key}
            className={[
              'flex items-center justify-center py-0.5',
              isMonday && !isFirst ? 'border-l border-gray-200 ml-1 pl-1' : '',
            ].join(' ')}
          >
            <button
              type="button"
              onClick={() => onSelectCell(key)}
              title={title}
              className={[
                'w-[18px] h-[18px] rounded-[3px] flex items-center justify-center transition-colors hover:opacity-80',
                cellBg(count),
                isSelected ? 'ring-2 ring-info ring-offset-1' : '',
              ].join(' ')}
            >
              {count > 0 && <span className="leading-none text-[9px] font-semibold">{count}</span>}
            </button>
          </div>
        );
      })}
    </>
  );
}
