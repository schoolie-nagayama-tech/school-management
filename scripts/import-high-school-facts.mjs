#!/usr/bin/env node
// 教育委員会の一括資料 → 高校の数字・部活（high_school_stats / high_school_clubs）
//
// 使い方:
//   node scripts/import-high-school-facts.mjs --source <資料>            # 下見（書き込まない）
//   node scripts/import-high-school-facts.mjs --source <資料> --go       # 実際に入れる
//   ... --verified   # PDFから書き起こした資料を、人が原本と突き合わせたときだけ付ける
//
// 資料（--source）:
//   tokyo-roster     都教委「公立学校一覧」高等学校（学校別）Excel → 生徒数・学級数・教員数
//   kanagawa-roster  神奈川県「公立高等学校 生徒数・学級数（学校別）」Excel → 生徒数（男女別）・学級数＋学校コード
//   kanagawa-exam    神奈川県「共通選抜 学校別合格状況」Excel → 募集・受検・合格・競争率
//   tokyo-exam       都教委「入学者選抜受検状況」PDF（書き起こしCSV）→ 募集・応募・受検・受検倍率
//   premiere-club    都教委「部活動の特別強化プロジェクト」Premiere Club 一覧（書き起こしCSV）→ 部活
//
// ★Excel をそのまま変換した資料（machine: true）は、取込の時点で verified_at を入れる。
//   人の書き起こしを挟まないので、読み違いが起きない。PDFを画像で読んで書き起こした資料は
//   --verified を付けたときだけ入れる（試し調査で、AIの書き起こしの誤りが実際に出た）。
//
// ★マスタ（high_school_campuses）に無い学校は入れない。マスタは合格めやすのある学校から起こしているので、
//   定時制だけの学校・特別支援学校などは資料にあってもマスタに無い。下見で件数と名前を出す。
//
// 資料の出どころと変換の手順: docs/data/README.md ／ 正典: docs/high-school-profile-plan.md

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { METRICS } from '../src/lib/highSchools/metrics.ts';
import { normalizeClubName } from '../src/lib/highSchools/clubKeys.ts';
import { kanagawaMasterName, matchMasterCourse } from '../src/lib/highSchools/importRules.ts';

const ENV = existsSync('.env.local') ? '.env.local' : resolve(process.cwd(), '../../../.env.local');
config({ path: ENV });

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d;
};

const GO = flag('--go');
const VERIFIED = flag('--verified');
const SOURCE = opt('--source');

