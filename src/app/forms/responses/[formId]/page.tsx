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
      <div className="min-h-screen bg-[#f3f4f6] flex items-center justify-center">
        <div className="text-[#4b5563]">読み込み中...</div>
      </div>
    );
  }

  if (error || !form) {
    return (
      <div className="min-h-screen bg-[#f3f4f6] flex items-center justify-center">
        <div className="text-center">
          <p className="text-[#ef4444] mb-4">{error || 'フォームが見つかりません'}</p>
          <Link
            href="/forms/manage"
            className="text-[#3b82f6] hover:underline"
          >
            フォーム管理に戻る
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f3f4f6]">
      {/* ヘッダー */}
      <header className="bg-white border-b border-[#e5e7eb]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <h1 className="text-xl font-bold text-[#1f2937]">{form.title}</h1>
              <span className="text-sm text-[#4b5563]">
                回答数: {responses.length}件
              </span>
            </div>
            <Link
              href="/forms/manage"
              className="px-4 py-2 text-[#4b5563] hover:text-[#1f2937] hover:bg-[#f3f4f6] rounded-lg transition-colors"
            >
              フォーム管理に戻る
            </Link>
          </div>
        </div>
      </header>

      {/* メインコンテンツ */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-xl border border-[#e5e7eb] p-6">
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
