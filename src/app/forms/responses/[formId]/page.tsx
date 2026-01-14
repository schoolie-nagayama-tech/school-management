'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { getForm, getFormResponses } from '@/lib/api/forms';
import { ResponseList } from '@/components/forms';
import type { Form, FormResponse } from '@/types/database';

export default function FormResponsesPage() {
  const params = useParams();
  const formId = params.formId as string;

  const [form, setForm] = useState<Form | null>(null);
  const [responses, setResponses] = useState<FormResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const [formData, responsesData] = await Promise.all([
        getForm(formId),
        getFormResponses(formId),
      ]);
      setForm(formData);
      setResponses(responsesData);
    } catch (error) {
      console.error('Error loading data:', error);
      setError(
        error instanceof Error ? error.message : 'データの読み込みに失敗しました'
      );
    } finally {
      setIsLoading(false);
    }
  }, [formId]);

  useEffect(() => {
    if (formId) {
      loadData();
    }
  }, [formId, loadData]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#eff0f3] flex items-center justify-center">
        <div className="text-[#2a2a2a]">読み込み中...</div>
      </div>
    );
  }

  if (error || !form) {
    return (
      <div className="min-h-screen bg-[#eff0f3] flex items-center justify-center">
        <div className="text-center">
          <p className="text-[#d9376e] mb-4">{error || 'フォームが見つかりません'}</p>
          <Link
            href="/forms/manage"
            className="text-[#ff8e3c] hover:underline"
          >
            フォーム管理に戻る
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#eff0f3]">
      {/* ヘッダー */}
      <header className="bg-[#fffffe] border-b border-[#0d0d0d]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <h1 className="text-xl font-bold text-[#0d0d0d]">{form.title}</h1>
              <span className="text-sm text-[#2a2a2a]">
                回答数: {responses.length}件
              </span>
            </div>
            <Link
              href="/forms/manage"
              className="px-4 py-2 text-[#2a2a2a] hover:text-[#0d0d0d] hover:bg-[#eff0f3] rounded-lg transition-colors"
            >
              フォーム管理に戻る
            </Link>
          </div>
        </div>
      </header>

      {/* メインコンテンツ */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-[#fffffe] rounded-xl border border-[#0d0d0d] p-6">
          <ResponseList
            responses={responses}
            formId={formId}
            onRefresh={loadData}
          />
        </div>
      </div>
    </div>
  );
}
