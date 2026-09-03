'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { fetchWithAuth } from '@/lib/api/auth';

/**
 * 答えられなかった質問の一覧（admin 限定）。
 *
 * ★AIを賢くするのではなく、ここを見てFAQを書き足す。書き足せば次から答えられる。
 *   「立たなかった」と言われた質問も同じ材料として並べる。
 *
 * 既定は畳んでおく。ヘルプを見に来た人の邪魔をしないため。
 */

interface Row {
  question: string;
  role: string;
  pagePath: string | null;
  count: number;
  lastAskedAt: string;
}

const ROLE_LABELS: Record<string, string> = {
  admin: '管理者',
  manager: '教室長',
  teacher: '講師',
  all: 'スタッフ',
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes()
  ).padStart(2, '0')}`;
}

export function UnansweredQuestions() {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth('/api/ai/help/questions');
      if (!res.ok) {
        setRows([]);
        return;
      }
      const body = (await res.json()) as { rows?: Row[] };
      setRows(body.rows ?? []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && rows === null) void load();
  }, [open, rows, load]);

  return (
    <section className="rounded-xl border border-border bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span>
          <span className="text-sm font-bold text-text-heading">答えられなかった質問</span>
          <span className="ml-2 text-xs text-text-muted">
            ここを見てFAQを書き足すと、次から答えられます
          </span>
        </span>
        {open ? (
          <ChevronUp className="w-4 h-4 text-text-muted shrink-0" aria-hidden="true" />
        ) : (
          <ChevronDown className="w-4 h-4 text-text-muted shrink-0" aria-hidden="true" />
        )}
      </button>

      {open && (
        <div className="px-4 pb-4">
          {loading && <p className="text-sm text-text-muted">読み込んでいます…</p>}

          {!loading && rows !== null && rows.length === 0 && (
            <p className="text-sm text-text-muted">
              まだありません。答えられなかった質問と、「立たなかった」と言われた質問がここに出ます。
            </p>
          )}

          {!loading && rows !== null && rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left font-normal text-xs text-text-faint pb-2 pr-3 whitespace-nowrap">
                      最後に聞かれた
                    </th>
                    <th className="text-left font-normal text-xs text-text-faint pb-2 pr-3 whitespace-nowrap">
                      役割
                    </th>
                    <th className="text-left font-normal text-xs text-text-faint pb-2 pr-3">
                      質問
                    </th>
                    <th className="text-left font-normal text-xs text-text-faint pb-2 pr-3 whitespace-nowrap">
                      開いていた画面
                    </th>
                    <th className="text-left font-normal text-xs text-text-faint pb-2 whitespace-nowrap">
                      回数
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.question} className="border-b border-border-subtle last:border-0">
                      <td className="py-2 pr-3 text-xs text-text-muted tabular-nums whitespace-nowrap">
                        {formatDate(r.lastAskedAt)}
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        <span className="px-2 py-0.5 rounded-full bg-surface-hover text-xs text-text-muted">
                          {ROLE_LABELS[r.role] ?? r.role}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-text-heading">{r.question}</td>
                      <td className="py-2 pr-3 text-xs text-text-faint tabular-nums whitespace-nowrap">
                        {r.pagePath ?? '—'}
                      </td>
                      <td className="py-2 text-xs text-text-muted tabular-nums">{r.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
