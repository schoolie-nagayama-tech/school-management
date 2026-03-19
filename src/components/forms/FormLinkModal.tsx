'use client';

import { useState, useEffect } from 'react';
import { Modal, Button } from '@/components/ui';
import type { Form } from '@/types/database';
import { getDefaultSchoolId, getSchool } from '@/lib/api/schools';
import { supabase } from '@/lib/supabase';

interface FormLinkModalProps {
  isOpen: boolean;
  onClose: () => void;
  form: Form | null;
}

export function FormLinkModal({ isOpen, onClose, form }: FormLinkModalProps) {
  const [schoolCode, setSchoolCode] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // フォームのURLを生成
  const getFormUrl = () => {
    if (!form || !schoolCode) return '';
    return `${window.location.origin}/portal/${schoolCode}/${form.slug}`;
  };

  const formUrl = getFormUrl();

  // 学校コードを取得
  useEffect(() => {
    if (isOpen && form) {
      loadSchoolCode();
    }
  }, [isOpen, form]);

  const loadSchoolCode = async () => {
    setIsLoading(true);
    try {
      const schoolId = getDefaultSchoolId();
      const school = await getSchool(schoolId);
      if (school && school.code) {
        setSchoolCode(school.code);
      } else {
        // 学校IDから直接取得できない場合は、schoolsテーブルから取得
        const { data } = await supabase
          .from('schools')
          .select('code')
          .eq('id', schoolId)
          .single();
        if (data?.code) {
          setSchoolCode(data.code);
        }
      }
    } catch (error) {
      console.error('Error loading school code:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!formUrl) return;
    setErrorMessage('');
    try {
      await navigator.clipboard.writeText(formUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
      setErrorMessage('コピーに失敗しました');
    }
  };

  if (!form) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="フォームリンク">
      <div className="space-y-4">
        {errorMessage && (
          <div className="bg-[#ef4444]/20 text-[#ef4444] px-4 py-2 rounded border border-[#ef4444] text-sm">
            {errorMessage}
          </div>
        )}
        <div>
          <label className="block text-sm font-medium text-[#4b5563] mb-2">
            フォームタイトル
          </label>
          <p className="text-[#1f2937] font-medium">{form.title}</p>
        </div>

        {isLoading ? (
          <div className="text-center py-4 text-[#4b5563]">読み込み中...</div>
        ) : (
          <>
            <div>
              <label className="block text-sm font-medium text-[#4b5563] mb-2">
                公開URL
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={formUrl}
                  readOnly
                  className="flex-1 px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm bg-[#f3f4f6] text-[#4b5563]"
                />
                <Button
                  onClick={handleCopy}
                  disabled={!formUrl || copied}
                  className="min-w-[100px]"
                >
                  {copied ? 'コピー済み' : 'コピー'}
                </Button>
              </div>
              <p className="text-xs text-[#4b5563]/60 mt-1">
                このURLを保護者に共有してください
              </p>
            </div>

            {form.status !== 'published' && (
              <div className="bg-[#3b82f6]/20 text-[#1f2937] px-4 py-2 rounded border border-[#3b82f6]">
                <p className="text-sm">
                  注意: このフォームは現在「{form.status === 'draft' ? '下書き' : '終了'}」状態です。
                  公開するにはフォームを編集して状態を「公開中」に変更してください。
                </p>
              </div>
            )}
          </>
        )}

        <div className="flex justify-end gap-2 pt-4 border-t border-[#e5e7eb]">
          <Button onClick={onClose} variant="secondary">
            閉じる
          </Button>
        </div>
      </div>
    </Modal>
  );
}
