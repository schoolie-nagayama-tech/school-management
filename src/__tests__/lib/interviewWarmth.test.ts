/**
 * 面談ワークスペース 2026-09-23 の整理（根拠を畳む・ひとこと・場面・言葉・Notta・検索）のテスト。
 *
 * ★守りたいのは次の点:
 *  - ひとこと・場面は保護者にそのまま言う文なので、数字入り・長すぎ・知らない key は必ず捨てる
 *  - 場面の日付・講師はAIの言い値ではなく、渡した引継ぎの行から取る
 *  - 「」の言葉は1字も変えずに運ぶ。誰の言葉かは分からなければ決めつけない
 *  - 新しいNottaの型（（なし）・感情：・塾：・【要望】・印象に残った言葉）と、
 *    古い型・Slack経由の形の両方が読めること
 *  - 検索は全角半角・大文字小文字を区別せず、ハイライトは元の文字のまま返すこと
 */
import { describe, expect, it, vi } from 'vitest';

// notta-transcripts.ts は supabase クライアントを読み込むので、整形関数だけを試すために差し替える
vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import {
  briefSystemPrompt,
  briefUserText,
  containsDigit,
  parseBriefResult,
  parseLessonLineHead,
  sanitizeFollowUpActors,
  sanitizeFollowUpItems,
  MAX_EPISODE_LENGTH,
  MAX_OPENER_LENGTH,
  OPENER_KEYS,
  type BriefSectionKey,
} from '@/lib/ai/interviewBrief';
import {
  buildPreviousCommitmentLines,
  buildTellSections,
  extractQuotedWords,
  matchesSearch,
  normalizeSearchQuery,
  parseNottaSummary,
  parsePreviousBullet,
  previousItemFallbackKind,
  quotedWordFactLine,
  quotedWordTalkLine,
  splitForHighlight,
} from '@/app/interview/interview.shared';
import { formatNottaTranscript } from '@/lib/api/notta-transcripts';
import type { StudentInterview } from '@/types/database';

function interviewRow(over: Partial<StudentInterview>): StudentInterview {
  return {
    id: 'i1',
    school_id: 's1',
    student_id: 'st1',
    interview_date: '2026-09-01',
    interview_type: 'parent_interview',
    title: null,
    content: '',
    is_completed: false,
    completed_at: null,
    created_by: null,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...over,
  };
}

/* ============================================================
 * AIの入出力（ひとこと・場面）
 * ========================================================== */

describe('containsDigit（ひとこと・場面の数字の関所）', () => {
  it('半角・全角のアラビア数字を見つける', () => {
    expect(containsDigit('9月の模試')).toBe(true);
    expect(containsDigit('９月の模試')).toBe(true);
    expect(containsDigit('夏休みは一度も休まずに来てくれました')).toBe(false);
  });

  it('★漢数字は見ない（「一度」「一緒に」まで落ちるため）', () => {
    expect(containsDigit('一緒に確認しましょう')).toBe(false);
  });
});

describe('parseLessonLineHead（場面の日付・講師を引継ぎの行から取る）', () => {
  it('「YYYY/MM/DD 講師名: 引継ぎ」から M/D と講師の姓を取る', () => {
    expect(parseLessonLineHead('2026/09/17 内山 太郎: 自分から質問してきた')).toEqual({
      date: '9/17',
      teacher: '内山',
    });
  });

  it('講師名が無い行は teacher を空にする', () => {
    expect(parseLessonLineHead('2026/09/04: 図を描いて考えた')).toEqual({
      date: '9/4',
      teacher: '',
    });
  });

  it('形が違う行は null', () => {
    expect(parseLessonLineHead('引継ぎ 20件')).toBeNull();
    expect(parseLessonLineHead('昨日 内山: 良かった')).toBeNull();
  });
});

describe('briefSystemPrompt（ひとこと・場面・言葉）', () => {
  const p = briefSystemPrompt();

  it('ひとことの置き場所を全部伝え、ねぎらい→話題・丁寧語・さん付けを求める', () => {
    for (const k of OPENER_KEYS) expect(p).toContain(`"${k}"`);
    expect(p).toContain('ねぎらい');
    expect(p).toContain('丁寧語');
    expect(p).toContain('「◯◯さん」');
    expect(p).toContain(`${MAX_OPENER_LENGTH}字まで`);
  });

  it('★場面は番号で引継ぎを指させ、日付・講師名・数字を書かせない', () => {
    expect(p).toContain('lesson');
    expect(p).toContain('日付・講師名・数字は書かない');
    expect(p).toContain('事務連絡だけの引継ぎは選ばない');
  });

  it('★「」の中の言葉は言い換えずにそのまま引用させる', () => {
    expect(p).toContain('言い換えずにそのまま引用する（要約しない）');
  });
});