function parseCsv(text) {
  const rows = [];
  let row = [],
    field = '',
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const readRows = (file) => parseCsv(readFileSync(`docs/data/${file}`, 'utf8'));
const readObjects = (file) => {
  const [head, ...rows] = readRows(file);
  return rows
    .filter((r) => r.some((v) => v !== ''))
    .map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
};
// '－' '-' '' は値なし。「1,060」のようなカンマ区切りも読む
const num = (v) => {
  const s = String(v ?? '')
    .normalize('NFKC')
    .replace(/,/g, '')
    .trim();
  if (s === '' || s === '-' || s === '－' || s === '−') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

// ------------------------------------------------------------
// 資料ごとの読み方
// ------------------------------------------------------------

const SOURCES = {
  'tokyo-roster': {
    machine: true,
    prefecture: '東京都',
    source_url:
      'https://www.kyoiku.metro.tokyo.lg.jp/documents/d/kyoiku/r7-koutougakkou-ichiran-resolved',
    source_label: '都教委 令和7年度 公立学校統計調査報告書（東京都公立学校一覧）',
    as_of: '2025-05-01',
    fiscal_year: 2025,
    build: buildTokyoRoster,
  },
  'kanagawa-roster': {
    machine: true,
    prefecture: '神奈川県',
    source_url: 'https://www.pref.kanagawa.jp/documents/122202/high_student-class_r07.xlsx',
    source_label: '神奈川県 令和7年度 公立高等学校 生徒数・学級数（学校別）',
    as_of: '2025-05-01',
    fiscal_year: 2025,
    build: buildKanagawaRoster,
  },
  'kanagawa-exam': {
    machine: true,
    prefecture: '神奈川県',
    source_url: 'https://www.pref.kanagawa.jp/documents/132525/bessi4.xlsx',
    source_label: '神奈川県教委 令和8年度 共通選抜 学校別合格状況',
    as_of: '2026-02-27',
    fiscal_year: 2026,
    build: buildKanagawaExam,
  },
  'tokyo-exam': {
    machine: false,
    prefecture: '東京都',
    source_url: 'https://www.kyoiku.metro.tokyo.lg.jp/information/press/2026/02/2026022108',
    source_label: '都教委 令和8年度 都立高校入学者選抜 受検状況',
    as_of: '2026-02-21',
    fiscal_year: 2026,
    build: buildTokyoExam,
  },
  'premiere-club': {
    machine: false,
    prefecture: '東京都',
    source_url: 'https://www.kyoiku.metro.tokyo.lg.jp/documents/d/kyoiku/-premiere-club-1',
    source_label: '都教委 部活動の特別強化プロジェクト Premiere Club 指定一覧',
    as_of: '2026-03-26',
    fiscal_year: 2026,
    build: buildPremiereClub,
  },
};

/**
 * 都教委の公立学校一覧。1行＝学校×学科。学校名・学校番号は2行目以降が空（結合セル）なので上から埋める。
 * 列: 0番号 1区市町村 2学校名 3大学科 4小学科名 5生徒計 6-8学年 9学級計 10-12学年 13教員 14職員
 * ★教員数は学校の最初の行にだけ入っている（2行目以降は0）。学校全体の値として持つ。
 */
function buildTokyoRoster(ctx) {
  const out = [];
  let code = null;
  const teachers = new Map();
  for (const r of readRows('toritsu-roster-r7.csv').slice(4)) {
    if (r[0] === '合計' || (r[0] ?? '').startsWith('注')) break;
    if (r[0]) code = r[0];
    if (!code || !r[3] || r[3] === '-') continue; // 全日制の無い学校（定時制のみ）

    const campus = ctx.campusByCode.get(code);
    if (!campus) {
      ctx.miss.add(`${code} ${r[2] || '(上の行と同じ学校)'}`);
      continue;
    }
    const label = r[4];
    const base = ctx.base(campus, label);
    out.push(ctx.stat(base, 'students', { value_num: num(r[5]) }));
    [6, 7, 8].forEach((c, i) =>
      out.push(ctx.stat(base, 'students', { grade: i + 1, value_num: num(r[c]) }))
    );
    out.push(ctx.stat(base, 'classes', { value_num: num(r[9]) }));
    [10, 11, 12].forEach((c, i) =>
      out.push(ctx.stat(base, 'classes', { grade: i + 1, value_num: num(r[c]) }))
    );
    const t = num(r[13]);
    if (t) teachers.set(campus.id, Math.max(teachers.get(campus.id) ?? 0, t));
  }
  for (const [campusId, t] of teachers) {
    out.push(ctx.stat(ctx.base(ctx.campusById.get(campusId), ''), 'teachers', { value_num: t }));
  }
  return out;
}

/**
 * 神奈川県の生徒数・学級数（学校別）。1行＝学校×学科（「（普通）」「（工業）」の大くくり）。
 * 列: 1学校コード 2設置者 3市区町村 4学校名 5学科 6計 7男 8女 9-14 学年ごとの男・女 16学級計 17-19学年
 * ★男女別の人数が載っている（東京の資料には無い）。学年ごとは男・女だけで、学年の計は載っていない。
 */
function buildKanagawaRoster(ctx) {
  const out = [];
  for (const r of readRows('kanagawa-roster-r7.csv')) {
    const mext = (r[1] ?? '').trim();
    if (!/^D\d{12}$/.test(mext)) continue;
    const name = kanagawaMasterName(r[4], r[2]);
    const campus = ctx.campusByName.get(name);
    if (!campus) {
      ctx.miss.add(`${mext} ${r[2]} ${r[4]} → ${name}`);
      continue;
    }
    ctx.mextCodes.set(campus.id, mext);
    const base = ctx.base(campus, r[5]);
    out.push(ctx.stat(base, 'students', { value_num: num(r[6]) }));
    out.push(ctx.stat(base, 'students', { sex: 'male', value_num: num(r[7]) }));
    out.push(ctx.stat(base, 'students', { sex: 'female', value_num: num(r[8]) }));
    for (let g = 0; g < 3; g++) {
      out.push(
        ctx.stat(base, 'students', { grade: g + 1, sex: 'male', value_num: num(r[9 + g * 2]) })
      );
      out.push(
        ctx.stat(base, 'students', { grade: g + 1, sex: 'female', value_num: num(r[10 + g * 2]) })
      );
    }
    out.push(ctx.stat(base, 'classes', { value_num: num(r[16]) }));
    [17, 18, 19].forEach((c, i) =>
      out.push(ctx.stat(base, 'classes', { grade: i + 1, value_num: num(r[c]) }))
    );
  }
  return out;
}

/**
 * 神奈川県の共通選抜 学校別合格状況（全日制の3シート：普通科／専門学科／単位制）。
 * ★シートごと・見出しごとに列の位置が違い、結合セルで値の入る列もずれる（合格者数の見出し「(C)」は
 *   9列目にあるのに値は11列目）。見出しの記号 (A)+(B) (D) (A+B-D)/C の位置から列を決める。
 * ★競争率＝（受検者数−受検後取消者数）÷合格者数。東京の受検倍率（受検÷募集）と分母が違う。
 */
function buildKanagawaExam(ctx) {
  const out = [];
  const SCHOOL = /^(県立|横浜市立|川崎市立|横須賀市立)/;
  for (const sheet of [1, 2, 3]) {
    let nameIdx = null,
      courseIdx = null,
      col = null,
      // ★同じシートの後ろに「２ 連携募集合格状況」（連携型中高一貫の枠）が続く。
      //   共通選抜と同じ学校・同じ学科で数字が別にあるので、選抜区分（item）で分ける
      item = '共通選抜';
    for (const r of readRows(`kanagawa-kyousou-2026.sheet${sheet}.csv`)) {
      const title = r.find((v) => /合格状況/.test(v));
      if (title) item = /連携募集/.test(title) ? '連携募集' : '共通選抜';
      const at = (label) => r.findIndex((v) => v.replace(/\s/g, '') === label);
      if (at('学校名') >= 0) {
        nameIdx = at('学校名');
        const c = r.findIndex((v, i) => i > nameIdx && /学\s*科/.test(v));
        courseIdx = c >= 0 ? c : null;
        continue;
      }
      if (at('(A)+(B)') >= 0) {
        const examinees = at('(A)+(B)');
        const cancel = at('(D)');
        const ratio = at('(A+B-D)/C');
        col = { capacity: examinees - 1, examinees, passed: cancel - 1, ratio };
        continue;
      }
      if (nameIdx == null || !col) continue;
      // ★クリエイティブスクールの節は、学校名が見出しより1列左に入っている（数字の列はずれない）。
      //   見出しの位置だけで拾うと4校を黙って取りこぼすので、見出しより左も探す
      const nameAt = r.findIndex((v, i) => i <= nameIdx && SCHOOL.test(v ?? ''));
      // ★学校名が「〃」（上と同じ）の行がある。神奈川総合の2つ目のコース（国際文化コース）など
      const ditto = r[nameIdx] === '〃';
      // 「川崎市立」だけの行は節の見出し（数字が無い）。学校の行と見分ける
      if ((nameAt < 0 && !ditto) || num(r[col.capacity]) == null) continue;
      const rawName = ditto ? ctx.lastRawName : r[nameAt];
      ctx.lastRawName = rawName;

      const name = kanagawaMasterName(rawName);
      const campus = ctx.campusByName.get(name);
      if (!campus) {
        ctx.miss.add(`${rawName} → ${name}`);
        continue;
      }
      const label = courseIdx != null ? r[courseIdx] : '普通科';
      const base = { ...ctx.base(campus, label), item };
      const note = '競争率＝（受検者数−受検後取消者数）÷合格者数';
      for (const [metric, idx] of [
        ['exam_capacity', col.capacity],
        ['exam_examinees', col.examinees],
        ['exam_passed', col.passed],
        ['exam_ratio', col.ratio],
      ]) {
        const v = num(r[idx]);
        if (v == null) continue;
        out.push(
          ctx.stat(base, metric, { value_num: v, note: metric === 'exam_ratio' ? note : null })
        );
      }
    }
  }
  return out;
}

/** 都教委の受検状況（書き起こしCSV）。学力検査に基づく選抜（一次・分割前期）の数字 */
function buildTokyoExam(ctx) {
  const out = [];
  for (const r of readObjects('toritsu-juken-2026.csv')) {
    const campus = ctx.campusByName.get(r.school_name);
    if (!campus) {
      ctx.miss.add(`${r.category} ${r.school_name}${r.course ? `（${r.course}）` : ''}`);
      continue;
    }
    const label = r.course || '普通科';
    const base = { ...ctx.base(campus, label), item: '一般' };
    const note = '受検倍率＝受検人員÷募集人員';
    for (const [metric, key] of [
      ['exam_capacity', 'capacity'],
      ['exam_applicants', 'applicants'],
      ['exam_examinees', 'examinees'],
      ['exam_ratio', 'ratio'],
    ]) {
      const v = num(r[key]);
      if (v == null) continue;
      out.push(
        ctx.stat(base, metric, { value_num: v, note: metric === 'exam_ratio' ? note : null })
      );
    }
  }
  return out;
}

/** Premiere Club の指定 → 部活（段階2「都立の強豪」以上の根拠） */
function buildPremiereClub(ctx) {
  const out = [];
  for (const r of readObjects('tokyo-premiere-club-2026.csv')) {
    const campus = ctx.campusByName.get(r.school_name);
    if (!campus) {
      ctx.miss.add(`Tier${r.tier} ${r.club} ${r.school_name}`);
      continue;
    }
    const { clubKey, sex } = normalizeClubName(r.club);
    out.push({
      campus_id: campus.id,
      club_key: clubKey,
      name: r.club,
      sex,
      kind: /吹奏楽|合唱|演劇|美術|書道|写真|囲碁|将棋|放送|軽音|管弦|邦楽|太鼓|文芸|科学|茶道|華道/.test(
        clubKey
      )
        ? '文化'
        : '運動',
      designation: `Premiere Club Tier${r.tier}`,
      // ★指定は「都立の強豪」の根拠になる。大会結果でさらに上と分かったら 1 に上げる（下げない）
      tier: 2,
      tier_basis: `都教委 部活動の特別強化プロジェクト Premiere Club Tier${r.tier} に指定（2026年度〜）`,
      source_url: ctx.src.source_url,
      as_of: ctx.src.as_of,
      verified_at: ctx.verifiedAt,
    });
  }
  return out;
}

// ------------------------------------------------------------
// 本体
// ------------------------------------------------------------

const src = SOURCES[SOURCE];
if (!src) {
  console.error(`--source は ${Object.keys(SOURCES).join(' / ')} のどれか`);
  process.exit(1);
}

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false },
  }
);

