'use client';

/**
 * 問合せ管理 — 資料発送（ネコポス）ページ。
 * admin / owner のみアクセス可。
 *
 * セクション1: 発送対象の選択 + ヤマトB2クラウドCSV出力
 * セクション2: 教室別発送設定(ヤマト顧客コード・差出人情報・メール設定等)
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { AdminLayout } from '@/components/layouts';
import { Loading } from '@/components/ui';
import { Button } from '@/components/ui';
import { Input } from '@/components/ui';
import { Textarea } from '@/components/ui';
import { Checkbox } from '@/components/ui';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui';
import { useAuth } from '@/contexts/AuthContext';
import { useMasterData } from '@/contexts/MasterDataContext';
import AccessDenied from '@/components/AccessDenied';
import { getInquiries } from '@/lib/api/inquiries';
import { getAllInquirySchoolSettings, upsertInquirySchoolSettings } from '@/lib/api/inquirySettings';
import { generateNekoposCsv, downloadCsvNoBom } from '@/lib/utils/yamatoB2';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';
import { updateInquiry } from '@/lib/api/inquiries';
import type { Inquiry, InquirySchoolSettings, InquirySchoolSettingsInsert } from '@/types/database';
import { resolveBookingConfig } from '@/lib/utils/bookingConfig';
import { ArrowLeft, Truck, Save, AlertTriangle, CalendarDays } from 'lucide-react';

// ────────────────────────────────────────────────────────
// 型定義
// ────────────────────────────────────────────────────────

/** 曜日名（0=日〜6=土）の表示用配列 */
const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土'] as const;

/** セクション2: 教室設定フォームの状態（school_id ごとに管理） */
interface SettingFormState {
  hp_school_code: string;
  yamato_customer_code: string;
  yamato_fare_code: string;
  sender_name: string;
  sender_tel: string;
  sender_zip: string;
  sender_address: string;
  mail_signature: string;
  mail_reply_to: string;
  slack_mention_id: string;
  // ── 予約設定（面談） ──
  /** 空き判定・イベント作成に使う教室長のGoogleアカウント */
  booking_calendar_email: string;
  /** 面談受付の曜日（0=日〜6=土）。チェック状態を boolean[] で持つ */
  booking_interview_days: boolean[];
  /** 面談受付の開始時刻 HH:mm */
  booking_interview_start: string;
  /** 面談受付の終了時刻 HH:mm */
  booking_interview_end: string;
  /** 1枠の分数 */
  booking_interview_duration_min: string;
  /** 何時間先から予約可 */
  booking_lead_hours: string;
  /** 何日先まで */
  booking_window_days: string;
}

/** 住所/宛名の欠損チェック結果 */
function hasWarning(inquiry: Inquiry): boolean {
  const hasAddress =
    (inquiry.address_pref ?? '').trim() !== '' ||
    (inquiry.address_detail ?? '').trim() !== '' ||
    (inquiry.address_building ?? '').trim() !== '';
  const hasAddressee =
    (inquiry.guardian_name ?? '').trim() !== '' ||
    (inquiry.student_name ?? '').trim() !== '';
  return !hasAddress || !hasAddressee;
}

/** 表示用宛名（保護者名優先、カナのみなら生徒名、なければ—） */
function getDisplayAddressee(inquiry: Inquiry): string {
  const guardian = inquiry.guardian_name?.trim() ?? '';
  const isKanaOnly = /^[ァ-ヶー\s　]+$/.test(guardian);
  if (guardian && !isKanaOnly) return guardian;
  return inquiry.student_name?.trim() || '—';
}

/** 受付日を 'YYYY/MM/DD' 形式に変換 */
function formatInquiredAt(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}/${m}/${day}`;
}

/** ファイル名に使う 'YYYYMMDDHHmmss' 文字列を生成 */
function getTimestampString(date: Date): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${y}${mo}${d}_${h}${mi}${s}`;
}

