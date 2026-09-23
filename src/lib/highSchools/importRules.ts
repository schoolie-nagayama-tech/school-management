/**
 * 教育委員会の資料の学校名・学科名を、高校マスタの行に突き合わせる決まり。
 * ------------------------------------------------------------------
 * 取込スクリプト（scripts/import-high-school-facts.mjs）から使う。テストから直接触れるように純関数だけ置く。
 *
 * ★このファイルは Node の .mjs からも直接 import される。他の .ts を import しない。
 */

/**
 * 神奈川の資料の学校名 → マスタの学校名。
 *
 * マスタ（合格基準一覧表から起こした）は、県立は「希望ケ丘」、市立は「市立戸塚」の形。
 * 資料の書き方は2通りある。
 *   - 合格状況（bessi4）: 「県立希望ケ丘」「横浜市立桜丘」「川崎市立橘」
 *   - 生徒数（学校別）  : 学校名「桜丘」＋設置者の列「横浜市」
 * ★「市立」の前の市名は落とす。マスタに横浜・川崎・横須賀の区別が無い（同名の市立校は今のところ無い）。
 */
export function kanagawaMasterName(rawName: string, founder?: string): string {
  const name = rawName.normalize('NFKC').replace(/\s+/g, '');
  const m = name.match(/^(県立|横浜市立|川崎市立|横須賀市立|市立)(.+)$/);
  if (m) return m[1] === '県立' ? m[2] : `市立${m[2]}`;
  if (founder && founder !== '神奈川県') return `市立${name}`;
  return name;
}

/**
 * 資料の学科・コース名 → マスタの course（普通科の本体は空文字）。当たらなければ null。
 *
 * ★当たらないのは異常ではない。生徒数の資料は「（工業）」のような大くくりで、マスタは
 *   「機械」「電気」と学科ごと。無理に当てると別の学科の数字が付く。当たらない行は
 *   学校全体の値として course_label だけ残す。
 */
export function matchMasterCourse(label: string, masterCourses: readonly string[]): string | null {
  const raw = label
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .replace(/^[（(]|[）)]$/g, '');
  if (raw === '' || raw === '普通' || raw === '普通科') {
    return masterCourses.includes('') ? '' : null;
  }
  const candidates = [
    raw,
    raw.replace(/コース$/, ''),
    raw.replace(/科$/, ''),
    raw.replace(/^普通科/, ''),
    raw.replace(/^普通科/, '').replace(/コース$/, ''),
  ];
  for (const c of candidates) {
    if (c !== '' && masterCourses.includes(c)) return c;
  }
  return null;
}
