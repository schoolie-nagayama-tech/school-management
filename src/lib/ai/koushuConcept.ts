/**
 * 講習テーマを、教室長が書いた一言から書き足す。
 *
 * 正典: docs/ai-features-integration-plan.md §2-5
 *
 * ★教室長が書いた「予習」の一言が、そのまま指示。入力欄は別に作らない。
 *   2026年夏期は776件（263名 × 科目）で、「予習」だけが51件、6字以下が250件。
 *   短いのも、同じ文面が8件並ぶのも、776件ぶん書く余裕がないから起きている。
 *   ★これは型が決まっているのではないので、既存のテーマの形には寄せない。
 *
 * ★個別指導なので、一人一人違う文になるのが正しい。
 *   同じ「予習」でも、単元が違えば書くことが変わり、成績が違えばどこから入るかが変わる。
 *
 * ★持っていない成績には触れない。263名のうち内申があるのは161名、定期テストは151名。
 *   残りに「基礎が不安」と書けば、それは作り話になる。
 */

import { SUBJECT_LABELS } from '@/types/database';

/** 学年から学校種別。評価科目マスタが学校種別ごとに別コードを持つため要る */
export function schoolTypeOfGrade(grade: number | null): '小学' | '中学' | '高校' | null {
  if (grade == null) return null;
  if (grade <= 6) return '小学';
  if (grade <= 9) return '中学';
  return '高校';
}

/**
 * 教材の科目（'英語' のような日本語ラベル）から、成績側の科目の値を拾う集合を作る。
 *
 * ★ここが噛み合っていなかった。教材マスタの科目は日本語ラベル
 *   （設定画面の選択肢が ['英語','数学','算数','国語','理科','社会']）なのに、
 *   成績は評価科目マスタのコード（中学英語なら 'jhs_english'）。等号で比べていたので
 *   成績は一度も見つからず、AIには毎回「記録なし」と伝わっていた。
 *   ＝「成績でどこから入るかを変える」が、そもそも一度も起きていなかった。
 *
 * ★一対一ではない。中学の「社会」は地理・歴史・公民の3コードに分かれるので、
 *   3つとも拾う（拾いすぎても、見るのはその生徒のその科目だけ）。
 *
 * ★保険を3枚重ねる。評価科目マスタが引けない教室でも、旧コードでも、
 *   日本語のまま入っている古いデータでも当たるようにする。
 *
 * ★教材の科目が空（過去問など、1冊で複数科目）のときは空集合を返す。
 *   どの科目の成績を見ればよいか決まらないので、憶測で拾わない。
 */
/**
 * 教材の科目ラベル → 同じ系統の成績コード。★実データに合わせた表。
 *
 * ★マスタと旧コードの2枚だけでは、本番の成績の多くに当たらなかった。本番（京王堀之内校）を見ると:
 *   - 中学・小学の成績は今も旧コード（'math' 'english' …）で入っていて、jhs_* / elem_* は0件。
 *   - 高校の成績は hs_* だが、教材ラベル「数学」に当たる1つのコードが無い
 *     （hs_math_1 / hs_math_a / hs_math_2 …と履修科目ごとに割れている）。
 *   - 評価科目マスタの中学「社会」は name が「社会(地理)」で、ラベル「社会」と等号では合わない。
 *   提案書172件のうち高校16件と「算数」12件が、材料はあるのに「記録なし」で送られていた。
 *
 * ★学校種別で絞らない。コードがすでに学校種別ごとに分かれていて絞る意味が無く、
 *   絞ると「中学生なのに教材の科目が算数」（本番に2件ある）で 'math' を落としてしまう。
 *
 * ★高校は1科目が複数コードに割れるので、拾ったうちの直近1件が使われる（呼び出し側の pickLatest）。
 *   どの履修科目かまでは見分けない。テーマに書くのは方針だけなので、これで足りる。
 *
 * ★小学の「外国語活動」（elem_eng_activity）は入れない。英語の成績として読ませると、
 *   持っていない成績に触れたのと同じことになる。無ければ触れない、を優先する。
 */
