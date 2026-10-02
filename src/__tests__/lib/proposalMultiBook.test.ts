import { describe, it, expect } from 'vitest';
import {
  buildProposalSaveBlockers,
  calcBookKomaSummary,
  checkBookLimit,
  formatBookTitles,
  mergeTemplateBooks,
  orderedBookIds,
  themeOfBook,
  buildTemplateCourses,
  isUnitInCourse,
  reorderBooks,
  summarizeBookSaves,
} from '@/components/proposals/proposalMultiBook';

describe('checkBookLimit（新規作成の冊数上限: 1科目3冊・合計15冊）', () => {
  const s = (subject: string) => ({ subject });

  it('1科目3冊までは足せる', () => {
    expect(checkBookLimit([s('英語'), s('英語')], [s('英語')])).toBeNull();
  });

  it('同じ科目の4冊目は止め、科目名を出す', () => {
    expect(checkBookLimit([s('英語'), s('英語'), s('英語')], [s('英語')])).toBe(
      '「英語」のテキストは1科目3冊までです'
    );
  });

  it('科目が違えば3冊を超えて並べられる（中3の5教科をまとめて作る）', () => {
    const five = ['英語', '数学', '国語', '理科', '社会'].flatMap((x) => [s(x), s(x)]);
    expect(checkBookLimit([], five)).toBeNull();
  });

  it('科目が空の教材（過去問など）はまとめて1つの科目として数える', () => {
    expect(checkBookLimit([s(''), s(''), s('')], [s(' ')])).toBe(
      '「科目なし（過去問など）」のテキストは1科目3冊までです'
    );
  });

  it('合計15冊を超えると止める', () => {
    const fifteen = Array.from({ length: 15 }, (_, i) => s(`科目${i % 6}`));
    expect(checkBookLimit(fifteen, [])).toBeNull();
    expect(checkBookLimit(fifteen, [s('科目9')])).toBe('テキストは合計15冊までです');
  });
});

describe('mergeTemplateBooks（テンプレの複数選択）', () => {
  const english = {
    name: '英語入試対策',
    textbooks: [
      { textbook_id: 10, textbook: { name: '入試完成 英語', subject: '英語', grade: '中3' } },
      { textbook_id: 99, textbook: { name: '都立入試過去問', subject: null, grade: '中3' } },
    ],
    curriculum: [
      { textbook_id: 10, curriculum_item_id: 101, proposal_count: 2, group_number: 1 },
      { textbook_id: 99, curriculum_item_id: 901, proposal_count: 1, group_number: null },
    ],
  };
  const math = {
    name: '数学入試対策',
    textbooks: [
      { textbook_id: 20, textbook: { name: '入試完成 数学', subject: '数学', grade: '中3' } },
      { textbook_id: 99, textbook: { name: '都立入試過去問', subject: null, grade: '中3' } },
    ],
    curriculum: [
      { textbook_id: 20, curriculum_item_id: 201, proposal_count: 3, group_number: null },
      { textbook_id: 99, curriculum_item_id: 911, proposal_count: 1, group_number: 1 },
    ],
  };

  it('並びは選んだ順→テンプレに登録した順。同じテキストは最初に出た位置に1冊だけ置く', () => {
    const merged = mergeTemplateBooks([english, math]);
    expect(merged.map((b) => b.textbookId)).toEqual([10, 99, 20]);
  });

  it('同じテキストはテンプレごとの単元設定を分けたまま持つ（結合番号を混ぜない）', () => {
    const kakomon = mergeTemplateBooks([english, math]).find((b) => b.textbookId === 99)!;
    expect(kakomon.templateNames).toEqual(['英語入試対策', '数学入試対策']);
    expect(kakomon.settingsByTemplate).toEqual([
      [{ curriculum_item_id: 901, proposal_count: 1, group_number: null }],
      [{ curriculum_item_id: 911, proposal_count: 1, group_number: 1 }],
    ]);
  });

  it('科目が空の教材は空文字で返す（上限の判定で「科目なし」に数える）', () => {
    const kakomon = mergeTemplateBooks([english]).find((b) => b.textbookId === 99)!;
    expect(kakomon.subject).toBe('');
  });

  describe('buildTemplateCourses（テンプレ1つ＝科目のコース1つ）', () => {
    const courses = buildTemplateCourses([
      { id: 'en', ...english },
      { id: 'ma', ...math },
    ]);

    it('テンプレごとにコースを作り、テーマの初期値はテンプレ名', () => {
      expect(courses.map((c) => [c.key, c.name, c.theme])).toEqual([
        ['en', '英語入試対策', '英語入試対策'],
        ['ma', '数学入試対策', '数学入試対策'],
      ]);
    });

    it('共有するテキスト（過去問）はどちらのコースにも入る。冊の番号はコースごと', () => {
      expect(courses.map((c) => c.bookIds)).toEqual([
        [10, 99],
        [20, 99],
      ]);
    });

    it('コースの科目は、科目のある教材から取る（過去問の空の科目は数えない）', () => {
      expect(courses.map((c) => c.subjects)).toEqual([['英語'], ['数学']]);
    });

    it('保存する順は、コースの順→コースの中の順。共有する冊は最初に出た位置で1回だけ', () => {
      expect(orderedBookIds(courses)).toEqual([10, 99, 20]);
    });

    it('共有する冊のテーマは最初のコースのテーマ', () => {
      expect(themeOfBook(courses, 99)).toBe('英語入試対策');
      expect(themeOfBook(courses, 20)).toBe('数学入試対策');
    });
  });
});

