'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Send,
  CalendarX,
  CalendarClock,
  Users,
  ChevronLeft,
  Info,
  ExternalLink,
} from 'lucide-react';
import { Button, Modal, Input, Textarea } from '@/components/ui';
import { isTransferDeadlinePassed } from '@/lib/mypage/transferDeadline';
import type {
  ChatMessage,
  ChatTemplateKind,
  PortalThreadSummary,
  TransferCandidate,
} from '@/types/chat';
import type { PortalScheduleEntryDto, PortalTimeSlotDto } from '@/types/mypage-schedule';
import { LessonPickerSheet } from './LessonPickerSheet';
import { AbsenceSheet } from './AbsenceSheet';

/** 話題フィルタ。 */
type TopicFilter = 'all' | 'zesseki' | 'meeting';

/** template_kind をフィルタ区分へ写像する。 */
function topicOf(kind: ChatTemplateKind | null): TopicFilter | 'plain' {
  if (kind === 'absence' || kind === 'transfer_request') return 'zesseki';
  if (kind === 'meeting_request') return 'meeting';
  return 'plain';
}

/**
 * 保護者チャット画面（モバイルファースト）。
 *
 * - 生徒が複数（兄弟）なら生徒選択 → スレッド。単一ならそのまま会話へ。
 * - 吹き出し: 教室(staff)=左 / 保護者(portal)=右 / system=中央の通知スタイル。
 * - 話題フィルタ（すべて/欠席・振替/面談）、構造化カード表示、クイックアクション。
 */
export function ChatView() {
  const [threads, setThreads] = useState<PortalThreadSummary[]>([]);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [selected, setSelected] = useState<PortalThreadSummary | null>(null);

  const loadThreads = useCallback(async () => {
    setLoadingThreads(true);
    try {
      const res = await fetch('/api/mypage/chat/threads');
      const json = await res.json();
      const list: PortalThreadSummary[] = res.ok ? (json.threads ?? []) : [];
      setThreads(list);
      // 生徒が1人だけなら自動で会話へ入る。
      if (list.length === 1) setSelected(list[0]);
    } finally {
      setLoadingThreads(false);
    }
  }, []);

  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  if (loadingThreads) {
    return <p className="py-8 text-center text-sm text-text-muted">読み込み中…</p>;
  }

  if (threads.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface-raised p-4 text-sm text-text-muted">
        表示できる生徒がいません。
      </div>
    );
  }

  // 複数生徒でまだ選んでいない → 生徒選択リスト。
  if (!selected) {
    return (
      <div className="space-y-2">
        <h2 className="mb-2 text-sm font-semibold text-text-heading">お子さまを選択</h2>
        {threads.map((t) => (
          <button
            key={t.student_id}
            type="button"
            onClick={() => setSelected(t)}
            className="flex w-full items-center justify-between rounded-xl border border-border bg-surface-raised p-4 text-left transition-colors hover:bg-surface-hover"
          >
            <div className="min-w-0">
              <p className="truncate font-medium text-text-heading">{t.student_name}</p>
              <p className="truncate text-xs text-text-muted">
                {t.last_message_preview ?? 'メッセージはまだありません'}
              </p>
            </div>
            {t.unread_count > 0 && (
              <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1.5 text-xs font-medium text-white">
                {t.unread_count}
              </span>
            )}
          </button>
        ))}
      </div>
    );
  }

  return (
    <Conversation
      thread={selected}
      showBack={threads.length > 1}
      onBack={() => {
        setSelected(null);
        loadThreads();
      }}
    />
  );
}

