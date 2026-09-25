#!/usr/bin/env node
// docs/data/private/ の書き起こし → high_schools（私立・国立）＋ high_school_admission_rules ＋ high_school_standards
//
// 使い方:
//   node scripts/import-private-high-schools.mjs          # 下見（書き込まない）。検査結果と突き合わせの漏れを出す
//   node scripts/import-private-high-schools.mjs --go     # 実際に入れる
//
// 正典: docs/private-high-school-master.md
//
// 材料（docs/data/private/）:
//   criteria-*.json  … 冊子「推薦・一般入試の基準表」の書き起こし（1ページ1ファイル）
//   hensachi-*.json  … Vもぎ「私立高校 合格のめやす」の書き起こし（男子表・女子表）
//   hensachi-aliases.json … 偏差値表の「学校名(コース)」→ 基準表の学校・コースの対応（表記が違うものだけ）
//   meta.json        … 出典名・年度・ラベル
//
// ★写真からAIが書き起こしたもの。verified_at は入れない（人が紙と突き合わせてから別に付ける）。
// ★基準は版を積む。同じ (source, source_year) の基準は、この取込で入れ直す（全部消してから入れる）。
//   別の年度の基準は消さない（過去の面談の判定を後から再現できるように）。
// ★1000行を超える書き込み・読み込みは分けて行う（PostgREST の既定の上限で静かに切れるため）。

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

const ENV = existsSync('.env.local') ? '.env.local' : resolve(process.cwd(), '../../../.env.local');
config({ path: ENV });

const GO = process.argv.includes('--go');
const DIR = 'docs/data/private';
const meta = JSON.parse(readFileSync(`${DIR}/meta.json`, 'utf8'));

const SUBJECTS = new Set(['国', '数', '英', '理', '社', '音', '美', '保体', '技家']);
const SETS = new Set(['3科', '5科', '9科', '実技4科']);
const KINDS = new Set(['推薦', '単願', '併願']);
const SECTIONS = new Set(['推薦', '一般']);

const problems = [];
const warn = (where, msg) => problems.push(`${where}: ${msg}`);

// ------------------------------------------------------------
// 条件の形を検める（判定ロジック src/lib/interview/privateAdmission.ts が読める形か）
// ------------------------------------------------------------
function checkSet(s, where) {
  if (typeof s === 'string') {
    if (!SETS.has(s)) warn(where, `教科の束が不明: ${s}`);
    return;
  }
  if (Array.isArray(s)) {
    for (const x of s) if (!SUBJECTS.has(x)) warn(where, `教科名が不明: ${x}`);
    return;
  }
  if (s && typeof s === 'object' && Number.isInteger(s.best)) {
    checkSet(s.of, where);
    for (const x of s.plus ?? []) if (!SUBJECTS.has(x)) warn(where, `教科名が不明: ${x}`);
    return;
  }
  warn(where, `教科の束の形が不正: ${JSON.stringify(s)}`);
}

function checkClause(c, where) {
  if (!c || typeof c !== 'object') return warn(where, `条件が空`);
  switch (c.t) {
    case 'sum':
    case 'avg':
    case 'each':
      checkSet(c.s, where);
      if (typeof c.min !== 'number' || Number.isNaN(c.min))
        warn(where, `min が数でない: ${JSON.stringify(c)}`);
      break;
    case 'none_le':
    case 'any_ge':
      checkSet(c.s, where);
      if (typeof c.grade !== 'number') warn(where, `grade が数でない: ${JSON.stringify(c)}`);
      break;
    case 'cert':
      if (!c.name) warn(where, `検定名が無い`);
      break;
    case 'manual':
      if (!c.text) warn(where, `manual の文が無い`);
      break;
    default:
      warn(where, `条件の種類が不明: ${c.t}`);
  }
  for (const y of c.years ?? []) {
    if (![1, 2, 3].includes(y.grade) || typeof y.w !== 'number')
      warn(where, `years が不正: ${JSON.stringify(c.years)}`);
  }
}

