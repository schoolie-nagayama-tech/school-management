#!/usr/bin/env node
// 学校ごとの調査結果（docs/data/profiles/**/*.json）→ 高校の数字・部活・指定校・変化
//
// 使い方:
//   node scripts/import-high-school-profiles.mjs                       # 全ファイルを下見（書き込まない）
//   node scripts/import-high-school-profiles.mjs --file docs/data/profiles/tokyo/松が谷.json
//   ... --go         # 実際に入れる
//   ... --verified   # 人が原本と突き合わせたファイルだけに付ける
//
// 調査の手引き（何を・どこから・どの形で）: docs/high-school-research-guide.md
// 正典: docs/high-school-profile-plan.md
//
// ★AIの調査結果は、既定で未確認（verified_at = NULL）として入れる。
//   AIヘルプは確認済みの値しか使わないので、未確認のまま入れても誤った案内にはならない。
//   試し調査で、調査エージェントの誤り・訂正の誤りが実際に出ている（設計書 §7）。
//
// ★部活の段階（tier）は「上げる」だけ。Premiere Club の指定で付けた段階2を、
//   学校の調査で見立てた段階3で下げない。clubs.verified_at は段階の確認を表す。
//
// ★大会実績・指定校（公式）・学校の変化は、この調査だけが書く表なので、
//   その学校の分を消してから入れ直す（同じファイルを何度流しても同じ結果になる）。

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { METRICS } from '../src/lib/highSchools/metrics.ts';
import { normalizeClubName } from '../src/lib/highSchools/clubKeys.ts';
import { matchMasterCourse } from '../src/lib/highSchools/importRules.ts';

const ENV = existsSync('.env.local') ? '.env.local' : resolve(process.cwd(), '../../../.env.local');
config({ path: ENV });

const argv = process.argv.slice(2);
const GO = argv.includes('--go');
const VERIFIED = argv.includes('--verified');
const files = argv.flatMap((a, i) => (argv[i - 1] === '--file' ? [a] : []));

function listJson(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? listJson(p) : name.endsWith('.json') ? [p] : [];
  });
}
const targets = files.length ? files : listJson('docs/data/profiles');

