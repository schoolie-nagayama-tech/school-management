'use client';

/**
 * 追客メール一括送信ページ。
 * admin / owner のみアクセス可。
 *
 * 処理フロー:
 *  1. mount 時に inquiries / templates / logs を並列取得 → computeMailCandidates で候補算出
 *  2. 候補一覧にチェックボックス（デフォルト全 on）・プレビューボタンを表示
 *  3. 「選択した N 件を送信」ボタン → 確認モーダル → 1件ずつ順次送信（700ms 待機）
 *  4. 送信完了後、成功/失敗件数とエラー内訳を表示 → ログ再取得 → 候補再計算
 */

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { AdminLayout } from '@/components/layouts';
import { Loading } from '@/components/ui';
import { Button } from '@/components/ui';
import { useAuth } from '@/contexts/AuthContext';
import AccessDenied from '@/components/AccessDenied';
import { ArrowLeft, Send, Eye, X, AlertCircle, CheckCircle } from 'lucide-react';
import { getInquiries } from '@/lib/api/inquiries';
import {
  getMailTemplates,
  getMailLogsBySchool,
  getInquirySchoolSettings,
  buildMailVars,
  renderTemplate,
  sendInquiryMail,
} from '@/lib/api/inquiryMail';
import { getSchools } from '@/lib/api/schools';
import {
  computeMailCandidates,
  type MailCandidate,
} from '@/lib/utils/inquiryMailCandidates';
import type { InquirySchoolSettings } from '@/types/database';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';

// ============================================================
// 型
// ============================================================

/** プレビューモーダルで表示するデータ */
interface PreviewData {
  candidateKey: string; // `${inquiry.id}::${template.id}`
  subject: string;
  body: string;
  toName: string;
  toEmail: string;
  templateName: string;
}

// ============================================================
// ページ本体
// ============================================================

