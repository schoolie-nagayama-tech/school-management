'use client';

/**
 * 生徒の通塾可能表 公開送信ページ（未ログイン）
 *
 * URL: /seasonal-shift-student/[settingId]?student_code=XXXX&edit_token=YYYY
 *
 * フロー:
 *  1. URL から settingId + （任意）student_code + edit_token を受け取り、
 *     GET /api/seasonal-shift-student/submit で設定 + 開講枠 + 生徒情報を取得
 *  2. 生徒コード未指定 or 不一致なら、生徒コード入力フォームを出す
 *  3. 一致したら日付×時間帯のマトリクスを描画、保護者がチェック
 *  4. 送信ボタンで POST → 完了画面
 *
 * 修正リンクで来た場合 (edit_token) は既存の選択状態をプリセット。
 */

import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { Card, CardContent } from '@/components/ui';
import { Button } from '@/components/ui';
import { ToastContainer, Loading } from '@/components/ui';
import { useToast } from '@/hooks/useToast';
import { CheckCircle2 } from 'lucide-react';
import { formatGradeLabel } from '@/lib/utils/gradeLabel';

interface SettingInfo {
  id: string;
  school_id: string;
  name: string;
  start_date: string;
  end_date: string;
  deadline: string | null;
  description: string | null;
}

interface OpenSlot {
  slot_date: string;
  time_slot: string;
  is_open: boolean;
}

interface FetchedData {
  setting: SettingInfo;
  open_slots: OpenSlot[];
  student: { id: string; last_name: string; first_name: string; grade: number } | null;
  existing_submission: { id: string; allow_edit: boolean } | null;
}