/** InquirySchoolSettings → SettingFormState に変換 */
function settingsToFormState(s: InquirySchoolSettings): SettingFormState {
  // booking_config を resolveBookingConfig でデフォルトマージして取り出す
  const bc = resolveBookingConfig(s.booking_config ?? null);
  // interview_days（数値配列）を boolean[] に変換（インデックス 0-6 が曜日）
  const dowChecked = [0, 1, 2, 3, 4, 5, 6].map((d) => bc.interview_days.includes(d));
  return {
    hp_school_code:       s.hp_school_code ?? '',
    yamato_customer_code: s.yamato_customer_code ?? '',
    yamato_fare_code:     s.yamato_fare_code ?? '',
    sender_name:          s.sender_name ?? '',
    sender_tel:           s.sender_tel ?? '',
    sender_zip:           s.sender_zip ?? '',
    sender_address:       s.sender_address ?? '',
    mail_signature:       s.mail_signature ?? '',
    mail_reply_to:        s.mail_reply_to ?? '',
    slack_mention_id:     s.slack_mention_id ?? '',
    booking_calendar_email:           bc.calendar_email ?? '',
    booking_interview_days:           dowChecked,
    booking_interview_start:          bc.interview_start,
    booking_interview_end:            bc.interview_end,
    booking_interview_duration_min:   String(bc.interview_duration_min),
    booking_lead_hours:               String(bc.lead_hours),
    booking_window_days:              String(bc.window_days),
  };
}

/** 空のフォーム状態（設定未登録の教室向け）。予約設定はデフォルト値を使用する */
function emptyFormState(): SettingFormState {
  const bc = resolveBookingConfig(null);
  const dowChecked = [0, 1, 2, 3, 4, 5, 6].map((d) => bc.interview_days.includes(d));
  return {
    hp_school_code: '',
    yamato_customer_code: '',
    yamato_fare_code: '',
    sender_name: '',
    sender_tel: '',
    sender_zip: '',
    sender_address: '',
    mail_signature: '',
    mail_reply_to: '',
    slack_mention_id: '',
    booking_calendar_email:           '',
    booking_interview_days:           dowChecked,
    booking_interview_start:          bc.interview_start,
    booking_interview_end:            bc.interview_end,
    booking_interview_duration_min:   String(bc.interview_duration_min),
    booking_lead_hours:               String(bc.lead_hours),
    booking_window_days:              String(bc.window_days),
  };
}

// ────────────────────────────────────────────────────────
// メインコンポーネント
// ────────────────────────────────────────────────────────

