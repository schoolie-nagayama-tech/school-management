'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Modal, Button, Loading } from '@/components/ui';
import { getDefaultSchoolId } from '@/lib/api/schools';
import { countActiveRegularPatterns } from '@/lib/api/schedule';
import { listAssessments } from '@/lib/api/assessments';
import type { Student, AssessmentWithScores } from '@/types/database';
import {
  GENDER_LABELS,
  GRADE_LABELS,
  STATUS_LABELS,
  STATUS_COLORS,
  ASSESSMENT_NAME_LABELS,
  SUBJECT_LABELS,
} from '@/types/database';
import { InterviewList } from './InterviewList';
import { AttendanceMatrix } from './AttendanceMatrix';
import { StudentScheduleCalendar } from './StudentScheduleCalendar';
import { StudentKoushuTab } from './StudentKoushuTab';
import { PortalInviteSection } from './PortalInviteSection';
import { StudentTextbooksManager, useStudentTextbooksManager } from './StudentTextbooksManager';
import { useAuth } from '@/contexts/AuthContext';
import { useConfirm } from '@/hooks/useConfirm';
import { isManagerOrAbove } from '@/lib/utils/roles';

/** 'YYYY-MM-DD' を '2026/9/30' にする（ゼロ埋めを外して読みやすくする） */
function formatJaDate(date: string): string {
  const [y, m, d] = date.split('-');
  if (!y || !m || !d) return date;
  return `${y}/${Number(m)}/${Number(d)}`;
}
import { ExternalLink, CalendarPlus, MessageSquarePlus, ArrowRight } from 'lucide-react';
import Link from 'next/link';

interface StudentDetailModalProps {
  isOpen: boolean;
  student: Student | null;
  onClose: () => void;
  onEdit: (student: Student) => void;
  /** 削除（論理削除） */
  onDelete?: (student: Student) => Promise<void>;
}

type TabType = 'basic' | 'scores' | 'interviews' | 'schedule' | 'calendar' | 'koushu';

// assessments の学年→ラベルのためのサブジェクト列
const FIVE_SUBJECTS = ['english', 'math', 'japanese', 'social', 'science'] as const;

function formatScoreRow(a: AssessmentWithScores): {
  label: string;
  subjects: Array<{ code: string; value: number | null }>;
  total: number | null;
} {
  const map = new Map<string, number | null>();
  for (const s of a.scores) map.set(s.subject, s.value);
  const subjects = FIVE_SUBJECTS.map((code) => ({ code, value: map.get(code) ?? null }));
  const totals = subjects.map((s) => s.value).filter((v): v is number => v != null);
  const total = totals.length > 0 ? totals.reduce((a, b) => a + b, 0) : null;
  const label = ASSESSMENT_NAME_LABELS[a.name_code] ?? a.name_code;
  return { label, subjects, total };
}

