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
 * 既定で開くシーン。
 * ★①③⑦は毎回同じことを言う定型なので閉じておく。開くのは生徒ごとに中身が変わる②④⑤⑥。
 *   全部開くと縦に長くなり、結局読まれない（前身で「長いと読まれない」と学んだ）。
 */
export const SCENE_OPEN_BY_DEFAULT: Record<SceneKey, boolean> = {
  intro: false,
  hearing: true,
  timing: false,
  status: true,
  plan: true,
  apply: true,
  closing: false,
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
 * ③時期の重要性の定型トーク。学年区分 × 季節の15マス。
 *
 * ★ここを埋めるのは人間の仕事。AIに書かせない。毎回同じことを言う場所だから。
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
const TIMING_TEMPLATES: Record<GradeBand, Record<SeasonKey, readonly string[]>> = {
  elementary: {
    spring: [],
    summer: [],
    winter: [],
  },
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
      '年間学習計画を見ながら、いまがどの地点かを確認する',
      '7〜8月 ―― 部活が終わり、まとまった時間が取れる最後の時期',
      '9月以降 ―― 内申が決まる2学期。三者面談と出願までの流れ',
      '夏と冬の違い ―― 冬は範囲を詰められない。戻れるのは夏だけ',
      '内申1点の重み ―― 換算内申1点は当日の素点で約3点ぶん。当日がそのぶんラクになる',
      '★私立を併願するなら、動けるのは11月の三者面談まで。12月15日からは先生同士の入試相談',
    ],
    winter: [
      '都立は学力検査700点＋調査書300点＋スピーキング20点の1020点、1本の勝負',
      '内申はもう動かない ―― ここから伸ばせるのは当日の点だけ',
      '★私立の併願優遇は12月の入試相談で決着済み。2月の一般で戦うのはオープンの生徒',
      '併願優遇でも「加点型」の学校は当日の出来次第で落ちる。押さえたつもりにしない',
      '冬期 ―― 新しいことを増やさず、5教科の穴を埋めて過去問の型に慣れる',
      '二次募集は3教科・6:4・スピーキング無効。一次とは戦い方が違う',
    ],
  },
  high12: {
    spring: [],
    summer: [],
    winter: [],
  },
  high3: {
    spring: [],
    summer: [],
    winter: [],
  },
};

/**
 * ③のシーンに出す定型行を返す。まだ書かれていないマスは空を返す。
 * ★空のときは「入試まで◯日」だけを出す。埋め草を書かない。
 */
export function timingLines(grade: number | null, season: SeasonKey): readonly string[] {
  const band = gradeBandOf(grade);
  if (!band) return [];
  return TIMING_TEMPLATES[band][season];
}

/** まだ書かれていないマスの一覧。記入シートの進み具合を見るのに使う */
export function emptyTimingCells(): { band: GradeBand; season: SeasonKey }[] {
  const out: { band: GradeBand; season: SeasonKey }[] = [];
  for (const band of Object.keys(TIMING_TEMPLATES) as GradeBand[]) {
    for (const season of Object.keys(TIMING_TEMPLATES[band]) as SeasonKey[]) {
      if (TIMING_TEMPLATES[band][season].length === 0) out.push({ band, season });
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
