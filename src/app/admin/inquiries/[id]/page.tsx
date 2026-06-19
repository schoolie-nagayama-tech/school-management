'use client';

/**
 * 問合せ管理 — 詳細ページ。
 * admin / owner のみアクセス可。
 *
 * レイアウト（3層情報設計）:
 *   1. 顧客サマリーヘッダー（全幅）
 *   2. lg:grid-cols-3 の2カラム
 *      左（col-span-2）: ステータス・コンタクト・メール
 *      右（col-span-1）: 顧客詳細・面談予約・関連問合せ・HP原文・操作
 *
 * 操作の成功/失敗は sonner トーストで通知する。
 */

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AdminLayout } from '@/components/layouts';
import { Loading, Modal } from '@/components/ui';
import { Button } from '@/components/ui';
import { useAuth } from '@/contexts/AuthContext';
import AccessDenied from '@/components/AccessDenied';
import {
  getInquiry,
  updateInquiry,
  updateInquiryWithTimeline,
  softDeleteInquiry,
  getInquiryContacts,
  addInquiryContact,
} from '@/lib/api/inquiries';
import {
  getMailTemplates,
  getInquirySchoolSettings,
  buildMailVars,
  renderTemplate,
  sendInquiryMail,
  getMailLogs,
} from '@/lib/api/inquiryMail';
import { getSchool } from '@/lib/api/schools';
import { createStudent } from '@/lib/api/students';
import type {
  Inquiry,
  InquiryStatus,
  InquiryContact,
  InquiryMailTemplate,
  InquiryMailLog,
  InquirySchoolSettings,
  StudentInsert,
} from '@/types/database';
import { GRADE_LABELS } from '@/types/database';
import {
  STATUS_CONFIG,
  STATUS_OPTIONS,
  CONTACT_METHOD_LABELS,
  CONTACT_DIRECTION_LABELS,
  LOST_REASONS,
  formatDate,
  formatDateTime,
  MANUAL_CONTACT_METHODS,
  CONTACT_RESULT_OPTIONS,
  getInquiryDisplayName,
  type ManualContactMethod,
} from '../inquiryConstants';
import {
  ChevronLeft,
  Phone,
  Mail,
  ChevronDown,
  ChevronUp,
  Trash2,
  UserPlus,
  Send,
  CalendarDays,
  Copy,
  X,
  Package,
  ArrowRightLeft,
  MessageSquare,
  Building2,
  Circle,
  AlertTriangle,
} from 'lucide-react';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';
import { supabase } from '@/lib/supabase';

/** コンタクト履歴とメールログを統合したタイムラインアイテム */
type TimelineItem =
  | { kind: 'contact'; at: string; data: InquiryContact }
  | { kind: 'mail_log'; at: string; data: InquiryMailLog };

