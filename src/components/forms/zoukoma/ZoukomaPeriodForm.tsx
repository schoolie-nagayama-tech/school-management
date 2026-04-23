'use client';

import { useState, useEffect } from 'react';
import { Modal, Input, Button, Select } from '@/components/ui';
import { createZoukomaPeriod, updateZoukomaPeriod } from '@/lib/api/zoukoma';
import { getApplicationItems } from '@/lib/api/applications';
import type { ZoukomaPeriod, ZoukomaSettings, ScheduleConfig, PeriodConfig } from '@/types/forms/zoukoma';
import type { ApplicationItem } from '@/types/database';
import { GradePriceEditor } from './GradePriceEditor';
import { SubjectListEditor } from './SubjectListEditor';
import { ScheduleEditor } from './ScheduleEditor';
import { SlotPreview } from './SlotPreview';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';

interface ZoukomaPeriodFormProps {
  isOpen: boolean;
  period: ZoukomaPeriod | null;
  schoolId?: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function ZoukomaPeriodForm({
  isOpen,
  period,
  schoolId,
  onClose,
  onSuccess,
}: ZoukomaPeriodFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [currentStep, setCurrentStep] = useState(1);
  const [applicationItems, setApplicationItems] = useState<ApplicationItem[]>([]);

  // ステップ1: 基本設定
  const [periodKey, setPeriodKey] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [publishStart, setPublishStart] = useState('');
  const [publishEnd, setPublishEnd] = useState('');
  const [completionMessage, setCompletionMessage] = useState('');
  const [linkedApplicationItemId, setLinkedApplicationItemId] = useState<string>('');

  // ステップ2: 学年・料金設定
  const [selectedGrades, setSelectedGrades] = useState<string[]>([]);
  const [priceTable, setPriceTable] = useState<Record<string, number>>({});

  // ステップ3: 科目設定
  const [subjects, setSubjects] = useState<string[]>([]);

  // ステップ4: 日程スロット設定
  const [schedule, setSchedule] = useState<ScheduleConfig | null>(null);

  // 初期値の設定
  useEffect(() => {
    if (isOpen) {
      // 申込項目を取得
      getApplicationItems().then(setApplicationItems).catch(console.error);

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
        setCompletionMessage(settings.completion_message || '');
        setLinkedApplicationItemId(period.linked_application_item_id || '');

        setSelectedGrades(settings.grades || []);
        setPriceTable(settings.price_table || {});
        setSubjects(settings.subjects || []);

        // スケジュール設定（新形式または旧形式から変換）
        if (settings.schedule) {
          setSchedule(settings.schedule);
        } else if (settings.start_date) {
          // 旧形式から新形式に変換
          const periods: PeriodConfig[] = [];
          if (settings.time_slots) {
            Object.entries(settings.time_slots).forEach(([code, timeRange]) => {
              const [start, end] = timeRange.split('–');
              periods.push({
                code,
                start_time: start || '',
                end_time: end || '',
                available_saturday: code === '4' ? false : true,
                available_sunday: false,
                available_weekday: code !== '4',
              });
            });
          }
          setSchedule({
            start_date: settings.start_date,
            min_days_ahead: 2,
            periods: periods.length > 0 ? periods : [],
          });
        }
      } else {
        // 新規作成モード
        const now = new Date();
        const startDate = new Date(now);
        startDate.setMinutes(0, 0, 0); // 時分秒を00:00:00に設定
        
        const endDate = new Date(now);
        endDate.setDate(endDate.getDate() + 30); // 30日後
        endDate.setHours(23, 59, 59, 999); // 時刻を23:59:59に設定
        
        // 日時フォーマット（datetime-local用: YYYY-MM-DDTHH:mm）
        const formatDateTimeLocal = (date: Date): string => {
          const year = date.getFullYear();
          const month = String(date.getMonth() + 1).padStart(2, '0');
          const day = String(date.getDate()).padStart(2, '0');
          const hours = String(date.getHours()).padStart(2, '0');
          const minutes = String(date.getMinutes()).padStart(2, '0');
          return `${year}-${month}-${day}T${hours}:${minutes}`;
        };

        setPeriodKey('');
        setTitle('');
        setDescription('');
        setPublishStart(formatDateTimeLocal(startDate)); // 現在時刻
        setPublishEnd(formatDateTimeLocal(endDate)); // 30日後
        setCompletionMessage('');
        setLinkedApplicationItemId('');

        setSelectedGrades(['中1', '中2', '中3', '高1', '高2', '高3']);
        setPriceTable({
          中1: 3980,
          中2: 3980,
          中3: 4120,
          高1: 4480,
          高2: 4770,
          高3: 5060,
        });
        setSubjects(['英語', '数学', '国語', '理科', '社会']);
        setSchedule(null);
      }
      setCurrentStep(1);
      setError('');
    }
  }, [isOpen, period]);