// ★PostgREST は未ページングの select を1000行で黙って切る。マスタは今400行でも、ページングで読む
async function selectAll(table, columns, filter) {
  const all = [];
  for (let from = 0; ; from += 1000) {
    let q = supa
      .from(table)
      .select(columns)
      .range(from, from + 999);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw error;
    all.push(...data);
    if (data.length < 1000) return all;
  }
}

// ★マイグレーション（20260923150000_high_school_profiles.sql）を当てる前でも下見はできるようにする。
//   学校の表がまだ無いときは、既存の学科の行から学校を組み立てる（id は仮。書き込みはさせない）。
let campuses, courses;
try {
  campuses = await selectAll(
    'high_school_campuses',
    'id, prefecture, school_name, school_code, mext_code',
    (q) => q.eq('prefecture', src.prefecture)
  );
  courses = await selectAll('high_schools', 'id, campus_id, course', (q) =>
    q.eq('prefecture', src.prefecture)
  );
} catch (e) {
  if (GO) throw e;
  console.log(
    `（学校の表がまだ無いので、既存の high_schools から組み立てて下見する: ${e.message}）\n`
  );
  const hs = await selectAll('high_schools', 'id, school_name, school_code, course', (q) =>
    q.eq('prefecture', src.prefecture)
  );
  const byName = new Map();
  for (const h of hs) {
    if (!byName.has(h.school_name))
      byName.set(h.school_name, {
        id: `仮:${h.school_name}`,
        school_name: h.school_name,
        school_code: null,
      });
    if (h.school_code) byName.get(h.school_name).school_code = h.school_code;
  }
  campuses = [...byName.values()];
  courses = hs.map((h) => ({ id: h.id, campus_id: `仮:${h.school_name}`, course: h.course }));
}

