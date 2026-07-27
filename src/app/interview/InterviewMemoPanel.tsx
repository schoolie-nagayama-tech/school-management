'use client';

/**
 * 面談ワークスペース 中央カラム: 今回の面談メモ
 * ------------------------------------------------------------------
 * 日付・種別・タイトル・本文の入力、話題チップによる見出し挿入、約束・宿題クイック登録、
 * 保存（面談記録＋タスクの一括作成）を担う。
 *
 * 下書きは生徒ID込みのキーで localStorage に自動保存する。面談中に誤って画面遷移しても
 * 入力内容が消えないようにするための保険（保存成功時に下書きは削除する）。
 */

import { useEffect, useRef, useState } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Input,
  Select,
  Textarea,
} from '@/components/ui';
import { createInterview } from '@/lib/api/interviews';
import { useToast } from '@/hooks/useToast';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';
import { INTERVIEW_TYPE_LABELS, type InterviewType } from '@/types/database';
import {
  MEMO_INTERVIEW_TYPES,
  TOPIC_CHIPS,
  clearInterviewDraft,
  loadInterviewDraft,
  saveInterviewDraft,
} from './interview.shared';
import { CheckCircle2, Circle, ClipboardList, Plus, X } from 'lucide-react';

/** 印刷シートに渡す「今回のメモ」現在値のスナップショット */
export interface MemoSnapshot {
  interviewDate: string;
  interviewTypeLabel: string;
  title: string;
  memo: string;
}

interface InterviewMemoPanelProps {
  studentId: string;
  schoolId: string;
  /** 保存成功後に呼ぶ。親側で面談タイムライン・タスク一覧を再取得する。 */
  onSaved: () => void;
  /** 入力内容が変わるたびに現在値を親へ通知（印刷シート用のスナップショット保持のため） */
  onDraftChange: (snapshot: MemoSnapshot) => void;
}

const todayStr = () => new Date().toISOString().slice(0, 10);

