/**
 * 模試（進研テスト・Vもぎ）の志望校欄を読む・高校マスタに当てる。
 * ------------------------------------------------------------------
 * 正典: docs/interview-workspace-layout-2026-09.md「模試の志望校」
 *
 * ★ここは純関数だけ（DBに触らない）。取り込み画面（MockPasteImportModal）と
 *   面談画面（interview.shared.ts）の両方から使い、テストから直接叩けるようにしてある。
 *
 * ■ 模試の志望校欄の形（2026-09 に教室長から受け取った実データより）
 *   - 志望校名と合格可能性の対が最大5つ。1〜3番目が公立、4〜5番目が私立
 *   - 空いている枠は半角スペース1つ（前後の対の位置は詰まらない）
 *   - 学校名は「学校－学科」（全角ダッシュ）。学科の無い書き方もある（「若葉総合」「専修大附属」）
 *   - 合格可能性は 10〜95 の数字か、`**`（判定不能）
 */

import { normalizeText } from '@/lib/ai/schoolLookup';

/** 模試の志望校欄の枠の数 */
export const MOCK_SCHOOL_SLOTS = 5;
/** ここまでの枠が公立（それより後ろは私立） */
export const MOCK_PUBLIC_SLOT_MAX = 3;

/** 模試の志望校1枠ぶん */
export interface MockSchoolChoice {
  /** 1〜5。模試の枠の位置そのまま（空き枠を詰めない） */
  slot: number;
  isPublic: boolean;
  /** 模試に書かれたままの学校名（「狛江－普通」） */
  nameRaw: string;
  /** 合格可能性（%）。判定不能・空欄は null */
  possibility: number | null;
  /**
   * 判定不能（`**`）だったか。
   * ★null と分けて持つ。「判定なし」を 0% と読むと、面談で「合格可能性ゼロ」と伝えてしまう。
   */
  unjudged: boolean;
}

