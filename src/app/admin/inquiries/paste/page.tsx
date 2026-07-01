'use client';

/**
 * 問合せ管理 — 貼り付けクイック追加ページ。
 * admin / owner のみアクセス可。
 *
 * HPシステムの問合せ詳細ページを全選択コピー → このページに貼り付け →
 * パース結果確認・編集 → 1件登録 の3ステップUI。
 *
 * ステップ:
 *   1. paste   — textareaに貼り付け
 *   2. confirm — パース結果を編集可能フォームで表示（重複チェックあり）
 *   3. done    — 登録完了
 */

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { AdminLayout } from '@/components/layouts';
import { Loading } from '@/components/ui';
import { Button } from '@/components/ui';
import { useAuth } from '@/contexts/AuthContext';
import AccessDenied from '@/components/AccessDenied';
import { createInquiry, getInquiries } from '@/lib/api/inquiries';
import { getSchools } from '@/lib/api/schools';
import { getAllInquirySchoolSettings } from '@/lib/api/inquirySettings';
import { parsePastedInquiry } from '@/lib/utils/inquiryPaste';
import type { PastedInquiry } from '@/lib/utils/inquiryPaste';
import type { Inquiry, InquiryStatus } from '@/types/database';
import { STATUS_CONFIG, STATUS_OPTIONS, formatDate } from '../inquiryConstants';
import {
  ClipboardPaste,
  ChevronLeft,
  AlertTriangle,
  CheckCircle,
  Info,
  Search,
} from 'lucide-react';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';
import { isManagerOrAbove } from '@/lib/utils/roles';

/** 3ステップ */
type Step = 'paste' | 'confirm' | 'done';

/** フォームの編集状態（confirm ステップで使用） */
interface FormState {
  schoolId: string;
  inquiredAt: string; // datetime-local 形式 "YYYY-MM-DDTHH:mm"
  guardianName: string;
  guardianNameKana: string;
  studentName: string;
  studentNameKana: string;
  relationship: string;
  grade: string;
  gender: string;
  phone: string;
  email: string;
  postalCode: string;
  addressPref: string;
  addressDetail: string;
  addressBuilding: string;
  schoolNameField: string; // フォームの学校名（DBの school_id と区別するため suffix）
  media: string;
  channel: string;
  requestType: string;
  initialMessage: string;
  purpose: string;
  preferredSubjects: string;
  jukuExperience: string;
  status: InquiryStatus;
  materialSentAt: string;
  trialAt: string;
  interviewAt: string;
  enrolledAt: string;
  weeklyCount: string;
  note: string;
  hpInquiryNo: string;
}

/** ISO 文字列を datetime-local 入力値（"YYYY-MM-DDTHH:mm"）に変換 */
function isoToDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  // JST (+09:00) のローカル時刻で表示する
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 16);
}

/** ISO 文字列を date 入力値（"YYYY-MM-DD"）に変換 */
function isoToDateInput(iso: string | null | undefined): string {
  if (!iso) return '';
  return iso.slice(0, 10);
}

