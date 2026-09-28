'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FileText, ListChecks, MessageSquare, MessageSquarePlus, Pencil } from 'lucide-react';
import type { Student } from '@/types/database';
import { STATUS_LABELS } from '@/types/database';
import { formatGradeLabelOrEmpty } from '@/lib/utils/gradeLabel';
import { getRegularPatterns, getStudentScheduleEntries } from '@/lib/api/schedule';
import { V2Tag } from './V2Tag';
import { HUB_HEADER_OFFSET, HUB_SECTIONS } from './sections';
import { summarizeAttendance, summarizeRecentTeachers, toDateStr } from './hubSummary';

interface HubHeaderProps {
  student: Student;
  schoolName: string | null;
}

/** 在籍状態のピル。在籍は緑、休会は黄（戻るか確かめる対象）、退会は無彩色（もう手を離れている） */
const STATUS_PILL: Record<Student['status'], string> = {
  active: 'border-success bg-success-subtle text-success',
  inactive: 'border-warning bg-warning-subtle text-warning',
  withdrawn: 'border-border bg-surface-hover text-text-muted',
};

/** 担当を拾う期間。直近8週の授業から新しい順に拾う（長くすると辞めた講師まで並ぶ） */
const TEACHER_LOOKBACK_DAYS = 56;

const btnClass =
  'inline-flex items-center gap-[5px] rounded-md border border-border bg-surface px-2.5 py-[5px] text-xs leading-[1.4] text-text-body hover:bg-surface-hover';

/**
 * 生徒ハブの固定ヘッダー（3行）。
 *   1行目: パンくず・登録日・操作ボタン
 *   2行目: 氏名と、その生徒を一目で掴むための項目
 *   3行目: セクションの目次（スクロールに追従して現在地を示す）
 * ★sticky にするのはこのヘッダーだけ。右カラムまで追従させたら「スクロールが連動しない」と不評だった。
 */
