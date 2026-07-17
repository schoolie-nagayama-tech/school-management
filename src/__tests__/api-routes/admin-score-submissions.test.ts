/**
 * APIルートテスト: /api/admin/score-submissions 系（Stage 5・§7-5）。
 *
 * 固定する仕様:
 *   - 権限境界は canEditScores（講師も可）＝ requireScoreEditor に一本化
 *   - GET は auth.schoolIds に絞った一覧を返す（絞り込み自体は lib 側の責務なのでスコープIDを
 *     正しく渡しているかだけ確認する）
 *   - approve/reject は lib/api/scoreSubmissions.ts の結果（ok/status/error）をそのままHTTPへ変換する
 *   - reject は reason 必須（空文字は400。ここはルート自身が検証してから lib を呼ぶ）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/api-auth', () => ({
  requireScoreEditor: vi.fn(),
  getApiAuth: vi.fn(),
}));

vi.mock('@/lib/mypage/serviceClient', () => ({
  getPortalServiceClient: vi.fn(() => ({ tag: 'svc' })),
}));

vi.mock('@/lib/api/scoreSubmissions', () => ({
  listScoreSubmissionsForReview: vi.fn(),
  approveScoreSubmission: vi.fn(),
  rejectScoreSubmission: vi.fn(),
}));

import { GET } from '@/app/api/admin/score-submissions/route';
import { POST as approvePOST } from '@/app/api/admin/score-submissions/[id]/approve/route';
import { POST as rejectPOST } from '@/app/api/admin/score-submissions/[id]/reject/route';
import { requireScoreEditor, getApiAuth } from '@/lib/api-auth';
import {
  listScoreSubmissionsForReview,
  approveScoreSubmission,
  rejectScoreSubmission,
} from '@/lib/api/scoreSubmissions';

function mockAuthSuccess(schoolIds: string[] = ['school-1']) {
  vi.mocked(requireScoreEditor).mockResolvedValue(null);
  vi.mocked(getApiAuth).mockResolvedValue({
    auth: { userId: 'staff-1', role: 'teacher', schoolIds },
    cookieResponse: NextResponse.next(),
  });
}

function mockAuthDenied(status: 401 | 403) {
  const res = NextResponse.json(
    { error: status === 401 ? '認証が必要です' : '権限がありません' },
    { status }
  );
  vi.mocked(requireScoreEditor).mockResolvedValue(res);
}

describe('GET /api/admin/score-submissions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('未認証/権限不足は requireScoreEditor の戻り値どおり返す', async () => {
    mockAuthDenied(401);
    const res = await GET(new NextRequest('http://localhost:3000/api/admin/score-submissions'));
    expect(res.status).toBe(401);
    expect(listScoreSubmissionsForReview).not.toHaveBeenCalled();
  });

  it('status不正なら400', async () => {
    mockAuthSuccess();
    const res = await GET(
      new NextRequest('http://localhost:3000/api/admin/score-submissions?status=bogus')
    );
    expect(res.status).toBe(400);
  });

  it('成功時は auth.schoolIds を渡して一覧を返す（既定status=submitted）', async () => {
    mockAuthSuccess(['school-1', 'school-2']);
    vi.mocked(listScoreSubmissionsForReview).mockResolvedValue([]);
    const res = await GET(new NextRequest('http://localhost:3000/api/admin/score-submissions'));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(listScoreSubmissionsForReview).toHaveBeenCalledWith(
      { tag: 'svc' },
      ['school-1', 'school-2'],
      'submitted'
    );
  });

  it('自分の教室スコープが空なら空配列（DBを叩かない）', async () => {
    mockAuthSuccess([]);
    const res = await GET(new NextRequest('http://localhost:3000/api/admin/score-submissions'));
    const json = await res.json();
    expect(json.submissions).toEqual([]);
    expect(listScoreSubmissionsForReview).not.toHaveBeenCalled();
  });
});

function approveReq() {
  return approvePOST(
    new NextRequest('http://localhost:3000/api/admin/score-submissions/sub-1/approve', {
      method: 'POST',
    }),
    { params: Promise.resolve({ id: 'sub-1' }) }
  );
}

describe('POST /api/admin/score-submissions/[id]/approve', () => {
  beforeEach(() => vi.clearAllMocks());

  it('権限不足なら requireScoreEditor の戻り値どおり403', async () => {
    mockAuthDenied(403);
    const res = await approveReq();
    expect(res.status).toBe(403);
    expect(approveScoreSubmission).not.toHaveBeenCalled();
  });

  it('成功時は転記結果（submission/assessmentId）を返す', async () => {
    mockAuthSuccess();
    vi.mocked(approveScoreSubmission).mockResolvedValue({
      ok: true,
      submission: {
        id: 'sub-1',
        studentId: 'stu-1',
        accountId: 'acc-1',
        category: 'regular_test',
        grade: 8,
        nameCode: 'term1_mid',
        examMonth: '2026-07-01',
        scores: { english: 80 },
        status: 'approved',
        rejectedReason: null,
        reviewedBy: 'staff-1',
        reviewedAt: '2026-07-17T00:00:00Z',
        assessmentId: 'assess-1',
        createdAt: '2026-07-16T00:00:00Z',
        updatedAt: '2026-07-17T00:00:00Z',
      },
      assessmentId: 'assess-1',
    });

    const res = await approveReq();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.assessmentId).toBe('assess-1');
    expect(approveScoreSubmission).toHaveBeenCalledWith(
      { tag: 'svc' },
      { submissionId: 'sub-1', reviewerId: 'staff-1', schoolIdScope: ['school-1'] }
    );
  });

  it('二重承認（既に処理済み）は409をそのまま返す', async () => {
    mockAuthSuccess();
    vi.mocked(approveScoreSubmission).mockResolvedValue({
      ok: false,
      status: 409,
      error: 'この申請は既に処理済みです',
    });

    const res = await approveReq();
    expect(res.status).toBe(409);
  });

  it('教室スコープ外は403をそのまま返す', async () => {
    mockAuthSuccess();
    vi.mocked(approveScoreSubmission).mockResolvedValue({
      ok: false,
      status: 403,
      error: '教室スコープ外です',
    });

    const res = await approveReq();
    expect(res.status).toBe(403);
  });

  it('存在しない申請は404をそのまま返す', async () => {
    mockAuthSuccess();
    vi.mocked(approveScoreSubmission).mockResolvedValue({
      ok: false,
      status: 404,
      error: '申請が見つかりません',
    });

    const res = await approveReq();
    expect(res.status).toBe(404);
  });
});

function rejectReq(body: unknown) {
  return rejectPOST(
    new NextRequest('http://localhost:3000/api/admin/score-submissions/sub-1/reject', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }),
    { params: Promise.resolve({ id: 'sub-1' }) }
  );
}

describe('POST /api/admin/score-submissions/[id]/reject', () => {
  beforeEach(() => vi.clearAllMocks());

  it('権限不足なら401/403をそのまま返す', async () => {
    mockAuthDenied(401);
    const res = await rejectReq({ reason: '点数の記入漏れがあります' });
    expect(res.status).toBe(401);
    expect(rejectScoreSubmission).not.toHaveBeenCalled();
  });

  it('reason が空文字なら400（DBのCHECK制約と同じ境界をAPI側でも検証）', async () => {
    mockAuthSuccess();
    const res = await rejectReq({ reason: '' });
    expect(res.status).toBe(400);
    expect(rejectScoreSubmission).not.toHaveBeenCalled();
  });

  it('reason が空白のみなら400', async () => {
    mockAuthSuccess();
    const res = await rejectReq({ reason: '   ' });
    expect(res.status).toBe(400);
    expect(rejectScoreSubmission).not.toHaveBeenCalled();
  });

  it('reason 未指定なら400', async () => {
    mockAuthSuccess();
    const res = await rejectReq({});
    expect(res.status).toBe(400);
  });

  it('成功時は差し戻し済みの申請を返す', async () => {
    mockAuthSuccess();
    vi.mocked(rejectScoreSubmission).mockResolvedValue({
      ok: true,
      submission: {
        id: 'sub-1',
        studentId: 'stu-1',
        accountId: 'acc-1',
        category: 'regular_test',
        grade: 8,
        nameCode: 'term1_mid',
        examMonth: '2026-07-01',
        scores: { english: 80 },
        status: 'rejected',
        rejectedReason: '点数の記入漏れがあります',
        reviewedBy: 'staff-1',
        reviewedAt: '2026-07-17T00:00:00Z',
        assessmentId: null,
        createdAt: '2026-07-16T00:00:00Z',
        updatedAt: '2026-07-17T00:00:00Z',
      },
    });

    const res = await rejectReq({ reason: '  点数の記入漏れがあります  ' });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.submission.status).toBe('rejected');
    // 前後の空白はトリムしてから lib に渡す。
    expect(rejectScoreSubmission).toHaveBeenCalledWith(
      { tag: 'svc' },
      {
        submissionId: 'sub-1',
        reviewerId: 'staff-1',
        reason: '点数の記入漏れがあります',
        schoolIdScope: ['school-1'],
      }
    );
  });

  it('二重差し戻し（既に処理済み）は409をそのまま返す', async () => {
    mockAuthSuccess();
    vi.mocked(rejectScoreSubmission).mockResolvedValue({
      ok: false,
      status: 409,
      error: 'この申請は既に処理済みです',
    });

    const res = await rejectReq({ reason: '差し戻し理由' });
    expect(res.status).toBe(409);
  });
});
