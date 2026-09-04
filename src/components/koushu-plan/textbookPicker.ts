/**
 * テキスト（教材）選択ピッカーの絞り込みと並び順。
 *
 * 提案書エディタと講習テンプレートの編集画面で同じ選び方にするため、
 * 画面から独立した部分だけをここに置く。
 */

/** ピッカーが必要とする教材の最小フィールド */
export interface PickableTextbook {
  id: number;
  name: string;
  subject?: string | null;
  publisher?: string | null;
  grade?: string | null;
  school_type?: string | null;
}

export interface TextbookFilter {
  schoolType?: string;
  subject?: string;
  grade?: string;
  /** 名前・教科・出版社の部分一致（大文字小文字を無視） */
  search?: string;
}

/** 教科の並び順。主要教科を先に出す */
const SUBJECT_ORDER = ['英語', '数学', '算数', '国語', '理科', '社会'];
const GRADE_ORDER = ['1年', '2年', '3年', '4年', '5年', '6年', '共通'];

/** 並び順表に無い値は末尾へ回す */
function orderIndex(table: string[], value: string | null | undefined): number {
  const idx = table.indexOf(value || '');
  return idx === -1 ? 999 : idx;
}

/**
 * 絞り込み＋並び替え。
 *
 * 並び順は「お気に入り → 教科 → 学年 → 名前」。
 * 教材が多くて絞り込みが面倒という要望への対応で、よく使う教材を最上部に固定する。
 */
export function filterAndSortTextbooks<T extends PickableTextbook>(
  textbooks: T[],
  filter: TextbookFilter,
  favoriteIds: Set<number>
): T[] {
  const q = filter.search?.trim().toLowerCase();

  return textbooks
    .filter((tb) => {
      if (filter.schoolType && tb.school_type !== filter.schoolType) return false;
      if (filter.subject && tb.subject !== filter.subject) return false;
      if (filter.grade && tb.grade !== filter.grade) return false;
      if (q) {
        const hit =
          tb.name.toLowerCase().includes(q) ||
          !!tb.subject?.toLowerCase().includes(q) ||
          !!tb.publisher?.toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const favA = favoriteIds.has(a.id) ? 0 : 1;
      const favB = favoriteIds.has(b.id) ? 0 : 1;
      if (favA !== favB) return favA - favB;
      const subj = orderIndex(SUBJECT_ORDER, a.subject) - orderIndex(SUBJECT_ORDER, b.subject);
      if (subj !== 0) return subj;
      const gr = orderIndex(GRADE_ORDER, a.grade) - orderIndex(GRADE_ORDER, b.grade);
      if (gr !== 0) return gr;
      return a.name.localeCompare(b.name, 'ja');
    });
}

/** 絞り込みドロップダウンに出す選択肢。学年だけは選択中の学校種別に連動させる */
export function textbookFilterOptions<T extends PickableTextbook>(
  textbooks: T[],
  schoolType?: string
): { schoolTypes: string[]; subjects: string[]; grades: string[] } {
  const uniqueSorted = (values: (string | null | undefined)[]) =>
    Array.from(new Set(values.filter((v): v is string => !!v))).sort();

  return {
    schoolTypes: uniqueSorted(textbooks.map((t) => t.school_type)),
    subjects: uniqueSorted(textbooks.map((t) => t.subject)),
    grades: uniqueSorted(
      textbooks.filter((t) => !schoolType || t.school_type === schoolType).map((t) => t.grade)
    ),
  };
}