export function StudentDetailModal({
  isOpen,
  student,
  onClose,
  onEdit,
  onDelete,
}: StudentDetailModalProps) {
  const { profile } = useAuth();
  const router = useRouter();
  const { confirm, ConfirmDialog } = useConfirm();
  const isTeacher = profile?.role === 'teacher';
  // 面談ワークスペースへの導線は室長以上のみ（面談ワークスペース自体が室長以上限定のページのため）
  const canStartInterview = isManagerOrAbove(profile?.role);
  // 生徒ハブ（/students/[id]）は教室長以上のページなので、「ページで開く」も教室長以上だけに出す
  const canOpenHub = isManagerOrAbove(profile?.role);
  // 入会オンボーディング導線: 通塾日程が0件の生徒にだけ「通塾セットアップ」ボタンを出す。
  const [hasPatterns, setHasPatterns] = useState<boolean | null>(null);
  // 教材の状態・取得・操作（ハブと共用のフック）。
  // ★タブの中ではなくモーダルのこの階層で呼ぶ。表示部品は基本情報タブの中にしか無いので、
  //   状態を部品に持たせるとタブを移るたびに取り直し・科目の選択の初期化が起きる（講師の画面が変わる）。
  //   取得の開始も以前と同じ「開いていて生徒がいる」とき（タブに関係なく）。
  const textbooksManager = useStudentTextbooksManager({ student, enabled: isOpen });
  const [activeTab, setActiveTab] = useState<TabType>('basic');
  const schoolId = getDefaultSchoolId();

  // 成績タブ用
  const [assessments, setAssessments] = useState<AssessmentWithScores[]>([]);
  const [isLoadingScores, setIsLoadingScores] = useState(false);

  const tabs: { key: TabType; label: string }[] = [
    { key: 'basic', label: '基本情報' },
    { key: 'scores', label: '成績' },
    ...(isTeacher ? [] : [{ key: 'schedule' as const, label: '通塾日程' }]),
    // 予定表（月カレンダー）も通塾日程と同じく講師には出さない
    ...(isTeacher ? [] : [{ key: 'calendar' as const, label: '予定表' }]),
    // 講習タブは全ロールに表示（その生徒の講習提案・申込の簡易まとめ）
    { key: 'koushu', label: '講習' },
    { key: 'interviews', label: '面談記録' },
  ];

  // 通塾日程の有無を軽量チェック（0件なら「通塾セットアップ」導線を出す）。教室長以上のみ。
  useEffect(() => {
    if (isOpen && student && !isTeacher) {
      setHasPatterns(null);
      countActiveRegularPatterns(student.id)
        .then((n) => setHasPatterns(n > 0))
        .catch(() => setHasPatterns(true)); // 取得失敗時はボタンを出さない（安全側）
    } else {
      setHasPatterns(null);
    }
  }, [isOpen, student, isTeacher]);

  // 成績データを読み込み（成績タブに切り替えたときに取得）
  useEffect(() => {
    if (!isOpen || !student || activeTab !== 'scores') return;
    setIsLoadingScores(true);
    listAssessments(student.id)
      .then(setAssessments)
      .catch(() => setAssessments([]))
      .finally(() => setIsLoadingScores(false));
  }, [isOpen, student, activeTab]);

  // 最新1件ずつ（カテゴリ別）
  const latestByCategory = useMemo(() => {
    const groups: Record<'regular_test' | 'report_card' | 'mock', AssessmentWithScores | null> = {
      regular_test: null,
      report_card: null,
      mock: null,
    };
    for (const a of assessments) {
      const cat = a.category as 'regular_test' | 'report_card' | 'mock';
      const existing = groups[cat];
      if (!existing) {
        groups[cat] = a;
        continue;
      }
      // 学年→月の新しい順
      const keyNew = `${String(a.grade).padStart(2, '0')}-${a.exam_month ?? '0000-00'}`;
      const keyOld = `${String(existing.grade).padStart(2, '0')}-${existing.exam_month ?? '0000-00'}`;
      if (keyNew > keyOld) groups[cat] = a;
    }
    return groups;
  }, [assessments]);

  if (!student) return null;

  const handleEdit = () => {
    onEdit(student);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="生徒詳細" size="2xl">
      <div className="space-y-6">
        {/* 生徒ハブ（/students/[id]）への入口。教室長以上だけ。
            座席表・入会申込・請求・講習進行表など、生徒一覧以外からこのモーダルを開いたときの入口になる。
            ★講師には出さない（ハブは教室長以上のページで、講師の画面は今のまま変えない決定） */}
        {canOpenHub && student && (
          <div className="-mb-3 flex justify-end">
            <Link
              href={`/students/${student.id}`}
              onClick={onClose}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              ページで開く
              <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </Link>
          </div>
        )}
        {/* タブ */}
        <div className="flex border-b border-[#e5e7eb] -mx-6 px-6">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-[color,border-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] ${
                activeTab === tab.key
                  ? 'border-[#3b82f6] text-[#3b82f6]'
                  : 'border-transparent text-[#4b5563] hover:text-[#1f2937]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* タブコンテンツ */}
        {activeTab === 'basic' && (
          <>
            {/* 基本情報 */}
            <div>
              <h3 className="text-sm font-semibold text-[#1f2937] mb-3">基本情報</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-[#4b5563]">在籍状況</label>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span
                      className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${STATUS_COLORS[student.status]}`}
                    >
                      {STATUS_LABELS[student.status]}
                    </span>
                    {/* 退塾予定日は「在籍中だが、いつまで」を決める情報なので在籍状況の隣に出す。
                        編集画面を開かないと分からないと、退塾間近の生徒に気づけないため。 */}
                    {student.withdrawal_date && (
                      <span
                        className="inline-flex px-2 py-1 text-xs font-medium rounded-full bg-amber-100 text-amber-800"
                        title="この日以降は座席表生成・5週目請求から除外され、翌日に「退会」へ切り替わります"
                      >
                        退塾予定 {formatJaDate(student.withdrawal_date)}
                      </span>
                    )}
                  </div>
                </div>
                <div>
                  <label className="text-xs text-[#4b5563]">氏名</label>
                  <p className="mt-1 text-sm text-[#1f2937]">
                    {student.last_name} {student.first_name}
                  </p>
                </div>
                <div>
                  <label className="text-xs text-[#4b5563]">フリガナ</label>
                  <p className="mt-1 text-sm text-[#4b5563]">
                    {student.last_name_kana} {student.first_name_kana}
                  </p>
                </div>
                <div>
                  <label className="text-xs text-[#4b5563]">学年</label>
                  <p className="mt-1 text-sm text-[#1f2937]">
                    {GRADE_LABELS[student.grade] || student.grade}
                  </p>
                </div>
                <div>
                  <label className="text-xs text-[#4b5563]">性別</label>
                  <p className="mt-1 text-sm text-[#1f2937]">
                    {student.gender ? (
                      GENDER_LABELS[student.gender]
                    ) : (
                      <span className="text-text-faint">未設定</span>
                    )}
                  </p>
                </div>
              </div>
            </div>

            {/* 学校情報 */}
            {(student.school_name || student.class_name || student.club) && (
              <div>
                <h3 className="text-sm font-semibold text-[#1f2937] mb-3">学校情報</h3>
                <div className="grid grid-cols-2 gap-4">
                  {student.school_name && (
                    <div>
                      <label className="text-xs text-[#4b5563]">学校名</label>
                      <p className="mt-1 text-sm text-[#1f2937]">{student.school_name}</p>
                    </div>
                  )}
                  {student.class_name && (
                    <div>
                      <label className="text-xs text-[#4b5563]">クラス</label>
                      <p className="mt-1 text-sm text-[#1f2937]">{student.class_name}</p>
                    </div>
                  )}
                  {student.club && (
                    <div className="col-span-2">
                      <label className="text-xs text-[#4b5563]">部活</label>
                      <p className="mt-1 text-sm text-[#1f2937]">{student.club}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 所持教材・発注中・進行表で管理中・未分類（ハブと共用の部品。講師の出し分けも部品の中で同じ判定のまま） */}
            <StudentTextbooksManager manager={textbooksManager} />

            {/* 保護者ポータル招待（admin/owner のみ＝API認可と一致、コンポーネント内で自己判定） */}
            <PortalInviteSection
              studentId={student.id}
              studentName={`${student.last_name} ${student.first_name}`}
            />

            {/* 登録・更新日時 */}
            <div>
              <h3 className="text-sm font-semibold text-[#1f2937] mb-3">登録情報</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-[#4b5563]">登録日時</label>
                  <p className="mt-1 text-sm text-[#1f2937]">
                    {new Date(student.created_at).toLocaleString('ja-JP')}
                  </p>
                </div>
                <div>
                  <label className="text-xs text-[#4b5563]">更新日時</label>
                  <p className="mt-1 text-sm text-[#1f2937]">
                    {new Date(student.updated_at).toLocaleString('ja-JP')}
                  </p>
                </div>
              </div>
            </div>

            {/* アクションボタン */}
            <div className="flex justify-between pt-4 border-t border-[#e5e7eb]">
              <div>
                {!isTeacher && onDelete && (
                  <Button
                    type="button"
                    variant="outline"
                    className="text-red-600 border-red-200 hover:bg-red-50"
                    onClick={async () => {
                      if (
                        !(await confirm({
                          title: '削除確認',
                          description: `${student.last_name} ${student.first_name} を削除しますか？論理削除され、一覧から非表示になります。`,
                          confirmLabel: '削除',
                          variant: 'danger',
                        }))
                      )
                        return;
                      await onDelete(student);
                      onClose();
                    }}
                  >
                    削除
                  </Button>
                )}
              </div>
              <div className="flex gap-3">
                <Button type="button" variant="secondary" onClick={onClose}>
                  閉じる
                </Button>
                {/* 通塾日程が0件の生徒だけに出す「通塾セットアップ」導線（入会オンボーディング） */}
                {!isTeacher && student && hasPatterns === false && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => router.push(`/students/${student.id}/onboarding`)}
                  >
                    <CalendarPlus className="w-4 h-4 mr-1.5" />
                    通塾セットアップ
                  </Button>
                )}
                {!isTeacher && (
                  <Button type="button" onClick={handleEdit}>
                    編集
                  </Button>
                )}
              </div>
            </div>
          </>
        )}

        {activeTab === 'schedule' && !isTeacher && student && (
          <AttendanceMatrix
            studentId={student.id}
            schoolId={student.school_id ?? schoolId}
            studentGrade={student.grade}
            canEdit={!isTeacher}
          />
        )}

        {activeTab === 'calendar' && !isTeacher && student && (
          <StudentScheduleCalendar studentId={student.id} />
        )}

        {activeTab === 'scores' && student && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#1f2937]">最新の成績</h3>
              <a
                href={`/students/${student.id}/scores`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-[#3b82f6] hover:text-[#1e3a5f] hover:underline"
              >
                詳細を別タブで開く <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            {isLoadingScores ? (
              <Loading size="md" />
            ) : (
              <div className="space-y-4">
                {(['regular_test', 'report_card', 'mock'] as const).map((cat) => {
                  const a = latestByCategory[cat];
                  const heading =
                    cat === 'regular_test' ? '定期テスト' : cat === 'report_card' ? '内申' : '模試';
                  if (!a) {
                    return (
                      <div
                        key={cat}
                        className="bg-[#f8fafc] rounded-lg border border-[#e5e7eb] p-3"
                      >
                        <div className="text-xs font-semibold text-[#6b7280] mb-1">{heading}</div>
                        <p className="text-sm text-[#9ca3af]">データなし</p>
                      </div>
                    );
                  }
                  const row = formatScoreRow(a);
                  const gradeLabel = GRADE_LABELS[a.grade] ?? `学年${a.grade}`;
                  return (
                    <div key={cat} className="bg-white rounded-lg border border-[#e5e7eb] p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-xs font-semibold text-[#1e3a5f]">{heading}</div>
                        <div className="text-xs text-[#4b5563]">
                          {gradeLabel}・{row.label}
                          {a.exam_month && ` (${a.exam_month})`}
                        </div>
                      </div>
                      <div className="grid grid-cols-6 gap-1 text-center text-xs">
                        {row.subjects.map((s) => (
                          <div key={s.code}>
                            <div className="text-[10px] text-[#6b7280]">
                              {SUBJECT_LABELS[s.code] ?? s.code}
                            </div>
                            <div className="text-sm font-medium text-[#1f2937]">
                              {s.value ?? '—'}
                            </div>
                          </div>
                        ))}
                        <div>
                          <div className="text-[10px] text-[#6b7280]">5科合計</div>
                          <div className="text-sm font-bold text-[#1e3a5f]">{row.total ?? '—'}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === 'koushu' && student && (
          <div className="h-[60vh] overflow-y-auto pr-2">
            <StudentKoushuTab studentId={student.id} />
          </div>
        )}

        {activeTab === 'interviews' && student && (
          <div className="h-[60vh] overflow-y-auto pr-2">
            {/* 面談ワークスペース（過去の面談・成績・進行表を1画面に集約して当日の面談記録を書く画面）への導線。
                ワークスペース自体が室長以上限定のため、ボタンも室長以上にだけ出す。 */}
            {canStartInterview && (
              <div className="mb-4 flex justify-end">
                <a
                  href={`/interview?studentId=${student.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-ink/80"
                >
                  <MessageSquarePlus className="h-3.5 w-3.5" />
                  面談を始める
                </a>
              </div>
            )}
            <InterviewList studentId={student.id} schoolId={student.school_id ?? schoolId} />
          </div>
        )}
      </div>
      {ConfirmDialog}
    </Modal>
  );
}