const SUBJECT_FAMILY: Record<string, readonly string[]> = {
  英語: [
    'english',
    'jhs_english',
    'elem_english',
    'hs_eng_com_1',
    'hs_eng_com_2',
    'hs_eng_com_3',
    'hs_logic_expr_1',
    'hs_logic_expr_2',
    'hs_logic_expr_3',
  ],
  // ★「算数」と「数学」は同じ系統。教材ラベルは分かれるが、成績は同じ 'math' に入っている
  数学: [
    'math',
    'jhs_math',
    'elem_math',
    'hs_math_1',
    'hs_math_a',
    'hs_math_2',
    'hs_math_b',
    'hs_math_3',
    'hs_math_c',
  ],
  国語: [
    'japanese',
    'jhs_japanese',
    'elem_japanese',
    'hs_gendai_kokugo',
    'hs_gengo_bunka',
    'hs_ronri_kokugo',
    'hs_bungaku_kokugo',
    'hs_kokugo_hyogen',
    'hs_koten_tankyu',
  ],
  理科: [
    'science',
    'jhs_science',
    'elem_science',
    'hs_phys_basic',
    'hs_chem_basic',
    'hs_bio_basic',
    'hs_earth_basic',
    'hs_phys',
    'hs_chem',
    'hs_bio',
    'hs_earth',
    'hs_kagaku_jinsei',
  ],
  社会: [
    'social',
    'elem_social',
    'jhs_social_geo',
    'jhs_social_history',
    'jhs_social_civics',
    'hs_chiri_sogo',
    'hs_rekishi_sogo',
    'hs_chiri_tankyu',
    'hs_nihonshi_tankyu',
    'hs_sekaishi_tankyu',
    'hs_kokyo',
    'hs_rinri',
    'hs_seikei',
  ],
};
// 算数は数学と同じ表を見る
SUBJECT_FAMILY.算数 = SUBJECT_FAMILY.数学;

export function subjectKeysForLabel(
  label: string,
  schoolType: '小学' | '中学' | '高校' | null,
  masters: readonly { code: string; name: string; school_type: string }[]
): Set<string> {
  const target = (label ?? '').trim();
  const keys = new Set<string>();
  if (!target) return keys;

  // 1. ラベルそのもの（日本語で入っている古いデータ向け）
  keys.add(target);

  // 2. 評価科目マスタ。学校種別が合うものと「共通」だけを見る
  for (const m of masters) {
    if ((m.name ?? '').trim() !== target) continue;
    if (schoolType && m.school_type !== schoolType && m.school_type !== '共通') continue;
    if (m.code) keys.add(m.code);
  }

  // 3. 旧コード（'english' など）。SUBJECT_LABELS の逆引き
  for (const [code, name] of Object.entries(SUBJECT_LABELS)) {
    if (name === target) keys.add(code);
  }

  // 4. 同じ系統のコード。★1〜3が当たらない本番データ（高校の hs_* と「算数」）の受け皿
  for (const code of SUBJECT_FAMILY[target] ?? []) keys.add(code);

  return keys;
}

/** 1件ぶんの材料。★その生徒のものだけを入れる */
export interface ConceptInput {
  proposalId: string;
  /** 教室長が書いた一言。空のこともある */
  theme: string;
  /** 学年ラベル（中1 など）。無ければ空 */
  gradeLabel: string;
  /** 科目名。無ければ空 */
  subject: string;
  /** 選んだ単元とコマ数 */
  units: { title: string; koma: number }[];
  /** 直近の定期テストの点数（その科目）。無ければ null */
  testScore: { label: string; value: number } | null;
  /** 直近の内申（その科目）。無ければ null */
  reportCard: { label: string; value: number } | null;
}

export interface ConceptResult {
  proposalId: string;
  theme: string;
}

/** 1回に投げる件数の上限。776件はクライアント側で分けて回す */
export const MAX_CONCEPTS_PER_CALL = 20;
/** テーマの長さの上限。本番の最長は82字 */
export const MAX_THEME_LENGTH = 120;

/** 単元を何件まで並べるか。★超えたぶんは頭と尻を残して間を省く */
export const MAX_UNITS_SHOWN = 12;
const UNITS_HEAD = 8;
const UNITS_TAIL = 4;

/**
 * 単元の行を作る。
 *
 * ★本番の単元は多い。提案書775件のうち21件以上が286件（37%）、最大116件。
 *   単元数とコマ数がほぼ一致している（1コマ1単元）ので、これは誤入力ではなく本物の計画。
 *   中3の総復習や高校の予習コースが、テキストの目次をそのまま並べた形になる。
 *
 * ★全部並べると、AIは42件のうち1件を選んで書くことになり、
 *   「否定文・命令文をやります」のように、計画のごく一部だけを指す文になってしまう。
 *   そこで多いときは頭と尻だけ見せる。範囲（どこからどこまで）が分かれば
 *   「文型から分詞構文まで」と書けて、42コマの計画を1行で正しく言える。
 *
 * ★省いた件数は明示する。黙って切ると「その単元はやらない」と読まれる。
 *
 * ★合計コマ数は数えて渡す。AIに42個の数を足させると間違えるため。
 */
export function formatUnitsLine(units: readonly { title: string; koma: number }[]): string {
  if (units.length === 0) return '単元: （未選択）';

  const totalKoma = units.reduce((sum, u) => sum + u.koma, 0);
  const head = `単元（${units.length}件・計${totalKoma}コマ）: `;
  const show = (u: { title: string; koma: number }) => `${u.title} ${u.koma}コマ`;

  if (units.length <= MAX_UNITS_SHOWN) return head + units.map(show).join(' / ');

  const omitted = units.length - UNITS_HEAD - UNITS_TAIL;
  return [
    head + units.slice(0, UNITS_HEAD).map(show).join(' / '),
    `…（間の${omitted}件は省略。やらないという意味ではない）…`,
    units.slice(-UNITS_TAIL).map(show).join(' / '),
  ].join(' / ');
}

