/** 氏名照合用：空白（半角・全角）を除去して比較キーにする */
export function normalizePersonName(name: string | null | undefined): string {
  return (name ?? '').replace(/[\s\u3000]+/g, '').trim();
}
