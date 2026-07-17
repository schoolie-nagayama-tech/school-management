/**
 * APIルートテスト: GET/POST /api/mypage/scores
 *
 * 正典: docs/portal-v2-requirements.md §7-5。固定する仕様:
 *   - 認可は requirePortalStudent に一本化（未認証/紐づけ無し/在籍外はその戻り値をそのまま返す）
 *   - POST は mock 拒否・範囲外拒否・再送＝置き換え（既存 submitted があれば更新扱いの
 *     submitPortalScore を呼ぶだけで、ルート側は分岐しない）
 *   - バリデーション（scoreValidation.ts）は実物を使う（純関数・高速なのでモックしない）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/mypage/portalAuth', () => ({
  requirePortalStudent: vi.fn(),
}));

vi.mock('@/lib/mypage/scores', () => ({
  listPortalAssessments: vi.fn(),
  listPortalScoreSubmissions: vi.fn(),
  getStudentSchoolId: vi.fn(),
  submitPortalScore: vi.fn(),
}));

import { GET, POST } from '@/app/api/mypage/scores/route';
import { requirePortalStudent } from '@/lib/mypage/portalAuth';
import {
  listPortalAssessments,
  listPortalScoreSubmissions,
  getStudentSchoolId,
  submitPortalScore,
} from '@/lib/mypage/scores';

const CLIENT = { tag: 'portal-jwt-client' };
const SVC = { tag: 'service-role-client' };

function getReq(studentId?: string) {
  const qs = studentId ? `?student_id=${encodeURIComponent(studentId)}` : '';
  return new NextRequest(`http://localhost:3000/api/mypage/scores${qs}`);
}

function postReq(body: unknown) {
  return new NextRequest('http://localhost:3000/api/mypage/scores', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockAuthSuccess() {
  vi.mocked(requirePortalStudent).mockResolvedValue({
    accountId: 'acc-1',
    claims: { sub: 'acc-1' } as never,
    // @ts-expect-error テスト用の軽量スタブ（SupabaseClient の完全な形は不要）
    client: CLIENT,
    // @ts-expect-error 同上（テスト用の軽量スタブ）
    svc: SVC,
  });
}

const VALID_BODY = {
  student_id: 'stu-1',
  category: 'regular_test',
  grade: 8,
  name_code: 'term1_mid',
  exam_month: '2026-07',
  scores: { english: 80, math: 90 },
};

describe('GET /api/mypage/scores', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('student_id が無ければ 400', async () => {
    const res = await GET(getReq());
    expect(res.status).toBe(400);
    expect(requirePortalStudent).not.toHaveBeenCalled();
  });

  it('未認証なら requirePortalStudent の戻り値どおり 401', async () => {
    vi.mocked(requirePortalStudent).mockResolvedValue({
      error: NextResponse.json({ error: '認証が必要です' }, { status: 401 }),
    });
    const res = await GET(getReq('stu-1'));
    expect(res.status).toBe(401);
  });

  it('他人の生徒なら requirePortalStudent の戻り値どおり 403', async () => {
    vi.mocked(requirePortalStudent).mockResolvedValue({
      error: NextResponse.json({ error: '権限がありません' }, { status: 403 }),
    });
    const res = await GET(getReq('stu-other'));
    expect(res.status).toBe(403);
  });

  it('成功時は assessments と submissions をまとめて返す', async () => {
    mockAuthSuccess();
    vi.mocked(listPortalAssessments).mockResolvedValue([
      {
        id: 'a-1',
        studentId: 'stu-1',
        category: 'regular_test',
        grade: 8,
        nameCode: 'term1_mid',
        examMonth: '2026-07-01',
        examDate: '2026-07-01',
        scores: { english: 80 },
      },
    ]);
    vi.mocked(listPortalScoreSubmissions).mockResolvedValue([]);

    const res = await GET(getReq('stu-1'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.assessments).toHaveLength(1);
    expect(json.submissions).toEqual([]);
    expect(listPortalAssessments).toHaveBeenCalledWith(CLIENT, 'stu-1');
    expect(listPortalScoreSubmissions).toHaveBeenCalledWith(CLIENT, 'stu-1');
  });
});

describe('POST /api/mypage/scores', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('student_id が無ければ 400', async () => {
    const res = await POST(postReq({ ...VALID_BODY, student_id: undefined }));
    expect(res.status).toBe(400);
    expect(requirePortalStudent).not.toHaveBeenCalled();
  });

  it('未認証なら 401（値のバリデーションより先に認可を見る）', async () => {
    vi.mocked(requirePortalStudent).mockResolvedValue({
      error: NextResponse.json({ error: '認証が必要です' }, { status: 401 }),
    });
    const res = await POST(postReq(VALID_BODY));
    expect(res.status).toBe(401);
  });

  it('他人の生徒なら 403', async () => {
    vi.mocked(requirePortalStudent).mockResolvedValue({
      error: NextResponse.json({ error: '権限がありません' }, { status: 403 }),
    });
    const res = await POST(postReq(VALID_BODY));
    expect(res.status).toBe(403);
  });

  it('category=mock は400（模試は保護者入力の対象外）', async () => {
    mockAuthSuccess();
    const res = await POST(postReq({ ...VALID_BODY, category: 'mock' }));
    expect(res.status).toBe(400);
    expect(submitPortalScore).not.toHaveBeenCalled();
  });

  it('点数が範囲外（101点）なら400', async () => {
    mockAuthSuccess();
    const res = await POST(postReq({ ...VALID_BODY, scores: { english: 101 } }));
    expect(res.status).toBe(400);
    expect(submitPortalScore).not.toHaveBeenCalled();
  });

  it('学年が範囲外なら400', async () => {
    mockAuthSuccess();
    const res = await POST(postReq({ ...VALID_BODY, grade: 0 }));
    expect(res.status).toBe(400);
  });

  it('name_code がカテゴリと不一致なら400', async () => {
    mockAuthSuccess();
    const res = await POST(postReq({ ...VALID_BODY, name_code: 'term1' })); // report_card用のcode
    expect(res.status).toBe(400);
  });

  it('exam_month が不正な形式なら400', async () => {
    mockAuthSuccess();
    const res = await POST(postReq({ ...VALID_BODY, exam_month: '2026/07' }));
    expect(res.status).toBe(400);
  });

  it('生徒の所属校が特定できなければ500', async () => {
    mockAuthSuccess();
    vi.mocked(getStudentSchoolId).mockResolvedValue(null);
    const res = await POST(postReq(VALID_BODY));
    expect(res.status).toBe(500);
    expect(submitPortalScore).not.toHaveBeenCalled();
  });

  it('成功時は submitPortalScore を正規化済みの値で呼び、申請を返す（再送＝置き換えは submitPortalScore 側の責務）', async () => {
    mockAuthSuccess();
    vi.mocked(getStudentSchoolId).mockResolvedValue('school-1');
    vi.mocked(submitPortalScore).mockResolvedValue({
      id: 'sub-1',
      studentId: 'stu-1',
      accountId: 'acc-1',
      category: 'regular_test',
      grade: 8,
      nameCode: 'term1_mid',
      examMonth: '2026-07-01',
      scores: { english: 80, math: 90 },
      status: 'submitted',
      rejectedReason: null,
      reviewedBy: null,
      reviewedAt: null,
      assessmentId: null,
      createdAt: '2026-07-17T00:00:00Z',
      updatedAt: '2026-07-17T00:00:00Z',
    });

    const res = await POST(postReq(VALID_BODY));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.submission.id).toBe('sub-1');
    expect(submitPortalScore).toHaveBeenCalledWith(SVC, {
      accountId: 'acc-1',
      studentId: 'stu-1',
      schoolId: 'school-1',
      category: 'regular_test',
      grade: 8,
      nameCode: 'term1_mid',
      examMonth: '2026-07-01', // YYYY-MM → YYYY-MM-01 に正規化されている
      scores: { english: 80, math: 90 },
    });
  });

  it('submitPortalScore が失敗（null）なら500', async () => {
    mockAuthSuccess();
    vi.mocked(getStudentSchoolId).mockResolvedValue('school-1');
    vi.mocked(submitPortalScore).mockResolvedValue(null);
    const res = await POST(postReq(VALID_BODY));
    expect(res.status).toBe(500);
  });
});