describe('briefUserText（呼び名・引継ぎの番号・誰が動くか）', () => {
  it('生徒の名を「◯◯さん」で渡す（名前が無ければ出さない）', () => {
    const t = briefUserText([{ key: 'score', current: ['x'] }], [], null, { givenName: '律' });
    expect(t).toContain('【生徒の呼び名】律さん');
    expect(briefUserText([{ key: 'score', current: ['x'] }])).not.toContain('【生徒の呼び名】');
  });

  it('★lessons の行だけ 1. 2. と番号を振る（場面の lesson 番号と一致させる）', () => {
    const t = briefUserText([
      { key: 'score', current: ['英語 72'] },
      { key: 'lessons', current: ['2026/09/11 大野: a', '2026/09/17 内山: b'] },
    ]);
    expect(t).toContain('- 英語 72');
    expect(t).toContain('1. 2026/09/11 大野: a');
    expect(t).toContain('2. 2026/09/17 内山: b');
  });

  it('★誰が動くかは本文の後ろに〔 〕で添える（本文は変えない）', () => {
    const raw = [
      { text: '推薦入試の条件を確認する', actor: 'juku' },
      { text: '志望校を家族で話し合う', actor: 'home' },
      '英語の長文を増やしてほしい',
    ];
    const items = sanitizeFollowUpItems(raw);
    expect(items).toEqual([
      '推薦入試の条件を確認する',
      '志望校を家族で話し合う',
      '英語の長文を増やしてほしい',
    ]);
    const actors = sanitizeFollowUpActors(raw);
    const t = briefUserText([{ key: 'score', current: ['x'] }], items, null, {
      followUpActors: actors,
    });
    expect(t).toContain('- 推薦入試の条件を確認する〔塾が動く〕');
    expect(t).toContain('- 志望校を家族で話し合う〔家庭が動く〕');
    // 古い型（頭の語なし）は何も添えない
    expect(t.endsWith('- 英語の長文を増やしてほしい')).toBe(true);
  });

  it('知らない actor は捨てる', () => {
    expect(sanitizeFollowUpActors([{ text: 'a', actor: 'teacher' }, 'b', null])).toEqual({});
  });
});

describe('parseBriefResult（ひとこと）', () => {
  const sent: BriefSectionKey[] = ['score', 'lessons'];

  it('知らない key・数字入り・上限超えは捨て、「」で囲んでいたら外す', () => {
    const got = parseBriefResult(
      {
        openers: {
          intro: '「今日はお忙しいところありがとうございます」',
          juku: '夏休みは一度も休まずに来てくれていましたよ',
          status: '9月の模試、よく頑張りましたね',
          home: 'あ'.repeat(MAX_OPENER_LENGTH + 1),
          closing: 'ありがとうございました',
          review: 42,
        },
      },
      sent
    );
    expect(got.openers).toEqual({
      intro: '今日はお忙しいところありがとうございます',
      juku: '夏休みは一度も休まずに来てくれていましたよ',
    });
  });

  it('★plan は koushu を渡していなければ捨てる（講習の話の無い面談でプランを語らせない）', () => {
    expect(parseBriefResult({ openers: { plan: 'この冬のお話です' } }, sent).openers).toEqual({});
    expect(
      parseBriefResult({ openers: { plan: 'この冬のお話です' } }, ['score', 'koushu']).openers
    ).toEqual({ plan: 'この冬のお話です' });
  });

  it('読めない出力では空（決まり文句で埋めない）', () => {
    expect(parseBriefResult(null, sent).openers).toEqual({});
    expect(parseBriefResult({ openers: ['a'] }, sent).openers).toEqual({});
  });
});

describe('parseBriefResult（場面）', () => {
  const lessons = [
    '2026/09/04 西舘: 次回：進行表通り 確認テスト',
    '2026/09/11 大野 花子: 相似の証明で図を描いて考えられた',
    '2026/09/17 内山: 分からない文法を自分から質問してきた',
  ];
  const sent: BriefSectionKey[] = ['score', 'lessons'];

  it('★日付・講師は番号で引いた引継ぎの行から付ける', () => {
    const got = parseBriefResult(
      {
        episodes: [
          { lesson: 3, text: '英語で、分からない文法を自分から質問してきたそうです' },
          { lesson: 2, text: '数学で、図を描いて考える場面が増えています' },
        ],
      },
      sent,
      [],
      lessons
    );
    expect(got.episodes).toEqual([
      {
        date: '9/17',
        teacher: '内山',
        text: '英語で、分からない文法を自分から質問してきたそうです',
      },
      { date: '9/11', teacher: '大野', text: '数学で、図を描いて考える場面が増えています' },
    ]);
  });

  it('範囲外・整数でない番号、同じ番号の2件目、数字入り、上限超えは捨てる。最大2件', () => {
    const got = parseBriefResult(
      {
        episodes: [
          { lesson: 0, text: 'a文' },
          { lesson: 4, text: 'b文' },
          { lesson: 1.5, text: 'c文' },
          { lesson: '2', text: 'd文' },
          { lesson: 3, text: '9/17の英語で質問した' },
          { lesson: 3, text: 'あ'.repeat(MAX_EPISODE_LENGTH + 1) },
          { lesson: 3, text: '英語で質問してきたそうです' },
          { lesson: 3, text: '英語でもう一度' },
          { lesson: 2, text: '数学で粘りました' },
          { lesson: 1, text: '三件目は入らない' },
        ],
      },
      sent,
      [],
      lessons
    );
    expect(got.episodes.map((e) => e.text)).toEqual([
      '英語で質問してきたそうです',
      '数学で粘りました',
    ]);
  });

  it('★lessons を渡していなければ場面は常に空', () => {
    const got = parseBriefResult(
      { episodes: [{ lesson: 1, text: '英語で質問した' }] },
      ['score'],
      [],
      lessons
    );
    expect(got.episodes).toEqual([]);
  });
});

