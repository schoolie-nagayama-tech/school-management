'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui';
import { ApplicationTable, ApplicationItemSettings } from '@/components/applications';
import { StudentDetailModal } from '@/components/students';
import {
  getStudents,
} from '@/lib/api/students';
import {
  getApplicationItems,
  getStudentApplications,
} from '@/lib/api/applications';
import type {
  Student,
  ApplicationItem,
  StudentApplication,
  ApplicationStatus,
} from '@/types/database';

export default function ApplicationsPage() {
  const pathname = usePathname();
  
  // 状態管理
  const [students, setStudents] = useState<Student[]>([]);
  const [items, setItems] = useState<ApplicationItem[]>([]);
  const [applications, setApplications] = useState<StudentApplication[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  // データを取得
  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage('');
    try {
      const [studentsData, itemsData, applicationsData] = await Promise.all([
        getStudents(),
        getApplicationItems(),
        getStudentApplications(),
      ]);
      setStudents(studentsData);
      setItems(itemsData);
      setApplications(applicationsData);
    } catch (error) {
      console.error('Error fetching data:', error);
      setErrorMessage(
        error instanceof Error ? error.message : 'データの取得に失敗しました'
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 初回読み込み
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // 申込状況が変更されたときの処理
  const handleStatusChange = useCallback(
    (studentId: string, itemId: string, status: ApplicationStatus | null) => {
      if (status === null) {
        // 削除
        setApplications((prev) =>
          prev.filter(
            (app) => !(app.student_id === studentId && app.item_id === itemId)
          )
        );
      } else {
        // 更新または追加
        setApplications((prev) => {
          const existing = prev.find(
            (app) => app.student_id === studentId && app.item_id === itemId
          );
          if (existing) {
            return prev.map((app) =>
              app.id === existing.id ? { ...app, status } : app
            );
          } else {
            // 新規作成（実際のIDはAPIから返されるが、ここでは仮のIDを使用）
            const newApp: StudentApplication = {
              id: `temp-${studentId}-${itemId}`,
              school_id: students.find((s) => s.id === studentId)?.school_id || '',
              student_id: studentId,
              item_id: itemId,
              status,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            return [...prev, newApp];
          }
        });
      }
    },
    [students]
  );

  // 項目設定が閉じられたときに再取得
  const handleSettingsClose = () => {
    setIsSettingsModalOpen(false);
    fetchData();
  };

  // 生徒詳細を開く
  const handleStudentClick = (student: Student) => {
    setSelectedStudent(student);
    setIsDetailModalOpen(true);
  };

  // 生徒詳細を閉じる
  const handleDetailClose = () => {
    setIsDetailModalOpen(false);
    setSelectedStudent(null);
  };

  return (
    <div className="min-h-screen bg-[#eff0f3]">
      {/* ヘッダー */}
      <header className="bg-[#fffffe] border-b border-[#0d0d0d]">
        <div className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-6">
              <h1 className="text-xl font-bold text-[#0d0d0d]">申込状況管理</h1>
              <nav className="flex items-center gap-4">
                <Link
                  href="/students"
                  className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                    pathname === '/students'
                      ? 'bg-[#ff8e3c] text-[#0d0d0d]'
                      : 'text-[#2a2a2a] hover:bg-[#eff0f3]'
                  }`}
                >
                  生徒管理
                </Link>
                <Link
                  href="/applications"
                  className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                    pathname === '/applications'
                      ? 'bg-[#ff8e3c] text-[#0d0d0d]'
                      : 'text-[#2a2a2a] hover:bg-[#eff0f3]'
                  }`}
                >
                  申込状況
                </Link>
              </nav>
            </div>
            <button
              onClick={() => setIsSettingsModalOpen(true)}
              className="p-2 text-[#2a2a2a] hover:text-[#0d0d0d] hover:bg-[#eff0f3] rounded-lg transition-colors relative group"
              title="項目設定"
            >
              <svg
                className="w-6 h-6 text-[#0d0d0d]"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
              <span className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 text-xs text-white bg-[#0d0d0d] rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap">
                項目設定
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* メインコンテンツ */}
      <div className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 py-6">

        {/* エラーメッセージ */}
        {errorMessage && (
          <div className="mb-4 bg-[#d9376e]/20 text-[#d9376e] px-4 py-2 rounded border border-[#d9376e]">
            {errorMessage}
          </div>
        )}

        {/* 説明 */}
        <div className="mb-4 text-[#2a2a2a] text-sm">
          <p>セルをクリックして申込状況を切り替えます: 空白 → ×（未申込）→ ✓（申込済）→ -（対象外）→ 空白</p>
        </div>

        {/* テーブル */}
        {isLoading ? (
          <div className="bg-[#fffffe] rounded-xl border border-[#0d0d0d] p-8">
            <div className="flex items-center justify-center">
              <svg
                className="animate-spin h-8 w-8 text-[#ff8e3c]"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              <span className="ml-3 text-[#2a2a2a]">読み込み中...</span>
            </div>
          </div>
        ) : items.length === 0 ? (
          <div className="bg-[#fffffe] rounded-xl border border-[#0d0d0d] p-8 text-center">
            <p className="text-[#2a2a2a] mb-4">申込項目がありません。</p>
            <Button onClick={() => setIsSettingsModalOpen(true)}>
              項目設定を開く
            </Button>
          </div>
        ) : (
          <ApplicationTable
            students={students}
            items={items}
            applications={applications}
            onStatusChange={handleStatusChange}
            onStudentClick={handleStudentClick}
          />
        )}

        {/* 項目設定モーダル */}
        <ApplicationItemSettings
          isOpen={isSettingsModalOpen}
          onClose={handleSettingsClose}
        />

        {/* 生徒詳細モーダル */}
        {selectedStudent && (
          <StudentDetailModal
            isOpen={isDetailModalOpen}
            onClose={handleDetailClose}
            student={selectedStudent}
            onEdit={(student) => {
              // 編集は別ページで行うため、ここでは詳細を閉じるだけ
              handleDetailClose();
            }}
          />
        )}
      </div>
    </div>
  );
}
