'use client';

/**
 * 講習申込リンク（トークンURL＋QR）の発行ダイアログ。
 *
 * 正典仕様: docs/koushu-auto-allocation-spec.md §10-4・§16-4（決定19）。
 * スコープは「生徒 × 講習期間」で、提案書1枚ごとではない
 * （フォームはその生徒の提案を全部まとめて見せるため）。
 *
 * ★ 開くだけでは発行しない。「発行する」を押したときにだけトークン行を作る。
 *   一覧を眺めただけで全生徒ぶんのURLが生えるのを避けるため。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Copy, Download, Link2, RefreshCw } from 'lucide-react';
import { Modal, Button, InlineLoading } from '@/components/ui';
import {
  buildApplyUrl,
  getActiveApplyTokens,
  issueApplyToken,
  revokeApplyToken,
  type KoushuApplyToken,
} from '@/lib/api/koushuApplyAdmin';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';
import { SEASON_LABELS, type SeasonType } from '@/types/database';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  schoolId: string;
  studentId: string;
  studentName: string;
  season: SeasonType;
  year: number;
  /** 申込済みか（読み取り専用の表示。再発行しても申込は消えない旨を伝える） */
  alreadyApplied: boolean;
  onError?: (message: string) => void;
  onSuccess?: (message: string) => void;
}

export function KoushuApplyLinkModal({
  isOpen,
  onClose,
  schoolId,
  studentId,
  studentName,
  season,
  year,
  alreadyApplied,
  onError,
  onSuccess,
}: Props) {
  const [token, setToken] = useState<KoushuApplyToken | null>(null);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const url = token ? buildApplyUrl(token.token) : '';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const map = await getActiveApplyTokens(schoolId, season, year, [studentId]);
      setToken(map.get(studentId) ?? null);
    } catch (err) {
      console.error('[KoushuApplyLinkModal] トークン取得に失敗:', err);
      onError?.(getUserErrorMessage(err, '申込リンクの取得に失敗しました'));
    } finally {
      setLoading(false);
    }
    // onError は呼び出し側で毎レンダー再生成されうるため依存に入れない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId, season, year, studentId]);

  useEffect(() => {
    if (isOpen) {
      setCopied(false);
      load();
    } else {
      setToken(null);
    }
  }, [isOpen, load]);

  // QR は URL が決まってから描く（canvas はモーダルが開いている間しか存在しない）
  useEffect(() => {
    if (!url || !canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, url, {
      width: 200,
      margin: 2,
      color: { dark: '#1a1a1a', light: '#ffffff' },
    }).catch((err) => {
      console.error('[KoushuApplyLinkModal] QR生成に失敗:', err);
    });
  }, [url]);

  const handleIssue = async () => {
    setWorking(true);
    try {
      const issued = await issueApplyToken({ schoolId, studentId, season, year });
      setToken(issued);
      onSuccess?.('申込リンクを発行しました');
    } catch (err) {
      console.error('[KoushuApplyLinkModal] 発行に失敗:', err);
      onError?.(getUserErrorMessage(err, '申込リンクの発行に失敗しました'));
    } finally {
      setWorking(false);
    }
  };

  /** 失効 → 新規発行。配布済みのURLはその場で使えなくなる */
  const handleReissue = async () => {
    if (!token) return;
    if (
      !confirm(
        '今のURL・QRは使えなくなります。配布済みのものを無効にして作り直しますか？\n（既に届いている申込は消えません）'
      )
    ) {
      return;
    }
    setWorking(true);
    try {
      await revokeApplyToken(token.token);
      const issued = await issueApplyToken({ schoolId, studentId, season, year });
      setToken(issued);
      onSuccess?.('申込リンクを再発行しました');
    } catch (err) {
      console.error('[KoushuApplyLinkModal] 再発行に失敗:', err);
      onError?.(getUserErrorMessage(err, '申込リンクの再発行に失敗しました'));
    } finally {
      setWorking(false);
    }
  };

  const handleCopy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('[KoushuApplyLinkModal] コピーに失敗:', err);
      onError?.('コピーに失敗しました');
    }
  };

  const handleDownload = () => {
    if (!canvasRef.current) return;
    const dataUrl = canvasRef.current.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    // ファイル名に使えない文字（空白・記号）を潰す
    a.download = `koushu_apply_${studentName.replace(/[\s/\\:*?"<>|・（）]/g, '_')}_${year}${season}.png`;
    a.click();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="申込リンク" size="md">
      <div className="space-y-4">
        <div>
          <p className="text-sm font-medium text-text-heading">{studentName}</p>
          <p className="text-xs text-text-muted">
            {year} {SEASON_LABELS[season]}講習
          </p>
        </div>

        {alreadyApplied && (
          <div className="p-3 rounded-lg bg-success-subtle border border-success/30">
            <p className="text-xs text-text-body">
              この生徒はすでに申込済みです。URLを開くと申込内容が読み取り専用で表示されます。
            </p>
          </div>
        )}

        {loading ? (
          <div className="py-8 flex justify-center">
            <InlineLoading size="sm" />
          </div>
        ) : !token ? (
          <div className="py-6 flex flex-col items-center gap-3">
            <p className="text-sm text-text-body text-center">
              この生徒の申込リンクはまだ発行されていません。
            </p>
            <Button onClick={handleIssue} disabled={working}>
              <Link2 className="w-4 h-4 mr-1.5" />
              {working ? '発行中...' : '発行する'}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <canvas ref={canvasRef} className="rounded-lg" />

            <div className="w-full bg-surface-hover rounded-lg px-3 py-2">
              <p className="text-xs text-text-muted break-all leading-relaxed">{url}</p>
            </div>

            <div className="flex gap-2 w-full">
              <button
                type="button"
                onClick={handleCopy}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 border border-border rounded-lg text-sm text-text-body hover:bg-surface-hover transition-colors duration-150"
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4 text-success" />
                    <span className="text-success">コピー済み</span>
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
                QRを保存
              </button>
            </div>

            <button
              type="button"
              onClick={handleReissue}
              disabled={working}
              className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-heading underline disabled:opacity-50"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              {working ? '処理中...' : 'URLを作り直す（今のURLは無効になります）'}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