describe('parseBriefResult（followUps の〔 〕）', () => {
  it('AIが〔塾が動く〕まで書き写してきても、外して突き合わせる', () => {
    const got = parseBriefResult(
      {
        followUps: [
          {
            item: '推薦入試の条件を確認する〔塾が動く〕',
            kind: 'report',
            text: '条件を調べました',
          },
        ],
      },
      ['lastInterview'],
      ['推薦入試の条件を確認する']
    );
    expect(got.followUps).toEqual([
      { item: '推薦入試の条件を確認する', kind: 'report', text: '条件を調べました' },
    ]);
  });
});

/* ============================================================
 * Nottaの要約の新しい型・Slack経由の形
 * ========================================================== */

describe('parseNottaSummary（新しい型・Slack経由の形）', () => {
  // ★本番の notta_transcripts.transcript に入っている形そのもの（U+200E が見出しの前に混ざる）
  const SLACK_SAMPLE =
    '前回の確認 • 前回の面談・電話・指導内容について、具体的な内容は確認できませんでした。\n• 前回決めた方針…\n• …‎ 塾からの報告 • 英語は…';

  it('★見出しの印が無く、見出しが前の箇条書きの行末に続く形を見出しに割る', () => {
    const parsed = parseNottaSummary(SLACK_SAMPLE);
    expect(parsed).not.toBeNull();
    expect(parsed!.sections).toEqual([
      { heading: '前回の確認', bullets: ['前回決めた方針…', '…'] },
      { heading: '塾からの報告', bullets: ['英語は…'] },
    ]);
  });

  it('★取り込み時の整形（formatNottaTranscript）を通して保存された形も同じに読める', () => {
    const stored = [
      '【タイトル】面談',
      '--- Notta 要約 ---',
      formatNottaTranscript(SLACK_SAMPLE),
    ].join('\n\n');
    const parsed = parseNottaSummary(stored);
    expect(parsed!.sections.map((s) => s.heading)).toEqual(['前回の確認', '塾からの報告']);
    expect(parsed!.sections[1].bullets).toEqual(['英語は…']);
  });

  it('知らない語の後ろの「•」は見出しにしない（自由文を見出しと取り違えない）', () => {
    const parsed = parseNottaSummary('■ 相談事項\n・部活の話 • 進路の話');
    expect(parsed!.sections).toEqual([{ heading: '相談事項', bullets: ['部活の話 • 進路の話'] }]);
  });

  it('★「（なし）」だけの見出しは記載なしに畳む', () => {
    const parsed = parseNottaSummary(
      [
        '■ 前回の確認',
        '・（なし）',
        '■ 相談事項',
        '・進路の相談',
        '■ 印象に残った言葉',
        '・(なし)',
      ].join('\n')
    );
    expect(parsed!.sections.map((s) => s.heading)).toEqual(['相談事項']);
    expect(parsed!.omitted).toEqual(['前回の確認', '印象に残った言葉']);
  });

  it('★「感情：」「受け止め：」「生徒：」の行は面談記録カードにはそのまま出る', () => {
    const parsed = parseNottaSummary(
      ['■ 相談事項', '・推薦を受けるか', '・生徒：少し不安そう', '・感情：焦りが見える'].join('\n')
    );
    expect(parsed!.sections[0].bullets).toEqual([
      '推薦を受けるか',
      '生徒：少し不安そう',
      '感情：焦りが見える',
    ]);
  });

  it('★「生徒：（なし）」「受け止め：（なし）」のように頭の語が付いた（なし）も1件ずつ落とす', () => {
    // 本番 9/23 の実物の形（指示1つにつき1行書くので、該当しない指示が頭の語付きで残る）
    const parsed = parseNottaSummary(
      [
        '■ 相談事項',
        '・関数の問題への対応',
        '・生徒：（なし）',
        '・反応：(なし)。',
        '■ 今後の方針',
        '・受け止め：（なし）',
        '・次回確認: （なし）',
      ].join('\n')
    );
    expect(parsed!.sections).toEqual([{ heading: '相談事項', bullets: ['関数の問題への対応'] }]);
    expect(parsed!.omitted).toEqual(['今後の方針']);
  });

  it('「（なし）」を含む中身のある行は落とさない', () => {
    const parsed = parseNottaSummary(['■ 相談事項', '・宿題（なし）の日が続いた'].join('\n'));
    expect(parsed!.sections[0].bullets).toEqual(['宿題（なし）の日が続いた']);
  });

  it('2026-09-24 の型の「反応：」も記録カードにはそのまま出る', () => {
    const parsed = parseNottaSummary(
      ['■ 相談事項', '・推薦を受けるか', '・反応：迷っている'].join('\n')
    );
    expect(parsed!.sections[0].bullets).toEqual(['推薦を受けるか', '反応：迷っている']);
  });

  it('印の無い見出しだけの行（印象に残った言葉）も見出しにする', () => {
    const parsed = parseNottaSummary(['印象に残った言葉', '・「頑張ります」（生徒）'].join('\n'));
    expect(parsed!.sections).toEqual([
      { heading: '印象に残った言葉', bullets: ['「頑張ります」（生徒）'] },
    ]);
  });
});

