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
  const [doneIds, setDoneIds] = useState<Set<string>>(() => new Set<string>());

  const toggleDone = (id: string) =>
    setDoneIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const remaining = sortedItems.length - doneIds.size;

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

      {/* メインカード「今日やること」 */}
      <Card>
        <CardContent className="py-3">
          {/* ヘッダー: タイトル + 日付 + 残り件数バッジ */}
          <div className="flex items-center gap-2 border-b border-border-subtle pb-3">
            <ListTodo className="w-5 h-5 text-text-muted" />
            <h1 className="text-base font-bold text-text-heading">今日やること</h1>
            <span className="text-sm text-text-muted">{formatToday()}</span>
            <span className="ml-auto inline-flex items-center rounded-full bg-primary-subtle px-2.5 py-0.5 text-xs font-bold text-primary">
              残り{remaining}件
            </span>
          </div>

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
        </p>
      </div>

      {/* フッター注記 */}
      <p className="mt-4 text-xs text-text-faint">
        導入時は /dashboard（教室長ダッシュボード）上段の最上部に置く想定。
        既存の要対応アラート・本日の授業カードは状況表示として残し、
        こちらは選別済みの行動リストという棲み分け。
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
