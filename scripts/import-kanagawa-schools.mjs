#!/usr/bin/env node
// docs/data/ の神奈川の3つのCSV → high_schools + high_school_standards（神奈川県）
//   kanagawa-goukaku-kijun-2026.csv  … 合格基準（写真から手起こし）
//   kanagawa-school-address-r7.csv   … 所在地（神奈川県オープンデータ CC BY 4.0）
//   kanagawa-school-station-r7.csv   … 座標・最寄駅・沿線（こちらで算出＋公式サイトで手動上書き）
//
// 使い方:
//   node scripts/import-kanagawa-schools.mjs            # 下見（書き込まない）
//   node scripts/import-kanagawa-schools.mjs --go       # 実際に入れる
//   ... --verified                                     # 人間が紙と突き合わせ済みのときだけ
//
// 東京と別スクリプトにしている理由: 資料の作りが違う。
//   東京（Vもぎ）= 総合得点（学力検査＋調査書＝1000点）・換算内申（65/75/52）
//   神奈川（新教育研究協会）= 基準S1値（1000点・各校の比率で計算・特色検査を含まない）
//                              ・基準内申（重点化校も含めて全て135点満点）
//   所在地の出どころも違う（東京=都教委の学校一覧／神奈川=県のオープンデータ）。
//
// ★列の使い回しに注意（docs/data/README.md にも書いた）:
//   - total_score に入るのは神奈川では「基準S1値」。東京の「総合得点」とは算出法が違う。
//     数字の見た目が同じ1000点満点なので、県をまたいで比べないこと。
//     画面・AIに出すときのラベルは src/lib/ai/schoolLookup.ts が県ごとに出し分ける。
//   - naishin_max は神奈川では常に 135（中2の9教科＋中3の9教科×2）。東京の 65/75/52 と別物。
//   - exam_type（共通/自校作成）と gakuryoku_ratio（7:3 等）は神奈川では使わない（NULL）。
//     各校の比率 f:g はこの資料に無く、県の「選考基準」が正典。
//   - 単位制・3科/4科は note に文字で入れる（専用列を足すほどの使い道がまだ無い）。
//
// ★所在地・最寄駅の結合キーは school_name（合格基準一覧表の表記。「市立東」「県立川崎」など）。
//   県オープンデータのIDは横浜瀬谷と厚木王子で重複している（元データの誤り）ので使えない。
//   同じ理由で high_schools.school_code にも入れない（NULLのまま）。東京の school_code は
//   都教委の学校番号で、そもそも意味が違う。
// ★access_stations（「駅名(距離m)」の配列）はまだ入れない。列を足す東京側のPR
//   （claude/ai-help-school-location）がマージされたら、東京と同じく arr(s.access_stations) を足す。

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

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
const FILE = opt('--file', 'kanagawa-goukaku-kijun-2026.csv');
const SOURCE = '新教育研究協会';
const SOURCE_YEAR = Number(opt('--year', '2026'));
const SOURCE_LABEL = opt('--label', '合格基準一覧表 2026年度');
const LOCATION_SOURCE = '神奈川県 公立小・中・高等学校等一覧（2025-08-15）';

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
  const head = rows.shift();
  return rows
    .filter((r) => r.some((v) => v !== ''))
    .map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

const num = (v) => (v === '' || v == null ? null : Number(v));
const str = (v) => (v === '' ? null : v);
const arr = (v) => (v ? v.split(';').filter(Boolean) : null);

const read = (f) => parseCsv(readFileSync(`docs/data/${f}`, 'utf8').trim());
const src = read(FILE);
const addrBy = new Map(read('kanagawa-school-address-r7.csv').map((r) => [r.school_name, r]));
const staBy = new Map(read('kanagawa-school-station-r7.csv').map((r) => [r.school_name, r]));