/**
 * 判読できなかった数値（min / grade が null）の条件は、式のまま入れず「要確認」の manual に倒す。
 * ★null のまま入れると、判定で 基準 null − 本人 がマイナスになり「届いている」と出てしまう。
 *   読めない数字で「届いている」と言うのが一番危ない。
 */
function sanitizeClause(c) {
  if (!c || typeof c !== 'object') return { t: 'manual', text: '判読できない条件（冊子で確認）' };
  const needsMin = ['sum', 'avg', 'each'].includes(c.t);
  const needsGrade = ['none_le', 'any_ge'].includes(c.t);
  if ((needsMin && typeof c.min !== 'number') || (needsGrade && typeof c.grade !== 'number')) {
    return { t: 'manual', text: `数値が判読できない条件（冊子で確認）: ${JSON.stringify(c)}` };
  }
  return c;
}

/** 加点の点数が冊子に無い項目（points=null）は 0 点にして、ラベルに印を付ける（見込みに数えない） */
function normalizeBonus(b, where) {
  if (!b) return null;
  const items = (b.items ?? []).map((raw) => {
    if (raw.when) checkClause(raw.when, `${where} 加点`);
    const it = raw.when ? { ...raw, when: sanitizeClause(raw.when) } : raw;
    if (typeof it.points === 'number') return it;
    return { ...it, points: 0, label: `${it.label}（点数は冊子に記載なし）` };
  });
  return {
    max: typeof b.max === 'number' ? b.max : null,
    max_by: b.max_by ?? null,
    applies_to: b.applies_to ?? null,
    items,
    note: b.note ?? null,
  };
}

// ------------------------------------------------------------
// 読み込み
// ------------------------------------------------------------
const files = readdirSync(DIR);
const criteriaFiles = files.filter((f) => /^criteria-.*\.json$/.test(f)).sort();
const hensachiFiles = files.filter((f) => /^hensachi-\d+\.json$/.test(f)).sort();
const aliases = existsSync(`${DIR}/hensachi-aliases.json`)
  ? JSON.parse(readFileSync(`${DIR}/hensachi-aliases.json`, 'utf8'))
  : {};

const key = (p, e, n, c) => `${p}|${e}|${n}|${c}`;
const schoolRows = new Map(); // key → high_schools の行
const ruleRows = []; // { key, row }

/** 冊子の性の列 → high_schools.gender_type */
function genderType(g) {
  return g === '男子' || g === '女子' || g === '共学' ? g : null;
}

/** 募集欄の頭の略記から学科を推す（普→普通科 など）。分からなければ普通科 */
function categoryOf(raw) {
  const r = String(raw ?? '');
  if (/^工|工業|機械|電気|電子|情報工/.test(r)) return '工業科';
  if (/^商|商業/.test(r)) return '商業科';
  if (/音楽/.test(r)) return '音楽科';
  if (/美術|デザイン/.test(r)) return '美術科';
  if (/^家|家政|食物/.test(r)) return '家政科';
  if (/体育|スポーツ/.test(r) && !/^普/.test(r)) return '体育科';
  return '普通科';
}

