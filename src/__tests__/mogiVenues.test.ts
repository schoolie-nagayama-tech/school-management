import { describe, it, expect } from 'vitest';
import { parseVenues, restoreMogiEditorVenues } from '@/lib/utils/mogiVenues';
import type { MogiDate } from '@/types/forms/mogi';

describe('parseVenues', () => {
  it('改行区切りのテキストから行番号の連番IDを振る', () => {
    const venues = parseVenues('本会場（八王子）\n本会場（立川）\n塾内受験');
    expect(venues).toEqual([
      { id: 'venue_1', label: '本会場（八王子）' },
      { id: 'venue_2', label: '本会場（立川）' },
      { id: 'venue_3', label: '塾内受験' },
    ]);
  });
});

describe('restoreMogiEditorVenues', () => {
  it('先頭日程が歯抜けIDでも、復元後のラベル集合が保存時と一致する（再現ケース）', () => {
    // 保存時: 共通会場は9会場あり、1件目の日程は一部（1,2,6,7,8,9）だけを選んでいた
    const dates: MogiDate[] = [
      {
        id: '2026-10-04__toritsu_v',
        label: '10月4日（日）',
        exam_type: 'toritsu_v',
        venues: [
          { id: 'venue_1', label: 'A会場' },
          { id: 'venue_2', label: 'B会場' },
          { id: 'venue_6', label: 'F会場' },
          { id: 'venue_7', label: 'G会場' },
          { id: 'venue_8', label: 'H会場' },
          { id: 'venue_9', label: 'I会場' },
        ],
      },
      {
        id: '2026-10-18__toritsu_v',
        label: '10月18日（日）',
        exam_type: 'toritsu_v',
        venues: [
          { id: 'venue_1', label: 'A会場' },
          { id: 'venue_2', label: 'B会場' },
          { id: 'venue_3', label: 'C会場' },
          { id: 'venue_4', label: 'D会場' },
          { id: 'venue_5', label: 'E会場' },
          { id: 'venue_6', label: 'F会場' },
          { id: 'venue_7', label: 'G会場' },
          { id: 'venue_8', label: 'H会場' },
          { id: 'venue_9', label: 'I会場' },
        ],
      },
    ];

    const { venueText, selectedVenueIdsByDate } = restoreMogiEditorVenues(dates);
    const reparsed = parseVenues(venueText);
    const labelById = new Map(reparsed.map((v) => [v.id, v.label]));

    // 1件目（歯抜け）の復元結果のラベル集合が、保存時に選ばれていたラベル集合と一致する
    const restoredLabelsForFirstDate = new Set(
      selectedVenueIdsByDate[0].map((id) => labelById.get(id))
    );
    const savedLabelsForFirstDate = new Set(dates[0].venues.map((v) => v.label));
    expect(restoredLabelsForFirstDate).toEqual(savedLabelsForFirstDate);
  });

  it('venueTextの並びはラベルの初出順で重複がない', () => {
    const dates: MogiDate[] = [
      {
        id: '2026-10-04__toritsu_v',
        label: '10月4日（日）',
        exam_type: 'toritsu_v',
        venues: [
          { id: 'venue_2', label: 'B会場' },
          { id: 'venue_1', label: 'A会場' },
        ],
      },
      {
        id: '2026-10-18__toritsu_v',
        label: '10月18日（日）',
        exam_type: 'toritsu_v',
        venues: [
          { id: 'venue_1', label: 'A会場' },
          { id: 'venue_3', label: 'C会場' },
        ],
      },
    ];

    const { venueText } = restoreMogiEditorVenues(dates);
    // 出てくる順（1件目: B, A / 2件目: A, C）でユニーク化 → B, A, C
    expect(venueText).toBe('B会場\nA会場\nC会場');
  });

  it('上履きフラグ（requires_uwabaki）が正しい新IDに付く', () => {
    const dates: MogiDate[] = [
      {
        id: '2026-10-04__toritsu_v',
        label: '10月4日（日）',
        exam_type: 'toritsu_v',
        venues: [
          { id: 'venue_5', label: 'E会場', requires_uwabaki: true },
          { id: 'venue_1', label: 'A会場' },
        ],
      },
    ];

    const { venueText, venueRequiresUwabaki } = restoreMogiEditorVenues(dates);
    const reparsed = parseVenues(venueText);
    const eVenue = reparsed.find((v) => v.label === 'E会場');
    expect(eVenue).toBeDefined();
    expect(venueRequiresUwabaki[eVenue!.id]).toBe(true);
  });

  it('旧 bring_items に「上履き」を含む場合も上履きフラグとして拾う', () => {
    const dates: MogiDate[] = [
      {
        id: '2026-10-04__toritsu_v',
        label: '10月4日（日）',
        exam_type: 'toritsu_v',
        venues: [{ id: 'venue_1', label: 'A会場', bring_items: '筆記用具・上履き持参' }],
      },
    ];

    const { venueText, venueRequiresUwabaki } = restoreMogiEditorVenues(dates);
    const reparsed = parseVenues(venueText);
    const aVenue = reparsed.find((v) => v.label === 'A会場');
    expect(venueRequiresUwabaki[aVenue!.id]).toBe(true);
  });

  it('日程固有会場（extra_*）も共通会場として選択状態で復元される', () => {
    const dates: MogiDate[] = [
      {
        id: '2026-10-04__toritsu_v',
        label: '10月4日（日）',
        exam_type: 'toritsu_v',
        venues: [
          { id: 'venue_1', label: 'A会場' },
          { id: 'extra_1_1', label: '臨時会場（体育館）' },
        ],
      },
    ];

    const { venueText, selectedVenueIdsByDate } = restoreMogiEditorVenues(dates);
    const reparsed = parseVenues(venueText);
    expect(reparsed.map((v) => v.label)).toContain('臨時会場（体育館）');

    const extraVenue = reparsed.find((v) => v.label === '臨時会場（体育館）');
    expect(extraVenue).toBeDefined();
    expect(selectedVenueIdsByDate[0]).toContain(extraVenue!.id);
  });
});
