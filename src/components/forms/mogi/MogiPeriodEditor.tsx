'use client';

import { useState, useEffect } from 'react';
import { Modal, Input, Button, Select } from '@/components/ui';
import { createMogiPeriod, updateMogiPeriod } from '@/lib/api/mogi';
import { createFormPeriodForSchools, updateFormPeriodForSchools } from '@/lib/api/form-periods';
import { getApplicationItems } from '@/lib/api/applications';
import type { MogiPeriod, MogiSettings, Venue } from '@/types/forms/mogi';
import type { ApplicationItem } from '@/types/database';

interface MogiPeriodEditorProps {
  isOpen: boolean;
  period: MogiPeriod | null;
  schoolId?: string;
  /** 複数教室に一括作成・更新する場合 */
  schoolIds?: string[];
  /** 編集時に更新対象を選ぶための教室一覧（id, name） */
  allowedSchools?: { id: string; name: string }[];
  onClose: () => void;
  onSuccess: () => void;
}

export function MogiPeriodEditor({
  isOpen,
  period,
  schoolId,
  schoolIds,
  allowedSchools,
  onClose,
  onSuccess,
}: MogiPeriodEditorProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [applyToAllSchools, setApplyToAllSchools] = useState(true);
  const [selectedSchoolIdsForUpdate, setSelectedSchoolIdsForUpdate] = useState<string[]>([]);

  // 共通会場テキストと日程エントリ
  interface DateEntry {
    date: string; // YYYY-MM-DD
    selectedVenueIds: string[];
    extraVenueText: string; // 日程固有の会場（改行区切り）
  }

  // フォームデータ
  const [periodKey, setPeriodKey] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [publishStart, setPublishStart] = useState('');
  const [publishEnd, setPublishEnd] = useState('');
  const [venueText, setVenueText] = useState('');
  const [dateEntries, setDateEntries] = useState<DateEntry[]>([]);
  const [completionMessage, setCompletionMessage] = useState('');
  const [linkedApplicationItemId, setLinkedApplicationItemId] = useState<string>('');
  const [applicationItems, setApplicationItems] = useState<ApplicationItem[]>([]);
  const [useDefaultInsert, setUseDefaultInsert] = useState(false);

  // Vもぎは中3のみ
  const MOGI_GRADES = ['中3'] as const;

  const MOGI_DEFAULTS_KEY = (id: string) => `mogi_defaults_${id}`;
  const MOGI_USE_DEFAULTS_KEY = (id: string) => `mogi_use_defaults_${id}`;

  // 期間キーの自動生成（YYYY-MM形式）
  const generatePeriodKey = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  };

  // 会場テキストを配列に変換（IDは連番で自動生成）
  const parseVenues = (text: string): Venue[] => {
    return text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((label, index) => ({
        id: `venue_${index + 1}`,
        label,
      }));
  };

  // YYYY-MM-DD から「M月D日（曜）」ラベルを生成
  const formatDateLabel = (dateStr: string): string => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const dayOfWeek = ['日', '月', '火', '水', '木', '金', '土'][date.getDay()];
    return `${month}月${day}日（${dayOfWeek}）`;
  };

  // 日程固有の会場をパース（IDは extra_日程番号_連番）
  const parseExtraVenues = (text: string, dateIndex: number): Venue[] => {
    return text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((label, idx) => ({
        id: `extra_${dateIndex + 1}_${idx + 1}`,
        label,
      }));
  };

  // 共通＋日程固有の会場リストを取得（保存時に使用）
  const getVenuesForDate = (entry: DateEntry, dateIndex: number): Venue[] => {
    const common = parseVenues(venueText);
    const extra = parseExtraVenues(entry.extraVenueText, dateIndex);
    return [...common, ...extra];
  };

  // venueText / extraVenueText 変更時に選択済みIDをクリーンアップ
  const sanitizeSelections = (entries: DateEntry[]): DateEntry[] => {
    return entries.map((entry, idx) => {
      const available = new Set(getVenuesForDate(entry, idx).map((v) => v.id));
      return {
        ...entry,
        selectedVenueIds: entry.selectedVenueIds.filter((id) => available.has(id)),
      };
    });
  };

  // 初期値の設定
  useEffect(() => {
    if (isOpen) {
      // 申込項目を取得
      getApplicationItems().then(setApplicationItems).catch(console.error);
      // デフォルト自動挿入の設定を読み込み
      if (typeof window !== 'undefined' && schoolId) {
        setUseDefaultInsert(window.localStorage.getItem(MOGI_USE_DEFAULTS_KEY(schoolId)) === 'true');
      }

      if (period) {
        // 編集モード
        const settings = period.settings;
        setPeriodKey(period.period_key);
        setTitle(period.title);
        setDescription(settings.description || '');
        setPublishStart(
          period.publish_start
            ? new Date(period.publish_start).toISOString().slice(0, 16)
            : ''
        );
        setPublishEnd(
          period.publish_end
            ? new Date(period.publish_end).toISOString().slice(0, 16)
            : ''
        );
        // 会場テキスト復元（全日程の会場を集約してユニーク化）
        const venueMap = new Map<string, string>();
        settings.dates?.forEach((d) => {
          d.venues.forEach((v) => {
            venueMap.set(v.id, v.label);
          });
        });
        setVenueText(Array.from(venueMap.values()).join('\n'));
        // 日程エントリ復元（固有会場は空で開始し、選択状態のみ保持）
        setDateEntries(
          settings.dates?.map((d) => ({
            date: d.id,
            selectedVenueIds: d.venues.map((v) => v.id),
            extraVenueText: '',
          })) || []
        );
        setCompletionMessage(settings.completion_message || '');
        setLinkedApplicationItemId(period.linked_application_item_id || '');
      } else {
        // 新規作成モード - 期間キーを自動生成
        const autoGeneratedKey = generatePeriodKey();
        setPeriodKey(autoGeneratedKey);
        setTitle('');
        setDescription('');
        // 公開開始日を現在時刻、終了日を30日後に設定
        const now = new Date();
        const endDate = new Date(now);
        endDate.setDate(endDate.getDate() + 30);
        setPublishStart(now.toISOString().slice(0, 16));
        setPublishEnd(endDate.toISOString().slice(0, 16));
        setVenueText('');
        setDateEntries([]);
        setCompletionMessage('');
        setLinkedApplicationItemId('');
        // デフォルト自動挿入がONなら保存済みデフォルトを挿入
        if (typeof window !== 'undefined' && schoolId) {
          const useDefaults = window.localStorage.getItem(MOGI_USE_DEFAULTS_KEY(schoolId)) === 'true';
          if (useDefaults) {
            try {
              const saved = window.localStorage.getItem(MOGI_DEFAULTS_KEY(schoolId));
              if (saved) {
                const def = JSON.parse(saved) as { description?: string; venueText?: string; completionMessage?: string };
                if (def.description != null) setDescription(def.description);
                if (def.venueText != null) setVenueText(def.venueText);
                if (def.completionMessage != null) setCompletionMessage(def.completionMessage);
              }
            } catch {
              // ignore
            }
          }
        }
      }
      setError('');
    }
    if (isOpen && period && allowedSchools && allowedSchools.length > 0) {
      setSelectedSchoolIdsForUpdate(allowedSchools.map((s) => s.id));
    }
  }, [isOpen, period, schoolId, allowedSchools]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // バリデーション
    if (!periodKey.trim()) {
      setError('期間キーを入力してください');
      return;
    }
    if (!title.trim()) {
      setError('タイトルを入力してください');
      return;
    }

    // バリデーション: 会場が1つ以上必要
    const commonVenues = parseVenues(venueText);
    if (commonVenues.length === 0) {
      setError('会場を1つ以上入力してください');
      return;
    }

    // バリデーション: 最低1つの日程が必要
    if (dateEntries.length === 0) {
      setError('最低1つの日程を設定してください');
      return;
    }

    // 各日程に日付と最低1つの会場が必要
    for (const [idx, entry] of Array.from(dateEntries.entries())) {
      if (!entry.date) {
        setError(`日程${idx + 1}の日付を入力してください`);
        return;
      }
      if (entry.selectedVenueIds.length === 0) {
        setError(`日程${idx + 1}の会場を1つ以上選択してください`);
        return;
      }
    }

    setIsSubmitting(true);
    try {
    // venueText / extraVenueText 変更に伴う選択クリーンアップ
    const cleanedEntries = sanitizeSelections(dateEntries);
    setDateEntries(cleanedEntries);

    const settings: MogiSettings = {
        description: description.trim() || undefined,
        grades: [...MOGI_GRADES],
        dates: cleanedEntries.map((entry, idx) => {
          const venuesForDate = getVenuesForDate(entry, idx);
          return {
            id: entry.date,
            label: formatDateLabel(entry.date),
            venues: venuesForDate.filter((v) => entry.selectedVenueIds.includes(v.id)),
          };
        }),
        completion_message: completionMessage.trim() || undefined,
      };

      // 公開期間に基づいてis_activeを自動計算
      const now = new Date();
      const startDate = publishStart ? new Date(publishStart) : null;
      const endDate = publishEnd ? new Date(publishEnd) : null;

      // 公開開始日が現在時刻以降または未設定の場合、公開期間内であればtrue
      const shouldBeActive = !!(
        startDate &&
        endDate &&
        startDate <= now &&
        endDate >= now
      );

      const settingsForApi = settings as unknown as Record<string, unknown>;

      const updates = {
        title: title.trim(),
        publish_start: publishStart ? new Date(publishStart).toISOString() : null,
        publish_end: publishEnd ? new Date(publishEnd).toISOString() : null,
        is_active: shouldBeActive,
        settings: settingsForApi,
        linked_application_item_id: linkedApplicationItemId || null,
      };

      if (period) {
        if (schoolIds && schoolIds.length > 1 && applyToAllSchools) {
          await updateFormPeriodForSchools(
            schoolIds,
            'mogi',
            period.period_key,
            updates
          );
        } else {
          await updateMogiPeriod(period.id, updates);
        }
      } else {
        const createData = {
          period_key: periodKey.trim(),
          title: title.trim(),
          settings: settingsForApi,
          publish_start: publishStart ? new Date(publishStart).toISOString() : null,
          publish_end: publishEnd ? new Date(publishEnd).toISOString() : null,
          is_active: shouldBeActive,
          linked_application_item_id: linkedApplicationItemId || null,
        };
        if (schoolIds && schoolIds.length > 1) {
          await createFormPeriodForSchools(schoolIds, {
            ...createData,
            form_type: 'mogi',
          });
        } else {
          await createMogiPeriod(createData, schoolId);
        }
      }
      onSuccess();
      onClose();
    } catch (error) {
      console.error('Error saving period:', error);
      setError(
        error instanceof Error ? error.message : '期間の保存に失敗しました'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // 日程を追加
  const handleAddDate = () => {
    setDateEntries([
      ...dateEntries,
      {
        date: '',
        selectedVenueIds: [],
        extraVenueText: '',
      },
    ]);
  };

  // 日程を削除
  const handleRemoveDate = (index: number) => {
    setDateEntries(dateEntries.filter((_, i) => i !== index));
  };

  // 日付を更新
  const handleUpdateDate = (index: number, value: string) => {
    const updated = [...dateEntries];
    updated[index] = { ...updated[index], date: value };
    setDateEntries(updated);
  };

  // 会場選択のトグル
  const handleToggleVenue = (index: number, venueId: string, checked: boolean) => {
    const updated = [...dateEntries];
    const current = updated[index].selectedVenueIds;
    updated[index].selectedVenueIds = checked
      ? [...current, venueId]
      : current.filter((id) => id !== venueId);
    setDateEntries(updated);
  };

  // 現在の説明文・会場・完了メッセージをデフォルトに保存
  const handleSaveDefaults = () => {
    if (!schoolId || typeof window === 'undefined') return;
    window.localStorage.setItem(
      MOGI_DEFAULTS_KEY(schoolId),
      JSON.stringify({
        description,
        venueText,
        completionMessage,
      })
    );
    window.localStorage.setItem(MOGI_USE_DEFAULTS_KEY(schoolId), 'true');
    setUseDefaultInsert(true);
  };

  const handleUseDefaultsChange = (checked: boolean) => {
    if (!schoolId || typeof window === 'undefined') return;
    setUseDefaultInsert(checked);
    window.localStorage.setItem(MOGI_USE_DEFAULTS_KEY(schoolId), checked ? 'true' : 'false');
  };

  // 日程固有会場テキスト更新
  const handleUpdateExtraVenueText = (index: number, value: string) => {
    const updated = [...dateEntries];
    updated[index] = { ...updated[index], extraVenueText: value };
    // 選択状態のクリーンアップも行う
    const sanitized = sanitizeSelections(updated);
    setDateEntries(sanitized);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={period ? '期間の編集' : '期間の新規作成'}
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-[#ef4444]/10 border border-[#ef4444] rounded-lg">
            <p className="text-sm text-[#ef4444]">{error}</p>
          </div>
        )}

        <Input
          label="期間キー"
          type="text"
          value={periodKey}
          onChange={(e) => setPeriodKey(e.target.value)}
          placeholder="例: 2024-10"
          required
          disabled={isSubmitting || !!period} // 編集時は読み取り専用
          className={period ? 'bg-[#f3f4f6] cursor-not-allowed' : ''}
        />
        {period && (
          <p className="text-xs text-[#4b5563]/60 mt-1">
            ※ 期間キーは変更できません
          </p>
        )}
        {!period && (
          <p className="text-xs text-[#4b5563]/60 mt-1">
            ※ 期間キーは自動生成されます（YYYY-MM形式）。必要に応じて変更できます。
          </p>
        )}

        <Input
          label="タイトル"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例: Vもぎ申込（10月・11月）"
          required
          disabled={isSubmitting}
        />

        <Input
          label="公開開始日時"
          type="datetime-local"
          value={publishStart}
          onChange={(e) => setPublishStart(e.target.value)}
          disabled={isSubmitting}
        />

        <Input
          label="公開終了日時"
          type="datetime-local"
          value={publishEnd}
          onChange={(e) => setPublishEnd(e.target.value)}
          disabled={isSubmitting}
        />
        <p className="text-xs text-[#4b5563]/60 mt-1">
          ※空欄にすると永続的に公開されます
        </p>

        <div className="p-3 bg-[#f3f4f6] rounded-lg border border-[#e5e7eb]">
          <p className="text-sm text-[#4b5563]">
            ※ 公開状態は公開開始日時と公開終了日時に基づいて自動的に設定されます。
            {publishStart && (() => {
              const now = new Date();
              const startDate = new Date(publishStart);
              const endDate = publishEnd ? new Date(publishEnd) : null;
              const isActive = startDate <= now && (!endDate || endDate >= now);
              return (
                <span className="block mt-1 font-medium">
                  現在の状態: {isActive ? (endDate ? '公開中' : '公開中（永続公開）') : startDate > now ? '公開前' : '公開終了'}
                </span>
              );
            })()}
          </p>
        </div>

        {/* デフォルト設定 */}
        <div className="p-4 bg-[#f0f9ff] rounded-lg border border-[#bae6fd]">
          <p className="text-sm font-medium text-[#1f2937] mb-3">デフォルト設定</p>
          <p className="text-xs text-[#4b5563] mb-3">
            説明文・会場・完了メッセージをデフォルトに保存し、新規作成時に自動で挿入できます。
          </p>
          <label className="flex items-center gap-2 mb-3 cursor-pointer">
            <input
              type="checkbox"
              checked={useDefaultInsert}
              onChange={(e) => handleUseDefaultsChange(e.target.checked)}
              disabled={isSubmitting}
              className="w-4 h-4 text-[#3b82f6] border-[#e5e7eb] rounded focus:ring-[#3b82f6]"
            />
            <span className="text-sm text-[#1f2937]">新規作成時にデフォルトを自動挿入する</span>
          </label>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleSaveDefaults}
            disabled={isSubmitting}
          >
            現在の説明文・会場・完了メッセージをデフォルトに保存
          </Button>
        </div>

        {/* 説明文 */}
        <div>
          <label className="block text-sm font-medium text-[#1f2937] mb-2">
            説明文
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={isSubmitting}
            rows={4}
            className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm bg-white text-[#4b5563] focus:outline-none focus:ring-2 focus:ring-[#3b82f6] disabled:bg-[#f3f4f6] disabled:cursor-not-allowed"
            placeholder="Vもぎのお申し込みです。&#10;受験料：4,400円（税込）&#10;※申込後のキャンセルはできません。"
          />
        </div>

        {/* 日程・会場設定 */}
        <div>
          <label className="block text-sm font-medium text-[#1f2937] mb-2">
            共通会場（全日程で使用） <span className="text-[#ef4444]">*</span>
          </label>
          <textarea
            value={venueText}
            onChange={(e) => setVenueText(e.target.value)}
            disabled={isSubmitting}
            rows={4}
            className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm bg-white text-[#4b5563] focus:outline-none focus:ring-2 focus:ring-[#3b82f6] disabled:bg-[#f3f4f6] disabled:cursor-not-allowed"
            placeholder="本会場（八王子）&#10;本会場（立川）&#10;塾内受験"
          />
          <p className="text-xs text-[#4b5563]/60 mt-1">
            ※改行で区切って入力。日程ごとに会場を選択できます。
          </p>

          <div className="flex items-center justify-between my-4">
            <span className="block text-sm font-medium text-[#1f2937]">
              日程・会場設定 <span className="text-[#ef4444]">*</span>
            </span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleAddDate}
              disabled={isSubmitting}
            >
              + 日程を追加
            </Button>
          </div>

          <div className="space-y-4">
            {dateEntries.map((entry, index) => {
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              const _venues = getVenuesForDate(entry, index);
              return (
                <div
                  key={index}
                  className="border border-[#e5e7eb] rounded-lg p-4 bg-[#f3f4f6]"
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-medium text-[#1f2937]">
                      日程{index + 1}
                    </span>
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      onClick={() => handleRemoveDate(index)}
                      disabled={isSubmitting}
                    >
                      削除
                    </Button>
                  </div>

                  <div className="space-y-3">
                    <Input
                      label="日付（YYYY-MM-DD）"
                      type="date"
                      value={entry.date}
                      onChange={(e) => handleUpdateDate(index, e.target.value)}
                      disabled={isSubmitting}
                      required
                    />

                    <div>
                      <label className="block text-sm font-medium text-[#1f2937] mb-2">
                        使用する会場 <span className="text-[#ef4444]">*</span>
                      </label>
                      {(() => {
                        const commonVenues = parseVenues(venueText);
                        if (commonVenues.length === 0) {
                          return (
                            <p className="text-sm text-[#4b5563]/60 p-3 bg-[#f3f4f6] rounded-lg border border-[#e5e7eb]">
                              上の「共通会場」に会場を入力してください
                            </p>
                          );
                        }
                        return (
                          <div className="space-y-2 bg-white border border-[#e5e7eb] rounded-lg p-3">
                            <p className="text-xs text-[#4b5563]/60 mb-2">
                              共通会場から選択してください
                            </p>
                            {commonVenues.map((venue) => (
                              <label
                                key={venue.id}
                                className="flex items-center gap-2 p-2 hover:bg-[#f3f4f6] rounded cursor-pointer transition-colors"
                              >
                                <input
                                  type="checkbox"
                                  checked={entry.selectedVenueIds.includes(venue.id)}
                                  onChange={(e) =>
                                    handleToggleVenue(index, venue.id, e.target.checked)
                                  }
                                  disabled={isSubmitting}
                                  className="w-4 h-4 text-[#3b82f6] border-[#e5e7eb] rounded focus:ring-[#3b82f6] cursor-pointer"
                                />
                                <span className="text-sm text-[#4b5563] flex-1">
                                  {venue.label}
                                </span>
                                {entry.selectedVenueIds.includes(venue.id) && (
                                  <span className="text-xs text-[#3b82f6] font-medium">✓</span>
                                )}
                              </label>
                            ))}
                            {entry.selectedVenueIds.length === 0 && (
                              <p className="text-xs text-[#ef4444] mt-2 p-2 bg-[#ef4444]/10 rounded">
                                ※ 最低1つの会場を選択してください
                              </p>
                            )}
                          </div>
                        );
                      })()}
                    </div>

                    {/* 日程固有の会場入力（オプション） */}
                    <div>
                      <label className="block text-sm font-medium text-[#1f2937] mb-2">
                        この日程でのみ使う会場（任意）
                      </label>
                      <textarea
                        value={entry.extraVenueText}
                        onChange={(e) =>
                          handleUpdateExtraVenueText(index, e.target.value)
                        }
                        disabled={isSubmitting}
                        rows={2}
                        className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm bg-white text-[#4b5563] focus:outline-none focus:ring-2 focus:ring-[#3b82f6] disabled:bg-[#f3f4f6] disabled:cursor-not-allowed"
                        placeholder="この日程のみ使用する会場があれば入力（改行区切り）"
                      />
                      {entry.extraVenueText && (
                        <div className="mt-2 space-y-1 bg-[#f3f4f6] border border-[#e5e7eb] rounded-lg p-2">
                          <p className="text-xs text-[#4b5563]/60 mb-2">追加会場から選択</p>
                          {parseExtraVenues(entry.extraVenueText, index).map((venue) => (
                            <label
                              key={venue.id}
                              className="flex items-center gap-2 p-2 hover:bg-white rounded cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={entry.selectedVenueIds.includes(venue.id)}
                                onChange={(e) =>
                                  handleToggleVenue(index, venue.id, e.target.checked)
                                }
                                disabled={isSubmitting}
                                className="w-4 h-4 text-[#3b82f6] border-[#e5e7eb] rounded focus:ring-[#3b82f6] cursor-pointer"
                              />
                              <span className="text-sm text-[#4b5563]">{venue.label}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 完了メッセージ */}
        <div>
          <label className="block text-sm font-medium text-[#1f2937] mb-2">
            完了メッセージ
          </label>
          <textarea
            value={completionMessage}
            onChange={(e) => setCompletionMessage(e.target.value)}
            disabled={isSubmitting}
            rows={3}
            className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm bg-white text-[#4b5563] focus:outline-none focus:ring-2 focus:ring-[#3b82f6] disabled:bg-[#f3f4f6] disabled:cursor-not-allowed"
            placeholder="お申し込みありがとうございます。&#10;受験票は試験日の1週間前までにお届けします。"
          />
        </div>

        {/* 申込状況項目との紐付け */}
        <Select
          label="申込状況項目との紐付け"
          value={linkedApplicationItemId}
          onChange={(e) => setLinkedApplicationItemId(e.target.value)}
          options={[
            { value: '', label: '選択してください' },
            ...applicationItems.map((item) => ({
              value: item.id,
              label: item.name,
            })),
          ]}
          disabled={isSubmitting}
        />

        {period && allowedSchools && allowedSchools.length > 1 && (
          <div className="p-3 bg-[#eff6ff] rounded-lg border border-[#bfdbfe]">
            <p className="text-sm font-medium text-[#1f2937] mb-2">
              同じ内容で更新する教室を選択
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {allowedSchools.map((school) => (
                <label
                  key={school.id}
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedSchoolIdsForUpdate.includes(school.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedSchoolIdsForUpdate((prev) =>
                          prev.includes(school.id) ? prev : [...prev, school.id]
                        );
                      } else {
                        setSelectedSchoolIdsForUpdate((prev) =>
                          prev.filter((id) => id !== school.id)
                        );
                      }
                    }}
                    disabled={isSubmitting}
                    className="w-4 h-4 text-[#3b82f6] border-[#e5e7eb] rounded focus:ring-[#3b82f6]"
                  />
                  <span className="text-sm text-[#1f2937]">{school.name}</span>
                </label>
              ))}
            </div>
          </div>
        )}
        {period && schoolIds && schoolIds.length > 1 && !allowedSchools?.length && (
          <label className="flex items-center gap-2 p-3 bg-[#eff6ff] rounded-lg border border-[#bfdbfe] cursor-pointer">
            <input
              type="checkbox"
              checked={applyToAllSchools}
              onChange={(e) => setApplyToAllSchools(e.target.checked)}
              disabled={isSubmitting}
              className="w-4 h-4 text-[#3b82f6] border-[#e5e7eb] rounded focus:ring-[#3b82f6]"
            />
            <span className="text-sm text-[#1f2937]">
              選択中の他教室の同じ期間も同じ内容で更新する
            </span>
          </label>
        )}

        <div className="flex justify-end gap-3 pt-4 border-t border-[#e5e7eb]">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            キャンセル
          </Button>
          <Button type="submit" isLoading={isSubmitting}>
            {period ? '更新する' : '作成する'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
