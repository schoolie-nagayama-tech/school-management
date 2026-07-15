'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ChevronRight,
  FlaskConical,
  GraduationCap,
  PenLine,
  Repeat,
  CalendarDays,
  ClipboardList,
} from 'lucide-react';
import type { FormGuidance, GuidanceFormType, GuidanceItem } from '@/types/mypage-schedule';

/**
 * 手続きハブ（申し込み・通塾の変更・相談）。
 *
 * 正典: docs/portal-v2-requirements.md §7-3「申し込みプッシュ」、UIモック。
 *
 * ★ 上部の「〇〇さんへのご案内」が本題:
 *   「受付中」の羅列だけでは保護者は自分が申し込むべきものを見つけられない。
 *   その生徒宛の提案書・対象学年の模試を理由付きで前に出す。
 *   該当が無ければセクションごと出さない（空セクションは雑音）。
 */

/** フォーム種別の表示名。 */
const FORM_LABEL: Record<GuidanceFormType, string> = {
  zoukoma: 'テスト対策 増コマ',
  moshi: '模試',
  mogi: 'Vもぎ・全県模試',
  shukaisu: '週回数の変更',
  youbi: '曜日・時間の変更',
  soudan: 'お客様相談',
};

/** フォーム種別のアイコン。 */
function iconOf(formType: GuidanceFormType) {
  switch (formType) {
    case 'zoukoma':
      return <FlaskConical className="h-4.5 w-4.5" />;
    case 'moshi':
      return <PenLine className="h-4.5 w-4.5" />;
    case 'mogi':
      return <GraduationCap className="h-4.5 w-4.5" />;
    case 'shukaisu':
      return <Repeat className="h-4.5 w-4.5" />;
    case 'youbi':
      return <CalendarDays className="h-4.5 w-4.5" />;
    case 'soudan':
      return <ClipboardList className="h-4.5 w-4.5" />;
  }
}

/** セクション分け（モックの「申し込み」「通塾の変更」「相談・面談」）。 */
type HubSection = 'apply' | 'change' | 'consult';
const SECTION_OF: Record<GuidanceFormType, HubSection> = {
  zoukoma: 'apply',
  moshi: 'apply',
  mogi: 'apply',
  shukaisu: 'change',
  youbi: 'change',
  soudan: 'consult',
};
const SECTION_LABEL: Record<HubSection, string> = {
  apply: '申し込み',
  change: '通塾の変更',
  consult: '相談・面談',
};

export function FormsHub() {
  const [guidance, setGuidance] = useState<FormGuidance | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/mypage/forms');
        const json = await res.json();
        if (!cancelled) setGuidance(res.ok ? (json.guidance ?? null) : null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 通常一覧をセクションごとに束ねる。
  const sections = useMemo(() => {
    const map: Record<HubSection, GuidanceItem[]> = { apply: [], change: [], consult: [] };
    for (const it of guidance?.items ?? []) map[SECTION_OF[it.formType]].push(it);
    return map;
  }, [guidance]);

  // プッシュは生徒ごとにまとめる（兄弟が居ると「誰宛か」が分からなくなるため）。
  const pushesByStudent = useMemo(() => {
    const map = new Map<string, { name: string; items: FormGuidance['pushes'] }>();
    for (const p of guidance?.pushes ?? []) {
      if (!map.has(p.studentId)) map.set(p.studentId, { name: p.studentName, items: [] });
      map.get(p.studentId)!.items.push(p);
    }
    return Array.from(map.values());
  }, [guidance]);

  if (loading) {
    return <p className="py-8 text-center text-sm text-text-muted">読み込み中…</p>;
  }

  const hasAnything =
    pushesByStudent.length > 0 || Object.values(sections).some((s) => s.length > 0);
  if (!hasAnything) {
    return (
      <div className="rounded-xl border border-border bg-surface-raised p-4 text-sm text-text-muted">
        現在お手続きいただけるものはありません。
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {/* あなた宛のご案内（該当が無ければセクションごと出さない） */}
      {pushesByStudent.map((group) => (
        <div key={group.name} className="space-y-2.5">
          <div className="mt-1.5 px-0.5 text-[11px] font-bold tracking-wider text-primary-dark">
            {group.name}さんへのご案内
          </div>
          {group.items.map((p) => (
            <a
              key={`${p.studentId}-${p.formType}-${p.periodKey}`}
              href={p.href}
              className="flex items-center gap-3 rounded-2xl border-[1.5px] border-primary bg-primary-subtle px-3.5 py-3 transition-opacity hover:opacity-90"
            >
              <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] bg-primary text-text-on-primary">
                {iconOf(p.formType)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5 text-[13.5px] font-bold text-text-heading">
                  {FORM_LABEL[p.formType]}
                  <span className="rounded-full bg-primary px-2 py-0.5 text-[9.5px] font-bold text-text-on-primary">
                    お申し込みください
                  </span>
                </div>
                <div className="truncate text-[11.5px] text-text-muted">{p.title}</div>
                <div className="mt-0.5 text-[11px] font-semibold text-primary-dark">{p.reason}</div>
              </div>
              <ChevronRight className="h-4 w-4 flex-none text-text-faint" />
            </a>
          ))}
        </div>
      ))}

      {/* 通常一覧 */}
      {(['apply', 'change', 'consult'] as HubSection[]).map((sec) =>
        sections[sec].length === 0 ? null : (
          <div key={sec} className="space-y-2.5">
            <div className="mt-1.5 px-0.5 text-[11px] font-bold tracking-wider text-text-faint">
              {SECTION_LABEL[sec]}
            </div>
            {sections[sec].map((it) => (
              <HubCard key={`${it.studentId}-${it.formType}-${it.periodKey}`} item={it} />
            ))}
          </div>
        )
      )}

      {/* 面談予約は当面お知らせのGoogleカレンダー予約リンクで代替（§5-4）。
          セルフ予約(INQ系)の接続は作り込み段階。 */}
    </div>
  );
}

/** 通常一覧のカード。受付終了は遷移させない（申込できないため）。 */
function HubCard({ item }: { item: GuidanceItem }) {
  const isEnded = item.status === 'ended';

  const inner = (
    <>
      <span
        className={`flex h-9 w-9 flex-none items-center justify-center rounded-[10px] ${
          SECTION_OF[item.formType] === 'change'
            ? 'bg-ink-subtle text-ink'
            : 'bg-primary-subtle text-primary-dark'
        }`}
      >
        {iconOf(item.formType)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5 text-[13.5px] font-bold text-text-heading">
          {FORM_LABEL[item.formType]}
          {isEnded ? (
            <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[9.5px] font-bold text-text-faint">
              受付終了
            </span>
          ) : (
            <span className="rounded-full bg-success-subtle px-2 py-0.5 text-[9.5px] font-bold text-success">
              受付中
            </span>
          )}
        </div>
        <div className="truncate text-[11.5px] text-text-muted">
          {item.studentName} ・ {item.title}
        </div>
      </div>
      {!isEnded && <ChevronRight className="h-4 w-4 flex-none text-text-faint" />}
    </>
  );

  const cls =
    'flex items-center gap-3 rounded-2xl border border-border-subtle bg-surface-raised px-3.5 py-3';

  if (isEnded) {
    return <div className={`${cls} opacity-60`}>{inner}</div>;
  }
  return (
    <a href={item.href} className={`${cls} transition-colors hover:bg-surface-hover`}>
      {inner}
    </a>
  );
}