export default function InquiryDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const { profile } = useAuth();

  // ロールガード: admin / owner のみ
  const isAdmin = profile?.role === 'admin' || profile?.role === 'owner' || profile?.role === 'manager';

  const [inquiry, setInquiry] = useState<Inquiry | null>(null);
  const [contacts, setContacts] = useState<InquiryContact[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  // ---- ステータス変更フォーム ----
  const [editStatus, setEditStatus] = useState<InquiryStatus>('in_progress');
  const [editEnrolledAt, setEditEnrolledAt] = useState('');
  const [editWeeklyCount, setEditWeeklyCount] = useState('');
  const [editTrialAt, setEditTrialAt] = useState('');
  /** 失注理由。lost / trial_lost のときのみ保存・表示する */
  const [editLostReason, setEditLostReason] = useState('');
  const [editNote, setEditNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // ---- コンタクト追加フォーム ----
  const [contactMethod, setContactMethod] = useState<ManualContactMethod>('tel');
  const [contactDirection, setContactDirection] = useState<'outbound' | 'inbound'>('outbound');
  const [contactDate, setContactDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [contactResult, setContactResult] = useState('');
  const [contactNote, setContactNote] = useState('');
  const [isAddingContact, setIsAddingContact] = useState(false);

  // ---- HP原文の開閉 ----
  const [rawSourceOpen, setRawSourceOpen] = useState(false);

  // ---- 削除確認モーダル ----
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // ---- 生徒として登録 ----
  const [isEnrolling, setIsEnrolling] = useState(false);
  // 生徒名が未入力（保護者名で登録される）場合の確認モーダル
  const [enrollWarnOpen, setEnrollWarnOpen] = useState(false);

  // ---- 面談予約 ----
  /** POST /api/inquiries/[id]/booking-token の結果 URL */
  const [bookingUrl, setBookingUrl] = useState('');
  const [isFetchingBooking, setIsFetchingBooking] = useState(false);
  const [isCancellingBooking, setIsCancellingBooking] = useState(false);
  const [bookingCopied, setBookingCopied] = useState(false);

  // ---- メール送信 ----
  const [mailTemplates, setMailTemplates] = useState<InquiryMailTemplate[]>([]);
  const [mailSettings, setMailSettings] = useState<InquirySchoolSettings | null>(null);
  const [schoolName, setSchoolName] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState(''); // '' = テンプレ未選択
  const [mailSubject, setMailSubject] = useState('');
  const [mailBody, setMailBody] = useState('');
  const [isSendingMail, setIsSendingMail] = useState(false);
  const [mailLogs, setMailLogs] = useState<InquiryMailLog[]>([]);

  // ---- データ取得 ----
  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage('');
    try {
      const [inq, ctcs] = await Promise.all([
        getInquiry(id),
        getInquiryContacts(id),
      ]);
      if (!inq) {
        setErrorMessage('問合せが見つかりません');
        setIsLoading(false);
        return;
      }
      setInquiry(inq);
      setContacts(ctcs);

      // フォームの初期値をセット
      setEditStatus(inq.status);
      setEditEnrolledAt(inq.enrolled_at ? inq.enrolled_at.slice(0, 10) : '');
      setEditWeeklyCount(inq.weekly_count != null ? String(inq.weekly_count) : '');
      setEditTrialAt(inq.trial_at ? inq.trial_at.slice(0, 10) : '');
      setEditLostReason(inq.lost_reason ?? '');
      setEditNote(inq.note ?? '');

      // メール関連データを並行取得
      const [templates, settings, school, logs] = await Promise.all([
        getMailTemplates(inq.school_id),
        getInquirySchoolSettings(inq.school_id),
        getSchool(inq.school_id),
        getMailLogs(id),
      ]);
      setMailTemplates(templates);
      setMailSettings(settings);
      setSchoolName(school?.name ?? '');
      setMailLogs(logs);
    } catch (err) {
      setErrorMessage(getUserErrorMessage(err, 'データの取得に失敗しました'));
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ---- 面談予約リンク発行 ----
  const handleIssueBookingLink = async () => {
    if (!inquiry) return;
    setIsFetchingBooking(true);
    try {
      // 認証付き API のため Bearer トークンを付与（このアプリの既定パターン）
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/inquiries/${id}/booking-token`, {
        method: 'POST',
        headers: session ? { Authorization: `Bearer ${session.access_token}` } : {},
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? '発行に失敗しました');
      }
      const data = await res.json() as { token: string; url: string };
      setBookingUrl(data.url);
      toast.success('予約リンクを発行しました');
    } catch (err) {
      toast.error(getUserErrorMessage(err, '予約リンクの発行に失敗しました'));
    } finally {
      setIsFetchingBooking(false);
    }
  };

  // ---- 面談予約取消 ----
  const handleCancelBooking = async () => {
    if (!inquiry || !window.confirm('面談の予約を取り消しますか？カレンダーの予定も更新されます。')) return;
    setIsCancellingBooking(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/inquiries/${id}/booking-token`, {
        method: 'DELETE',
        headers: session ? { Authorization: `Bearer ${session.access_token}` } : {},
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? '取消に失敗しました');
      }
      setBookingUrl('');
      await fetchData();
      toast.success('予約を取り消しました');
    } catch (err) {
      toast.error(getUserErrorMessage(err, '予約の取消に失敗しました'));
    } finally {
      setIsCancellingBooking(false);
    }
  };

  // ---- 予約URLをクリップボードにコピー ----
  const handleCopyBookingUrl = async () => {
    if (!bookingUrl) return;
    try {
      await navigator.clipboard.writeText(bookingUrl);
      setBookingCopied(true);
      setTimeout(() => setBookingCopied(false), 2000);
    } catch {
      // フォールバック: テキストエリアを一時的に使ってコピー
      const el = document.createElement('textarea');
      el.value = bookingUrl;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setBookingCopied(true);
      setTimeout(() => setBookingCopied(false), 2000);
    }
  };

  // ---- テンプレート選択時: 変数置換して subject/body をセット ----
  const handleTemplateSelect = (templateId: string) => {
    setSelectedTemplateId(templateId);
    if (!templateId || !inquiry) {
      // テンプレ選択解除時はフィールドをクリア
      setMailSubject('');
      setMailBody('');
      return;
    }
    const tpl = mailTemplates.find((t) => t.id === templateId);
    if (!tpl) return;
    const vars = buildMailVars(inquiry, schoolName, mailSettings);
    setMailSubject(renderTemplate(tpl.subject, vars));
    setMailBody(renderTemplate(tpl.body, vars));
  };

  // ---- メール送信 ----
  const handleSendMail = async () => {
    if (!inquiry) return;
    setIsSendingMail(true);
    try {
      await sendInquiryMail({
        inquiry,
        subject: mailSubject,
        body: mailBody,
        templateId: selectedTemplateId || null,
      });
      toast.success('メールを送信しました');
      // 送信履歴を再取得
      const logs = await getMailLogs(id);
      setMailLogs(logs);
    } catch (err) {
      toast.error(getUserErrorMessage(err, '送信に失敗しました'));
    } finally {
      setIsSendingMail(false);
    }
  };

  // ---- ステータス保存 ----
  const handleSave = async () => {
    if (!inquiry) return;
    setIsSaving(true);
    try {
      const update: Parameters<typeof updateInquiryWithTimeline>[1] = {
        status: editStatus,
        note: editNote || null,
      };
      // 入会時は enrolled_at / weekly_count を保存
      if (editStatus === 'enrolled') {
        update.enrolled_at = editEnrolledAt || null;
        update.weekly_count = editWeeklyCount ? parseInt(editWeeklyCount, 10) : null;
      }
      // 体験フェーズ（体験待ち/体験済み/体験没）・入会時は trial_at も保存
      if (
        editStatus === 'trial_waiting' ||
        editStatus === 'trial_done' ||
        editStatus === 'trial_lost' ||
        editStatus === 'enrolled'
      ) {
        update.trial_at = editTrialAt || null;
      }
      // 失注理由: lost / trial_lost のときのみ保存。それ以外は null に戻す
      if (editStatus === 'lost' || editStatus === 'trial_lost') {
        update.lost_reason = editLostReason || null;
      } else {
        update.lost_reason = null;
      }
      // updateInquiryWithTimeline でステータス変更・資料発送を自動でタイムラインに積む
      await updateInquiryWithTimeline(inquiry, update);
      // contacts も再取得してタイムラインを最新化する
      await fetchData();
      toast.success('保存しました');
    } catch (err) {
      toast.error(getUserErrorMessage(err, '保存に失敗しました'));
    } finally {
      setIsSaving(false);
    }
  };

  // ---- コンタクト追加 ----
  const handleAddContact = async () => {
    if (!inquiry) return;
    setIsAddingContact(true);
    try {
      const contact = await addInquiryContact({
        inquiry_id: inquiry.id,
        school_id: inquiry.school_id,
        contacted_at: new Date(contactDate + 'T12:00:00+09:00').toISOString(),
        method: contactMethod,
        direction: contactDirection,
        result: contactResult || null,
        note: contactNote || null,
      });
      // 再取得するよりリストを先頭に追加する（contacted_at 降順になるよう）
      setContacts((prev) => [contact, ...prev]);

      // 資料送付コンタクトを記録したら、未設定なら資送日も同期する。
      // （資料未発送リマインドの解消・分析への反映のため。
      //   タイムラインの二重記録を避けるため updateInquiryWithTimeline は使わない）
      if (contactMethod === 'material_sent' && !inquiry.material_sent_at) {
        try {
          const updated = await updateInquiry(inquiry.id, { material_sent_at: contactDate });
          setInquiry(updated);
        } catch {
          // 同期失敗してもコンタクト記録は成功扱い
        }
      }

      setContactResult('');
      setContactNote('');
      toast.success('コンタクトを追加しました');
    } catch (err) {
      toast.error(getUserErrorMessage(err, 'コンタクトの追加に失敗しました'));
    } finally {
      setIsAddingContact(false);
    }
  };

  // ---- 削除 ----
  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await softDeleteInquiry(id);
      setDeleteModalOpen(false);
      toast.success('問合せを削除しました');
      router.push('/admin/inquiries');
    } catch (err) {
      setErrorMessage(getUserErrorMessage(err, '削除に失敗しました'));
      setDeleteModalOpen(false);
    } finally {
      setIsDeleting(false);
    }
  };

  // ---- 生徒として登録 ----
  // 入会確定時に問合せ情報から students レコードを作り、linked_student_id で紐付ける。
  // 学年テキスト（"中2"等）は GRADE_LABELS を逆引きして数値に変換する。
  // 氏名はスペースで姓名を分割（分割できない場合は全体を姓に入れる）。
  const handleEnrollAsStudent = useCallback(async () => {
    if (!inquiry) return;
    setIsEnrolling(true);
    try {
      // 学年テキスト → 数値（GRADE_LABELS は number→label なので逆引き）
      const gradeNum = inquiry.grade
        ? Number(
            Object.entries(GRADE_LABELS).find(([, label]) => label === inquiry.grade)?.[0]
          )
        : NaN;

      // 氏名・カナをスペースで姓名に分割
      const splitName = (full: string | null): [string, string] => {
        if (!full) return ['', ''];
        const parts = full.trim().split(/\s+/);
        return parts.length >= 2 ? [parts[0], parts.slice(1).join(' ')] : [full.trim(), ''];
      };
      const [lastName, firstName] = splitName(inquiry.student_name);
      const [lastKana, firstKana] = splitName(inquiry.student_name_kana);

      const studentData: StudentInsert = {
        school_id: inquiry.school_id,
        last_name: lastName || inquiry.guardian_name || '（未入力）',
        first_name: firstName,
        last_name_kana: lastKana,
        first_name_kana: firstKana,
        grade: Number.isFinite(gradeNum) ? gradeNum : 7, // 不明時は中1を仮置き（詳細で修正）
        status: 'active',
        school_name: inquiry.school_name ?? null,
      };

      const created = await createStudent(studentData);

      // 問合せ側を入会ステータスにして生徒と紐付け
      const updated = await updateInquiry(inquiry.id, {
        linked_student_id: created.id,
        status: 'enrolled',
        enrolled_at: inquiry.enrolled_at ?? new Date().toISOString().slice(0, 10),
      });
      setInquiry(updated);
      setEditStatus(updated.status);
      toast.success('生徒として登録しました');
      // 作成した生徒の詳細へ
      router.push(`/students/${created.id}`);
    } catch (err) {
      toast.error(getUserErrorMessage(err, '生徒登録に失敗しました'));
    } finally {
      setIsEnrolling(false);
      setEnrollWarnOpen(false);
    }
  }, [inquiry, router]);

  // ---- 生徒として登録ボタンのクリック ----
  // 生徒名が未入力だと保護者名で生徒が作られてしまうため、その場合は確認モーダルを挟む。
  const handleEnrollClick = useCallback(() => {
    if (!inquiry) return;
    if (!inquiry.student_name?.trim()) {
      setEnrollWarnOpen(true);
      return;
    }
    handleEnrollAsStudent();
  }, [inquiry, handleEnrollAsStudent]);

  // ---- ローディング / 権限 ----
  if (profile === null) {
    return (
      <AdminLayout headerTitle="問合せ詳細">
        <Loading className="min-h-[60vh]" />
      </AdminLayout>
    );
  }
  if (!isAdmin) {
    return (
      <AdminLayout>
        <AccessDenied message="問合せ管理は管理者のみ利用できます" />
      </AdminLayout>
    );
  }

  return (
    <AdminLayout headerTitle="問合せ詳細">
      <div className="max-w-6xl">

        {/* 戻るリンク */}
        <Link
          href="/admin/inquiries"
          className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text-heading mb-6 transition-colors duration-150"
        >
          <ChevronLeft className="w-4 h-4" />
          問合せ一覧に戻る
        </Link>

        {errorMessage && (
          <div className="mb-4 p-4 bg-danger/20 border border-danger rounded-lg">
            <p className="text-sm text-danger">{errorMessage}</p>
          </div>
        )}

        {isLoading ? (
          <Loading size="md" />
        ) : !inquiry ? null : (
          <div className="space-y-6">

            {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                1. 顧客サマリーヘッダー（全幅）
                ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
            <section className="bg-surface-raised border border-border rounded-xl p-6">

              {/* 氏名 + ステータス + 学年 */}
              <div className="flex items-start gap-3 flex-wrap mb-4">
                <h1 className="text-xl font-bold text-text-heading">
                  {getInquiryDisplayName(inquiry).name}
                </h1>
                {/* 生徒名が無く保護者名を表示している場合は明示する */}
                {getInquiryDisplayName(inquiry).isGuardianFallback && (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-medium shrink-0 bg-amber-100 text-amber-700 border border-amber-200">
                    保護者名（生徒名 未入力）
                  </span>
                )}
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium shrink-0 ${STATUS_CONFIG[inquiry.status].className}`}>
                  {STATUS_CONFIG[inquiry.status].label}
                </span>
                {inquiry.grade && (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-surface-hover text-text-muted border border-border shrink-0">
                    {inquiry.grade}
                  </span>
                )}
              </div>

              {/* 連絡先ボタン */}
              {(inquiry.phone || inquiry.email) && (
                <div className="flex gap-2 flex-wrap mb-4">
                  {inquiry.phone && (
                    <a href={`tel:${inquiry.phone}`}>
                      <Button variant="outline" size="sm">
                        <Phone className="w-4 h-4 mr-1.5" />
                        {inquiry.phone}
                      </Button>
                    </a>
                  )}
                  {inquiry.email && (
                    <a href={`mailto:${inquiry.email}`}>
                      <Button variant="outline" size="sm">
                        <Mail className="w-4 h-4 mr-1.5" />
                        {inquiry.email}
                      </Button>
                    </a>
                  )}
                </div>
              )}

              {/* メタ情報チップ列 */}
              <div className="flex flex-wrap gap-2 text-xs text-text-muted mb-4">
                {inquiry.media && (
                  <span className="px-2 py-0.5 bg-surface-hover border border-border rounded-full">
                    {inquiry.media}
                  </span>
                )}
                {inquiry.request_type && (
                  <span className="px-2 py-0.5 bg-surface-hover border border-border rounded-full">
                    {inquiry.request_type}
                  </span>
                )}
                <span className="px-2 py-0.5 bg-surface-hover border border-border rounded-full">
                  受付: {formatDate(inquiry.inquired_at)}
                </span>
              </div>

              {/* 問合せ内容（要望）引用表示 */}
              {inquiry.initial_message && (
                <blockquote className="border-l-4 border-border pl-4 text-sm text-text-body italic line-clamp-3">
                  {inquiry.initial_message}
                </blockquote>
              )}

              {/* 失注理由 */}
              {(inquiry.status === 'lost' || inquiry.status === 'trial_lost') && inquiry.lost_reason && (
                <p className="mt-3 text-xs text-text-muted">
                  失注理由: {inquiry.lost_reason}
                </p>
              )}
            </section>

            {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                2 & 3. 2カラムグリッド
                左(col-span-2): やること
                右(col-span-1): 参照
                ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

              {/* ────────────────────────────────
                  左カラム: ステータス・コンタクト・メール
                  ──────────────────────────────── */}
              <div className="lg:col-span-2 space-y-6">

                {/* ── 追客タイムライン（ステータス+コンタクト履歴の統合ビュー） ── */}
                <section className="bg-surface-raised border border-border rounded-xl p-6">
                  <h2 className="text-base font-bold text-text-heading mb-4">追客タイムライン</h2>

                  {/* ── 現状ブロック（ステータス・追客情報） ── */}
                  <div className="mb-6 pb-6 border-b border-border">
                    <h3 className="text-sm font-semibold text-text-heading mb-3">現状</h3>
                    <div className="space-y-3">

                      {/* ステータス選択 */}
                      <div>
                        <label className="block text-xs font-medium text-text-heading mb-1">ステータス</label>
                        <select
                          value={editStatus}
                          onChange={(e) => setEditStatus(e.target.value as InquiryStatus)}
                          className="w-full sm:w-48 px-2 py-1.5 border border-border rounded-lg text-sm bg-surface-raised text-text-body focus:outline-none focus:ring-2 focus:ring-primary"
                        >
                          {STATUS_OPTIONS.filter((o) => o.value !== 'all').map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </div>

                      {/* 入会時: 入会日・週回数 */}
                      {(editStatus === 'enrolled') && (
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-medium text-text-heading mb-1">入会日</label>
                            <input
                              type="date"
                              value={editEnrolledAt}
                              onChange={(e) => setEditEnrolledAt(e.target.value)}
                              className="w-full px-2 py-1.5 border border-border rounded-lg text-sm bg-surface-raised text-text-body focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-text-heading mb-1">週回数</label>
                            <input
                              type="number"
                              min={1}
                              max={10}
                              value={editWeeklyCount}
                              onChange={(e) => setEditWeeklyCount(e.target.value)}
                              placeholder="例: 2"
                              className="w-full px-2 py-1.5 border border-border rounded-lg text-sm bg-surface-raised text-text-body focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                          </div>
                        </div>
                      )}

                      {/* 体験待ち / 体験済み / 体験没 / 入会: 体験日 */}
                      {(editStatus === 'trial_waiting' || editStatus === 'trial_done' || editStatus === 'trial_lost' || editStatus === 'enrolled') && (
                        <div>
                          <label className="block text-xs font-medium text-text-heading mb-1">体験日</label>
                          <input
                            type="date"
                            value={editTrialAt}
                            onChange={(e) => setEditTrialAt(e.target.value)}
                            className="w-full sm:w-48 px-2 py-1.5 border border-border rounded-lg text-sm bg-surface-raised text-text-body focus:outline-none focus:ring-2 focus:ring-primary"
                          />
                        </div>
                      )}

                      {/* 没 / 体験没: 失注理由 */}
                      {(editStatus === 'lost' || editStatus === 'trial_lost') && (
                        <div>
                          <label className="block text-xs font-medium text-text-heading mb-1">失注理由</label>
                          <select
                            value={editLostReason}
                            onChange={(e) => setEditLostReason(e.target.value)}
                            className="w-full sm:w-56 px-2 py-1.5 border border-border rounded-lg text-sm bg-surface-raised text-text-body focus:outline-none focus:ring-2 focus:ring-primary"
                          >
                            <option value="">— 未選択 —</option>
                            {LOST_REASONS.map((r) => (
                              <option key={r} value={r}>{r}</option>
                            ))}
                          </select>
                        </div>
                      )}

                      {/* メモ */}
                      <div>
                        <label className="block text-xs font-medium text-text-heading mb-1">メモ</label>
                        <textarea
                          value={editNote}
                          onChange={(e) => setEditNote(e.target.value)}
                          rows={3}
                          className="w-full px-2 py-1.5 border border-border rounded-lg text-sm bg-surface-raised text-text-body focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                          placeholder="内部メモ（保護者には見えません）"
                        />
                      </div>

                      <div className="flex gap-2">
                        <Button onClick={handleSave} isLoading={isSaving} size="sm">
                          保存
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* ── タイムライン（contacts + mail_logs を at 降順に統合） ── */}
                  {(() => {
                    // contacts と mailLogs を統合して contacted_at / sent_at で降順ソート
                    const items: TimelineItem[] = [
                      ...contacts.map((c): TimelineItem => ({ kind: 'contact', at: c.contacted_at, data: c })),
                      ...mailLogs.map((m): TimelineItem => ({ kind: 'mail_log', at: m.sent_at, data: m })),
                    ].sort((a, b) => b.at.localeCompare(a.at));

                    if (items.length === 0) {
                      return <p className="text-sm text-text-muted mb-4">履歴はありません</p>;
                    }

                    return (
                      <div className="space-y-3 mb-6">
                        {items.map((item) => {
                          if (item.kind === 'contact') {
                            const c = item.data;
                            // アイコン選択（method 別）
                            const Icon = {
                              tel:           Phone,
                              email:         Mail,
                              sms:           MessageSquare,
                              visit:         Building2,
                              other:         Circle,
                              material_sent: Package,
                              status_change: ArrowRightLeft,
                            }[c.method] ?? Circle;

                            // 電話の result によるバッジ色
                            const resultBadgeClass = (() => {
                              if (c.method !== 'tel' || !c.result) return 'bg-surface-hover text-text-body';
                              if (c.result === 'つながった') return 'bg-green-100 text-green-800';
                              if (c.result === '拒否' || c.result === '番号違い') return 'bg-red-100 text-red-700';
                              if (c.result === '不在' || c.result === '留守電') return 'bg-yellow-100 text-yellow-700';
                              if (c.result === '折返し待ち') return 'bg-blue-100 text-blue-700';
                              return 'bg-surface-hover text-text-body';
                            })();

                            // direction は status_change / material_sent では表示しない
                            const showDirection = c.direction && c.method !== 'status_change' && c.method !== 'material_sent';

                            return (
                              <div key={`c-${c.id}`} className="flex gap-3">
                                <div className="flex flex-col items-center">
                                  <div className="w-7 h-7 rounded-full bg-surface-hover border border-border flex items-center justify-center shrink-0">
                                    <Icon className="w-3.5 h-3.5 text-text-muted" />
                                  </div>
                                  <div className="flex-1 w-px bg-border" />
                                </div>
                                <div className="pb-3 min-w-0 flex-1">
                                  <div className="flex items-center gap-2 flex-wrap text-xs text-text-muted mb-0.5">
                                    <span className="font-medium text-text-body">{CONTACT_METHOD_LABELS[c.method] ?? c.method}</span>
                                    {showDirection && (
                                      <span>{CONTACT_DIRECTION_LABELS[c.direction!] ?? c.direction}</span>
                                    )}
                                    <span>{formatDate(c.contacted_at)}</span>
                                    {c.result && (
                                      <span className={`px-1.5 py-0.5 rounded font-medium ${resultBadgeClass}`}>{c.result}</span>
                                    )}
                                  </div>
                                  {c.note && (
                                    <p className="text-sm text-text-body whitespace-pre-wrap">{c.note}</p>
                                  )}
                                </div>
                              </div>
                            );
                          } else {
                            // mail_log
                            const m = item.data;
                            return (
                              <div key={`m-${m.id}`} className="flex gap-3">
                                <div className="flex flex-col items-center">
                                  <div className="w-7 h-7 rounded-full bg-surface-hover border border-border flex items-center justify-center shrink-0">
                                    <Send className="w-3.5 h-3.5 text-text-muted" />
                                  </div>
                                  <div className="flex-1 w-px bg-border" />
                                </div>
                                <div className="pb-3 min-w-0 flex-1">
                                  <div className="flex items-center gap-2 flex-wrap text-xs text-text-muted mb-0.5">
                                    <span className="font-medium text-text-body">メール送信</span>
                                    <span>{formatDateTime(m.sent_at)}</span>
                                    <span className={`px-1.5 py-0.5 rounded font-medium ${m.status === 'sent' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-700'}`}>
                                      {m.status === 'sent' ? '送信済み' : '失敗'}
                                    </span>
                                    {m.opened_at && (
                                      <span className="px-1.5 py-0.5 rounded font-medium bg-teal-100 text-teal-800">開封済み</span>
                                    )}
                                  </div>
                                  {m.subject && (
                                    <p className="text-xs text-text-muted truncate">{m.subject}</p>
                                  )}
                                </div>
                              </div>
                            );
                          }
                        })}
                      </div>
                    );
                  })()}

                  {/* ── コンタクト追加フォーム ── */}
                  <div className="border border-border rounded-lg p-4 bg-surface-hover">
                    <h3 className="text-sm font-medium text-text-heading mb-3">コンタクトを追加</h3>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                      <div>
                        <label className="block text-xs text-text-muted mb-1">方法</label>
                        <select
                          value={contactMethod}
                          onChange={(e) => {
                            const m = e.target.value as ManualContactMethod;
                            setContactMethod(m);
                            // method が変わったら result をリセット
                            setContactResult('');
                          }}
                          className="w-full px-2 py-1.5 border border-border rounded-lg text-sm bg-surface-raised focus:outline-none focus:ring-2 focus:ring-primary"
                        >
                          {MANUAL_CONTACT_METHODS.map((m) => (
                            <option key={m} value={m}>{CONTACT_METHOD_LABELS[m]}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-text-muted mb-1">方向</label>
                        <select
                          value={contactDirection}
                          onChange={(e) => setContactDirection(e.target.value as typeof contactDirection)}
                          className="w-full px-2 py-1.5 border border-border rounded-lg text-sm bg-surface-raised focus:outline-none focus:ring-2 focus:ring-primary"
                        >
                          <option value="outbound">発信</option>
                          <option value="inbound">着信・受信</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-text-muted mb-1">日付</label>
                        <input
                          type="date"
                          value={contactDate}
                          onChange={(e) => setContactDate(e.target.value)}
                          className="w-full px-2 py-1.5 border border-border rounded-lg text-sm bg-surface-raised focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-text-muted mb-1">結果</label>
                        {/* method に選択肢がある場合は datalist で候補表示、自由記述も可 */}
                        <input
                          type="text"
                          list={`result-options-${contactMethod}`}
                          value={contactResult}
                          onChange={(e) => setContactResult(e.target.value)}
                          placeholder={CONTACT_RESULT_OPTIONS[contactMethod].length > 0 ? '選択または入力' : '例: 折り返し待ち'}
                          className="w-full px-2 py-1.5 border border-border rounded-lg text-sm bg-surface-raised focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                        {CONTACT_RESULT_OPTIONS[contactMethod].length > 0 && (
                          <datalist id={`result-options-${contactMethod}`}>
                            {CONTACT_RESULT_OPTIONS[contactMethod].map((opt) => (
                              <option key={opt} value={opt} />
                            ))}
                          </datalist>
                        )}
                      </div>
                    </div>
                    <div className="mb-3">
                      <label className="block text-xs text-text-muted mb-1">メモ</label>
                      <textarea
                        value={contactNote}
                        onChange={(e) => setContactNote(e.target.value)}
                        rows={2}
                        className="w-full px-2 py-1.5 border border-border rounded-lg text-sm bg-surface-raised focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                      />
                    </div>
                    <Button onClick={handleAddContact} isLoading={isAddingContact} size="sm" variant="secondary">
                      追加
                    </Button>
                  </div>
                </section>

                {/* ── メール送信 ── */}
                <section className="bg-surface-raised border border-border rounded-xl p-6">
                  <h2 className="text-base font-bold text-text-heading mb-4">メール送信</h2>

                  {!inquiry.email ? (
                    // メールアドレス未登録時はフォームを出さない
                    <p className="text-sm text-text-muted">メールアドレスが登録されていません</p>
                  ) : (
                    <div className="space-y-4">
                      {/* 宛先表示 */}
                      <p className="text-sm text-text-muted">
                        宛先:{' '}
                        <a href={`mailto:${inquiry.email}`} className="text-blue-700 hover:underline">
                          {inquiry.email}
                        </a>
                      </p>

                      {/* テンプレート選択 */}
                      <div>
                        <label className="block text-xs font-medium text-text-heading mb-1">
                          テンプレート（任意）
                        </label>
                        <select
                          value={selectedTemplateId}
                          onChange={(e) => handleTemplateSelect(e.target.value)}
                          className="w-full sm:w-80 px-2 py-1.5 border border-border rounded-lg text-sm bg-surface-raised text-text-body focus:outline-none focus:ring-2 focus:ring-primary"
                        >
                          <option value="">— テンプレートを選択 —</option>
                          {mailTemplates.map((t) => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                          ))}
                        </select>
                      </div>

                      {/* 件名 */}
                      <div>
                        <label className="block text-xs font-medium text-text-heading mb-1">件名</label>
                        <input
                          type="text"
                          value={mailSubject}
                          onChange={(e) => setMailSubject(e.target.value)}
                          placeholder="件名を入力"
                          className="w-full px-2 py-1.5 border border-border rounded-lg text-sm bg-surface-raised text-text-body focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                      </div>

                      {/* 本文 */}
                      <div>
                        <label className="block text-xs font-medium text-text-heading mb-1">本文</label>
                        <textarea
                          value={mailBody}
                          onChange={(e) => setMailBody(e.target.value)}
                          rows={6}
                          placeholder="本文を入力"
                          className="w-full px-2 py-1.5 border border-border rounded-lg text-sm bg-surface-raised text-text-body focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                        />
                      </div>

                      {/* 送信ボタン */}
                      <Button
                        onClick={handleSendMail}
                        isLoading={isSendingMail}
                        disabled={isSendingMail || !mailSubject.trim() || !mailBody.trim()}
                        size="sm"
                      >
                        <Send className="w-4 h-4 mr-1.5" />
                        送信
                      </Button>
                    </div>
                  )}

                  {/* 送信履歴 */}
                  {mailLogs.length > 0 && (
                    <div className="mt-6 border-t border-border pt-4">
                      <h3 className="text-sm font-medium text-text-heading mb-3">送信履歴</h3>
                      <div className="space-y-2">
                        {mailLogs.map((log) => (
                          <div key={log.id} className="flex items-center gap-3 flex-wrap text-xs text-text-muted">
                            <span>{formatDateTime(log.sent_at)}</span>
                            {/* 送信ステータスバッジ */}
                            <span className={`px-1.5 py-0.5 rounded-full font-medium ${log.status === 'sent' ? 'bg-green-100 text-green-800' : 'bg-danger/20 text-danger'}`}>
                              {log.status === 'sent' ? '送信済み' : '失敗'}
                            </span>
                            {/* 開封バッジ: opened_at / clicked_at があれば表示。どちらも無く sent なら「未開封」 */}
                            {log.opened_at ? (
                              <span className="px-1.5 py-0.5 rounded-full font-medium bg-teal-100 text-teal-800">
                                開封済み {formatDateTime(log.opened_at).replace(/^\d{4}\//, '').slice(0, 11)}
                              </span>
                            ) : log.status === 'sent' ? (
                              <span className="px-1.5 py-0.5 rounded-full font-medium bg-gray-100 text-gray-500">
                                未開封
                              </span>
                            ) : null}
                            {log.clicked_at && (
                              <span className="px-1.5 py-0.5 rounded-full font-medium bg-blue-100 text-blue-800">
                                リンククリック
                              </span>
                            )}
                            {log.subject && (
                              <span className="truncate max-w-xs text-text-body">{log.subject}</span>
                            )}
                          </div>
                        ))}
                      </div>
                      {/* Webhook 設定が必要な旨の注記 */}
                      <p className="text-xs text-text-faint mt-3">
                        開封情報は Resend Webhook 設定後に記録されます
                      </p>
                    </div>
                  )}
                </section>

              </div>{/* /左カラム */}

              {/* ────────────────────────────────
                  右カラム: 参照情報
                  ──────────────────────────────── */}
              <div className="lg:col-span-1 space-y-6">

                {/* ── 顧客情報 ── */}
                <section className="bg-surface-raised border border-border rounded-xl p-5">
                  <h2 className="text-base font-bold text-text-heading mb-3">顧客情報</h2>
                  <dl className="space-y-2 text-sm">
                    <DetailRow label="保護者氏名" value={inquiry.guardian_name} />
                    <DetailRow label="保護者カナ" value={inquiry.guardian_name_kana ?? null} />
                    <DetailRow label="生徒カナ" value={inquiry.student_name_kana} />
                    <DetailRow label="続柄" value={inquiry.relationship} />
                    <DetailRow label="性別" value={inquiry.gender} />

                    {/* 住所（複数フィールドを連結して表示） */}
                    <div>
                      <dt className="text-xs text-text-muted">住所</dt>
                      <dd className="text-text-heading break-all">
                        {[
                          inquiry.postal_code ? `〒${inquiry.postal_code}` : null,
                          inquiry.address_pref,
                          inquiry.address_detail,
                          inquiry.address_building,
                        ].filter(Boolean).join(' ') || '—'}
                      </dd>
                    </div>

                    <DetailRow label="在籍校" value={inquiry.school_name} />
                    <DetailRow label="通塾目的" value={inquiry.purpose} />
                    <DetailRow label="希望科目" value={inquiry.preferred_subjects} />
                    <DetailRow label="通塾経験" value={inquiry.juku_experience} />
                    <DetailRow label="デバイス" value={inquiry.device} />

                    {/* 電話（テキスト表示） */}
                    <div>
                      <dt className="text-xs text-text-muted">電話</dt>
                      <dd className="text-text-heading">{inquiry.phone || '—'}</dd>
                    </div>

                    {/* メール（テキスト表示） */}
                    <div>
                      <dt className="text-xs text-text-muted">メールアドレス</dt>
                      <dd className="text-text-heading break-all">{inquiry.email || '—'}</dd>
                    </div>

                    <DetailRow label="問合せ経路" value={inquiry.channel} />
                    <DetailRow label="HP問合せNO" value={inquiry.hp_inquiry_no} />
                  </dl>
                </section>

                {/* ── 面談予約 ── */}
                <section className="bg-surface-raised border border-border rounded-xl p-5">
                  <h2 className="text-base font-bold text-text-heading mb-3 flex items-center gap-2">
                    <CalendarDays className="w-4 h-4 text-text-muted" />
                    面談予約
                  </h2>

                  {/* 予約済みのケース */}
                  {inquiry.interview_at ? (
                    <div className="space-y-3">
                      <p className="text-sm text-text-body">
                        予約済み:{' '}
                        <span className="font-semibold text-text-heading">
                          {formatDateTime(inquiry.interview_at)}
                        </span>
                      </p>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={handleCancelBooking}
                        isLoading={isCancellingBooking}
                        disabled={isCancellingBooking}
                      >
                        <X className="w-4 h-4 mr-1.5" />
                        予約を取消
                      </Button>
                    </div>
                  ) : bookingUrl ? (
                    /* リンク発行済み・URLを表示 */
                    <div className="space-y-3">
                      <p className="text-xs text-text-muted">このURLを保護者に送ってください</p>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          readOnly
                          value={bookingUrl}
                          className="flex-1 min-w-0 px-2 py-1.5 border border-border rounded-lg text-xs bg-surface-hover text-text-body focus:outline-none"
                          onClick={(e) => (e.target as HTMLInputElement).select()}
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleCopyBookingUrl}
                        >
                          <Copy className="w-4 h-4 mr-1" />
                          {bookingCopied ? 'コピー済み' : 'コピー'}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    /* 未発行 */
                    <div className="space-y-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleIssueBookingLink}
                        isLoading={isFetchingBooking}
                        disabled={isFetchingBooking}
                      >
                        <CalendarDays className="w-4 h-4 mr-1.5" />
                        面談予約リンクを発行
                      </Button>
                      <p className="text-xs text-text-muted">
                        発行したURLを保護者にお送りください。14日間有効です。
                      </p>
                    </div>
                  )}
                </section>

                {/* ── HP原文（raw_source）折りたたみ ── */}
                {inquiry.raw_source && Object.keys(inquiry.raw_source).length > 0 && (
                  <section className="bg-surface-raised border border-border rounded-xl overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setRawSourceOpen((v) => !v)}
                      className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-surface-hover transition-colors duration-150"
                    >
                      <span className="text-sm font-medium text-text-heading">HP原文（全項目）</span>
                      {rawSourceOpen ? (
                        <ChevronUp className="w-4 h-4 text-text-muted" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-text-muted" />
                      )}
                    </button>
                    {rawSourceOpen && (
                      <div className="px-5 pb-5 overflow-x-auto">
                        <table className="w-full text-xs border-collapse border border-border">
                          <thead>
                            <tr className="bg-surface-hover">
                              <th className="border border-border px-3 py-2 text-left font-medium text-text-heading w-1/3">項目</th>
                              <th className="border border-border px-3 py-2 text-left font-medium text-text-heading">値</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Object.entries(inquiry.raw_source).map(([k, v]) => (
                              <tr key={k} className="even:bg-surface-hover/50">
                                <td className="border border-border px-3 py-1.5 text-text-muted">{k}</td>
                                <td className="border border-border px-3 py-1.5 text-text-body break-all">
                                  {String(v ?? '')}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                )}

                {/* ── 操作カード（生徒登録・削除） ── */}
                <section className="bg-surface-raised border border-border rounded-xl p-5">
                  <h2 className="text-base font-bold text-text-heading mb-3">操作</h2>
                  <div className="space-y-2">

                    {/* 生徒として登録（紐付け済みなら生徒詳細へのリンクを出す） */}
                    {inquiry.linked_student_id ? (
                      <Link href={`/students/${inquiry.linked_student_id}`}>
                        <Button variant="outline" size="sm" className="w-full justify-start">
                          <UserPlus className="w-4 h-4 mr-1.5" />
                          紐付け済みの生徒を開く
                        </Button>
                      </Link>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleEnrollClick}
                        disabled={isEnrolling}
                        className="w-full justify-start"
                      >
                        <UserPlus className="w-4 h-4 mr-1.5" />
                        {isEnrolling ? '登録中...' : '生徒として登録'}
                      </Button>
                    )}

                    {/* 論理削除 */}
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => setDeleteModalOpen(true)}
                      className="w-full justify-start"
                    >
                      <Trash2 className="w-4 h-4 mr-1.5" />
                      削除
                    </Button>
                  </div>
                </section>

              </div>{/* /右カラム */}
            </div>{/* /grid */}

          </div>
        )}
      </div>

      {/* 削除確認モーダル */}
      <Modal
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        title="問合せの削除"
        size="sm"
      >
        <p className="text-sm text-text-body mb-6">
          この問合せを削除します。削除後は一覧に表示されなくなります（論理削除）。よろしいですか？
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setDeleteModalOpen(false)}>
            キャンセル
          </Button>
          <Button variant="danger" size="sm" isLoading={isDeleting} onClick={handleDelete}>
            削除する
          </Button>
        </div>
      </Modal>

      {/* 生徒名 未入力での登録 確認モーダル
          生徒名が空のまま登録すると保護者名で生徒が作られてしまうため警告する */}
      <Modal
        isOpen={enrollWarnOpen}
        onClose={() => setEnrollWarnOpen(false)}
        title="生徒名が未入力です"
        size="sm"
      >
        <div className="mb-6 space-y-3">
          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-sm text-amber-800">
              この問合せには生徒名が入力されていません。このまま登録すると
              {inquiry?.guardian_name ? `保護者名「${inquiry.guardian_name}」` : '保護者名'}
              が生徒の氏名として登録されます。
            </p>
          </div>
          <p className="text-sm text-text-body">
            生徒の本名が分かる場合は、先に問合せの「生徒名」を入力してから登録することをおすすめします。
            このまま保護者名で登録して、あとで生徒詳細から修正することもできます。
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setEnrollWarnOpen(false)}>
            キャンセル
          </Button>
          <Button variant="outline" size="sm" isLoading={isEnrolling} onClick={handleEnrollAsStudent}>
            このまま登録する
          </Button>
        </div>
      </Modal>
    </AdminLayout>
  );
}

/** キー:値ペアをコンパクトに表示するヘルパー（右カラムの顧客情報用） */
function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="text-text-heading">{value}</dd>
    </div>
  );
}
