'use client';

/**
 * AIの読み取りの答え合わせ（システム管理者のみ）。
 *
 * 正典: docs/bulletin-ai-assist.html
 *
 * ★見たいのは1つだけ。「読み間違いが何件あるか」。
 *   本番で「PCSを配布 → 教材配布チェック」「諏訪中生 → 対象が空で母数0」の誤りが
 *   起きたが、気づけたのは教室長がスクリーンショットを送ってくれたからだった。
 *   数えられるようになって初めて、プロンプトのどこを直すかが決まる。
 *
 * ★ナビ（navConfig.ts）には足さない。入口は設定ページ（システム管理者のみ）。教室の運用で使う画面ではなく、
 *   AIを直す人が直接URLで開く。ナビに出すと、教室長が「自分が見るもの」だと
 *   思って開き、他教室の記録まで見えてしまう（この画面は全教室ぶんを出す）。
 */

import { useCallback, useEffect, useState } from 'react';
import { AdminLayout } from '@/components/layouts';
import { Loading } from '@/components/ui';
import AccessDenied from '@/components/AccessDenied';
import { useAuth } from '@/contexts/AuthContext';
import { fetchWithAuth } from '@/lib/api/auth';
import { isSystemAdmin } from '@/lib/utils/roles';
import { AI_FEATURE_KEYS, AI_FEATURE_LABELS, isAiFeatureKey } from '@/lib/ai/features';
import {
  FEEDBACK_VERDICTS_BY_FEATURE,
  FEEDBACK_VERDICT_LABELS,
  isFeedbackVerdict,
  type AiFeedbackListResponse,
  type AiFeedbackRow,
  type FeedbackVerdict,
} from '@/lib/ai/feedback';
import type { AiFeatureKey } from '@/lib/ai/features';
import { ClipboardCheck } from 'lucide-react';

/** 一度に読む件数。答え合わせは直近を見るものなので、深く遡らない */
const LIMIT = 200;

/** 表の「AIの読み」で1つの値を出す長さ。★これ以上は読まなくても判断できる */
const MAX_VALUE_CHARS = 40;

/** 入口のある機能（verdict が1つ以上ある機能）だけを画面に出す */
const ACTIVE_FEATURES = AI_FEATURE_KEYS.filter((k) => FEEDBACK_VERDICTS_BY_FEATURE[k].length > 0);

