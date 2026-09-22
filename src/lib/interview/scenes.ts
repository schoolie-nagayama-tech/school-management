/**
 * 面談で話すことを、面談の流れ順（①導入〜⑦クロージング）に組む。
 * ------------------------------------------------------------------
 * 正典: docs/interview-script-ai-plan.md
 * 本部の「夏期保護者面談 チェックリスト」の7シーンに合わせてある。
 *
 * ★AIに投げる単位は従来どおり「セクション」（成績・宿題…）のままで、
 *   シーンへの割り当てはこのファイルの固定テーブルが決める。
 *   AIに順番を決めさせない、という前身からの原則を保つため。
 */

import type { BriefSectionKey } from '@/lib/ai/interviewBrief';
import type { Region } from '@/lib/interview/region';

/** シーン（本部チェックリストの①〜⑦）。この順に出す */
export const SCENE_KEYS = [
  'intro',
  'hearing',
  'timing',
  'status',
  'plan',
  'apply',
  'closing',
] as const;

export type SceneKey = (typeof SCENE_KEYS)[number];

export const SCENE_LABEL: Record<SceneKey, string> = {
  intro: '導入',
  hearing: 'ヒアリング',
  timing: '時期の重要性',
  status: '現状の確認',
  plan: 'プラン提示',
  apply: '申し込み',
  closing: 'クロージング',
};

/**
 * AIに渡すセクションを、どのシーンに置くか。
 * ★7セクションは②④⑤の3つに収まる。①③⑥⑦はAIを使わない。
 */
export const SCENE_OF_SECTION: Record<BriefSectionKey, SceneKey> = {
  lastInterview: 'hearing',
  parent: 'hearing',
  lessons: 'hearing',
  discipline: 'hearing',
  score: 'status',
  progress: 'status',
  koushu: 'plan',
};

/** 1行の種類。画面ではアイコンで区別する */
export type ScriptLineKind =
  /** 数字と事実。システムが組む */
  | 'tell'
  /** AIが書く着眼点。1文40字まで */
  | 'seen'
  /** NESTに記録が無いので面談で聞く。チェックできるが保存しない */
  | 'ask'
  /** 手元に用意する物 */
  | 'show';

export interface ScriptLine {
  kind: ScriptLineKind;
  text: string;
  /** 'warn'（注意して話す）／'good'（伝えたい良い話）／''。seen のときだけ付く */
  sign?: 'warn' | 'good' | '';
}

/**
 * 「聞くこと」＝ NESTにデータが無いので面談で確認する項目。
 * ★ここを埋めるためにDBに列を足さない。年1〜2回しか使わない情報を入力させても、
 *   入力されないまま古くなるだけ。面談の場で聞けば済む。
 */
export const ASK_LINES: Partial<Record<SceneKey, readonly string[]>> = {
  hearing: [
    '家庭学習の様子。机に向かう時間は取れているか',
    '学校の授業と宿題の進み具合',
    '学校生活の様子（部活動の引退後の過ごし方など）',
    '学校の面談で言われたこと',
    '次の定期テスト・模試の目標を決める',
  ],
  status: ['検定資格（英検・漢検など）を取っているか'],
};

/**
 * 「見せる」＝ 面談に手元に用意しておく物。
 * ★PCS・ETSの回収状況（講習進捗表の「PCS回収」列）やプラン表の実データ連携は今回のパスでは
 *   繋いでいない（正典 §5 は次段の課題）。ここは固定の持ち物リストにとどめ、
 *   無い情報を「回収済み」のように断定しない。
 */
export const SHOW_LINES: Partial<Record<SceneKey, readonly string[]>> = {
  status: ['PCS・ETSの結果表（回収できていれば）'],
  plan: ['プラン表・使用教材・日程表の例（手元の資料から）'],
};

export type SeasonKey = 'summer' | 'winter' | 'spring';

export const SEASON_LABEL: Record<SeasonKey, string> = {
  summer: '夏期',
  winter: '冬期',
  spring: '春期',
};

/**
 * 受験学年かどうかで話す内容が変わる。
 * 学年は小1=1 から始まる通し番号で、9=中3・12=高3（正典: GRADE_LABELS）。
 * 13=既卒はここでは受験学年として扱わない（面談の型が違う）。
 */
export function isExamGrade(grade: number | null): boolean {
  return grade === 9 || grade === 12;
}

/** 学年の区分。話す内容がここで変わる */
export type GradeBand = 'elementary' | 'junior12' | 'junior3' | 'high12' | 'high3';

