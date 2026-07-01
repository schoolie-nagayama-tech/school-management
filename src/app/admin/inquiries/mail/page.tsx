'use client';

/**
 * 追客メールページ。教室長以上のみアクセス可。
 *
 * 3つのタブで構成する:
 *  1. 送信候補   … ステップメールのタイミングに該当する未送信の問合せを自動抽出。
 *                  各候補は「確認」から件名・本文を編集して送信できる（編集内容は
 *                  オーバーライドとして保持し、一括送信にも反映される）。
 *  2. 選んで送信 … テンプレートを選び、宛先（問合せ）を検索・チェックで選んで一括送信。
 *  3. テンプレート … テンプレートの新規登録・改定・削除（共通コンポーネント）。
 *
 * 送信はいずれも 1件ずつ順次・各送信の間に 700ms 待機（Resend レート制限対策）。
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { AdminLayout } from '@/components/layouts';
import { Loading, Button } from '@/components/ui';
import { useAuth } from '@/contexts/AuthContext';
import AccessDenied from '@/components/AccessDenied';
import {
  ArrowLeft,
  Send,
  Eye,
  X,
  AlertCircle,
  CheckCircle,
  Users,
  FileText,
  RotateCcw,
  Search,
} from 'lucide-react';
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
import { computeMailCandidates, type MailCandidate } from '@/lib/utils/inquiryMailCandidates';
import type {
  InquirySchoolSettings,
  Inquiry,
  InquiryMailTemplate,
  InquiryStatus,
} from '@/types/database';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';
import { isManagerOrAbove } from '@/lib/utils/roles';
import { InquiryTemplateManager } from '@/components/inquiries/InquiryTemplateManager';
import { STATUS_CONFIG, STATUS_OPTIONS } from '../inquiryConstants';

// ============================================================
// 型
// ============================================================

type TabKey = 'candidates' | 'compose' | 'templates';

/** 1通分の送信ターゲット（件名・本文は差し込み済みの最終テキスト） */
interface SendTarget {
  inquiry: Inquiry;
  subject: string;
  body: string;
  templateId: string | null;
  /** 結果表示用の宛先ラベル */
  label: string;
}

/** プレビュー兼編集モーダルの対象（送信候補タブ） */
interface EditTarget {
  candidateKey: string;
  toName: string;
  toEmail: string;
  templateName: string;
  subject: string;
  body: string;
}

const VAR_CHIPS = ['{保護者}', '{生徒}', '{教室名}', '{教室電話}', '{署名}', '{面談設定URL}'];

// ============================================================
// ページ本体
// ============================================================

