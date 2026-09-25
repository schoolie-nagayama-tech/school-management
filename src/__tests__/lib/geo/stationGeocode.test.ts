/**
 * 駅名の整形と、国土地理院の応答から駅を選ぶ処理のテスト。
 *
 * ★なぜ要るか: 地名検索は「清瀬駅」で引いても駅前の郵便局や交番を一緒に返す。
 *   部分一致で先頭を取ると、教室の起点が郵便局になっても誰も気づかない。
 */
import { describe, it, expect } from 'vitest';
import { normalizeStationName, pickStationFromGsi } from '@/lib/geo/stationGeocode';

describe('normalizeStationName', () => {
  it('末尾の「駅」と前後の空白を外す', () => {
    expect(normalizeStationName(' 清瀬駅 ')).toBe('清瀬');
    expect(normalizeStationName('京王永山')).toBe('京王永山');
  });

  it('全角英数は半角に揃える', () => {
    expect(normalizeStationName('ＪＲ')).toBe('JR');
  });

  it('ヶ・々・ー・中黒は通す', () => {
    expect(normalizeStationName('市ケ谷')).toBe('市ケ谷');
    expect(normalizeStationName('代々木上原')).toBe('代々木上原');
    expect(normalizeStationName('センター南')).toBe('センター南');
  });

  it('空・長すぎ・記号・URLは null', () => {
    expect(normalizeStationName('')).toBeNull();
    expect(normalizeStationName('駅')).toBeNull();
    expect(normalizeStationName('あ'.repeat(31))).toBeNull();
    expect(normalizeStationName('清瀬&q=x')).toBeNull();
    expect(normalizeStationName('https://example.com')).toBeNull();
    expect(normalizeStationName(null)).toBeNull();
    expect(normalizeStationName(123)).toBeNull();
  });
});

describe('pickStationFromGsi', () => {
  // 2026-09-24 に「清瀬駅」で実際に返ってきた応答（抜粋）
  const kiyose = [
    {
      geometry: { coordinates: [139.526855, 35.785275], type: 'Point' },
      properties: { addressCode: '', title: '東京都清瀬市' },
    },
    {
      geometry: { coordinates: [139.51981158, 35.77235529], type: 'Point' },
      properties: { addressCode: '13221', title: '東村山警察署清瀬駅前交番', dataSource: '3' },
    },
    {
      geometry: { coordinates: [139.52037352, 35.77139526], type: 'Point' },
      properties: { addressCode: '13221', title: '清瀬駅前郵便局', dataSource: '3' },
    },
    {
      geometry: { coordinates: [139.519817333333, 35.7720106666667], type: 'Point' },
      properties: { addressCode: '13221', title: '清瀬駅', dataSource: '1' },
    },
  ];

  it('駅名と完全一致する地物だけを採り、[経度,緯度]を入れ替えて返す', () => {
    expect(pickStationFromGsi(kiyose, '清瀬')).toEqual({ lat: 35.772011, lon: 139.519817 });
  });

  it('駅前の郵便局・交番しか無ければ null（それらしい場所を黙って採らない）', () => {
    expect(pickStationFromGsi(kiyose.slice(0, 3), '清瀬')).toBeNull();
  });

  it('配列でない・座標が壊れている・日本の外は null', () => {
    expect(pickStationFromGsi(null, '清瀬')).toBeNull();
    expect(pickStationFromGsi({ error: 'x' }, '清瀬')).toBeNull();
    expect(
      pickStationFromGsi(
        [{ geometry: { coordinates: ['a', 'b'] }, properties: { title: '清瀬駅' } }],
        '清瀬'
      )
    ).toBeNull();
    expect(
      pickStationFromGsi(
        [{ geometry: { coordinates: [0, 0] }, properties: { title: '清瀬駅' } }],
        '清瀬'
      )
    ).toBeNull();
  });
});