export function InterviewMemoPanel({
  studentId,
  schoolId,
  onSaved,
  onDraftChange,
}: InterviewMemoPanelProps) {
  const { success, error: toastError, warning } = useToast();

  const [interviewDate, setInterviewDate] = useState(todayStr);
  const [interviewType, setInterviewType] = useState<InterviewType>('parent_interview');
  const [title, setTitle] = useState('');
  const [memo, setMemo] = useState('');
  const [insertedTopics, setInsertedTopics] = useState<Set<string>>(new Set());
  const [quickTasks, setQuickTasks] = useState<string[]>([]);
  const [newTaskLabel, setNewTaskLabel] = useState('');
  const [saving, setSaving] = useState(false);

  // 下書きの読み込みが終わるまでは自動保存しない（読み込み前に空の初期値で上書きしないため）
  const draftReadyRef = useRef(false);

  // 生徒が切り替わったら、フォームを初期化し直し下書きを復元する
  useEffect(() => {
    draftReadyRef.current = false;
    const draft = loadInterviewDraft(studentId);
    if (draft) {
      setInterviewDate(draft.interviewDate || todayStr());
      setInterviewType(draft.interviewType || 'parent_interview');
      setTitle(draft.title || '');
      setMemo(draft.memo || '');
      setInsertedTopics(new Set(draft.insertedTopics || []));
      setQuickTasks(draft.quickTasks || []);
    } else {
      setInterviewDate(todayStr());
      setInterviewType('parent_interview');
      setTitle('');
      setMemo('');
      setInsertedTopics(new Set());
      setQuickTasks([]);
    }
    setNewTaskLabel('');
    draftReadyRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  // 自動保存（下書き）＋ 印刷シート向けスナップショット通知
  useEffect(() => {
    onDraftChange({
      interviewDate,
      interviewTypeLabel: INTERVIEW_TYPE_LABELS[interviewType],
      title,
      memo,
    });
    if (!draftReadyRef.current) return;
    saveInterviewDraft(studentId, {
      interviewDate,
      interviewType,
      title,
      memo,
      insertedTopics: Array.from(insertedTopics),
      quickTasks,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId, interviewDate, interviewType, title, memo, insertedTopics, quickTasks]);

  const insertTopic = (topic: string) => {
    if (insertedTopics.has(topic)) return;
    setMemo((prev) => (prev ? `${prev}\n\n## ${topic}\n` : `## ${topic}\n`));
    setInsertedTopics((prev) => new Set(prev).add(topic));
  };

  const addQuickTask = () => {
    const label = newTaskLabel.trim();
    if (!label) return;
    setQuickTasks((prev) => [...prev, label]);
    setNewTaskLabel('');
  };
  const removeQuickTask = (idx: number) =>
    setQuickTasks((prev) => prev.filter((_, i) => i !== idx));

  const handleSave = async () => {
    if (!memo.trim()) return;
    setSaving(true);
    try {
      // 1) 面談記録本体を保存する。ここで失敗した場合は何も作られていないので、
      //    フォームと下書きを残してそのまま再保存できる。
      await createInterview(schoolId, studentId, {
        interview_date: interviewDate,
        interview_type: interviewType,
        title: title.trim() || null,
        content: memo.trim(),
      });

      // 2) 約束・宿題クイック登録は 'task' 種別として1件ずつ作成する。
      //    本体の保存は既に成功しているため、ここでの失敗を throw して
      //    フォームを残すと「再保存 → 面談記録が二重に作られる」ことになる。
      //    よってタスク側の失敗は本体の成功と切り離し、失敗した約束だけを警告で伝える。
      const failedTasks: string[] = [];
      if (quickTasks.length > 0) {
        const results = await Promise.allSettled(
          quickTasks.map((label) =>
            createInterview(schoolId, studentId, {
              interview_date: interviewDate,
              interview_type: 'task',
              title: null,
              content: label,
            })
          )
        );
        results.forEach((r, i) => {
          if (r.status === 'rejected') {
            console.error('Error saving interview task:', r.reason);
            failedTasks.push(quickTasks[i]);
          }
        });
      }

      clearInterviewDraft(studentId);
      if (failedTasks.length > 0) {
        warning(
          `面談記録は保存しましたが、約束・宿題${failedTasks.length}件の登録に失敗しました（${failedTasks.join('、')}）。お手数ですが個別に登録してください`
        );
      } else {
        success('面談記録を保存しました');
      }

      // フォームをクリア
      setInterviewDate(todayStr());
      setInterviewType('parent_interview');
      setTitle('');
      setMemo('');
      setInsertedTopics(new Set());
      setQuickTasks([]);
      setNewTaskLabel('');

      onSaved();
    } catch (e) {
      console.error('Error saving interview:', e);
      toastError(getUserErrorMessage(e, '面談記録の保存に失敗しました'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="print:hidden">
      <CardHeader className="flex flex-col gap-3 border-b border-border-subtle pb-4 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle>今回の面談</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="date"
            value={interviewDate}
            onChange={(e) => setInterviewDate(e.target.value)}
            className="w-40"
            disabled={saving}
          />
          <Select
            aria-label="面談種別"
            value={interviewType}
            onChange={(e) => setInterviewType(e.target.value as InterviewType)}
            className="w-36"
            disabled={saving}
            options={MEMO_INTERVIEW_TYPES.map((t) => ({
              value: t,
              label: INTERVIEW_TYPE_LABELS[t],
            }))}
          />
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        {/* タイトル（任意） */}
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="タイトル（任意）"
          className="mb-3"
          disabled={saving}
        />

        {/* 話題チップ */}
        <div className="mb-3">
          <p className="mb-1.5 text-xs text-text-muted">クリックでメモに見出しを挿入します</p>
          <div className="flex flex-wrap gap-1.5">
            {TOPIC_CHIPS.map((topic) => {
              const inserted = insertedTopics.has(topic);
              return (
                <button
                  key={topic}
                  type="button"
                  disabled={inserted || saving}
                  onClick={() => insertTopic(topic)}
                  className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    inserted
                      ? 'cursor-not-allowed border-border-subtle bg-surface text-text-faint'
                      : 'border-border bg-surface text-text-body hover:border-primary hover:text-primary'
                  }`}
                >
                  {inserted ? <CheckCircle2 className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                  {topic}
                </button>
              );
            })}
          </div>
        </div>

        {/* メモ本体 */}
        <Textarea
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder="面談の内容を記録します。話題チップを押すと見出しが挿入されます。"
          className="min-h-[320px]"
          disabled={saving}
        />

        {/* 約束・宿題クイック登録 */}
        <div className="mt-4 rounded-lg border border-border-subtle p-3">
          <div className="mb-2 flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-text-muted" />
            <span className="text-sm font-semibold text-text-heading">約束・宿題クイック登録</span>
          </div>
          <div className="flex gap-2">
            <Input
              value={newTaskLabel}
              onChange={(e) => setNewTaskLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addQuickTask();
                }
              }}
              placeholder="例：英語ワークP10まで"
              className="flex-1"
              disabled={saving}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={addQuickTask}
              disabled={saving}
              className="shrink-0 gap-1"
            >
              <Plus className="h-3.5 w-3.5" />
              追加
            </Button>
          </div>
          {quickTasks.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1">
              {quickTasks.map((label, idx) => (
                <li
                  key={idx}
                  className="flex items-center gap-2 rounded-md bg-surface-hover px-2 py-1.5"
                >
                  <Circle className="h-3.5 w-3.5 shrink-0 text-text-faint" />
                  <span className="flex-1 text-sm text-text-body">{label}</span>
                  <button
                    type="button"
                    onClick={() => removeQuickTask(idx)}
                    disabled={saving}
                    className="shrink-0 text-text-faint transition-colors hover:text-danger"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-text-faint">保存時に「タスク」として登録されます</p>
        </div>

        {/* フッター */}
        <div className="mt-4 flex flex-col gap-2 border-t border-border-subtle pt-4 sm:flex-row sm:items-center sm:justify-between">
          <Button onClick={handleSave} disabled={!memo.trim() || saving} className="gap-1.5">
            <CheckCircle2 className="h-4 w-4" />
            {saving ? '保存中...' : '面談記録を保存'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