export default function InquiryMailPage() {
  const { profile, getSelectedSchoolIds, selectedSchoolId } = useAuth();

  // ロールガード: 教室長以上（manager / owner / admin）。判定は roles.ts に一元化。
  const isAdmin = isManagerOrAbove(profile?.role);

  const [activeTab, setActiveTab] = useState<TabKey>('candidates');

  // ---- 共有データ ----
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [templates, setTemplates] = useState<InquiryMailTemplate[]>([]);
  const [candidates, setCandidates] = useState<MailCandidate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  // プレビュー用補助データ（schoolName マップ・settings マップ）
  const [schoolNameMap, setSchoolNameMap] = useState<Record<string, string>>({});
  const [schoolCodeMap, setSchoolCodeMap] = useState<Record<string, string>>({});
  const [settingsMap, setSettingsMap] = useState<Record<string, InquirySchoolSettings | null>>({});

  // ---- 送信候補タブ: 選択状態・編集オーバーライド ----
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  // 候補ごとに編集した件名・本文（差し込み済みテキスト）。一括送信にも反映する。
  const [overrides, setOverrides] = useState<Map<string, { subject: string; body: string }>>(
    new Map()
  );
  // 編集モーダル
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);

  // ---- 選んで送信タブ ----
  const [composeTemplateId, setComposeTemplateId] = useState<string>(''); // '' = 自由入力
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [recipientSearch, setRecipientSearch] = useState('');
  const [recipientStatus, setRecipientStatus] = useState<InquiryStatus | 'all'>('all');
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<Set<string>>(new Set());
  // 変数チップ挿入先
  const composeSubjectRef = useRef<HTMLInputElement>(null);
  const composeBodyRef = useRef<HTMLTextAreaElement>(null);
  const lastComposeField = useRef<'subject' | 'body'>('body');
  // 一括送信の再入ガード。isSending(state) は更新が非同期で連打に間に合わないため、
  // 同期的に判定できる ref で「送信処理が走っている間の再呼び出し」を弾く。
  const sendingRef = useRef(false);

  // ---- 送信フロー（全タブ共通） ----
  const [pendingSend, setPendingSend] = useState<SendTarget[] | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [sendProgress, setSendProgress] = useState<{ current: number; total: number } | null>(null);
  const [sendResult, setSendResult] = useState<{
    success: number;
    failed: number;
    errors: { label: string; message: string }[];
  } | null>(null);

  // ============================================================
  // データ取得
  // ============================================================

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage('');
    try {
      const schoolIds = getSelectedSchoolIds();
      if (schoolIds.length === 0) {
        setErrorMessage('教室が選択されていません');
        setIsLoading(false);
        return;
      }

      const [allInquiries, tpls, logs, schools] = await Promise.all([
        getInquiries(schoolIds),
        getMailTemplates(schoolIds),
        getMailLogsBySchool(schoolIds),
        getSchools(),
      ]);

      // 教室名マップ
      const nameMap: Record<string, string> = {};
      for (const s of schools) nameMap[s.id] = s.name;
      setSchoolNameMap(nameMap);

      // 教室コードマップ（{面談設定URL} の解決に使う）
      const codeMap: Record<string, string> = {};
      for (const s of schools) if (s.code) codeMap[s.id] = s.code;
      setSchoolCodeMap(codeMap);

      // 教室別設定マップ
      const settingsEntries = await Promise.all(
        schoolIds.map(async (id) => {
          const s = await getInquirySchoolSettings(id);
          return [id, s] as [string, InquirySchoolSettings | null];
        })
      );
      const sMap: Record<string, InquirySchoolSettings | null> = {};
      for (const [id, s] of settingsEntries) sMap[id] = s;
      setSettingsMap(sMap);

      setInquiries(allInquiries);
      setTemplates(tpls);

      // 送信候補を算出
      const result = computeMailCandidates(allInquiries, tpls, logs, new Date());
      setCandidates(result);

      // 送信候補はデフォルト全選択。編集オーバーライドはリセット。
      setSelectedKeys(new Set<string>(result.map((c) => candidateKey(c))));
      setOverrides(new Map());
    } catch (err) {
      setErrorMessage(getUserErrorMessage(err, 'データの取得に失敗しました'));
    } finally {
      setIsLoading(false);
    }
  }, [getSelectedSchoolIds]);

  useEffect(() => {
    if (selectedSchoolId !== null) {
      fetchData();
    }
  }, [fetchData, selectedSchoolId]);

  // ============================================================
  // ヘルパー
  // ============================================================

  /** 候補の一意キー（inquiry.id × template.id） */
  function candidateKey(c: MailCandidate): string {
    return `${c.inquiry.id}::${c.template.id}`;
  }

  /** 宛先表示名（生徒 || 保護者 || 'お客様'） */
  function toName(inquiry: Inquiry): string {
    return inquiry.student_name || inquiry.guardian_name || 'お客様';
  }

  /** テンプレート + 問合せから差し込み済みの件名・本文を作る */
  const renderForInquiry = useCallback(
    (inquiry: Inquiry, subjectTpl: string, bodyTpl: string): { subject: string; body: string } => {
      const schoolId = inquiry.school_id;
      const schoolName = schoolNameMap[schoolId] ?? '（教室名不明）';
      const settings = settingsMap[schoolId] ?? null;
      const vars = buildMailVars(inquiry, schoolName, settings, schoolCodeMap[schoolId]);
      return {
        subject: renderTemplate(subjectTpl, vars),
        body: renderTemplate(bodyTpl, vars),
      };
    },
    [schoolNameMap, settingsMap, schoolCodeMap]
  );

  /** 送信候補の最終的な件名・本文（編集オーバーライド優先） */
  const renderCandidate = useCallback(
    (c: MailCandidate): { subject: string; body: string } => {
      const ov = overrides.get(candidateKey(c));
      if (ov) return ov;
      return renderForInquiry(c.inquiry, c.template.subject, c.template.body);
    },
    [overrides, renderForInquiry]
  );

  // ============================================================
  // 送信候補タブ: イベント
  // ============================================================

  function toggleSelect(key: string) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAll() {
    if (selectedKeys.size === candidates.length) {
      setSelectedKeys(new Set());
    } else {
      setSelectedKeys(new Set(candidates.map(candidateKey)));
    }
  }

  /** 確認・編集モーダルを開く */
  function openEdit(c: MailCandidate) {
    const { subject, body } = renderCandidate(c);
    setEditTarget({
      candidateKey: candidateKey(c),
      toName: toName(c.inquiry),
      toEmail: c.inquiry.email ?? '',
      templateName: c.template.name,
      subject,
      body,
    });
  }

  /** 編集内容をオーバーライドとして保存 */
  function saveOverride() {
    if (!editTarget) return;
    setOverrides((prev) => {
      const next = new Map(prev);
      next.set(editTarget.candidateKey, { subject: editTarget.subject, body: editTarget.body });
      return next;
    });
    setEditTarget(null);
  }

  /** この候補のオーバーライドを破棄してテンプレートに戻す */
  function resetOverride() {
    if (!editTarget) return;
    const c = candidates.find((x) => candidateKey(x) === editTarget.candidateKey);
    setOverrides((prev) => {
      const next = new Map(prev);
      next.delete(editTarget.candidateKey);
      return next;
    });
    if (c) {
      const { subject, body } = renderForInquiry(c.inquiry, c.template.subject, c.template.body);
      setEditTarget({ ...editTarget, subject, body });
    }
  }

  /** 編集中の内容でこの1件だけ送信する */
  function sendSingleFromEdit() {
    if (!editTarget) return;
    const c = candidates.find((x) => candidateKey(x) === editTarget.candidateKey);
    if (!c) return;
    setPendingSend([
      {
        inquiry: c.inquiry,
        subject: editTarget.subject,
        body: editTarget.body,
        templateId: c.template.id,
        label: editTarget.toName,
      },
    ]);
    setEditTarget(null);
  }

  /** 選択した候補を一括送信 */
  function requestBulkSendCandidates() {
    const targets: SendTarget[] = candidates
      .filter((c) => selectedKeys.has(candidateKey(c)))
      .map((c) => {
        const { subject, body } = renderCandidate(c);
        return {
          inquiry: c.inquiry,
          subject,
          body,
          templateId: c.template.id,
          label: toName(c.inquiry),
        };
      });
    if (targets.length > 0) setPendingSend(targets);
  }

  // ============================================================
  // 選んで送信タブ: イベント
  // ============================================================

  /** テンプレート選択時に件名・本文を流し込む */
  function applyComposeTemplate(id: string) {
    setComposeTemplateId(id);
    if (!id) return; // 自由入力（クリアはしない）
    const t = templates.find((x) => x.id === id);
    if (t) {
      setComposeSubject(t.subject);
      setComposeBody(t.body);
    }
  }

  /** 変数チップをカーソル位置に挿入 */
  function insertComposeVar(chip: string) {
    if (lastComposeField.current === 'subject' && composeSubjectRef.current) {
      const el = composeSubjectRef.current;
      const start = el.selectionStart ?? composeSubject.length;
      const end = el.selectionEnd ?? composeSubject.length;
      setComposeSubject(composeSubject.slice(0, start) + chip + composeSubject.slice(end));
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(start + chip.length, start + chip.length);
      });
    } else if (composeBodyRef.current) {
      const el = composeBodyRef.current;
      const start = el.selectionStart ?? composeBody.length;
      const end = el.selectionEnd ?? composeBody.length;
      setComposeBody(composeBody.slice(0, start) + chip + composeBody.slice(end));
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(start + chip.length, start + chip.length);
      });
    }
  }

  // 宛先候補（メールアドレスを持つ問合せ）。検索・ステータスで絞り込む。
  const recipientList = useMemo(() => {
    const hasEmail = (q: Inquiry) => {
      const e = (q.email ?? '').trim();
      return e !== '' && e !== 'なし';
    };
    const kw = recipientSearch.trim().toLowerCase();
    return inquiries.filter((q) => {
      if (!hasEmail(q)) return false;
      if (recipientStatus !== 'all' && q.status !== recipientStatus) return false;
      if (kw) {
        const hay =
          `${q.student_name ?? ''} ${q.guardian_name ?? ''} ${q.email ?? ''} ${q.phone ?? ''}`.toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });
  }, [inquiries, recipientSearch, recipientStatus]);

  function toggleRecipient(id: string) {
    setSelectedRecipientIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** 現在の絞り込み結果を全選択・全解除 */
  function toggleAllRecipients() {
    const allIds = recipientList.map((q) => q.id);
    const allSelected = allIds.length > 0 && allIds.every((id) => selectedRecipientIds.has(id));
    setSelectedRecipientIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        allIds.forEach((id) => next.delete(id));
      } else {
        allIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }

  /** 選んだ宛先へ一括送信を要求 */
  function requestComposeSend() {
    const chosen = inquiries.filter((q) => selectedRecipientIds.has(q.id));
    const targets: SendTarget[] = chosen.map((q) => {
      const { subject, body } = renderForInquiry(q, composeSubject, composeBody);
      return { inquiry: q, subject, body, templateId: composeTemplateId || null, label: toName(q) };
    });
    if (targets.length > 0) setPendingSend(targets);
  }

  // ============================================================
  // 送信実行（共通）
  // ============================================================

  async function executeSend() {
    if (!pendingSend) return;
    // 再入ガード: 確認ダイアログの連打や送信中の再呼び出しによる二重送信を防ぐ。
    if (sendingRef.current) return;
    sendingRef.current = true;

    const targets = pendingSend;
    setPendingSend(null);
    setIsSending(true);
    setSendResult(null);
    setSendProgress({ current: 0, total: targets.length });

    let success = 0;
    const errors: { label: string; message: string }[] = [];

    try {
      for (let i = 0; i < targets.length; i++) {
        const t = targets[i];
        setSendProgress({ current: i + 1, total: targets.length });
        try {
          const settings = settingsMap[t.inquiry.school_id] ?? null;
          const schoolName = schoolNameMap[t.inquiry.school_id] ?? '';
          await sendInquiryMail({
            inquiry: t.inquiry,
            subject: t.subject,
            body: t.body,
            fromName: settings?.sender_name || schoolName || undefined,
            replyTo: settings?.mail_reply_to || undefined,
            templateId: t.templateId,
          });
          success++;
        } catch (err) {
          errors.push({
            label: t.label,
            message: getUserErrorMessage(err, 'メール送信に失敗しました'),
          });
        }
        // 最後の1件は待機不要
        if (i < targets.length - 1) {
          await new Promise((res) => setTimeout(res, 700));
        }
      }

      setSendResult({ success, failed: errors.length, errors });

      // 選んで送信タブは送信済みの選択をクリアする
      setSelectedRecipientIds(new Set());

      // ログ再取得 → 送信候補を再計算（送信済みが除外される）
      await fetchData();
    } finally {
      // 例外時もガード・送信中フラグを必ず解除する
      sendingRef.current = false;
      setIsSending(false);
      setSendProgress(null);
    }
  }

  // ============================================================
  // ローディング・権限チェック
  // ============================================================

  if (profile === null) {
    return (
      <AdminLayout headerTitle="追客メール">
        <Loading className="min-h-[60vh]" />
      </AdminLayout>
    );
  }

  if (!isAdmin) {
    return (
      <AdminLayout>
        <AccessDenied message="追客メールは教室長以上が利用できます" />
      </AdminLayout>
    );
  }

  // 選択件数など
  const selectedCount = candidates.filter((c) => selectedKeys.has(candidateKey(c))).length;
  const allChecked = candidates.length > 0 && selectedKeys.size === candidates.length;
  const allRecipientsChecked =
    recipientList.length > 0 && recipientList.every((q) => selectedRecipientIds.has(q.id));

  // 選んで送信のプレビュー（先頭の選択宛先、なければサンプル）
  const composePreview = (() => {
    const first = inquiries.find((q) => selectedRecipientIds.has(q.id));
    if (first) return renderForInquiry(first, composeSubject, composeBody);
    return {
      subject: renderTemplate(composeSubject, {
        保護者: '山田 花子',
        生徒: '山田 太郎',
        教室名: 'スクールIE○○校',
        教室電話: '000-0000-0000',
        署名: '担当',
        面談設定URL: 'https://calendar.app.google/xxxxxxxx',
      }),
      body: renderTemplate(composeBody, {
        保護者: '山田 花子',
        生徒: '山田 太郎',
        教室名: 'スクールIE○○校',
        教室電話: '000-0000-0000',
        署名: '担当',
        面談設定URL: 'https://calendar.app.google/xxxxxxxx',
      }),
    };
  })();

  const tabs: { key: TabKey; label: string; icon: typeof Send }[] = [
    { key: 'candidates', label: '送信候補', icon: Send },
    { key: 'compose', label: '選んで送信', icon: Users },
    { key: 'templates', label: 'テンプレート', icon: FileText },
  ];

  return (
    <AdminLayout headerTitle="追客メール">
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

      {/* タブ */}
      <div className="mb-5 flex items-center gap-1 border-b border-border">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = activeTab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setActiveTab(t.key)}
              className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors duration-150 ${
                active
                  ? 'border-ink text-text-heading'
                  : 'border-transparent text-text-muted hover:text-text-body'
              }`}
            >
              <Icon className="w-4 h-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* エラーバナー */}
      {errorMessage && (
        <div className="mb-4 p-4 bg-danger/20 border border-danger rounded-lg">
          <p className="text-sm text-danger">{errorMessage}</p>
        </div>
      )}

      {/* 送信結果バナー（タブ共通） */}
      {sendResult && (
        <div
          className={`mb-4 p-4 rounded-lg border ${sendResult.failed === 0 ? 'bg-success-subtle border-success/40' : 'bg-warning-subtle border-warning/40'}`}
        >
          <div className="flex items-center gap-2 mb-2">
            {sendResult.failed === 0 ? (
              <CheckCircle className="w-4 h-4 text-success" />
            ) : (
              <AlertCircle className="w-4 h-4 text-warning" />
            )}
            <span className="text-sm font-medium text-text-heading">
              送信完了: 成功 {sendResult.success}件 / 失敗 {sendResult.failed}件
            </span>
          </div>
          {sendResult.errors.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-danger">
              {sendResult.errors.map((e, i) => (
                <li key={i}>
                  {e.label}: {e.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* 送信進捗（タブ共通） */}
      {isSending && sendProgress && (
        <div className="mb-4 p-4 bg-info-subtle border border-info/40 rounded-lg">
          <p className="text-sm text-info font-medium">
            送信中 {sendProgress.current} / {sendProgress.total} 件...
          </p>
          <div className="mt-2 h-2 bg-info/20 rounded-full overflow-hidden">
            <div
              className="h-full bg-info rounded-full transition-[width] duration-300 ease-out"
              style={{ width: `${Math.round((sendProgress.current / sendProgress.total) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* ============================================================
          タブ1: 送信候補
      ============================================================ */}
      {activeTab === 'candidates' && (
        <div className="bg-surface-raised rounded-xl border border-border p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold text-text-heading">本日の送信候補</h2>
              <p className="text-xs text-text-muted mt-0.5">
                ステップメールの送信タイミングに該当し、未送信の問合せを表示しています。
                「確認」から件名・本文を編集できます。
              </p>
            </div>
            {candidates.length > 0 && (
              <Button
                variant="primary"
                size="sm"
                onClick={requestBulkSendCandidates}
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
                    <th className="border border-border px-3 py-2.5 text-center font-medium text-text-heading w-24">
                      確認・編集
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((c) => {
                    const key = candidateKey(c);
                    const edited = overrides.has(key);
                    return (
                      <tr
                        key={key}
                        className="hover:bg-surface-hover transition-colors duration-100"
                      >
                        <td className="border border-border px-3 py-2.5 text-center">
                          <input
                            type="checkbox"
                            checked={selectedKeys.has(key)}
                            onChange={() => toggleSelect(key)}
                            className="cursor-pointer"
                          />
                        </td>
                        <td className="border border-border px-3 py-2.5 font-medium text-text-heading">
                          {toName(c.inquiry)}
                          {edited && (
                            <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] bg-warning-subtle text-text-body align-middle">
                              編集済
                            </span>
                          )}
                        </td>
                        <td className="border border-border px-3 py-2.5 text-text-body">
                          {schoolNameMap[c.inquiry.school_id] ?? '—'}
                        </td>
                        <td className="border border-border px-3 py-2.5 text-text-body">
                          <span>{c.template.name}</span>
                          <span className="ml-1.5 text-xs text-text-muted">
                            ({c.template.trigger_days}日後)
                          </span>
                        </td>
                        <td className="border border-border px-3 py-2.5 text-center text-text-body">
                          {c.daysSince}日
                        </td>
                        <td className="border border-border px-3 py-2.5 text-text-body text-xs">
                          {c.inquiry.email ?? '—'}
                        </td>
                        <td className="border border-border px-3 py-2.5 text-center">
                          <button
                            type="button"
                            onClick={() => openEdit(c)}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs text-text-muted hover:text-text-heading border border-border rounded hover:bg-surface-hover transition-colors duration-150"
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
      )}

      {/* ============================================================
          タブ2: 選んで送信
      ============================================================ */}
      {activeTab === 'compose' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* 左: 本文エディタ */}
          <div className="bg-surface-raised rounded-xl border border-border p-5">
            <h2 className="text-lg font-bold text-text-heading mb-3">本文</h2>

            {/* テンプレート選択 */}
            <div className="mb-3">
              <label className="block text-xs font-medium text-text-heading mb-1">
                テンプレートを読み込む
              </label>
              <select
                value={composeTemplateId}
                onChange={(e) => applyComposeTemplate(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface-raised text-text-body focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">テンプレートなし（自由入力）</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.school_id ? '' : '（共通）'}
                  </option>
                ))}
              </select>
            </div>

            {/* 変数チップ */}
            <div className="mb-3">
              <p className="text-xs text-text-muted mb-1.5">
                変数（クリックで挿入。送信時に宛先ごとに置換されます）
              </p>
              <div className="flex flex-wrap gap-2">
                {VAR_CHIPS.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => insertComposeVar(chip)}
                    className="px-2.5 py-1 text-xs rounded border border-primary text-primary bg-primary/5 hover:bg-primary/15 transition-colors duration-150"
                  >
                    {chip}
                  </button>
                ))}
              </div>
            </div>

            {/* 件名 */}
            <div className="mb-3">
              <label className="block text-xs font-medium text-text-heading mb-1">件名</label>
              <input
                ref={composeSubjectRef}
                type="text"
                value={composeSubject}
                onChange={(e) => setComposeSubject(e.target.value)}
                onFocus={() => {
                  lastComposeField.current = 'subject';
                }}
                placeholder="例: 体験授業のご案内（{教室名}）"
                className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface-raised text-text-body focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            {/* 本文 */}
            <div className="mb-3">
              <label className="block text-xs font-medium text-text-heading mb-1">本文</label>
              <textarea
                ref={composeBodyRef}
                value={composeBody}
                onChange={(e) => setComposeBody(e.target.value)}
                onFocus={() => {
                  lastComposeField.current = 'body';
                }}
                rows={10}
                placeholder="{保護者} 様&#10;&#10;お問い合わせいただきありがとうございます。"
                className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface-raised text-text-body focus:outline-none focus:ring-2 focus:ring-primary resize-none"
              />
            </div>

            {/* プレビュー */}
            {(composeSubject || composeBody) && (
              <div className="border border-border rounded-lg p-3 bg-surface-hover">
                <p className="text-xs font-medium text-text-muted mb-2">
                  プレビュー（
                  {selectedRecipientIds.size > 0 ? '先頭の宛先で置換' : 'サンプルで置換'}）
                </p>
                {composePreview.subject && (
                  <p className="text-sm font-medium text-text-heading mb-2 break-all">
                    件名: {composePreview.subject}
                  </p>
                )}
                {composePreview.body && (
                  <p className="text-sm text-text-body whitespace-pre-wrap">
                    {composePreview.body}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* 右: 宛先選択 */}
          <div className="bg-surface-raised rounded-xl border border-border p-5 flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-bold text-text-heading">宛先を選ぶ</h2>
              <span className="text-sm text-text-muted">{selectedRecipientIds.size}件選択中</span>
            </div>

            {/* 検索 + ステータス絞り込み */}
            <div className="flex items-center gap-2 mb-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-text-faint" />
                <input
                  type="text"
                  value={recipientSearch}
                  onChange={(e) => setRecipientSearch(e.target.value)}
                  placeholder="氏名・電話・メールで検索"
                  className="w-full pl-8 pr-3 py-1.5 border border-border rounded-lg text-sm bg-surface-raised text-text-heading focus:outline-none focus:ring-2 focus:ring-primary placeholder:text-text-faint"
                />
              </div>
              <select
                value={recipientStatus}
                onChange={(e) => setRecipientStatus(e.target.value as InquiryStatus | 'all')}
                className="px-2 py-1.5 border border-border rounded-lg text-sm bg-surface-raised text-text-body focus:outline-none focus:ring-2 focus:ring-primary shrink-0"
              >
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            {/* 全選択 */}
            <div className="flex items-center justify-between mb-2 px-1">
              <label className="inline-flex items-center gap-1.5 text-xs text-text-body cursor-pointer">
                <input
                  type="checkbox"
                  checked={allRecipientsChecked}
                  onChange={toggleAllRecipients}
                  className="cursor-pointer"
                />
                表示中の {recipientList.length} 件を全選択
              </label>
              <p className="text-xs text-text-muted">メールアドレスのある問合せのみ表示</p>
            </div>

            {/* 宛先リスト */}
            <div className="flex-1 min-h-0 overflow-y-auto border border-border rounded-lg divide-y divide-border max-h-[28rem]">
              {recipientList.length === 0 ? (
                <p className="text-center py-8 text-sm text-text-muted">該当する宛先がありません</p>
              ) : (
                recipientList.map((q) => {
                  const checked = selectedRecipientIds.has(q.id);
                  const sc = STATUS_CONFIG[q.status];
                  return (
                    <label
                      key={q.id}
                      className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer transition-colors duration-100 ${checked ? 'bg-primary/10' : 'hover:bg-surface-hover'}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleRecipient(q.id)}
                        className="cursor-pointer shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-text-heading text-sm truncate">
                            {q.student_name || q.guardian_name || 'お客様'}
                          </span>
                          {q.grade && (
                            <span className="text-xs text-text-muted shrink-0">{q.grade}</span>
                          )}
                          {sc && (
                            <span
                              className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium shrink-0 ${sc.className}`}
                            >
                              {sc.label}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-text-muted truncate">{q.email}</p>
                      </div>
                    </label>
                  );
                })
              )}
            </div>

            {/* 送信ボタン */}
            <div className="mt-3 pt-3 border-t border-border flex items-center justify-end">
              <Button
                variant="primary"
                size="sm"
                onClick={requestComposeSend}
                disabled={
                  isSending ||
                  selectedRecipientIds.size === 0 ||
                  (composeSubject.trim() === '' && composeBody.trim() === '')
                }
              >
                <Send className="w-4 h-4 mr-1.5" />
                {selectedRecipientIds.size}件に送信
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================
          タブ3: テンプレート
      ============================================================ */}
      {activeTab === 'templates' && (
        // テンプレ変更後はメールページのテンプレ一覧も再取得して送信フォームに反映
        <InquiryTemplateManager onChanged={fetchData} />
      )}

      {/* ============================================================
          確認・編集モーダル（送信候補タブ）
      ============================================================ */}
      {editTarget && (
        <div
          className="modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => setEditTarget(null)}
        >
          <div
            className="modal-panel bg-surface-raised rounded-xl border border-border shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h3 className="text-base font-bold text-text-heading">メールの確認・編集</h3>
              <button
                type="button"
                onClick={() => setEditTarget(null)}
                className="text-text-muted hover:text-text-body transition-colors duration-150"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* 宛先情報 */}
            <div className="px-6 py-3 bg-surface-hover border-b border-border text-xs space-y-1">
              <div>
                <span className="text-text-muted w-20 inline-block">テンプレート</span>
                <span className="text-text-body">{editTarget.templateName}</span>
              </div>
              <div>
                <span className="text-text-muted w-20 inline-block">宛先</span>
                <span className="text-text-body">
                  {editTarget.toName}（{editTarget.toEmail}）
                </span>
              </div>
            </div>

            {/* 編集フォーム */}
            <div className="px-6 py-4 overflow-y-auto flex-1 space-y-3">
              <div>
                <label className="block text-xs font-medium text-text-heading mb-1">件名</label>
                <input
                  type="text"
                  value={editTarget.subject}
                  onChange={(e) => setEditTarget({ ...editTarget, subject: e.target.value })}
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface-raised text-text-body focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-heading mb-1">本文</label>
                <textarea
                  value={editTarget.body}
                  onChange={(e) => setEditTarget({ ...editTarget, body: e.target.value })}
                  rows={12}
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface-raised text-text-body focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                />
                <p className="text-[11px] text-text-muted mt-1">
                  この内容は宛先ごとに差し込み済みです。ここでの編集はこの1通だけに反映されます。
                </p>
              </div>
            </div>

            {/* フッター */}
            <div className="px-6 py-3 border-t border-border flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={resetOverride}
                className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-text-body transition-colors duration-150"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                テンプレートに戻す
              </button>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={saveOverride}>
                  編集を保存
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={sendSingleFromEdit}
                  disabled={isSending}
                >
                  <Send className="w-4 h-4 mr-1.5" />
                  この1件を送信
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================
          送信確認モーダル（共通）
      ============================================================ */}
      {pendingSend && (
        <div
          className="modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => setPendingSend(null)}
        >
          <div
            className="modal-panel bg-surface-raised rounded-xl border border-border shadow-xl w-full max-w-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h3 className="text-base font-bold text-text-heading">送信確認</h3>
              <button
                type="button"
                onClick={() => setPendingSend(null)}
                className="text-text-muted hover:text-text-body transition-colors duration-150"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-6 py-5">
              <p className="text-sm text-text-body">
                <span className="font-bold text-text-heading">{pendingSend.length} 件</span> に
                メールを送信します。送信後は取り消せません。
              </p>
            </div>
            <div className="px-6 pb-5 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setPendingSend(null)}>
                キャンセル
              </Button>
              <Button variant="primary" size="sm" onClick={executeSend}>
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