export const GRADE_BAND_LABEL: Record<GradeBand, string> = {
  elementary: '小学生',
  junior12: '中1・中2',
  junior3: '中3',
  high12: '高1・高2',
  high3: '高3',
};

/**
 * 学年（小1=1 の通し番号）から区分を出す。
 * 13=既卒は面談の型そのものが違うので null（＝定型を出さない）。
 */
export function gradeBandOf(grade: number | null): GradeBand | null {
  if (grade == null) return null;
  if (grade >= 1 && grade <= 6) return 'elementary';
  if (grade === 7 || grade === 8) return 'junior12';
  if (grade === 9) return 'junior3';
  if (grade === 10 || grade === 11) return 'high12';
  if (grade === 12) return 'high3';
  return null;
}

/**
 * ③時期の重要性の定型トーク。
 *
 * ★ここを埋めるのは人間の仕事。AIに書かせない。毎回同じことを言う場所だから。
 *
 * ■ 2層に分かれている
 *   COMMON_TIMING_LEAD ―― 都県の話に入る前に言うこと（この時期が何の時期か）
 *   REGION_TIMING      ―― 都県ごとの話。★入試制度・日程・教科別対策はすべてこちら
 *   COMMON_TIMING_TAIL ―― 都県の話のあとに言うこと（ご家庭へのお願いなど）
 *   実際に出るのはこの順に繋げたもの（timingLines）。
 *
 *   ★LEAD と TAIL に分けてあるのは、共通の行をまとめて先頭に出すと
 *     「ご家庭へ ―― 体調管理」が話の2行目に来てしまうため。締めの言葉は締めに置く。
 *
 *   ★制度の話を COMMON に書かない。都立は1020点の総合得点1本・併願優遇は12月15日の
 *     入試相談、神奈川は打診値表と前期/後期の内申。混ぜると面談でそのまま事故る。
 *
 * ■ 1マスに書く観点（本部の「夏期保護者面談 チェックリスト」③より）
 *   1. 目標達成までの期間 ―― 入試まで／学年末まで、あと何か月か
 *   2. 年間学習計画の中でのいまの位置 ―― 前の時期・この時期・次の時期に何が起きるか
 *   3. この季節の意味 ―― 他の季節との違い（夏と冬は何が違うのか）
 *   4. 目標達成のためにやること ―― 家庭にて／学校にて／IEにて
 *
 * ■ 書き方
 *   - 1行1メッセージ。保護者に読み上げるのではなく、話す順の覚え書き
 *   - 「7〜8月 ―― …」のように、時期と中身を全角ダッシュで区切ると読みやすい
 *   - 空配列のままにしておけば、その組み合わせでは定型行を出さない（埋め草を書かない）
 *
 * ■ 記入シート: docs/interview-timing-talks.md
 *   そちらに観点と記入例、空欄の表がある。書いたものをここへ写す。
 */
type TimingGrid = Record<GradeBand, Record<SeasonKey, readonly string[]>>;

/**
 * 神奈川・中3・冬期の教科別の話（2026-09-22・緑園都市校の教室長）。
 *
 * ★③「なぜ今なのか」の答えであると同時に、⑤「なぜこの教科・この単元か」の根拠でもある。
 *   両方に同じ行を出すので、定数はここ1つ。片方だけ直すと面談の中で食い違う。
 *
 * ★公立と私立でやることが分かれる。NESTは生徒がどちらを受けるか持っていないので、
 *   両方を出して面談で選んでもらう。行頭の【公立】【私立】はそのための印。
 */
const KANAGAWA_JUNIOR3_WINTER_SUBJECTS: readonly string[] = [
  '【公立】英語 ―― 長文は700語が3題で40点。ここが取れないと点にならない',
  '【公立】英語 ―― 問2・問3・問4は短時間で切り抜ける練習が要る',
  '【公立】数学 ―― 問1〜問3をノーミスで64点。ここだけで偏差値55に届きうる',
  '【公立】国語 ―― 問5の資料読み取りで10点。偏差値が1変わる得点源',
  '【公立】理科・社会 ―― 過去問の前に問題ベースで1周できる最後のチャンス',
  '【私立】中学内容の総復習。高校内容に入る前に1周触れておくと入りやすい',
  '【私立】理科・社会で学校が終わっていない範囲の予習。知らないまま高校に行くと大変',
];

/** 都県によらず同じ話のうち、都県の話より前に言うこと */
const COMMON_TIMING_LEAD: TimingGrid = {
  elementary: { spring: [], summer: [], winter: [] },
  junior12: { spring: [], summer: [], winter: [] },
  junior3: {
    spring: [],
    summer: ['年間学習計画を見ながら、いまがどの地点かを確認する'],
    winter: ['受験間近。最後の追い込みの時期'],
  },
  high12: { spring: [], summer: [], winter: [] },
  high3: { spring: [], summer: [], winter: [] },
};

