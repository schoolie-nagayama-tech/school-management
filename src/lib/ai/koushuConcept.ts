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
    '- コマ数は入れてよい（例:「（英語8コマ）」）。',
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
      lines.push(
        `単元: ${it.units.length > 0 ? it.units.map((u) => `${u.title} ${u.koma}コマ`).join(' / ') : '（未選択）'}`
      );

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