export function HubHeader({ student, schoolName }: HubHeaderProps) {
  const [teachers, setTeachers] = useState<string[]>([]);
  const [attendance, setAttendance] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string>(HUB_SECTIONS[0].id);

  // 担当（座席表の直近の講師）と通塾（今日有効な通常授業の通塾日程）。
  // 取れなくてもヘッダーは出す。失敗した項目は出さないだけ（「取れなければ出さない」）。
  useEffect(() => {
    let cancelled = false;
    const today = new Date();
    const from = new Date(today);
    from.setDate(from.getDate() - TEACHER_LOOKBACK_DAYS);
    const todayStr = toDateStr(today);
    (async () => {
      const [entries, patterns] = await Promise.all([
        // ★教室で絞らない関数を使う。他教室の振替・講習もその生徒の授業（#196 の判断）
        getStudentScheduleEntries(student.id, toDateStr(from), todayStr).catch(() => []),
        getRegularPatterns(student.school_id, {
          studentId: student.id,
          periodType: 'regular',
          asOfDate: todayStr,
        }).catch(() => []),
      ]);
      if (cancelled) return;
      setTeachers(summarizeRecentTeachers(entries));
      setAttendance(summarizeAttendance(patterns));
    })();
    return () => {
      cancelled = true;
    };
  }, [student.id, student.school_id]);

  // 目次の現在地。判定線（ヘッダーの下端）より上に見出しが来た最後のセクションを現在地にする。
  // 最下部まで来たら最後のセクションにする（短いセクションが判定線に届かず、永遠に選ばれないのを防ぐ）。
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      let current: string = HUB_SECTIONS[0].id;
      for (const s of HUB_SECTIONS) {
        const el = document.getElementById(s.id);
        if (!el) continue;
        if (el.getBoundingClientRect().top - HUB_HEADER_OFFSET <= 8) current = s.id;
      }
      const atBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      if (atBottom) current = HUB_SECTIONS[HUB_SECTIONS.length - 1].id;
      setActiveId(current);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  const fullName = `${student.last_name} ${student.first_name}`;
  const kana = `${student.last_name_kana} ${student.first_name_kana}`.trim();
  const gradeLabel = formatGradeLabelOrEmpty(student.grade);
  const registered = student.created_at ? student.created_at.slice(0, 10) : null;

  const scrollToInterview = () => {
    document.getElementById('sec-interview')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    // AdminLayout の左右・上の余白を打ち消して端まで背景を敷く（下を流れる本文が透けないように）
    <header className="sticky top-0 z-30 -mx-4 -mt-6 mb-5 border-b border-border bg-bg px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 print:static">
      {/* 1行目: パンくず + 操作 */}
      <div className="flex flex-nowrap items-center gap-2 pt-[7px]">
        <div className="whitespace-nowrap text-xs text-text-muted">
          <Link href="/students" className="hover:underline">
            生徒管理
          </Link>
          <span className="mx-1.5 text-text-faint">›</span>
          <b className="font-medium text-text-body">{fullName}</b>
        </div>
        {/* 登録日は専用の行を作らずパンくずの隣に小さく置く。1行に収まらない幅では落とす */}
        {registered && (
          <span className="hidden whitespace-nowrap text-[11px] text-text-faint min-[1180px]:inline">
            <span className="mr-2 text-text-faint">|</span>登録{' '}
            <span className="font-mono">{registered}</span>
          </span>
        )}
        {/* 並びは授業の前後によく使う順。進行表と報告書は授業のたび、面談は月単位、編集はまれ。
            ボタンは名詞だけにし、何が起きるかは title に書く（ヘッダーを1行に収めるため） */}
        <div className="ml-auto flex flex-wrap gap-1.5">
          <Link href={`/students/${student.id}/progress`} className={btnClass} title="進行表を開く">
            <ListChecks className="h-3.5 w-3.5" aria-hidden="true" />
            進行表
          </Link>
          <Link
            href={`/students/${student.id}/lesson-reports`}
            className={btnClass}
            title="授業報告書の一覧を開く"
          >
            <FileText className="h-3.5 w-3.5" aria-hidden="true" />
            報告書
          </Link>
          <button
            type="button"
            onClick={scrollToInterview}
            className={btnClass}
            title="このページの面談欄へ移動（面談記録の追加・Notta取込はそこから）"
          >
            <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden="true" />
            面談記録
          </button>
          <Link
            href={`/interview?studentId=${student.id}`}
            className={btnClass}
            title="面談を始める（面談の画面を開く）"
          >
            <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
            面談
          </Link>
          {/* 1100px 未満ではボタンが2行に折り返してヘッダーが膨らむので、使う頻度の低い編集だけ
              ラベルを外してアイコンにする（aria-label と title に名前を残す） */}
          <Link
            href={`/students?edit=${student.id}`}
            className={`${btnClass} max-[1099px]:px-[7px]`}
            title="生徒情報を編集（生徒一覧の編集画面を開く）"
            aria-label="編集"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="max-[1099px]:hidden">編集</span>
          </Link>
        </div>
      </div>

      {/* 2行目: 氏名と一目で掴む項目 */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pb-[5px] pt-[3px] max-[1199px]:gap-x-[11px]">
        <span className="text-[21px] font-bold tracking-[0.01em] text-text-heading">
          {fullName}
        </span>
        {kana && <span className="text-xs text-text-muted">{kana}</span>}
        {/* 生徒コードはここに出さない（基本情報にある）。名前の横では読まれず、目の邪魔になる（2026-09-28 指摘） */}
        <span className="text-border-strong">|</span>
        {gradeLabel && <b className="text-xs font-medium text-text-body">{gradeLabel}</b>}
        {student.school_name && (
          <span className="whitespace-nowrap text-xs text-text-muted">{student.school_name}</span>
        )}
        <span
          className={`inline-flex items-center rounded-full border px-2 text-[11px] font-medium leading-[1.6] ${STATUS_PILL[student.status]}`}
        >
          {STATUS_LABELS[student.status]}
        </span>
        {schoolName && (
          <span className="whitespace-nowrap text-xs text-text-muted">
            教室 <b className="font-medium text-text-body">{schoolName}</b>
          </span>
        )}
        {/* 担当は座席表由来（schedule_entries の直近の講師）。fixed_teacher_ids は希望なので使わない */}
        {teachers.length > 0 && (
          <span className="inline-flex items-baseline gap-1 whitespace-nowrap text-xs text-text-muted">
            担当 <b className="font-medium text-text-body">{teachers.join('・')}</b>
            <V2Tag compact />
          </span>
        )}
        {attendance && (
          <span className="whitespace-nowrap text-xs text-text-muted">
            通塾 <b className="font-medium text-text-body">{attendance}</b>
          </span>
        )}
      </div>

      {/* 3行目: 目次 */}
      <nav className="overflow-x-auto" aria-label="セクション目次">
        <ul className="flex list-none gap-0.5 whitespace-nowrap">
          {HUB_SECTIONS.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                aria-current={activeId === s.id ? 'location' : undefined}
                className={`block border-b-2 px-[9px] pb-1.5 pt-[5px] text-xs ${
                  activeId === s.id
                    ? 'border-ink font-medium text-ink'
                    : 'border-transparent text-text-muted hover:bg-surface-hover hover:text-text-body'
                }`}
              >
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
