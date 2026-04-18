'use client';

import { useEffect, useRef, useState } from 'react';

const STORAGE_PREFIX = 'nest-form-draft:';

interface UsePortalFormDraftOptions<T extends object> {
  /** 復元先の学校コードと期間キーなどから組むユニークキー */
  storageKey: string;
  /** 現在のフォーム状態 */
  value: T;
  /** 復元時に呼び出される。state setter をまとめて呼ぶ */
  onRestore: (draft: T) => void;
  /** 送信完了時に呼んでドラフトを破棄 */
  clearOnSubmit?: boolean;
  /** プレビューモードや初期ロード中は保存しない */
  enabled?: boolean;
}

/**
 * ポータルフォーム用のドラフト自動保存フック。
 * - onChange で localStorage に保存（debounce 500ms）
 * - マウント時に下書きがあれば即復元（ユーザー確認は出さず、上書きしない方針）
 * - 送信完了で手動 clearDraft()
 *
 * 復元は「静かに」: フォーム上部にバナー表示もなく、ユーザーの入力済み情報をそのまま
 * 復元する。モバイルで途中離脱・復帰が多い保護者を想定しているため、
 * 確認ダイアログでフローを止めないことを優先。
 */
export function usePortalFormDraft<T extends object>({
  storageKey,
  value,
  onRestore,
  enabled = true,
}: UsePortalFormDraftOptions<T>) {
  const key = `${STORAGE_PREFIX}${storageKey}`;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoredRef = useRef(false);
  const [hasRestoredDraft, setHasRestoredDraft] = useState(false);

  // 初期ロード時に下書きがあれば復元（1度だけ）
  useEffect(() => {
    if (!enabled || restoredRef.current) return;
    restoredRef.current = true;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const parsed = JSON.parse(raw) as T;
      onRestore(parsed);
      setHasRestoredDraft(true);
    } catch {
      // 壊れた下書きは無視して削除
      try {
        localStorage.removeItem(key);
      } catch {
        /* noop */
      }
    }
    // onRestore/key は初回のみ参照するため依存配列に入れない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // value の変更を debounce して保存
  useEffect(() => {
    if (!enabled || !restoredRef.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      try {
        // 空のフォーム状態は保存しない
        const hasContent = Object.values(value).some((v) => {
          if (v == null || v === '' || v === false) return false;
          if (Array.isArray(v)) return v.length > 0;
          if (typeof v === 'object') return Object.keys(v).length > 0;
          return true;
        });
        if (!hasContent) {
          localStorage.removeItem(key);
          return;
        }
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* quota exceeded 等は黙認 */
      }
    }, 500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value, key, enabled]);

  const clearDraft = () => {
    try {
      localStorage.removeItem(key);
    } catch {
      /* noop */
    }
    setHasRestoredDraft(false);
  };

  return { hasRestoredDraft, clearDraft };
}
