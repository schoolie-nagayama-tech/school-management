#!/usr/bin/env node
// 私立・国立の高校の位置（緯度経度）を国土地理院の地名検索から入れる。
//
//   node scripts/geocode-private-high-schools.mjs          # 下見（書き込まない）
//   node scripts/geocode-private-high-schools.mjs --go     # 実際に入れる
//
// 使いどころ: 面談④「志望校と提案」で、私立を教室の最寄り駅からの距離で絞り、地図に出すため
// （docs/private-high-school-master.md「残作業」）。冊子に住所が無いので、学校名から位置を引く。
//
// ★採るのは、検索結果の title が「私立（国立）＋正式名＋高等学校」と**完全一致**した地物だけ。
//   部分一致を採ると、同じ語を含む地名（「北海道豊浦町桜」）や別の学校の座標になる。
// ★同じ名前の学校が他県にある（明星＝東京と大阪、大成＝東京と愛知）。当たった地点を逆引きし、
//   市区町村コードの頭2桁が学校の都県と一致したものだけを採る。
// ★冊子の学校名は略称（「日大第三」「文化学園大杉並」）なので、正式名の候補を作って順に試す。
//   候補を多めに作っても、完全一致＋都県の一致で絞るので誤って当たることはない。
// ★当たらなかった学校は一覧に出すだけで、推測で埋めない。位置が空の学校は提案の候補にならないだけで、
//   登録済みの志望校としては表に出る。
// ★学校×コースで行が分かれているので、同じ学校（都県・設置区分・学校名）の全行に同じ位置を入れる。
//   すでに位置が入っている行は上書きしない（手で直した値を守る）。

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

const ENV = existsSync('.env.local') ? '.env.local' : resolve(process.cwd(), '../../../.env.local');
config({ path: ENV });

const GO = process.argv.includes('--go');
const SOURCE = 'gsi-address-search:name';

/** 都県 → 市区町村コードの頭2桁（JIS X 0401） */
const PREF_CODE = {
  茨城県: '08',
  栃木県: '09',
  埼玉県: '11',
  千葉県: '12',
  東京都: '13',
  神奈川県: '14',
  山梨県: '19',
};

/** 大学名の略称。★長いものから当てる（「日体大」を「日大」より先に） */
const UNIV_ALIASES = [
  ['日女体大', '日本女子体育大学'],
  ['日体大', '日本体育大学'],
  ['日本体育大', '日本体育大学'],
  ['日大', '日本大学'],
  ['明大', '明治大学'],
  ['中大', '中央大学'],
  ['早大', '早稲田大学'],
  ['拓大', '拓殖大学'],
  ['東京農大', '東京農業大学'],
  ['千葉商大', '千葉商科大学'],
  ['芝浦工大', '芝浦工業大学'],
  ['日本工大', '日本工業大学'],
  // 冊子が新字体・略称で書いている学校（地名検索は正式な表記でしか当たらない）
  ['慶応義塾', '慶應義塾'],
  ['国学院久我山', '國學院大學久我山'],
  ['国学院', '國學院'],
  ['明学', '明治学院'],
  ['渋谷教育', '渋谷教育学園'],
  ['多摩大聖ヶ丘', '多摩大学附属聖ヶ丘'],
  ['青山学院大浦和ルーテル', '浦和ルーテル学院'],
  // 大学の種類の略（「国立音大」「湘南工科大」は下の汎用の置き換えで「大学」になる）
  ['音大', '音楽大学'],
  ['工大', '工業大学'],
  ['商大', '商科大学'],
  ['農大', '農業大学'],
];

/** 「高等学校」ではない名前の学校（地名検索の title もこの名前） */
const SUFFIX_OVERRIDE = { 学習院: '高等科' };