const coursesByCampus = new Map();
for (const c of courses) {
  if (!coursesByCampus.has(c.campus_id)) coursesByCampus.set(c.campus_id, []);
  coursesByCampus.get(c.campus_id).push(c);
}

const verifiedAt = src.machine || VERIFIED ? new Date().toISOString() : null;
const ctx = {
  src,
  verifiedAt,
  miss: new Set(),
  mextCodes: new Map(),
  campusById: new Map(campuses.map((c) => [c.id, c])),
  campusByName: new Map(campuses.map((c) => [c.school_name, c])),
  campusByCode: new Map(campuses.filter((c) => c.school_code).map((c) => [c.school_code, c])),
  /** 学校×資料の学科名。マスタの学科に当たったときだけ high_school_id を付ける */
  base(campus, label) {
    const list = coursesByCampus.get(campus.id) ?? [];
    const course = label
      ? matchMasterCourse(
          label,
          list.map((c) => c.course)
        )
      : null;
    return {
      campus_id: campus.id,
      high_school_id: course == null ? null : list.find((c) => c.course === course).id,
      course_label: (label ?? '').trim(),
    };
  },
  stat(base, metric, fields) {
    if (!METRICS[metric])
      throw new Error(`未定義の項目キー: ${metric}（src/lib/highSchools/metrics.ts）`);
    return {
      item: '',
      grade: null,
      sex: null,
      basis: null,
      value_text: null,
      note: null,
      ...base,
      ...fields,
      fiscal_year: src.fiscal_year,
      metric,
      source_url: src.source_url,
      source_label: src.source_label,
      as_of: src.as_of,
      verified_at: verifiedAt,
    };
  },
};