describe('formatNottaTranscript（取り込み時の整形）', () => {
  it('★新しい見出し「印象に残った言葉」を見出しとして立てる（前の節の箇条書きにしない）', () => {
    const out = formatNottaTranscript(
      ['相談事項', '• 進路の相談', '印象に残った言葉', '• 「頑張ります」（生徒）'].join('\n')
    );
    expect(out).toContain('■ 印象に残った言葉');
    expect(out).not.toContain('・印象に残った言葉');
  });
});

/* ============================================================
 * ②振り返り: 新しい型の頭の語・末尾の印
 * ========================================================== */

describe('parsePreviousBullet / previousItemFallbackKind（新しい型）', () => {
  it('「塾：」は報告、「家庭：」「生徒：」「次回確認：」は聞く。頭の語は本文から外す', () => {
    expect(parsePreviousBullet('塾：推薦入試の条件を確認する')).toEqual({
      text: '推薦入試の条件を確認する',
      actor: 'juku',
      tag: undefined,
      judgement: false,
    });
    expect(parsePreviousBullet('家庭：志望校を話し合う').actor).toBe('home');
    expect(parsePreviousBullet('生徒: 英単語を毎日').actor).toBe('student');
    expect(parsePreviousBullet('次回確認：模試の結果').actor).toBe('nextCheck');

    expect(previousItemFallbackKind('今後の方針', '推薦入試の条件を確認する', 'juku')).toBe(
      'report'
    );
    expect(previousItemFallbackKind('今後の方針', '志望校を話し合う', 'home')).toBe('ask');
  });

  it('★頭の語は語尾の当て推量（〜確認します＝報告）より優先する', () => {
    // 語尾だけ見ると報告だが、書いた人は家庭が動くと決めている
    expect(previousItemFallbackKind('今後の方針', '学校の先生に確認します', 'home')).toBe('ask');
    // 頭の語が無い古い型は従来どおり語尾で振る
    expect(previousItemFallbackKind('今後の方針', '推薦入試の条件を確認します')).toBe('report');
  });

  it('要望の末尾の【相談】【要望】は本文から外して tag に残す', () => {
    expect(parsePreviousBullet('英語の長文を増やしてほしい【要望】')).toEqual({
      text: '英語の長文を増やしてほしい',
      actor: undefined,
      tag: '要望',
      judgement: false,
    });
    expect(parsePreviousBullet('推薦の仕組みを知りたい 【相談】').tag).toBe('相談');
  });

  it('「感情：」「受け止め：」は判断の行として印を付ける', () => {
    expect(parsePreviousBullet('感情：不安が強い').judgement).toBe(true);
    expect(parsePreviousBullet('受け止め: 前向き').judgement).toBe(true);
  });

  it('★「話者 2：」は誰が動くかにしない。頭の語も本文中の話者番号も外す', () => {
    // 本番 9/23 の実物（Nottaは話者番号しか知らない）
    expect(parsePreviousBullet('話者 2：来年から受験を意識して学習に取り組む。')).toEqual({
      text: '来年から受験を意識して学習に取り組む。',
      actor: undefined,
      tag: undefined,
      judgement: false,
    });
    expect(parsePreviousBullet('話者２は東京または近県の大学を希望している。').text).toBe(
      '東京または近県の大学を希望している。'
    );
    expect(parsePreviousBullet('生徒（話者 4）が数学を頑張る').text).toBe('生徒が数学を頑張る');
    // 頭の語が先にあれば、そちらで誰が動くかを決める
    expect(parsePreviousBullet('生徒：話者 2は単語帳を進める')).toEqual({
      text: '単語帳を進める',
      actor: 'student',
      tag: undefined,
      judgement: false,
    });
  });
});

