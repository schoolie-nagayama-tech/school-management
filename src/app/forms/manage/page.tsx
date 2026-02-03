'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { TemplateList, FormList, FormEditor } from '@/components/forms';
import { getDefaultSchoolId, getSchool } from '@/lib/api/schools';
import type { FormTemplate, Form } from '@/types/database';

type TabType = 'templates' | 'forms';

export default function FormsManagePage() {
  const pathname = usePathname();
  const [activeTab, setActiveTab] = useState<TabType>('forms');
  const [schoolCode, setSchoolCode] = useState<string>('');
  const [selectedTemplate, setSelectedTemplate] = useState<FormTemplate | null>(null);
  const [isFormEditorOpen, setIsFormEditorOpen] = useState(false);
  const [editingFormId, setEditingFormId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // 教室コードを取得
  useEffect(() => {
    const loadSchoolCode = async () => {
      try {
        const schoolId = getDefaultSchoolId();
        const school = await getSchool(schoolId);
        if (school?.code) {
          setSchoolCode(school.code);
        }
      } catch (error) {
        console.error('Error loading school code:', error);
      }
    };
    loadSchoolCode();
  }, []);

  const handleSelectTemplate = (template: FormTemplate) => {
    setSelectedTemplate(template);
    setIsFormEditorOpen(true);
    setEditingFormId(null);
    setActiveTab('forms');
  };

  const handleEditForm = (form: Form) => {
    setSelectedTemplate(null);
    setEditingFormId(form.id);
    setIsFormEditorOpen(true);
  };

  const handleViewResponses = () => {
    // Part 2で実装
    alert('回答一覧機能はPart 2で実装予定です');
  };

  const handleFormEditorSuccess = () => {
    setIsFormEditorOpen(false);
    setSelectedTemplate(null);
    setEditingFormId(null);
    setRefreshKey((prev) => prev + 1);
  };

  return (
    <div className="min-h-screen bg-[#f3f4f6]">
      {/* ヘッダー */}
      <header className="bg-white border-b border-[#e5e7eb]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-6">
              <h1 className="text-xl font-bold text-[#1f2937]">フォーム管理</h1>
              <nav className="flex items-center gap-4">
                <Link
                  href="/students"
                  className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                    pathname === '/students'
                      ? 'bg-[#3b82f6] text-white'
                      : 'text-[#4b5563] hover:bg-[#f3f4f6]'
                  }`}
                >
                  生徒管理
                </Link>
                <Link
                  href="/applications"
                  className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                    pathname === '/applications'
                      ? 'bg-[#3b82f6] text-white'
                      : 'text-[#4b5563] hover:bg-[#f3f4f6]'
                  }`}
                >
                  申込状況
                </Link>
                <Link
                  href="/forms/manage"
                  className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                    pathname === '/forms/manage'
                      ? 'bg-[#3b82f6] text-white'
                      : 'text-[#4b5563] hover:bg-[#f3f4f6]'
                  }`}
                >
                  フォーム管理
                </Link>
              </nav>
            </div>
          </div>
        </div>
      </header>

      {/* メインコンテンツ */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* ヘッダーアクション */}
        <div className="flex items-center justify-between mb-6">
          {/* タブ */}
          <div className="flex gap-2 border-b border-[#e5e7eb]">
            <button
              onClick={() => setActiveTab('forms')}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === 'forms'
                  ? 'bg-[#3b82f6] text-white border-b-2 border-[#e5e7eb]'
                  : 'text-[#4b5563] hover:text-[#1f2937]'
              }`}
            >
              フォーム
            </button>
            <button
              onClick={() => setActiveTab('templates')}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === 'templates'
                  ? 'bg-[#3b82f6] text-white border-b-2 border-[#e5e7eb]'
                  : 'text-[#4b5563] hover:text-[#1f2937]'
              }`}
            >
              テンプレート
            </button>
          </div>
          {/* 保護者向けポータルボタン */}
          {schoolCode && (
            <a
              href={`/portal/${schoolCode}`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 bg-[#3b82f6] text-white rounded-lg hover:bg-[#60a5fa] font-medium transition-colors"
            >
              保護者向けポータルを開く
            </a>
          )}
        </div>

        {/* コンテンツ */}
        <div className="bg-white rounded-xl border border-[#e5e7eb] p-6">
          {activeTab === 'forms' ? (
            <>
              <div className="mb-4 flex justify-end">
                <button
                  onClick={() => {
                    setSelectedTemplate(null);
                    setEditingFormId(null);
                    setIsFormEditorOpen(true);
                  }}
                  className="px-4 py-2 bg-[#3b82f6] text-white rounded-lg hover:bg-[#60a5fa] font-medium"
                >
                  新規作成
                </button>
              </div>
              <FormList
                key={refreshKey}
                onEditForm={handleEditForm}
                onViewResponses={handleViewResponses}
                onRefresh={() => setRefreshKey((prev) => prev + 1)}
              />
            </>
          ) : (
            <TemplateList
              onSelectTemplate={handleSelectTemplate}
              onRefresh={() => setRefreshKey((prev) => prev + 1)}
            />
          )}
        </div>
      </div>

      {/* フォーム編集モーダル */}
      <FormEditor
        isOpen={isFormEditorOpen}
        onClose={() => {
          setIsFormEditorOpen(false);
          setSelectedTemplate(null);
          setEditingFormId(null);
        }}
        formId={editingFormId}
        template={selectedTemplate}
        onSuccess={handleFormEditorSuccess}
      />
    </div>
  );
}
