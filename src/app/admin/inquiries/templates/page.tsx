'use client';

/**
 * 問合せメールテンプレート管理ページ。
 * admin / owner のみアクセス可。
 * 選択中教室のテンプレート（共通 + 該当校）を一覧表示し、
 * モーダルで新規作成・編集・削除を行う。
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { AdminLayout } from '@/components/layouts';
import { Loading, Modal } from '@/components/ui';
import { Button } from '@/components/ui';
import { useAuth } from '@/contexts/AuthContext';
import { useMasterData } from '@/contexts/MasterDataContext';
import AccessDenied from '@/components/AccessDenied';
import {
  getMailTemplates,
  createMailTemplate,
  updateMailTemplate,
  deleteMailTemplate,
  renderTemplate,
} from '@/lib/api/inquiryMail';
import type { InquiryMailTemplate, InquiryMailTemplateInsert } from '@/types/database';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';
import { supabase } from '@/lib/supabase';
import {
  ChevronLeft,
  Plus,
  Pencil,
  Trash2,
  Mail,
} from 'lucide-react';

// プレビュー表示用サンプル変数
const SAMPLE_VARS = {
  保護者: '山田 花子',
  生徒: '山田 太郎',
  教室名: 'スクールIE永山校',
  教室電話: '042-000-0000',
  署名: 'スクールIE永山校 高橋',
};

// 変数チップのリスト（ボタンクリックで挿入）
const VAR_CHIPS = ['{保護者}', '{生徒}', '{教室名}', '{教室電話}', '{署名}'];

export default function MailTemplatesPage() {
  const { profile, getSelectedSchoolIds, selectedSchoolId } = useAuth();
  const { schools } = useMasterData();

  // ロールガード: admin / owner のみ
  const isAdmin = profile?.role === 'admin' || profile?.role === 'owner';

  const [templates, setTemplates] = useState<InquiryMailTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  // ---- モーダル状態 ----
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<InquiryMailTemplate | null>(null); // null=新規
  const [deleteTarget, setDeleteTarget] = useState<InquiryMailTemplate | null>(null);

  // ---- フォーム状態 ----
  const [formName, setFormName] = useState('');
  const [formSchoolId, setFormSchoolId] = useState<string>(''); // '' = 全教室共通
  const [formTriggerDays, setFormTriggerDays] = useState('');
  const [formIsActive, setFormIsActive] = useState(true);
  const [formSubject, setFormSubject] = useState('');
  const [formBody, setFormBody] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  // ---- テスト送信 ----
  const [isTestSending, setIsTestSending] = useState(false);
  const [testSendMessage, setTestSendMessage] = useState('');

  // 最後にフォーカスされた入力欄（変数チップ挿入先）
  const lastFocusedField = useRef<'subject' | 'body'>('body');
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const schoolIds = getSelectedSchoolIds();

  // ---- データ取得 ----
  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage('');
    try {
      const data = await getMailTemplates(schoolIds);
      setTemplates(data);
    } catch (err) {
      setErrorMessage(getUserErrorMessage(err, 'テンプレートの取得に失敗しました'));
    } finally {
      setIsLoading(false);
    }
  }, [schoolIds.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ---- モーダルを開く（新規 or 編集） ----
  const openModal = (template?: InquiryMailTemplate) => {
    if (template) {
      // 編集モード
      setEditTarget(template);
      setFormName(template.name);
      setFormSchoolId(template.school_id ?? '');
      setFormTriggerDays(template.trigger_days != null ? String(template.trigger_days) : '');
      setFormIsActive(template.is_active);
      setFormSubject(template.subject);
      setFormBody(template.body);
    } else {
      // 新規モード
      setEditTarget(null);
      setFormName('');
      // 単一教室選択中ならその教室をデフォルトに
      setFormSchoolId(typeof selectedSchoolId === 'string' && selectedSchoolId !== 'all' ? selectedSchoolId : '');
      setFormTriggerDays('');
      setFormIsActive(true);
      setFormSubject('');
      setFormBody('');
    }
    setSaveError('');
    setTestSendMessage('');
    setModalOpen(true);
  };

  // ---- モーダルを閉じる ----
  const closeModal = () => {
    setModalOpen(false);
    setEditTarget(null);
    setTestSendMessage('');
  };

  // ---- 保存（create / update） ----
  const handleSave = async () => {
    if (!formName.trim()) {
      setSaveError('テンプレート名は必須です');
      return;
    }
    setIsSaving(true);
    setSaveError('');
    try {
      const payload: InquiryMailTemplateInsert = {
        name: formName.trim(),
        school_id: formSchoolId || null,
        trigger_days: formTriggerDays !== '' ? parseInt(formTriggerDays, 10) : null,
        is_active: formIsActive,
        subject: formSubject,
        body: formBody,
      };

      if (editTarget) {
        await updateMailTemplate(editTarget.id, payload);
      } else {
        await createMailTemplate(payload);
      }

      await fetchData();
      closeModal();
    } catch (err) {
      setSaveError(getUserErrorMessage(err, '保存に失敗しました'));
    } finally {
      setIsSaving(false);
    }
  };

  // ---- 削除 ----
  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMailTemplate(deleteTarget.id);
      await fetchData();
      setDeleteTarget(null);
    } catch (err) {
      setErrorMessage(getUserErrorMessage(err, '削除に失敗しました'));
      setDeleteTarget(null);
    }
  };

  // ---- 変数チップ挿入 ----
  // 最後にフォーカスされたフィールドのカーソル位置にテキストを挿入する
  const insertVar = (chip: string) => {
    if (lastFocusedField.current === 'subject' && subjectRef.current) {
      const el = subjectRef.current;
      const start = el.selectionStart ?? formSubject.length;
      const end = el.selectionEnd ?? formSubject.length;
      const next = formSubject.slice(0, start) + chip + formSubject.slice(end);
      setFormSubject(next);
      // カーソルをチップの末尾へ（次のレンダリング後に設定）
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(start + chip.length, start + chip.length);
      });
    } else if (bodyRef.current) {
      const el = bodyRef.current;
      const start = el.selectionStart ?? formBody.length;
      const end = el.selectionEnd ?? formBody.length;
      const next = formBody.slice(0, start) + chip + formBody.slice(end);
      setFormBody(next);
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(start + chip.length, start + chip.length);
      });
    }
  };

  // ---- テスト送信 ----
  // 現在ログイン中のユーザーメールへサンプルデータで送信。ログは記録しない。
  const handleTestSend = async () => {
    setIsTestSending(true);
    setTestSendMessage('');
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) {
        setTestSendMessage('ログインユーザーのメールアドレスが取得できませんでした');
        return;
      }
      const renderedSubject = renderTemplate(formSubject, SAMPLE_VARS);
      const renderedBody = renderTemplate(formBody, SAMPLE_VARS);
      const { data, error } = await supabase.functions.invoke('send-inquiry-mail', {
        body: {
          to: user.email,
          subject: `[テスト] ${renderedSubject}`,
          body: renderedBody,
        },
      });
      if (error || (data && data.error)) {
        const msg = error?.message || (data && data.error) || '送信に失敗しました';
        setTestSendMessage(`送信失敗: ${msg}`);
      } else {
        setTestSendMessage(`テストメールを ${user.email} に送信しました`);
      }
    } catch (err) {
      setTestSendMessage(getUserErrorMessage(err, 'テスト送信に失敗しました'));
    } finally {
      setIsTestSending(false);
    }
  };

  // ---- ローディング / 権限チェック ----
  if (profile === null) {
    return (
      <AdminLayout headerTitle="メールテンプレート">
        <Loading className="min-h-[60vh]" />
      </AdminLayout>
    );
  }
  if (!isAdmin) {
    return (
      <AdminLayout>
        <AccessDenied message="この機能は管理者のみ利用できます" />
      </AdminLayout>
    );
  }

  // ---- プレビュー（ライブ） ----
  const previewSubject = renderTemplate(formSubject, SAMPLE_VARS);
  const previewBody = renderTemplate(formBody, SAMPLE_VARS);

  // ---- 教室名マップ（school_id → name） ----
  const schoolNameMap = new Map(schools.map((s) => [s.id, s.name]));

  return (
    <AdminLayout headerTitle="メールテンプレート">
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

        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-text-heading">テンプレート一覧</h2>
          <Button onClick={() => openModal()} size="sm">
            <Plus className="w-4 h-4 mr-1.5" />
            新規テンプレート
          </Button>
        </div>

        {isLoading ? (
          <Loading size="md" />
        ) : templates.length === 0 ? (
          <div className="bg-surface-raised border border-border rounded-xl p-8 text-center text-sm text-text-muted">
            テンプレートがありません。「新規テンプレート」から作成してください。
          </div>
        ) : (
          <div className="bg-surface-raised border border-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-hover">
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">テンプレート名</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">対象</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">自動送信日数</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">状態</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-text-muted">操作</th>
                </tr>
              </thead>
              <tbody>
                {templates.map((t, i) => (
                  <tr
                    key={t.id}
                    className={`border-b border-border last:border-b-0 ${i % 2 === 0 ? '' : 'bg-surface-hover/40'}`}
                  >
                    <td className="px-4 py-3 text-text-heading font-medium">
                      <div className="flex items-center gap-2">
                        <Mail className="w-4 h-4 text-text-muted shrink-0" />
                        {t.name}
                      </div>
                      <p className="text-xs text-text-muted mt-0.5 ml-6 truncate max-w-xs">{t.subject}</p>
                    </td>
                    <td className="px-4 py-3 text-text-body">
                      {t.school_id ? (schoolNameMap.get(t.school_id) ?? t.school_id) : '全教室共通'}
                    </td>
                    <td className="px-4 py-3 text-text-body">
                      {t.trigger_days != null ? `${t.trigger_days} 日後` : '手動専用'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${t.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'}`}>
                        {t.is_active ? '有効' : '無効'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openModal(t)}
                          aria-label="編集"
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteTarget(t)}
                          aria-label="削除"
                        >
                          <Trash2 className="w-4 h-4 text-danger" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── 編集モーダル ── */}
      <Modal
        isOpen={modalOpen}
        onClose={closeModal}
        title={editTarget ? 'テンプレート編集' : 'テンプレート新規作成'}
        size="lg"
      >
        <div className="space-y-4">

          {/* テンプレート名 */}
          <div>
            <label className="block text-xs font-medium text-text-heading mb-1">
              テンプレート名 <span className="text-danger">*</span>
            </label>
            <input
              type="text"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="例: 体験案内メール"
              className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface-raised text-text-body focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {/* 対象教室 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-text-heading mb-1">対象教室</label>
              <select
                value={formSchoolId}
                onChange={(e) => setFormSchoolId(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface-raised text-text-body focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">全教室共通</option>
                {schools.filter((s) => !s.is_demo).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>

            {/* 自動送信日数 */}
            <div>
              <label className="block text-xs font-medium text-text-heading mb-1">
                自動送信日数（空=手動専用）
              </label>
              <input
                type="number"
                min={0}
                value={formTriggerDays}
                onChange={(e) => setFormTriggerDays(e.target.value)}
                placeholder="例: 3"
                className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface-raised text-text-body focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>

          {/* 有効/無効 */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={formIsActive}
              onClick={() => setFormIsActive((v) => !v)}
              className={`relative inline-flex w-10 h-6 rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-primary ${formIsActive ? 'bg-primary' : 'bg-border'}`}
            >
              <span
                className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${formIsActive ? 'translate-x-4' : 'translate-x-0'}`}
              />
            </button>
            <span className="text-sm text-text-body">{formIsActive ? '有効' : '無効'}</span>
          </div>

          {/* 変数チップ */}
          <div>
            <p className="text-xs text-text-muted mb-1.5">変数（クリックでカーソル位置に挿入）</p>
            <div className="flex flex-wrap gap-2">
              {VAR_CHIPS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => insertVar(chip)}
                  className="px-2.5 py-1 text-xs rounded border border-primary text-primary bg-primary/5 hover:bg-primary/15 transition-colors duration-150"
                >
                  {chip}
                </button>
              ))}
            </div>
          </div>

          {/* 件名 */}
          <div>
            <label className="block text-xs font-medium text-text-heading mb-1">件名</label>
            <input
              ref={subjectRef}
              type="text"
              value={formSubject}
              onChange={(e) => setFormSubject(e.target.value)}
              onFocus={() => { lastFocusedField.current = 'subject'; }}
              placeholder="例: 体験授業のご案内（{教室名}）"
              className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface-raised text-text-body focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {/* 本文 */}
          <div>
            <label className="block text-xs font-medium text-text-heading mb-1">本文</label>
            <textarea
              ref={bodyRef}
              value={formBody}
              onChange={(e) => setFormBody(e.target.value)}
              onFocus={() => { lastFocusedField.current = 'body'; }}
              rows={8}
              placeholder="{保護者} 様&#10;&#10;お問い合わせいただきありがとうございます。&#10;{教室名} です。"
              className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface-raised text-text-body focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            />
          </div>

          {/* ライブプレビュー */}
          {(formSubject || formBody) && (
            <div className="border border-border rounded-lg p-4 bg-surface-hover">
              <p className="text-xs font-medium text-text-muted mb-2">プレビュー（サンプルデータで置換済み）</p>
              {previewSubject && (
                <p className="text-sm font-medium text-text-heading mb-2 break-all">件名: {previewSubject}</p>
              )}
              {previewBody && (
                <p className="text-sm text-text-body whitespace-pre-wrap">{previewBody}</p>
              )}
            </div>
          )}

          {/* テスト送信 */}
          <div className="flex items-center gap-3 flex-wrap">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleTestSend}
              isLoading={isTestSending}
            >
              <Mail className="w-4 h-4 mr-1.5" />
              自分宛てにテスト送信
            </Button>
            {testSendMessage && (
              <span className={`text-xs ${testSendMessage.includes('失敗') ? 'text-danger' : 'text-text-muted'}`}>
                {testSendMessage}
              </span>
            )}
          </div>

          {saveError && (
            <p className="text-sm text-danger">{saveError}</p>
          )}

          {/* 保存・キャンセル */}
          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button variant="ghost" size="sm" onClick={closeModal}>
              キャンセル
            </Button>
            <Button size="sm" isLoading={isSaving} onClick={handleSave}>
              保存
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── 削除確認モーダル ── */}
      <Modal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="テンプレートの削除"
        size="sm"
      >
        <p className="text-sm text-text-body mb-6">
          「{deleteTarget?.name}」を削除します。この操作は取り消せません。よろしいですか？
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(null)}>
            キャンセル
          </Button>
          <Button variant="danger" size="sm" onClick={handleDelete}>
            削除する
          </Button>
        </div>
      </Modal>
    </AdminLayout>
  );
}