/** 1スレッドの会話ビュー。 */
function Conversation({
  thread,
  showBack,
  onBack,
}: {
  thread: PortalThreadSummary;
  showBack: boolean;
  onBack: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [topic, setTopic] = useState<TopicFilter>('all');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [activeTemplate, setActiveTemplate] = useState<ChatTemplateKind | null>(null);
  /**
   * 欠席・振替の連絡は「まず授業を選ぶ」。日付の手入力だと教室に無いコマで書かれ、
   * 確認の往復が起きるため、実際に入っている予定から選んでもらう。
   * 選んだあとの入力・送信は予定ビューと同じ AbsenceSheet に委ねる（送信経路を二重に持たない）。
   */
  const [lessonPicker, setLessonPicker] = useState<'absence' | 'transfer' | null>(null);
  const [pickedLesson, setPickedLesson] = useState<{
    entry: PortalScheduleEntryDto;
    timeSlots: PortalTimeSlotDto[];
    kind: 'absence' | 'transfer';
  } | null>(null);
  // TemplateForm（クイックアクションの連絡シート）向けの教室情報。生徒が決まった時点で
  // 一度だけ取っておき、開閉のたびには叩かない（保護者は電波の悪い場所でも使う）。
  const [timeSlots, setTimeSlots] = useState<PortalTimeSlotDto[]>([]);
  const [meetingBookingUrl, setMeetingBookingUrl] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/mypage/chat/messages?student_id=${encodeURIComponent(thread.student_id)}`
      );
      const json = await res.json();
      setMessages(res.ok ? (json.messages ?? []) : []);
    } finally {
      setLoading(false);
    }
  }, [thread.student_id]);

  useEffect(() => {
    load();
  }, [load]);

  // ★ 失敗しても画面を壊さない: 時限は空配列（TemplateForm 側が自由入力にフォールバック）、
  //   予約URLは null（従来のチャット送信フォームにフォールバック）のままにする。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/mypage/school-info?student_id=${encodeURIComponent(thread.student_id)}`
        );
        const json = await res.json();
        if (cancelled) return;
        if (res.ok) {
          setTimeSlots(json.timeSlots ?? []);
          setMeetingBookingUrl(json.meetingBookingUrl ?? null);
        } else {
          setTimeSlots([]);
          setMeetingBookingUrl(null);
        }
      } catch {
        if (!cancelled) {
          setTimeSlots([]);
          setMeetingBookingUrl(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [thread.student_id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const filtered = useMemo(() => {
    if (topic === 'all') return messages;
    return messages.filter((m) => {
      const t = topicOf(m.template_kind);
      // system/plain も含めて話題に緩く紐づける（zesseki/meeting のときは該当テンプレのみ）。
      if (topic === 'zesseki') return t === 'zesseki';
      return t === 'meeting';
    });
  }, [messages, topic]);

  const sendText = async () => {
    if (!text.trim()) return;
    setSending(true);
    try {
      const res = await fetch('/api/mypage/chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id: thread.student_id, body: text.trim() }),
      });
      if (res.ok) {
        setText('');
        await load();
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col" style={{ minHeight: '70vh' }}>
      {/* ヘッダー */}
      <div className="mb-2 flex items-center gap-2">
        {showBack && (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center text-sm text-text-muted hover:text-text-heading"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-text-heading">
            {thread.student_name} さん・教室とのやり取り
          </p>
        </div>
      </div>

      {/* 話題フィルタ */}
      <div className="mb-3 flex gap-1.5">
        {(
          [
            { key: 'all', label: 'すべて' },
            { key: 'zesseki', label: '欠席・振替' },
            { key: 'meeting', label: '面談' },
          ] as { key: TopicFilter; label: string }[]
        ).map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setTopic(f.key)}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              topic === f.key
                ? 'border-ink bg-ink/10 font-medium text-text-heading'
                : 'border-border text-text-muted hover:bg-surface-hover'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* メッセージ */}
      <div className="flex-1 space-y-3 overflow-y-auto rounded-xl border border-border bg-surface p-3">
        {loading ? (
          <p className="py-8 text-center text-sm text-text-muted">読み込み中…</p>
        ) : filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-text-muted">
            メッセージはまだありません。下のボタンから連絡できます。
          </p>
        ) : (
          filtered.map((m) => <MessageBubble key={m.id} message={m} />)
        )}
        <div ref={bottomRef} />
      </div>

      {/* クイックアクション */}
      <div className="mt-3 flex flex-wrap gap-2">
        <QuickButton
          icon={<CalendarX className="h-4 w-4" />}
          label="欠席・遅刻"
          onClick={() => setLessonPicker('absence')}
        />
        <QuickButton
          icon={<CalendarClock className="h-4 w-4" />}
          label="振替希望"
          onClick={() => setLessonPicker('transfer')}
        />
        <QuickButton
          icon={<Users className="h-4 w-4" />}
          label="面談希望"
          onClick={() => setActiveTemplate('meeting_request')}
        />
      </div>

      {/* 自由入力 */}
      <div className="mt-2 flex items-end gap-2">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="メッセージを入力"
          rows={2}
          className="flex-1"
        />
        <Button onClick={sendText} isLoading={sending} disabled={!text.trim()}>
          <Send className="h-4 w-4" />
        </Button>
      </div>

      {/* 欠席・振替：まず対象の授業を選ぶ。予定が1件も無い教室・生徒では、
          従来の日付入力フォーム（TemplateForm）へ逃がして連絡できなくならないようにする。 */}
      {lessonPicker && !pickedLesson && (
        <LessonPickerSheet
          studentId={thread.student_id}
          title={lessonPicker === 'absence' ? '欠席・遅刻の連絡' : '振替のご希望'}
          onPick={(entry, slots) => {
            setPickedLesson({ entry, timeSlots: slots, kind: lessonPicker });
            setLessonPicker(null);
          }}
          onClose={() => setLessonPicker(null)}
          onNoLessons={() => {
            setActiveTemplate(lessonPicker === 'absence' ? 'absence' : 'transfer_request');
            setLessonPicker(null);
          }}
        />
      )}

      {pickedLesson && (
        <AbsenceSheet
          studentId={thread.student_id}
          entry={pickedLesson.entry}
          timeSlots={pickedLesson.timeSlots}
          initialKind={pickedLesson.kind}
          onClose={() => setPickedLesson(null)}
          onSent={async () => {
            setPickedLesson(null);
            await load();
          }}
        />
      )}

      {activeTemplate && (
        <TemplateForm
          kind={activeTemplate}
          studentId={thread.student_id}
          timeSlots={timeSlots}
          meetingBookingUrl={meetingBookingUrl}
          onClose={() => setActiveTemplate(null)}
          onSent={async () => {
            setActiveTemplate(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

/** クイックアクションのボタン。 */
function QuickButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-text-body transition-colors hover:bg-surface-hover"
    >
      {icon}
      {label}
    </button>
  );
}

/** 1メッセージの吹き出し。 */
function MessageBubble({ message }: { message: ChatMessage }) {
  const time = new Date(message.created_at).toLocaleString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  if (message.sender_kind === 'system') {
    // 中央寄せの通知スタイル。
    return (
      <div className="flex justify-center">
        <div className="max-w-[90%] rounded-lg border border-info/40 bg-info/5 px-3 py-2 text-center text-xs text-text-body">
          <div className="mb-1 flex items-center justify-center gap-1 text-info">
            <Info className="h-3.5 w-3.5" />
            <span className="font-medium">お知らせ</span>
          </div>
          <p className="whitespace-pre-wrap">{message.body}</p>
        </div>
      </div>
    );
  }

  const isPortal = message.sender_kind === 'portal';
  return (
    <div className={`flex ${isPortal ? 'justify-end' : 'justify-start'}`}>
      <div className="max-w-[85%]">
        {message.template_kind ? (
          <StructuredCard message={message} isPortal={isPortal} />
        ) : (
          <div
            className={`rounded-2xl px-3 py-2 text-sm ${
              isPortal
                ? 'rounded-br-sm bg-ink text-white'
                : 'rounded-bl-sm border border-border bg-surface-raised text-text-body'
            }`}
          >
            <p className="whitespace-pre-wrap">{message.body}</p>
          </div>
        )}
        <p
          className={`mt-0.5 text-[10px] text-text-muted ${isPortal ? 'text-right' : 'text-left'}`}
        >
          {isPortal ? 'あなた' : '教室'}・{time}
        </p>
      </div>
    </div>
  );
}

/** テンプレメッセージの構造化カード表示。 */
function StructuredCard({ message, isPortal }: { message: ChatMessage; isPortal: boolean }) {
  const p = message.payload ?? {};
  const kindLabel =
    message.template_kind === 'absence'
      ? '欠席・遅刻の連絡'
      : message.template_kind === 'transfer_request'
        ? '振替のご希望'
        : '面談のご希望';
  const rank = ['第1希望', '第2希望', '第3希望'];
  return (
    <div
      className={`rounded-2xl border px-3 py-2 text-sm ${
        isPortal
          ? 'rounded-br-sm border-ink/30 bg-ink/5'
          : 'rounded-bl-sm border-border bg-surface-raised'
      }`}
    >
      <p className="mb-1 font-semibold text-text-heading">{kindLabel}</p>
      {p.lessonDate && (
        <p className="text-text-body">
          対象授業: {p.lessonDate}
          {p.lessonSlot ? ` ${p.lessonSlot}` : ''}
        </p>
      )}
      {p.reason && <p className="text-text-body">理由: {p.reason}</p>}
      {p.preferredNote && <p className="text-text-body">希望時間帯: {p.preferredNote}</p>}
      {p.wantsTransfer === false && message.template_kind === 'absence' && (
        <p className="text-text-muted">振替希望: なし</p>
      )}
      {p.candidates && p.candidates.length > 0 && (
        <div className="mt-1">
          {p.candidates.map((c, i) => (
            <p key={i} className="text-text-body">
              {rank[i] ?? `第${i + 1}希望`}: {c.date}
              {c.slot ? ` ${c.slot}` : ''}
            </p>
          ))}
        </div>
      )}
      {p.transferDowngraded && (
        <p className="mt-1 text-xs text-warning">※前日21時を過ぎたため欠席として送信されました</p>
      )}
    </div>
  );
}

/** テンプレ送信の小フォーム（モーダル）。 */
function TemplateForm({
  kind,
  studentId,
  timeSlots,
  meetingBookingUrl,
  onClose,
  onSent,
}: {
  kind: ChatTemplateKind;
  studentId: string;
  /** その教室に実在する時限。AbsenceSheet と同じく、時限は自由入力ではなく選択にする。
   *  取得に失敗/未取得（空配列）なら自由入力にフォールバックする。 */
  timeSlots: PortalTimeSlotDto[];
  /** 生徒の所属校の面談予約URL。設定されていれば面談希望はチャット送信せず
   *  予約ページへ直接誘導する（§3）。未設定（null）なら従来のチャット送信フォーム。 */
  meetingBookingUrl: string | null;
  onClose: () => void;
  onSent: () => void;
}) {
  const [lessonDate, setLessonDate] = useState('');
  const [lessonSlot, setLessonSlot] = useState('');
  const [reason, setReason] = useState('');
  const [wantsTransfer, setWantsTransfer] = useState(false);
  const [preferredNote, setPreferredNote] = useState('');
  const [candidates, setCandidates] = useState<TransferCandidate[]>([
    { date: '', slot: '' },
    { date: '', slot: '' },
    { date: '', slot: '' },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const title =
    kind === 'absence'
      ? '欠席・遅刻の連絡'
      : kind === 'transfer_request'
        ? '振替のご希望'
        : '面談のご希望';

  // 対象授業日に対する振替締切（前日21時JST）判定。締切超過なら振替不可。
  const deadlinePassed = useMemo(
    () => (lessonDate ? isTransferDeadlinePassed(lessonDate) : false),
    [lessonDate]
  );

  // 締切を過ぎたら振替希望トグルを強制OFF。
  useEffect(() => {
    if (deadlinePassed && wantsTransfer) setWantsTransfer(false);
  }, [deadlinePassed, wantsTransfer]);

  const needsCandidates =
    !deadlinePassed && (kind === 'transfer_request' || (kind === 'absence' && wantsTransfer));

  const submit = async () => {
    setError('');
    // クライアント側バリデーション（サーバーでも再検証される）。
    if ((kind === 'absence' || kind === 'transfer_request') && !lessonDate) {
      setError('対象の授業日を選択してください');
      return;
    }
    if (kind === 'transfer_request' && deadlinePassed) {
      setError('前日21時を過ぎているため振替はできません。欠席のご連絡としてお送りください。');
      return;
    }
    const filledCandidates = candidates.filter((c) => c.date);
    if (needsCandidates && filledCandidates.length === 0) {
      setError('振替の第1希望（日付）を入力してください');
      return;
    }

    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = { reason: reason || undefined };
      if (kind === 'absence' || kind === 'transfer_request') {
        payload.lessonDate = lessonDate;
        payload.lessonSlot = lessonSlot || undefined;
      }
      if (kind === 'absence') payload.wantsTransfer = wantsTransfer;
      if (needsCandidates) payload.candidates = filledCandidates;
      if (kind === 'meeting_request') payload.preferredNote = preferredNote || undefined;

      const res = await fetch('/api/mypage/chat/template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id: studentId, template_kind: kind, payload }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? '送信に失敗しました');
        return;
      }
      onSent();
    } catch {
      setError('通信に失敗しました');
    } finally {
      setSubmitting(false);
    }
  };

  // ★ 面談希望＋予約URL設定済みの教室は、チャット送信フォームを出さず予約ページへ
  //   直接誘導する（往復を1回減らす。§3）。サーバー側の buildAckBody にも同じURLを
  //   載せる経路は残っているが、そちらは変更しない（旧クライアント・直接POST対策）。
  //   URL未設定の教室は下の従来フォームに続けて後方互換を保つ。
  if (kind === 'meeting_request' && meetingBookingUrl) {
    return (
      <Modal isOpen onClose={onClose} title={title} size="md">
        <div className="space-y-4">
          <p className="text-sm text-text-body">
            ご都合の良い日時を、予約ページから直接お選びいただけます。
          </p>
          <a
            href={meetingBookingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-ink/90"
          >
            <ExternalLink className="h-4 w-4" />
            予約ページを開く
          </a>
          <div className="flex justify-end">
            <Button variant="ghost" onClick={onClose}>
              閉じる
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal isOpen onClose={onClose} title={title} size="md">
      <div className="space-y-4">
        {(kind === 'absence' || kind === 'transfer_request') && (
          <>
            <Input
              label="対象の授業日"
              type="date"
              value={lessonDate}
              onChange={(e) => setLessonDate(e.target.value)}
              required
            />
            {timeSlots.length > 0 ? (
              <div>
                <label className="mb-1 block text-sm font-medium text-text-heading">
                  時限・時間（任意）
                </label>
                {/* AbsenceSheet と同じ理由: 自由入力にすると教室に存在しない表記で
                    書かれてしまい、確認の往復が発生する。実在する時限だけを出す。 */}
                <select
                  value={lessonSlot}
                  onChange={(e) => setLessonSlot(e.target.value)}
                  className="w-full rounded-lg border border-border bg-surface-raised px-2 py-1.5 text-sm text-text-body"
                >
                  <option value="">指定なし</option>
                  {timeSlots.map((s) => (
                    <option key={s.id} value={s.slotLabel}>
                      {s.slotLabel}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <Input
                label="時限・時間（任意）"
                value={lessonSlot}
                onChange={(e) => setLessonSlot(e.target.value)}
                placeholder="例: 17:00〜 / 3限"
              />
            )}
          </>
        )}

        {kind === 'absence' && (
          <div className="rounded-lg border border-border p-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={wantsTransfer}
                disabled={deadlinePassed}
                onChange={(e) => setWantsTransfer(e.target.checked)}
                className="h-4 w-4"
              />
              <span className={deadlinePassed ? 'text-text-muted' : 'text-text-body'}>
                振替も希望する
              </span>
            </label>
            {deadlinePassed && lessonDate && (
              <p className="mt-2 text-xs text-warning">
                前日21時を過ぎているため振替はできません。欠席として受け付けます。
              </p>
            )}
          </div>
        )}

        {kind === 'transfer_request' && deadlinePassed && lessonDate && (
          <div className="rounded-lg border border-warning bg-warning/10 p-3 text-xs text-warning">
            前日21時を過ぎているため振替はできません。欠席のご連絡としてお送りください。
          </div>
        )}

        {needsCandidates && (
          <div>
            <label className="mb-1 block text-sm font-medium text-text-heading">
              振替の希望日時（第1希望は必須・第3希望まで）
            </label>
            <div className="space-y-2">
              {candidates.map((c, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-14 text-xs text-text-muted">第{i + 1}希望</span>
                  <input
                    type="date"
                    value={c.date}
                    onChange={(e) => {
                      const next = [...candidates];
                      next[i] = { ...next[i], date: e.target.value };
                      setCandidates(next);
                    }}
                    className="rounded-lg border border-border bg-surface-raised px-2 py-1.5 text-sm text-text-body"
                  />
                  {timeSlots.length > 0 ? (
                    <select
                      aria-label={`第${i + 1}希望の時限`}
                      value={c.slot}
                      onChange={(e) => {
                        const next = [...candidates];
                        next[i] = { ...next[i], slot: e.target.value };
                        setCandidates(next);
                      }}
                      className="min-w-0 flex-1 rounded-lg border border-border bg-surface-raised px-2 py-1.5 text-sm text-text-body"
                    >
                      <option value="">時限（任意）</option>
                      {timeSlots.map((s) => (
                        <option key={s.id} value={s.slotLabel}>
                          {s.slotLabel}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={c.slot}
                      onChange={(e) => {
                        const next = [...candidates];
                        next[i] = { ...next[i], slot: e.target.value };
                        setCandidates(next);
                      }}
                      placeholder="時限（任意）"
                      className="flex-1 rounded-lg border border-border bg-surface-raised px-2 py-1.5 text-sm text-text-body"
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {kind === 'meeting_request' && (
          <Input
            label="希望時間帯（任意）"
            value={preferredNote}
            onChange={(e) => setPreferredNote(e.target.value)}
            placeholder="例: 平日夕方 / 土曜午前"
          />
        )}

        <Textarea
          label={kind === 'meeting_request' ? 'ご相談内容（任意）' : '理由・連絡事項（任意）'}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
        />

        {error && (
          <div className="rounded-lg border border-danger bg-danger/10 p-3 text-sm text-danger">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            キャンセル
          </Button>
          <Button onClick={submit} isLoading={submitting}>
            送信する
          </Button>
        </div>
      </div>
    </Modal>
  );
}
