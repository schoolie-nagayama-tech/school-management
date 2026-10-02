'use client';

/**
 * 生徒ハブ（/students/[studentId]）— 生徒1人の情報を1ページに集めたページ。第1段。
 *
 * 正典: docs/student-hub-plan.md ／ 見た目と並び順の正典: public/student-hub-mock.html
 *
 * ★教室長以上だけのページ。講師は生徒一覧へ戻す（講師の画面は今のモーダルのまま一切変えない、
 *   2026-09-28 ユーザー決定）。これは画面の出し分けで、データの守りではない
 *   （講師も成績・面談記録を読む権限とRLSは持っている）。
 * このファイルは組み立てだけにし、各セクションは src/components/students/hub/ に置く。
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { AdminLayout } from '@/components/layouts';
import { Button, Loading, ScrollToTopButton } from '@/components/ui';
import { useAuth } from '@/contexts/AuthContext';
import { useMasterData } from '@/contexts/MasterDataContext';
import { isManagerOrAbove } from '@/lib/utils/roles';
import { getStudent } from '@/lib/api/students';
import type { Student } from '@/types/database';
import { StudentScheduleCalendar } from '@/components/students/StudentScheduleCalendar';
import { AttendanceMatrix } from '@/components/students/AttendanceMatrix';
import { InterviewList } from '@/components/students/InterviewList';
import { StudentKoushuTab } from '@/components/students/StudentKoushuTab';
import { PortalInviteSection } from '@/components/students/PortalInviteSection';
import { HubHeader } from '@/components/students/hub/HubHeader';
import { HubSection } from '@/components/students/hub/HubSection';
import { BasicInfoCard } from '@/components/students/hub/BasicInfoCard';
import { AttentionSection } from '@/components/students/hub/AttentionSection';
import { StatusSection } from '@/components/students/hub/StatusSection';
import { FormResponsesSection } from '@/components/students/hub/FormResponsesSection';
import { LessonReportsSection } from '@/components/students/hub/LessonReportsSection';
import {
  HubDisciplinePanel,
  HubProgressPanel,
  HubScorePanel,
} from '@/components/students/hub/InterviewPanels';
import { V2Tag } from '@/components/students/hub/V2Tag';
import { HubDataProvider } from '@/components/students/hub/HubDataContext';
import { TargetSchoolsSection } from '@/components/students/hub/TargetSchoolsSection';
import { ScheduleSetupNotice } from '@/components/students/hub/ScheduleSetupNotice';
import { SchoolPaceTable } from '@/components/students/hub/SchoolPaceTable';
import { ParentMessagesCard } from '@/components/students/hub/ParentMessagesCard';
import { TextbooksSection } from '@/components/students/hub/TextbooksSection';
import { BillingSection } from '@/components/students/hub/BillingSection';
import { LogsSection } from '@/components/students/hub/LogsSection';

const HEADER_TITLE = '生徒管理';

export default function StudentHubPage() {
  const params = useParams();
  const router = useRouter();
  const studentId = params.studentId as string;
  const { user, profile, isLoading: authLoading, getSelectedSchoolIds } = useAuth();
  const { schools } = useMasterData();

  const canView = isManagerOrAbove(profile?.role);
  // ロールが確定するまで（＝認証の読み込み中・プロフィール未取得）は何も描かない。
  // ★講師に一瞬でも中身を見せないため、判定前にデータ取得も始めない。
  const roleResolved = !authLoading && !!profile;

  const [student, setStudent] = useState<Student | null>(null);
  const [studentLoading, setStudentLoading] = useState(true);

  // 講師（教室長未満）は生徒一覧へ戻す。既存の拒否の型（useRequirePermission）と同じく
  // ?denied=1 を付け、戻った先で「権限がありません」をトーストで伝える。
  useEffect(() => {
    if (!user) return; // ログアウト中は判定しない（ログイン画面への遷移に任せる）
    if (roleResolved && !canView) {
      router.replace('/students?denied=1');
    }
  }, [user, roleResolved, canView, router]);

  useEffect(() => {
    if (!roleResolved || !canView || !studentId) return;
    let cancelled = false;
    setStudentLoading(true);
    (async () => {
      try {
        const schoolIds = getSelectedSchoolIds();
        const s = await getStudent(studentId, schoolIds.length > 0 ? schoolIds : undefined);
        if (!cancelled) setStudent(s);
      } catch (e) {
        console.error('Error fetching student:', e);
        if (!cancelled) setStudent(null);
      } finally {
        if (!cancelled) setStudentLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roleResolved, canView, studentId, getSelectedSchoolIds]);

  if (!roleResolved || !canView) {
    // 講師はここで止まったまま一覧へ戻される。判定前も同じ表示にして中身を出さない
    return (
      <AdminLayout headerTitle={HEADER_TITLE}>
        <Loading className="min-h-[60vh]" />
      </AdminLayout>
    );
  }

  if (studentLoading) {
    return (
      <AdminLayout headerTitle={HEADER_TITLE}>
        <Loading className="min-h-[60vh]" />
      </AdminLayout>
    );
  }

  // 見つからない・選択中の教室の外（getStudent は教室で絞る）は、既存の生徒配下ページと同じ扱い
  if (!student) {
    return (
      <AdminLayout headerTitle={HEADER_TITLE}>
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="text-center">
            <p className="mb-4 text-lg text-danger">生徒が見つかりません</p>
            <Button onClick={() => router.push('/students')}>生徒一覧に戻る</Button>
          </div>
        </div>
      </AdminLayout>
    );
  }

  const fullName = `${student.last_name} ${student.first_name}`;
  const schoolName = schools.find((s) => s.id === student.school_id)?.name ?? null;
  const base = `/students/${student.id}`;

  return (
    <AdminLayout headerTitle={HEADER_TITLE} documentTitle={fullName}>
      <HubHeader student={student} schoolName={schoolName} />

      {/* 成績・志望校・面談記録・宿題遅刻・進行表は複数セクションで使うので、生徒ごとに1回だけ取る（HubDataContext）。
          ★key で生徒が変わったら作り直す（前の生徒のデータを残さない） */}
      <HubDataProvider key={student.id} studentId={student.id}>
        <div className="flex flex-col gap-3 pb-16">
          {/* 上部だけ2カラム（左=今の状態→気にすること の縦積み / 右=基本情報 約300px）。
            1100px 未満で右が下に落ちる（DOM順どおり左が先）。
            ★左に今の状態を置くのは、一番目に入る左上を使うため。気にすることだけだと、注意も約束も無い
              生徒で左が短く、右の基本情報の横が大きく空いていた（2026-09-28 ユーザー指摘）。
            ★sticky にしない。右カラムを追従させたら本文とスクロールが連動しないと不評だった */}
          <div className="grid items-start gap-3 min-[1100px]:grid-cols-[minmax(0,1fr)_300px]">
            <div className="flex min-w-0 flex-col gap-3">
              <StatusSection studentId={student.id} />
              <AttentionSection studentId={student.id} schoolId={student.school_id} />
            </div>
            <BasicInfoCard student={student} />
          </div>

          {/* 通塾日程は最初から読む（上から3つ目。開いてすぐ目に入る位置にあるため） */}
          <HubSection id="sec-schedule" title="通塾日程" detailHref={`${base}/schedule`}>
            <div className="flex flex-col gap-5">
              {/* 通塾日程が0件の生徒にだけ「通塾セットアップ」への導線を出す（モーダルと同じ判定）。
                  教室長は生徒一覧からハブへ直行するので、ここに無いと入会直後の生徒で手が止まる */}
              <ScheduleSetupNotice studentId={student.id} />
              <div>
                <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-text-heading">
                  予定表
                  <V2Tag />
                </h3>
                {/* ★予定表は教室で絞らない。他教室の振替・講習もその生徒の予定（#196 の判断） */}
                <StudentScheduleCalendar studentId={student.id} />
              </div>
              <div>
                <h3 className="mb-2 text-sm font-bold text-text-heading">週の枠</h3>
                {/* ハブは教室長以上しか開けないので編集可でよい（モーダルの通塾日程タブと同じ） */}
                <AttendanceMatrix
                  studentId={student.id}
                  schoolId={student.school_id}
                  studentGrade={student.grade}
                  canEdit
                />
              </div>
            </div>
          </HubSection>

          {/* ここから下は見えてから読み込む（LazySection。同時リクエストで接続プールを飽和させないため） */}
          <HubSection
            id="sec-forms"
            title="申込状況"
            detailHref="/responses"
            detailLabel="申込一覧"
            lazy
            placeholderHeight={120}
          >
            <FormResponsesSection studentId={student.id} />
          </HubSection>

          <HubSection
            id="sec-scores"
            title="成績"
            detailHref={`${base}/scores`}
            lazy
            placeholderHeight={320}
            flush
          >
            <HubScorePanel />
          </HubSection>

          {/* 志望校は面談④と同じ部品。成績は上の「成績」と1回の取得を共有する（HubDataContext） */}
          <HubSection
            id="sec-targets"
            title="志望校"
            detailHref={`/interview?studentId=${student.id}`}
            lazy
            placeholderHeight={480}
            flush
          >
            <TargetSchoolsSection
              studentId={student.id}
              schoolId={student.school_id}
              gender={student.gender ?? null}
            />
          </HubSection>

          <HubSection
            id="sec-progress"
            title="進行表"
            detailHref={`${base}/progress`}
            lazy
            placeholderHeight={280}
            flush
          >
            {/* 学校進度との比較（通常のテキストだけ）。記録が無い生徒では部品が何も描かないので、
                余白ごと消えるよう empty:hidden にしている */}
            <div className="px-4 pt-3.5 empty:hidden">
              <SchoolPaceTable />
            </div>
            <HubProgressPanel />
          </HubSection>

          <HubSection
            id="sec-lessons"
            title="授業の様子"
            detailHref={`${base}/lesson-reports`}
            lazy
            placeholderHeight={160}
          >
            <LessonReportsSection studentId={student.id} />
          </HubSection>

          <HubSection
            id="sec-discipline"
            title="宿題・遅刻・出欠"
            detailHref={`${base}/progress`}
            lazy
            placeholderHeight={240}
            flush
          >
            <HubDisciplinePanel />
          </HubSection>

          <HubSection
            id="sec-interview"
            title="面談"
            detailHref={`/interview?studentId=${student.id}`}
            detailLabel="面談を始める"
            lazy
            placeholderHeight={320}
          >
            {/* 面談記録の追加・Notta取込・約束の完了はこの部品が持っている。
                ★面談記録は今の状態・気にすることと共有の取得（HubDataContext）とは別に、この部品が自分で取る
                （部品の中を変えないため、ここだけ二重になるのは承知のうえ。見えてから読み込むので開いた直後は重ならない） */}
            <InterviewList studentId={student.id} schoolId={student.school_id} />
          </HubSection>

          {/* 講習と教材は左右に並べる（モックの決定。どちらも中身が少なく、全幅だと横が空く）。
              1100px 未満は縦に積む */}
          <div className="grid grid-cols-1 items-start gap-3 min-[1100px]:grid-cols-2">
            <HubSection
              id="sec-koushu"
              title="講習"
              detailHref={`${base}/proposals`}
              detailLabel="提案書を開く"
              lazy
              placeholderHeight={200}
            >
              <StudentKoushuTab studentId={student.id} />
            </HubSection>

            {/* 所持・進行表で管理・配布の操作はモーダルと同じ部品。教室長は生徒一覧からハブへ
                直行するので、ここに無いと教材を触れなくなる */}
            <HubSection
              id="sec-textbooks"
              title="教材"
              detailHref={`${base}/progress`}
              detailLabel="進行表"
              lazy
              placeholderHeight={240}
            >
              <TextbooksSection studentId={student.id} schoolId={student.school_id} />
            </HubSection>
          </div>

          <HubSection id="sec-parent" title="保護者" extra={<V2Tag />} lazy placeholderHeight={200}>
            <div className="flex flex-col gap-5">
              {/* 保護者との連絡。保護者アカウントが前提なので2月から。
                  ★上の「気にすること」には置かない: 2月までほぼ全員が空で、一番目立つ場所に
                  空の欄が並ぶため（左上を空けない、というユーザーの指摘） */}
              <div>
                <h3 className="mb-2 text-sm font-bold text-text-heading">保護者との連絡</h3>
                <ParentMessagesCard studentId={student.id} />
              </div>
              {/* 部品が自前で「保護者ポータル」の見出しを持つので、ここでは付けない（二重になる） */}
              <PortalInviteSection studentId={student.id} studentName={fullName} />
            </div>
          </HubSection>

          {/* 提案書は各一覧ページへのリンクだけ（第1段） */}
          <HubSection id="sec-proposals" title="提案書">
            <ul className="m-0 flex list-none flex-wrap gap-x-6 gap-y-2 p-0 text-[13px]">
              <li>
                <Link href={`${base}/proposals`} className="text-primary hover:underline">
                  講習の提案書
                </Link>
              </li>
              <li>
                <Link href={`${base}/test-prep`} className="text-primary hover:underline">
                  テスト対策の提案書
                </Link>
              </li>
            </ul>
          </HubSection>

          {/* 請求の計上と変更履歴は、見出し（期間名など）ごと部品が持っている */}
          <BillingSection studentId={student.id} schoolId={student.school_id} />
          <LogsSection studentId={student.id} />
        </div>
      </HubDataProvider>

      {/* 全項目を縦に並べる長いページなので、下まで読んだあと先頭（目次）へ戻れるようにする */}
      <ScrollToTopButton />
    </AdminLayout>
  );
}
