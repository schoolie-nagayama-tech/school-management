'use client';

/**
 * 問合せ管理 — 詳細ページ。
 * admin / owner のみアクセス可。
 * - ステータス変更（enrolled 時に enrolled_at / weekly_count を表示）
 * - コンタクト履歴の閲覧・追加
 * - メール送信（テンプレート選択 or 手書き）と送信履歴
 * - tel: / mailto: リンク
 * - HP 原文（raw_source）折りたたみ
 * - 生徒として登録（氏名・学年をクエリパラメータでプリフィル）
 * - 論理削除（確認ダイアログ付き）
 */

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { AdminLayout } from '@/components/layouts';
import { Loading, Modal } from '@/components/ui';
import { Button } from '@/components/ui';
import { useAuth } from '@/contexts/AuthContext';
import AccessDenied from '@/components/AccessDenied';
import {
  getInquiry,
  updateInquiry,
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
  formatDate,
  formatDateTime,
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
} from 'lucide-react';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';

export default function InquiryDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const { profile } = useAuth();

  // ロールガード: admin / owner のみ
  const isAdmin = profile?.role === 'admin' || profile?.role === 'owner';

  const [inquiry, setInquiry] = useState<Inquiry | null>(null);
  const [contacts, setContacts] = useState<InquiryContact[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  // ---- ステータス変更フォーム ----
  const [editStatus, setEditStatus] = useState<InquiryStatus>('in_progress');
  const [editEnrolledAt, setEditEnrolledAt] = useState('');
  const [editWeeklyCount, setEditWeeklyCount] = useState('');
  const [editTrialAt, setEditTrialAt] = useState('');
  const [editNote, setEditNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  // ---- コンタクト追加フォーム ----
  const [contactMethod, setContactMethod] = useState<'tel' | 'email' | 'sms' | 'visit' | 'other'>('tel');
  const [contactDirection, setContactDirection] = useState<'outbound' | 'inbound'>('outbound');
  const [contactDate, setContactDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [contactResult, setContactResult] = useState('');
  const [contactNote, setContactNote] = useState('');
  const [isAddingContact, setIsAddingContact] = useState(false);
  const [contactError, setContactError] = useState('');

  // ---- HP原文の開閉 ----
  const [rawSourceOpen, setRawSourceOpen] = useState(false);

  // ---- 削除確認モーダル ----
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // ---- 生徒として登録 ----
  const [isEnrolling, setIsEnrolling] = useState(false);
  const [enrollError, setEnrollError] = useState('');

  // ---- メール送信 ----
  const [mailTemplates, setMailTemplates] = useState<InquiryMailTemplate[]>([]);
  const [mailSettings, setMailSettings] = useState<InquirySchoolSettings | null>(null);
  const [schoolName, setSchoolName] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState(''); // '' = テンプレ未選択
  const [mailSubject, setMailSubject] = useState('');
  const [mailBody, setMailBody] = useState('');
  const [isSendingMail, setIsSendingMail] = useState(false);
  const [mailSendMessage, setMailSendMessage] = useState('');
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

  // ---- テンプレート選択時: 変数置換して subject/body をセット ----
  const handleTemplateSelect = (templateId: string) => {
    setSelectedTemplateId(templateId);
    setMailSendMessage('');
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
    setMailSendMessage('');
    try {
      await sendInquiryMail({
        inquiry,
        subject: mailSubject,
        body: mailBody,
        templateId: selectedTemplateId || null,
      });
      setMailSendMessage('送信しました');
      // 送信履歴を再取得
      const logs = await getMailLogs(id);
      setMailLogs(logs);
    } catch (err) {
      setMailSendMessage(getUserErrorMessage(err, '送信に失敗しました'));
    } finally {
      setIsSendingMail(false);
    }
  };

  // ---- ステータス保存 ----
  const handleSave = async () => {
    if (!inquiry) return;
    setIsSaving(true);
    setSaveError('');
    try {
      const update: Parameters<typeof updateInquiry>[1] = {
        status: editStatus,
        note: editNote || null,
      };
      // 入会時は enrolled_at / weekly_count を保存
      if (editStatus === 'enrolled') {
        update.enrolled_at = editEnrolledAt || null;
        update.weekly_count = editWeeklyCount ? parseInt(editWeeklyCount, 10) : null;
      }
      // 体験没・入会時は trial_at も保存
      if (editStatus === 'trial_lost' || editStatus === 'enrolled') {
        update.trial_at = editTrialAt || null;
      }
      const updated = await updateInquiry(id, update);
      setInquiry(updated);
    } catch (err) {
      setSaveError(getUserErrorMessage(err, '保存に失敗しました'));
    } finally {
      setIsSaving(false);
    }
  };

  // ---- コンタクト追加 ----
  const handleAddContact = async () => {
    if (!inquiry) return;
    setIsAddingContact(true);
    setContactError('');
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
      setContactResult('');
      setContactNote('');
    } catch (err) {
      setContactError(getUserErrorMessage(err, 'コンタクトの追加に失敗しました'));
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
    setEnrollError('');
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
      // 作成した生徒の詳細へ
      router.push(`/students/${created.id}`);
    } catch (err) {
      setEnrollError(getUserErrorMessage(err, '生徒登録に失敗しました'));
    } finally {
      setIsEnrolling(false);
    }
  }, [inquiry, router]);

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
      <div className="max-w-4xl">
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

            {/* ── 基本情報 ── */}
            <section className="bg-surface-raised border border-border rounded-xl p-6">
              <div className="flex items-start justify-between mb-4">
                <h2 className="text-lg font-bold text-text-heading">基本情報</h2>
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_CONFIG[inquiry.status].className}`}>
                  {STATUS_CONFIG[inquiry.status].label}
                </span>
              </div>

              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
                <InfoRow label="受付日" value={formatDate(inquiry.inquired_at)} />
                <InfoRow label="HP問合せNO" value={inquiry.hp_inquiry_no} />
                <InfoRow label="生徒氏名" value={inquiry.student_name} />
                <InfoRow label="生徒氏名(カナ)" value={inquiry.student_name_kana} />
                <InfoRow label="保護者氏名" value={inquiry.guardian_name} />
                <InfoRow label="続柄" value={inquiry.relationship} />
                <InfoRow label="学年" value={inquiry.grade} />
                <InfoRow label="性別" value={inquiry.gender} />
                <InfoRow label="在籍校" value={inquiry.school_name} />
                <InfoRow label="塾経験" value={inquiry.juku_experience} />

                {/* 電話: tel: リンク */}
                <div>
                  <dt className="text-xs text-text-muted mb-0.5">電話</dt>
                  <dd className="text-text-heading">
                    {inquiry.phone ? (
                      <a href={`tel:${inquiry.phone}`} className="inline-flex items-center gap-1 text-blue-700 hover:underline">
                        <Phone className="w-3.5 h-3.5" />
                        {inquiry.phone}
                      </a>
                    ) : '—'}
                  </dd>
                </div>

                {/* メール: mailto: リンク */}
                <div>
                  <dt className="text-xs text-text-muted mb-0.5">メール</dt>
                  <dd className="text-text-heading">
                    {inquiry.email ? (
                      <a href={`mailto:${inquiry.email}`} className="inline-flex items-center gap-1 text-blue-700 hover:underline">
                        <Mail className="w-3.5 h-3.5" />
                        {inquiry.email}
                      </a>
                    ) : '—'}
                  </dd>
                </div>

                {/* 住所 */}
                <div className="sm:col-span-2">
                  <dt className="text-xs text-text-muted mb-0.5">住所</dt>
                  <dd className="text-text-heading">
                    {[
                      inquiry.postal_code ? `〒${inquiry.postal_code}` : null,
                      inquiry.address_pref,
                      inquiry.address_detail,
                      inquiry.address_building,
                    ].filter(Boolean).join(' ') || '—'}
                  </dd>
                </div>

                <InfoRow label="媒体" value={inquiry.media} />
                <InfoRow label="問合せ経路" value={inquiry.channel} />
                <InfoRow label="申込内容" value={inquiry.request_type} />
                <InfoRow label="希望科目" value={inquiry.preferred_subjects} />
                <InfoRow label="通塾目的" value={inquiry.purpose} />
                <InfoRow label="デバイス" value={inquiry.device} />

                {/* 問合せ原文（初回メッセージ） */}
                {inquiry.initial_message && (
                  <div className="sm:col-span-2">
                    <dt className="text-xs text-text-muted mb-0.5">問合せ内容</dt>
                    <dd className="text-text-body bg-surface-hover rounded-lg p-3 whitespace-pre-wrap">
                      {inquiry.initial_message}
                    </dd>
                  </div>
                )}
              </dl>
            </section>

            {/* ── ステータス変更・追客情報 ── */}
            <section className="bg-surface-raised border border-border rounded-xl p-6">
              <h2 className="text-lg font-bold text-text-heading mb-4">ステータス・追客情報</h2>
              <div className="space-y-4">
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

                {/* 体験没 / 入会: 体験日 */}
                {(editStatus === 'trial_lost' || editStatus === 'enrolled') && (
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

                {saveError && (
                  <p className="text-sm text-danger">{saveError}</p>
                )}

                <div className="flex gap-2">
                  <Button onClick={handleSave} isLoading={isSaving} size="sm">
                    保存
                  </Button>
                </div>
              </div>
            </section>

            {/* ── コンタクト履歴 ── */}
            <section className="bg-surface-raised border border-border rounded-xl p-6">
              <h2 className="text-lg font-bold text-text-heading mb-4">コンタクト履歴</h2>

              {/* 履歴タイムライン */}
              {contacts.length === 0 ? (
                <p className="text-sm text-text-muted mb-4">コンタクト履歴はありません</p>
              ) : (
                <div className="space-y-3 mb-6">
                  {contacts.map((c) => (
                    <div key={c.id} className="flex gap-3">
                      {/* タイムライン縦線 */}
                      <div className="flex flex-col items-center">
                        <div className="w-2.5 h-2.5 rounded-full bg-primary mt-1 shrink-0" />
                        <div className="flex-1 w-px bg-border" />
                      </div>
                      <div className="pb-3 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap text-xs text-text-muted mb-0.5">
                          <span>{formatDate(c.contacted_at)}</span>
                          <span className="font-medium text-text-body">{CONTACT_METHOD_LABELS[c.method] ?? c.method}</span>
                          {c.direction && (
                            <span>{CONTACT_DIRECTION_LABELS[c.direction] ?? c.direction}</span>
                          )}
                          {c.result && (
                            <span className="px-1.5 py-0.5 bg-surface-hover rounded text-text-body">{c.result}</span>
                          )}
                        </div>
                        {c.note && (
                          <p className="text-sm text-text-body whitespace-pre-wrap">{c.note}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* コンタクト追加フォーム */}
              <div className="border border-border rounded-lg p-4 bg-surface-hover">
                <h3 className="text-sm font-medium text-text-heading mb-3">コンタクトを追加</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                  <div>
                    <label className="block text-xs text-text-muted mb-1">方法</label>
                    <select
                      value={contactMethod}
                      onChange={(e) => setContactMethod(e.target.value as typeof contactMethod)}
                      className="w-full px-2 py-1.5 border border-border rounded-lg text-sm bg-surface-raised focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      {Object.entries(CONTACT_METHOD_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
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
                    <input
                      type="text"
                      value={contactResult}
                      onChange={(e) => setContactResult(e.target.value)}
                      placeholder="例: 折り返し待ち"
                      className="w-full px-2 py-1.5 border border-border rounded-lg text-sm bg-surface-raised focus:outline-none focus:ring-2 focus:ring-primary"
                    />
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
                {contactError && (
                  <p className="text-sm text-danger mb-2">{contactError}</p>
                )}
                <Button onClick={handleAddContact} isLoading={isAddingContact} size="sm" variant="secondary">
                  追加
                </Button>
              </div>
            </section>

            {/* ── メール送信 ── */}
            <section className="bg-surface-raised border border-border rounded-xl p-6">
              <h2 className="text-lg font-bold text-text-heading mb-4">メール送信</h2>

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
                  <div className="flex items-center gap-3 flex-wrap">
                    <Button
                      onClick={handleSendMail}
                      isLoading={isSendingMail}
                      disabled={isSendingMail || !mailSubject.trim() || !mailBody.trim()}
                      size="sm"
                    >
                      <Send className="w-4 h-4 mr-1.5" />
                      送信
                    </Button>
                    {mailSendMessage && (
                      <span className={`text-sm ${mailSendMessage.includes('失敗') || mailSendMessage.includes('エラー') ? 'text-danger' : 'text-text-muted'}`}>
                        {mailSendMessage}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* 送信履歴 */}
              {mailLogs.length > 0 && (
                <div className="mt-6 border-t border-border pt-4">
                  <h3 className="text-sm font-medium text-text-heading mb-3">送信履歴</h3>
                  <div className="space-y-2">
                    {mailLogs.map((log) => (
                      <div key={log.id} className="flex items-center gap-3 text-xs text-text-muted">
                        <span>{formatDateTime(log.sent_at)}</span>
                        <span className={`px-1.5 py-0.5 rounded-full font-medium ${log.status === 'sent' ? 'bg-green-100 text-green-800' : 'bg-danger/20 text-danger'}`}>
                          {log.status === 'sent' ? '送信済み' : '失敗'}
                        </span>
                        {log.subject && (
                          <span className="truncate max-w-xs text-text-body">{log.subject}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>

            {/* ── HP原文（raw_source）折りたたみ ── */}
            {inquiry.raw_source && Object.keys(inquiry.raw_source).length > 0 && (
              <section className="bg-surface-raised border border-border rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => setRawSourceOpen((v) => !v)}
                  className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-surface-hover transition-colors duration-150"
                >
                  <span className="text-sm font-medium text-text-heading">HP原文（全項目）</span>
                  {rawSourceOpen ? (
                    <ChevronUp className="w-4 h-4 text-text-muted" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-text-muted" />
                  )}
                </button>
                {rawSourceOpen && (
                  <div className="px-6 pb-6 overflow-x-auto">
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

            {/* ── アクション（生徒登録・削除） ── */}
            <section className="flex flex-wrap items-center gap-3 pt-2">
              {/* 生徒として登録（紐付け済みなら生徒詳細へのリンクを出す） */}
              {inquiry.linked_student_id ? (
                <Link href={`/students/${inquiry.linked_student_id}`}>
                  <Button variant="outline" size="sm">
                    <UserPlus className="w-4 h-4 mr-1.5" />
                    紐付け済みの生徒を開く
                  </Button>
                </Link>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleEnrollAsStudent}
                  disabled={isEnrolling}
                >
                  <UserPlus className="w-4 h-4 mr-1.5" />
                  {isEnrolling ? '登録中...' : '生徒として登録'}
                </Button>
              )}
              {enrollError && (
                <p className="w-full text-sm text-danger">{enrollError}</p>
              )}

              {/* 論理削除 */}
              <Button
                variant="danger"
                size="sm"
                onClick={() => setDeleteModalOpen(true)}
              >
                <Trash2 className="w-4 h-4 mr-1.5" />
                削除
              </Button>
            </section>
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
    </AdminLayout>
  );
}

/** ラベル/値のペアを表示するヘルパーコンポーネント */
function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs text-text-muted mb-0.5">{label}</dt>
      <dd className="text-text-heading">{value || '—'}</dd>
    </div>
  );
}