const rows = src
  .build(ctx)
  .filter((r) => !('value_num' in r) || r.value_num != null || r.value_text != null);
const isClub = SOURCE === 'premiere-club';

console.log(`資料: ${src.source_label}（${SOURCE}）`);
console.log(
  `確認: ${verifiedAt ? (src.machine ? 'Excelの機械変換なので確認済みとして入れる' : '--verified（人が原本と突き合わせ済み）') : '未確認として入れる'}`
);
console.log(`→ ${isClub ? 'high_school_clubs' : 'high_school_stats'} ${rows.length}行`);
const touched = new Set(rows.map((r) => r.campus_id));
console.log(`学校: ${touched.size}校（マスタの${src.prefecture} ${campuses.length}校のうち）`);
if (!isClub) {
  const unmatched = rows.filter((r) => r.course_label && r.high_school_id == null);
  const labels = [...new Set(unmatched.map((r) => r.course_label))];
  console.log(
    `マスタの学科に当たらず学校全体の値として持つ学科名: ${labels.length}種 … ${labels.slice(0, 15).join('、')}`
  );
}
console.log(`マスタに無いので入れない: ${ctx.miss.size}件`);
[...ctx.miss].slice(0, 40).forEach((m) => console.log(`  - ${m}`));
if (ctx.mextCodes.size) console.log(`学校コード（13桁）を付ける学校: ${ctx.mextCodes.size}校`);

