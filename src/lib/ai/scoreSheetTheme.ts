/**
 * 成績表から作った下書きの講習テーマを、AI に1から書かせる。
 * 正典: docs/score-sheet-plan-draft.md §7.1 ／ モック: https://claude.ai/artifact/XyCBdngNCCDY6noRMy2Xxs
 *
 * ★「テーマふくらませ」（koushuConcept.ts）との違い：
 *   あちらは保存済みの提案書に、教室長の一言を材料にして書き足す。
 *   こちらは保存前の下書きで、単元ごとの**根拠**（PCSの×・模試の×）と目的タグがそろっている。
 *   材料が足りているので一言は要らない（2026-09-30 ユーザー「これだけ材料あったらテーマ1から書けるよね」）。
 * ★教科ごとに1行。中3のゴール＋過去問のように同じ教科の冊は同じテーマにする。
 * ★送るのは学年・教科・教材名・単元・コマ・目的タグ・根拠の札だけ。氏名・偏差値・得点率・志望校は送らない。
 */

/** 単元1つ。reason は下書きの根拠の文字列（「PCS 比例の式 ×／進研 3(1) … ×」） */
export interface ThemeUnit {
  title: string;
  koma: number;
  intent: string | null;
  reason: string;
}

/** 教科1つぶんの材料 */
export interface ThemeInput {
  /** 教科のキー（'math' | 'eng'）。答えの突き合わせに使う */
  key: string;
  gradeLabel: string;
  subject: string;
  /** 使う教材の名前（「フォレスタステップ 2年」「都立入試過去問」など） */
  books: string[];
  units: ThemeUnit[];
}

export interface ThemeResult {
  key: string;
  theme: string;
}

/** 本番のテーマの最長は82字。1行に収める */
export const MAX_THEME_LENGTH = 120;
/** 単元を何件まで渡すか。★中3のコースでも40件は超えない。超えたら尻を切り、切ったことを書く */
export const MAX_THEME_UNITS = 40;
const MAX_INPUTS = 4;

export function themeSystemPrompt(): string {
  return [
    'あなたは学習塾の教室長です。講習提案書の「講習テーマ」を、教科ごとに1行で書きます。',
    '材料は、成績表（PCS＝学力診断テスト、進研テスト・Vもぎ＝模試）から組んだ講習の下書きです。',
    '',
    '■ 書き方',
    '- 1行。40〜70字くらい。改行しない。です・ます調。',
    '- 何をやる講習か、なぜその単元をやるのかが分かる文にする。',
    '- ★渡された単元の名前を、最低1つそのまま使う。「基礎」「応用」のような抽象語だけで済ませない。',
    '- ★根拠のある単元（苦手克服・苦手補強・応用発展）を中心に書く。「定着」「直前演習」は仕上げとして添える。',
    '- 単元が多いときは、1つだけ挙げて全体のように書かない。まとまり（例「比例・反比例と空間図形」）で言う。',
    '- 根拠の出どころは「PCS」「模試」と書いてよい（例「PCSで課題が出た〜」）。',
    '- 過去問があれば「過去問◯年分」と書いてよい。',
    '- コマ数は最後に「（数学12コマ）」の形で入れる。★渡した「計◯コマ」をそのまま使い、自分で足さない。',
    '- ★生徒ごとに単元も根拠も違う。同じ言い回しを使い回さない。',
    '',
    '■ 書かないもの（保護者が読む文なので）',
    '- ★点数・偏差値・正答率・設問番号（「3(1)」「問2」）などの数字。コマ数と年数だけは書いてよい。',
    '- ★「×」「△」「●」の記号。「課題が出た」「つまずいた」のように言葉にする。',
    '- ★渡された単元に無いこと。',
    '- ★志望校名。点数の約束（「◯点上がります」）。',
    '- ★推薦文。「ぜひ」「おすすめ」「安心」を書かない。何をやるかだけ。',
    '- ★生徒の名前。',
    '',
    '出力はJSONだけ。渡された key をそのまま返す。前置きは書かない:',
    '{"themes":[{"key":"math","theme":"PCSで課題が出た比例・反比例と空間図形の計量を中心に、正負の数から方程式までの計算を章ごとに確かめます（数学12コマ）"}]}',
  ].join('\n');
}