export default function InquiryMailPage() {
  const { profile, getSelectedSchoolIds, selectedSchoolId } = useAuth();

  // ロールガード: admin / owner のみ
  const isAdmin = profile?.role === 'admin' || profile?.role === 'owner' || profile?.role === 'manager';

  // ---- 候補データ ----
  const [candidates, setCandidates] = useState<MailCandidate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  // プレビュー用補助データ（schoolName マップ・settings マップ）
  const [schoolNameMap, setSchoolNameMap] = useState<Record<string, string>>({});
  const [settingsMap, setSettingsMap] = useState<Record<string, InquirySchoolSettings | null>>({});

  // ---- 選択状態（候補の key セット） ----
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  // ---- プレビューモーダル ----
  const [preview, setPreview] = useState<PreviewData | null>(null);

  // ---- 送信確認モーダル ----
  const [showConfirm, setShowConfirm] = useState(false);

  // ---- 送信進捗 ----
  const [isSending, setIsSending] = useState(false);
  const [sendProgress, setSendProgress] = useState<{ current: number; total: number } | null>(null);

  // ---- 送信結果 ----
  const [sendResult, setSendResult] = useState<{
    success: number;
    failed: number;
    errors: { toName: string; templateName: string; message: string }[];
  } | null>(null);

  // ============================================================
  // データ取得 + 候補算出
  // ============================================================

  const fetchCandidates = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage('');
    try {
      const schoolIds = getSelectedSchoolIds();
      if (schoolIds.length === 0) {
        setErrorMessage('教室が選択されていません');
        setIsLoading(false);
        return;
      }

      // inquiries / templates / logs を並列取得
      const [inquiries, templates, logs, schools] = await Promise.all([
        getInquiries(schoolIds),
        getMailTemplates(schoolIds),
        getMailLogsBySchool(schoolIds),
        getSchools(),
      ]);

      // 教室名マップを構築（school_id → name）
      const nameMap: Record<string, string> = {};
      for (const s of schools) { nameMap[s.id] = s.name; }
      setSchoolNameMap(nameMap);

      // 対象教室の settings を並列取得してマップ化
      const settingsEntries = await Promise.all(
        schoolIds.map(async (id) => {
          const s = await getInquirySchoolSettings(id);
          return [id, s] as [string, InquirySchoolSettings | null];
        })
      );
      const sMap: Record<string, InquirySchoolSettings | null> = {};
      for (const [id, s] of settingsEntries) { sMap[id] = s; }
      setSettingsMap(sMap);

      // 候補算出
      const result = computeMailCandidates(inquiries, templates, logs, new Date());
      setCandidates(result);

      // デフォルト全選択
      const keys = new Set<string>(result.map((c) => candidateKey(c)));
      setSelectedKeys(keys);
    } catch (err) {
      setErrorMessage(getUserErrorMessage(err, 'データの取得に失敗しました'));
    } finally {
      setIsLoading(false);
    }
  }, [getSelectedSchoolIds]);

  // 選択教室が変わったら再取得
  useEffect(() => {
    if (selectedSchoolId !== null) {
      fetchCandidates();
    }
  }, [fetchCandidates, selectedSchoolId]);

  // ============================================================
  // ヘルパー
  // ============================================================

  /** 候補の一意キー（inquiry.id × template.id） */
  function candidateKey(c: MailCandidate): string {
    return `${c.inquiry.id}::${c.template.id}`;
  }

  /** 宛先表示名（生徒 || 保護者 || 'お客様'） */
  function toName(c: MailCandidate): string {
    return c.inquiry.student_name || c.inquiry.guardian_name || 'お客様';
  }

  /** 指定候補のレンダリング済み件名・本文を返す */
  function renderCandidate(c: MailCandidate): { subject: string; body: string } {
    const schoolId = c.inquiry.school_id;
    const schoolName = schoolNameMap[schoolId] ?? '（教室名不明）';
    const settings = settingsMap[schoolId] ?? null;
    const vars = buildMailVars(c.inquiry, schoolName, settings);
    return {
      subject: renderTemplate(c.template.subject, vars),
      body: renderTemplate(c.template.body, vars),
    };
  }

  // ============================================================
  // イベントハンドラ
  // ============================================================

  /** チェックボックスのトグル */
  function toggleSelect(key: string) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) { next.delete(key); } else { next.add(key); }
      return next;
    });
  }

  /** 全選択・全解除 */
  function toggleAll() {
    if (selectedKeys.size === candidates.length) {
      setSelectedKeys(new Set());
    } else {
      setSelectedKeys(new Set(candidates.map(candidateKey)));
    }
  }

  /** プレビューモーダルを開く */
  function openPreview(c: MailCandidate) {
    const { subject, body } = renderCandidate(c);
    setPreview({
      candidateKey: candidateKey(c),
      subject,
      body,
      toName: toName(c),
      toEmail: c.inquiry.email ?? '',
      templateName: c.template.name,
    });
  }

  /**
   * 一括送信の実行。
   * 1件ずつ順次処理し、各送信の間に 700ms 待機（Resend レート制限対策）。
   * エラーは収集して継続し、完了後に結果サマリを表示する。
   */
  async function handleBulkSend() {
    setShowConfirm(false);
    setIsSending(true);
    setSendResult(null);

    // 選択された候補を送信順に並べる
    const targets = candidates.filter((c) => selectedKeys.has(candidateKey(c)));
    setSendProgress({ current: 0, total: targets.length });

    let success = 0;
    const errors: { toName: string; templateName: string; message: string }[] = [];

    for (let i = 0; i < targets.length; i++) {
      const c = targets[i];
      setSendProgress({ current: i + 1, total: targets.length });

      try {
        const { subject, body } = renderCandidate(c);
        const schoolId = c.inquiry.school_id;
        const schoolName = schoolNameMap[schoolId] ?? '';
        const settings = settingsMap[schoolId] ?? null;

        await sendInquiryMail({
          inquiry: c.inquiry,
          subject,
          body,
          fromName: settings?.sender_name || schoolName || undefined,
          replyTo: settings?.mail_reply_to || undefined,
          templateId: c.template.id,
        });
        success++;
      } catch (err) {
        errors.push({
          toName: toName(c),
          templateName: c.template.name,
          message: getUserErrorMessage(err, 'メール送信に失敗しました'),
        });
      }

      // 最後の1件は待機不要
      if (i < targets.length - 1) {
        await new Promise((res) => setTimeout(res, 700));
      }
    }

    setSendResult({ success, failed: errors.length, errors });
    setIsSending(false);
    setSendProgress(null);

    // ログ再取得 → 候補再計算（送信済みが除外される）
    await fetchCandidates();
  }

  // ============================================================
  // ローディング・権限チェック
  // ============================================================

  if (profile === null) {
    return (
      <AdminLayout headerTitle="追客メール送信">
        <Loading className="min-h-[60vh]" />
      </AdminLayout>
    );
  }

  if (!isAdmin) {
    return (
      <AdminLayout>
        <AccessDenied message="追客メール送信は管理者のみ利用できます" />
      </AdminLayout>
    );
  }

  // 選択済み件数
  const selectedCount = candidates.filter((c) => selectedKeys.has(candidateKey(c))).length;
  const allChecked = candidates.length > 0 && selectedKeys.size === candidates.length;

  // ============================================================
  // レンダリング
  // ============================================================

  return (
    <AdminLayout headerTitle="追客メール送信">
      {/* 戻るリンク */}
      <div className="mb-4">
        <Link
          href="/admin/inquiries"
          className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text-body transition-colors duration-150"
        >
          <ArrowLeft className="w-4 h-4" />
          問合せ一覧に戻る
        </Link>
      </div>

      {/* エラーバナー */}
      {errorMessage && (
        <div className="mb-4 p-4 bg-danger/20 border border-danger rounded-lg">
          <p className="text-sm text-danger">{errorMessage}</p>
        </div>
      )}

      {/* 送信結果バナー */}
      {sendResult && (
        <div className={`mb-4 p-4 rounded-lg border ${sendResult.failed === 0 ? 'bg-green-50 border-green-300' : 'bg-yellow-50 border-yellow-300'}`}>
          <div className="flex items-center gap-2 mb-2">
            {sendResult.failed === 0
              ? <CheckCircle className="w-4 h-4 text-green-600" />
              : <AlertCircle className="w-4 h-4 text-yellow-600" />
            }
            <span className="text-sm font-medium text-text-heading">
              送信完了: 成功 {sendResult.success}件 / 失敗 {sendResult.failed}件
            </span>
          </div>
          {sendResult.errors.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-danger">
              {sendResult.errors.map((e, i) => (
                <li key={i}>
                  {e.toName}（{e.templateName}）: {e.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* 送信進捗 */}
      {isSending && sendProgress && (
        <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-sm text-blue-700 font-medium">
            送信中 {sendProgress.current} / {sendProgress.total} 件...
          </p>
          {/* プログレスバー */}
          <div className="mt-2 h-2 bg-blue-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-300"
              style={{ width: `${Math.round((sendProgress.current / sendProgress.total) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* メインカード */}
      <div className="bg-surface-raised rounded-xl border border-border p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-text-heading">本日の送信候補</h2>
            <p className="text-xs text-text-muted mt-0.5">
              ステップメールの送信タイミングに該当し、未送信の問合せを表示しています
            </p>
          </div>
          {/* 一括送信ボタン */}
          {candidates.length > 0 && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => setShowConfirm(true)}
              disabled={isSending || selectedCount === 0}
            >
              <Send className="w-4 h-4 mr-1.5" />
              選択した {selectedCount} 件を送信
            </Button>
          )}
        </div>

        {isLoading ? (
          <Loading size="md" />
        ) : candidates.length === 0 ? (
          <div className="text-center py-12 text-text-body text-sm">
            本日の送信候補はありません
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse border border-border text-sm">
              <thead>
                <tr className="bg-surface-hover">
                  {/* 全選択チェックボックス */}
                  <th className="border border-border px-3 py-2.5 w-10">
                    <input
                      type="checkbox"
                      checked={allChecked}
                      onChange={toggleAll}
                      className="cursor-pointer"
                      aria-label="全て選択"
                    />
                  </th>
                  <th className="border border-border px-3 py-2.5 text-left font-medium text-text-heading">
                    宛先名
                  </th>
                  <th className="border border-border px-3 py-2.5 text-left font-medium text-text-heading">
                    教室
                  </th>
                  <th className="border border-border px-3 py-2.5 text-left font-medium text-text-heading">
                    テンプレート
                  </th>
                  <th className="border border-border px-3 py-2.5 text-center font-medium text-text-heading w-24">
                    経過日数
                  </th>
                  <th className="border border-border px-3 py-2.5 text-left font-medium text-text-heading">
                    メールアドレス
                  </th>
                  <th className="border border-border px-3 py-2.5 text-center font-medium text-text-heading w-20">
                    プレビュー
                  </th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c) => {
                  const key = candidateKey(c);
                  return (
                    <tr key={key} className="hover:bg-surface-hover transition-colors duration-100">
                      {/* チェックボックス */}
                      <td className="border border-border px-3 py-2.5 text-center">
                        <input
                          type="checkbox"
                          checked={selectedKeys.has(key)}
                          onChange={() => toggleSelect(key)}
                          className="cursor-pointer"
                        />
                      </td>
                      {/* 宛先名（生徒 || 保護者） */}
                      <td className="border border-border px-3 py-2.5 font-medium text-text-heading">
                        {toName(c)}
                      </td>
                      {/* 教室名 */}
                      <td className="border border-border px-3 py-2.5 text-text-body">
                        {schoolNameMap[c.inquiry.school_id] ?? '—'}
                      </td>
                      {/* テンプレート名（trigger_days 表示付き） */}
                      <td className="border border-border px-3 py-2.5 text-text-body">
                        <span>{c.template.name}</span>
                        <span className="ml-1.5 text-xs text-text-muted">
                          ({c.template.trigger_days}日後)
                        </span>
                      </td>
                      {/* 経過日数 */}
                      <td className="border border-border px-3 py-2.5 text-center text-text-body">
                        {c.daysSince}日
                      </td>
                      {/* メールアドレス */}
                      <td className="border border-border px-3 py-2.5 text-text-body text-xs">
                        {c.inquiry.email ?? '—'}
                      </td>
                      {/* プレビューボタン */}
                      <td className="border border-border px-3 py-2.5 text-center">
                        <button
                          type="button"
                          onClick={() => openPreview(c)}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs text-blue-600 hover:text-blue-800 border border-blue-200 rounded hover:bg-blue-50 transition-colors duration-150"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          確認
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ============================================================
          プレビューモーダル
      ============================================================ */}
      {preview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setPreview(null)}
        >
          <div
            className="bg-surface-raised rounded-xl border border-border shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* ヘッダー */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h3 className="text-base font-bold text-text-heading">メールプレビュー</h3>
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="text-text-muted hover:text-text-body transition-colors duration-150"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* 宛先情報 */}
            <div className="px-6 py-3 bg-surface-hover border-b border-border text-xs space-y-1">
              <div>
                <span className="text-text-muted w-20 inline-block">テンプレート</span>
                <span className="text-text-body">{preview.templateName}</span>
              </div>
              <div>
                <span className="text-text-muted w-20 inline-block">宛先</span>
                <span className="text-text-body">{preview.toName}（{preview.toEmail}）</span>
              </div>
              <div>
                <span className="text-text-muted w-20 inline-block">件名</span>
                <span className="text-text-body font-medium">{preview.subject}</span>
              </div>
            </div>

            {/* 本文 */}
            <div className="px-6 py-4 overflow-y-auto flex-1">
              <pre className="text-sm text-text-body whitespace-pre-wrap font-sans leading-relaxed">
                {preview.body}
              </pre>
            </div>

            {/* フッター */}
            <div className="px-6 py-3 border-t border-border flex justify-end">
              <Button variant="outline" size="sm" onClick={() => setPreview(null)}>
                閉じる
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================
          送信確認モーダル
      ============================================================ */}
      {showConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setShowConfirm(false)}
        >
          <div
            className="bg-surface-raised rounded-xl border border-border shadow-xl w-full max-w-sm"
            onClick={(e) => e.stopPropagation()}
          >
            {/* ヘッダー */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h3 className="text-base font-bold text-text-heading">送信確認</h3>
              <button
                type="button"
                onClick={() => setShowConfirm(false)}
                className="text-text-muted hover:text-text-body transition-colors duration-150"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* 本文 */}
            <div className="px-6 py-5">
              <p className="text-sm text-text-body">
                選択した <span className="font-bold text-text-heading">{selectedCount} 件</span> に
                メールを送信します。送信後は取り消せません。
              </p>
            </div>

            {/* ボタン */}
            <div className="px-6 pb-5 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowConfirm(false)}>
                キャンセル
              </Button>
              <Button variant="primary" size="sm" onClick={handleBulkSend}>
                <Send className="w-4 h-4 mr-1.5" />
                送信する
              </Button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
