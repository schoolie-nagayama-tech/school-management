/**
 * 講習の残りコマ計算のテスト。
 *
 * ★ なぜこのテストが要るか: 「コマ数」を指導日セルの数で数えると本番実測で倍近くズレる
 *   （1コマで平均1.8単元進む）。セッション単位で数えるという定義と、
 *   「残りコマ vs 残り単元に必要なコマ」で前倒し/不足を出す判定を、ここで固定する。
 *   数字は進行表・テキスト一覧カード・進行表確認フィードの3か所で共有されるので、
 *   定義が変わると3画面が同時にズレる。
 */
import { describe, it, expect } from 'vitest';
import {
  computeKoushuKoma,
  koushuGroupDeviations,
  koushuPaceLabel,
  type KoushuKomaRow,
} from '@/lib/utils/koushuKoma';

/** 単元1行ぶんのヘルパー（指導日は [日付, セッションID] の配列で渡す） */
function row(
  rowKey: number,
  applicationCount: number,
  opts: {
    group?: number | null;
    applied?: number | null;
    lessons?: [string, string | null][];
  } = {}
): KoushuKomaRow {
  return {
    rowKey,
    applicationCount,
    groupNumber: opts.group ?? null,
    appliedGroupNumber: opts.applied ?? null,
    lessons: (opts.lessons ?? []).map(([lesson_date, session_id]) => ({ lesson_date, session_id })),
  };
}

