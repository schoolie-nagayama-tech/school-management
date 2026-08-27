'use client';

/**
 * 入会オンボーディング（教室長向け）＝生徒基本情報の確認だけを行うページ。
 *
 * 通塾日程の登録は生徒詳細に一本化（正典）。ここは基本情報の確認のみ。
 * かつては受講科目・コマ配置・担当決定までを 1 画面のウィザード（Step2〜4）で
 * 行っていたが、入り口が二重になって混乱を招くため廃止した。
 *
 * 入口:
 *  1. 問合せ詳細「生徒として登録」→ 生徒作成後 `/students/[id]/onboarding?inquiryId=...` へ遷移
 *  2. 生徒詳細（StudentDetailModal）に「通塾セットアップ」導線（通塾日程 0 件のときのみ表示）
 *
 * 流れ:
 *  生徒情報の確認（主要6項目のインライン編集・即時 updateStudent）
 *  → `/students/[id]/schedule?onboarding=1` へ送り、通塾日程・教材発注へ続ける。
 * inquiryId は「問合せから転記済み」バッジの表示にのみ使う。
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { AdminLayout } from '@/components/layouts';
import { Loading, Button } from '@/components/ui';
import { useAuth } from '@/contexts/AuthContext';
import AccessDenied from '@/components/AccessDenied';
import { isManagerOrAbove } from '@/lib/utils/roles';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';
import { getStudent, updateStudent } from '@/lib/api/students';
import type { Student } from '@/types/database';
import { ArrowRight } from 'lucide-react';
import { formatGradeLabel } from '@/lib/utils/gradeLabel';
import { toKatakana } from '@/lib/utils/kana';

export default function OnboardingPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const studentId = params.studentId as string;
  const inquiryId = searchParams.get('inquiryId');

  const { profile, schoolIds } = useAuth();
  const isManager = isManagerOrAbove(profile?.role);

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [student, setStudent] = useState<Student | null>(null);

  // ---- 生徒情報のインライン編集 ----
  const [lastName, setLastName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastKana, setLastKana] = useState('');
  const [firstKana, setFirstKana] = useState('');
  const [grade, setGrade] = useState<number>(7);
  const [schoolName, setSchoolName] = useState('');
  const [isSavingStudent, setIsSavingStudent] = useState(false);

  // ---- 初期ロード ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setLoadError('');
      try {
        const stu = await getStudent(studentId, schoolIds.length > 0 ? schoolIds : undefined);
        if (cancelled) return;
        if (!stu) {
          setLoadError('生徒が見つかりません');
          return;
        }

        setStudent(stu);
        setLastName(stu.last_name ?? '');
        setFirstName(stu.first_name ?? '');
        setLastKana(stu.last_name_kana ?? '');
        setFirstKana(stu.first_name_kana ?? '');
        setGrade(stu.grade ?? 7);
        setSchoolName(stu.school_name ?? '');
      } catch (err) {
        if (!cancelled) setLoadError(getUserErrorMessage(err, 'データの取得に失敗しました'));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [studentId, schoolIds]);

  // ---- 生徒情報の即時保存 ----
  const saveStudentInfo = useCallback(async () => {
    if (!student) return;
    setIsSavingStudent(true);
    try {
      const updated = await updateStudent(student.id, {
        last_name: lastName.trim() || student.last_name,
        first_name: firstName.trim(),
        // 問合せから転記された値は入力欄を経由しないため、保存時にも必ず揃える
        last_name_kana: toKatakana(lastKana.trim()),
        first_name_kana: toKatakana(firstKana.trim()),
        grade,
        school_name: schoolName.trim() || null,
      });
      setStudent(updated);
      toast.success('生徒情報を保存しました');
      return true;
    } catch (err) {
      toast.error(getUserErrorMessage(err, '生徒情報の保存に失敗しました'));
      return false;
    } finally {
      setIsSavingStudent(false);
    }
  }, [student, lastName, firstName, lastKana, firstKana, grade, schoolName]);

  // 完了処理。
  //
  // 入会の流れは「生徒情報 → 授業スケジュール → 教材発注 → 生徒詳細」。
  // ?onboarding=1 を付けて遷移先に「入会フローの途中」であることを伝え、
  // 次の一手（発注へ進む / あとで）を出す。どちらもスキップ可。
  const handleFinish = useCallback(async () => {
    const ok = await saveStudentInfo();
    if (ok === false) return;
    toast.success('生徒登録が完了しました');
    router.push(`/students/${studentId}/schedule?onboarding=1`);
  }, [saveStudentInfo, router, studentId]);

  // ---- 権限・ローディング ----
  if (profile === null) {
    return (
      <AdminLayout headerTitle="通塾セットアップ">
        <Loading className="min-h-[60vh]" />
      </AdminLayout>
    );
  }
  if (!isManager) {
    return (
      <AdminLayout>
        <AccessDenied message="通塾セットアップは教室長以上のみ利用できます" />
      </AdminLayout>
    );
  }

  return (
    <AdminLayout
      headerTitle="通塾セットアップ"
      documentTitle={
        student
          ? `${student.last_name} ${student.first_name}｜通塾セットアップ`
          : '通塾セットアップ'
      }
    >
      <div className="max-w-5xl mx-auto pb-24">
        {loadError && (
          <div className="mb-4 p-4 bg-danger/20 border border-danger rounded-lg">
            <p className="text-sm text-danger">{loadError}</p>
          </div>
        )}

        {isLoading ? (
          <Loading size="md" />
        ) : !student ? null : (
          <>
            <div className="bg-surface-raised border border-border rounded-xl p-6 min-h-[360px]">
              <div className="space-y-5">
                <div>
                  <h2 className="text-base font-bold text-text-heading mb-1">生徒情報の確認</h2>
                  <p className="text-xs text-text-muted">
                    主要項目をその場で修正できます。詳細な編集は
                    <Link
                      href={`/students/${studentId}/schedule`}
                      className="text-info hover:underline mx-1"
                    >
                      生徒ページ
                    </Link>
                    から行えます。
                    {inquiryId && (
                      <span className="ml-1 inline-block px-2 py-0.5 rounded-full bg-info-subtle text-info text-[11px]">
                        問合せから転記済み
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-text-muted mt-1">
                    受講科目・通塾日程・担当講師は、次の「授業スケジュール」画面で登録します。
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="block text-xs text-text-muted">姓</label>
                    <input
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface-raised focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs text-text-muted">名</label>
                    <input
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface-raised focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs text-text-muted">セイ（フリガナ）</label>
                    <input
                      value={lastKana}
                      // 検索・並び替えがカナ依存のため、ひらがなで入力されても揃える
                      onChange={(e) => setLastKana(toKatakana(e.target.value))}
                      placeholder="ヤマダ"
                      className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface-raised focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs text-text-muted">メイ（フリガナ）</label>
                    <input
                      value={firstKana}
                      onChange={(e) => setFirstKana(toKatakana(e.target.value))}
                      placeholder="タロウ"
                      className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface-raised focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs text-text-muted">学年</label>
                    <select
                      value={grade}
                      onChange={(e) => setGrade(parseInt(e.target.value, 10))}
                      className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface-raised focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((g) => (
                        <option key={g} value={g}>
                          {formatGradeLabel(g)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs text-text-muted">在籍校（通学先）</label>
                    <input
                      value={schoolName}
                      onChange={(e) => setSchoolName(e.target.value)}
                      placeholder="例：〇〇中学校"
                      className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface-raised focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end mt-6">
              <Button onClick={handleFinish} disabled={isSavingStudent}>
                {isSavingStudent ? '保存中...' : '登録して生徒詳細へ'}
                <ArrowRight className="w-4 h-4 ml-1.5" />
              </Button>
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