/** datetime-local の値を JST 扱いの ISO 文字列に変換 */
function datetimeLocalToIso(val: string): string | null {
  if (!val) return null;
  const d = new Date(val + '+09:00');
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** PastedInquiry から FormState を生成する */
function pastedToFormState(parsed: PastedInquiry): FormState {
  const d = parsed.data;
  return {
    schoolId: '',
    inquiredAt: isoToDatetimeLocal(d.inquired_at),
    guardianName: d.guardian_name ?? '',
    guardianNameKana: d.guardian_name_kana ?? '',
    studentName: d.student_name ?? '',
    studentNameKana: d.student_name_kana ?? '',
    relationship: d.relationship ?? '',
    grade: d.grade ?? '',
    gender: d.gender ?? '',
    phone: d.phone ?? '',
    email: d.email ?? '',
    postalCode: d.postal_code ?? '',
    addressPref: d.address_pref ?? '',
    addressDetail: d.address_detail ?? '',
    addressBuilding: d.address_building ?? '',
    schoolNameField: d.school_name ?? '',
    media: d.media ?? '',
    channel: d.channel ?? '',
    requestType: d.request_type ?? '',
    initialMessage: d.initial_message ?? '',
    purpose: d.purpose ?? '',
    preferredSubjects: d.preferred_subjects ?? '',
    jukuExperience: d.juku_experience ?? '',
    status: d.status ?? 'in_progress',
    materialSentAt: isoToDateInput(d.material_sent_at),
    trialAt: isoToDatetimeLocal(d.trial_at),
    interviewAt: isoToDatetimeLocal(d.interview_at),
    enrolledAt: isoToDateInput(d.enrolled_at),
    weeklyCount: d.weekly_count != null ? String(d.weekly_count) : '',
    note: d.note ?? '',
    hpInquiryNo: d.hp_inquiry_no ?? '',
  };
}

/** 媒体の選択肢 */
const MEDIA_OPTIONS = [
  '友人紹介',
  '看板・外パンフ',
  'チラシ',
  '本部HP',
  '塾ナビ',
  '塾選',
  '塾シル',
  'その他',
];

/** 問合せ経路の選択肢 */
const CHANNEL_OPTIONS = ['本部HP', '塾ナビ', '電話', '直来', '塾選', '塾シル', 'その他'];

/** 申込内容の選択肢 */
const REQUEST_TYPE_OPTIONS = ['無料体験授業', '資料請求', '学習相談・教室見学', 'その他'];

/** 学年の選択肢 */
const GRADE_OPTIONS = [
  '小1',
  '小2',
  '小3',
  '小4',
  '小5',
  '小6',
  '中1',
  '中2',
  '中3',
  '高1',
  '高2',
  '高3',
  '既卒',
];

export default function InquiriesPastePage() {
  const { profile } = useAuth();

  // ロールガード: 教室長以上（manager / owner / admin）。判定は roles.ts に一元化。
  const isAdmin = isManagerOrAbove(profile?.role);

  // ---- ステップ状態 ----
  const [step, setStep] = useState<Step>('paste');

  // ---- ステップ1: 貼り付けテキスト ----
  const [pasteText, setPasteText] = useState('');
  const [parseError, setParseError] = useState('');

  // ---- ステップ2: パース結果・フォーム ----
  const [parsed, setParsed] = useState<PastedInquiry | null>(null);
  const [parsedFieldCount, setParsedFieldCount] = useState(0);
  const [form, setForm] = useState<FormState | null>(null);
  const [schools, setSchools] = useState<{ id: string; name: string }[]>([]);
  const [schoolError, setSchoolError] = useState('');
  // 重複チェック結果
  const [dupInquiries, setDupInquiries] = useState<Inquiry[]>([]);
  const [isChecking, setIsChecking] = useState(false);

  // ---- ステップ3: 登録結果 ----
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [createdId, setCreatedId] = useState('');

  /** 貼り付けテキストをパースして confirm ステップへ進む */
  const handleParse = useCallback(async () => {
    const text = pasteText.trim();
    if (!text) {
      setParseError('テキストを貼り付けてください');
      return;
    }

    setParseError('');
    const result = parsePastedInquiry(text);
    if (!result) {
      setParseError(
        '受付日時を読み取れませんでした。HPの問合せ詳細ページを全選択（Ctrl+A）してコピーしてください。'
      );
      return;
    }

    // 取得フィールド数をカウント（値が空でないものを数える）
    const count = Object.values(result.fields).filter((v) => v.trim()).length;
    setParsedFieldCount(count);
    setParsed(result);

    // フォーム初期値を生成
    const fs = pastedToFormState(result);

    // ---- 教室リストを取得して school_id を解決 ----
    try {
      const [allSchools, allSettings] = await Promise.all([
        getSchools(),
        // 全教室の hp_school_code マップを取得するため全教室IDを渡す
        getSchools().then((ss) => getAllInquirySchoolSettings(ss.map((s) => s.id))),
      ]);
      setSchools(allSchools);

      // hp_school_code === schoolCode で解決を試みる
      let resolvedId = '';
      if (result.schoolCode) {
        const setting = allSettings.find((s) => s.hp_school_code === result.schoolCode);
        if (setting) resolvedId = setting.school_id;
      }

      // 解決できなければ schoolName === schools.name で試みる
      if (!resolvedId && result.schoolName) {
        const school = allSchools.find((s) => s.name === result.schoolName);
        if (school) resolvedId = school.id;
      }

      if (resolvedId) {
        fs.schoolId = resolvedId;
        setSchoolError('');
      } else {
        setSchoolError(
          `教室「${result.schoolRaw}」が見つかりません。下のセレクトから手動で選択してください。`
        );
      }
    } catch {
      setSchoolError('教室リストの取得に失敗しました。手動で選択してください。');
      const fallback = await getSchools().catch(() => []);
      setSchools(fallback);
    }

    setForm(fs);

    // ---- 重複チェック（電話 or メール一致）----
    setIsChecking(true);
    setDupInquiries([]);
    try {
      const phone = result.data.phone;
      const email = result.data.email;

      // 電話番号か有効なメールで既存問合せを検索
      const searchTerm = phone || email;
      if (searchTerm) {
        // 全教室横断で検索（管理者は全校のinquiriesが見える）
        const allSchools2 = await getSchools();
        const schoolIds = allSchools2.map((s) => s.id);
        const existing = await getInquiries(schoolIds, { search: searchTerm });
        setDupInquiries(existing.slice(0, 5)); // 最大5件表示
      }
    } catch {
      // 重複チェック失敗は無視（登録は続行可能）
    } finally {
      setIsChecking(false);
    }

    setStep('confirm');
  }, [pasteText]);

  /** フォームフィールドを更新するハンドラ */
  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  /** 確認ステップから登録を実行 */
  const handleSave = async () => {
    if (!form || !parsed) return;

    if (!form.schoolId) {
      setSaveError('教室を選択してください');
      return;
    }
    if (!form.inquiredAt) {
      setSaveError('受付日時は必須です');
      return;
    }

    setIsSaving(true);
    setSaveError('');

    try {
      const inquiredAt = datetimeLocalToIso(form.inquiredAt);
      if (!inquiredAt) throw new Error('受付日時の形式が不正です');

      const weeklyCount = form.weeklyCount ? parseInt(form.weeklyCount, 10) : null;

      const created = await createInquiry({
        school_id: form.schoolId,
        hp_inquiry_no: form.hpInquiryNo || null,
        inquired_at: inquiredAt,
        guardian_name: form.guardianName || null,
        guardian_name_kana: form.guardianNameKana || null,
        student_name: form.studentName || null,
        student_name_kana: form.studentNameKana || null,
        relationship: form.relationship || null,
        grade: form.grade || null,
        gender: form.gender || null,
        phone: form.phone || null,
        email: form.email || null,
        postal_code: form.postalCode || null,
        address_pref: form.addressPref || null,
        address_detail: form.addressDetail || null,
        address_building: form.addressBuilding || null,
        school_name: form.schoolNameField || null,
        media: form.media || null,
        channel: form.channel || null,
        request_type: form.requestType || null,
        device: null,
        initial_message: form.initialMessage || null,
        purpose: form.purpose || null,
        preferred_subjects: form.preferredSubjects || null,
        juku_experience: form.jukuExperience || null,
        status: form.status,
        material_sent_at: form.materialSentAt || null,
        trial_at: datetimeLocalToIso(form.trialAt),
        trial_teacher: null,
        interview_at: datetimeLocalToIso(form.interviewAt),
        enrolled_at: form.enrolledAt || null,
        weekly_count: isNaN(weeklyCount as number) ? null : weeklyCount,
        linked_student_id: null,
        referrer_inquiry_note: null,
        raw_source: parsed.data.raw_source,
        note: form.note || null,
        created_by: null,
      });

      setCreatedId(created.id);
      setStep('done');
    } catch (err) {
      setSaveError(getUserErrorMessage(err, '登録に失敗しました'));
    } finally {
      setIsSaving(false);
    }
  };

  /** ステップ1に戻る（続けて貼り付け） */
  const handleReset = () => {
    setPasteText('');
    setParseError('');
    setParsed(null);
    setForm(null);
    setDupInquiries([]);
    setSchoolError('');
    setSaveError('');
    setCreatedId('');
    setStep('paste');
  };

  // ---- ローディング / 権限 ----
  if (profile === null) {
    return (
      <AdminLayout headerTitle="貼り付けて追加">
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

  // ステップインジケーターの設定
  const steps = [
    { key: 'paste', label: '貼り付け' },
    { key: 'confirm', label: '確認・編集' },
    { key: 'done', label: '登録完了' },
  ];

  return (
    <AdminLayout headerTitle="貼り付けて追加">
      <div className="max-w-3xl">
        {/* 戻るリンク */}
        <Link
          href="/admin/inquiries"
          className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text-heading mb-6 transition-colors duration-150"
        >
          <ChevronLeft className="w-4 h-4" />
          問合せ一覧に戻る
        </Link>

        {/* ステップインジケーター */}
        <div className="flex items-center gap-0 mb-8">
          {steps.map((s, i) => {
            const isCurrent = s.key === step;
            const isDone =
              (s.key === 'paste' && (step === 'confirm' || step === 'done')) ||
              (s.key === 'confirm' && step === 'done');
            return (
              <div key={s.key} className="flex items-center">
                <div className="flex flex-col items-center">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-colors duration-150 ${
                      isDone
                        ? 'bg-success border-success text-white'
                        : isCurrent
                          ? 'bg-ink border-ink text-white'
                          : 'bg-surface-raised border-border text-text-muted'
                    }`}
                  >
                    {isDone ? <CheckCircle className="w-4 h-4" /> : i + 1}
                  </div>
                  <span
                    className={`mt-1 text-xs whitespace-nowrap ${
                      isCurrent ? 'text-text-heading font-medium' : 'text-text-muted'
                    }`}
                  >
                    {s.label}
                  </span>
                </div>
                {i < steps.length - 1 && (
                  <div
                    className={`h-0.5 w-16 mx-1 mt-[-1rem] transition-colors duration-150 ${
                      isDone ? 'bg-success/60' : 'bg-border'
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* ── STEP 1: 貼り付け ── */}
        {step === 'paste' && (
          <div className="space-y-4">
            <div className="bg-info-subtle border border-info/30 rounded-lg p-4 flex gap-3">
              <Info className="w-4 h-4 text-info shrink-0 mt-0.5" />
              <div className="text-sm text-info space-y-1">
                <p className="font-medium">HPの問合せ詳細ページから貼り付け</p>
                <p>
                  問合せ詳細ページを開き、全選択（Ctrl+A /
                  Cmd+A）してコピーし、下のテキストエリアに貼り付けてください。
                </p>
              </div>
            </div>

            <div className="bg-surface-raised border border-border rounded-xl p-6">
              <label className="block text-sm font-medium text-text-heading mb-2">
                貼り付けエリア
              </label>
              <textarea
                className="w-full h-64 px-3 py-2 border border-border rounded-lg text-sm bg-surface-raised text-text-body font-mono focus:outline-none focus:ring-2 focus:ring-primary resize-none placeholder-text-faint"
                placeholder="HPの問合せ詳細ページを全選択（Ctrl+A）してコピーし、ここに貼り付けてください"
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                onPaste={(e) => {
                  // onPaste 後に value が更新されるのを待って処理
                  requestAnimationFrame(() => {
                    const text = e.currentTarget.value;
                    if (text.trim()) {
                      setPasteText(text);
                    }
                  });
                }}
                autoFocus
              />
              {parseError && (
                <div className="mt-2 flex items-start gap-2 text-sm text-danger">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{parseError}</span>
                </div>
              )}
              <div className="mt-4 flex justify-end">
                <Button onClick={handleParse} disabled={!pasteText.trim()}>
                  <ClipboardPaste className="w-4 h-4 mr-1.5" />
                  読み取る
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ── STEP 2: 確認・編集 ── */}
        {step === 'confirm' && parsed && form && (
          <div className="space-y-5">
            {/* パース成功バナー */}
            <div className="bg-success-subtle border border-success/30 rounded-lg px-4 py-3 flex items-center gap-3">
              <CheckCircle className="w-4 h-4 text-success shrink-0" />
              <p className="text-sm text-success">
                <span className="font-semibold">{parsedFieldCount} 項目</span>を読み取りました
                {parsed.schoolRaw && (
                  <span className="ml-2 text-success/80">（教室: {parsed.schoolRaw}）</span>
                )}
              </p>
            </div>

            {/* パース警告 */}
            {parsed.warnings.length > 0 && (
              <div className="bg-warning-subtle border border-warning/30 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="w-4 h-4 text-warning" />
                  <p className="text-sm font-medium text-text-heading">確認事項</p>
                </div>
                <ul className="space-y-1">
                  {parsed.warnings.map((w, i) => (
                    <li key={i} className="text-xs text-text-body flex gap-1.5">
                      <span>・</span>
                      <span>{w}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* 重複チェック */}
            {isChecking && (
              <div className="flex items-center gap-2 text-sm text-text-muted">
                <Search className="w-4 h-4 animate-pulse" />
                <span>既存問合せを確認中...</span>
              </div>
            )}
            {!isChecking && dupInquiries.length > 0 && (
              <div className="bg-warning-subtle border border-warning/40 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle className="w-4 h-4 text-warning" />
                  <p className="text-sm font-medium text-text-heading">
                    同じ電話番号/メールの問合せが {dupInquiries.length}{' '}
                    件あります（登録はブロックされません）
                  </p>
                </div>
                <div className="space-y-1.5">
                  {dupInquiries.map((inq) => {
                    const sc = STATUS_CONFIG[inq.status];
                    return (
                      <Link
                        key={inq.id}
                        href={`/admin/inquiries/${inq.id}`}
                        target="_blank"
                        className="flex items-center gap-3 p-2 bg-surface-raised border border-warning/30 rounded-lg text-xs hover:bg-surface-hover transition-colors duration-150"
                      >
                        <span className="text-text-muted shrink-0">
                          {formatDate(inq.inquired_at)}
                        </span>
                        <span className="font-medium text-text-heading">
                          {inq.student_name ?? inq.guardian_name ?? '—'}
                        </span>
                        <span className="text-text-muted">{inq.phone ?? inq.email ?? ''}</span>
                        <span
                          className={`ml-auto px-1.5 py-0.5 rounded-full font-medium shrink-0 ${sc.className}`}
                        >
                          {sc.label}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 教室選択エラー */}
            {schoolError && (
              <div className="bg-danger-subtle border border-danger/30 rounded-lg px-4 py-3 flex items-start gap-2 text-sm text-danger">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{schoolError}</span>
              </div>
            )}

            {/* ---- フォーム ---- */}
            <div className="bg-surface-raised border border-border rounded-xl divide-y divide-border">
              {/* 基本情報 */}
              <div className="p-5 space-y-4">
                <h3 className="text-sm font-semibold text-text-heading">基本情報</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* 教室 */}
                  <div>
                    <label className="block text-xs font-medium text-text-heading mb-1">
                      教室 <span className="text-danger">*</span>
                    </label>
                    <select
                      value={form.schoolId}
                      onChange={(e) => setField('schoolId', e.target.value)}
                      className={`w-full px-2 py-1.5 border rounded-lg text-sm bg-surface-raised text-text-body focus:outline-none focus:ring-2 focus:ring-primary ${
                        !form.schoolId ? 'border-danger' : 'border-border'
                      }`}
                    >
                      <option value="">教室を選択...</option>
                      {schools.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* 受付日時 */}
                  <div>
                    <label className="block text-xs font-medium text-text-heading mb-1">
                      受付日時 <span className="text-danger">*</span>
                    </label>
                    <input
                      type="datetime-local"
                      value={form.inquiredAt}
                      onChange={(e) => setField('inquiredAt', e.target.value)}
                      className="w-full px-2 py-1.5 border border-border rounded-lg text-sm bg-surface-raised text-text-body focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>

                  {/* ステータス */}
                  <div>
                    <label className="block text-xs font-medium text-text-heading mb-1">
                      ステータス
                    </label>
                    <select
                      value={form.status}
                      onChange={(e) => setField('status', e.target.value as InquiryStatus)}
                      className="w-full px-2 py-1.5 border border-border rounded-lg text-sm bg-surface-raised text-text-body focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      {STATUS_OPTIONS.filter((o) => o.value !== 'all').map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* HP問合せNO */}
                  <div>
                    <label className="block text-xs font-medium text-text-heading mb-1">
                      HP問合せNO
                    </label>
                    <input
                      type="text"
                      value={form.hpInquiryNo}
                      onChange={(e) => setField('hpInquiryNo', e.target.value)}
                      placeholder="例: 123456"
                      className="w-full px-2 py-1.5 border border-border rounded-lg text-sm bg-surface-raised text-text-body focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                </div>
              </div>

              {/* 保護者情報 */}
              <div className="p-5 space-y-4">
                <h3 className="text-sm font-semibold text-text-heading">保護者情報</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-text-heading mb-1">
                      保護者氏名（漢字）
                    </label>
                    <input
                      type="text"
                      value={form.guardianName}
                      onChange={(e) => setField('guardianName', e.target.value)}
                      className="w-full px-2 py-1.5 border border-border rounded-lg text-sm bg-surface-raised text-text-body focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-heading mb-1">
                      保護者氏名（カナ）
                    </label>
                    <input
                      type="text"
                      value={form.guardianNameKana}
                      onChange={(e) => setField('guardianNameKana', e.target.value)}
                      className="w-full px-2 py-1.5 border border-border rounded-lg text-sm bg-surface-raised text-text-body focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-heading mb-1">
                      電話番号
                    </label>
                    <input
                      type="text"
                      value={form.phone}
                      onChange={(e) => setField('phone', e.target.value)}
                      placeholder="例: 09012345678"
                      className="w-full px-2 py-1.5 border border-border rounded-lg text-sm bg-surface-raised text-text-body focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-heading mb-1">
                      メールアドレス
                    </label>
                    <input
                      type="email"
                      value={form.email}
                      onChange={(e) => setField('email', e.target.value)}
                      className="w-full px-2 py-1.5 border border-border rounded-lg text-sm bg-surface-raised text-text-body focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                </div>
              </div>

              {/* 生徒情報 */}
              <div className="p-5 space-y-4">
                <h3 className="text-sm font-semibold text-text-heading">生徒情報</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-text-heading mb-1">
                      生徒氏名（漢字）
                    </label>
                    <input
                      type="text"
                      value={form.studentName}
                      onChange={(e) => setField('studentName', e.target.value)}
                      className="w-full px-2 py-1.5 border border-border rounded-lg text-sm bg-surface-raised text-text-body focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-heading mb-1">
                      生徒氏名（カナ）
                    </label>
                    <input
                      type="text"
                      value={form.studentNameKana}
                      onChange={(e) => setField('studentNameKana', e.target.value)}
                      className="w-full px-2 py-1.5 border border-border rounded-lg text-sm bg-surface-raised text-text-body focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-heading mb-1">
                      生徒との関係性
                    </label>
                    <input
                      type="text"
                      value={form.relationship}
                      onChange={(e) => setField('relationship', e.target.value)}
                      placeholder="例: 母"
                      className="w-full px-2 py-1.5 border border-border rounded-lg text-sm bg-surface-raised text-text-body focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-heading mb-1">学年</label>
                    <select
                      value={form.grade}
                      onChange={(e) => setField('grade', e.target.value)}
                      className="w-full px-2 py-1.5 border border-border rounded-lg text-sm bg-surface-raised text-text-body focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      <option value="">—</option>
                      {GRADE_OPTIONS.map((g) => (
                        <option key={g} value={g}>
                          {g}
                        </option>
                      ))}
                      {/* パース値がリストにない場合も表示できるよう追加 */}
                      {form.grade && !GRADE_OPTIONS.includes(form.grade) && (
                        <option value={form.grade}>{form.grade}</option>
                      )}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-heading mb-1">性別</label>
                    <select
                      value={form.gender}
                      onChange={(e) => setField('gender', e.target.value)}
                      className="w-full px-2 py-1.5 border border-border rounded-lg text-sm bg-surface-raised text-text-body focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      <option value="">—</option>
                      <option value="男">男</option>
                      <option value="女">女</option>
                      <option value="不明">不明</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-heading mb-1">
                      学校名
                    </label>
                    <input
                      type="text"
                      value={form.schoolNameField}
                      onChange={(e) => setField('schoolNameField', e.target.value)}
                      className="w-full px-2 py-1.5 border border-border rounded-lg text-sm bg-surface-raised text-text-body focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                </div>
              </div>

              {/* 問合せ情報 */}
              <div className="p-5 space-y-4">
                <h3 className="text-sm font-semibold text-text-heading">問合せ情報</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-text-heading mb-1">媒体</label>
                    <select
                      value={form.media}
                      onChange={(e) => setField('media', e.target.value)}
                      className="w-full px-2 py-1.5 border border-border rounded-lg text-sm bg-surface-raised text-text-body focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      <option value="">—</option>
                      {MEDIA_OPTIONS.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                      {form.media && !MEDIA_OPTIONS.includes(form.media) && (
                        <option value={form.media}>{form.media}</option>
                      )}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-heading mb-1">
                      問合せ経路
                    </label>
                    <select
                      value={form.channel}
                      onChange={(e) => setField('channel', e.target.value)}
                      className="w-full px-2 py-1.5 border border-border rounded-lg text-sm bg-surface-raised text-text-body focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      <option value="">—</option>
                      {CHANNEL_OPTIONS.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                      {form.channel && !CHANNEL_OPTIONS.includes(form.channel) && (
                        <option value={form.channel}>{form.channel}</option>
                      )}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-heading mb-1">
                      申込内容
                    </label>
                    <select
                      value={form.requestType}
                      onChange={(e) => setField('requestType', e.target.value)}
                      className="w-full px-2 py-1.5 border border-border rounded-lg text-sm bg-surface-raised text-text-body focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      <option value="">—</option>
                      {REQUEST_TYPE_OPTIONS.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                      {form.requestType && !REQUEST_TYPE_OPTIONS.includes(form.requestType) && (
                        <option value={form.requestType}>{form.requestType}</option>
                      )}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-heading mb-1">
                      通塾目的
                    </label>
                    <input
                      type="text"
                      value={form.purpose}
                      onChange={(e) => setField('purpose', e.target.value)}
                      className="w-full px-2 py-1.5 border border-border rounded-lg text-sm bg-surface-raised text-text-body focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-heading mb-1">
                      希望科目
                    </label>
                    <input
                      type="text"
                      value={form.preferredSubjects}
                      onChange={(e) => setField('preferredSubjects', e.target.value)}
                      className="w-full px-2 py-1.5 border border-border rounded-lg text-sm bg-surface-raised text-text-body focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-heading mb-1">
                      通塾経験
                    </label>
                    <input
                      type="text"
                      value={form.jukuExperience}
                      onChange={(e) => setField('jukuExperience', e.target.value)}
                      className="w-full px-2 py-1.5 border border-border rounded-lg text-sm bg-surface-raised text-text-body focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                </div>

                {/* 問合せ内容（複数行） */}
                <div>
                  <label className="block text-xs font-medium text-text-heading mb-1">
                    ご質問・ご要望
                  </label>
                  <textarea
                    value={form.initialMessage}
                    onChange={(e) => setField('initialMessage', e.target.value)}
                    rows={3}
                    className="w-full px-2 py-1.5 border border-border rounded-lg text-sm bg-surface-raised text-text-body focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                  />
                </div>
              </div>

              {/* 進捗情報 */}
              <div className="p-5 space-y-4">
                <h3 className="text-sm font-semibold text-text-heading">進捗</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-text-heading mb-1">
                      資料送付日
                    </label>
                    <input
                      type="date"
                      value={form.materialSentAt}
                      onChange={(e) => setField('materialSentAt', e.target.value)}
                      className="w-full px-2 py-1.5 border border-border rounded-lg text-sm bg-surface-raised text-text-body focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-heading mb-1">
                      面談日時
                    </label>
                    <input
                      type="datetime-local"
                      value={form.interviewAt}
                      onChange={(e) => setField('interviewAt', e.target.value)}
                      className="w-full px-2 py-1.5 border border-border rounded-lg text-sm bg-surface-raised text-text-body focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-heading mb-1">
                      体験日時
                    </label>
                    <input
                      type="datetime-local"
                      value={form.trialAt}
                      onChange={(e) => setField('trialAt', e.target.value)}
                      className="w-full px-2 py-1.5 border border-border rounded-lg text-sm bg-surface-raised text-text-body focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-heading mb-1">
                      入会成約日
                    </label>
                    <input
                      type="date"
                      value={form.enrolledAt}
                      onChange={(e) => setField('enrolledAt', e.target.value)}
                      className="w-full px-2 py-1.5 border border-border rounded-lg text-sm bg-surface-raised text-text-body focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-heading mb-1">
                      個別週回数
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="10"
                      value={form.weeklyCount}
                      onChange={(e) => setField('weeklyCount', e.target.value)}
                      className="w-full px-2 py-1.5 border border-border rounded-lg text-sm bg-surface-raised text-text-body focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                </div>

                {/* メモ */}
                <div>
                  <label className="block text-xs font-medium text-text-heading mb-1">メモ</label>
                  <textarea
                    value={form.note}
                    onChange={(e) => setField('note', e.target.value)}
                    rows={3}
                    className="w-full px-2 py-1.5 border border-border rounded-lg text-sm bg-surface-raised text-text-body focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                  />
                </div>
              </div>

              {/* 住所 */}
              <div className="p-5 space-y-4">
                <h3 className="text-sm font-semibold text-text-heading">住所</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-text-heading mb-1">
                      郵便番号
                    </label>
                    <input
                      type="text"
                      value={form.postalCode}
                      onChange={(e) => setField('postalCode', e.target.value)}
                      className="w-full px-2 py-1.5 border border-border rounded-lg text-sm bg-surface-raised text-text-body focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-heading mb-1">
                      都道府県
                    </label>
                    <input
                      type="text"
                      value={form.addressPref}
                      onChange={(e) => setField('addressPref', e.target.value)}
                      className="w-full px-2 py-1.5 border border-border rounded-lg text-sm bg-surface-raised text-text-body focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-text-heading mb-1">
                      ご住所
                    </label>
                    <input
                      type="text"
                      value={form.addressDetail}
                      onChange={(e) => setField('addressDetail', e.target.value)}
                      className="w-full px-2 py-1.5 border border-border rounded-lg text-sm bg-surface-raised text-text-body focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-text-heading mb-1">
                      建物名
                    </label>
                    <input
                      type="text"
                      value={form.addressBuilding}
                      onChange={(e) => setField('addressBuilding', e.target.value)}
                      className="w-full px-2 py-1.5 border border-border rounded-lg text-sm bg-surface-raised text-text-body focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* 登録エラー */}
            {saveError && (
              <div className="p-4 bg-danger/10 border border-danger rounded-lg flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
                <p className="text-sm text-danger">{saveError}</p>
              </div>
            )}

            {/* アクションボタン */}
            <div className="flex items-center justify-between">
              <Button variant="ghost" size="sm" onClick={handleReset}>
                やり直す
              </Button>
              <Button
                onClick={handleSave}
                isLoading={isSaving}
                disabled={!form.schoolId || !form.inquiredAt}
              >
                <CheckCircle className="w-4 h-4 mr-1.5" />
                この内容で登録する
              </Button>
            </div>
          </div>
        )}

        {/* ── STEP 3: 登録完了 ── */}
        {step === 'done' && (
          <div className="bg-surface-raised border border-border rounded-xl p-8">
            <div className="flex items-center gap-2 mb-6">
              <CheckCircle className="w-6 h-6 text-success" />
              <h2 className="text-lg font-bold text-text-heading">問合せを登録しました</h2>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              {createdId && (
                <Link href={`/admin/inquiries/${createdId}`}>
                  <Button size="sm">登録した問合せを確認する</Button>
                </Link>
              )}
              <Link href="/admin/inquiries">
                <Button variant="outline" size="sm">
                  問合せ一覧へ
                </Button>
              </Link>
              <Button variant="secondary" size="sm" onClick={handleReset}>
                <ClipboardPaste className="w-4 h-4 mr-1.5" />
                続けて貼り付ける
              </Button>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