describe('computeKoushuKoma', () => {
  it('申込コマは結合先頭行の値を単純合算する（非先頭行は0のため二重計上しない）', () => {
    const s = computeKoushuKoma([
      row(1, 2, { group: 1 }),
      row(2, 0, { group: 1 }),
      row(3, 3, { group: 2 }),
      row(4, 0, { group: 2 }),
    ]);
    expect(s.applied).toBe(5);
  });

  it('1コマで複数単元を進めた場合、コマは1つとして数える（セル数で数えない）', () => {
    const s = computeKoushuKoma([
      row(1, 1, { group: 1, lessons: [['2026-07-20', 'sess-a']] }),
      row(2, 0, { group: 1, lessons: [['2026-07-20', 'sess-a']] }),
      row(3, 1, { group: 2, lessons: [['2026-07-20', 'sess-a']] }),
    ]);
    // 指導日セルは3件だが、セッションは1つ＝1コマ
    expect(s.done).toBe(1);
    expect(s.remaining).toBe(1);
  });

  it('1コマで2グループぶん進めたら前倒しになる（本番の実データと同じ形）', () => {
    // 申込7コマ / 実施3コマ。うち1コマ(sess-a)がグループ1と2を同時に消化している
    const s = computeKoushuKoma([
      row(1, 1, { group: 1, lessons: [['2026-07-20', 'sess-a']] }),
      row(2, 1, { group: 2, lessons: [['2026-07-20', 'sess-a']] }),
      row(3, 1, { group: 3, lessons: [['2026-07-29', 'sess-b']] }),
      row(4, 1, { group: 4, lessons: [['2026-07-29', 'sess-b']] }),
      row(5, 1, { group: 5, lessons: [['2026-08-03', 'sess-c']] }),
      row(6, 1, { applied: 8 }),
      row(7, 1),
    ]);
    expect(s.applied).toBe(7);
    expect(s.done).toBe(3);
    expect(s.remaining).toBe(4);
    // 未消化は row6 と row7 の2グループ＝2コマぶん
    expect(s.needed).toBe(2);
    expect(s.diff).toBe(2);
    expect(koushuPaceLabel(s)).toEqual({ text: '+2コマ前倒し', tone: 'ahead' });
  });

  it('1グループに予定より多くコマを使うと不足（遅れ）になる', () => {
    const s = computeKoushuKoma([
      // 1コマ予定の単元に3コマ使った
      row(1, 1, {
        group: 1,
        lessons: [
          ['2026-07-20', 'sess-a'],
          ['2026-07-22', 'sess-b'],
          ['2026-07-24', 'sess-c'],
        ],
      }),
      row(2, 1, { group: 2 }),
      row(3, 1, { group: 3 }),
      row(4, 1, { group: 4 }),
    ]);
    expect(s.applied).toBe(4);
    expect(s.done).toBe(3);
    expect(s.remaining).toBe(1);
    expect(s.needed).toBe(3);
    expect(s.diff).toBe(-2);
    expect(koushuPaceLabel(s)).toEqual({ text: '2コマ不足', tone: 'behind' });
  });

  it('申込グループ（applied_group_number）は提案グループより優先して結合単位になる', () => {
    const s = computeKoushuKoma([
      row(1, 2, { group: 1, applied: 5, lessons: [['2026-07-20', 'sess-a']] }),
      row(2, 0, { group: 2, applied: 5 }),
    ]);
    // 申込グループ5として1つに束ねられ、予定2コマ・実施1コマ → 残り必要1コマ
    expect(s.needed).toBe(1);
    expect(s.diff).toBe(0);
    expect(koushuPaceLabel(s)).toEqual({ text: 'プラン通り', tone: 'onplan' });
  });

  it('セッションの無い直接入力は日付で1コマとみなし、同日のセッションとは二重に数えない', () => {
    const s = computeKoushuKoma([
      row(1, 3, { group: 1, lessons: [['2026-07-20', 'sess-a']] }),
      // 同日・セッション無し（セッションと同じコマの記録とみなす）
      row(2, 0, { group: 1, lessons: [['2026-07-20', null]] }),
      // 別日・セッション無し（独立した1コマ）
      row(3, 0, { group: 1, lessons: [['2026-07-27', null]] }),
    ]);
    expect(s.done).toBe(2);
    expect(s.remaining).toBe(1);
  });

  it('申込に無い単元を進めるとコマだけ減り、遅れとして現れる', () => {
    const s = computeKoushuKoma([
      row(1, 2, { group: 1 }),
      // 申込コマ0の単元（提案されなかった単元）に1コマ使った
      row(2, 0, { lessons: [['2026-07-20', 'sess-x']] }),
    ]);
    expect(s.applied).toBe(2);
    expect(s.done).toBe(1);
    expect(s.remaining).toBe(1);
    expect(s.needed).toBe(2);
    expect(s.diff).toBe(-1);
  });

  it('申込を超えて実施した場合は超過として出す', () => {
    const s = computeKoushuKoma([
      row(1, 1, {
        group: 1,
        lessons: [
          ['2026-07-20', 'sess-a'],
          ['2026-07-21', 'sess-b'],
          ['2026-07-22', 'sess-c'],
        ],
      }),
    ]);
    expect(s.remaining).toBe(-2);
    expect(koushuPaceLabel(s)).toEqual({ text: '2コマ超過', tone: 'behind' });
  });

  it('申込が未転記（全0）なら applied=0（呼び出し側で非表示にする合図）', () => {
    const s = computeKoushuKoma([row(1, 0), row(2, 0)]);
    expect(s.applied).toBe(0);
    expect(s.done).toBe(0);
  });

  it('進捗行が無くても落ちない', () => {
    const s = computeKoushuKoma([]);
    expect(s).toMatchObject({ applied: 0, done: 0, remaining: 0, needed: 0, diff: 0 });
    expect(s.groups).toEqual([]);
  });
});

/**
 * ★ 本番で見つかった取りこぼしの回帰テスト（永山・中1・フォレスタステップ数学）。
 *
 * 「2コマ予定の比例の式・反比例の式を、7/30の1コマで両方やり切った」ケース。
 * 残りコマは6で正しいのに、進行表に残っている予定は5コマしか無い＝1コマ前倒し。
 * 旧実装は「やり切ったグループ」も max(予定−実施,0)=1 を要求し続けたため needed=6 となり、
 * 6−6=0 で「プラン通り」と誤判定していた。
 */