export function conceptSystemPrompt(): string {
  return [
    'あなたは学習塾の教室長です。講習提案書の「講習テーマ」を1行で書きます。',
    '',
    '■ 何をするか',
    '- 教室長が書いた一言（例:「予習」「復習」「受験対策」）を、その生徒の単元と成績で書き足します。',
    '- ★一言の意味は変えない。「予習」と書いてあれば予習の話にする。',
    '- 一言が空なら、単元だけから書く。',
    '',
    '■ 書き方',
    '- 1行。30〜60字くらい。改行しない。',
    '- 何をやる講習かが分かる文にする。です・ます調。',
    '- ★型に嵌めない。生徒ごとに単元も成績も違うので、同じ言い回しを使い回さない。',
    '- ★渡された単元の名前を、最低1つそのまま使う。「基礎」「応用」のような抽象語に言い換えない。',
    '- ★単元が多いときは、1つだけ挙げて全体のように書かない。最初と最後の単元で範囲を示す',
    '  （例:「文型から分詞構文まで」）。40件の計画を1件の話にすると、別の講習の説明になる。',
    '- ★「…（間の◯件は省略…）…」は、見せていないだけで、やらない単元ではない。',
    '- コマ数は入れてよい（例:「（英語8コマ）」）。',
    '  ★書くなら「計◯コマ」として渡した数をそのまま使う。自分で足し算しない。',
    '',
    '■ 成績の使い方',
    '- ★渡された成績だけを見る。渡されていなければ、成績には一切触れない。',
    '  「基礎が不安」「定着していない」などと決めつけない。',
    '- 点数が低めなら戻ってやり直す書き方、高めなら先に進む書き方にしてよい。',
    '- ★点数や内申の数値そのものは書かない。保護者が読むものなので、書くのは方針だけ。',
    '',
    '■ 書かないもの',
    '- ★渡された単元に無いこと。',
    '- ★志望校。そもそも渡していない。',
    '- ★点数の約束。「◯点上がります」は書かない。',
    '- ★推薦文。「ぜひ」「おすすめです」「安心して」を書かない。何をやるかだけ。',
    '- ★生徒の名前。提案書の見出しにすでに出ている。',
    '',
    '出力はJSONだけ。渡された id をそのまま返す。前置きは書かない:',
    '{"themes":[{"id":"...","theme":"1学期の英文法をやり直してから、2学期の助動詞に入ります（英語8コマ）"}]}',
  ].join('\n');
}

export function conceptUserText(items: readonly ConceptInput[]): string {
  return items
    .map((it) => {
      const lines = [`--- id: ${it.proposalId}`];
      lines.push(`学年科目: ${[it.gradeLabel, it.subject].filter(Boolean).join(' ') || '不明'}`);
      lines.push(`教室長が書いた一言: ${it.theme.trim() || '（空）'}`);
      lines.push(formatUnitsLine(it.units));

      // ★持っている成績だけを書く。無い項目は行ごと出さない（「無い」と伝えて推測させない）
      const grades: string[] = [];
      if (it.testScore) grades.push(`${it.testScore.label} ${it.testScore.value}点`);
      if (it.reportCard) grades.push(`${it.reportCard.label} 内申${it.reportCard.value}`);
      if (grades.length > 0) lines.push(`成績: ${grades.join(' / ')}`);
      else lines.push('成績: 記録なし（成績には触れないこと）');

      return lines.join('\n');
    })
    .join('\n\n');
}

/**
 * AIの生の出力を、使ってよい形にする。
 *
 * ★渡していない id は捨てる。改行は消す（テーマは1行）。
 *   読めなかったものは結果に含めず、呼び出し側が「作れなかった」として扱う。
 */
export function parseConceptResult(raw: unknown, sent: readonly ConceptInput[]): ConceptResult[] {
  const allowed = new Set(sent.map((s) => s.proposalId));
  const rows =
    raw && typeof raw === 'object' && Array.isArray((raw as { themes?: unknown }).themes)
      ? ((raw as { themes: unknown[] }).themes as unknown[])
      : [];

  const seen = new Set<string>();
  const out: ConceptResult[] = [];

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const r = row as { id?: unknown; theme?: unknown };
    if (typeof r.id !== 'string' || !allowed.has(r.id)) continue;
    if (seen.has(r.id)) continue;
    if (typeof r.theme !== 'string') continue;

    // ★テーマは1行。改行が来たら潰す（一覧の見出しが崩れる）
    const theme = r.theme
      .replace(/\s*\n+\s*/g, ' ')
      .trim()
      .slice(0, MAX_THEME_LENGTH);
    if (!theme) continue;

    seen.add(r.id);
    out.push({ proposalId: r.id, theme });
  }

  return out;
}