  // 期間キー自動生成
  const handleAutoGeneratePeriodKey = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    setPeriodKey(`${year}-${month}`);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // バリデーション
    if (!periodKey.trim()) {
      setError('期間キーを入力してください');
      setCurrentStep(1);
      return;
    }
    if (!title.trim()) {
      setError('タイトルを入力してください');
      setCurrentStep(1);
      return;
    }
    if (selectedGrades.length === 0) {
      setError('対象学年を1つ以上選択してください');
      setCurrentStep(2);
      return;
    }
    if (subjects.length === 0) {
      setError('科目を1つ以上追加してください');
      setCurrentStep(3);
      return;
    }
    if (!schedule || !schedule.start_date) {
      setError('開始日を設定してください');
      setCurrentStep(4);
      return;
    }

    setIsSubmitting(true);
    try {
      const settings: ZoukomaSettings = {
        description: description.trim() || undefined,
        grades: selectedGrades,
        price_table: priceTable,
        subjects,
        schedule,
        completion_message: completionMessage.trim() || undefined,
      };

      // 公開期間に基づいてis_activeを自動計算
      const now = new Date();
      const startDate = publishStart ? new Date(publishStart) : null;
      const endDate = publishEnd ? new Date(publishEnd) : null;

      // 公開期間内であればtrue
      const shouldBeActive = !!(
        startDate &&
        endDate &&
        startDate <= now &&
        endDate >= now
      );

      const settingsForApi = settings as unknown as Record<string, unknown>;

      if (period) {
        // 更新（FormPeriodUpdate は period_key を除外）
        await updateZoukomaPeriod(period.id, {
          title: title.trim(),
          publish_start: publishStart ? new Date(publishStart).toISOString() : null,
          publish_end: publishEnd ? new Date(publishEnd).toISOString() : null,
          is_active: shouldBeActive,
          linked_application_item_id: linkedApplicationItemId || null,
          settings: settingsForApi,
        });
      } else {
        // 新規作成
        const finalPublishStart = startDate ? startDate.toISOString() : null;
        const finalPublishEnd = endDate ? endDate.toISOString() : null;

        await createZoukomaPeriod(
          {
            period_key: periodKey.trim(),
            title: title.trim(),
            settings: settingsForApi,
            publish_start: finalPublishStart,
            publish_end: finalPublishEnd,
            is_active: shouldBeActive,
            linked_application_item_id: linkedApplicationItemId || null,
          },
          schoolId
        );
      }
      onSuccess();
      onClose();
    } catch (error) {
      console.error('Error saving period:', error);
      setError(
        getUserErrorMessage(error, '期間の保存に失敗しました')
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const totalSteps = 5;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={period ? '期間の編集' : '期間の新規作成'}
      size="xl"
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="p-3 bg-[#ef4444]/10 border border-[#ef4444] rounded-lg">
            <p className="text-sm text-[#ef4444]">{error}</p>
          </div>
        )}

