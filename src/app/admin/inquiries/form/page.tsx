'use client';

/**
 * 管理側: 公開問合せフォームの URL・QRコード管理ページ。
 * admin / owner のみアクセス可。
 * 選択中の教室ごとに src バリエーション 3 種の URL と QRコードを表示する。
 */

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import QRCode from 'qrcode';
import { AdminLayout } from '@/components/layouts';
import { Loading } from '@/components/ui';
import { useAuth } from '@/contexts/AuthContext';
import { useMasterData } from '@/contexts/MasterDataContext';
import AccessDenied from '@/components/AccessDenied';
import { ArrowLeft, Copy, Check, Download } from 'lucide-react';

/** URL の src パラメータバリエーション */
const SRC_VARIANTS = [
  { label: '自社フォーム（srcなし）', src: null },
  { label: 'チラシ', src: 'チラシ' },
  { label: '看板・外パンフ', src: '看板' },
] as const;

/** 教室の表示に必要な最小限の型 */
interface SchoolInfo {
  id: string;
  name: string;
  code: string | null;
}

/**
 * QRコード 1 枚分のカード
 */
function QrCard({ url, label }: { url: string; label: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = useState(false);

  // QR を canvas に描画
  useEffect(() => {
    if (!canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, url, {
      width: 200,
      margin: 2,
      color: { dark: '#1a1a1a', light: '#ffffff' },
    }).catch((err) => {
      console.error('[QrCard] QR 生成失敗:', err);
    });
  }, [url]);

  /** URL をクリップボードにコピー */
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard API が使えない環境（http 等）では input を選択状態にして代替
      const input = document.createElement('input');
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  /** QR 画像を PNG でダウンロード */
  function handleDownload() {
    if (!canvasRef.current) return;
    const dataUrl = canvasRef.current.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    // ファイル名を label から生成（スラッシュ等を除去）
    a.download = `qr_${label.replace(/[/\s・（）]/g, '_')}.png`;
    a.click();
  }

  return (
    <div className="border border-border rounded-xl p-4 flex flex-col items-center gap-3 bg-white">
      <p className="text-sm font-medium text-text-heading text-center">{label}</p>

      {/* QRコード */}
      <canvas ref={canvasRef} className="rounded-lg" />

      {/* URL 表示 */}
      <div className="w-full bg-surface-hover rounded-lg px-3 py-2">
        <p className="text-xs text-text-muted break-all leading-relaxed">{url}</p>
      </div>

      {/* アクションボタン */}
      <div className="flex gap-2 w-full">
        <button
          type="button"
          onClick={handleCopy}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 border border-border rounded-lg text-sm text-text-body hover:bg-surface-hover transition-colors duration-150"
        >
          {copied ? (
            <>
              <Check className="w-4 h-4 text-green-600" />
              <span className="text-green-600">コピー済み</span>
            </>
          ) : (
            <>
              <Copy className="w-4 h-4" />
              URLコピー
            </>
          )}
        </button>
        <button
          type="button"
          onClick={handleDownload}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 border border-border rounded-lg text-sm text-text-body hover:bg-surface-hover transition-colors duration-150"
        >
          <Download className="w-4 h-4" />
          PNG保存
        </button>
      </div>
    </div>
  );
}

/**
 * 教室ごとのカード（URL + QR コード 3 種）
 */
function SchoolCard({ school, origin }: { school: SchoolInfo; origin: string }) {
  if (!school.code) {
    return (
      <div className="border border-border rounded-xl p-5 bg-surface-raised">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-text-heading">{school.name}</h3>
        </div>
        <p className="text-sm text-text-muted">
          教室コードが未設定です。設定→教室設定でコードを登録してください。
        </p>
      </div>
    );
  }

  return (
    <div className="border border-border rounded-xl p-5 bg-surface-raised">
      <h3 className="font-bold text-text-heading mb-4">{school.name}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {SRC_VARIANTS.map((v) => {
          const url = v.src
            ? `${origin}/inquiry/${school.code}?src=${encodeURIComponent(v.src)}`
            : `${origin}/inquiry/${school.code}`;
          return <QrCard key={v.label} url={url} label={v.label} />;
        })}
      </div>
    </div>
  );
}

export default function InquiryFormPage() {
  const { profile, getSelectedSchoolIds } = useAuth();
  const { schools: masterSchools } = useMasterData();

  // ロールガード: admin / owner のみ
  const isAdmin =
    profile?.role === 'admin' || profile?.role === 'owner' || profile?.role === 'manager';

  // 選択中の教室を絞り込み
  const [schools, setSchools] = useState<SchoolInfo[]>([]);
  const [origin, setOrigin] = useState('');

  useEffect(() => {
    // window.location.origin はブラウザでのみ取得できる
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    const selectedIds = getSelectedSchoolIds();
    const filtered = masterSchools
      .filter((s) => selectedIds.includes(s.id))
      .map((s) => ({ id: s.id, name: s.name, code: s.code ?? null }));
    setSchools(filtered);
  }, [getSelectedSchoolIds, masterSchools]);

  // ---- ロードガード ----
  if (profile === null) {
    return (
      <AdminLayout headerTitle="公開問合せフォーム">
        <Loading className="min-h-[60vh]" />
      </AdminLayout>
    );
  }

  if (!isAdmin) {
    return (
      <AdminLayout>
        <AccessDenied message="このページは管理者のみ利用できます" />
      </AdminLayout>
    );
  }

  return (
    <AdminLayout headerTitle="公開問合せフォーム">
      <div className="space-y-6">
        {/* 戻るリンク */}
        <div>
          <Link
            href="/admin/inquiries"
            className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text-heading transition-colors duration-150"
          >
            <ArrowLeft className="w-4 h-4" />
            問合せ一覧に戻る
          </Link>
        </div>

        {/* 説明文 */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
          <p className="text-sm text-blue-800 leading-relaxed">
            チラシや看板にQRコードを載せると、保護者が直接問合せでき、HPからの転記が不要になります。
            流入元（src）別に媒体が自動記録されます。
          </p>
          <ul className="mt-3 space-y-1 text-xs text-blue-700">
            <li>
              ・ <strong>自社フォーム（srcなし）</strong>: チラシ以外の汎用URL（HPへの掲載など）
            </li>
            <li>
              ・ <strong>チラシ</strong>: チラシに印刷するQR → 媒体「チラシ」として自動記録
            </li>
            <li>
              ・ <strong>看板・外パンフ</strong>: 看板や外設置のパンフへのQR →
              媒体「看板・外パンフ」として自動記録
            </li>
          </ul>
        </div>

        {/* 教室ごとのカード */}
        {schools.length === 0 ? (
          <div className="text-center py-12 text-text-muted text-sm">教室が選択されていません</div>
        ) : (
          <div className="space-y-6">
            {schools.map((school) => (
              <SchoolCard key={school.id} school={school} origin={origin} />
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
