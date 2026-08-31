'use client';

/**
 * 座席表「デイリー表示」UIモック（検討用・admin限定・DBアクセス一切なし）。
 *
 * コンセプト:
 *   週の座席表＝「予定を組む盤」に対して、この日表示は「今日を回す運用盤」。
 *   列=講師・行=コマで、(1) 今のコマで誰が誰を見ているか、(2) 講師の1日の流れ、
 *   (3) 当日の異常（欠勤・未配置・体験・テスト対策）が1画面で分かることを狙う。
 *   このビューでは配置の組み替えはしない（組み替えは週表示の役割。誤操作防止のため
 *   閲覧・運用に主体を絞っている）。
 *
 * 本ファイルは検討用モックであり、すべてダミーデータ。API/DB接続は行わない。
 * 導入する場合は座席表ツールバーに「週 / 日」の表示切替として組み込む想定（フッター参照）。
 */

import { Fragment, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { isSystemAdmin } from '@/lib/utils/roles';
import { AdminLayout } from '@/components/layouts';
import { Loading } from '@/components/ui';
import AccessDenied from '@/components/AccessDenied';
import {
  ChevronLeft,
  ChevronRight,
  Info,
  AlertTriangle,
  UserX,
  Users,
  Sparkles,
  BookOpenCheck,
  CalendarDays,
  Flag,
} from 'lucide-react';

/* ============================================================
 * ダミーデータ
 * ========================================================== */

// コマ定義（1限〜6限）。3限を「現在」、4限を「未配置あり」として固定する
const PERIODS = [
  { key: 1, label: '1限', time: '13:00〜14:30' },
  { key: 2, label: '2限', time: '14:40〜16:10' },
  { key: 3, label: '3限', time: '16:20〜17:50' },
  { key: 4, label: '4限', time: '18:00〜19:30' },
  { key: 5, label: '5限', time: '19:40〜21:10' },
  { key: 6, label: '6限', time: '21:20〜22:50' },
] as const;

const CURRENT_PERIOD = 3;
const UNPLACED_PERIOD = 4;

// 講師（列）。seat は座席番号バッジ。isAbsent の講師列は当日欠勤として減光＋斜線表示にする
const TEACHERS = [
  { id: 't1', name: '佐藤', seat: '席1', isAbsent: false },
  { id: 't2', name: '田中', seat: '席2', isAbsent: false },
  { id: 't3', name: '鈴木', seat: '席3', isAbsent: false },
  { id: 't4', name: '高橋', seat: '席4', isAbsent: false },
  { id: 't5', name: '伊藤', seat: '席5', isAbsent: false },
  { id: 't6', name: '渡辺', seat: '席6', isAbsent: true },
  { id: 't7', name: '山本', seat: '席7', isAbsent: false },
  { id: 't8', name: '中村', seat: '席8', isAbsent: false },
] as const;

type RowState = 'normal' | 'transfer' | 'trial' | 'testprep' | 'absent';
type Attendance = '出' | '欠' | '未';

interface SeatStudent {
  name: string;
  grade: string;
  subject: string;
  state: RowState;
  attendance: Attendance;
}

// teacherId × periodKey → 生徒行（0〜3人）。空のコマは登場させない（未設定=空セル）
const BOARD: Record<string, Partial<Record<number, SeatStudent[]>>> = {
  t1: {
    1: [{ name: '山田さくら', grade: '小6', subject: '算', state: 'normal', attendance: '出' }],
    2: [
      { name: '山田さくら', grade: '小6', subject: '算', state: 'normal', attendance: '出' },
      { name: '田村結衣', grade: '小6', subject: '算', state: 'normal', attendance: '出' },
    ],
    3: [
      { name: '山田さくら', grade: '小6', subject: '算', state: 'normal', attendance: '出' },
      { name: '田村結衣', grade: '小6', subject: '算', state: 'normal', attendance: '出' },
    ],
    4: [{ name: '田村結衣', grade: '小6', subject: '算', state: 'normal', attendance: '出' }],
  },
  t2: {
    2: [{ name: '高木蒼', grade: '中3', subject: '数', state: 'normal', attendance: '欠' }],
    3: [{ name: '高木蒼', grade: '中3', subject: '数', state: 'normal', attendance: '出' }],
    5: [{ name: '高木蒼', grade: '中3', subject: '数', state: 'normal', attendance: '出' }],
  },
  t3: {
    1: [{ name: '木村蓮', grade: '中1', subject: '英', state: 'normal', attendance: '出' }],
    2: [{ name: '木村蓮', grade: '中1', subject: '英', state: 'normal', attendance: '出' }],
    3: [
      { name: '清水奏', grade: '中2', subject: '英', state: 'transfer', attendance: '出' },
      { name: '木村蓮', grade: '中1', subject: '英', state: 'normal', attendance: '出' },
    ],
    4: [{ name: '木村蓮', grade: '中1', subject: '英', state: 'normal', attendance: '未' }],
  },
  t4: {
    2: [{ name: '中野陸', grade: '中2', subject: '理', state: 'normal', attendance: '出' }],
    3: [{ name: '中野陸', grade: '中2', subject: '理', state: 'normal', attendance: '出' }],
    5: [{ name: '中野陸', grade: '中2', subject: '理', state: 'normal', attendance: '出' }],
  },
  t5: {
    2: [{ name: '小林芽依', grade: '中1', subject: '社', state: 'normal', attendance: '未' }],
    3: [{ name: '小林芽依', grade: '中1', subject: '社', state: 'testprep', attendance: '出' }],
    4: [{ name: '小林芽依', grade: '中1', subject: '社', state: 'testprep', attendance: '出' }],
  },
  t6: {
    // 欠勤講師。列全体を減光表示するため、当コマの生徒は表示せず対応中である旨のみ示す
  },
  t7: {
    1: [{ name: '佐々木陽向', grade: '中2', subject: '国', state: 'normal', attendance: '出' }],
    2: [{ name: '佐々木陽向', grade: '中2', subject: '国', state: 'normal', attendance: '出' }],
    3: [{ name: '佐々木陽向', grade: '中2', subject: '国', state: 'normal', attendance: '出' }],
    4: [{ name: '佐々木陽向', grade: '中2', subject: '国', state: 'absent', attendance: '欠' }],
  },
  t8: {
    2: [{ name: '斎藤颯太', grade: '小5', subject: '算', state: 'trial', attendance: '出' }],
    3: [{ name: '斎藤颯太', grade: '小5', subject: '算', state: 'trial', attendance: '出' }],
  },
};

// 未配置の生徒（4限）。担当がまだ決まっていない生徒を一覧化する
const UNPLACED_STUDENTS = [
  { name: '中野陸', grade: '中2', subject: '理' },
  { name: '高木蒼', grade: '中3', subject: '数' },
];

// サマリチップ
const SUMMARY = [
  { label: '本日の授業', value: '24', unit: 'コマ', icon: CalendarDays, tone: 'info' as const },
  { label: '出勤講師', value: '7', unit: '名', icon: Users, tone: 'success' as const },
  { label: '欠勤', value: '1', unit: '名', icon: UserX, tone: 'danger' as const },
  { label: '未配置', value: '2', unit: '件', icon: AlertTriangle, tone: 'warning' as const },
  { label: '体験', value: '1', unit: '件', icon: Sparkles, tone: 'success' as const },
  { label: 'テスト対策', value: '2', unit: '件', icon: BookOpenCheck, tone: 'warning' as const },
];

const TONE_CLASSES: Record<string, string> = {
  info: 'bg-info-subtle text-info',
  success: 'bg-success-subtle text-success',
  danger: 'bg-danger-subtle text-danger',
  warning: 'bg-warning-subtle text-warning',
};

// 行状態 → 背景クラス（座席表本体の配色規約に寄せる。振替=淡青/体験=淡緑/テスト対策=淡橙/欠席=淡グレー）
const ROW_STATE_CLASSES: Record<RowState, string> = {
  normal: 'bg-surface-raised',
  transfer: 'bg-[oklch(94.5%_0.035_250)] dark:bg-[oklch(32%_0.07_250)]',
  trial: 'bg-success-subtle',
  testprep: 'bg-[oklch(95%_0.045_80)] dark:bg-[oklch(33%_0.06_80)]',
  absent: 'bg-surface-hover',
};

const ATTENDANCE_CLASSES: Record<Attendance, string> = {
  出: 'bg-success text-text-on-primary',
  欠: 'bg-surface-hover text-text-faint border border-border',
  未: 'border border-border text-text-faint',
};

/* ============================================================
 * 小コンポーネント
 * ========================================================== */

function AttendanceDot({ attendance }: { attendance: Attendance }) {
  return (
    <span
      className={`shrink-0 rounded px-1 text-[10px] font-bold leading-4 ${ATTENDANCE_CLASSES[attendance]}`}
    >
      {attendance}
    </span>
  );
}

function StudentRow({ student }: { student: SeatStudent }) {
  const isAbsent = student.state === 'absent';
  return (
    <div
      className={`flex items-center gap-1 rounded-md px-1.5 py-1 text-xs ${ROW_STATE_CLASSES[student.state]}`}
    >
      <span
        className={`min-w-0 flex-1 truncate font-medium text-text-body ${
          isAbsent ? 'text-text-faint line-through' : ''
        }`}
      >
        {student.name}
      </span>
      <span className="shrink-0 text-[10px] text-text-faint">{student.grade}</span>
      <span className="shrink-0 rounded bg-surface-hover px-1 text-[10px] text-text-muted">
        {student.subject}
      </span>
      <AttendanceDot attendance={student.attendance} />
    </div>
  );
}

/* ============================================================
 * ページ本体
 * ========================================================== */

function DailyMockBoard() {
  // モックでは日付を切り替えても表示するダミーデータは変えない（見た目の導線確認が目的のため）
  const [dayOffset, setDayOffset] = useState(0);

  const baseDate = new Date();
  baseDate.setDate(baseDate.getDate() + dayOffset);
  const dateLabel = `${baseDate.getMonth() + 1}月${baseDate.getDate()}日(${
    ['日', '月', '火', '水', '木', '金', '土'][baseDate.getDay()]
  })`;

  return (
    <AdminLayout headerTitle="座席表" title="デイリー表示（モック）">
      {/* モック明示バナー + コンセプト注記 */}
      <div className="mb-4 flex items-start gap-2 rounded-lg border border-info bg-info-subtle px-4 py-3 text-sm text-info">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <p className="font-medium">これはUIモックです（すべてダミーデータ・DB接続なし）。</p>
          <p className="mt-1 text-text-body">
            週の座席表が「予定を組む盤」なのに対し、この日表示は「今日を回す運用盤」です。
            列=講師・行=コマで、今のコマの状況・講師の1日の流れ・当日の異常（欠勤/未配置/体験/テスト対策）を1画面で把握できることを狙っています。
            このビューでは配置の組み替えは行いません（組み替えは週表示で行う想定です）。
          </p>
        </div>
      </div>

      {/* ヘッダー行: 前日/本日/翌日 + 日付見出し */}
      <div className="mb-4 flex items-center gap-3">
        <div className="inline-flex overflow-hidden rounded-lg border border-border">
          <button
            type="button"
            onClick={() => setDayOffset((d) => d - 1)}
            className="flex items-center gap-1 px-3 py-1.5 text-sm text-text-muted transition-colors hover:bg-surface-hover"
          >
            <ChevronLeft className="h-4 w-4" />
            前日
          </button>
          <button
            type="button"
            onClick={() => setDayOffset(0)}
            className={`px-3 py-1.5 text-sm font-medium transition-colors ${
              dayOffset === 0
                ? 'bg-ink text-text-on-primary'
                : 'bg-surface text-text-muted hover:bg-surface-hover'
            }`}
          >
            本日
          </button>
          <button
            type="button"
            onClick={() => setDayOffset((d) => d + 1)}
            className="flex items-center gap-1 px-3 py-1.5 text-sm text-text-muted transition-colors hover:bg-surface-hover"
          >
            翌日
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <h2 className="text-lg font-bold text-text-heading">{dateLabel}</h2>
      </div>

      {/* サマリチップ行 */}
      <div className="mb-4 flex flex-wrap gap-2">
        {SUMMARY.map((s) => (
          <span
            key={s.label}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${TONE_CLASSES[s.tone]}`}
          >
            <s.icon className="h-3.5 w-3.5" />
            {s.label} <span className="text-sm font-bold">{s.value}</span>
            {s.unit}
          </span>
        ))}
      </div>

      {/* 盤面: 列=講師 / 行=コマ。左端=コマ見出し(sticky left)、上端=講師見出し(sticky top) */}
      <div className="overflow-auto rounded-xl border border-border bg-surface">
        <div
          className="grid min-w-max"
          style={{
            gridTemplateColumns: `160px repeat(${TEACHERS.length}, minmax(190px, 1fr))`,
          }}
        >
          {/* 左上コーナー（両方向 sticky） */}
          <div className="sticky left-0 top-0 z-30 border-b border-r border-border bg-surface-raised" />

          {/* 講師ヘッダー行（sticky top） */}
          {TEACHERS.map((t) => (
            <div
              key={t.id}
              className={`sticky top-0 z-20 flex items-center justify-between gap-2 border-b border-border px-3 py-2 ${
                t.isAbsent ? 'bg-danger-subtle' : 'bg-surface-raised'
              }`}
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-bold text-text-heading">{t.name}</div>
                <div className="text-[10px] text-text-faint">{t.seat}</div>
              </div>
              {t.isAbsent && (
                <span className="shrink-0 rounded-full bg-danger px-2 py-0.5 text-[10px] font-bold text-text-on-primary">
                  欠勤
                </span>
              )}
            </div>
          ))}

          {/* コマ行 */}
          {PERIODS.map((p) => {
            const isCurrent = p.key === CURRENT_PERIOD;
            return (
              <Fragment key={p.key}>
                {/* コマ見出し（sticky left） */}
                <div
                  className={`sticky left-0 z-10 flex flex-col justify-center gap-1 border-b border-r border-border px-3 py-2 ${
                    isCurrent ? 'bg-info-subtle' : 'bg-surface-raised'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-bold text-text-heading">{p.label}</span>
                    {isCurrent && (
                      <span className="rounded-full bg-info px-1.5 py-0.5 text-[10px] font-bold text-text-on-primary">
                        現在
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-text-faint">{p.time}</span>
                  {p.key === UNPLACED_PERIOD && (
                    <span className="mt-0.5 inline-flex w-fit items-center gap-1 rounded-full bg-warning-subtle px-1.5 py-0.5 text-[10px] font-bold text-warning">
                      <AlertTriangle className="h-3 w-3" />
                      未配置 {UNPLACED_STUDENTS.length}
                    </span>
                  )}
                </div>

                {/* 講師×コマのセル */}
                {TEACHERS.map((t) => {
                  const students = BOARD[t.id]?.[p.key] ?? [];
                  return (
                    <div
                      key={`${t.id}-${p.key}`}
                      className={`min-h-[52px] border-b border-r border-border-subtle p-1.5 last:border-r-0 ${
                        isCurrent ? 'bg-info-subtle/40' : ''
                      } ${t.isAbsent ? 'opacity-50' : ''}`}
                      style={
                        t.isAbsent
                          ? {
                              backgroundImage:
                                'repeating-linear-gradient(45deg, transparent, transparent 6px, color-mix(in oklch, var(--danger) 10%, transparent) 6px, color-mix(in oklch, var(--danger) 10%, transparent) 12px)',
                            }
                          : undefined
                      }
                    >
                      {t.isAbsent ? (
                        <div className="flex h-full min-h-[36px] items-center justify-center text-center text-[10px] text-text-faint">
                          欠勤のため振替対応中
                        </div>
                      ) : students.length === 0 ? (
                        <div className="h-full min-h-[36px]" />
                      ) : (
                        <div className="flex flex-col gap-1">
                          {students.map((s, i) => (
                            <StudentRow key={`${s.name}-${i}`} student={s} />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </Fragment>
            );
          })}
        </div>
      </div>

      {/* 未配置の生徒一覧（4限） */}
      <div className="mt-4 flex items-start gap-2 rounded-lg border border-warning bg-warning-subtle px-4 py-3 text-sm text-warning">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <p className="font-medium">4限に担当未定の生徒が{UNPLACED_STUDENTS.length}名います。</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {UNPLACED_STUDENTS.map((s) => (
              <span
                key={s.name}
                className="rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-text-body"
              >
                {s.name}（{s.grade}・{s.subject}）
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* フッター注記 */}
      <div className="mt-4 flex items-center gap-2 text-xs text-text-faint">
        <Flag className="h-3.5 w-3.5 shrink-0" />
        導入時は座席表ツールバーに「週 /
        日」の表示切替として組み込む想定です。出欠付け・報告書リンクは実装時に検討します。
      </div>
    </AdminLayout>
  );
}

export default function DailyMockPage() {
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

  return <DailyMockBoard />;
}
