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
    try {
      await navigator.clipboard.writeText(formUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
      alert('コピーに失敗しました');
    }
  };

  if (!form) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="フォームリンク">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-[#2a2a2a] mb-2">
            フォームタイトル
          </label>
          <p className="text-[#0d0d0d] font-medium">{form.title}</p>
        </div>

        {isLoading ? (
          <div className="text-center py-4 text-[#2a2a2a]">読み込み中...</div>
        ) : (
          <>
            <div>
              <label className="block text-sm font-medium text-[#2a2a2a] mb-2">
                公開URL
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={formUrl}
                  readOnly
                  className="flex-1 px-3 py-2 border border-[#0d0d0d] rounded-lg text-sm bg-[#eff0f3] text-[#2a2a2a]"
                />
                <Button
                  onClick={handleCopy}
                  disabled={!formUrl || copied}
                  className="min-w-[100px]"
                >
                  {copied ? 'コピー済み' : 'コピー'}
                </Button>
              </div>
              <p className="text-xs text-[#2a2a2a]/60 mt-1">
                このURLを保護者に共有してください
              </p>
            </div>

            {form.status !== 'published' && (
              <div className="bg-[#ff8e3c]/20 text-[#0d0d0d] px-4 py-2 rounded border border-[#ff8e3c]">
                <p className="text-sm">
                  注意: このフォームは現在「{form.status === 'draft' ? '下書き' : '終了'}」状態です。
                  公開するにはフォームを編集して状態を「公開中」に変更してください。
                </p>
              </div>
            )}
          </>
        )}

        <div className="flex justify-end gap-2 pt-4 border-t border-[#0d0d0d]">
          <Button onClick={onClose} variant="secondary">
            閉じる
          </Button>
        </div>
      </div>
    </Modal>
  );
}