// ------------------------------------------------------------
// 形の検査。★DBの CHECK で落ちる前に、どのファイルのどこが悪いかを出す
// ------------------------------------------------------------
const KINDS = ['運動', '文化', '同好会'];
const WEEKENDS = ['土日', '土', '日', 'なし', '試合のみ'];
const LEVELS = ['全国', '関東', '都県', '地区', 'その他'];
const EVENT_KINDS = [
  '改築',
  '改修',
  '制服',
  '学級増減',
  '学科改編',
  '統合',
  '指定',
  '施設',
  'その他',
];
const BASES = ['延べ', '現役', '実進学'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function validate(p) {
  const e = [];
  const need = (cond, msg) => cond || e.push(msg);
  need(['東京都', '神奈川県'].includes(p.prefecture), `prefecture が不正: ${p.prefecture}`);
  need(p.school_name, 'school_name が無い');
  (p.stats ?? []).forEach((s, i) => {
    const at = `stats[${i}] ${s.metric}/${s.item ?? ''}`;
    need(METRICS[s.metric], `${at}: 未定義の項目キー（src/lib/highSchools/metrics.ts）`);
    need(Number.isInteger(s.fiscal_year), `${at}: fiscal_year が数字でない`);
    need(s.value_num != null || s.value_text, `${at}: 値が無い`);
    need(
      s.value_num == null || Number.isFinite(Number(s.value_num)),
      `${at}: value_num が数字でない`
    );
    need(s.source_url, `${at}: source_url が無い`);
    need(!s.basis || BASES.includes(s.basis), `${at}: basis が不正: ${s.basis}`);
    need(
      s.metric !== 'university_count' || s.basis,
      `${at}: 合格実績に basis（延べ/現役/実進学）が無い`
    );
    need(!s.sex || ['male', 'female'].includes(s.sex), `${at}: sex が不正`);
    need(
      s.grade == null || [1, 2, 3, 4].includes(s.grade),
      `${at}: grade は数字の1〜4（「1年」のような文字は不可）`
    );
    need(!s.as_of || DATE.test(s.as_of), `${at}: as_of が日付でない`);
  });
  (p.clubs ?? []).forEach((c, i) => {
    const at = `clubs[${i}] ${c.name}`;
    need(c.name, `${at}: name が無い`);
    need(!c.kind || KINDS.includes(c.kind), `${at}: kind が不正: ${c.kind}`);
    need(!c.weekend || WEEKENDS.includes(c.weekend), `${at}: weekend が不正: ${c.weekend}`);
    need(c.tier == null || [1, 2, 3, 4].includes(c.tier), `${at}: tier が不正`);
    need(c.tier == null || c.tier_basis, `${at}: tier に根拠（tier_basis）が無い`);
    need(
      c.days_per_week == null || (c.days_per_week >= 0 && c.days_per_week <= 7),
      `${at}: days_per_week が不正`
    );
    (c.results ?? []).forEach((r, j) => {
      need(Number.isInteger(r.fiscal_year), `${at} results[${j}]: fiscal_year が数字でない`);
      need(LEVELS.includes(r.level), `${at} results[${j}]: level が不正: ${r.level}`);
      need(
        r.competition && r.result && r.source_url,
        `${at} results[${j}]: 大会名・結果・出典のどれかが無い`
      );
      need(
        !r.happened_on || DATE.test(r.happened_on),
        `${at} results[${j}]: happened_on が日付でない`
      );
    });
  });
  (p.designated_universities ?? []).forEach((d, i) =>
    need(d.university, `designated_universities[${i}]: university が無い`)
  );
  (p.events ?? []).forEach((v, i) => {
    need(EVENT_KINDS.includes(v.kind), `events[${i}]: kind が不正: ${v.kind}`);
    need(
      v.period_label && v.summary && v.source_url,
      `events[${i}]: 時期・要約・出典のどれかが無い`
    );
    need(!v.happened_on || DATE.test(v.happened_on), `events[${i}]: happened_on が日付でない`);
  });
  return e;
}

/**
 * 日付の揺れを受け止める。試し調査で「2026-09」「2024-08」のような月までの書き方が多く出た。
 * - as_of（資料の時点）は月までなら月初にそろえる。資料の時点は月で十分なため
 * - happened_on（大会・出来事の日）は日まで無ければ空にする。月初を入れると、
 *   その日に起きたように見えてしまう。月は result / period_label の文字に残っている前提
 */
function normalizeDates(p) {
  const w = [];
  const month = /^(\d{4})-(\d{2})$/;
  // ★空文字の日付は「無し」として扱う。DBの date 型は空文字を弾く（町田総合で止まった）
  const blank = (o, k) => {
    if (o[k] === '') delete o[k];
  };
  for (const s of p.stats ?? []) blank(s, 'as_of');
  for (const c of p.clubs ?? []) {
    blank(c, 'as_of');
    for (const r of c.results ?? []) blank(r, 'happened_on');
  }
  for (const v of p.events ?? []) blank(v, 'happened_on');
  for (const s of p.stats ?? []) if (month.test(s.as_of ?? '')) s.as_of = `${s.as_of}-01`;
  for (const c of p.clubs ?? []) {
    if (month.test(c.as_of ?? '')) c.as_of = `${c.as_of}-01`;
    for (const r of c.results ?? []) {
      if (r.happened_on && !DATE.test(r.happened_on)) {
        w.push(`${c.name} ${r.competition}: happened_on「${r.happened_on}」は日が無いので空にした`);
        delete r.happened_on;
      }
    }
  }
  for (const v of p.events ?? []) {
    if (v.happened_on && !DATE.test(v.happened_on)) {
      w.push(
        `変化「${v.summary.slice(0, 20)}」: happened_on「${v.happened_on}」は日が無いので空にした`
      );
      delete v.happened_on;
    }
  }
  return w;
}

// ------------------------------------------------------------
// 本体
// ------------------------------------------------------------
const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false },
  }
);

// ★PostgREST は未ページングの select を1000行で黙って切る
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

const campuses = await selectAll('high_school_campuses', 'id, prefecture, school_name');
const campusOf = new Map(campuses.map((c) => [`${c.prefecture}|${c.school_name}`, c]));
const courses = await selectAll('high_schools', 'id, campus_id, course');

const verifiedAt = VERIFIED ? new Date().toISOString() : null;
let failed = 0;

console.log(
  `${targets.length}ファイル・${GO ? '書き込む' : '下見'}・確認: ${VERIFIED ? '--verified' : '未確認として入れる'}\n`
);