export function themeUserText(inputs: readonly ThemeInput[]): string {
  return inputs
    .map((it) => {
      const total = it.units.reduce((a, u) => a + u.koma, 0);
      const shown = it.units.slice(0, MAX_THEME_UNITS);
      const lines = [
        `--- key: ${it.key}`,
        `学年教科: ${[it.gradeLabel, it.subject].filter(Boolean).join(' ') || '不明'}`,
        `教材: ${it.books.join(' / ') || '不明'}`,
        `単元（${it.units.length}件・計${total}コマ）:`,
        ...shown.map(
          (u) =>
            `- ${u.title} ${u.koma}コマ` +
            (u.intent ? `［${u.intent}］` : '') +
            (u.reason ? `　根拠: ${u.reason}` : '')
        ),
      ];
      // ★黙って切ると「その単元はやらない」と読まれる（koushuConcept と同じ理由）
      if (it.units.length > shown.length) {
        lines.push(
          `…（残り${it.units.length - shown.length}件は省略。やらないという意味ではない）`
        );
      }
      return lines.join('\n');
    })
    .join('\n\n');
}

/**
 * 画面から来た材料を検める。★長さと件数を切る（プロンプトに何でも流し込ませない）
 */
export function sanitizeThemeInputs(raw: unknown): ThemeInput[] {
  if (!Array.isArray(raw)) return [];
  const str = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');
  const out: ThemeInput[] = [];
  for (const r of raw.slice(0, MAX_INPUTS)) {
    const o = r as Record<string, unknown>;
    const key = str(o?.key, 20);
    if (!key) continue;
    const units = (Array.isArray(o.units) ? o.units : [])
      .slice(0, 120)
      .map((u) => u as Record<string, unknown>)
      .filter((u) => typeof u.title === 'string' && u.title)
      .map((u) => ({
        title: str(u.title, 80),
        koma:
          typeof u.koma === 'number' && Number.isFinite(u.koma)
            ? Math.max(0, Math.min(20, u.koma))
            : 0,
        intent: typeof u.intent === 'string' ? u.intent.slice(0, 10) : null,
        reason: str(u.reason, 200),
      }));
    if (units.length === 0) continue;
    out.push({
      key,
      gradeLabel: str(o.gradeLabel, 10),
      subject: str(o.subject, 10),
      books: (Array.isArray(o.books) ? o.books : [])
        .slice(0, 5)
        .map((b) => str(b, 60))
        .filter(Boolean),
      units,
    });
  }
  return out;
}

/**
 * AI の答えを使ってよい形にする。★渡していない key は捨てる。改行は潰す（テーマは1行）
 */
export function parseThemeResult(raw: unknown, sent: readonly ThemeInput[]): ThemeResult[] {
  const allowed = new Set(sent.map((s) => s.key));
  const rows =
    raw && typeof raw === 'object' && Array.isArray((raw as { themes?: unknown }).themes)
      ? ((raw as { themes: unknown[] }).themes as unknown[])
      : [];
  const seen = new Set<string>();
  const out: ThemeResult[] = [];
  for (const row of rows) {
    const r = row as { key?: unknown; theme?: unknown } | null;
    if (!r || typeof r.key !== 'string' || !allowed.has(r.key) || seen.has(r.key)) continue;
    if (typeof r.theme !== 'string') continue;
    const theme = r.theme
      .replace(/\s*\n+\s*/g, ' ')
      .trim()
      .slice(0, MAX_THEME_LENGTH);
    if (!theme) continue;
    seen.add(r.key);
    out.push({ key: r.key, theme });
  }
  return out;
}
