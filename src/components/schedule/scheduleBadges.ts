/**
 * 座席表の科目チップ色の単一ソース。
 * StudentCard（座席カード）と ScheduleLegend（凡例）が同じ定義を参照するための共有モジュール。
 *
 * 単発コマの種別（体験・テスト対策・追加授業）のバッジ色はここにあったが、
 * 種別を行色で表すことにしたため廃止した（行色は scheduleDensity.module.css の
 * .trialRow / .testPrepRow / .additionalRow）。
 */

/**
 * 科目カラーチップの色トーン（単一ソース）。
 * 座席カード（StudentCard）と凡例（ScheduleLegend）が同じ配色を参照するための共有定義。
 *
 * 方針（Phase U 密度改修で確定）:
 *   国=indigo / 数・算=blue / 英=emerald / 理=teal / 社=amber / プログラミング・HAL=violet / その他=gray
 *   ※ rose（danger）は「状態色」専用に予約し、科目には使わない。
 *
 * 色は密度モックの科目チップ配色（scheduleDensity.module.css の subjChip-* と対応）。
 * ここでは色トーンのキー（'indigo' 等）だけを返し、実クラスは CSS モジュール側で解決する。
 */
export type SubjectChipTone = 'indigo' | 'blue' | 'emerald' | 'teal' | 'amber' | 'violet' | 'gray';

/** 科目名 → チップ表示（短ラベル + 色トーン）。名前ベースの決定的マッピング。 */
export function getSubjectChip(name: string): { label: string; tone: SubjectChipTone } {
  const n = (name ?? '').trim();
  if (!n) return { label: '', tone: 'gray' };

  // プログラミング系（HAL 教材含む）は violet。長い名前はそのまま短縮せず先頭数文字。
  if (n.includes('HAL') || n.includes('プログラ')) {
    return { label: n.length <= 4 ? n : n.slice(0, 4), tone: 'violet' };
  }
  // 主要教科は先頭の教科文字で色を決める（「国理」「理社」等の複合名も先頭優先で拾う）。
  // 判定順は、複合名で誤爆しにくいよう固有度の高いものから。
  if (n.startsWith('国')) return { label: shortSubjectLabel(n), tone: 'indigo' };
  if (n.startsWith('英')) return { label: shortSubjectLabel(n), tone: 'emerald' };
  if (n.startsWith('数') || n.startsWith('算'))
    return { label: shortSubjectLabel(n), tone: 'blue' };
  if (n.startsWith('理')) return { label: shortSubjectLabel(n), tone: 'teal' };
  if (n.startsWith('社')) return { label: shortSubjectLabel(n), tone: 'amber' };
  // その他（面談・作文・その他教科など）は gray。
  return { label: shortSubjectLabel(n), tone: 'gray' };
}

/** チップ用の短ラベル。1〜2文字の教科名はそのまま、長い名前は先頭2文字。 */
function shortSubjectLabel(name: string): string {
  return name.length <= 2 ? name : name.slice(0, 2);
}
