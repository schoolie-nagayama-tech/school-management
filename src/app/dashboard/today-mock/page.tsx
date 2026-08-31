'use client';

/**
 * 「今日やること」ウィジェット モック（検討用・admin 限定）。
 * ------------------------------------------------------------------
 * コンセプト: 朝の1分で今日の段取りが決まる行動リスト。
 * 教室長が出勤して最初に開く場所を想定。
 * 月次タスク・未提出報告書・要対応アラート・座席表の当日日程という
 * 別々のページに散らばっている情報から、「今日やる理由があるもの」だけを選別して
 * 1本のリストに統合する。
 * 既存ダッシュボードの「要対応アラート」「本日の授業」カードが状況表示なのに対し、
 * こちらは1項目=1行動の行動リスト。済にすれば消える。
 * 将来はこの選別・要約を AI に任せる土台（構想⑪）。
 *
 * 2026-08-31 追記: 「教室の運営」ブロックに加え、「今日来る生徒への用事」ブロックを追加。
 * 生徒が教室に来ている日は、本人・保護者に直接「渡す・聞く・案内する」ができる唯一の機会。
 * 逃すと電話や郵送になり、手間も遅延も増える。だから「今日授業がある生徒 × その生徒の
 * 未処理の用事（アラート・申込・面談時期など）」を突き合わせて、捕まえられるうちに
 * 片付けるためのリストを出す。
 *
 * このページは1ファイル完結のUIモックであり、ダミーデータのみを使う。
 * DB・API へのアクセスは一切行わない。完了状態は useState のみ（永続化なし）。
 */

import { useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { isSystemAdmin } from '@/lib/utils/roles';
import { AdminLayout } from '@/components/layouts';
import { Card, CardContent, Loading } from '@/components/ui';
import AccessDenied from '@/components/AccessDenied';
import {
  ListTodo,
  CalendarX,
  FileText,
  AlertTriangle,
  ClipboardList,
  ChevronRight,
  Check,
  Flag,
  Sparkles,
  Users,
} from 'lucide-react';

/* ============================================================
 * ダミーデータ
 * ------------------------------------------------------------
 * 種別（kind）ごとにチップの色・アイコンを分ける。
 * time を持つ行（座席表由来の授業関連）は時刻順で上位に来る。
 * overdue=true の行は期限超過として赤系で最上位グループに来る。
 * ========================================================== */

type ItemKind = 'seat' | 'report' | 'task' | 'alert';

interface TodoItem {
  id: string;
  kind: ItemKind;
  time?: string; // "HH:MM" 形式。あれば時刻順ソートの対象
  title: string; // 太字で出す1行動
  note: string; // 補足（小さめグレー）
  overdue?: boolean; // 期限超過（最上位・赤系）
}

const KIND_META: Record<
  ItemKind,
  { label: string; icon: React.ElementType; tone: 'info' | 'warning' | 'primary' | 'danger' }
> = {
  seat: { label: '座席', icon: CalendarX, tone: 'info' },
  report: { label: '報告書', icon: FileText, tone: 'warning' },
  task: { label: 'タスク', icon: ClipboardList, tone: 'primary' },
  alert: { label: 'アラート', icon: AlertTriangle, tone: 'danger' },
};

// tone → Tailwind クラス（既存デザイントークンに合わせる）
const TONE: Record<string, { text: string; bg: string }> = {
  danger: { text: 'text-danger', bg: 'bg-danger-subtle' },
  warning: { text: 'text-warning', bg: 'bg-warning-subtle' },
  info: { text: 'text-info', bg: 'bg-info-subtle' },
  primary: { text: 'text-primary', bg: 'bg-primary-subtle' },
};

const ITEMS: TodoItem[] = [
  {
    id: 'seat-1',
    kind: 'seat',
    time: '3限',
    title: '3限 佐藤先生が欠勤 — 代講の手配または振替の調整',
    note: '対象生徒2名',
  },
  {
    id: 'seat-2',
    kind: 'seat',
    time: '18:20',
    title: '18:20 体験授業 山田さん（中2・英数）— 教材準備と保護者お迎え対応',
    note: '',
  },
  {
    id: 'seat-3',
    kind: 'seat',
    time: '5限',
    title: '未配置の生徒が2名（本日5限）— 担当講師を決める',
    note: '',
  },
  {
    id: 'alert-1',
    kind: 'alert',
    title: '通塾日程の変更が座席表に未反映 1件',
    note: '中3 佐々木さん',
  },
  {
    id: 'report-1',
    kind: 'report',
    title: '昨日の報告書が未提出 3件',
    note: '田中先生2・鈴木先生1 — 出勤時に声かけ',
  },
  {
    id: 'report-2',
    kind: 'report',
    title: '承認待ちの報告書 5件',
    note: '今日中に確認',
  },
  {
    id: 'task-1',
    kind: 'task',
    title: '面談案内の送付',
    note: '期限: 今日',
  },
  {
    id: 'task-2',
    kind: 'task',
    title: '請求データの確認',
    note: '期限を2日超過',
    overdue: true,
  },
  {
    id: 'alert-2',
    kind: 'alert',
    title: '欠席が3回続いている生徒 1名',
    note: '中1 小林さん — フォロー連絡',
  },
  {
    id: 'seat-4',
    kind: 'seat',
    title: '振替期限が今週末のコマ 2件 — 保護者へ候補日の連絡',
    note: '',
  },
];

/* ============================================================
 * 「今日来る生徒への用事」ダミーデータ
 * ------------------------------------------------------------
 * 「今日授業がある生徒 × その生徒の未処理の用事」を突き合わせたリストを想定。
 * 生徒本人・保護者が教室に来ている today のうちに、渡す・聞く・案内するために
 * 時限（コマ）ごとにグルーピングして出す。
 * ========================================================== */

type StudentTodoKind = '申込' | '面談' | '模試' | '成績' | '振替' | '学習' | '教材' | '入会';
type Urgency = 'high' | 'medium' | 'low';

interface StudentTodoItem {
  id: string;
  period: string; // グルーピングキー（"3限" など）
  periodTime: string; // 見出しに出す時間帯（ダミーの固定値）
  studentName: string;
  grade: string;
  action: string; // 用事の本文（行動が分かる文）
  note: string; // 補足（期限・経過日数など）
  kind: StudentTodoKind;
  urgency: Urgency;
}

// 種別 → チップの tone（既存 TONE マップの考え方に合わせる。KIND_META とは別物）
const STUDENT_KIND_TONE: Record<StudentTodoKind, keyof typeof TONE> = {
  申込: 'danger',
  面談: 'info',
  模試: 'primary',
  成績: 'primary',
  振替: 'warning',
  学習: 'warning',
  教材: 'info',
  入会: 'danger',
};

// 緊急度 → 左端ドットの色
const URGENCY_DOT: Record<Urgency, string> = {
  high: 'bg-danger',
  medium: 'bg-warning',
  low: 'bg-text-faint',
};

// 時限 → 表示する時間帯（ダミーの固定値。教室長が時間の流れどおりに動けるようにするための見出し）
const PERIOD_TIME: Record<string, string> = {
  '3限': '16:20〜17:50',
  '4限': '18:00〜19:30',
  '5限': '19:40〜21:10',
  '6限': '21:20〜22:50',
};

const STUDENT_TODOS: StudentTodoItem[] = [
  {
    id: 'stu-1',
    period: '3限',
    periodTime: PERIOD_TIME['3限'],
    studentName: '佐々木陽向',
    grade: '中2',
    action: '秋期講習の申込書を渡す',
    note: '締切 9/5（あと5日）・未提出',
    kind: '申込',
    urgency: 'high',
  },
  {
    id: 'stu-2',
    period: '3限',
    periodTime: PERIOD_TIME['3限'],
    studentName: '山田さくら',
    grade: '小6',
    action: '面談の日程を聞く',
    note: '前回面談から4か月',
    kind: '面談',
    urgency: 'high',
  },
  {
    id: 'stu-3',
    period: '4限',
    periodTime: PERIOD_TIME['4限'],
    studentName: '高木蒼',
    grade: '中3',
    action: '模試の目標点をまだ聞けていない',
    note: 'Vもぎ 9/14 申込済み',
    kind: '模試',
    urgency: 'medium',
  },
  {
    id: 'stu-4',
    period: '4限',
    periodTime: PERIOD_TIME['4限'],
    studentName: '小林芽依',
    grade: '中1',
    action: '1学期の通知表を見せてもらう',
    note: '成績未入力',
    kind: '成績',
    urgency: 'medium',
  },
  {
    id: 'stu-5',
    period: '5限',
    periodTime: PERIOD_TIME['5限'],
    studentName: '中野陸',
    grade: '中2',
    action: '振替の候補日を保護者に確認',
    note: '振替期限 9/30・1件保留',
    kind: '振替',
    urgency: 'medium',
  },
  {
    id: 'stu-6',
    period: '5限',
    periodTime: PERIOD_TIME['5限'],
    studentName: '木村蓮',
    grade: '中1',
    action: '宿題が3回続けて未実施。やり方を確認する',
    note: '直近3回',
    kind: '学習',
    urgency: 'medium',
  },
  {
    id: 'stu-7',
    period: '6限',
    periodTime: PERIOD_TIME['6限'],
    studentName: '清水奏',
    grade: '中2',
    action: '発注済みの教材を渡す',
    note: '9/28 入荷済み・未配布',
    kind: '教材',
    urgency: 'low',
  },
  {
    id: 'stu-8',
    period: '6限',
    periodTime: PERIOD_TIME['6限'],
    studentName: '斎藤颯太',
    grade: '小5',
    action: '体験後の入会案内をする',
    note: '体験 8/29 実施済み',
    kind: '入会',
    urgency: 'high',
  },
];

// 時限でグルーピング（登場順を維持）。教室長が時間の流れどおりに動けるようにするため
function groupByPeriod(
  items: StudentTodoItem[]
): { period: string; time: string; items: StudentTodoItem[] }[] {
  const groups: { period: string; time: string; items: StudentTodoItem[] }[] = [];
  for (const item of items) {
    let group = groups.find((g) => g.period === item.period);
    if (!group) {
      group = { period: item.period, time: item.periodTime, items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}

// 時刻文字列（"HH:MM" or "N限"）を分単位のソートキーに変換。値が無ければ最後に回す
function timeSortKey(time?: string): number {
  if (!time) return Number.POSITIVE_INFINITY;
  const hm = time.match(/^(\d{1,2}):(\d{2})$/);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2]);
  const nth = time.match(/^(\d+)限$/);
  if (nth) return 8 * 60 + Number(nth[1]) * 90; // 大まかな換算（コマ順の目安）
  return Number.POSITIVE_INFINITY;
}

// 並び順: 期限超過 → 時刻付き（授業関連）を時刻順 → その他
function sortItems(items: TodoItem[]): TodoItem[] {
  return [...items].sort((a, b) => {
    if (!!a.overdue !== !!b.overdue) return a.overdue ? -1 : 1;
    const ta = timeSortKey(a.time);
    const tb = timeSortKey(b.time);
    if (ta !== tb) return ta - tb;
    return 0;
  });
}

// 今日の日付表示（例: 8月31日(月)）
function formatToday(): string {
  const d = new Date();
  const w = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
  return `${d.getMonth() + 1}月${d.getDate()}日(${w})`;
}

function TodayMockBody() {
  const sortedItems = useMemo(() => sortItems(ITEMS), []);
  const studentGroups = useMemo(() => groupByPeriod(STUDENT_TODOS), []);
  // 済 state は2枚のカードで共用（stu-* は生徒カード側の行で衝突しないID）
  const [doneIds, setDoneIds] = useState<Set<string>>(() => new Set<string>());

  const toggleDone = (id: string) =>
    setDoneIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // 残り件数バッジはカードごとに自分の行だけを数える
  const remaining = sortedItems.filter((item) => !doneIds.has(item.id)).length;
  const remainingStudents = STUDENT_TODOS.filter((item) => !doneIds.has(item.id)).length;

  return (
    <AdminLayout headerTitle="今日やること（モック）" title="今日やること">
      {/* モック明示バナー + コンセプト注記 */}
      <div className="mb-4 flex items-start gap-2 rounded-lg border border-info bg-info-subtle px-4 py-3 text-sm text-info">
        <Flag className="mt-0.5 w-4 h-4 shrink-0" />
        <div>
          <p className="font-medium">これはUIモックです（ダミーデータ・DB接続なし）</p>
          <p className="mt-1 text-text-body">
            月次タスク・未提出報告書・要対応アラート・座席表の当日日程に散らばっている情報から、
            「今日やる理由があるもの」だけを選別して1本の行動リストに統合する構想です。
            既存の「要対応アラート」「本日の授業」カードが状況表示なのに対し、
            こちらは1項目=1行動の行動リスト。済にすれば消えます。
          </p>
        </div>
      </div>

      {/* ブロック1: 既存カード「教室の運営」 */}
      <Card>
        <CardContent className="py-3">
          {/* ヘッダー: タイトル + 日付 + 残り件数バッジ */}
          <div className="flex items-center gap-2 border-b border-border-subtle pb-1">
            <ListTodo className="w-5 h-5 text-text-muted" />
            <h1 className="text-base font-bold text-text-heading">教室の運営</h1>
            <span className="text-sm text-text-muted">{formatToday()}</span>
            <span className="ml-auto inline-flex items-center rounded-full bg-primary-subtle px-2.5 py-0.5 text-xs font-bold text-primary">
              残り{remaining}件
            </span>
          </div>
          <p className="border-b border-border-subtle pb-3 text-xs text-text-faint">
            教室として今日さばくこと
          </p>

          {/* 統合リスト（種別分けせず、行頭チップで示す） */}
          <div>
            {sortedItems.map((item) => {
              const done = doneIds.has(item.id);
              const meta = KIND_META[item.kind];
              const tone = TONE[meta.tone];
              const overdueActive = item.overdue && !done;
              return (
                <div
                  key={item.id}
                  className={`flex items-center gap-3 border-b border-border-subtle py-3 last:border-0 ${
                    done ? 'opacity-60' : ''
                  }`}
                >
                  {/* 種別チップ */}
                  <span
                    className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${tone.bg} ${tone.text}`}
                  >
                    <meta.icon className="w-3 h-3" />
                    {meta.label}
                  </span>

                  {/* 本文（太字1行動）+ 補足 */}
                  <div className="min-w-0 flex-1">
                    <p
                      className={`text-sm font-medium ${
                        done ? 'text-text-faint line-through' : 'text-text-body'
                      }`}
                    >
                      {item.title}
                    </p>
                    {item.note && (
                      <p
                        className={`mt-0.5 text-xs ${
                          overdueActive ? 'font-medium text-danger' : 'text-text-faint'
                        }`}
                      >
                        {item.note}
                      </p>
                    )}
                  </div>

                  {/* 遷移矢印（詳細ページへの導線。モックでは見た目のみ） */}
                  <button
                    type="button"
                    className="shrink-0 rounded-md p-1.5 text-text-faint transition-colors hover:bg-surface-hover hover:text-primary"
                    aria-label="詳細へ"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>

                  {/* 済チェックボタン */}
                  <button
                    type="button"
                    onClick={() => toggleDone(item.id)}
                    className={`flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
                      done
                        ? 'border-success bg-success-subtle text-success'
                        : 'border-border text-text-muted hover:bg-surface-hover hover:text-primary'
                    }`}
                  >
                    <Check className="w-3.5 h-3.5" />済
                  </button>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* ブロック2: 新規カード「今日来る生徒への用事」 */}
      <Card className="mt-4">
        <CardContent className="py-3">
          {/* ヘッダー: タイトル + サブテキスト + 残り件数バッジ */}
          <div className="flex items-start gap-2 border-b border-border-subtle pb-3">
            <Users className="mt-0.5 w-5 h-5 text-text-muted" />
            <div className="min-w-0">
              <h2 className="text-base font-bold text-text-heading">今日来る生徒への用事</h2>
              <p className="text-xs text-text-faint">
                本人が来ている今日のうちに、渡す・聞く・案内する
              </p>
            </div>
            <span className="ml-auto shrink-0 inline-flex items-center rounded-full bg-primary-subtle px-2.5 py-0.5 text-xs font-bold text-primary">
              残り{remainingStudents}件
            </span>
          </div>

          {/* 時限グルーピング */}
          <div>
            {studentGroups.map((group) => (
              <div key={group.period}>
                {/* 時限見出し（教室長が時間の流れどおりに動けるように） */}
                <p className="pb-1 pt-3 text-xs font-bold text-text-muted">
                  {group.period} {group.time}
                </p>

                {group.items.map((item) => {
                  const done = doneIds.has(item.id);
                  const tone = TONE[STUDENT_KIND_TONE[item.kind]];
                  return (
                    <div
                      key={item.id}
                      className={`flex items-start gap-3 border-b border-border-subtle py-3 last:border-0 ${
                        done ? 'opacity-60' : ''
                      }`}
                    >
                      {/* 緊急度ドット */}
                      <span
                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${URGENCY_DOT[item.urgency]}`}
                        aria-hidden="true"
                      />

                      {/* 生徒名+学年+種別チップ / 用事の本文 / 補足 */}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span
                            className={`text-sm font-bold ${
                              done ? 'text-text-faint line-through' : 'text-text-heading'
                            }`}
                          >
                            {item.studentName}
                          </span>
                          <span className="text-xs text-text-faint">{item.grade}</span>
                          <span
                            className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ${tone.bg} ${tone.text}`}
                          >
                            {item.kind}
                          </span>
                        </div>
                        <p
                          className={`mt-1 text-sm font-medium ${
                            done ? 'text-text-faint line-through' : 'text-text-body'
                          }`}
                        >
                          {item.action}
                        </p>
                        {item.note && <p className="mt-0.5 text-xs text-text-faint">{item.note}</p>}
                      </div>

                      {/* 済チェックボタン（既存カードと同じ見た目・toggle ロジックを再利用） */}
                      <button
                        type="button"
                        onClick={() => toggleDone(item.id)}
                        className={`flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
                          done
                            ? 'border-success bg-success-subtle text-success'
                            : 'border-border text-text-muted hover:bg-surface-hover hover:text-primary'
                        }`}
                      >
                        <Check className="w-3.5 h-3.5" />済
                      </button>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* AIプレースホルダ */}
      <div className="mt-4 rounded-lg border border-dashed border-border px-4 py-3 text-sm text-text-muted">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 shrink-0 text-text-faint" />
          <span className="font-medium text-text-body">
            AIによる今日の要点まとめ（構想・未実装）
          </span>
        </div>
        <p className="mt-1 text-xs text-text-faint">
          将来ここに「今日は欠勤対応が最優先。夕方の体験までに〜」のような要約が入る想定です。
          生徒単位の要約も想定に含み、「今日来る生徒のうち、声をかける優先度が高いのは〜」のような
          出し方も検討しています。
        </p>
      </div>

      {/* フッター注記 */}
      <p className="mt-4 text-xs text-text-faint">
        導入時は /dashboard（教室長ダッシュボード）上段の最上部に置く想定。
        既存の要対応アラート・本日の授業カードは状況表示として残し、
        こちらは選別済みの行動リストという棲み分け。 生徒への用事は「今日授業がある生徒 ×
        未処理の用事（アラート・申込・面談時期など）」の 突き合わせで出す想定です。
      </p>
    </AdminLayout>
  );
}

export default function TodayMockPage() {
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
  return <TodayMockBody />;
}
