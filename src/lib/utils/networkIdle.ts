/**
 * ネットワークが「静か」になるまで待つユーティリティ。
 *
 * 背景: 生徒管理ページ上部は多数のボードがハイドレーション直後に一斉に fetch するため、
 * Supabase の接続プーラーが飽和し、本来 271ms で返る API が競合で 9 秒に膨張していた
 * （実測 2026-06-16）。重い・低優先の取得（講習進捗・Heavyアラート）を、クリティカルな
 * 取得の「群れ」が捌けてから開始させることで、ピーク同時実行数を下げて全体を速くする。
 *
 * requestIdleCallback は本番だとハイドレーションが速く即発火してしまい（~1.9秒）、
 * まだクリティカル取得が在庫中の段階で重い取得を始めてしまうため効果が薄かった。
 * 代わりに「fetch/XHR が quietMs の間1本も新規発生しなかったら静か」と判定する。
 *
 * @param quietMs   この時間だけ新規 fetch/XHR が無ければ「静か」とみなす（既定 700ms）
 * @param maxWaitMs ここまで待ったら静かでなくても強制的に解決する安全弁（既定 8000ms）
 * @returns 静かになった時点（または maxWaitMs 到達時）に解決する Promise
 */
export function whenNetworkIdle(quietMs = 700, maxWaitMs = 8000): Promise<void> {
  // SSR や PerformanceObserver 非対応環境では即座に解決（フォールバック）
  if (typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    let quietTimer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      if (quietTimer) clearTimeout(quietTimer);
      clearTimeout(hardCap);
      try { observer.disconnect(); } catch { /* noop */ }
      resolve();
    };

    // quietMs の無音タイマーを張り直す。データ取得（fetch/xhr）が来るたびにリセットされる。
    const armQuietTimer = () => {
      if (quietTimer) clearTimeout(quietTimer);
      quietTimer = setTimeout(finish, quietMs);
    };

    const observer = new PerformanceObserver((list) => {
      const sawNetwork = list.getEntries().some((e) => {
        const t = (e as PerformanceResourceTiming).initiatorType;
        return t === 'fetch' || t === 'xmlhttprequest';
      });
      if (sawNetwork) armQuietTimer();
    });

    try {
      observer.observe({ type: 'resource', buffered: true });
    } catch {
      // observe 失敗時はフォールバックで即解決
      finish();
      return;
    }

    // 安全弁: いつまでも静かにならない場合でも必ず解決する
    const hardCap = setTimeout(finish, maxWaitMs);
    // 初期タイマーを張る（最初から完全に無音なケースに対応）
    armQuietTimer();
  });
}
