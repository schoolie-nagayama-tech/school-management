/**
 * ページごとの花の配置定義。
 * バッジ獲得数だけ先頭から表示される。"隠す" くらい控えめな位置選びをする。
 */

import type { FlowerPlacement } from './HiddenFlower';

/** /my/badges — マイバッジページ。獲得状況カードの跡地と各セクションのすき間 */
export const MY_BADGES_FLOWERS: FlowerPlacement[] = [
  { position: { top: '-6px', right: '-6px' }, size: 14, rotate: 22, opacity: 0.5 },
  { position: { top: '60px', right: '36%' }, size: 11, rotate: -12, opacity: 0.45 },
  { position: { top: '120px', left: '8px' }, size: 13, rotate: 8, opacity: 0.5 },
  { position: { bottom: '180px', right: '12px' }, size: 16, rotate: -20, opacity: 0.4 },
  { position: { top: '40%', left: '-8px' }, size: 10, rotate: 35, opacity: 0.55 },
  { position: { bottom: '40px', left: '30%' }, size: 12, rotate: 5, opacity: 0.45 },
  { position: { top: '20%', right: '0px' }, size: 11, rotate: -30, opacity: 0.5 },
  { position: { bottom: '80px', right: '38%' }, size: 14, rotate: 18, opacity: 0.4 },
  { position: { top: '55%', left: '20%' }, size: 9, rotate: 60, opacity: 0.55 },
  { position: { bottom: '8px', right: '8px' }, size: 13, rotate: -8, opacity: 0.45 },
];

/** /students — 生徒管理ページ（講師がよく見るページ） */
export const STUDENTS_FLOWERS: FlowerPlacement[] = [
  { position: { top: '0', right: '0' }, size: 11, rotate: 25, opacity: 0.4 },
  { position: { top: '30%', left: '-6px' }, size: 10, rotate: -18, opacity: 0.45 },
  { position: { bottom: '12px', right: '24%' }, size: 12, rotate: 12, opacity: 0.4 },
  { position: { top: '60%', right: '4px' }, size: 9, rotate: 45, opacity: 0.5 },
  { position: { bottom: '40%', left: '6px' }, size: 13, rotate: -5, opacity: 0.4 },
];

/** /schedule — スケジュールページ */
export const SCHEDULE_FLOWERS: FlowerPlacement[] = [
  { position: { top: '4px', right: '12px' }, size: 10, rotate: 30, opacity: 0.4 },
  { position: { bottom: '8px', left: '12px' }, size: 11, rotate: -22, opacity: 0.45 },
  { position: { top: '50%', right: '-4px' }, size: 9, rotate: 60, opacity: 0.5 },
  { position: { bottom: '30%', right: '20%' }, size: 12, rotate: 10, opacity: 0.4 },
  { position: { top: '15%', left: '8px' }, size: 10, rotate: -40, opacity: 0.45 },
];

/** /attendance — 出勤簿（講師は日常的に開く） */
export const ATTENDANCE_FLOWERS: FlowerPlacement[] = [
  { position: { top: '8px', left: '40%' }, size: 10, rotate: 15, opacity: 0.4 },
  { position: { bottom: '12px', right: '6px' }, size: 12, rotate: -25, opacity: 0.45 },
  { position: { top: '40%', right: '-6px' }, size: 9, rotate: 50, opacity: 0.5 },
  { position: { bottom: '50%', left: '-4px' }, size: 11, rotate: 8, opacity: 0.4 },
];

/** AppHeader — 全ページのヘッダー帯。白文字との対比で淡いトーン */
export const HEADER_FLOWERS: FlowerPlacement[] = [
  { position: { top: '4px', left: '76px' }, size: 9, rotate: 22, opacity: 0.45, color: '#FCE4EC' },
  { position: { bottom: '4px', left: '128px' }, size: 8, rotate: -18, opacity: 0.4, color: '#F8BBD0' },
  { position: { top: '6px', right: '34%' }, size: 10, rotate: 40, opacity: 0.35, color: '#FCE4EC' },
  { position: { bottom: '5px', right: '20%' }, size: 8, rotate: -34, opacity: 0.4, color: '#F8BBD0' },
];
