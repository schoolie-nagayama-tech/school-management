import { describe, expect, it } from 'vitest';
import { normalizeClubName } from '@/lib/highSchools/clubKeys';
import { kanagawaMasterName, matchMasterCourse } from '@/lib/highSchools/importRules';
import { METRICS, isMetricKey } from '@/lib/highSchools/metrics';

describe('normalizeClubName', () => {
  it('部・同好会を外し、男女は別に返す', () => {
    expect(normalizeClubName('男子バスケットボール部')).toEqual({
      clubKey: 'バスケットボール',
      sex: '男子',
    });
    expect(normalizeClubName('女子サッカー同好会')).toEqual({ clubKey: 'サッカー', sex: '女子' });
    expect(normalizeClubName('囲碁将棋同好会')).toEqual({ clubKey: '囲碁将棋', sex: '' });
  });

  it('「男女◯◯」は男女の区別なし', () => {
    expect(normalizeClubName('男女硬式テニス部')).toEqual({ clubKey: '硬式テニス', sex: '' });
  });

  it('末尾の括弧の男女を読む（清瀬の「ソフトテニス（男女）」が別の部になった罠）', () => {
    expect(normalizeClubName('ソフトテニス（男女）')).toEqual({ clubKey: 'ソフトテニス', sex: '' });
    expect(normalizeClubName('バレーボール部（女子）')).toEqual({
      clubKey: 'バレーボール',
      sex: '女子',
    });
    expect(normalizeClubName('サッカー部（男女）')).toEqual({ clubKey: 'サッカー', sex: '' });
    // 男女以外の括弧は部名の一部として残す
    expect(normalizeClubName('漫画ファンクラブ(MFC)').clubKey).toBe('漫画ファンクラブ(MFC)');
  });

  it('別名を統一名に寄せる', () => {
    expect(normalizeClubName('蹴球部').clubKey).toBe('サッカー');
    expect(normalizeClubName('硬式野球').clubKey).toBe('硬式野球');
    expect(normalizeClubName('野球部').clubKey).toBe('硬式野球');
  });

  it('別競技はまとめない（ソフトテニスと硬式テニス、軟式野球と硬式野球）', () => {
    expect(normalizeClubName('ソフトテニス部').clubKey).toBe('ソフトテニス');
    expect(normalizeClubName('軟式野球部').clubKey).toBe('軟式野球');
  });

  it('全角空白・（有志）を揃える', () => {
    expect(normalizeClubName('演劇 有志').clubKey).toBe('演劇有志');
    expect(normalizeClubName('チアダンス（有志）').clubKey).toBe('チアダンス');
  });
});

describe('kanagawaMasterName', () => {
  it('県立は接頭辞を外す', () => {
    expect(kanagawaMasterName('県立希望ケ丘')).toBe('希望ケ丘');
  });

  it('市立は市名を落として「市立◯◯」', () => {
    expect(kanagawaMasterName('横浜市立桜丘')).toBe('市立桜丘');
    expect(kanagawaMasterName('川崎市立橘')).toBe('市立橘');
  });

  it('設置者の列で市立を判定する（生徒数の資料）', () => {
    expect(kanagawaMasterName('桜丘', '横浜市')).toBe('市立桜丘');
    expect(kanagawaMasterName('鶴見', '神奈川県')).toBe('鶴見');
  });
});

describe('matchMasterCourse', () => {
  it('普通科は空文字（マスタに普通科の本体があるときだけ）', () => {
    expect(matchMasterCourse('普通科', ['', '外国語'])).toBe('');
    expect(matchMasterCourse('（普通）', [''])).toBe('');
    expect(matchMasterCourse('普通科', ['一般コース', '音楽コース'])).toBeNull();
  });

  it('コース・科の付け方の違いを吸収する', () => {
    expect(matchMasterCourse('外国語コース', ['', '外国語'])).toBe('外国語');
    expect(matchMasterCourse('都市農業科', ['都市農業'])).toBe('都市農業');
    expect(matchMasterCourse('普通科一般コース', ['一般コース', '音楽コース'])).toBe('一般コース');
  });

  it('大くくりの学科名は無理に当てない', () => {
    expect(matchMasterCourse('（工業）', ['機械', '電気', '建設'])).toBeNull();
  });
});

describe('METRICS', () => {
  it('キーの検査', () => {
    expect(isMetricKey('students')).toBe(true);
    expect(isMetricKey('Students')).toBe(false);
    expect(isMetricKey('toString')).toBe(false);
  });

  it('倍率は入学年度、進学実績は卒業年度で持つ', () => {
    expect(METRICS.exam_ratio.year).toBe('入学年度');
    expect(METRICS.university_count.year).toBe('卒業年度');
  });
});