describe('isUnitInCourse（コースで見せる単元）', () => {
  it('科目のある教材は、コースの科目に関係なく全単元を見せる', () => {
    expect(isUnitInCourse(null, '英語', ['数学'])).toBe(true);
  });

  it('過去問（教材の科目が空）は、コースの科目の単元だけを見せる', () => {
    expect(isUnitInCourse('英語', '', ['英語'])).toBe(true);
    expect(isUnitInCourse('数学', '', ['英語'])).toBe(false);
  });

  it('単元に科目が無い・コースに科目が無い（過去問だけのテンプレ）ときは見せる', () => {
    expect(isUnitInCourse(null, '', ['英語'])).toBe(true);
    expect(isUnitInCourse('数学', '', [])).toBe(true);
  });
});

describe('calcBookKomaSummary', () => {
  it('冊ごとのコマ数と全冊の合計を返す', () => {
    const summary = calcBookKomaSummary([
      {
        textbookId: 1,
        name: '中2 英語 A',
        units: [
          { group_id: 0, koma_count: 2 },
          { group_id: 0, koma_count: 2 },
        ],
      },
      { textbookId: 2, name: '中2 英語 B', units: [{ group_id: 0, koma_count: 3 }] },
    ]);
    expect(summary.perBook.map((b) => b.koma)).toEqual([4, 3]);
    expect(summary.perBook.map((b) => b.order)).toEqual([1, 2]);
    expect(summary.totalKoma).toBe(7);
    expect(summary.totalUnitCount).toBe(3);
  });

  it('結合したグループは冊ごとに1コマとして数える（1冊のときと同じ数え方）', () => {
    const summary = calcBookKomaSummary([
      {
        textbookId: 1,
        name: 'A',
        units: [
          { group_id: 1, koma_count: 2 },
          { group_id: 1, koma_count: 2 },
          { group_id: 0, koma_count: 1 },
        ],
      },
    ]);
    expect(summary.totalKoma).toBe(3);
  });

  it('冊が無ければ合計は0', () => {
    expect(calcBookKomaSummary([]).totalKoma).toBe(0);
  });
});