export default function StudentShiftFormPage() {
  const params = useParams();
  const search = useSearchParams();
  const settingId = params.settingId as string;
  const initialStudentCode = search.get('student_code') ?? '';
  const editToken = search.get('edit_token') ?? '';

  const { toasts, removeToast, success, error: toastError } = useToast();

  const [studentCode, setStudentCode] = useState(initialStudentCode);
  const [parentEmail, setParentEmail] = useState('');
  const [parentName, setParentName] = useState('');
  const [notes, setNotes] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [data, setData] = useState<FetchedData | null>(null);
  // 選択状態：'YYYY-MM-DD|HH:MM-HH:MM' の Set
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // 生徒コードを送って確定するまでは確認モード
  const [studentConfirmed, setStudentConfirmed] = useState(false);

  // 設定情報をフェッチ（生徒コードあれば生徒情報も合わせて取得）
  const fetchData = async (code: string) => {
    setIsLoading(true);
    try {
      const url = new URL('/api/seasonal-shift-student/submit', window.location.origin);
      url.searchParams.set('setting_id', settingId);
      if (code) url.searchParams.set('student_code', code);
      const res = await fetch(url.toString());
      const body = await res.json();
      if (!res.ok) {
        toastError(body.error || '取得に失敗しました');
        setData(null);
        return;
      }
      setData(body as FetchedData);
      if (body.student) setStudentConfirmed(true);
    } catch (e) {
      toastError(e instanceof Error ? e.message : '取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData(initialStudentCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingId]);

  // 既存提出を受け取ったら、修正時に slots をプリセット
  useEffect(() => {
    if (!editToken || !data?.existing_submission) return;
    // 既存スロットを別APIで取得するのが厳密だが、ここでは GET レスポンスに含めていないので
    // submit ページ初回ロード時に空からスタート → 修正フローは将来拡張
  }, [editToken, data]);

  // 日付一覧（ソート済み）
  const dates = useMemo(() => {
    if (!data) return [];
    const set = new Set<string>();
    data.open_slots.forEach((s) => set.add(s.slot_date));
    return Array.from(set).sort();
  }, [data]);

  // 時間帯一覧（ソート済み）
  const timeSlots = useMemo(() => {
    if (!data) return [];
    const set = new Set<string>();
    data.open_slots.forEach((s) => set.add(s.time_slot));
    return Array.from(set).sort();
  }, [data]);

  // 開講マップ（日付×時間 → 開講)
  const openMap = useMemo(() => {
    const m = new Set<string>();
    if (!data) return m;
    data.open_slots.forEach((s) => m.add(`${s.slot_date}|${s.time_slot}`));
    return m;
  }, [data]);

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAllInDay = (date: string) => {
    const keys = timeSlots
      .filter((ts) => openMap.has(`${date}|${ts}`))
      .map((ts) => `${date}|${ts}`);
    const allOn = keys.every((k) => selected.has(k));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOn) keys.forEach((k) => next.delete(k));
      else keys.forEach((k) => next.add(k));
      return next;
    });
  };

  const handleConfirmStudent = async () => {
    if (!studentCode.trim()) {
      toastError('生徒コードを入力してください');
      return;
    }
    await fetchData(studentCode.trim());
  };

  const handleSubmit = async () => {
    if (!data?.student) {
      toastError('生徒情報が確認できません');
      return;
    }
    if (!parentEmail.trim()) {
      toastError('メールアドレスを入力してください');
      return;
    }
    if (selected.size === 0) {
      toastError('1つ以上の通塾可能日時を選択してください');
      return;
    }
    setIsSubmitting(true);
    try {
      const slots = Array.from(selected).map((key) => {
        const [shift_date, time_slot] = key.split('|');
        return { shift_date, time_slot };
      });
      const res = await fetch('/api/seasonal-shift-student/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          setting_id: settingId,
          student_id: data.student.id,
          submitter_email: parentEmail.trim(),
          submitter_name: parentName.trim(),
          notes: notes.trim(),
          selected_slots: slots,
          edit_token: editToken || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        if (body.error === 'already_submitted') {
          toastError('すでに提出済みです。修正は校舎にご連絡ください');
        } else {
          toastError(body.error || '送信に失敗しました');
        }
        return;
      }
      success('送信しました');
      setSubmitted(true);
    } catch (e) {
      toastError(e instanceof Error ? e.message : '送信に失敗しました');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <Loading />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface p-4">
        <Card className="max-w-md w-full">
          <CardContent className="p-6 text-center">
            <p className="text-danger font-semibold">フォームが見つかりませんでした</p>
            <p className="text-sm text-text-muted mt-2">
              URLが正しいか確認するか、校舎にお問い合わせください。
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface p-4">
        <Card className="max-w-md w-full">
          <CardContent className="p-8 text-center">
            <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-3" />
            <h2 className="text-xl font-bold mb-2">送信完了</h2>
            <p className="text-sm text-text-muted">ご提出いただきありがとうございました。</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface py-6">
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <div className="max-w-3xl mx-auto px-4 space-y-4">
        <Card>
          <CardContent className="p-4">
            <h1 className="text-xl font-bold mb-1">{data.setting.name}</h1>
            <p className="text-sm text-text-muted">通塾可能日時の確認フォーム</p>
            <p className="text-xs text-text-muted mt-2">
              期間: {data.setting.start_date} 〜 {data.setting.end_date}
              {data.setting.deadline && ` ・ 締切: ${data.setting.deadline}`}
            </p>
            {data.setting.description && (
              <p className="text-sm mt-3 whitespace-pre-wrap text-text-body">
                {data.setting.description}
              </p>
            )}
          </CardContent>
        </Card>

        {/* 生徒確認ステップ */}
        {!studentConfirmed || !data.student ? (
          <Card>
            <CardContent className="p-4 space-y-3">
              <h2 className="text-sm font-bold">生徒確認</h2>
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">
                  生徒コード（校舎から案内されたもの）
                </label>
                <input
                  type="text"
                  value={studentCode}
                  onChange={(e) => setStudentCode(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md text-sm"
                  placeholder="例: 12345"
                />
              </div>
              <Button onClick={handleConfirmStudent} disabled={isLoading}>
                確認
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="bg-info-subtle border border-info rounded p-3 text-sm">
                  生徒:{' '}
                  <strong>
                    {data.student.last_name} {data.student.first_name}
                  </strong>
                  <span className="text-text-muted ml-1">
                    （{formatGradeLabel(data.student.grade)}）
                  </span>
                </div>

                {data.existing_submission && !editToken && (
                  <div className="bg-danger-subtle border border-danger rounded p-3 text-sm text-danger">
                    既に提出済みです。修正には校舎の許可が必要です。
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1">
                    保護者メールアドレス（必須）
                  </label>
                  <input
                    type="email"
                    value={parentEmail}
                    onChange={(e) => setParentEmail(e.target.value)}
                    className="w-full px-3 py-2 border rounded-md text-sm"
                    placeholder="例: parent@example.com"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1">
                    お名前（任意）
                  </label>
                  <input
                    type="text"
                    value={parentName}
                    onChange={(e) => setParentName(e.target.value)}
                    className="w-full px-3 py-2 border rounded-md text-sm"
                  />
                </div>
              </CardContent>
            </Card>

            {/* マトリクス */}
            <Card>
              <CardContent className="p-4">
                <h2 className="text-sm font-bold mb-2">通塾可能日時を選択</h2>
                <p className="text-xs text-text-muted mb-3">
                  チェックした日時のコマで講習を組みます。日付の見出しをクリックすると全選択／全解除できます。
                </p>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-xs border-collapse">
                    <thead>
                      <tr>
                        <th className="text-left p-1 border-b font-medium">時間</th>
                        {dates.map((d) => {
                          const dayKeys = timeSlots
                            .filter((ts) => openMap.has(`${d}|${ts}`))
                            .map((ts) => `${d}|${ts}`);
                          const allOn = dayKeys.length > 0 && dayKeys.every((k) => selected.has(k));
                          return (
                            <th key={d} className="p-1 border-b">
                              <button
                                type="button"
                                onClick={() => toggleAllInDay(d)}
                                className={`block w-full text-center px-1 py-0.5 rounded transition-colors duration-150 ${
                                  allOn ? 'bg-info-subtle text-info' : 'hover:bg-surface'
                                }`}
                              >
                                {d.slice(5)}
                              </button>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {timeSlots.map((ts) => (
                        <tr key={ts}>
                          <td className="p-1 border-b font-medium whitespace-nowrap">{ts}</td>
                          {dates.map((d) => {
                            const key = `${d}|${ts}`;
                            const isOpen = openMap.has(key);
                            const isChecked = selected.has(key);
                            return (
                              <td key={d} className="p-1 border-b text-center">
                                {isOpen ? (
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={() => toggle(key)}
                                    className="w-4 h-4 accent-indigo-600 cursor-pointer"
                                  />
                                ) : (
                                  <span className="text-text-faint">—</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-text-muted mt-2">
                  選択中: <strong>{selected.size}</strong> コマ
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4 space-y-2">
                <label className="block text-xs font-medium text-text-muted">備考（任意）</label>
                <textarea
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md text-sm"
                  placeholder="特記事項があれば記入してください"
                />
                <Button onClick={handleSubmit} disabled={isSubmitting} className="w-full">
                  {isSubmitting ? '送信中...' : '送信'}
                </Button>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