describe('buildPreviousCommitmentLines（新しい型）', () => {
  const NEW_FORMAT = [
    '【タイトル】冬期面談',
    '--- Notta 要約 ---',
    '■ 前回の確認',
    '・（なし）',
    '■ 保護者からの要望',
    '・英語の長文を増やしてほしい【要望】',
    '・推薦の仕組みを知りたい【相談】',
    '・感情：焦りが見える',
    '■ 今後の方針',
    '・塾：推薦入試の条件を確認する',
    '・家庭：志望校を家族で話し合う',
    '・次回確認：模試の結果',
    '・受け止め：前向きに受け止めていた',
    '■ 印象に残った言葉',
    '・「頑張ります」（生徒）',
  ].join('\n');

  it('★判断の行は拾わず、印・頭の語を外した本文で要望・方針を並べる', () => {
    const { requests, items } = buildPreviousCommitmentLines([
      interviewRow({ content: NEW_FORMAT }),
    ]);
    expect(requests).toEqual([
      '英語の長文を増やしてほしい',
      '推薦の仕組みを知りたい',
      '推薦入試の条件を確認する',
      '志望校を家族で話し合う',
      '模試の結果',
    ]);
    expect(items.map((i) => [i.text, i.fallback, i.actor ?? null, i.tag ?? null])).toEqual([
      ['英語の長文を増やしてほしい', 'report', null, '要望'],
      ['推薦の仕組みを知りたい', 'report', null, '相談'],
      ['推薦入試の条件を確認する', 'report', 'juku', null],
      ['志望校を家族で話し合う', 'ask', 'home', null],
      ['模試の結果', 'ask', 'nextCheck', null],
    ]);
  });

  it('★本番 9/23 の実物（Slack経由・話者番号入り）で台本が壊れない', () => {
    // 生徒面談。Nottaが生徒の名前を知らず「話者 2」と書いた記録（抜粋・U+200E もそのまま）
    const LRM = '‎';
    const REAL = [
      `前回の確認 • （なし） 塾からの報告 • 話者 2は夏以降、大学見学に行っておらず、学校からの進路指導も特になかった。${LRM}`,
      `• 英単語帳は1,400語のうち600語まで進んでいる。${LRM} 保護者からの要望 • （なし） 相談事項 • 社会科目で地理と歴史のどちらを選択するか。${LRM}`,
      `• 話者 2：大学候補については「よくわかんない」と回答しており、具体的な志望校は未定である。${LRM} 今後の方針 • 話者 2：大学・学部・通学経路を含めた進学先の候補を調べる。${LRM}`,
      `• 話者 2：来年から受験を意識して学習に取り組む。${LRM}`,
      `• 受け止め：様子見。話者 2は進学先について明確な候補を持っていない。${LRM} 総合メモ • 英語と模試形式の問題への対応が今後の主な課題である。${LRM} 印象に残った言葉 • 「行ってない。」（生徒）${LRM}`,
      `• 「英語はわかりません。」（生徒）${LRM}`,
      `• 「よくわかんない。」（生徒）${LRM} `,
    ].join('\n');
    const row = interviewRow({ interview_type: 'student_interview', content: REAL });

    const { items, asks } = buildPreviousCommitmentLines([row]);
    expect(items.map((i) => [i.text, i.fallback, i.actor ?? null])).toEqual([
      ['大学・学部・通学経路を含めた進学先の候補を調べる。', 'ask', null],
      ['来年から受験を意識して学習に取り組む。', 'ask', null],
    ]);
    expect(asks.join('')).not.toContain('話者');

    expect(extractQuotedWords(row.content, row.interview_type)).toEqual([
      { quote: '行ってない。', speaker: '生徒' },
      { quote: '英語はわかりません。', speaker: '生徒' },
      { quote: 'よくわかんない。', speaker: '生徒' },
    ]);
    // 保護者面談として取り込まれていたら、話し手は決めない
    expect(
      extractQuotedWords(row.content, 'parent_interview').every((q) => q.speaker === null)
    ).toBe(true);
  });

  it('★画面とサーバーで同じ本文になる（頭の語を外した文が item）', () => {
    const { items } = buildPreviousCommitmentLines([interviewRow({ content: NEW_FORMAT })]);
    const sent = items.map((i) => (i.actor ? { text: i.text, actor: i.actor } : i.text));
    expect(sanitizeFollowUpItems(sent)).toEqual(items.map((i) => i.text));
    expect(sanitizeFollowUpActors(sent)).toEqual({
      推薦入試の条件を確認する: 'juku',
      志望校を家族で話し合う: 'home',
      模試の結果: 'nextCheck',
    });
  });
});

/* ============================================================
 * ②振り返り: 「」の言葉をそのまま運ぶ
 * ========================================================== */

