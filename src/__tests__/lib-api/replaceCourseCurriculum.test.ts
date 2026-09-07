/**
 * replaceCourseCurriculum のテスト。
 *
 * 講習テンプレートの編集画面は「まとめて保存」なので、単元設定は upsert では足りない。
 * コマ数を0に戻した単元は書き出し対象から外れるため、upsert だけだとDBに古い行が残り、
 * 読み直したときに消したはずのコマ数が復活する。ここでは次の2点を固定する:
 *   - 保存前に、そのテキストぶんの行を必ず削除する（course_id と textbook_id の両方で絞る）
 *   - 空配列を渡したときは削除だけ行い、INSERT は発行しない
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockChain } from '../api-routes/helpers';

const mockSupabase = { from: vi.fn() };

vi.mock('@/lib/supabase', () => ({
  supabase: mockSupabase,
  getSupabaseBrowserClient: () => mockSupabase,
  createSupabaseBrowserClient: () => mockSupabase,
}));

describe('replaceCourseCurriculum', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('削除してから挿入する（コマ0に戻した単元が復活しない）', async () => {
    const delChain = createMockChain(null);
    const insChain = createMockChain(null);
    let call = 0;
    mockSupabase.from.mockImplementation(() => {
      call++;
      return call === 1 ? delChain : insChain;
    });

    const { replaceCourseCurriculum } = await import('@/lib/api/seasonalCourses');
    await replaceCourseCurriculum('course-1', 10, [
      { curriculum_item_id: 1, proposal_count: 2, group_number: null },
      { curriculum_item_id: 2, proposal_count: 0, group_number: 3 },
    ]);

    // 削除が先。course_id と textbook_id の両方で絞る（他テキストのタブを巻き込まない）
    expect(delChain.delete).toHaveBeenCalled();
    expect(delChain.eq).toHaveBeenCalledWith('course_id', 'course-1');
    expect(delChain.eq).toHaveBeenCalledWith('textbook_id', 10);

    // そのあと挿入
    expect(insChain.insert).toHaveBeenCalledTimes(1);
    const records = insChain.insert.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      course_id: 'course-1',
      textbook_id: 10,
      curriculum_item_id: 1,
      proposal_count: 2,
      group_number: null,
    });
    // 結合の先頭以外はコマ0で書く（読み出し側がグループ内を合計するため）
    expect(records[1]).toMatchObject({ curriculum_item_id: 2, proposal_count: 0, group_number: 3 });
  });

  it('空配列なら削除だけして挿入しない', async () => {
    const delChain = createMockChain(null);
    mockSupabase.from.mockImplementation(() => delChain);

    const { replaceCourseCurriculum } = await import('@/lib/api/seasonalCourses');
    await replaceCourseCurriculum('course-1', 10, []);

    expect(mockSupabase.from).toHaveBeenCalledTimes(1);
    expect(delChain.delete).toHaveBeenCalled();
    expect(delChain.insert).not.toHaveBeenCalled();
  });

  it('削除でエラーが出たら投げる（消えていないのに入れない）', async () => {
    mockSupabase.from.mockImplementation(() => createMockChain(null, { message: 'delete failed' }));

    const { replaceCourseCurriculum } = await import('@/lib/api/seasonalCourses');
    await expect(
      replaceCourseCurriculum('course-1', 10, [
        { curriculum_item_id: 1, proposal_count: 1, group_number: null },
      ])
    ).rejects.toBeDefined();
  });
});