const rows = src.map((r) => {
  // 単位制・入試教科数は専用列を作らず note に持つ
  const notes = [];
  if (r.tanisei === '1') notes.push('単位制');
  if (r.subjects === '3') notes.push('3教科入試');
  if (r.subjects === '4') notes.push('4教科入試');
  if (r.note?.trim()) notes.push(r.note.trim());
  const a = addrBy.get(r.school_name);
  const s = staBy.get(r.school_name);
  return {
    row: {
      prefecture: '神奈川県',
      school_name: r.school_name,
      course: r.course || '', // ★NULLにしない。UNIQUEが効かなくなる
      category: r.category,
      region: str(r.region),
      school_code: null, // ★県オープンデータのIDは重複があるので入れない（冒頭の注記）
      old_district: null, // 神奈川に学区制は無い
      municipality: a ? a.municipality : null,
      address: a ? a.full_address : null,
      lat: s ? num(s.lat) : null,
      lon: s ? num(s.lon) : null,
      primary_station: s ? str(s.primary_station) : null,
      primary_lines: s ? arr(s.primary_lines) : null,
      access_lines: s ? arr(s.access_lines) : null,
      station_source: s ? str(s.source) : null,
      location_source: a ? LOCATION_SOURCE : null,
    },
    std: {
      source: SOURCE,
      source_year: SOURCE_YEAR,
      source_label: SOURCE_LABEL,
      total_score: num(r.s1), // ★神奈川では「基準S1値」
      naishin: num(r.naishin),
      naishin_max: r.naishin?.trim() ? 135 : null,
      hensachi: num(r.hensachi),
      exam_type: null,
      gakuryoku_ratio: null,
      note: notes.length ? notes.join('・') : null,
      verified_at: VERIFIED ? new Date().toISOString() : null,
    },
  };
});

const blankNaishin = rows.filter((x) => x.std.naishin == null);
const blankS1 = rows.filter((x) => x.std.total_score == null);

console.log(
  `版: ${SOURCE_LABEL}（source_year=${SOURCE_YEAR}・${FILE}・verified=${VERIFIED ? 'あり' : 'なし'}）`
);
console.log(`→ high_schools（神奈川県）${rows.length}行`);
const noAddr = [...new Set(rows.filter((x) => !x.row.municipality).map((x) => x.row.school_name))];
const noSta = [...new Set(rows.filter((x) => !x.row.access_lines).map((x) => x.row.school_name))];
console.log(`所在地が付かない学校: ${noAddr.join('、') || 'なし'}`);
console.log(`沿線が付かない学校: ${noSta.join('、') || 'なし'}`);
console.log(`最寄駅が手動確認: ${rows.filter((x) => x.row.station_source === '手動').length}行`);
console.log(
  `内申が空: ${blankNaishin.length}行 … ${blankNaishin.map((x) => x.row.school_name).join('、') || 'なし'}`
);
console.log(
  `S1が空: ${blankS1.length}行 … ${blankS1.map((x) => `${x.row.school_name}(${x.row.course})`).join('、') || 'なし'}`
);

if (!GO) {
  console.log('\n--- 下見（--go を付けると書き込む）。先頭3件 ---');
  rows.slice(0, 3).forEach((x) => console.log(JSON.stringify({ ...x.row, ...x.std }, null, 1)));
  process.exit(0);
}

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false },
  }
);

const { data: upserted, error: e1 } = await supa
  .from('high_schools')
  .upsert(
    // ★establishment・gender を明示する。一意制約に入っており、省くと upsert が既存行に当たらない
    //  （2026-09-25 私立を同じ表に入れたとき一意の範囲に設置区分・男女を足した）
    rows.map((x) => ({ ...x.row, establishment: '公立' })),
    { onConflict: 'prefecture,establishment,school_name,course' }
  )
  .select('id,school_name,course');
if (e1) {
  console.error('high_schools:', e1);
  process.exit(1);
}
console.log(`high_schools upsert: ${upserted.length}行`);

const idBy = new Map(upserted.map((r) => [`${r.school_name} ${r.course}`, r.id]));
const stds = rows.map((x) => ({
  high_school_id: idBy.get(`${x.row.school_name} ${x.row.course}`),
  ...x.std,
  gender: null,
}));
const missing = stds.filter((s) => !s.high_school_id).length;
if (missing) {
  console.error(`★idが引けない行が ${missing} 件。中止する。`);
  process.exit(1);
}

const { data: sd, error: e2 } = await supa
  .from('high_school_standards')
  .upsert(stds, { onConflict: 'high_school_id,source,source_year,gender' })
  .select('id');
if (e2) {
  console.error('high_school_standards:', e2);
  process.exit(1);
}
console.log(`high_school_standards upsert: ${sd.length}行`);
console.log(
  VERIFIED
    ? '完了。verified_at を入れた（人間が紙と突き合わせ済み）。'
    : '完了。★めやすの数値は未確認（verified_at=NULL）。'
);
