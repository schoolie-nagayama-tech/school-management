/**
 * 「単元の科目」を解決する唯一のヘルパー。
 *
 * ★背景: 過去問（入試の過去問題集）は1冊に全科目が載るので「テキスト1冊＝1科目」に収まらない。
 *   科目ごとに本を分けると、実物1冊なのに発注が5冊になってしまう。そこで科目を
 *   **教材ではなく単元**に持たせた（`curriculum_items.subject`）。
 *
 * ★既存データの意味は変えない: 単元の科目が NULL のときは従来どおり教材の科目
 *   （`textbooks.subject`）を使う。過去問以外は単元の科目が NULL なので、
 *   この関数を通しても結果は今までと同じになる。
 *
 * 科目の判定はここだけに置く。画面ごとに `?? ''` を書き足すと、
 * 「印刷では英語なのに集計では未分類」のような食い違いが静かに生まれる。
 */

/** 単元の科目。単元に科目があればそれ、無ければ教材の科目。どちらも無ければ空文字 */
export function resolveUnitSubject(
  unitSubject: string | null | undefined,
  textbookSubject: string | null | undefined
): string {
  const unit = (unitSubject ?? '').trim();
  if (unit) return unit;
  return (textbookSubject ?? '').trim();
}

/**
 * 教材の科目が空＝「1冊で複数科目を扱う教材」（過去問など）。
 * 科目は単元側に持たせてあるので、科目の絞り込みでは消さずにどの科目でも候補に出す。
 */
export function isAllSubjectTextbook(textbookSubject: string | null | undefined): boolean {
  return (textbookSubject ?? '').trim() === '';
}

/**
 * 教材の科目フィルタ（単一選択）。
 * 科目が空の教材（過去問）はどの科目で絞っても残す。絞り込みで消えると、
 * 「英語の提案書に過去問を足したい」ができなくなるため。
 */
export function matchesSubjectFilter(
  textbookSubject: string | null | undefined,
  filterSubject: string | null | undefined
): boolean {
  if (!filterSubject) return true;
  if (isAllSubjectTextbook(textbookSubject)) return true;
  return textbookSubject === filterSubject;
}

/** 教材の科目フィルタ（複数選択）。空選択＝絞り込まない。科目が空の教材は常に残す */
export function matchesSubjectSelection(
  textbookSubject: string | null | undefined,
  selected: Set<string>
): boolean {
  if (selected.size === 0) return true;
  if (isAllSubjectTextbook(textbookSubject)) return true;
  return !!textbookSubject && selected.has(textbookSubject);
}
