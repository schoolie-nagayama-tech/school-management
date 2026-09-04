/**
 * 申込管理の「提案どおり入力」が取り込むコマ数のテスト。
 *
 * ★ 何を守るテストか:
 *   保護者が申込フォームで見た提案コマ数と、室長が申込管理で取り込む数が
 *   1コマでもズレてはいけない。結合グループ（group_id>0）を素直に足すと
 *   二重計上で倍にズレるので、その境界を固定する。
 *   集計は公開側と同じ純関数を使う契約なので、ここは「その契約が守られているか」を見る。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// supabase クライアントをテーブル名ごとの固定応答に差し替える
const { tableData } = vi.hoisted(() => ({
  tableData: { current: {} as Record<string, unknown[]> },
}));

vi.mock('@/lib/supabase', () => {
  const makeQuery = (table: string) => {
    const rows = () => tableData.current[table] ?? [];
    const q: Record<string, unknown> = {};
    // select/eq/in はすべて自分自身を返し、await されたら { data } を返す
    for (const m of ['select', 'eq', 'in']) {
      q[m] = () => q;
    }
    q.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
      resolve({ data: rows(), error: null });
    return q;
  };
  return { supabase: { from: (table: string) => makeQuery(table) } };
});

import { getProposedKomaBySubject } from '@/lib/api/koushu-proposed-koma';

beforeEach(() => {
  tableData.current = {};
});

describe('getProposedKomaBySubject', () => {
  it('提案書が無ければ空を返す（エラーにしない）', async () => {
    tableData.current = { seasonal_proposals: [] };
    const r = await getProposedKomaBySubject('s1', 'summer', 2026);
    expect(r).toEqual({ komaBySubject: {}, unresolvedCount: 0 });
  });

  it('group_id=0 のユニットはそのまま合計する', async () => {
    tableData.current = {
      seasonal_proposals: [{ id: 'p1', textbook_id: 10 }],
      seasonal_proposal_units: [
        { proposal_id: 'p1', koma_count: 2, group_id: 0 },
        { proposal_id: 'p1', koma_count: 3, group_id: 0 },
      ],
      textbooks: [{ id: 10, subject_id: 'math' }],
    };
    const r = await getProposedKomaBySubject('s1', 'summer', 2026);
    expect(r.komaBySubject).toEqual({ math: 5 });
  });

  it('結合グループ（group_id>0）は同じグループで1回だけ数える（倍ズレ防止）', async () => {
    tableData.current = {
      seasonal_proposals: [{ id: 'p1', textbook_id: 10 }],
      seasonal_proposal_units: [
        // 同じ group_id=1 の3単元を1コマとして提案しているケース
        { proposal_id: 'p1', koma_count: 1, group_id: 1 },
        { proposal_id: 'p1', koma_count: 1, group_id: 1 },
        { proposal_id: 'p1', koma_count: 1, group_id: 1 },
        { proposal_id: 'p1', koma_count: 2, group_id: 0 },
      ],
      textbooks: [{ id: 10, subject_id: 'eng' }],
    };
    const r = await getProposedKomaBySubject('s1', 'summer', 2026);
    // 結合3件で1コマ + 単独2コマ = 3コマ（素朴に足すと5になる）
    expect(r.komaBySubject).toEqual({ eng: 3 });
  });

  it('同じ科目の複数教材は合算する', async () => {
    tableData.current = {
      seasonal_proposals: [
        { id: 'p1', textbook_id: 10 },
        { id: 'p2', textbook_id: 11 },
      ],
      seasonal_proposal_units: [
        { proposal_id: 'p1', koma_count: 2, group_id: 0 },
        { proposal_id: 'p2', koma_count: 4, group_id: 0 },
      ],
      textbooks: [
        { id: 10, subject_id: 'math' },
        { id: 11, subject_id: 'math' },
      ],
    };
    const r = await getProposedKomaBySubject('s1', 'summer', 2026);
    expect(r.komaBySubject).toEqual({ math: 6 });
  });

  it('教材に科目が無い提案書は取り込まず件数だけ返す（黙って落とさない）', async () => {
    tableData.current = {
      seasonal_proposals: [
        { id: 'p1', textbook_id: 10 },
        { id: 'p2', textbook_id: null },
        { id: 'p3', textbook_id: 12 },
      ],
      seasonal_proposal_units: [
        { proposal_id: 'p1', koma_count: 2, group_id: 0 },
        { proposal_id: 'p2', koma_count: 9, group_id: 0 },
        { proposal_id: 'p3', koma_count: 9, group_id: 0 },
      ],
      // id=12 は subject_id が null（バックフィル漏れ）
      textbooks: [
        { id: 10, subject_id: 'math' },
        { id: 12, subject_id: null },
      ],
    };
    const r = await getProposedKomaBySubject('s1', 'summer', 2026);
    expect(r.komaBySubject).toEqual({ math: 2 });
    expect(r.unresolvedCount).toBe(2);
  });

  it('コマ0の科目は結果に含めない（0を入れて表を汚さない）', async () => {
    tableData.current = {
      seasonal_proposals: [{ id: 'p1', textbook_id: 10 }],
      seasonal_proposal_units: [{ proposal_id: 'p1', koma_count: 0, group_id: 0 }],
      textbooks: [{ id: 10, subject_id: 'math' }],
    };
    const r = await getProposedKomaBySubject('s1', 'summer', 2026);
    expect(r.komaBySubject).toEqual({});
  });
});

// ============================================================
// 申込回数（進行表）からの取り込み
// ============================================================

import { getAppliedKomaBySubject } from '@/lib/api/koushu-applied-koma';

describe('getAppliedKomaBySubject', () => {
  it('教材ごとの申込回数を科目別に合計する', async () => {
    tableData.current = {
      student_textbooks: [
        { id: 'stb1', textbook: { subject_id: 'math' } },
        { id: 'stb2', textbook: { subject_id: 'eng' } },
      ],
      student_progress: [
        { student_textbook_id: 'stb1', application_count: 3 },
        { student_textbook_id: 'stb1', application_count: 2 },
        { student_textbook_id: 'stb2', application_count: 4 },
      ],
    };
    const r = await getAppliedKomaBySubject('s1');
    expect(r).toEqual({ math: 5, eng: 4 });
  });

  it('同じ科目の複数教材は合算する', async () => {
    tableData.current = {
      student_textbooks: [
        { id: 'stb1', textbook: { subject_id: 'math' } },
        { id: 'stb2', textbook: { subject_id: 'math' } },
      ],
      student_progress: [
        { student_textbook_id: 'stb1', application_count: 2 },
        { student_textbook_id: 'stb2', application_count: 3 },
      ],
    };
    expect(await getAppliedKomaBySubject('s1')).toEqual({ math: 5 });
  });

  it('結合グループの0行は素直に足してよい（書き込み時に先頭へ寄せてあるため）', async () => {
    tableData.current = {
      student_textbooks: [{ id: 'stb1', textbook: { subject_id: 'math' } }],
      // 先頭行に合計6が入り、同じグループの残りは0で埋まっている形
      student_progress: [
        { student_textbook_id: 'stb1', application_count: 6 },
        { student_textbook_id: 'stb1', application_count: 0 },
        { student_textbook_id: 'stb1', application_count: 0 },
      ],
    };
    expect(await getAppliedKomaBySubject('s1')).toEqual({ math: 6 });
  });

  it('embed が配列で返っても科目を解決できる', async () => {
    tableData.current = {
      student_textbooks: [{ id: 'stb1', textbook: [{ subject_id: 'sci' }] }],
      student_progress: [{ student_textbook_id: 'stb1', application_count: 2 }],
    };
    expect(await getAppliedKomaBySubject('s1')).toEqual({ sci: 2 });
  });

  it('科目が引けない教材と申込0は結果に含めない', async () => {
    tableData.current = {
      student_textbooks: [
        { id: 'stb1', textbook: { subject_id: null } },
        { id: 'stb2', textbook: { subject_id: 'math' } },
      ],
      student_progress: [
        { student_textbook_id: 'stb1', application_count: 9 },
        { student_textbook_id: 'stb2', application_count: 0 },
      ],
    };
    expect(await getAppliedKomaBySubject('s1')).toEqual({});
  });

  it('所持教材が無ければ空を返す', async () => {
    tableData.current = { student_textbooks: [] };
    expect(await getAppliedKomaBySubject('s1')).toEqual({});
  });
});