/** 都県によらず同じ話のうち、都県の話のあとに言うこと（締めの言葉） */
const COMMON_TIMING_TAIL: TimingGrid = {
  elementary: { spring: [], summer: [], winter: [] },
  junior12: { spring: [], summer: [], winter: [] },
  junior3: {
    spring: [],
    summer: [],
    // ★教室長の言葉で書いた（2026-09-22）。ここは都県によらず同じ
    // ★「一喜一憂しない」は2人の教室長が別々に挙げた。都県によらず言うことなので共通に置く。
    //   予防接種と過去問も制度の話ではないので共通（3人目の回答から）。
    winter: [
      'ご家庭へ ―― 体調管理と、結果に一喜一憂しないこと。応援してやってください',
      'ご家庭へ ―― インフルエンザの予防接種を受けておく',
      'ご家庭へ ―― 一般入試を受けるなら、過去問は必ず用意する',
    ],
  },
  high12: { spring: [], summer: [], winter: [] },
  high3: { spring: [], summer: [], winter: [] },
};

/** 都県ごとの話。★入試制度・日程・教科別対策はここ */
const REGION_TIMING: Record<Region, TimingGrid> = {
  tokyo: {
    elementary: { spring: [], summer: [], winter: [] },
    junior12: {
      spring: [],
      // ★中1・中2に内申の話をするのは早すぎない。都立の調査書点は中3の評定で決まるが、
      //   その中3の授業は中1・中2の積み残しの上に乗る。ここを外すと夏の意味が伝わらない。
      summer: [
        '7〜8月 ―― 学校が止まる。つまずいた単元まで戻れるのは夏だけ',
        '2学期 ―― 内容が一段難しくなる。ここで差がつく',
        '中3の内申は中3の授業で決まるが、その授業は中1・中2の上に乗る',
      ],
      winter: [
        '冬は範囲が短い ―― 戻る時間は取れない。いまの単元を固める時期',
        '学年末テスト ―― 1年間の総まとめ。ここの評定が次の学年の土台になる',
        '春 ―― 次の学年が始まる前に、苦手を残さず上げる',
      ],
    },
    junior3: {
      spring: [
        '受験の年が始まった ―― 内申が決まるのは2学期。逆算するとあと2回のテスト',
        '1学期の内申も調査書に効く。ここから手を抜けない',
        '志望校は夏の間に絞る。9月以降は動かしにくくなる',
      ],
      // 本部のチェックリスト（中3・夏期版）から起こしたものに、
      // vault の高校入試情報（都立1020点・私立12月相談）で肉付けした
      summer: [
        '7〜8月 ―― 部活が終わり、まとまった時間が取れる最後の時期',
        '9月以降 ―― 内申が決まる2学期。三者面談と出願までの流れ',
        '夏と冬の違い ―― 冬は範囲を詰められない。戻れるのは夏だけ',
        '内申1点の重み ―― 換算内申1点は当日の素点で約3点ぶん。当日がそのぶんラクになる',
        '★私立を併願するなら、動けるのは11月の三者面談まで。12月15日からは先生同士の入試相談',
      ],
      // ★教室長の言葉で書き直した（2026-09-22）。資料から起こした制度の説明より、
      //   実際に面談で使っている言い方のほうが通じる。制度の話は「言い忘れると事故る」
      //   1行だけ残し、あとは落とした。
      // ★2026-09-22に3人目の教室長の回答を統合した。
      //   「内申が確定する」→「仮内申が決まる」に直してある。この時期に出るのは仮内申で、
      //   調査書が確定するのは年明け。面談で「確定」と言うと質問の前提がずれる。
      winter: [
        '学校では ―― 2学期の期末テストと進路決定。ここで仮内申が決まる',
        '学校では ―― 三者面談。先生から私立の単願を勧められることがある',
        'なぜ今か ―― 仮内申が出るのがこの少し先。12月上旬には私立の単願・併願を決める',
        '学校は進路未定の生徒を早いうちに無くそうと動く。押し切られる前に家庭の基準を作る',
        '12月頭に私立が決まる。見学は今のうちに',
        '都立は1月まで悩んでよい。ただし「何を基準に決めるか」は今決めておく',
        '★併願優遇でも「加点型」の学校は当日の出来次第で落ちる。押さえたつもりにしない',
        '★私立の単願推薦・併願優遇は12月11日あたりまでに決める（入試相談日が12月15日）',
      ],
    },
    high12: { spring: [], summer: [], winter: [] },
    high3: { spring: [], summer: [], winter: [] },
  },
  kanagawa: {
    elementary: { spring: [], summer: [], winter: [] },
    junior12: { spring: [], summer: [], winter: [] },
    junior3: {
      spring: [],
      summer: [],
      // ★教室長の言葉で書いた（2026-09-22・緑園都市校）。神奈川は都立と別制度。
      //   打診値表・前期/後期の内申・共通選抜。東京の行をここに流用しない。
      winter: [
        '学校では ―― 2学期（2期制なら前期）の内申の大詰め。11月末に仮内申が出る',
        '提出物の〆切と文化祭準備が重なる時期',
        ...KANAGAWA_JUNIOR3_WINTER_SUBJECTS,
        'ご家庭へ ―― 高校継続の確約／併願私立の確定／コマを取るための覚悟',
        '★併願私立は12月上旬までに決定。公立の志望校は1月上旬までに確定',
      ],
    },
    high12: { spring: [], summer: [], winter: [] },
    high3: { spring: [], summer: [], winter: [] },
  },
};

