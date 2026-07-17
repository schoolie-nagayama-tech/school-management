/**
 * APIルートテスト: GET /api/mypage/school-info
 *
 * ChatView のクイックアクション（TemplateForm）向けの軽量な教室情報エンドポイント。
 * 固定する仕様:
 *   - student_id 必須（400）
 *   - 認可は requirePortalStudent に一本化（未認証/紐づけ無し/在籍外はその戻り値の
 *     レスポンスをそのまま返す。ここで 401/403 を作り直さない）
 *   - 認可成功時は timeSlots・meetingBookingUrl をヘルパーから取得してそのまま返す
 *     （DB アクセスの中身は lib/mypage/schoolInfo.test.ts 側で固定する）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/mypage/portalAuth', () => ({
  requirePortalStudent: vi.fn(),
}));

vi.mock('@/lib/mypage/schoolInfo', () => ({
  fetchSchoolTimeSlots: vi.fn(),
  fetchMeetingBookingUrl: vi.fn(),
}));

import { GET } from '@/app/api/mypage/school-info/route';
import { requirePortalStudent } from '@/lib/mypage/portalAuth';
import { fetchSchoolTimeSlots, fetchMeetingBookingUrl } from '@/lib/mypage/schoolInfo';

function req(studentId?: string) {
  const qs = studentId ? `?student_id=${encodeURIComponent(studentId)}` : '';
  return new NextRequest(`http://localhost:3000/api/mypage/school-info${qs}`);
}

const CLIENT = { tag: 'portal-jwt-client' };
const SVC = { tag: 'service-role-client' };

describe('GET /api/mypage/school-info', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('student_id が無ければ 400', async () => {
    const res = await GET(req());
    expect(res.status).toBe(400);
    expect(requirePortalStudent).not.toHaveBeenCalled();
  });

  it('未認証（requirePortalStudent が 401 を返す）ならそのまま 401 を返す', async () => {
    vi.mocked(requirePortalStudent).mockResolvedValue({
      error: NextResponse.json({ error: '認証が必要です' }, { status: 401 }),
    });

    const res = await GET(req('stu-1'));
    expect(res.status).toBe(401);
    expect(fetchSchoolTimeSlots).not.toHaveBeenCalled();
    expect(fetchMeetingBookingUrl).not.toHaveBeenCalled();
  });

  it('他人の生徒（requirePortalStudent が 403 を返す）ならそのまま 403 を返す', async () => {
    vi.mocked(requirePortalStudent).mockResolvedValue({
      error: NextResponse.json({ error: '権限がありません' }, { status: 403 }),
    });

    const res = await GET(req('stu-other'));
    expect(res.status).toBe(403);
    expect(fetchSchoolTimeSlots).not.toHaveBeenCalled();
    expect(fetchMeetingBookingUrl).not.toHaveBeenCalled();
  });

  it('認可成功時は timeSlots・meetingBookingUrl をそのまま返す', async () => {
    vi.mocked(requirePortalStudent).mockResolvedValue({
      accountId: 'acc-1',
      claims: { sub: 'acc-1' } as never,
      // @ts-expect-error テスト用の軽量スタブ（SupabaseClient の完全な形は不要）
      client: CLIENT,
      // @ts-expect-error 同上（テスト用の軽量スタブ）
      svc: SVC,
    });
    vi.mocked(fetchSchoolTimeSlots).mockResolvedValue([
      { id: 'slot-1', slotNumber: 3, slotLabel: '17:00〜18:30' },
    ]);
    vi.mocked(fetchMeetingBookingUrl).mockResolvedValue('https://calendar.example.com/book');

    const res = await GET(req('stu-1'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({
      ok: true,
      timeSlots: [{ id: 'slot-1', slotNumber: 3, slotLabel: '17:00〜18:30' }],
      meetingBookingUrl: 'https://calendar.example.com/book',
    });
    // 生徒スコープの絞り込みを各ヘルパーに正しく渡していること。
    expect(fetchSchoolTimeSlots).toHaveBeenCalledWith(CLIENT, 'stu-1');
    expect(fetchMeetingBookingUrl).toHaveBeenCalledWith(SVC, 'stu-1');
  });

  it('予約URL未設定の教室では meetingBookingUrl が null', async () => {
    vi.mocked(requirePortalStudent).mockResolvedValue({
      accountId: 'acc-1',
      claims: { sub: 'acc-1' } as never,
      // @ts-expect-error テスト用の軽量スタブ
      client: CLIENT,
      // @ts-expect-error 同上（テスト用の軽量スタブ）
      svc: SVC,
    });
    vi.mocked(fetchSchoolTimeSlots).mockResolvedValue([]);
    vi.mocked(fetchMeetingBookingUrl).mockResolvedValue(null);

    const res = await GET(req('stu-1'));
    const json = await res.json();

    expect(json.timeSlots).toEqual([]);
    expect(json.meetingBookingUrl).toBeNull();
  });
});