for (const f of criteriaFiles) {
  const page = JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8'));
  const pageLabel = page.page_label ?? null;
  for (const [si, s] of (page.schools ?? []).entries()) {
    const where = `${f} ${s.school_name}`;
    const prefecture = s.prefecture_override ?? page.prefecture;
    const establishment = s.establishment === '国立' ? '国立' : '私立';
    // 《女子部》《普通科》のような部・科は course の頭に付ける（同じ学校の別の募集として分けるため）
    const courseName = (c) => [s.division, c].filter(Boolean).join('・');
    const courses = (s.courses ?? []).length > 0 ? s.courses : [{ name: '', raw: '' }];

    for (const c of courses) {
      const k = key(prefecture, establishment, s.school_name, courseName(c.name));
      if (schoolRows.has(k)) continue;
      schoolRows.set(k, {
        prefecture,
        establishment,
        school_name: s.school_name,
        course: courseName(c.name),
        category: categoryOf(c.raw),
        // ★冊子の「地区」は区市の略（「世田谷」「八王子」）。正式な区市名ではないので region に置く
        region: s.district ?? null,
        gender_type: c.gender ? '共学' : genderType(s.gender_type),
        phone: s.phone ?? null,
        location_source: null,
      });
    }

    const courseNames = new Set(courses.map((c) => c.name));
    for (const [ri, r] of (s.rules ?? []).entries()) {
      const rw = `${where} rule${ri}`;
      if (!KINDS.has(r.kind)) warn(rw, `kind が不明: ${r.kind}`);
      if (!SECTIONS.has(r.section)) warn(rw, `section が不明: ${r.section}`);
      for (const alt of r.any ?? []) for (const c of alt) checkClause(c, rw);
      for (const g of r.gates ?? []) checkClause(g, rw);
      if ((r.any ?? []).length === 0 && !r.no_criterion) warn(rw, `基準も no_criterion も無い`);

      const targets = (r.courses ?? ['*']).includes('*') ? courses.map((c) => c.name) : r.courses;
      for (const t of targets) {
        if (!courseNames.has(t)) warn(rw, `対象コース「${t}」が募集欄に無い`);
        const k = key(prefecture, establishment, s.school_name, courseName(t));
        ruleRows.push({
          key: k,
          row: {
            source: meta.criteria.source,
            source_year: meta.criteria.source_year,
            source_label: meta.criteria.source_label,
            source_page: pageLabel ? `p${pageLabel}` : `写真${page.image}`,
            section: r.section,
            exam_label: r.exam_label,
            kind: r.kind,
            public_only: Boolean(r.public_only),
            applicant_scope: r.applicant_scope ?? null,
            gender: r.gender === '男子' || r.gender === '女子' ? r.gender : null,
            strength: ['出願資格', '出願基準', '目安'].includes(r.strength) ? r.strength : null,
            rule: {
              any: (r.any ?? []).map((alt) => alt.map(sanitizeClause)),
              gates: (r.gates ?? []).map(sanitizeClause),
              bonus: normalizeBonus(r.bonus, rw),
              no_criterion: r.no_criterion ?? null,
            },
            checks: r.checks ?? [],
            // 区分の原文に、試験の種類とその他欄を添える（判定を原本と照らすとき、前提がその他欄にあるため）
            raw_text: [
              r.raw,
              s.exams ? `【試験】${s.exams}` : null,
              s.other_raw ? `【その他の選考基準】${s.other_raw}` : null,
            ]
              .filter(Boolean)
              .join('\n'),
            uncertain: Boolean(r.uncertain),
            sort_order: si * 100 + ri,
          },
        });
      }
    }
  }
}

// ------------------------------------------------------------
// 偏差値の突き合わせ
// ------------------------------------------------------------
/** 表記ゆれを吸収する（空白・中黒・括弧の種類） */
const norm = (s) =>
  String(s ?? '')
    .replace(/[\s　]/g, '')
    .replace(/[（(]/g, '(')
    .replace(/[）)]/g, ')')
    .replace(/ヶ/g, 'ケ');

const byName = new Map(); // prefecture|norm(name) → [key...]
for (const [k, r] of schoolRows) {
  const nk = `${r.prefecture}|${norm(r.school_name)}`;
  if (!byName.has(nk)) byName.set(nk, []);
  byName.get(nk).push(k);
}

const standards = []; // { key, row }
const unmatchedCourse = [];
const hensachiOnly = new Map(); // key → high_schools の行（基準表に無い学校）

/**
 * hensachi-aliases.json の書き方（キーは「都県|偏差値表の学校名|偏差値表のコース」）:
 *   null                                   … 取り込まない行
 *   { "school_name": "…", "courses": ["…"] } … 基準表の学校名・コースに読み替える。
 *   ★courses は複数可。偏差値表は「エンパワー・STEAM 50」のように複数コースを1行にまとめることがあり、
 *     同じ偏差値をそれぞれのコースに入れる。
 */