describe('extractQuotedWords（古い型）', () => {
  it('★実物の文。「生徒は…」の文の中の「」は生徒の言葉', () => {
    const content = [
      '■ 相談事項',
      '・生徒は受験に対して不安を示しつつも、「頑張ります」と発言しています。',
    ].join('\n');
    expect(extractQuotedWords(content)).toEqual([{ quote: '頑張ります', speaker: '生徒' }]);
  });

  it('保護者・お母様・母は保護者。同じ文で両方あれば「」にいちばん近い語', () => {
    const content = [
      '■ 保護者からの要望',
      '・お母様から「英語の長文を増やしてほしい」とのお話がありました。',
      '・生徒の様子について、保護者は「家では全然勉強していない」と話した。',
    ].join('\n');
    expect(extractQuotedWords(content)).toEqual([
      { quote: '英語の長文を増やしてほしい', speaker: '保護者' },
      { quote: '家では全然勉強していない', speaker: '保護者' },
    ]);
  });

  it('話し手が分からなければ null。前の文の話し手は持ち越さない', () => {
    const content = ['■ 相談事項', '・生徒は前向き。「最初にしては良い」と話が出た。'].join('\n');
    expect(extractQuotedWords(content)).toEqual([{ quote: '最初にしては良い', speaker: null }]);
  });

  it('★塾側の言葉は拾わない（塾から・先生・教室長が「」にいちばん近い）', () => {
    const content = [
      '■ 相談事項',
      '・生徒は前向き。塾からは「最初にしては良い」と伝えた。',
      '・生徒の様子について、教室長が「よく頑張っています」と話した。',
      '・生徒は塾で「もっと頑張ります」と話した。',
    ].join('\n');
    expect(extractQuotedWords(content)).toEqual([{ quote: 'もっと頑張ります', speaker: '生徒' }]);
  });

  it('★話者番号で書かれた言葉は拾わない（本番では「話者 1」が教室長本人のことが多い）', () => {
    // 旧型の重要発言メモの実物の形
    const content = [
      '■ 重要発言メモ',
      '・話者 1：「提出物出せよ」',
      '・話者 2：「英語マスターズみたいな変なのが追加されたんですよ」',
      '・生徒（話者 4）は「数学を頑張ります」と話した。',
    ].join('\n');
    // 「生徒（話者 4）」の括弧書きは添え書きなので外して読む（保護者（話者 5）の実物）
    expect(extractQuotedWords(content)).toEqual([{ quote: '数学を頑張ります', speaker: '生徒' }]);
  });

  it('短すぎる「」・見出しと同じ語・教材名のような発言でない「」・重複は拾わない', () => {
    const content = [
      '■ 相談事項',
      '・「英検」を受けるか相談。',
      '・「相談事項」の確認。',
      '・「新中学問題集」を進める。',
      '・生徒は「頑張ります」と発言。生徒は「頑張ります」と繰り返した。',
    ].join('\n');
    expect(extractQuotedWords(content)).toEqual([{ quote: '頑張ります', speaker: '生徒' }]);
  });

  it('多くても3件。「感情：」の行からは拾わない', () => {
    const content = [
      '■ 相談事項',
      '・感情：「もう無理です」と言いたげだった',
      '・生徒は「一つ目です」と言った',
      '・生徒は「二つ目です」と言った',
      '・生徒は「三つ目です」と言った',
      '・生徒は「四つ目です」と言った',
    ].join('\n');
    expect(extractQuotedWords(content).map((q) => q.quote)).toEqual([
      '一つ目です',
      '二つ目です',
      '三つ目です',
    ]);
  });

  it('★「」が続けて並ぶときは、最後の「」の後ろの「と」で全部を発言とみなす', () => {
    // 小川 華佳さんの実物の形
    const content = [
      '■ 前回の確認',
      '・今回の成績・内申状況については、明時点の結果は「最初にしては良い」「伸びしろがある」と前向きに評価されています。',
    ].join('\n');
    expect(extractQuotedWords(content)).toEqual([
      { quote: '最初にしては良い', speaker: null },
      { quote: '伸びしろがある', speaker: null },
    ]);
  });

  it('Nottaとして読めない手入力の記録からも拾う', () => {
    expect(extractQuotedWords('電話。お母さんが「助かります」と話していた')).toEqual([
      { quote: '助かります', speaker: '保護者' },
    ]);
  });
});