/**
 * ③のシーンに出す定型行を返す。まだ書かれていないマスは空を返す。
 * ★空のときは「入試まで◯日」だけを出す。埋め草を書かない。
 * ★region が null（教室が region.ts に未登録）のときは共通の行だけ。
 *   知らない都県に東京の制度の話をするより、行が消えたほうが安全。
 */
export function timingLines(
  grade: number | null,
  season: SeasonKey,
  region: Region | null
): readonly string[] {
  const band = gradeBandOf(grade);
  if (!band) return [];
  const local = region ? REGION_TIMING[region][band][season] : [];
  return [...COMMON_TIMING_LEAD[band][season], ...local, ...COMMON_TIMING_TAIL[band][season]];
}

/**
 * ③の想定問答。「保護者からよく聞かれること」と「それにどう答えているか」の対。
 *
 * ★教室長3人に同じ6項目を聞いたところ、3人とも項目3・4（よく聞かれること／答え方）に
 *   いちばん多く書いた。定型トークの中でここだけは読み上げる順でなく**引く**ものなので、
 *   1行の文字列ではなく問と答の対で持つ。
 *
 * ★答えは「こう答えている」であって模範解答ではない。教室長が実際に使っている言い方。
 */
export interface TimingQa {
  q: string;
  a: string;
}

type QaGrid = Partial<Record<GradeBand, Partial<Record<SeasonKey, readonly TimingQa[]>>>>;

/** 都県によらず同じ問答 */
const COMMON_TIMING_QA: QaGrid = {
  junior3: {
    winter: [
      {
        q: 'まだ受験生の意識が無いのですが、大丈夫ですか',
        a: '心配ですね。ただ、焦り出すのは仮内申が出たあとや冬休みからが多い ―― やる気の有無にかかわらず、勉強の機会と量を確保するのが大事です',
      },
      {
        q: '成績ギリギリの高校に入って、授業についていけますか',
        a: '入試のあとも学習習慣を維持できれば消せる不安です（「素晴らしい高校生活をおくるために」を掻い摘んで話す）',
      },
    ],
  },
};

/** 都県ごとの問答。★制度・日程・学校選びの話はこちら */
const REGION_TIMING_QA: Record<Region, QaGrid> = {
  tokyo: {
    junior3: {
      winter: [
        {
          q: 'うちの子、受かりますか／まだ間に合いますか',
          a: '最後の取り組み次第で合格レベルまでは上がります。偏差値は最後まで伸びます。1月の模試を見て決めましょう',
        },
        {
          q: '今の成績で合格できる高校はありますか',
          a: 'Vもぎの結果から「今の成績がキープされた場合」という条件付きで、倍率ごとに合格可能性を伝える',
        },
        {
          q: '私立の併願はどこがいいですか',
          a: '成績基準の中で希望に合う学校があれば提案する。無ければ、一般入試の合格で入学手続きを待ってくれる高校を伝える',
        },
        {
          q: '併願校はどう選べばいいですか',
          a: '「2番目に行きたい（入ってもいいかな）」と感じる高校を直感で選ぶ。そのうえで説明会・相談会に直接行ってもらう（成績基準を満たす高校はこちらから案内する）',
        },
        {
          q: '都立の最終受験先はいつ決めればいいですか',
          a: '1月のVもぎが終わってからでよい。12〜1月にVもぎを4回受けてもらえば、倍率に応じた合格可能性を精度高く出せる。最終判断は出願の取り下げ日でも間に合う',
        },
        {
          q: '都立の推薦入試は受けたほうがいいですか',
          a: '確固たる第一志望なら、仮内申の結果に関わらず薦める。語弊を恐れずに言えば「模擬テスト代わりに」。受験機会が増えること、経験則だが2回目の一般入試で受かる生徒が9割以上であることの2つが理由',
        },
      ],
    },
  },
  kanagawa: {
    junior3: {
      winter: [
        {
          q: '私立の志望校はどこがいいですか（内申との兼ね合い）',
          a: '打診値表を見ながら「11月の内申がここまで上がれば○○高校、そのままなら○○高校」と幅で示す',
        },
        {
          q: '公立の志望校はどうしますか（模試結果との兼ね合い）',
          a: '偏差値表と模試結果を並べて「あと偏差値◯・点数で◯点」まで落とし、埋める単元まで決める',
        },
        {
          q: '理科・社会はどうしましょう',
          a: '冬期中におさらいしましょう',
        },
      ],
    },
  },
};