export default function AiFeedbackPage() {
  const { profile, isLoading: authLoading } = useAuth();
  const canSee = isSystemAdmin(profile?.role);

  const [rows, setRows] = useState<AiFeedbackRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [feature, setFeature] = useState('');
  const [verdict, setVerdict] = useState('');

  /**
   * 判断の選択肢。★機能を選んだら、その機能で使う答えだけにする。
   *   おまかせ下書きに「読み間違い」を出しても1件も無く、選ぶと空の表になる。
   */
  const verdictOptions: readonly FeedbackVerdict[] = isAiFeatureKey(feature)
    ? FEEDBACK_VERDICTS_BY_FEATURE[feature]
    : Array.from(new Set(ACTIVE_FEATURES.flatMap((k) => FEEDBACK_VERDICTS_BY_FEATURE[k])));

  // ★機能を変えたときに、その機能で使わない判断が残っていたら外す（空の表になるため）
  useEffect(() => {
    if (verdict && !verdictOptions.includes(verdict as FeedbackVerdict)) setVerdict('');
    // verdictOptions は feature から決まるので、feature だけを見ればよい
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feature]);

  const load = useCallback(async () => {
    if (!canSee) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(LIMIT) });
      if (feature) params.set('feature', feature);
      if (verdict) params.set('verdict', verdict);
      const res = await fetchWithAuth(`/api/ai/feedback?${params.toString()}`);
      if (!res.ok) {
        setRows([]);
        return;
      }
      const json = (await res.json()) as AiFeedbackListResponse;
      setRows(json.rows ?? []);
    } catch {
      setRows([]);
    } finally {
      setIsLoading(false);
    }
  }, [canSee, feature, verdict]);

  useEffect(() => {
    void load();
  }, [load]);

  if (authLoading) {
    return (
      <AdminLayout headerTitle="AIの答え合わせ">
        <Loading />
      </AdminLayout>
    );
  }

  if (!canSee) {
    return (
      <AdminLayout headerTitle="AIの答え合わせ">
        <AccessDenied />
      </AdminLayout>
    );
  }

  // ★機能ごと × 判断の件数。1つの表に混ざっているので、機能で割らないと読めない
  //   （「そのまま 5」が下書きの話なのかテーマの話なのか分からなくなる）
  const counts = countByFeatureAndVerdict(rows);

  return (
    <AdminLayout headerTitle="AIの答え合わせ">
      <div className="mb-6">
        <h1 className="mb-2 flex items-center gap-2 text-xl font-bold text-text-heading">
          <ClipboardCheck className="h-5 w-5" />
          AIの答え合わせ
        </h1>
        <p className="text-sm text-text-muted">
          機能ごとに、AIの出したものがどう扱われたかを集めています。聞いていることは機能ごとに違い（読み取りは「解釈が合っていたか」、下書きは「使えたか」、まとめは「合っていたか」）、集まった分だけAIを直せます。
        </p>
      </div>

      {/* 絞り込み */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-xs text-text-muted">
          <span>機能</span>
          <select
            value={feature}
            onChange={(e) => setFeature(e.target.value)}
            className="rounded border border-border bg-surface px-2 py-1 text-xs text-text-body"
          >
            <option value="">すべて</option>
            {ACTIVE_FEATURES.map((k) => (
              <option key={k} value={k}>
                {AI_FEATURE_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-text-muted">
          <span>判断</span>
          <select
            value={verdict}
            onChange={(e) => setVerdict(e.target.value)}
            className="rounded border border-border bg-surface px-2 py-1 text-xs text-text-body"
          >
            <option value="">すべて</option>
            {verdictOptions.map((v) => (
              <option key={v} value={v}>
                {FEEDBACK_VERDICT_LABELS[v]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* ★機能ごとに1行。読み間違いだけ強調する（プロンプトを直せるのはそれだけなので） */}
      <div className="mb-4 flex flex-col gap-2">
        {ACTIVE_FEATURES.map((k) => {
          const byVerdict = counts[k] ?? {};
          const total = Object.values(byVerdict).reduce((a, b) => a + b, 0);
          return (
            <div
              key={k}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-border-subtle bg-surface px-3 py-2"
            >
              <span className="w-36 shrink-0 text-xs font-bold text-text-heading">
                {AI_FEATURE_LABELS[k]}
              </span>
              {total === 0 ? (
                <span className="text-[11px] text-text-faint">まだ記録がありません</span>
              ) : (
                FEEDBACK_VERDICTS_BY_FEATURE[k].map((v) => (
                  <span
                    key={v}
                    className={`rounded px-2 py-0.5 text-xs ${
                      v === 'misread' || v === 'off'
                        ? 'bg-ink-subtle text-text-heading'
                        : 'text-text-muted'
                    }`}
                  >
                    {FEEDBACK_VERDICT_LABELS[v]}{' '}
                    <b className="font-bold tabular-nums text-text-heading">{byVerdict[v] ?? 0}</b>
                  </span>
                ))
              )}
            </div>
          );
        })}
      </div>

      {isLoading ? (
        <Loading />
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-text-muted">
          まだ記録がありません
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-text-muted">
                <th className="px-2 py-2 font-normal">日時</th>
                <th className="px-2 py-2 font-normal">教室</th>
                <th className="px-2 py-2 font-normal">機能</th>
                <th className="px-2 py-2 font-normal">AIの読み</th>
                <th className="px-2 py-2 font-normal">判断</th>
                <th className="px-2 py-2 font-normal">記録した人</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border-subtle align-top">
                  <td className="whitespace-nowrap px-2 py-2 font-mono text-[11px] tabular-nums text-text-faint">
                    {formatDateTime(r.createdAt)}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-xs text-text-body">
                    {r.schoolName || '—'}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-xs text-text-body">
                    {isAiFeatureKey(r.feature) ? AI_FEATURE_LABELS[r.feature] : r.feature}
                  </td>
                  <td className="px-2 py-2 text-xs text-text-body">
                    <AiOutputCell row={r} />
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-xs">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] ${
                        r.verdict === 'misread'
                          ? 'bg-ink text-white'
                          : 'border border-border text-text-body'
                      }`}
                    >
                      {isFeedbackVerdict(r.verdict)
                        ? FEEDBACK_VERDICT_LABELS[r.verdict]
                        : r.verdict}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-xs text-text-muted">
                    {r.createdByName || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminLayout>
  );
}

/**
 * AIが出したもの。
 *
 * ★機能ごとに中身の形が違うので、決め打ちで読まない。キーと値をそのまま並べる。
 *   決め打ちで書くと、機能を足すたびにこの画面が「空」になり、
 *   何が記録されているのか分からないまま気づかれずに残る。
 *
 * ★長い値は切る。ここで読みたいのは「どんな出力に対する答えか」の見当だけで、
 *   全文が要るなら記録そのものを見に行く。
 */
function AiOutputCell({ row }: { row: AiFeedbackRow }) {
  const entries = Object.entries(row.aiOutput ?? {});

  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-bold text-text-heading">{row.targetKind}</span>
      {entries.map(([key, value]) => (
        <span key={key} className="text-[11px] text-text-faint">
          <span className="font-mono">{key}</span>: {formatValue(value)}
        </span>
      ))}
      {row.note && <span className="text-[11px] text-text-muted">{row.note}</span>}
    </div>
  );
}

/** 値を1行の文字にする。★40字で切る（読まなくても判断できる長さ） */
function formatValue(value: unknown): string {
  const text =
    value == null
      ? ''
      : typeof value === 'string'
        ? value
        : Array.isArray(value)
          ? value.join('・')
          : typeof value === 'object'
            ? JSON.stringify(value)
            : String(value);
  return text.length > MAX_VALUE_CHARS ? `${text.slice(0, MAX_VALUE_CHARS)}…` : text;
}

/** 機能 → 判断 → 件数。★機能で割らないと同じ語（「そのまま」）が別物と混ざる */
function countByFeatureAndVerdict(
  rows: AiFeedbackRow[]
): Partial<Record<AiFeatureKey, Record<string, number>>> {
  const counts: Partial<Record<AiFeatureKey, Record<string, number>>> = {};
  for (const r of rows) {
    if (!isAiFeatureKey(r.feature)) continue;
    const byVerdict = (counts[r.feature] ??= {});
    byVerdict[r.verdict] = (byVerdict[r.verdict] ?? 0) + 1;
  }
  return counts;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const mm = d.getMonth() + 1;
  const dd = d.getDate();
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${mm}/${dd} ${hh}:${mi}`;
}