const nameOnlyHits = new Map(); // 偏差値表だけにある学校名 → 基準表の似た名前

for (const f of hensachiFiles) {
  const sheet = JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8'));
  for (const e of sheet.entries ?? []) {
    if (e.hensachi == null) continue;
    const aliasKey = `${e.prefecture}|${e.school_name}|${e.course}`;
    const alias = aliases[aliasKey];
    if (alias === null) continue; // 取り込まないと決めた行
    const name = alias?.school_name ?? e.school_name;
    // ★募集が男女で分かれている学校（明治学院など）は、男子表の値を男子のコースへ、女子表の値を
    //   女子のコースへ当てる（courses_by_gender）。キーが男女共通なのでこう書き分ける
    const courses = alias?.courses_by_gender?.[sheet.gender] ?? alias?.courses ?? [e.course];
    const nk = `${e.prefecture}|${norm(name)}`;
    const candidates = byName.get(nk);

    const targetKeys = [];
    if (candidates) {
      for (const course of courses) {
        let hit = candidates.find((k) => norm(schoolRows.get(k).course) === norm(course)) ?? null;
        // コース1本の学校（course 空）なら、偏差値表の付記（「普」など）に関わらずそこへ
        if (!hit && candidates.length === 1 && schoolRows.get(candidates[0]).course === '') {
          hit = candidates[0];
        }
        if (hit) targetKeys.push(hit);
      }
      if (targetKeys.length === 0) {
        unmatchedCourse.push(
          `${aliasKey} → 基準表のコース: ${candidates.map((k) => `「${schoolRows.get(k).course}」`).join(' ')}`
        );
        continue;
      }
    } else {
      // 基準表に無い学校（千葉・埼玉の未受領ページなど）。偏差値だけの行として入れる
      const k = key(e.prefecture, '私立', name, courses[0]);
      targetKeys.push(k);
      if (!hensachiOnly.has(k)) {
        hensachiOnly.set(k, {
          prefecture: e.prefecture,
          establishment: '私立',
          school_name: name,
          course: courses[0],
          category: '普通科',
          region: e.block ?? null,
          gender_type: null,
          phone: null,
          location_source: null,
        });
      }
      // 表記ゆれで基準表の学校を取りこぼしていないか（先頭2文字が同じ学校を並べて見せる）
      const similar = Array.from(schoolRows.values())
        .filter(
          (r) =>
            r.prefecture === e.prefecture &&
            norm(r.school_name).slice(0, 2) === norm(name).slice(0, 2)
        )
        .map((r) => r.school_name);
      if (similar.length > 0)
        nameOnlyHits.set(`${e.prefecture}|${name}`, Array.from(new Set(similar)));
    }
    for (const targetKey of targetKeys) {
      standards.push({
        key: targetKey,
        row: {
          source: meta.hensachi.source,
          source_year: meta.hensachi.source_year,
          source_label: meta.hensachi.source_label,
          hensachi: e.hensachi,
          gender: sheet.gender === '男子' || sheet.gender === '女子' ? sheet.gender : null,
          note: e.uncertain ? `読み取りに自信なし: ${e.raw}` : null,
          verified_at: null,
        },
      });
    }
  }
}

// 同じ学校・同じ性別に2つの値が当たったら、後の行で上書きしない（突き合わせの誤りの印）
const stdSeen = new Map();
for (const s of standards) {
  const k = `${s.key}|${s.row.gender}`;
  if (stdSeen.has(k) && stdSeen.get(k) !== s.row.hensachi) {
    warn('偏差値', `${k} に2つの値 ${stdSeen.get(k)} / ${s.row.hensachi}`);
  }
  stdSeen.set(k, s.row.hensachi);
}
const stdUnique = Array.from(
  new Map(standards.map((s) => [`${s.key}|${s.row.gender}`, s])).values()
);