/**
 * ③に出す想定問答。共通 → 都県の順。
 * ★region が null のときは共通の問答だけ。
 */
export function timingQa(
  grade: number | null,
  season: SeasonKey,
  region: Region | null
): readonly TimingQa[] {
  const band = gradeBandOf(grade);
  if (!band) return [];
  const common = COMMON_TIMING_QA[band]?.[season] ?? [];
  const local = region ? (REGION_TIMING_QA[region][band]?.[season] ?? []) : [];
  return [...common, ...local];
}

/**
 * ⑤プラン提示で出す「なぜこの教科・この単元なのか」。
 *
 * ★③と同じ行をもう一度出している。③では「なぜ今か」、⑤では「だから何をやるか」として
 *   読む。面談は①から順に進むので、プラン表を開いた場で根拠が手元にあるほうが使える。
 *
 * ★ここは入試制度の話なので都県ごと。共通の層は持たない。
 */
type PartialTimingGrid = Partial<Record<GradeBand, Partial<Record<SeasonKey, readonly string[]>>>>;

const REGION_PLAN_RATIONALE: Record<Region, PartialTimingGrid> = {
  tokyo: {},
  kanagawa: { junior3: { winter: KANAGAWA_JUNIOR3_WINTER_SUBJECTS } },
};

/** ⑤に出す「なぜこの教科・この単元か」の行。無ければ空 */
export function planRationaleLines(
  grade: number | null,
  season: SeasonKey,
  region: Region | null
): readonly string[] {
  const band = gradeBandOf(grade);
  if (!band || !region) return [];
  return REGION_PLAN_RATIONALE[region][band]?.[season] ?? [];
}

/**
 * まだ都県ごとの行が1つも書かれていないマスの一覧。記入シートの進み具合を見るのに使う。
 *
 * ★見るのは REGION_TIMING だけ。共通の層に1行あるだけのマスを「記入済み」と
 *   数えると、制度の話が抜けたまま埋まったことになってしまう。
 */
export function emptyTimingCells(): { region: Region; band: GradeBand; season: SeasonKey }[] {
  const out: { region: Region; band: GradeBand; season: SeasonKey }[] = [];
  for (const region of Object.keys(REGION_TIMING) as Region[]) {
    for (const band of Object.keys(REGION_TIMING[region]) as GradeBand[]) {
      for (const season of Object.keys(REGION_TIMING[region][band]) as SeasonKey[]) {
        if (REGION_TIMING[region][band][season].length === 0) out.push({ region, band, season });
      }
    }
  }
  return out;
}

/** ①導入・⑦クロージングの定型。学年・季節によらず同じ */
export const INTRO_LINES: readonly string[] = [
  '来塾への謝意を伝える',
  '面談の目的と内容を伝える',
  '面談の所要時間を伝える',
];

export const CLOSING_LINES: readonly string[] = [
  '書類を渡す（申込書控え・日程表・報告カウンセリングのお知らせ）',
  '報告カウンセリングの実施を告知する',
  'ご紹介のご案内',
  '来塾への謝意を伝え、出口までお見送りする',
];

/**
 * ⑥申し込みの定型。
 * ★金額・支払い方法・締切は教室や期ごとに違い、NESTに設定が無い。
 *   架空の数字を置くと面談でそのまま読まれるので、[ ] のまま出して
 *   「手元の資料を見る」と分かる形にしている。設定を持つようになったら差し替える。
 */
export const APPLY_LINES: readonly string[] = [
  '授業料と教材費を伝える（手元の資料から）',
  '支払い方法と期限を伝える',
  '申込書と日程表の書き方を説明する',
  '日程表の提出〆切を伝える',
];
