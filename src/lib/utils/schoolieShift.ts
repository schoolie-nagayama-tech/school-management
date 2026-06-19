/**
 * NEST の季節講習シフト提出 → スクールIE(M Planning「講習会契約設定」)への自動入力ヘルパー。
 *
 * スクールIEの契約設定グリッドは、日付×時限ごとに name="BASE_YYYYMMDD_{時限index}" の
 * チェックボックスを持つプレーンHTMLフォーム。reCAPTCHAは無いが「登録」押下時に確認ダイアログが出る。
 * サーバー直POSTはセッション/フレーム依存で不安定なため、ブラウザ上で動くブックマークレットが
 * チェックを入れ、最終の「登録」と確認ダイアログだけ人間が行う方式を採る（取次発注と同じ思想）。
 *
 * 時限indexは永山校のスクールIE画面実物から確認した対応:
 *   HALLO① 15:10-16:00 → 7 / HALLO② 16:10-17:00 → 8 / HALLO③ 18:10-19:30 → 9
 *   3限 12:50-14:20 → 12 / 4限 14:25-15:55 → 13 / 5限 16:20-17:50 → 14
 *   6限 17:55-19:25 → 15 / 7限 19:30-21:00 → 16
 * NESTの季節講習の時間帯(time_slot, "HH:MM-HH:MM")をこの表で引き、一致しないものは除外(skipped)する。
 * ※ この時刻表は永山校の時限定義に依存する。別校舎で時刻が異なる場合は skipped に出るので要確認。
 */

/** スクールIE の時限時刻文字列 → チェックボックス name のindexサフィックス。 */
export const SCHOOLIE_TIME_SLOT_INDEX: Record<string, number> = {
  '15:10-16:00': 7, // HALLO①
  '16:10-17:00': 8, // HALLO②
  '18:10-19:30': 9, // HALLO③
  '12:50-14:20': 12, // 3限
  '14:25-15:55': 13, // 4限
  '16:20-17:50': 14, // 5限
  '17:55-19:25': 15, // 6限
  '19:30-21:00': 16, // 7限
};

/** シフト提出スロットの最小形（available な日付×時間帯）。 */
export interface ShiftSlotLike {
  shift_date: string; // 'YYYY-MM-DD'
  time_slot: string; // 'HH:MM-HH:MM'
  available: boolean;
}

export interface SchoolieCheckboxResult {
  /** チェックすべきチェックボックス name 一覧（BASE_YYYYMMDD_idx）。 */
  names: string[];
  /** 対応表に無く除外した time_slot の一覧（重複除去）。空ならすべて変換できた。 */
  skipped: string[];
}

/**
 * available なスロットを スクールIE のチェックボックス name 配列に変換する。
 * 対応表に無い time_slot は names に含めず skipped に記録する（黙って落とさない）。
 */
export function buildSchoolieCheckboxNames(slots: ShiftSlotLike[]): SchoolieCheckboxResult {
  const names: string[] = [];
  const skippedSet = new Set<string>();
  for (const s of slots) {
    if (!s.available) continue;
    const idx = SCHOOLIE_TIME_SLOT_INDEX[s.time_slot];
    if (idx == null) {
      skippedSet.add(s.time_slot);
      continue;
    }
    const ymd = s.shift_date.replace(/-/g, '');
    names.push(`BASE_${ymd}_${idx}`);
  }
  // 安定した並びに（日付→index）
  names.sort();
  return { names, skipped: Array.from(skippedSet) };
}

/** クリップボードに書き込む payload の型（ブックマークレットが読む）。 */
export interface SchooliePayload {
  _nest_schoolie: true;
  teacher_name: string;
  names: string[];
}

/**
 * スクールIE「講習会契約設定」ページで実行する自動入力ブックマークレット（静的・1回だけ導入）。
 * クリップボードの payload を読み、フレーム内グリッドの該当チェックボックスを ON にする。
 * 「登録」押下と確認ダイアログは人間が行う（誤登録防止）。
 */
export const SCHOOLIE_BOOKMARKLET = `javascript:(async()=>{try{const t=await navigator.clipboard.readText();const d=JSON.parse(t);if(!d||!d._nest_schoolie){alert('NESTの出勤データがクリップボードにありません。NESTの提出一覧で講師の「スクールIEへコピー」を押してから実行してください。');return;}let cdoc=null;for(let i=0;i<window.frames.length;i++){try{const f=window.frames[i];if(f.document&&f.document.querySelectorAll('input[type=checkbox][name^=\"BASE_\"]').length){cdoc=f.document;break;}}catch(e){}}if(!cdoc&&document.querySelectorAll('input[type=checkbox][name^=\"BASE_\"]').length)cdoc=document;if(!cdoc){alert('講習会契約設定の入力グリッドが見つかりません。対象講師の「講習会契約設定」を開いてから実行してください。');return;}let ok=0,miss=0;(d.names||[]).forEach(function(n){const el=cdoc.getElementsByName(n)[0];if(!el){miss++;return;}if(!el.checked){el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));}ok++;});alert('NEST: '+(d.teacher_name||'')+' の出勤可能 '+ok+'コマを入力しました'+(miss?'（'+miss+'件は該当セルが見つからず）':'')+'。\\n内容を確認して「登録」を押してください。');}catch(e){alert('NEST入力失敗: '+((e&&e.message)||e)+'\\nクリップボードの読み取りを許可してください。');}})();`;