// ------------------------------------------------------------
// 報告
// ------------------------------------------------------------
const allSchools = new Map([...schoolRows, ...hensachiOnly]);
console.log(`基準表 ${criteriaFiles.length}ページ / 偏差値表 ${hensachiFiles.length}枚`);
console.log(
  `high_schools（私立・国立）: ${allSchools.size}行（うち偏差値だけの学校 ${hensachiOnly.size}行）`
);
console.log(
  `high_school_admission_rules: ${ruleRows.length}行（読み取りに自信なし ${ruleRows.filter((r) => r.row.uncertain).length}行）`
);
console.log(`high_school_standards: ${stdUnique.length}行`);
console.log(
  `\n偏差値表のコースが基準表に当たらない: ${unmatchedCourse.length}件（hensachi-aliases.json で対応を足す）`
);
Array.from(new Set(unmatchedCourse)).forEach((u) => console.log(`  ${u}`));
console.log(
  `\n偏差値表だけにある学校で、基準表に似た名前があるもの: ${nameOnlyHits.size}件（同じ学校なら aliases で読み替える）`
);
nameOnlyHits.forEach((v, k) => console.log(`  ${k} ≒ ${v.join('・')}`));
console.log(`\n形の検査で見つかったこと: ${problems.length}件`);
problems.forEach((p) => console.log(`  ${p}`));

if (!GO) {
  console.log('\n--- 下見（--go を付けると書き込む） ---');
  process.exit(0);
}

// ------------------------------------------------------------
// 書き込み
// ------------------------------------------------------------
const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false },
  }
);
const CHUNK = 500;
const chunks = (arr) => {
  const out = [];
  for (let i = 0; i < arr.length; i += CHUNK) out.push(arr.slice(i, i + CHUNK));
  return out;
};

const idByKey = new Map();
for (const part of chunks(Array.from(allSchools.values()))) {
  const { data, error } = await supa
    .from('high_schools')
    .upsert(part, { onConflict: 'prefecture,establishment,school_name,course' })
    .select('id,prefecture,establishment,school_name,course');
  if (error) {
    console.error('high_schools:', error);
    process.exit(1);
  }
  for (const r of data)
    idByKey.set(key(r.prefecture, r.establishment, r.school_name, r.course), r.id);
}
console.log(`high_schools upsert: ${idByKey.size}行`);

// この版の基準を入れ直す（同じ版を2回流しても重複しないように、先に消す）
const ids = Array.from(new Set(ruleRows.map((r) => idByKey.get(r.key)).filter(Boolean)));
for (const part of chunks(ids)) {
  const { error } = await supa
    .from('high_school_admission_rules')
    .delete()
    .in('high_school_id', part)
    .eq('source', meta.criteria.source)
    .eq('source_year', meta.criteria.source_year);
  if (error) {
    console.error('high_school_admission_rules delete:', error);
    process.exit(1);
  }
}
const rules = ruleRows.map((r) => ({ high_school_id: idByKey.get(r.key), ...r.row }));
if (rules.some((r) => !r.high_school_id)) {
  console.error('★基準の行で学校のidが引けないものがある。中止する。');
  process.exit(1);
}
for (const part of chunks(rules)) {
  const { error } = await supa.from('high_school_admission_rules').insert(part);
  if (error) {
    console.error('high_school_admission_rules insert:', error);
    process.exit(1);
  }
}
console.log(`high_school_admission_rules insert: ${rules.length}行`);

const stds = stdUnique.map((s) => ({ high_school_id: idByKey.get(s.key), ...s.row }));
if (stds.some((s) => !s.high_school_id)) {
  console.error('★偏差値の行で学校のidが引けないものがある。中止する。');
  process.exit(1);
}
for (const part of chunks(stds)) {
  const { error } = await supa
    .from('high_school_standards')
    .upsert(part, { onConflict: 'high_school_id,source,source_year,gender' });
  if (error) {
    console.error('high_school_standards:', error);
    process.exit(1);
  }
}
console.log(`high_school_standards upsert: ${stds.length}行`);
console.log(
  '完了。★基準・偏差値とも未照合（verified_at=NULL）。紙と突き合わせたら verified_at を入れる。'
);