describe('computeKoushuKoma — やり切ったグループは残り0（本番の実データ）', () => {
  const nakamura: KoushuKomaRow[] = [
    row(1, 1, { applied: 1, lessons: [['2026-07-14', 's1']] }),
    row(2, 0, { applied: 1, lessons: [['2026-07-14', 's1']] }),
    row(3, 1, { applied: 2, lessons: [['2026-07-15', 's2']] }),
    row(4, 0, { applied: 2, lessons: [['2026-07-15', 's2']] }),
    row(5, 1, { applied: 3, lessons: [['2026-07-22', 's3']] }),
    row(6, 0, { applied: 3, lessons: [['2026-07-22', 's3']] }),
    row(7, 1, { applied: 4, lessons: [['2026-07-24', 's4']] }),
    row(8, 0, { applied: 4, lessons: [['2026-07-24', 's4']] }),
    // ここが本題: 2コマ予定を1コマ(7/30)で2単元とも終えている
    row(9, 2, { applied: 5, lessons: [['2026-07-30', 's5']] }),
    row(10, 0, { applied: 5, lessons: [['2026-07-30', 's5']] }),
    row(11, 1, { applied: 6, lessons: [['2026-08-03', 's6']] }),
    row(12, 0, { applied: 6, lessons: [['2026-08-03', 's6']] }),
    // 未実施
    row(13, 1),
    row(14, 2, { applied: 7 }),
    row(15, 0, { applied: 7 }),
    row(16, 1, { applied: 8 }),
    row(17, 0, { applied: 8 }),
    row(18, 1, { applied: 9 }),
    row(19, 0, { applied: 9 }),
    // 提案のみで申込0（＝やり切るべき対象ではない）
    row(20, 0),
    row(21, 0),
  ];

  it('申込12・実施6・残り6（コマ数の集計は従来どおり）', () => {
    const s = computeKoushuKoma(nakamura);
    expect(s.applied).toBe(12);
    expect(s.done).toBe(6);
    expect(s.remaining).toBe(6);
  });

  it('やり切ったグループを0にすると 残り必要=5 → +1コマ前倒しと出る', () => {
    const s = computeKoushuKoma(nakamura);
    // 未実施の 4-5(1) / 4-6・4-7(2) / 5-1・5-2(1) / 5-3・5-4(1) = 5
    expect(s.needed).toBe(5);
    expect(s.diff).toBe(1);
    expect(koushuPaceLabel(s)).toEqual({ text: '+1コマ前倒し', tone: 'ahead' });
  });

  it('ズレたグループとして「2コマ予定を1コマで実施」だけを拾う', () => {
    const devs = koushuGroupDeviations(computeKoushuKoma(nakamura));
    expect(devs).toHaveLength(1);
    expect(devs[0]).toMatchObject({ planned: 2, consumed: 1, finished: true, delta: -1 });
    // 予定コマの数字が出ている行（申込2の行）に印を出す
    expect(devs[0].anchorRowKey).toBe(9);
  });

  it('まだ手を付けていないグループや、単元が残っている途中のグループはズレ扱いしない', () => {
    const devs = koushuGroupDeviations(
      computeKoushuKoma([
        // 未着手（2コマ予定・実施0）
        row(1, 2, { applied: 1 }),
        row(2, 0, { applied: 1 }),
        // 途中（2コマ予定・1コマ実施だが2単元目が未指導）
        row(3, 2, { applied: 2, lessons: [['2026-07-30', 's1']] }),
        row(4, 0, { applied: 2 }),
      ])
    );
    expect(devs).toEqual([]);
  });

  it('予定より多く使ったグループは、やり切る前でもズレとして拾う', () => {
    const devs = koushuGroupDeviations(
      computeKoushuKoma([
        row(1, 1, {
          applied: 1,
          lessons: [
            ['2026-07-20', 's1'],
            ['2026-07-22', 's2'],
          ],
        }),
        row(2, 0, { applied: 1 }),
      ])
    );
    expect(devs).toHaveLength(1);
    expect(devs[0]).toMatchObject({ planned: 1, consumed: 2, finished: false, delta: 1 });
  });
});
