'use client';

/**
 * タブ3「AIアシスト設定」（講師管理視点）。
 *
 * 見せたいこと:
 *   - ポップアップを出すかどうかは講師ごとに切り替えられる（全員に出すものではない）。
 *   - 自動ONの条件は「直近30日の未対応率」ひとつだけ。細かい調整項目を増やさない。
 */

import { useCallback, useMemo, useState } from 'react';
import { Checkbox, Switch } from '@/components/ui';
import { BellOff, BellRing } from 'lucide-react';
import { ASSIST_TEACHERS } from '../data';
import { Note, Panel } from './parts';

/** 自動ONの判定に使う未対応率のしきい値（％） */
const AUTO_ON_THRESHOLD = 50;

export function SettingsTab() {
  // 手動のON/OFF。自動ONのチェックが入っているときは、しきい値超えを上書きでONにする
  const [manualOn, setManualOn] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    ASSIST_TEACHERS.forEach((t) => {
      init[t.id] = t.defaultOn;
    });
    return init;
  });
  const [autoOn, setAutoOn] = useState(false);

  /**
   * 実際に有効かどうか。
   * 自動ONがONなら「未対応率がしきい値超え」の講師は手動OFFでも有効になる（＝自動の方が強い）。
   */
  const effectiveOn = useMemo(() => {
    const result: Record<string, boolean> = {};
    ASSIST_TEACHERS.forEach((t) => {
      const forced = autoOn && t.ignoredRate > AUTO_ON_THRESHOLD;
      result[t.id] = forced || (manualOn[t.id] ?? false);
    });
    return result;
  }, [autoOn, manualOn]);

  const toggleManual = useCallback((id: string, next: boolean) => {
    setManualOn((prev) => ({ ...prev, [id]: next }));
  }, []);

  const onCount = ASSIST_TEACHERS.filter((t) => effectiveOn[t.id]).length;

  return (
    <div className="space-y-4">
      <Panel title="オプション">
        <label className="flex cursor-pointer items-start gap-2">
          <Checkbox
            checked={autoOn}
            onCheckedChange={setAutoOn}
            className="mt-0.5"
            aria-label="未対応率が高い講師に自動でONにする"
          />
          <span className="text-[12.5px] font-semibold text-text-body">
            直近30日の未対応率が{AUTO_ON_THRESHOLD}%を超えた講師に自動でONにする
          </span>
        </label>
        <Note>
          チェックを入れると、しきい値を超えた講師は手動でOFFにしていても自動でONに戻ります（自動の方を優先します）。
        </Note>
      </Panel>

      <Panel
        title="講師ごとのAIアシスト"
        tone="accent"
        right={
          <span className="text-[10.5px]">
            ON {onCount}名 / 全{ASSIST_TEACHERS.length}名
          </span>
        }
      >
        <div className="space-y-1.5">
          {ASSIST_TEACHERS.map((t) => {
            const forced = autoOn && t.ignoredRate > AUTO_ON_THRESHOLD;
            const on = effectiveOn[t.id] ?? false;
            return (
              <div
                key={t.id}
                className="flex items-center gap-2 rounded-md border border-border bg-white px-3 py-2"
              >
                {on ? (
                  <BellRing className="h-4 w-4 shrink-0 text-info" />
                ) : (
                  <BellOff className="h-4 w-4 shrink-0 text-text-faint" />
                )}
                <span className="text-[13px] font-semibold text-text-heading">{t.name}</span>
                <span
                  className={`text-[11px] tabular-nums ${
                    t.ignoredRate > AUTO_ON_THRESHOLD ? 'font-bold text-warning' : 'text-text-faint'
                  }`}
                >
                  未対応率 {t.ignoredRate}%
                </span>
                {forced && (
                  <span className="rounded-full bg-warning-subtle px-2 py-0.5 text-[10px] font-bold text-warning">
                    自動でON
                  </span>
                )}
                <span className="ml-auto flex shrink-0 items-center gap-2">
                  <span className={`text-[11px] font-bold ${on ? 'text-info' : 'text-text-faint'}`}>
                    {on ? 'ON' : 'OFF'}
                  </span>
                  <Switch
                    checked={on}
                    onCheckedChange={(next) => toggleManual(t.id, next)}
                    disabled={forced}
                    aria-label={`${t.name}のAIアシスト`}
                  />
                </span>
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel title="この設定の意味">
        <ul className="list-disc space-y-1 pl-5 text-[12.5px] leading-relaxed text-text-body">
          <li>ONの講師には、授業中に未対応タスクが1件ずつポップアップで出ます。</li>
          <li>OFFの講師には何も出ません。ただし進捗ボードには同じように載ります。</li>
          <li>ポップアップは1回の授業につき最大1件。出したら、その授業ではもう出しません。</li>
        </ul>
      </Panel>
    </div>
  );
}
