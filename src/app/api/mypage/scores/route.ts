import { NextRequest, NextResponse } from 'next/server';
import { requirePortalStudent } from '@/lib/mypage/portalAuth';
import {
  listPortalAssessments,
  listPortalScoreSubmissions,
  getStudentSchoolId,
  submitPortalScore,
} from '@/lib/mypage/scores';
import {
  isSubmittableCategory,
  isValidGrade,
  validateNameCode,
  normalizeExamMonth,
  validateScores,
} from '@/lib/mypage/scoreValidation';
import { captureApiError } from '@/lib/api-error';

export const dynamic = 'force-dynamic';

/**
 * 保護者の成績（Stage 5・§7-5）: 一覧取得 / 申請送信。
 *
 * GET  ?student_id=  → 承認済み成績（portal_assessments）＋自分の申請一覧（portal_score_submissions）。
 * POST { student_id, category, grade, name_code, exam_month, scores } → 成績申請（再送=置き換え）。
 *
 * 認可はどちらも requirePortalStudent に一本化（紐づけ＋在籍を入口で検証。§7-5柱3）。
 */
export async function GET(request: NextRequest) {
  const studentId = request.nextUrl.searchParams.get('student_id');
  if (!studentId) {
    return NextResponse.json({ error: 'student_id が必要です' }, { status: 400 });
  }

  const auth = await requirePortalStudent(studentId);
  if ('error' in auth) return auth.error;

  // 閲覧はどちらも portal クライアント（RLS/ビュー述語が防壁）。service role は使わない。
  const [assessments, submissions] = await Promise.all([
    listPortalAssessments(auth.client, studentId),
    listPortalScoreSubmissions(auth.client, studentId),
  ]);

  return NextResponse.json({ ok: true, assessments, submissions });
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch (error) {
    captureApiError(error, {
      route: 'POST /api/mypage/scores',
    });
    return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
  }

  const studentId = body.student_id;
  if (typeof studentId !== 'string' || !studentId) {
    return NextResponse.json({ error: 'student_id が必要です' }, { status: 400 });
  }

  // セッション検証＋紐づけ・在籍確認は必ず値のバリデーションより先に行う
  // （他人の生徒に対して「値が不正か」を先に判定してしまうと存在有無の手がかりを与える）。
  const auth = await requirePortalStudent(studentId);
  if ('error' in auth) return auth.error;

  const category = body.category;
  if (!isSubmittableCategory(category)) {
    // mock（模試）はここで弾く。塾側に既にCSV取込運用があるため保護者入力の対象外（§7-5柱1）。
    return NextResponse.json(
      { error: '入力できるのは定期テストまたは内申のみです' },
      { status: 400 }
    );
  }

  const grade = body.grade;
  if (!isValidGrade(grade)) {
    return NextResponse.json({ error: '学年が不正です' }, { status: 400 });
  }

  const nameCode = body.name_code;
  if (!validateNameCode(category, nameCode)) {
    return NextResponse.json({ error: 'テスト名が不正です' }, { status: 400 });
  }

  const examMonthInput = body.exam_month;
  if (
    examMonthInput !== null &&
    typeof examMonthInput !== 'string' &&
    examMonthInput !== undefined
  ) {
    return NextResponse.json({ error: '年月が不正です' }, { status: 400 });
  }
  const examMonthResult = normalizeExamMonth(
    typeof examMonthInput === 'string' ? examMonthInput : null,
    category
  );
  if (!examMonthResult.ok) {
    return NextResponse.json({ error: examMonthResult.error }, { status: 400 });
  }

  const scoresResult = validateScores(category, body.scores);
  if (!scoresResult.ok) {
    return NextResponse.json({ error: scoresResult.error }, { status: 400 });
  }

  // school_id はクライアント申告を信じず、生徒の実所属校をサーバー側で引き直して焼き込む。
  const schoolId = await getStudentSchoolId(auth.svc, studentId);
  if (!schoolId) {
    return NextResponse.json({ error: '生徒の所属校を特定できませんでした' }, { status: 500 });
  }

  const submission = await submitPortalScore(auth.svc, {
    accountId: auth.accountId,
    studentId,
    schoolId,
    category,
    grade,
    nameCode: nameCode as string,
    examMonth: examMonthResult.value,
    scores: scoresResult.value,
  });

  if (!submission) {
    return NextResponse.json({ error: '送信に失敗しました' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, submission });
}