// ★同じキーの行が2つあると upsert が丸ごと失敗する（ON CONFLICT は同じ行を2度更新できない）。
//   資料に同じ学校・同じ学科の行が2回出るなど、読み方の誤りの兆候でもあるので、書く前に止める。
const keyOf = isClub
  ? (r) => [r.campus_id, r.club_key, r.sex].join('|')
  : (r) =>
      [r.campus_id, r.course_label, r.fiscal_year, r.metric, r.item, r.grade, r.sex, r.basis].join(
        '|'
      );
const seen = new Map();
const dups = [];
for (const r of rows) {
  const k = keyOf(r);
  if (seen.has(k))
    dups.push(`${ctx.campusById.get(r.campus_id)?.school_name} ${k.split('|').slice(1).join(' ')}`);
  seen.set(k, r);
}
if (dups.length) {
  console.log(`\n★同じキーの行が ${dups.length}件ある。読み方を直してから入れる:`);
  dups.slice(0, 20).forEach((d) => console.log(`  - ${d}`));
}

// ★process.exit() で抜けると、Windows で通信の後片付け中に Node が落ちる（UV_HANDLE_CLOSING）。
//   if/else で自然に終わらせる。
if (!GO || dups.length) {
  if (GO) process.exitCode = 1;
  // --show 学校名 で、その学校の行を原本と見比べやすい形で出す（人が確かめるとき用）
  const show = opt('--show');
  const pick = show
    ? rows.filter((r) => ctx.campusById.get(r.campus_id)?.school_name === show)
    : rows.slice(0, 3);
  console.log(`\n--- 下見（--go を付けると書き込む）。${show ? `${show}の全行` : '先頭3件'} ---`);
  pick.forEach((r) =>
    console.log(
      isClub
        ? `${r.name} → ${r.club_key}${r.sex ? `（${r.sex}）` : ''} ${r.designation} 段階${r.tier}`
        : `${r.course_label || '(学校全体)'}${r.high_school_id ? '' : ' [学科に当たらず]'} ${r.item} ${r.metric}` +
            `${r.grade ? ` ${r.grade}年` : ''}${r.sex ? ` ${r.sex}` : ''} = ${r.value_num ?? r.value_text}`
    )
  );
} else if (isClub) {
  // ★既にある部は、指定と出典だけ足す。段階は「上げる」だけで、学校ごとの調査で付けた
  //   段階1（私立と戦える）を指定の段階2で上書きして下げない。
  const existing = await selectAll('high_school_clubs', 'id, campus_id, club_key, sex, tier', (q) =>
    q.in('campus_id', [...touched])
  );
  const key = (r) => `${r.campus_id}|${r.club_key}|${r.sex}`;
  const byKey = new Map(existing.map((r) => [key(r), r]));
  let inserted = 0,
    updated = 0;
  for (const r of rows) {
    const cur = byKey.get(key(r));
    if (!cur) {
      const { error } = await supa.from('high_school_clubs').insert(r);
      if (error) throw error;
      inserted++;
      continue;
    }
    const patch = { designation: r.designation, source_url: r.source_url, as_of: r.as_of };
    if (cur.tier == null || cur.tier > r.tier)
      Object.assign(patch, { tier: r.tier, tier_basis: r.tier_basis });
    const { error } = await supa.from('high_school_clubs').update(patch).eq('id', cur.id);
    if (error) throw error;
    updated++;
  }
  console.log(`完了: 追加 ${inserted}部・更新 ${updated}部`);
} else {
  const CONFLICT = 'campus_id,course_label,fiscal_year,metric,item,grade,sex,basis';
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supa
      .from('high_school_stats')
      .upsert(rows.slice(i, i + 500), { onConflict: CONFLICT });
    if (error) throw error;
  }
  for (const [id, mext] of ctx.mextCodes) {
    const { error } = await supa
      .from('high_school_campuses')
      .update({ mext_code: mext })
      .eq('id', id);
    if (error) throw error;
  }
  console.log(`完了: ${rows.length}行を入れた（同じ学校・年度・項目は上書き）`);
}