describe('extractQuotedWords（新しい型「印象に残った言葉」）', () => {
  it('★節があればその節だけを使い、話し手は末尾の（生徒）（保護者）から取る', () => {
    const content = [
      '■ 相談事項',
      '・生徒は「ここは拾わない言葉です」と話した',
      '■ 印象に残った言葉',
      '・「頑張ります」（生徒）',
      '・「塾に来てから明るくなった」（保護者）',
      '・最後まで諦めない（本人）',
      '・「ありがとうございます」（塾）',
    ].join('\n');
    expect(extractQuotedWords(content)).toEqual([
      { quote: '頑張ります', speaker: '生徒' },
      { quote: '塾に来てから明るくなった', speaker: '保護者' },
      { quote: '最後まで諦めない', speaker: '生徒' },
    ]);
  });

  it('★節が「（なし）」なら他の節の「」を推し量りで拾わない', () => {
    const content = [
      '■ 相談事項',
      '・生徒は「頑張ります」と話した',
      '■ 印象に残った言葉',
      '・（なし）',
    ].join('\n');
    expect(extractQuotedWords(content)).toEqual([]);
  });

  it('★見出しが箇条書きとして保存された記録（・印象に残った言葉）も見出しとして読む', () => {
    // 本番 9/23 の実物。見出し一覧に足す前の整形で取り込まれ、総合メモの1件になっていた
    const content = [
      '■ 総合メモ',
      '・英語と模試形式の問題への対応が今後の主な課題である。',
      '・印象に残った言葉',
      '・「行ってない。」（生徒）',
      '・「よくわかんない。」（生徒）',
    ].join('\n');
    expect(parseNottaSummary(content)!.sections).toEqual([
      { heading: '総合メモ', bullets: ['英語と模試形式の問題への対応が今後の主な課題である。'] },
      {
        heading: '印象に残った言葉',
        bullets: ['「行ってない。」（生徒）', '「よくわかんない。」（生徒）'],
      },
    ]);
    expect(extractQuotedWords(content, 'student_interview')).toEqual([
      { quote: '行ってない。', speaker: '生徒' },
      { quote: 'よくわかんない。', speaker: '生徒' },
    ]);
  });

  it('「」の後ろが「として」なら発言ではない', () => {
    const content = [
      '■ 総合メモ',
      '・ダンスは「勉強だけにならないための精神的支柱」として肯定的に捉えている。',
    ].join('\n');
    expect(extractQuotedWords(content)).toEqual([]);
  });

  it('★2026-09-24 の型（話し手を書かない）も拾える', () => {
    const content = ['■ 印象に残った言葉', '・「単語でいい。」', '・「英語はわかりません。」'].join(
      '\n'
    );
    expect(extractQuotedWords(content)).toEqual([
      { quote: '単語でいい。', speaker: null },
      { quote: '英語はわかりません。', speaker: null },
    ]);
  });
});

describe('extractQuotedWords（面談種別で話し手を決める・2026-09-24）', () => {
  // ★Nottaは声を聞き分けられないので、（生徒）（保護者）は当てにならない
  const content = [
    '■ 印象に残った言葉',
    '・「頑張ります」（生徒）',
    '・「塾に来てから明るくなった」（保護者）',
    '・「単語でいい。」',
  ].join('\n');

  it('生徒面談なら生徒。ただし（保護者）と書かれたものは食い違うので決めつけない', () => {
    expect(extractQuotedWords(content, 'student_interview')).toEqual([
      { quote: '頑張ります', speaker: '生徒' },
      { quote: '塾に来てから明るくなった', speaker: null },
      { quote: '単語でいい。', speaker: '生徒' },
    ]);
  });

  it('保護者面談（三者面談のこともある）・電話・その他は、印があっても話し手を決めない', () => {
    for (const type of ['parent_interview', 'phone', 'other']) {
      expect(extractQuotedWords(content, type).map((q) => q.speaker)).toEqual([null, null, null]);
    }
  });

  it('古い型の本文も同じ。生徒面談で本文が保護者と言っていれば null', () => {
    const old = [
      '■ 相談事項',
      '・生徒は「頑張ります」と発言しています。',
      '・お母様から「英語の長文を増やしてほしい」とのお話がありました。',
      '・「全部したら来るかな」と話が出た。',
    ].join('\n');
    expect(extractQuotedWords(old, 'student_interview')).toEqual([
      { quote: '頑張ります', speaker: '生徒' },
      { quote: '英語の長文を増やしてほしい', speaker: null },
      // ★話し手の語が無い古い型の「」は塾の言葉のこともあるので、生徒面談でも決めない
      { quote: '全部したら来るかな', speaker: null },
    ]);
  });

  it('（塾）（先生）の印・話者番号の言葉は、種別に関係なく拾わない', () => {
    const withJuku = [
      '■ 印象に残った言葉',
      '・「最後まで一緒にやろう」（塾）',
      '・「提出物は出そう」（先生）',
      '・話者 1：「お前がやってないからだよ」',
      '・「やってみます」',
    ].join('\n');
    expect(extractQuotedWords(withJuku, 'student_interview')).toEqual([
      { quote: 'やってみます', speaker: '生徒' },
    ]);
  });
});

describe('quotedWordTalkLine / quotedWordFactLine', () => {
  it('話し手ごとに言い方を変える。生徒は名前＋さん', () => {
    expect(quotedWordTalkLine({ quote: '頑張ります', speaker: '生徒' }, '律')).toBe(
      '前回、律さんは「頑張ります」と話していました'
    );
    expect(quotedWordTalkLine({ quote: '頑張ります', speaker: '生徒' }, '')).toBe(
      '前回、本人は「頑張ります」と話していました'
    );
    expect(quotedWordTalkLine({ quote: '助かります', speaker: '保護者' }, '律')).toBe(
      '前回、保護者の方は「助かります」とおっしゃっていました'
    );
    expect(quotedWordTalkLine({ quote: '最初にしては良い', speaker: null }, '律')).toBe(
      '前回の面談で「最初にしては良い」という言葉が出ていました'
    );
  });

  it('AIへは「前回の言葉:」の行で渡す', () => {
    expect(quotedWordFactLine({ quote: '頑張ります', speaker: '生徒' })).toBe(
      '前回の言葉: 「頑張ります」（生徒）'
    );
    expect(quotedWordFactLine({ quote: 'x言葉', speaker: null })).toBe('前回の言葉: 「x言葉」');
  });

  it('★buildTellSections の lastInterview に前回の言葉の行が乗る（AIに引用させるため）', () => {
    const tell = (interview_type: StudentInterview['interview_type']) =>
      buildTellSections({
        assessments: [],
        interviews: [
          interviewRow({
            interview_type,
            content: ['■ 相談事項', '・生徒は「頑張ります」と発言しています。'].join('\n'),
          }),
        ],
        textbookData: [],
        disciplineSessions: [],
        koushuEnrollments: [],
      }).find((s) => s.key === 'lastInterview')?.current;
    expect(tell('student_interview')).toContain('前回の言葉: 「頑張ります」（生徒）');
    // ★保護者面談は三者面談のこともあるので、AIにも話し手を渡さない（面談種別で決める）
    expect(tell('parent_interview')).toContain('前回の言葉: 「頑張ります」');
  });
});

