'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { UserMinus } from 'lucide-react';
import type { Student } from '@/types/database';
import { STATUS_LABELS } from '@/types/database';
import { formatGradeLabelOrEmpty } from '@/lib/utils/gradeLabel';
import { getStudentSubjects } from '@/lib/api/subjects';
import { useMasterData } from '@/contexts/MasterDataContext';
import { HubSection } from './HubSection';

interface BasicInfoCardProps {
  student: Student;
}

/** 'YYYY-MM-DD' を '2026/9/30' にする（生徒詳細モーダルと同じ表記） */
function formatJaDate(date: string): string {
  const [y, m, d] = date.split('-');
  if (!y || !m || !d) return date;
  return `${y}/${Number(m)}/${Number(d)}`;
}

function Empty() {
  return <span className="text-text-faint">未登録</span>;
}

/**
 * 基本情報（右カラム）。
 *
 * ★students に実在する列だけを出す。生年月日・住所・電話・メール・保護者氏名・入会日は
 *   NEST に列が無いので出さない（docs/student-hub-plan.md §4）。枠だけ作ると「入れる場所がある」と
 *   誤解されるため、ラベルも置かない。
 */
export function BasicInfoCard({ student }: BasicInfoCardProps) {
  const { subjects } = useMasterData();
  const [subjectIds, setSubjectIds] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getStudentSubjects(student.id)
      .then((rows) => {
        if (!cancelled) setSubjectIds(rows.map((r) => r.subject_id));
      })
      .catch(() => {
        if (!cancelled) setSubjectIds([]);
      });
    return () => {
      cancelled = true;
    };
  }, [student.id]);

  const subjectNames = useMemo(() => {
    if (!subjectIds) return null;
    const byId = new Map<string, string>(subjects.map((s) => [s.id, s.name] as [string, string]));
    return subjectIds.map((id) => byId.get(id)).filter((n): n is string => !!n);
  }, [subjectIds, subjects]);

  const kana = `${student.last_name_kana} ${student.first_name_kana}`.trim();
  const rows: { label: string; value: ReactNode }[] = [
    {
      label: '生徒コード',
      value: student.student_code ? (
        <span className="font-mono">{student.student_code}</span>
      ) : (
        <Empty />
      ),
    },
    { label: 'かな', value: kana || <Empty /> },
    { label: '学年', value: formatGradeLabelOrEmpty(student.grade) || <Empty /> },
    { label: '通学校', value: student.school_name || <Empty /> },
    { label: 'クラス', value: student.class_name || <Empty /> },
    { label: '部活', value: student.club || <Empty /> },
    {
      label: '受講科目',
      value:
        subjectNames === null ? (
          <span className="text-text-faint">…</span>
        ) : subjectNames.length === 0 && !student.subject_other ? (
          <Empty />
        ) : (
          <span className="flex flex-wrap gap-1">
            {subjectNames.map((n) => (
              // 科目は分類なので色を持たせず枠線だけ（状態ではない）
              <span
                key={n}
                className="rounded-full border border-border px-[7px] text-[11px] leading-[1.6]"
              >
                {n}
              </span>
            ))}
            {student.subject_other && <span>{student.subject_other}</span>}
          </span>
        ),
    },
    // 兄弟は students に有無（is_sibling）しか無い。誰が兄弟かは持っていないので名前は出せない
    { label: '兄弟', value: student.is_sibling ? 'あり' : 'なし' },
  ];

  return (
    <HubSection
      id="sec-basic"
      title="基本情報"
      detailHref={`/students?edit=${student.id}`}
      detailLabel="編集"
    >
      <dl className="m-0 grid grid-cols-[74px_minmax(0,1fr)] text-[13px] leading-[1.55]">
        {rows.map((r, i) => (
          <div key={r.label} className="contents">
            <dt
              className={`py-0.5 text-text-muted ${i < rows.length - 1 ? 'border-b border-border-subtle' : ''}`}
            >
              {r.label}
            </dt>
            <dd
              className={`m-0 py-0.5 text-text-body [overflow-wrap:anywhere] ${
                i < rows.length - 1 ? 'border-b border-border-subtle' : ''
              }`}
            >
              {r.value}
            </dd>
          </div>
        ))}
      </dl>

      {/* 在籍状況: 退塾登録の入口。ヘッダーの在籍ピルは一目確認用、こちらは操作用 */}
      <div className="mt-2.5 rounded-r-md border-l-2 border-success bg-surface-hover px-2.5 py-2">
        <div className="mb-1 text-[13px] font-bold text-text-heading">在籍状況</div>
        <div className="flex items-baseline gap-1.5 text-[13px]">
          <span className="min-w-[62px] shrink-0 text-xs text-text-muted">現在</span>
          <span>{STATUS_LABELS[student.status]}</span>
        </div>
        <div className="flex items-baseline gap-1.5 text-[13px]">
          <span className="min-w-[62px] shrink-0 text-xs text-text-muted">退塾予定日</span>
          {student.withdrawal_date ? (
            // 退塾予定は対応が要る情報なので色を付ける（間近の生徒に気づけるように）
            <span className="font-medium text-warning">
              {formatJaDate(student.withdrawal_date)}
            </span>
          ) : (
            <span className="text-text-muted">未登録</span>
          )}
        </div>
        {/* 退塾の登録は既存の編集画面で行う（退塾予定日の欄がそこにある）。ここは入口だけ */}
        <Link
          href={`/students?edit=${student.id}`}
          className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-[3px] text-xs text-text-body hover:bg-surface-hover"
        >
          <UserMinus className="h-3.5 w-3.5" aria-hidden="true" />
          退塾を登録
        </Link>
        <p className="mb-0 mt-1.5 text-xs leading-[1.6] text-text-muted">
          {/* 文言は生徒詳細モーダルの退塾予定の説明に揃える（画面によって言い方が違うと迷う） */}
          予定日以降は座席表の生成から外れ、翌日に「退会」へ切り替わります。
        </p>
      </div>
    </HubSection>
  );
}
