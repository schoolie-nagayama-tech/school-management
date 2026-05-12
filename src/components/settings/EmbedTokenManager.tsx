'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button, Loading } from '@/components/ui';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/useToast';
import { useConfirm } from '@/hooks/useConfirm';
import { supabase } from '@/lib/supabase';
import { Copy, Trash2, Plus, ExternalLink, Eye, EyeOff, ChevronDown, ChevronUp, RefreshCw, ClipboardList } from 'lucide-react';

interface EmbedToken {
  id: string;
  school_id: string;
  token: string;
  label: string;
  embed_type: string;
  is_active: boolean;
  created_at: string;
}

export function EmbedTokenManager() {
  const { getSelectedSchoolIds } = useAuth();
  const { success, error: toastError } = useToast();
  const { confirm } = useConfirm();

  const [tokens, setTokens] = useState<EmbedToken[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showTokens, setShowTokens] = useState<Set<string>>(new Set());
  const [previewTokenId, setPreviewTokenId] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState(0);

  const schoolIds = getSelectedSchoolIds();
  const schoolId = schoolIds.length > 0 ? schoolIds[0] : null;

  const fetchTokens = useCallback(async () => {
    if (!schoolId) return;
    setIsLoading(true);
    const { data, error } = await supabase
      .from('embed_tokens')
      .select('*')
      .eq('school_id', schoolId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching tokens:', error);
    } else {
      setTokens((data as EmbedToken[]) || []);
    }
    setIsLoading(false);
  }, [schoolId]);

  useEffect(() => {
    fetchTokens();
  }, [fetchTokens]);

  const handleCreate = async () => {
    if (!schoolId) return;
    const { data, error } = await supabase
      .from('embed_tokens')
      .insert({
        school_id: schoolId,
        label: '申込状況ウィジェット',
        embed_type: 'applications',
      })
      .select()
      .single();

    if (error) {
      toastError('トークンの作成に失敗しました');
      return;
    }
    setTokens((prev) => [data as EmbedToken, ...prev]);
    success('埋め込みトークンを作成しました');
  };

  const handleDelete = async (token: EmbedToken) => {
    const confirmed = await confirm({
      title: 'トークン削除',
      description: `「${token.label}」の埋め込みトークンを削除しますか？このトークンを使用している埋め込みは動作しなくなります。`,
      confirmLabel: '削除する',
      variant: 'danger',
    });
    if (!confirmed) return;

    const { error } = await supabase
      .from('embed_tokens')
      .delete()
      .eq('id', token.id);

    if (error) {
      toastError('削除に失敗しました');
      return;
    }
    setTokens((prev) => prev.filter((t) => t.id !== token.id));
    success('トークンを削除しました');
  };

  const handleToggle = async (token: EmbedToken) => {
    const { error } = await supabase
      .from('embed_tokens')
      .update({ is_active: !token.is_active })
      .eq('id', token.id);

    if (error) {
      toastError('更新に失敗しました');
      return;
    }
    setTokens((prev) =>
      prev.map((t) => (t.id === token.id ? { ...t, is_active: !t.is_active } : t))
    );
    success(token.is_active ? 'トークンを無効化しました' : 'トークンを有効化しました');
  };

  const getEmbedUrl = (token: string, readonly = false) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}/embed/applications?token=${token}${readonly ? '&readonly=1' : ''}`;
  };

  const getIframeCode = (token: string) => {
    const url = getEmbedUrl(token);
    return `<iframe src="${url}" width="100%" height="600" frameborder="0" style="border:none;"></iframe>`;
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    success(`${label}をコピーしました`);
  };

  const toggleShowToken = (id: string) => {
    setShowTokens((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (!schoolId) {
    return <p className="text-sm text-gray-500">教室を選択してください</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-[#1e3a5f]">埋め込みウィジェット</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Google サイトやWebページに申込状況テーブルを埋め込めます
          </p>
        </div>
        <Button size="sm" onClick={handleCreate}>
          <Plus className="w-3.5 h-3.5 mr-1" />
          トークン作成
        </Button>
      </div>

      {isLoading ? (
        <Loading size="md" />
      ) : tokens.length === 0 ? (
        <div className="text-sm text-gray-500 text-center py-6 bg-gray-50 rounded-lg border border-dashed">
          埋め込みトークンがありません。「トークン作成」で作成してください。
        </div>
      ) : (
        <div className="space-y-3">
          {tokens.map((token) => (
            <div
              key={token.id}
              className={`border rounded-lg p-3 ${token.is_active ? 'bg-white border-gray-200' : 'bg-gray-50 border-gray-200 opacity-60'}`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{token.label}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${token.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}>
                    {token.is_active ? '有効' : '無効'}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleToggle(token)}
                    className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100 transition-colors duration-150"
                  >
                    {token.is_active ? '無効化' : '有効化'}
                  </button>
                  <button
                    onClick={() => handleDelete(token)}
                    className="text-xs text-red-500 hover:text-red-700 p-1 rounded hover:bg-red-50 transition-colors duration-150"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* トークン表示 */}
              <div className="flex items-center gap-1 mb-2">
                <code className="text-[10px] text-gray-500 bg-gray-100 px-2 py-1 rounded flex-1 overflow-hidden">
                  {showTokens.has(token.id) ? token.token : '••••••••••••••••'}
                </code>
                <button
                  onClick={() => toggleShowToken(token.id)}
                  className="p-1 hover:bg-gray-100 rounded transition-colors duration-150"
                  title={showTokens.has(token.id) ? 'トークンを隠す' : 'トークンを表示'}
                >
                  {showTokens.has(token.id) ? <EyeOff className="w-3.5 h-3.5 text-gray-400" /> : <Eye className="w-3.5 h-3.5 text-gray-400" />}
                </button>
              </div>

              {/* アクションボタン */}
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => copyToClipboard(getEmbedUrl(token.token), '埋め込みURL')}
                  className="flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-2 py-1 rounded transition-colors duration-150"
                >
                  <Copy className="w-3 h-3" /> URL（編集可）
                </button>
                <button
                  onClick={() => copyToClipboard(getEmbedUrl(token.token, true), '閲覧専用URL')}
                  className="flex items-center gap-1 text-[11px] text-gray-600 hover:text-gray-800 bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded transition-colors duration-150"
                >
                  <Copy className="w-3 h-3" /> URL（閲覧専用）
                </button>
                <button
                  onClick={() => copyToClipboard(getIframeCode(token.token), 'iframe埋め込みコード')}
                  className="flex items-center gap-1 text-[11px] text-purple-600 hover:text-purple-800 bg-purple-50 hover:bg-purple-100 px-2 py-1 rounded transition-colors duration-150"
                >
                  <Copy className="w-3 h-3" /> iframe
                </button>
                <a
                  href={getEmbedUrl(token.token)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[11px] text-green-600 hover:text-green-800 bg-green-50 hover:bg-green-100 px-2 py-1 rounded transition-colors duration-150"
                >
                  <ExternalLink className="w-3 h-3" /> 別タブで開く
                </a>
                <button
                  onClick={() => setPreviewTokenId(previewTokenId === token.id ? null : token.id)}
                  className="flex items-center gap-1 text-[11px] text-amber-600 hover:text-amber-800 bg-amber-50 hover:bg-amber-100 px-2 py-1 rounded transition-colors duration-150"
                >
                  {previewTokenId === token.id ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  プレビュー
                </button>
              </div>

              {/* プレビュー */}
              {previewTokenId === token.id && (
                <div className="mt-3 border border-gray-200 rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between bg-gray-50 px-3 py-1.5 border-b">
                    <span className="text-[11px] text-gray-500 font-medium flex items-center gap-1"><ClipboardList className="h-3 w-3" />プレビュー</span>
                    <button
                      onClick={() => setPreviewKey((k) => k + 1)}
                      className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-700 px-1.5 py-0.5 rounded hover:bg-gray-200 transition-colors duration-150"
                    >
                      <RefreshCw className="w-3 h-3" /> 再読み込み
                    </button>
                  </div>
                  <iframe
                    key={previewKey}
                    src={getEmbedUrl(token.token)}
                    className="w-full border-0"
                    style={{ height: '500px' }}
                    title="埋め込みプレビュー"
                  />
                </div>
              )}

              {/* 使い方 */}
              <div className="mt-2 text-[10px] text-gray-400">
                Google サイト → 挿入 → 埋め込み → URL入力 でiframeコードまたはURLを貼り付け
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