/* ============================================================
 * 面談記録の検索
 * ========================================================== */

describe('面談記録の検索（matchesSearch / splitForHighlight）', () => {
  it('全角半角・大文字小文字を区別しない', () => {
    expect(matchesSearch('英検２級を受ける', '2級')).toBe(true);
    expect(matchesSearch('ETS の結果', 'ets')).toBe(true);
    expect(matchesSearch('ｽｲｾﾝ', 'スイセン')).toBe(true);
    expect(matchesSearch('推薦入試', '英検')).toBe(false);
  });

  it('空・空白だけの検索語は絞り込まない', () => {
    expect(normalizeSearchQuery('   ')).toBe('');
    expect(matchesSearch('何でも', ' ')).toBe(true);
  });

  it('★当たった所を元の文字のまま切り出す（複数回・全角も）', () => {
    expect(splitForHighlight('都立の推薦入試と推薦の条件', '推薦')).toEqual([
      { text: '都立の', hit: false },
      { text: '推薦', hit: true },
      { text: '入試と', hit: false },
      { text: '推薦', hit: true },
      { text: 'の条件', hit: false },
    ]);
    expect(splitForHighlight('英検２級', '2級')).toEqual([
      { text: '英検', hit: false },
      { text: '２級', hit: true },
    ]);
  });

  it('当たらなければ1片のまま', () => {
    expect(splitForHighlight('推薦入試', '英検')).toEqual([{ text: '推薦入試', hit: false }]);
    expect(splitForHighlight('推薦入試', '')).toEqual([{ text: '推薦入試', hit: false }]);
  });
});

/* ============================================================
 * 古い型の実物で見つかった読み違い（2026-09-24）
 * ========================================================== */

describe('古い型の読み違い（本番の実物・2026-09-24）', () => {
  it('★話し手は主語（保護者は／お母様から）を採る。いちばん近い語だけで決めない', () => {
    const content = [
      '■ 保護者からの要望',
      '・ただし、保護者（話者 2）は生徒の現状に対して危機感を共有しており、「本当やばいな」と感じている。',
      '・数学の結果について保護者から厳しい反応があり、生徒は落ち込みつつも「勉強すればいける」と話した。',
    ].join('\n');
    expect(extractQuotedWords(content)).toEqual([
      { quote: '本当やばいな', speaker: '保護者' },
      { quote: '勉強すればいける', speaker: '生徒' },
    ]);
  });

  it('「「…」という外部からの指摘」のような別の人の言葉は拾わない', () => {
    const content = [
      '■ 総合メモ',
      '・生徒はまだ進路が固まっておらず、「接客・まとめる仕事が向いている」という外部からの指摘はある。',
    ].join('\n');
    expect(extractQuotedWords(content)).toEqual([]);
  });

  it('★小見出しだけの行・「保護者の感情面：」「保護者・生徒の受け止め：」は②に拾わない', () => {
    const content = [
      '■ 保護者からの要望',
      '・学習面：数学1科目での受講を希望。',
      '・保護者の感情面：前向きに受け止めており、安心感が感じられる。',
      '・ただし、保護者は生徒の現状に危機感を持っている様子が見られる。',
      '■ 今後の方針',
      '・合意した対応・変更点：',
      '・教科書を毎日持ち帰る。',
      '・次回確認事項：',
      '・保護者・生徒の受け止め：様子見の状態。',
    ].join('\n');
    const { items } = buildPreviousCommitmentLines([interviewRow({ content })]);
    expect(items.map((i) => i.text)).toEqual([
      '学習面：数学1科目での受講を希望。',
      '教科書を毎日持ち帰る。',
    ]);
  });

  it('★古い型の【塾】【保護者】【生徒】も誰が動くかとして読む', () => {
    expect(parsePreviousBullet('【塾】テキストを発注・準備する。')).toEqual({
      text: 'テキストを発注・準備する。',
      actor: 'juku',
      tag: undefined,
      judgement: false,
    });
    expect(parsePreviousBullet('【保護者】カードをウェブで登録する。').actor).toBe('home');
    expect(parsePreviousBullet('【生徒】初回授業に参加する。').actor).toBe('student');
  });
});