/** 学校名から正式名の候補を作る（重複なし・元の名前も含む） */
export function nameCandidates(raw) {
  // 「明大付属世田谷（日本学園）」「鎌倉国際文理(鎌倉女子大)」→ 括弧の外と中の両方を試す
  const bases = new Set();
  const m = raw.match(/^(.*?)[（(](.*?)[）)]\s*$/);
  if (m) {
    bases.add(m[1].trim());
    bases.add(m[2].trim());
  } else {
    bases.add(raw.trim());
  }

  const out = new Set();
  for (const base of bases) {
    const forms = new Set([base]);
    for (const [abbr, full] of UNIV_ALIASES) {
      for (const f of Array.from(forms)) if (f.includes(abbr)) forms.add(f.replace(abbr, full));
    }
    for (const f of Array.from(forms)) {
      // 「大附」「大付」「大第」「大」末尾 → 「大学附属」「大学付属」「大学第」「大学」
      forms.add(
        f
          .replace(/大附属/g, '大学附属')
          .replace(/大付属/g, '大学付属')
          .replace(/大附(?!属)/g, '大学附属')
          .replace(/大付(?!属)/g, '大学付属')
          .replace(/大第/g, '大学第')
          .replace(/大(?![学附付第])/g, '大学')
      );
      forms.add(f.replace(/附(?!属)/g, '附属').replace(/付(?!属)/g, '付属'));
    }
    for (const f of forms) out.add(f.replace(/大学学/g, '大学'));
  }
  return Array.from(out);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function search(title) {
  const url = `https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(title)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`地名検索 ${res.status}`);
  const list = await res.json();
  return list.filter((x) => x?.properties?.title === title);
}

async function prefCodeAt(lat, lon) {
  const url = `https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat=${lat}&lon=${lon}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const json = await res.json();
  const cd = json?.results?.muniCd;
  return typeof cd === 'string' ? cd.padStart(5, '0').slice(0, 2) : null;
}

/** 1校ぶん。当たれば { lat, lon, title }、当たらなければ null */
async function locate(school) {
  const want = PREF_CODE[school.prefecture];
  for (const name of nameCandidates(school.school_name)) {
    const title = `${school.establishment}${name}${SUFFIX_OVERRIDE[school.school_name] ?? '高等学校'}`;
    const hits = await search(title);
    await sleep(150);
    for (const h of hits) {
      const [lon, lat] = h.geometry.coordinates;
      const code = await prefCodeAt(lat, lon);
      await sleep(150);
      if (want && code === want) return { lat, lon, title };
    }
  }
  return null;
}

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false },
  }
);

async function main() {
  // 私立・国立は1,000行未満だが、上限で静かに切れないよう分けて読む
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supa
      .from('high_schools')
      .select('id,prefecture,establishment,school_name,lat,lon')
      .neq('establishment', '公立')
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) break;
  }

  const bySchool = new Map();
  for (const r of rows) {
    const key = `${r.prefecture}|${r.establishment}|${r.school_name}`;
    if (!bySchool.has(key)) bySchool.set(key, { ...r, ids: [], missingIds: [] });
    const s = bySchool.get(key);
    s.ids.push(r.id);
    if (r.lat == null || r.lon == null) s.missingIds.push(r.id);
  }
  const targets = Array.from(bySchool.values()).filter((s) => s.missingIds.length > 0);
  console.log(`学校 ${bySchool.size}校（位置が空の学校 ${targets.length}校・行 ${rows.length}）`);

  const found = [];
  const notFound = [];
  for (const s of targets) {
    const hit = await locate(s);
    if (hit) found.push({ ...s, ...hit });
    else notFound.push(s);
    process.stdout.write(hit ? '.' : 'x');
  }
  console.log(`\n当たった ${found.length}校／当たらない ${notFound.length}校`);
  for (const s of notFound) console.log(`  × ${s.prefecture} ${s.establishment} ${s.school_name}`);

  if (!GO) {
    console.log('\n--- 下見（--go を付けると書き込む） ---');
    return;
  }
  let updated = 0;
  for (const s of found) {
    const { error, count } = await supa
      .from('high_schools')
      .update({ lat: s.lat, lon: s.lon, location_source: SOURCE }, { count: 'exact' })
      .in('id', s.missingIds)
      // ★手で直した位置を上書きしない
      .is('lat', null);
    if (error) throw error;
    updated += count ?? 0;
  }
  console.log(`書き込み ${updated}行`);
}

if (process.argv[1] && process.argv[1].endsWith('geocode-private-high-schools.mjs')) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
