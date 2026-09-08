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
 * ★ナビ（navConfig.ts）には足さない。教室の運用で使う画面ではなく、
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
  FEEDBACK_VERDICTS,
  FEEDBACK_VERDICT_LABELS,
  isFeedbackVerdict,
  type AiFeedbackListResponse,
  type AiFeedbackRow,
} from '@/lib/ai/feedback';
import { ClipboardCheck } from 'lucide-react';

/** 一度に読む件数。答え合わせは直近を見るものなので、深く遡らない */
const LIMIT = 200;

export default function AiFeedbackPage() {
  const { profile, isLoading: authLoading } = useAuth();
  const canSee = isSystemAdmin(profile?.role);

  const [rows, setRows] = useState<AiFeedbackRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [feature, setFeature] = useState('');
  const [verdict, setVerdict] = useState('');

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

  // ★判断ごとの件数。読み間違いが何件かが一目で分かることが、この画面の目的
  const counts = countByVerdict(rows);

  return (
    <AdminLayout headerTitle="AIの答え合わせ">
      <div className="mb-6">
        <h1 className="mb-2 flex items-center gap-2 text-xl font-bold text-text-heading">
          <ClipboardCheck className="h-5 w-5" />
          AIの答え合わせ
        </h1>
        <p className="text-sm text-text-muted">
          教室長が「× 消す」で選んだ理由です。読み間違いが集まった分だけ、AIの読み取りを直せます。
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
            {AI_FEATURE_KEYS.map((k) => (
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
            {FEEDBACK_VERDICTS.map((v) => (
              <option key={v} value={v}>
                {FEEDBACK_VERDICT_LABELS[v]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* ★判断ごとの件数。読み間違いだけ強調する（直せるのはそれだけなので） */}
      <div className="mb-4 flex flex-wrap gap-2">
        {FEEDBACK_VERDICTS.map((v) => (
          <div
            key={v}
            className={`rounded-lg border px-3 py-2 ${
              v === 'misread' ? 'border-ink/35 bg-ink-subtle' : 'border-border-subtle bg-surface'
            }`}
          >
            <div className="text-[11px] text-text-muted">{FEEDBACK_VERDICT_LABELS[v]}</div>
            <div className="text-xl font-bold tabular-nums text-text-heading">{counts[v] ?? 0}</div>
          </div>
        ))}
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
 * AIが出したもの（種別・対象・根拠にした一文）。
 * ★ai_output は機能ごとに中身が違うので、決め打ちで読まずに「あれば出す」にする。
 */
function AiOutputCell({ row }: { row: AiFeedbackRow }) {
  const out = row.aiOutput ?? {};
  const kind = str(out.kind);
  const scope = str(out.scope);
  const excerpt = str(out.sourceExcerpt);
  const title = str(out.title);
  const grades = Array.isArray(out.targetGrades) ? out.targetGrades.join('・') : '';
  const schools = Array.isArray(out.targetSchoolNames) ? out.targetSchoolNames.join('・') : '';

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex flex-wrap items-center gap-x-2">
        <span className="font-bold text-text-heading">{kind || row.targetKind}</span>
        {scope && <span className="text-[11px] text-text-muted">{scope}</span>}
        {grades && <span className="text-[11px] text-text-muted">学年: {grades}</span>}
        {schools && <span className="text-[11px] text-text-muted">通学校: {schools}</span>}
      </div>
      {/* ★どこで読み間違えたかは、この一文を見ないと分からない */}
      {excerpt && <span className="text-[11px] text-text-faint">「{excerpt}」から</span>}
      {title && <span className="text-[11px] text-text-faint">投稿: {title}</span>}
      {row.note && <span className="text-[11px] text-text-muted">{row.note}</span>}
    </div>
  );
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function countByVerdict(rows: AiFeedbackRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of rows) {
    counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;
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
