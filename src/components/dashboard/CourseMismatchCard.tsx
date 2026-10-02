'use client';

/**
 * 教室長ダッシュボード「コースと登録の食い違い」。
 *
 * コース（PS1／PS2／キッズ）を授業登録から書き換えられないようにしても、
 * 登録時のブロックでは止められない食い違いが残る（振替・臨時・コース変更の後追い・
 * 講師がコース未設定の科目を登録した分）。それを拾って見せる場所。
 *
 * ★直すのは登録のほう。
 *   保護者に見せているのは実登録なので、食い違っているときにコース側を表示すると
 *   画面が「1対1」と出て保護者を安心させ、表示が誤りを覆い隠す装置になる。
 *
 * 座席表の稼働直後は「コース未設定」が大量に出るため、重い2種（比率違い・1対1の同席）と
 * 分けて、未設定は件数だけ畳んで出す。重いものが埋もれると、この機能の意味が無くなる。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import {
  getCourseMismatches,
  describeMismatch,
  type CourseMismatch,
} from '@/lib/api/courseMismatch';

interface CourseMismatchCardProps {
  schoolIds: string[];
}

/** 重い食い違い（すぐ直すもの）。 */
const HEAVY_KINDS = new Set<CourseMismatch['kind']>(['ratio', 'one_to_one_shared']);

export function CourseMismatchCard({ schoolIds }: CourseMismatchCardProps) {
  const [rows, setRows] = useState<CourseMismatch[] | null>(null);
  const [showAll, setShowAll] = useState(false);

  const key = schoolIds.join(',');
  const load = useCallback(() => {
    if (schoolIds.length === 0) {
      setRows([]);
      return;
    }
    let active = true;
    getCourseMismatches(schoolIds)
      .then((r) => {
        if (active) setRows(r);
      })
      .catch(() => {
        if (active) setRows([]);
      });
    return () => {
      active = false;
    };
    // schoolIds は毎回新しい配列で渡ってくるので、中身をキーにする。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    const cleanup = load();
    return cleanup;
  }, [load]);

  const { heavy, light } = useMemo(() => {
    const all = rows ?? [];
    return {
      heavy: all.filter((r) => HEAVY_KINDS.has(r.kind)),
      light: all.filter((r) => !HEAVY_KINDS.has(r.kind)),
    };
  }, [rows]);

  // 食い違いが無いときはカードごと出さない（何も無いカードで画面を埋めない）。
  if (rows === null || rows.length === 0) return null;

  const shownLight = showAll ? light : light.slice(0, 3);

  return (
    <div className="bg-white border border-[var(--stroke)] rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-[#1f2937] flex items-center gap-1.5">
          <AlertTriangle className="w-4 h-4 text-amber-600" />
          コースと登録の食い違い
        </h3>
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">
          {rows.length}件
        </span>
      </div>

      <ul className="divide-y divide-[#f3f4f6]">
        {heavy.map((m) => (
          <MismatchRow key={rowKey(m)} m={m} severity="danger" />
        ))}
        {shownLight.map((m) => (
          <MismatchRow key={rowKey(m)} m={m} severity="warning" />
        ))}
      </ul>

      {light.length > 3 && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--paragraph-light)] hover:text-[var(--paragraph)]"
        >
          {showAll ? (
            <>
              <ChevronUp className="w-3 h-3" />
              残りを畳む
            </>
          ) : (
            <>
              <ChevronDown className="w-3 h-3" />
              残り{light.length - 3}件を見る
            </>
          )}
        </button>
      )}

      <p className="mt-2 text-[11px] text-[var(--paragraph-light)]">
        <b>直すのは登録のほうです。</b>保護者に見えているのは実際の登録です。
      </p>
    </div>
  );
}

function rowKey(m: CourseMismatch) {
  return `${m.kind}:${m.studentId}:${m.subjectId ?? '-'}:${m.entryRatio}:${m.entryDuration}`;
}

function MismatchRow({ m, severity }: { m: CourseMismatch; severity: 'danger' | 'warning' }) {
  return (
    <li className="flex items-start gap-2.5 py-2">
      <span
        className={`w-1.5 self-stretch rounded-full flex-none ${
          severity === 'danger' ? 'bg-red-600' : 'bg-amber-500'
        }`}
      />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-[var(--headline)]">
          <span className="font-semibold">{m.studentName}</span>
          <span className="text-[var(--paragraph-light)]"> ／ {m.subjectName}</span>
          <span className="ml-2 text-[11px] font-mono bg-[var(--surface)] rounded px-1.5 py-0.5 text-[var(--paragraph)]">
            {describeMismatch(m)}
          </span>
        </div>
        <div className="text-[11px] text-[var(--paragraph-light)] mt-0.5">
          {m.nearestDate}
          {m.count > 1 ? ` ほか${m.count - 1}件` : ''}
        </div>
      </div>
      <Link
        href={
          m.kind === 'no_course' ? `/students/${m.studentId}` : `/schedule?date=${m.nearestDate}`
        }
        className="text-xs text-[var(--primary,#2563eb)] hover:underline whitespace-nowrap"
      >
        {m.kind === 'no_course' ? 'コースを設定' : '座席表で見る'}
      </Link>
    </li>
  );
}