export default function ShippingPage() {
  const { profile, getSelectedSchoolIds, selectedSchoolId } = useAuth();
  const { schools: masterSchools } = useMasterData();

  // 教室名マップ (school_id → name)。masterSchools の非同期ロード完了に追従するよう useMemo で構築
  const schoolsMap = useMemo(() => {
    const map: Record<string, string> = {};
    masterSchools.forEach((s) => { map[s.id] = s.name; });
    return map;
  }, [masterSchools]);

  // ロールガード: admin / owner のみ
  const isAdmin = profile?.role === 'admin' || profile?.role === 'owner' || profile?.role === 'manager';

  // ── セクション1 ──
  /** 全未発送フラグ(true=material_sent_at null の全status、false=資料請求+in_progress) */
  const [showAllUnsent, setShowAllUnsent] = useState(false);
  /** 取得した問合せ一覧 */
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  /** チェック状態: inquiry.id → boolean */
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  /** 発送日を記録するか */
  const [recordSentAt, setRecordSentAt] = useState(true);
  /** CSV出力後のスキップ一覧 */
  const [skippedRows, setSkippedRows] = useState<{ name: string; reason: string }[]>([]);
  /** 出力成功数 */
  const [exportCount, setExportCount] = useState<number | null>(null);
  const [isLoadingInquiries, setIsLoadingInquiries] = useState(true);
  const [inquiriesError, setInquiriesError] = useState('');
  const [isExporting, setIsExporting] = useState(false);

  // ── セクション2 ──
  /** フォーム状態 (school_id → SettingFormState) */
  const [formStates, setFormStates] = useState<Record<string, SettingFormState>>({});
  /** 保存中のschool_id Set */
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  /** 保存成功メッセージ (school_id → true) */
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [settingsError, setSettingsError] = useState('');

  // ── データ取得 ──

  /** 問合せ一覧を取得 */
  const fetchInquiries = useCallback(async () => {
    setIsLoadingInquiries(true);
    setInquiriesError('');
    try {
      const ids = getSelectedSchoolIds();
      if (ids.length === 0) {
        setInquiries([]);
        setIsLoadingInquiries(false);
        return;
      }

      // showAllUnsent: true → material_sent_at が null の全ステータス
      //               false → 資料請求 かつ in_progress かつ material_sent_at null
      let data: Inquiry[];
      if (showAllUnsent) {
        // material_sent_at IS NULL の全件を取得(ステータス絞り込みなし)
        const all = await getInquiries(ids);
        data = all.filter((q) => q.material_sent_at === null);
      } else {
        // 資料請求 + in_progress + material_sent_at IS NULL
        const all = await getInquiries(ids, { status: 'in_progress' });
        data = all.filter(
          (q) =>
            q.request_type === '資料請求' &&
            q.material_sent_at === null
        );
      }

      setInquiries(data);
      // デフォルト: 全行チェックON
      const initChecked: Record<string, boolean> = {};
      data.forEach((q) => { initChecked[q.id] = true; });
      setChecked(initChecked);
      // スキップ表示リセット
      setSkippedRows([]);
      setExportCount(null);
    } catch (err) {
      setInquiriesError(getUserErrorMessage(err, '問合せの取得に失敗しました'));
    } finally {
      setIsLoadingInquiries(false);
    }
  }, [getSelectedSchoolIds, showAllUnsent]);

  /** 教室設定を取得 */
  const fetchSettings = useCallback(async () => {
    setSettingsError('');
    try {
      const ids = getSelectedSchoolIds();
      if (ids.length === 0) return;

      const list = await getAllInquirySchoolSettings(ids);
      const sMap = new Map<string, InquirySchoolSettings>(
        list.map((s) => [s.school_id, s])
      );

      // フォーム状態を初期化
      const forms: Record<string, SettingFormState> = {};
      ids.forEach((id) => {
        const s = sMap.get(id);
        forms[id] = s ? settingsToFormState(s) : emptyFormState();
      });
      setFormStates(forms);
    } catch (err) {
      setSettingsError(getUserErrorMessage(err, '発送設定の取得に失敗しました'));
    }
  }, [getSelectedSchoolIds, masterSchools]);

  // 教室選択が変わったらデータを再取得
  useEffect(() => {
    if (selectedSchoolId !== null) {
      fetchInquiries();
      fetchSettings();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSchoolId, showAllUnsent]);

  // ── CSV出力ハンドラ ──

  const handleExportCsv = useCallback(async () => {
    setIsExporting(true);
    setSkippedRows([]);
    setExportCount(null);
    try {
      const ids = getSelectedSchoolIds();
      // 発送設定を最新取得(セクション2での変更が未保存の可能性があるため)
      const latestSettings = await getAllInquirySchoolSettings(ids);
      const sMap = new Map<string, InquirySchoolSettings>(
        latestSettings.map((s) => [s.school_id, s])
      );

      // チェックされた行のみ対象
      const targets = inquiries.filter((q) => checked[q.id]);
      if (targets.length === 0) {
        setSkippedRows([]);
        setExportCount(0);
        return;
      }

      const today = new Date();
      const result = generateNekoposCsv(targets, sMap, today);

      setSkippedRows(result.skipped);
      setExportCount(result.count);

      if (result.count > 0) {
        const ts = getTimestampString(today);
        downloadCsvNoBom(result.csv, `ヤマト送り状_${ts}.csv`);
      }

      // 「発送日を記録する」がONの場合、出力成功行の material_sent_at を今日に更新
      if (recordSentAt && result.count > 0) {
        // skipped の名前セットを使って除外: skipped には宛名なし/設定なしの行が含まれる
        // 正確にはgenerateNekoposCsvの内部ロジックと一致させる必要があるため、
        // 宛名なし/設定なし/住所なしの行を除いた targets を出力成功行と見なす
        const skippedNames = new Set(result.skipped.map((r) => r.name));
        // inquiry.student_name or guardian_name で判定: 同名が複数ある場合は全件対象にする
        // (安全側倒しで、設定不備が直っていれば問題ない)
        const todayStr = today.toISOString().slice(0, 10); // YYYY-MM-DD
        const updateTargets = targets.filter((q) => {
          const displayName = q.student_name ?? q.guardian_name ?? '—';
          return !skippedNames.has(displayName);
        });
        await Promise.all(
          updateTargets.map((q) =>
            updateInquiry(q.id, { material_sent_at: todayStr })
          )
        );
        // 更新後に一覧を再取得
        await fetchInquiries();
      }
    } catch (err) {
      setSkippedRows([{ name: '', reason: getUserErrorMessage(err, 'CSV出力に失敗しました') }]);
    } finally {
      setIsExporting(false);
    }
  }, [inquiries, checked, recordSentAt, getSelectedSchoolIds, fetchInquiries]);

  // ── 設定フォーム更新ハンドラ ──

  /** テキスト・number フィールドの汎用変更ハンドラ */
  const handleFormChange = useCallback(
    (schoolId: string, field: keyof SettingFormState, value: string) => {
      setFormStates((prev) => ({
        ...prev,
        [schoolId]: { ...prev[schoolId], [field]: value },
      }));
    },
    []
  );

  /** 面談受付曜日チェックボックスの変更ハンドラ（dow: 0=日〜6=土） */
  const handleDowChange = useCallback(
    (schoolId: string, dow: number, checked: boolean) => {
      setFormStates((prev) => {
        const prev_days = (prev[schoolId]?.booking_interview_days ?? [false, false, false, false, false, false, false]).slice();
        prev_days[dow] = checked;
        return {
          ...prev,
          [schoolId]: { ...prev[schoolId], booking_interview_days: prev_days },
        };
      });
    },
    []
  );

  const handleSaveSettings = useCallback(
    async (schoolId: string) => {
      setSavingIds((prev) => new Set(prev).add(schoolId));
      try {
        const form = formStates[schoolId];
        if (!form) return;
        // 曜日チェック（boolean[]）を数値配列に変換して booking_config を組み立てる
        const interviewDays = form.booking_interview_days
          .map((on, i) => (on ? i : -1))
          .filter((v) => v >= 0);
        const bookingConfig = {
          calendar_email:           form.booking_calendar_email || null,
          interview_days:           interviewDays,
          interview_start:          form.booking_interview_start,
          interview_end:            form.booking_interview_end,
          interview_duration_min:   parseInt(form.booking_interview_duration_min, 10) || 60,
          lead_hours:               parseInt(form.booking_lead_hours, 10) || 24,
          window_days:              parseInt(form.booking_window_days, 10) || 14,
        };

        const payload: InquirySchoolSettingsInsert = {
          school_id:            schoolId,
          hp_school_code:       form.hp_school_code || null,
          yamato_customer_code: form.yamato_customer_code || null,
          yamato_fare_code:     form.yamato_fare_code || null,
          sender_name:          form.sender_name || null,
          sender_tel:           form.sender_tel || null,
          sender_zip:           form.sender_zip || null,
          sender_address:       form.sender_address || null,
          mail_signature:       form.mail_signature || null,
          mail_reply_to:        form.mail_reply_to || null,
          slack_mention_id:     form.slack_mention_id || null,
          booking_config:       bookingConfig,
        };
        await upsertInquirySchoolSettings(payload);
        setSavedIds((prev) => new Set(prev).add(schoolId));
        // 3秒後に「保存しました」バッジを消す
        setTimeout(() => {
          setSavedIds((prev) => {
            const next = new Set(prev);
            next.delete(schoolId);
            return next;
          });
        }, 3000);
      } catch (err) {
        setSettingsError(getUserErrorMessage(err, '設定の保存に失敗しました'));
      } finally {
        setSavingIds((prev) => {
          const next = new Set(prev);
          next.delete(schoolId);
          return next;
        });
      }
    },
    [formStates]
  );

  // ── ローディング / アクセス制御 ──

  if (profile === null) {
    return (
      <AdminLayout headerTitle="資料発送（ネコポス）">
        <Loading className="min-h-[60vh]" />
      </AdminLayout>
    );
  }

  if (!isAdmin) {
    return (
      <AdminLayout>
        <AccessDenied message="発送管理は管理者のみ利用できます" />
      </AdminLayout>
    );
  }

  const schoolIds = getSelectedSchoolIds();

  // ── レンダリング ──

  return (
    <AdminLayout headerTitle="資料発送（ネコポス）">
      <div className="space-y-8">

        {/* ナビゲーション */}
        <div>
          <Link
            href="/admin/inquiries"
            className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text-heading transition-colors duration-150"
          >
            <ArrowLeft className="w-4 h-4" />
            問合せ一覧に戻る
          </Link>
        </div>

        {/* ═══════════════════════════════════════════
            セクション1: 発送対象
        ═══════════════════════════════════════════ */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <CardTitle className="flex items-center gap-2">
                <Truck className="w-5 h-5 text-text-muted" />
                発送対象
              </CardTitle>
              {/* 全未発送トグル */}
              <label className="flex items-center gap-2 cursor-pointer text-sm text-text-body select-none">
                <Checkbox
                  checked={showAllUnsent}
                  onCheckedChange={(v) => setShowAllUnsent(v)}
                />
                全ての未発送を表示（ステータス問わず）
              </label>
            </div>
          </CardHeader>
          <CardContent>
            {inquiriesError && (
              <div className="mb-4 p-3 bg-danger/10 border border-danger rounded-lg">
                <p className="text-sm text-danger">{inquiriesError}</p>
              </div>
            )}

            {isLoadingInquiries ? (
              <Loading size="md" />
            ) : inquiries.length === 0 ? (
              <p className="text-sm text-text-muted py-4 text-center">
                発送対象の問合せがありません。
              </p>
            ) : (
              <>
                {/* 全チェック操作 */}
                <div className="flex items-center gap-4 mb-3 text-sm text-text-muted">
                  <button
                    type="button"
                    onClick={() => {
                      const all: Record<string, boolean> = {};
                      inquiries.forEach((q) => { all[q.id] = true; });
                      setChecked(all);
                    }}
                    className="text-blue-600 hover:text-blue-800 transition-colors duration-150"
                  >
                    すべて選択
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const none: Record<string, boolean> = {};
                      inquiries.forEach((q) => { none[q.id] = false; });
                      setChecked(none);
                    }}
                    className="text-gray-500 hover:text-gray-700 transition-colors duration-150"
                  >
                    すべて解除
                  </button>
                  <span className="ml-auto">
                    {Object.values(checked).filter(Boolean).length} 件選択中 / {inquiries.length} 件
                  </span>
                </div>

                {/* 一覧テーブル */}
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="bg-surface-hover">
                        <th className="border-b border-border px-3 py-2.5 text-left font-medium text-text-heading w-8"></th>
                        <th className="border-b border-border px-3 py-2.5 text-left font-medium text-text-heading">受付日</th>
                        <th className="border-b border-border px-3 py-2.5 text-left font-medium text-text-heading">教室</th>
                        <th className="border-b border-border px-3 py-2.5 text-left font-medium text-text-heading">宛名</th>
                        <th className="border-b border-border px-3 py-2.5 text-left font-medium text-text-heading">住所</th>
                        <th className="border-b border-border px-3 py-2.5 text-left font-medium text-text-heading">電話</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inquiries.map((q) => {
                        const warn = hasWarning(q);
                        const addressee = getDisplayAddressee(q);
                        const address = [
                          q.address_pref ?? '',
                          q.address_detail ?? '',
                          q.address_building ?? '',
                        ]
                          .filter(Boolean)
                          .join('') || '—';

                        return (
                          <tr
                            key={q.id}
                            className={`transition-colors duration-100 ${
                              checked[q.id]
                                ? 'bg-surface-raised'
                                : 'bg-surface opacity-60'
                            }`}
                          >
                            {/* チェックボックス */}
                            <td className="border-b border-border px-3 py-2.5 text-center">
                              <Checkbox
                                checked={!!checked[q.id]}
                                onCheckedChange={(v) =>
                                  setChecked((prev) => ({ ...prev, [q.id]: v }))
                                }
                              />
                            </td>
                            {/* 受付日 */}
                            <td className="border-b border-border px-3 py-2.5 whitespace-nowrap text-text-body">
                              {formatInquiredAt(q.inquired_at)}
                            </td>
                            {/* 教室 */}
                            <td className="border-b border-border px-3 py-2.5 text-text-body">
                              {schoolsMap[q.school_id] ?? '—'}
                            </td>
                            {/* 宛名 */}
                            <td className="border-b border-border px-3 py-2.5">
                              <div className="flex items-center gap-1.5">
                                <span className="text-text-body">{addressee}</span>
                                {(!q.guardian_name && !q.student_name) && (
                                  <span className="inline-flex items-center gap-1 text-xs text-amber-600">
                                    <AlertTriangle className="w-3 h-3" />
                                    宛名なし
                                  </span>
                                )}
                              </div>
                              {/* 生徒名と保護者名の両方を補足表示 */}
                              <div className="text-xs text-text-muted mt-0.5">
                                {[q.student_name, q.guardian_name].filter(Boolean).join(' / ')}
                              </div>
                            </td>
                            {/* 住所 */}
                            <td className="border-b border-border px-3 py-2.5 text-text-body">
                              <div className="flex items-center gap-1.5">
                                <span>{address}</span>
                                {warn && address === '—' && (
                                  <span className="inline-flex items-center gap-1 text-xs text-amber-600">
                                    <AlertTriangle className="w-3 h-3" />
                                    住所なし
                                  </span>
                                )}
                              </div>
                              {q.postal_code && (
                                <div className="text-xs text-text-muted mt-0.5">
                                  〒{q.postal_code}
                                </div>
                              )}
                            </td>
                            {/* 電話 */}
                            <td className="border-b border-border px-3 py-2.5 whitespace-nowrap text-text-body">
                              {q.phone ?? '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {/* CSV出力エリア */}
            <div className="mt-5 flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer text-sm text-text-body select-none">
                <Checkbox
                  checked={recordSentAt}
                  onCheckedChange={(v) => setRecordSentAt(v)}
                />
                発送日を記録する（出力対象の material_sent_at を今日の日付で更新）
              </label>
              <Button
                variant="primary"
                size="md"
                onClick={handleExportCsv}
                isLoading={isExporting}
                disabled={
                  isExporting ||
                  Object.values(checked).filter(Boolean).length === 0
                }
                className="ml-auto"
              >
                <Truck className="w-4 h-4 mr-1.5" />
                ネコポスCSV出力
              </Button>
            </div>

            {/* 出力結果フィードバック */}
            {exportCount !== null && (
              <div className="mt-4 space-y-2">
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">
                  {exportCount > 0
                    ? `${exportCount} 件の送り状データをCSVに出力しました。`
                    : '出力対象の件数が0件でした。'}
                </div>
                {skippedRows.length > 0 && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm">
                    <p className="font-medium text-amber-800 mb-1">
                      以下の {skippedRows.length} 件は出力対象外となりました:
                    </p>
                    <ul className="list-disc list-inside space-y-0.5 text-amber-700">
                      {skippedRows.map((r, i) => (
                        <li key={i}>
                          {r.name ? `${r.name} — ` : ''}{r.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ═══════════════════════════════════════════
            セクション2: 教室別発送設定
        ═══════════════════════════════════════════ */}
        <div>
          <h2 className="text-lg font-bold text-text-heading mb-4">教室別発送設定</h2>

          {settingsError && (
            <div className="mb-4 p-3 bg-danger/10 border border-danger rounded-lg">
              <p className="text-sm text-danger">{settingsError}</p>
            </div>
          )}

          {schoolIds.length === 0 ? (
            <p className="text-sm text-text-muted">教室が選択されていません。</p>
          ) : (
            <div className="space-y-6">
              {schoolIds.map((schoolId) => {
                const form = formStates[schoolId] ?? emptyFormState();
                const schoolName = schoolsMap[schoolId] ?? schoolId;
                const isSaving = savingIds.has(schoolId);
                const isSaved = savedIds.has(schoolId);

                return (
                  <Card key={schoolId}>
                    <CardHeader>
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <CardTitle>{schoolName}</CardTitle>
                        {isSaved && (
                          <span className="text-xs text-green-600 font-medium">
                            保存しました
                          </span>
                        )}
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => handleSaveSettings(schoolId)}
                          isLoading={isSaving}
                          disabled={isSaving}
                        >
                          <Save className="w-4 h-4 mr-1.5" />
                          保存
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">

                        {/* ヤマト設定 */}
                        <Input
                          label="請求先顧客コード"
                          value={form.yamato_customer_code}
                          onChange={(e) =>
                            handleFormChange(schoolId, 'yamato_customer_code', e.target.value)
                          }
                          placeholder="例: 1234567890"
                          helpText="ヤマトB2クラウドの顧客コード（10桁）"
                        />
                        <Input
                          label="運賃管理番号"
                          value={form.yamato_fare_code}
                          onChange={(e) =>
                            handleFormChange(schoolId, 'yamato_fare_code', e.target.value)
                          }
                          placeholder="例: 01"
                          helpText="未入力時は 01 を使用"
                        />
                        <Input
                          label="HPスクールコード"
                          value={form.hp_school_code}
                          onChange={(e) =>
                            handleFormChange(schoolId, 'hp_school_code', e.target.value)
                          }
                          placeholder="例: sch001"
                          helpText="HP問合せフォームのスクールコード"
                        />

                        {/* 差出人情報 */}
                        <Input
                          label="差出人名"
                          value={form.sender_name}
                          onChange={(e) =>
                            handleFormChange(schoolId, 'sender_name', e.target.value)
                          }
                          placeholder="例: 〇〇学習塾 △△教室"
                          helpText="ご依頼主名として印字される"
                        />
                        <Input
                          label="差出人電話番号"
                          value={form.sender_tel}
                          onChange={(e) =>
                            handleFormChange(schoolId, 'sender_tel', e.target.value)
                          }
                          placeholder="例: 0312345678"
                          helpText="ハイフンなしで入力"
                        />
                        <Input
                          label="差出人郵便番号"
                          value={form.sender_zip}
                          onChange={(e) =>
                            handleFormChange(schoolId, 'sender_zip', e.target.value)
                          }
                          placeholder="例: 1234567"
                          helpText="ハイフンなしで入力"
                        />
                        <div className="sm:col-span-2 lg:col-span-3">
                          <Input
                            label="差出人住所"
                            value={form.sender_address}
                            onChange={(e) =>
                              handleFormChange(schoolId, 'sender_address', e.target.value)
                            }
                            placeholder="例: 東京都千代田区〇〇1-2-3"
                            helpText="ご依頼主住所として印字される（都道府県から記入）"
                          />
                        </div>

                        {/* メール設定 */}
                        <Input
                          label="返信先メールアドレス"
                          value={form.mail_reply_to}
                          onChange={(e) =>
                            handleFormChange(schoolId, 'mail_reply_to', e.target.value)
                          }
                          placeholder="例: school@example.com"
                          helpText="自動メールの Reply-To に使用"
                        />
                        <Input
                          label="Slackメンションコード"
                          value={form.slack_mention_id}
                          onChange={(e) =>
                            handleFormChange(schoolId, 'slack_mention_id', e.target.value)
                          }
                          placeholder="例: @U12345678"
                          helpText="問合せ通知でメンションするSlackユーザーID"
                        />
                        <div className="sm:col-span-2 lg:col-span-3">
                          <Textarea
                            label="メール署名"
                            value={form.mail_signature}
                            onChange={(e) =>
                              handleFormChange(schoolId, 'mail_signature', e.target.value)
                            }
                            rows={4}
                            placeholder="例: ─────────────&#10;〇〇学習塾 △△教室&#10;TEL: 03-xxxx-xxxx"
                            helpText="自動送信メールの末尾に付加される署名"
                          />
                        </div>
                      </div>

                      {/* ── 予約設定（面談） ── */}
                      <div className="mt-6 pt-5 border-t border-border">
                        <h3 className="text-sm font-semibold text-text-heading mb-1 flex items-center gap-1.5">
                          <CalendarDays className="w-4 h-4 text-text-muted" />
                          予約設定（面談）
                        </h3>
                        <p className="text-xs text-text-muted mb-4">
                          Googleカレンダー未連携でも、設定した受付枠で予約は受け付けられます（空き判定はカレンダー連携時のみ）。
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                          <div className="sm:col-span-2 lg:col-span-3">
                            <Input
                              label="カレンダーアカウント（Googleメール）"
                              value={form.booking_calendar_email}
                              onChange={(e) =>
                                handleFormChange(schoolId, 'booking_calendar_email', e.target.value)
                              }
                              placeholder="例: manager@example.com"
                              helpText="面談の空き判定・予定作成に使う教室長のGoogleアカウント。空なら教室メールで自動照合"
                            />
                          </div>

                          {/* 面談受付曜日 */}
                          <div className="sm:col-span-2 lg:col-span-3">
                            <label className="block text-sm font-medium text-text-heading mb-2">
                              面談受付曜日
                            </label>
                            <div className="flex flex-wrap gap-2">
                              {DOW_LABELS.map((label, dow) => {
                                const checked = form.booking_interview_days[dow] ?? false;
                                return (
                                  <label
                                    key={dow}
                                    className={`
                                      flex items-center justify-center w-10 h-10 rounded-lg border cursor-pointer text-sm font-medium transition-colors duration-150 select-none
                                      ${checked
                                        ? 'bg-[#1a1a1a] text-white border-[#1a1a1a]'
                                        : 'bg-white text-text-body border-border hover:border-[#1a1a1a]'
                                      }
                                    `}
                                  >
                                    <input
                                      type="checkbox"
                                      className="sr-only"
                                      checked={checked}
                                      onChange={(e) =>
                                        handleDowChange(schoolId, dow, e.target.checked)
                                      }
                                    />
                                    {label}
                                  </label>
                                );
                              })}
                            </div>
                          </div>

                          <Input
                            label="受付開始時刻"
                            type="time"
                            value={form.booking_interview_start}
                            onChange={(e) =>
                              handleFormChange(schoolId, 'booking_interview_start', e.target.value)
                            }
                            helpText="面談受付の開始時刻（例: 14:00）"
                          />
                          <Input
                            label="受付終了時刻"
                            type="time"
                            value={form.booking_interview_end}
                            onChange={(e) =>
                              handleFormChange(schoolId, 'booking_interview_end', e.target.value)
                            }
                            helpText="枠の終了がこの時刻を超えない（例: 21:00）"
                          />
                          <Input
                            label="1枠の分数"
                            type="number"
                            value={form.booking_interview_duration_min}
                            onChange={(e) =>
                              handleFormChange(schoolId, 'booking_interview_duration_min', e.target.value)
                            }
                            placeholder="例: 60"
                            helpText="1回の面談の長さ（分）"
                          />
                          <Input
                            label="受付開始リードタイム（時間）"
                            type="number"
                            value={form.booking_lead_hours}
                            onChange={(e) =>
                              handleFormChange(schoolId, 'booking_lead_hours', e.target.value)
                            }
                            placeholder="例: 24"
                            helpText="今から何時間後以降の枠から受け付けるか"
                          />
                          <Input
                            label="受付窓口日数"
                            type="number"
                            value={form.booking_window_days}
                            onChange={(e) =>
                              handleFormChange(schoolId, 'booking_window_days', e.target.value)
                            }
                            placeholder="例: 14"
                            helpText="今日から何日先までの枠を表示するか"
                          />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
