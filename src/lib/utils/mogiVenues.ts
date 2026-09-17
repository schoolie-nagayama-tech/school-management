// Vもぎ編集画面（MogiPeriodEditor）の会場データ復元ロジック。
//
// 会場IDは「共通会場テキストの行番号」から連番で振られる（venue_1, venue_2, ...）。
// 保存時は日程ごとに「選ばれた会場だけ」をID付きで保存するため、日程には
// 歯抜けのID（venue_1,2,6,7 など）しか残らない。
// 復元時にテキストエリアへ会場ラベルを詰め直すと行番号は詰まって振り直されるため、
// 先頭の日程が歯抜けだった場合など、並びが変わって旧IDが別の会場を指してしまう。
// そのため復元はIDではなく「ラベル文字列」を突き合わせのキーにする。

import type { MogiDate, Venue } from '@/types/forms/mogi';

/**
 * 会場テキスト（改行区切り）を Venue[] に変換する。
 * IDは行番号から連番で自動生成する（venue_1, venue_2, ...）。
 * MogiPeriodEditor の parseVenues と同じ挙動。ここに一本化し、エディタからは import して使う。
 */
export function parseVenues(text: string): Venue[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((label, index) => ({
      id: `venue_${index + 1}`,
      label,
    }));
}

export interface RestoredMogiVenues {
  /** 共通会場テキスト（改行区切り）。ラベルの初出順・重複なし */
  venueText: string;
  /** 再パース後のID（venue_N）をキーにした上履き要否 */
  venueRequiresUwabaki: Record<string, boolean>;
  /** dates と同じ順・同じ長さ。各日程の選択会場を再パース後のIDで表したもの */
  selectedVenueIdsByDate: string[][];
}

/**
 * 編集モードで DB の settings.dates から編集フォームの状態を復元する。
 *
 * 突き合わせはIDではなくラベルで行う。保存済みの venue_1,2,6,7 のような歯抜けIDを
 * そのまま使うと、復元時に詰め直された連番IDとズレて別の会場に付け替わってしまうため。
 * 「この日程でのみ使う会場」（extra_*）も同じラベル突き合わせに乗せることで、
 * 共通会場に混ざった状態でも選択が外れないようにする
 * （共通会場に混ざる仕様自体は変更しない）。
 */
export function restoreMogiEditorVenues(dates: MogiDate[] | undefined): RestoredMogiVenues {
  // ラベルの初出順を保った重複なしリストを作る（Mapはキーの挿入順を保持する）
  const labelOrder = new Map<string, true>();
  // ラベルごとの上履き要否（いずれかの日程で true なら true）
  const uwabakiByLabel = new Map<string, boolean>();

  (dates ?? []).forEach((d) => {
    d.venues.forEach((v) => {
      if (!labelOrder.has(v.label)) {
        labelOrder.set(v.label, true);
      }
      const requiresUwabaki = !!v.requires_uwabaki || !!v.bring_items?.includes('上履き');
      if (requiresUwabaki) {
        uwabakiByLabel.set(v.label, true);
      }
    });
  });

  const venueText = Array.from(labelOrder.keys()).join('\n');

  // 再パースして label -> 新ID の対応表を作る
  const reparsed = parseVenues(venueText);
  const idByLabel = new Map<string, string>();
  reparsed.forEach((v) => idByLabel.set(v.label, v.id));

  const venueRequiresUwabaki: Record<string, boolean> = {};
  uwabakiByLabel.forEach((_, label) => {
    const newId = idByLabel.get(label);
    if (newId) venueRequiresUwabaki[newId] = true;
  });

  const selectedVenueIdsByDate = (dates ?? []).map((d) =>
    d.venues.map((v) => idByLabel.get(v.label)).filter((id): id is string => !!id)
  );

  return { venueText, venueRequiresUwabaki, selectedVenueIdsByDate };
}