/** 全角の英数字・記号を半角にそろえる（「６０」「＊＊」） */
function toHalfWidth(s: string): string {
  return s.replace(/[０-９＊]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

/**
 * 合格可能性の1マスを読む。
 * ★数字でないものは数字にしない。`**` のほか、見たことのない記号も「判定なし」に倒す
 *   （0 や NaN を保存すると、次の模試と比べたときに「下がった」に見える）。
 */
export function parsePossibility(raw: string | number | undefined | null): {
  possibility: number | null;
  unjudged: boolean;
} {
  if (raw === undefined || raw === null) return { possibility: null, unjudged: false };
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw >= 0 && raw <= 100
      ? { possibility: Math.round(raw), unjudged: false }
      : { possibility: null, unjudged: true };
  }
  const t = toHalfWidth(raw).replace(/[%％]/g, '').trim();
  if (t === '') return { possibility: null, unjudged: false };
  if (/^\d{1,3}$/.test(t)) {
    const n = Number(t);
    if (n <= 100) return { possibility: n, unjudged: false };
  }
  return { possibility: null, unjudged: true };
}

/**
 * 1行の中の「志望校名, 合格可能性」の対を、start 列目から最大5つ読む。
 * ★空き枠は飛ばすが、枠の番号（slot）は位置のまま振る。公立・私立の区別は位置で決まるため、
 *   詰めると「私立を公立として第1志望に入れる」事故になる。
 */
export function readMockSchoolPairs(
  cells: readonly (string | number | undefined | null)[],
  start: number
): MockSchoolChoice[] {
  const out: MockSchoolChoice[] = [];
  for (let slot = 1; slot <= MOCK_SCHOOL_SLOTS; slot++) {
    const at = start + (slot - 1) * 2;
    const name = String(cells[at] ?? '')
      .replace(/　/g, ' ')
      .trim();
    if (!name) continue;
    const { possibility, unjudged } = parsePossibility(cells[at + 1]);
    out.push({
      slot,
      isPublic: slot <= MOCK_PUBLIC_SLOT_MAX,
      nameRaw: name,
      possibility,
      unjudged,
    });
  }
  return out;
}

/** 合格可能性の表示。「60%」／「判定なし」／空欄は空文字 */
export function formatPossibility(c: { possibility: number | null; unjudged: boolean }): string {
  if (c.possibility != null) return `${c.possibility}%`;
  return c.unjudged ? '判定なし' : '';
}

/** 学校と学科の区切り。全角ダッシュが基本だが、手で直した行は半角やマイナス記号のこともある */
const DEPT_SEPARATOR = /[－\-−‐]/;

/**
 * 「狛江－普通」を学校と学科に分ける。
 * ★冠（都立・県立）と「高校」「高等学校」は外す。高校マスタの学校名に付いていないため。
 *   「市立」は外さない。神奈川のマスタは「市立橘」のように市立を名前に含んでいる。
 * ★学科の「普通」は空文字にする。マスタでは普通科の本体の course が空文字（NULLではない）。
 * ★学科の末尾の「科」も外す（「外国語科」と「外国語」を同じにする）。
 */
export function splitMockSchoolName(raw: string): { school: string; dept: string } {
  const text = normalizeText(raw).trim();
  const m = text.match(DEPT_SEPARATOR);
  const schoolPart = m ? text.slice(0, m.index) : text;
  const deptPart = m ? text.slice((m.index ?? 0) + 1) : '';
  const school = schoolPart
    .trim()
    .replace(/^(東京都立|神奈川県立|都立|県立)/, '')
    .replace(/(高等学校|高校)$/, '')
    .trim();
  const dept = deptPart.trim().replace(/科$/, '');
  return { school, dept: dept === '普通' ? '' : dept };
}

/**
 * 面談で読む短い学校名。「狛江－普通」→「狛江」、「駒沢学園女子－特進」→「駒沢学園女子（特進）」。
 * ★普通科は学科を付けない（面談で「狛江の普通科」とは言わない）。
 */
export function mockSchoolShortName(raw: string): string {
  const { school, dept } = splitMockSchoolName(raw);
  if (!school) return raw.trim();
  return dept ? `${school}（${dept}）` : school;
}

/** 当てに使う高校マスタの1行（high_schools の必要な列だけ） */
export interface HighSchoolKeyRow {
  id: string;
  prefecture: string;
  school_name: string;
  /** ★空文字＝普通科の本体 */
  course: string;
}

export interface MockSchoolMatch {
  /** マスタに当たればマスタの学校名、当たらなければ模試の学校名（冠・「高校」を外したもの） */
  schoolName: string;
  /** 学科。普通科は空文字 */
  course: string;
  /** 当たらなければ null（私立・他県・表記ゆれ） */
  highSchoolId: string | null;
}

/**
 * 模試に書かれた志望校名を高校マスタに当てる。
 *
 * ★当てるのは (学校名, 学科) の組。学科が違う行には当てない。
 *   「小平－外国語」を小平（普通科）に当てると、めやすの数字が別の学科のものになる。
 * ★学科の無い書き方（「若葉総合」）は、普通科の本体（course ''）を先に探し、
 *   無ければその学校の行が1つだけのときに限り当てる（「国際」は国際科の1行しかない）。
 * ★同じ名前が東京と神奈川の両方にある（「多摩」）。preferPrefecture（教室の都県）を先に選ぶ。
 * ★当たらなければ highSchoolId は null。私立はマスタに無いので、当たらないのが正常。
 */
export function matchMockSchoolName(
  raw: string,
  masterRows: readonly HighSchoolKeyRow[],
  preferPrefecture = '東京都'
): MockSchoolMatch {
  const { school, dept } = splitMockSchoolName(raw);
  const fallback: MockSchoolMatch = {
    schoolName: school || raw.trim(),
    course: dept,
    highSchoolId: null,
  };
  if (!school) return fallback;

  const sameName = masterRows.filter((r) => normalizeText(r.school_name).trim() === school);
  if (sameName.length === 0) return fallback;

  const courseOf = (r: HighSchoolKeyRow) => normalizeText(r.course).trim().replace(/科$/, '');
  let candidates = sameName.filter((r) => courseOf(r) === dept);
  if (candidates.length === 0 && dept === '') {
    // 学科を書いていない。その学校（都県ごと）の行が1つしか無いときだけ当てる
    const home = sameName.filter((r) => r.prefecture === preferPrefecture);
    const pool = home.length > 0 ? home : sameName;
    if (pool.length === 1) candidates = pool;
  }
  if (candidates.length === 0) return fallback;

  const picked = candidates.find((r) => r.prefecture === preferPrefecture) ?? candidates[0];
  return { schoolName: picked.school_name, course: picked.course, highSchoolId: picked.id };
}