for (const file of targets) {
  let p;
  try {
    p = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    console.log(`✗ ${file}: JSONが壊れている（${err.message}）`);
    failed++;
    continue;
  }
  const warnings = normalizeDates(p);
  const errors = validate(p);
  const campus = campusOf.get(`${p.prefecture}|${p.school_name}`);
  if (!campus) errors.push(`マスタに学校が無い: ${p.prefecture} ${p.school_name}`);

  // 同じキーの行が2つあると upsert が丸ごと失敗する。書く前に止める
  const statKey = (s) =>
    [
      s.course_label ?? '',
      s.fiscal_year,
      s.metric,
      s.item ?? '',
      s.grade ?? '',
      s.sex ?? '',
      s.basis ?? '',
    ].join('|');
  const clubKey = (c) => {
    const n = normalizeClubName(c.name);
    return `${n.clubKey}|${n.sex}`;
  };
  for (const [label, list, key] of [
    ['stats', p.stats ?? [], statKey],
    ['clubs', p.clubs ?? [], clubKey],
  ]) {
    const seen = new Set();
    for (const x of list) {
      const k = key(x);
      if (seen.has(k)) errors.push(`${label} に同じキーが2回: ${k}`);
      seen.add(k);
    }
  }

  const clubs = p.clubs ?? [];
  const nResults = clubs.reduce((n, c) => n + (c.results?.length ?? 0), 0);
  const tiers = clubs.filter((c) => c.tier).map((c) => c.tier);
  console.log(
    `${errors.length ? '✗' : '○'} ${p.prefecture} ${p.school_name}: stats ${p.stats?.length ?? 0}・部 ${clubs.length}` +
      `（段階つき ${tiers.length}：1=${tiers.filter((t) => t === 1).length} 2=${tiers.filter((t) => t === 2).length}` +
      ` 3=${tiers.filter((t) => t === 3).length} 4=${tiers.filter((t) => t === 4).length}）・大会 ${nResults}` +
      `・指定校 ${p.designated_universities?.length ?? 0}・変化 ${p.events?.length ?? 0}` +
      `・未解決 ${p.unresolved?.length ?? 0}・食い違い ${p.conflicts?.length ?? 0}`
  );
  errors.forEach((e) => console.log(`    - ${e}`));
  warnings.forEach((m) => console.log(`    （注）${m}`));
  if (errors.length) {
    failed++;
    continue;
  }
  if (!GO) continue;

  // --- stats ---
  const myCourses = courses.filter((c) => c.campus_id === campus.id);
  const stats = (p.stats ?? []).map((s) => {
    const label = s.course_label ?? '';
    const course = label
      ? matchMasterCourse(
          label,
          myCourses.map((c) => c.course)
        )
      : null;
    return {
      campus_id: campus.id,
      high_school_id: course == null ? null : myCourses.find((c) => c.course === course).id,
      course_label: label,
      fiscal_year: s.fiscal_year,
      metric: s.metric,
      item: s.item ?? '',
      grade: s.grade || null,
      sex: s.sex || null,
      // ★空文字は NULL にする。DBの CHECK は NULL を通すが空文字は弾く（調査結果に "" が混ざっていた）
      basis: s.basis || null,
      value_num: s.value_num ?? null,
      value_text: s.value_text ?? null,
      source_url: s.source_url,
      source_label: s.source_label || `${p.school_name}高校 学校資料`,
      as_of: s.as_of ?? null,
      note: s.note || null,
      verified_at: verifiedAt,
    };
  });
  if (stats.length) {
    const { error } = await supa.from('high_school_stats').upsert(stats, {
      onConflict: 'campus_id,course_label,fiscal_year,metric,item,grade,sex,basis',
    });
    if (error) throw error;
  }

  if (p.official_url) {
    const { error } = await supa
      .from('high_school_campuses')
      .update({ official_url: p.official_url })
      .eq('id', campus.id);
    if (error) throw error;
  }

  // --- 部活 ---
  const existing = await selectAll(
    'high_school_clubs',
    'id, club_key, sex, tier, tier_basis, designation, verified_at',
    (q) => q.eq('campus_id', campus.id)
  );
  const byKey = new Map(existing.map((c) => [`${c.club_key}|${c.sex}`, c]));
  const clubIds = [];
  for (const c of clubs) {
    const { clubKey: key, sex } = normalizeClubName(c.name);
    const cur = byKey.get(`${key}|${sex}`);
    const fields = {
      name: c.name,
      kind: c.kind || null,
      days_per_week: c.days_per_week ?? null,
      weekend: c.weekend || null,
      days_note: c.days_note ?? null,
      source_url: c.source_url ?? null,
      as_of: c.as_of ?? null,
    };
    // ★段階は上げるだけ（数字が小さいほど強い）。下げない
    const raise = c.tier != null && (cur?.tier == null || c.tier < cur.tier);
    if (raise) {
      Object.assign(fields, {
        tier: c.tier,
        tier_basis: cur?.designation ? `${c.tier_basis} ／ ${cur.designation}` : c.tier_basis,
        verified_at: verifiedAt,
      });
    }
    let id = cur?.id;
    if (cur) {
      const { error } = await supa.from('high_school_clubs').update(fields).eq('id', cur.id);
      if (error) throw error;
    } else {
      const { data, error } = await supa
        .from('high_school_clubs')
        .insert({ campus_id: campus.id, club_key: key, sex, ...fields })
        .select('id')
        .single();
      if (error) throw error;
      id = data.id;
    }
    clubIds.push(id);
    c._id = id;
  }

  // ★男女の区別の無い行（Premiere Club の「ソフトテニス（男女）」、前回の調査の「サッカー部（男女）」）があり、
  //   この調査が男子・女子の行に分けたときは、指定を男子・女子の行に移して区別の無い行を消す。
  //   残すと同じ部が2つ数えられ、男子・女子の行には指定が出ない（清瀬で実際に起きた）。
  const splitOf = (key) =>
    clubs.filter((c) => {
      const n = normalizeClubName(c.name);
      return n.clubKey === key && n.sex !== '';
    });
  for (const cur of existing) {
    if (cur.sex !== '') continue;
    if (
      clubs.some(
        (c) =>
          normalizeClubName(c.name).clubKey === cur.club_key && normalizeClubName(c.name).sex === ''
      )
    )
      continue;
    const split = splitOf(cur.club_key);
    if (!split.length) continue;
    for (const c of cur.designation ? split : []) {
      const { data: now, error: e1 } = await supa
        .from('high_school_clubs')
        .select('tier, tier_basis')
        .eq('id', c._id)
        .single();
      if (e1) throw e1;
      const patch = { designation: cur.designation };
      if (cur.tier != null && (now.tier == null || cur.tier < now.tier)) {
        Object.assign(patch, {
          tier: cur.tier,
          tier_basis: cur.tier_basis,
          verified_at: cur.verified_at,
        });
      } else if (now.tier_basis && !now.tier_basis.includes(cur.designation)) {
        patch.tier_basis = `${now.tier_basis} ／ ${cur.designation}`;
      }
      const { error } = await supa.from('high_school_clubs').update(patch).eq('id', c._id);
      if (error) throw error;
    }
    const { error } = await supa.from('high_school_clubs').delete().eq('id', cur.id);
    if (error) throw error;
    console.log(
      `    （注）${cur.club_key}：男女の区別の無い行を男子・女子の行にまとめた${cur.designation ? `（指定 ${cur.designation} を移した）` : ''}`
    );
  }

  // 大会実績はこの調査だけが書くので、学校の分を消して入れ直す
  const allClubIds = [...new Set([...existing.map((c) => c.id), ...clubIds])];
  if (allClubIds.length) {
    const { error } = await supa
      .from('high_school_club_results')
      .delete()
      .in('club_id', allClubIds);
    if (error) throw error;
  }
  const results = clubs.flatMap((c) =>
    (c.results ?? []).map((r) => ({
      club_id: c._id,
      fiscal_year: r.fiscal_year,
      competition: r.competition,
      level: r.level,
      result: r.result,
      happened_on: r.happened_on ?? null,
      source_url: r.source_url,
      verified_at: verifiedAt,
    }))
  );
  if (results.length) {
    const { error } = await supa.from('high_school_club_results').insert(results);
    if (error) throw error;
  }

  // --- 指定校（学校の公式分だけ。塾内で聞いた分は触らない） ---
  {
    const { error } = await supa
      .from('high_school_designated_universities')
      .delete()
      .eq('campus_id', campus.id)
      .eq('source_kind', '公式');
    if (error) throw error;
    const rows = (p.designated_universities ?? []).map((d) => ({
      campus_id: campus.id,
      fiscal_year: d.fiscal_year ?? null,
      university: d.university,
      source_kind: '公式',
      source_url: d.source_url ?? null,
      note: d.note || null,
      verified_at: verifiedAt,
    }));
    if (rows.length) {
      const { error: e2 } = await supa.from('high_school_designated_universities').insert(rows);
      if (e2) throw e2;
    }
  }

  // --- 学校の変化 ---
  {
    const { error } = await supa.from('high_school_events').delete().eq('campus_id', campus.id);
    if (error) throw error;
    const rows = (p.events ?? []).map((v) => ({
      campus_id: campus.id,
      kind: v.kind,
      period_label: v.period_label,
      happened_on: v.happened_on ?? null,
      summary: v.summary,
      source_url: v.source_url,
      verified_at: verifiedAt,
    }));
    if (rows.length) {
      const { error: e2 } = await supa.from('high_school_events').insert(rows);
      if (e2) throw e2;
    }
  }
  console.log(`    → 書き込み済み`);
}

// ★process.exit() で抜けると Windows で Node が落ちる（UV_HANDLE_CLOSING）。exitCode で返す
if (failed) {
  console.log(`\n${failed}ファイルに問題がある（上の ✗）。直してから入れる`);
  process.exitCode = 1;
}
