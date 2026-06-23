/**
 * 講師バッジの変更を画面間で同期するためのイベントハブ
 * 編集ページでトグル → 一覧/詳細ページがこれをリッスンして再取得
 */
const EVENT_NAME = 'teacher-badges-changed';

export function emitTeacherBadgesChanged(teacherId: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { teacherId } }));
}

export function onTeacherBadgesChanged(handler: (teacherId: string) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<{ teacherId: string }>).detail;
    if (detail?.teacherId) handler(detail.teacherId);
  };
  window.addEventListener(EVENT_NAME, listener);
  return () => window.removeEventListener(EVENT_NAME, listener);
}