describe('buildProposalSaveBlockers', () => {
  it('テーマ未入力は止める', () => {
    const blockers = buildProposalSaveBlockers({
      theme: '   ',
      books: [{ name: 'A', koma: 3 }],
    });
    expect(blockers).toContain('テーマを入力してください');
  });

  it('テキストが1冊も無ければ止める', () => {
    const blockers = buildProposalSaveBlockers({ theme: '復習', books: [] });
    expect(blockers).toEqual(['テキストを選択してください']);
  });

  it('1冊のときはコマ0でも止めない（従来の挙動を変えない）', () => {
    const blockers = buildProposalSaveBlockers({
      theme: '復習',
      books: [{ name: 'A', koma: 0 }],
    });
    expect(blockers).toEqual([]);
  });

  it('2冊以上のときは、コマ数が入っていない冊を書名入りで止める', () => {
    const blockers = buildProposalSaveBlockers({
      theme: '復習',
      books: [
        { name: 'A', koma: 3 },
        { name: 'B', koma: 0 },
      ],
    });
    expect(blockers).toEqual(['「B」にコマ数が入っていません']);
  });

  it('コースが複数あるときは、テーマが空のコースをコース名入りで止める', () => {
    const blockers = buildProposalSaveBlockers({
      courses: [
        { name: '英語入試対策', theme: '英語入試対策' },
        { name: '数学入試対策', theme: ' ' },
      ],
      books: [
        { name: 'A', koma: 3 },
        { name: 'B', koma: 2 },
      ],
    });
    expect(blockers).toEqual(['「数学入試対策」の講習テーマを入力してください']);
  });

  it('コースが1つのときは、従来どおりの文言で止める', () => {
    const blockers = buildProposalSaveBlockers({
      courses: [{ name: '', theme: '' }],
      books: [{ name: 'A', koma: 3 }],
    });
    expect(blockers).toEqual(['テーマを入力してください']);
  });
});

describe('summarizeBookSaves', () => {
  it('全部成功したら成功として扱う', () => {
    const s = summarizeBookSaves([
      { textbookId: 1, name: 'A', proposalId: 'p1' },
      { textbookId: 2, name: 'B', proposalId: 'p2' },
    ]);
    expect(s.allSucceeded).toBe(true);
    expect(s.savedProposalIds).toEqual(['p1', 'p2']);
    expect(s.failedNames).toEqual([]);
    expect(s.tone).toBe('success');
    expect(s.message).toContain('2件');
  });

  it('1冊だけの成功は従来の文言', () => {
    const s = summarizeBookSaves([{ textbookId: 1, name: 'A', proposalId: 'p1' }]);
    expect(s.message).toBe('保存しました');
  });

  it('途中で失敗したら、保存できた冊と失敗した冊を分けて返す', () => {
    const s = summarizeBookSaves([
      { textbookId: 1, name: 'A', proposalId: 'p1' },
      { textbookId: 2, name: 'B', proposalId: null },
    ]);
    expect(s.allSucceeded).toBe(false);
    expect(s.savedTextbookIds).toEqual([1]);
    expect(s.failedNames).toEqual(['B']);
    expect(s.tone).toBe('error');
    expect(s.message).toContain('「B」');
  });

  it('全部失敗したら失敗として扱う', () => {
    const s = summarizeBookSaves([{ textbookId: 1, name: 'A', proposalId: null }]);
    expect(s.savedTextbookIds).toEqual([]);
    expect(s.message).toContain('保存に失敗しました');
  });
});

describe('formatBookTitles', () => {
  it('2冊までは書名を並べる', () => {
    expect(formatBookTitles(['A', 'B'])).toBe('A、B');
  });

  it('3冊以上は「ほかn冊」に畳む', () => {
    expect(formatBookTitles(['A', 'B', 'C'])).toBe('A ほか2冊');
  });

  it('空の書名は数に入れない', () => {
    expect(formatBookTitles(['A', '', '  '])).toBe('A');
    expect(formatBookTitles([])).toBe('');
  });
});

describe('reorderBooks', () => {
  // ★タブの並び＝保存する順＝進める順。テンプレの登録順から生徒ごとに入れ替えられるようにした
  it('つかんだ冊を落とした冊の位置へ動かし、間の冊は1つずつずれる', () => {
    expect(reorderBooks([1, 2, 3], 3, 1)).toEqual([3, 1, 2]);
    expect(reorderBooks([1, 2, 3], 1, 3)).toEqual([2, 3, 1]);
    expect(reorderBooks([1, 2, 3], 2, 3)).toEqual([1, 3, 2]);
  });

  it('見つからない冊・同じ位置なら並びを変えない', () => {
    expect(reorderBooks([1, 2], 9, 1)).toEqual([1, 2]);
    expect(reorderBooks([1, 2], 1, 1)).toEqual([1, 2]);
  });
});