        {/* ステップインジケーター */}
        <div className="flex items-center justify-between mb-6">
          {[1, 2, 3, 4, 5].map((step) => (
            <div key={step} className="flex items-center flex-1">
              <div
                className={`flex items-center justify-center w-8 h-8 rounded-full border-2 ${
                  step === currentStep
                    ? 'bg-[#3b82f6] border-[#e5e7eb] text-white'
                    : step < currentStep
                    ? 'bg-[#1f2937] border-[#e5e7eb] text-white'
                    : 'bg-white border-[#e5e7eb] text-[#4b5563]'
                }`}
              >
                {step}
              </div>
              {step < totalSteps && (
                <div
                  className={`flex-1 h-0.5 mx-2 ${
                    step < currentStep ? 'bg-[#1f2937]' : 'bg-[#f3f4f6]'
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        {/* ステップ1: 基本設定 */}
        {currentStep === 1 && (
          <div className="space-y-4">
            <div className="flex items-end gap-2">
              <Input
                label="期間キー"
                type="text"
                value={periodKey}
                onChange={(e) => setPeriodKey(e.target.value)}
                placeholder="例: 2024-10"
                required
                disabled={isSubmitting}
                className="flex-1"
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleAutoGeneratePeriodKey}
                disabled={isSubmitting}
              >
                自動生成
              </Button>
            </div>

            <Input
              label="タイトル"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例: 10月度 テスト対策増コマ申し込み"
              required
              disabled={isSubmitting}
            />

            <div>
              <label className="block text-sm font-medium text-[#1f2937] mb-2">
                説明文
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={isSubmitting}
                placeholder="ヒーローセクションに表示する説明文"
                rows={4}
                className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm bg-white text-[#4b5563] focus:outline-none focus:ring-2 focus:ring-[#3b82f6] disabled:bg-[#f3f4f6] disabled:cursor-not-allowed"
              />
            </div>

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

            <div>
              <label className="block text-sm font-medium text-[#1f2937] mb-2">
                完了メッセージ
              </label>
              <textarea
                value={completionMessage}
                onChange={(e) => setCompletionMessage(e.target.value)}
                disabled={isSubmitting}
                placeholder="送信完了後に表示するメッセージ"
                rows={3}
                className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm bg-white text-[#4b5563] focus:outline-none focus:ring-2 focus:ring-[#3b82f6] disabled:bg-[#f3f4f6] disabled:cursor-not-allowed"
              />
            </div>

            <Select
              label="申込状況項目との紐付け"
              value={linkedApplicationItemId}
              onChange={(e) => setLinkedApplicationItemId(e.target.value)}
              options={[
                { value: '', label: '紐付けなし' },
                ...applicationItems.map((item) => ({
                  value: item.id,
                  label: item.name,
                })),
              ]}
              disabled={isSubmitting}
            />
          </div>
        )}

        {/* ステップ2: 対象学年と料金設定 */}
        {currentStep === 2 && (
          <GradePriceEditor
            selectedGrades={selectedGrades}
            priceTable={priceTable}
            onGradesChange={setSelectedGrades}
            onPriceTableChange={setPriceTable}
            disabled={isSubmitting}
          />
        )}

        {/* ステップ3: 科目設定 */}
        {currentStep === 3 && (
          <SubjectListEditor
            subjects={subjects}
            onChange={setSubjects}
            disabled={isSubmitting}
          />
        )}

        {/* ステップ4: 日程スロット設定 */}
        {currentStep === 4 && (
          <div className="space-y-6">
            <ScheduleEditor
              schedule={schedule}
              onChange={setSchedule}
              disabled={isSubmitting}
            />
            {schedule && (
              <div>
                <label className="block text-sm font-medium text-[#1f2937] mb-3">
                  プレビュー
                </label>
                <SlotPreview schedule={schedule} />
              </div>
            )}
          </div>
        )}

        {/* ステップ5: 確認と保存 */}
        {currentStep === 5 && (
          <div className="space-y-4">
            <div className="bg-[#f3f4f6] rounded-lg border border-[#e5e7eb] p-4">
              <h3 className="text-sm font-semibold text-[#1f2937] mb-3">
                基本情報
              </h3>
              <div className="space-y-2 text-sm text-[#4b5563]">
                <p>
                  <span className="font-medium">期間キー:</span> {periodKey}
                </p>
                <p>
                  <span className="font-medium">タイトル:</span> {title}
                </p>
                <p>
                  <span className="font-medium">公開期間:</span>{' '}
                  {publishStart && publishEnd
                    ? `${new Date(publishStart).toLocaleString('ja-JP')} 〜 ${new Date(publishEnd).toLocaleString('ja-JP')}`
                    : '-'}
                </p>
              </div>
            </div>

            <div className="bg-[#f3f4f6] rounded-lg border border-[#e5e7eb] p-4">
              <h3 className="text-sm font-semibold text-[#1f2937] mb-3">
                対象学年・料金
              </h3>
              <div className="space-y-2 text-sm text-[#4b5563]">
                <p>
                  <span className="font-medium">対象学年:</span>{' '}
                  {selectedGrades.join(', ')}
                </p>
                <div>
                  <span className="font-medium">単価:</span>
                  <ul className="ml-4 mt-1">
                    {selectedGrades.map((grade) => (
                      <li key={grade}>
                        {grade}: ¥{priceTable[grade]?.toLocaleString() || 0}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            <div className="bg-[#f3f4f6] rounded-lg border border-[#e5e7eb] p-4">
              <h3 className="text-sm font-semibold text-[#1f2937] mb-3">
                科目
              </h3>
              <p className="text-sm text-[#4b5563]">
                {subjects.join(', ')}
              </p>
            </div>

            {schedule && (
              <div className="bg-[#f3f4f6] rounded-lg border border-[#e5e7eb] p-4">
                <h3 className="text-sm font-semibold text-[#1f2937] mb-3">
                  日程スロット
                </h3>
                <SlotPreview schedule={schedule} />
              </div>
            )}
          </div>
        )}

        {/* ナビゲーションボタン */}
        <div className="flex justify-between pt-4 border-t border-[#e5e7eb]">
          <div>
            {currentStep > 1 && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setCurrentStep(currentStep - 1)}
                disabled={isSubmitting}
              >
                戻る
              </Button>
            )}
          </div>
          <div className="flex gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={isSubmitting}
            >
              キャンセル
            </Button>
            {currentStep < totalSteps ? (
              <Button
                type="button"
                onClick={() => setCurrentStep(currentStep + 1)}
                disabled={isSubmitting}
              >
                次へ
              </Button>
            ) : (
              <Button type="submit" isLoading={isSubmitting}>
                {period ? '更新する' : '作成する'}
              </Button>
            )}
          </div>
        </div>
      </form>
    </Modal>
  );
}
